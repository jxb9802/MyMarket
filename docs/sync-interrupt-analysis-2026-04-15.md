# 同步中断原因分析

日期：2026-04-15

## 当前结论

Linux 当前这次并没有完全停住，而是处于“仍在同步，但窗口非常慢”的状态。

当前实测：

- `/api/sync/status` 显示 `jobState.currentJob.jobType = "run_chain_sync"`，`status = "running"`，`stage = "p2p_service_window"`
- `localHeight = 944970`
- `highestBlock = 944978`
- `lag = 8`
- `activeSyncNodes = 3`

这说明当前更像“同步很慢、看起来像中断”，不是 durable queue 已经死锁。

## 已出现过的真正中断原因

### 1. durable queue 的 `claim_next_durable_message` 半成功

这是目前已经确认过、而且会真正把同步卡死的第一类原因。

机制：

- `messageQueue.claim()` 在 SQLite / writer 侧可能已经成功，把命令状态改成了 `claimed`
- 但父代理请求在回包前超时，steward 没拿到返回值
- 结果是命令在 durable queue 里已经被占用，但执行器并没有继续跑
- 后续新的 `run_chain_sync` 会被误判成“已有活动同步”，从而不再推进

代码证据：

- `sync_domain.claimNextCommand()` 现在专门针对 `PARENT_PROXY_TIMEOUT` / `WRITER_TIMEOUT` / `claim_next_durable_message` 做了 claim 后恢复回查  
  见 [sync_domain.js](../sync_domain.js:1222)
- 昨天的记录已经把这类问题定性为 Windows 同步卡死的根因  
  见 [memory/2026-04-14.md](../memory/2026-04-14.md:21)

表现：

- `commandQueue.claimedCount > 0`
- `jobState.currentJob` 不再推进，甚至没有对应运行态
- 新的链同步不会再启动

结论：

这是已经实锤的“真中断”原因。

### 2. 进程重启后遗留 stale claimed / stale queued chain sync

这也是已经确认过、会导致同步无法继续的一类原因。

机制：

- 旧 steward 或主进程重启前，`run_chain_sync` / `rebuild_chain_indexes` 命令留在 `pending` 或 `claimed`
- 新进程起来后，队列里看起来仍然“有活动同步”
- 于是新的同步任务不再入队，或者 steward 不再 claim 新任务

代码证据：

- `interruptStaleClaimedCommands()` 用 `claimedAt` 年龄来回收旧 claimed 命令  
  见 [sync_domain.js](../sync_domain.js:1489)
- steward 启动轮询时，会先主动回收 stale claimed 的 `run_chain_sync` / `rebuild_chain_indexes`  
  见 [steward_subprocess.js](../steward_subprocess.js:265)
- 主进程启动时也会做 `recoverStartupChainSyncState()`，中断残留的 queued/claimed chain sync  
  见 [server_market.js](../server_market.js:7068)

表现：

- 重启后 `alreadyActive = true`，但本地高度不再推进
- `commandQueue` 里能看到旧的 `claimed` 或 `pending` chain sync 命令

结论：

这是已经修过的一类真中断原因，本质是“上次同步遗留的僵尸命令”。

### 3. durable queue 的 `finish_durable_message` / 队列代理超时

这类问题和 claim 半成功同源，也可能导致同步状态错乱或进入失败退避。

机制：

- steward 在完成命令或切换状态时，调用 `finish_durable_message`
- 如果 writer / parent proxy 在这一步超时，steward 认为命令完成失败
- 进而进入 `sync_failed` 和 backoff

代码证据：

- steward 对这类错误会进入 `sync_failed`，记录 `nextDelaySec` 并重新调度  
  见 [steward_subprocess.js](../steward_subprocess.js:438)
- 历史日志里这类 durable queue 调用曾经伴随多秒级代理超时

表现：

- 日志出现 `sync_failed`
- `lastPhase = sync_failed`
- 会有一段回退等待时间，用户体感像“突然不动了”

结论：

这类问题不一定永久卡死，但会造成同步中断、退避、甚至留下不一致命令状态。

## 已出现过的“假中断”原因

这几类问题不会真的把 `run_chain_sync` 停掉，但会让 UI 或观察者误以为“同步断了”。

### 4. 大区块 / 大窗口导致单轮 `p2p_service_window` 极慢

这是 Linux 当前最接近真实现状的问题。

当前日志证据：

- `independent_sync_window_finished` 持续出现，说明同步还在跑
- 但单块探测很慢，当前日志里已经出现：
  - `elapsedMs = 75807`
  - `elapsedMs = 108546`
  - `elapsedMs = 125202`
- 同时 `stream_block_probe_memory` 长时间停留在：
  - `rssMb ≈ 609`
  - 多个探针 `elapsedMs > 100000`

表现：

- `/api/sync/status` 里的 `jobState.currentJob.updatedAt` 不一定频繁变化
- `progressCurrent / progressTotal` 看上去长时间不动
- 但其实 `independent_sync_window_finished` 仍在持续出现，本地高度会慢慢推进

结论：

这是“同步很慢”，不是“同步真正中断”。

### 5. 单个 peer 断连 / `stream sync failed`

这类问题在当前日志里反复出现，但通常只影响单个高度或单轮尝试，不会单独导致全局停摆。

当前日志证据：

- `peer disconnected: 78.110.160.26:8333`
- `peer disconnected: 51.89.99.162:8333`
- `stream sync failed`
- 随后系统会进入 `round 2`，换备用节点重试

表现：

- 某些高度第一轮失败
- `backupRequiredNextRound = true`
- 后续 round 2 经常又成功

结论：

这是节点质量问题，不是同步框架死锁。它会放慢同步，但通常不是“完全中断”的根因。

### 6. 主线程卡顿导致状态展示滞后

此前 Linux 已经出现过这种情况：同步其实还在跑，但主线程 lag 太大，前端看到的是旧状态。

历史证据：

- `runtime_pause_detected`
- `event_loop_lag_slow`
- `handleWorkerMarketDbProxyRequest` 多秒慢路径

这会导致：

- `/api/state-lite`
- `/api/sync/status`
- 前端广播

全部延后，看起来像“同步没动”，但实际上是状态刷新没跟上。

这一类在最近一轮优化后已经明显减轻，但仍然是需要继续盯的风险项。

## 当前这次 Linux “像中断”的判断

基于当前实时状态，我的判断是：

- 不是 durable queue claim 卡死
- 不是 stale claimed 命令堵住队列
- 不是 `run_chain_sync` 根本没在跑

而是：

1. 当前 `run_chain_sync` 正在执行
2. 但落在 `p2p_service_window`
3. 其中若干 block 的流式读取极慢，单块达到 30-125 秒
4. 个别节点还会断连，导致某些高度需要第二轮重试

所以当前更准确的定性是：

`同步未中断，但窗口执行极慢，体感上像中断`

## 到目前为止，已出现过的原因总表

### 真正会让同步停住

1. `claim_next_durable_message` 半成功，形成 zombie claimed command
2. 进程重启后遗留 stale claimed / stale queued chain sync
3. `finish_durable_message` 或同类 durable queue 代理超时，导致 steward 进入 `sync_failed` / backoff

### 会让同步看起来像停住

1. 大区块或大窗口导致单轮 `p2p_service_window` 执行几十秒到上百秒
2. 单个 peer 断连或 `stream sync failed`，触发 round 2 重试
3. 主线程 lag 导致 `/api/sync/status` 和前端广播滞后

## 下一步建议

如果目标是继续减少“看起来像中断”的情况，优先级建议如下：

1. 给 `p2p_service_window` 增加更细粒度的心跳更新时间
2. 对超大 block 的流式处理增加更严格的超时与切换策略
3. 把当前活跃同步窗口的 block 级进度单独暴露给 `/api/sync/status`
4. 继续压 `sync.runtime.updated` 相关广播和主线程状态构造成本

## 当前慢块记录

以后凡是“不能同步 / 看起来不能同步”的问题，都继续追加在这个文档里。

### 2026-04-15 Linux 当前慢块

当前同步状态：

- `run_chain_sync` 仍在 `running`
- `stage = p2p_service_window`
- `localHeight = 944970`
- `highestBlock = 944978`
- `lag = 8`

当前已经观察到的慢窗口：

#### 窗口 `941867 - 941878`

最慢块：

- `941868` on `78.110.160.26:8333`
  - `txCount = 247778`
  - `extractElapsedMs = 96551`
- `941869` on `51.89.99.162:8333`
  - `txCount = 211775`
  - `extractElapsedMs = 93565`
- `941875` on `99.127.49.102:8333`
  - `txCount = 197073`
  - `extractElapsedMs = 91004`
- `941878` on `162.19.222.167:8333`
  - `txCount = 106642`
  - `extractElapsedMs = 68686`
- `941874` on `195.144.22.198:8333`
  - `txCount = 101244`
  - `extractElapsedMs = 66868`

#### 窗口 `941879 - 941890`

最慢块：

- `941883` on `99.127.49.102:8333`
  - `txCount = 98889`
  - `extractElapsedMs = 54119`
  - `rowsFound = 0`
- `941884` on `195.144.22.198:8333`
  - `txCount = 65931`
  - `extractElapsedMs = 51349`
  - `rowsFound = 0`
- `941879` on `135.125.170.182:8333`
  - `txCount = 46007`
  - `extractElapsedMs = 45953`
  - `rowsFound = 0`
- `941882` on `141.95.126.79:8333`
  - `txCount = 47166`
  - `extractElapsedMs = 46428`
  - `rowsFound = 0`

#### 窗口 `941903 - 941914`

最慢块：

- `941912` on `159.89.105.214:8333`
  - `txCount = 149589`
  - `extractElapsedMs = 80676`
  - `rowsFound = 0`
- `941913` on `51.89.99.162:8333`
  - `txCount = 23613`
  - `extractElapsedMs = 26076`
  - `rowsFound = 0`

#### 当前正在拖慢的块

从最新 `stream_block_probe_memory` / `stream_block_probe_transactions_finished` 看，当前这批仍在拖慢窗口推进的块是：

- `941915`
  - `txCountObserved = 56787`
  - `elapsedMs = 39868`
- `941923`
  - `txCountObserved = 59041`
  - `elapsedMs = 40983`
- `941922`
  - `txCountObserved = 35840`
  - `elapsedMs = 29196`
- `941918`
  - `txCountObserved = 30994`
  - `elapsedMs = 26300`

## 为什么这些块会慢

当前证据指向的不是 SQLite，也不是 durable queue，而是 `p2p_service_window` 里的全量交易扫描成本：

1. `streamBlockFromConnectedPeer()` 会把流式区块里的每个交易都解析成 `Transaction` 对象。
2. `extractAnchorRowsFromStreamedPeer()` 对每批交易都会调用 `processP2PTransactionsBatch()`。
3. `processP2PTransactionsBatch()` 会对每个交易执行：
   - 钱包触碰判断
   - 输出遍历
   - OP_RETURN / anchor 解析
4. 即使该块最后 `rowsFound = 0`，前面的全量解析和扫描也已经做完了。

所以当前慢块的共同点是：

- `txCount` 很高
- `rowsFound` 经常是 `0`
- 仍然支付了整块逐交易、逐输出扫描的 CPU 成本

换句话说，当前最慢的不是“命中太多 anchor 的块”，反而是“没有命中，但交易非常多的块”。

## 观察口径修正

`stream_block_probe_memory` 里的 `socketBytesRead` 不是“这个块本身有这么大”，而是这个持久连接到当前时刻为止的累计读字节数。

所以像 `1.7GB`、`2.5GB` 这样的数字，只能说明这个连接已经持续读了很多数据，不能直接拿来当作单个区块大小。

## 重启后的最新状态

在 2026-04-15 23:13 左右重启 Linux 后：

- 新主进程：`279010`
- 新 steward：`279040`
- 启动恢复把旧的 `cmd-001152` 标记成 `steward worker restarted before completion`
- 随后重新入队并 claim 了 `cmd-001153`

恢复后的同步起点已经不是前面的 `9419xx` 大窗口，而是：

- `startHeight = 944971`
- `targetHeight = 944976`
- `parallelBlocks = 2`

这说明重启后并没有再重跑那批超大历史块。

### 重启后当前看到的慢因

重启后的尾部块目前更像是网络层问题，而不是大块 CPU 扫描问题：

- `944971` round 1
  - `error = getblock idle timeout: 157.143.83.144:8333`
  - `totalElapsedMs = 5447`
- `944972` round 1
  - `error = getblock idle timeout: 115.187.38.11:8333`
  - `totalElapsedMs = 6928`

也就是说：

- 重启前的主要慢因：超大块全量交易扫描
- 重启后的当前慢因：尾部个别节点 `getblock idle timeout` 后进入 round 2 重试
- `941867` on `135.125.170.182:8333`
  - `txCount = 92558`
  - `extractElapsedMs = 63341`

#### 窗口 `941831 - 941842`

最慢块：

- `941831` on `135.125.170.182:8333`
  - `txCount = 118784`
  - `extractElapsedMs = 31261`
- `941842` on `78.110.160.26:8333`
  - `txCount = 67321`
  - `extractElapsedMs = 27861`
- `941833` on `65.108.102.125:8333`
  - `txCount = 59392`
  - `extractElapsedMs = 25624`
- `941834` on `141.95.126.79:8333`
  - `txCount = 35111`
  - `extractElapsedMs = 20608`

### 当前为什么慢

根因不是 SQLite 提交，也不是 queue 卡死，而是：

1. 当前窗口里有多个超大块，`txCount` 明显高
2. `stream_block_probe_memory` 显示单块流读取 10 秒时已经读入：
   - `2.4GB`
   - `1.7GB`
   - `1.5GB`
   - `1.2GB`
3. steward 进程 `277410` 当前 CPU 约 `90%`，内存约 `9.4%`
4. 当前慢主要耗在：
   - `getBlockElapsedMs`
   - `extractElapsedMs`

所以这轮慢的本质是：

`流式区块读取 + 大块交易遍历/提取成本过高`

不是：

- `claim_next_durable_message` 卡死
- `finish_durable_message` 卡死
- `apply_sync_projection_batch` 卡死

### 一个额外观察

`/api/sync/status` 里 `jobState.currentJob.updatedAt` 仍然停在旧时间，这会让 UI 更像“同步不动了”。

但实际日志里：

- `independent_sync_window_finished`
- `independent_sync_block_round_finished`
- `stream_block_probe_transactions_finished`

都还在持续出现。

所以这里还有一个展示层问题：

`jobState` 心跳更新不够及时，会把“很慢”误显示成“像中断”。 

## 2026-04-17 Windows: `steward` 存活但 idle recovery 永远不入队

### 表现

- Windows `/api/sync/status`
  - `mode = catchup_sync`
  - `lag > 0`
  - `independentPhase = idle`
  - `commandQueue.pendingCount = 0`
  - `commandQueue.claimedCount = 0`
- `steward_subprocess.js` 已经启动
- 但没有新的 `run_chain_sync` 被自动入队

### 先排除的旧原因

这次不是之前那几类老问题：

- 不是 zombie `claimed` command 堵住队列
- 不是 `autoSyncEnabled = false`
- 不是 `steward_subprocess.js` 缺失

这些都检查过：

- `claimedCount = 0`
- `autoSyncEnabled = true`
- Windows 进程列表里已有 `steward_subprocess.js`

### 真实根因

根因是 **Windows `steward_subprocess.js` 用错了 sync 真相源**。

`steward_subprocess.js` 在 idle recovery 判定里会调用：

- `serverMarket.getStewardRuntimeSnapshot({ confirm: true })`

但这个调用发生在子进程自己内部。  
它最终读到的是子进程里本地构出来的 `syncDomain` 运行态，而不是父进程当前真实的 `/api/sync/status`。

结果就是：

- 主进程真实状态：`lag = 5`
- `steward` 子进程看到的本地状态：`lag = 0`

于是这条逻辑永远不成立：

- `lag > 0 && !queueBusy && !hasActiveChainSync && !syncPaused && autoSyncEnabled`

所以不会触发：

- `steward_idle_lag_recovery_enqueued`

### 为什么容易误判

因为从外部看非常像“同步不动了”：

- BHS tip 在前进
- `lag > 0`
- 没有 pending/claimed command
- `steward` 也在跑

但真正问题不是 queue，也不是 worker 死掉，而是：

- `steward` 判定要不要补入队时看的 lag 是错的

### 修复方案

修复方式是把 `steward` 的 lag 判定改成优先读取主服务确认值：

- `steward_subprocess.js`
  - 新增 `fetchConfirmedSyncStatus()`
  - 通过 `http://127.0.0.1:8091/api/sync/status`
    获取父进程确认过的 sync 状态
  - 在 `tick()` 的 idle recovery 判定里，优先用这个 confirmed status 的：
    - `sync`
    - `commandQueue`
    - `jobState`

这样 `steward` 判断是否要自动补入队时，看到的就是主进程真实：

- `localHeight`
- `highestBlock`
- `lag`
- `pendingCount`
- `claimedCount`

而不是子进程自己那份过期/错误的 runtime。

### 修复后验证

修复并重启 Windows 后观察到：

- `/api/sync/status`
  - `localHeight` 从 `945118` 前进到 `945120`
  - 然后继续追到 `945123`
  - 最终 `lag = 0`
- `commandQueue.lastCommand`
  - `cmd-000556`
  - `commandType = run_chain_sync`
  - `status = claimed -> done`
- 日志出现：
  - `independent_sync_service_started startHeight=945119 targetHeight=945123`
  - `command_finished commandType="run_chain_sync" status="done"`

最终 Windows 恢复到：

- `mode = wallet_active`
- `localHeight = highestBlock = 945123`
- `lag = 0`
