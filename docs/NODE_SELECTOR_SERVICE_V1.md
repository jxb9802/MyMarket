# Node Selector Service V1

## Goal

把节点选择从“库函数/打分器”升级成独立后台服务。

这个服务负责：

- 持续探测公网节点
- 维护节点能力画像
- 按用途返回可用节点
- 统一节点 lease/session 所有权

其它模块不再直接各自维护一套节点连接策略，而是向 selector 服务申请节点或 session。

## Why

当前项目里，虽然 selector 已经独立成模块，但仍然存在这些问题：

- `wallet.js` 会自己维护 SPV 连接池
- `server_market.js` 会自己做 header sync / block sync / quickstart
- `block_headers_service.js` 会自己连 headers 节点
- 调试/独立脚本也会自己连节点

结果是：

- 多个模块会同时争用同一批公网节点
- 节点打分和实际连接所有权不统一
- 某个节点对某类任务好，不代表对另一类任务也好

## Target Architecture

### 1. Selector Service

独立后台进程，维护：

- 候选节点池
- 节点能力分层统计
- 活跃 leases
- session 占用
- cooldown / quarantine / ban

### 2. Capability Classes

节点按用途分别建模，不再共用一个总分：

- `sync_block`
- `sync_header`
- `wallet_connect`
- `wallet_listener`
- `broadcast`
- `probe`

每个用途单独记录：

- successCount
- failCount
- consecutiveFails
- avgLatencyMs
- lastSuccessAt
- lastFailureAt
- lastTimeoutAt
- bannedUntil

### 3. Session / Lease Ownership

selector 服务统一持有“谁可以操作这个节点”：

- `fresh` lease
- `persistent` lease
- `listener` lease

其它模块不得直接 `new BitcoinP2P(node)`。

统一改成：

- `acquireLease(...)`
- `acquirePreferredLease(...)`
- `releaseLease(...)`
- `reportSuccess(...)`
- `reportFailure(...)`

## Service Responsibilities

### A. Background Probing

服务启动后持续运行 probe loop：

- 对前排节点做高频轻 probe
- 对中后排节点做低频轮询
- 对新节点做准入测试

建议 probe 分层：

1. TCP / connect
2. P2P version / handshake
3. lightweight header test
4. block read sample

### B. Node Classification

按最近表现分类：

- `hot`
  最近成功，低延迟，可优先分配
- `warm`
  可用但近期样本少
- `cold`
  长时间未验证
- `cooling`
  刚失败，短期不再分配
- `quarantined`
  连续失败，需要隔离
- `banned`
  暂时完全不可用

### C. Purpose-Aware Allocation

不同模块按 purpose 请求节点：

- quickstart/frontier:
  只给 `hot sync_block` 节点
- normal block sync:
  `hot + warm sync_block`
- headers:
  `sync_header`
- wallet listener:
  稳定在线节点
- broadcast:
  广播成功率高的节点

## External API

第一版服务接口建议：

### Snapshot / Query

- `getCandidates({ purpose, limit })`
- `getHealth(node, { purpose })`
- `getSnapshot()`
- `getActiveLeases()`

### Lease

- `acquireLease({ purpose, mode, exclude })`
- `acquirePreferredLease({ preferred, purpose, mode, exclude })`
- `releaseLease(id, meta)`

### Reporting

- `reportSuccess(node, { purpose, latencyMs, ... })`
- `reportFailure(node, { purpose, error, ... })`

### Background Control

- `startProbeLoop()`
- `stopProbeLoop()`
- `refreshCandidates()`

## Integration Strategy

### Phase 1

只保留 selector 独立，先接独立同步工具。

目标：

- 用独立同步工具验证
- 让 selector 后台持续 probe
- 让独立同步工具只通过 selector 拿节点

### Phase 2

把主同步链路接到 selector service。

目标：

- `server_market.js` 不再直接选节点
- quickstart / normal sync 都通过 selector 申请 lease

### Phase 3

把 `wallet.js` 的 SPV 池接过来。

目标：

- wallet listener / broadcast 也走 selector
- 同一节点的连接所有权统一

### Phase 4

把 `block_headers_service.js` 接过来。

目标：

- headers 也不再独立争抢节点

## Rules

### Rule 1

同一节点是否允许同时服务多个模块，由 selector 决定。

### Rule 2

不同用途分数不能混算。

### Rule 3

成功节点池要跨轮保留，但必须持续重新验证。

### Rule 4

background probe 结果只能影响排序和分层，不能直接替代实际业务 success/failure。

### Rule 5

quickstart/frontier 只能拿最近被 `sync_block` 成功验证过的节点。

### Rule 6

当同步服务切换到新 epoch / generation 时：

- 旧 generation 的 lease 不再领取新任务
- 旧结果允许自然返回，但提交前必须通过 epoch 校验
- 旧结果若已过期，一律按 `stale` 丢弃

### Rule 7

如果新同步发起时，旧 generation 仍有大量节点在工作中，不应傻等所有旧节点完全结束。

应采用：

- 短时间 `drain` 等待窗口
- 有限保留旧 lease 自然收尾
- 同时允许 selector 从未占用的新节点池补充新 lease

目标是：

- 避免旧结果污染新同步
- 避免因为老节点仍在忙而把新同步完全卡住
- 通过补充新节点提高首次窗口的启动速度

### Rule 8

selector 在分配 lease 时要显式区分：

- `busy_old_generation`
- `available_current_generation`
- `new_candidate`

当 `available_current_generation` 不足时，应优先扩充 `new_candidate`，而不是长时间等待 `busy_old_generation` 释放。

## Expected Outcome

如果这条路线跑通，最终效果应该是：

- 节点不再被多个模块乱抢
- 同步可以更快收敛到真正适合当前机器/当前网络的节点
- wallet/listener/broadcast 不会污染 block sync 选点
- 主进程可以逐步退化成“消费同步结果”的业务层

## Paired Sync Service Direction

节点服务要和同步服务配套独立。

目标不是只把 selector 独立，而是把同步模块也完全独立成服务/进程。

### Sync Service Requirements

- 输入必须是固定命令
- 输出必须通过状态表 / 状态文件
- 其它模块不能再直接调用内部同步函数

### Command Inputs

建议统一为固定命令集，例如：

- `start_sync`
- `resume_sync`
- `stop_sync`
- `rebuild_from_height`
- `rebuild_chain_indexes`
- `refresh_utxo`

### Status Outputs

同步服务统一维护状态表，例如：

- 当前命令
- 当前阶段
- 当前窗口
- 已完成高度
- 网络高度
- lag
- quickstart 状态
- 错误信息
- 最近成功节点
- 最近失败节点

### Consumers

所有外部调用方都只通过命令和状态表交互：

- 主进程
- 测试工具
- 独立脚本
- steward / 后台调度器

### End State

最终架构是两层独立服务：

1. `Node Selector Service`
   - 负责节点能力与 session/lease

2. `Sync Service`
   - 负责链同步 / UTXO / 状态推进
   - 通过 selector service 拿节点

主进程只负责：

- API
- UI
- 业务逻辑
- 读取同步状态和结果
