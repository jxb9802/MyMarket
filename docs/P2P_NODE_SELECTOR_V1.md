# P2P Node Selector V1

## 目标

把当前分散在 `wallet.js` 和 `server_market.js` 内的节点选择逻辑，收敛成一个独立的常驻模块：

- 持续测试候选节点
- 结合历史表现与实时可用性排序
- 为外部同步模块快速返回当前最可用、最高效的节点
- 当外部模块退回节点后，立即补发新的最佳候选

这个模块的目标不是“记录节点”，而是“稳定、快速、准确地给业务模块供节点”。

## 现状比对

### 当前已有能力

当前代码里已经有几块与 selector 目标相关的能力：

1. `wallet.js` 的 SPV 节点池
   - `getRankedSpvNodes()`
   - `getSpvNodeSnapshot()`
   - `maintainSpvConnections()`
   - `maybeProbeAndRebalanceActivePeers()`

2. `server_market.js` 的 P2P 同步节点健康系统
   - `getP2PSyncNodeHealth()`
   - `markP2PSyncNodeSuccess()`
   - `markP2PSyncNodeFailure()`
   - `compareP2PSyncNodes()`
   - `getP2PSyncNodeCandidates()`

3. 同步 worker 会动态回报节点表现
   - `connect timeout`
   - `getheaders timeout`
   - `getblock timeout`
   - `worker failed`

4. 节点状态已经支持本地持久化
   - `wallet` 有自己的 `spv_nodes_state.json`
   - `server_market` 有自己的 `sync.p2pNodeStats`

### 当前缺口

和目标方案相比，当前主要差距有 5 个：

1. 没有独立 selector 模块
   - 现在是 `wallet.js` 一套、`server_market.js` 一套
   - 节点排序与分配逻辑分散，职责重复

2. 没有统一的实时活性层
   - 当前同步选点更多依赖历史打分
   - 缺少“刚刚 probe 成功 / 当前确实可连”的优先门控

3. 没有统一的 acquire/release/report 接口
   - 外部模块还在自己持有 `selectedNodes`
   - 没有真正的“租赁节点”语义

4. 没有以同步用途为中心的常驻探测器
   - `wallet` 的常驻连接主要服务 SPV listener
   - 不等同于“适合同步 block worker 的高可用节点池”

5. 没有 connect-fail 后的快速候补机制
   - 当前首批节点如果连接阶段集体失败，整轮可能直接空跑
   - selector 应该在节点退回后立刻补发后备节点

## 为什么现在需要抽离

最近实际运行暴露了一个关键问题：

- 本地确实保存了高分节点状态
- 但同步器拿到的仍然是“历史高分候选”
- 而不是“当前实时最可连的节点”

结果就是：

- 某一轮的首批 16 个候选在同一时间窗里握手失败
- 同步器没有二次补选
- 这一轮直接空跑

这说明当前问题不是“没有节点状态”，而是“节点状态没有被独立、实时、统一地用于分配”。

## 设计目标

新模块建议命名：

- `p2p_node_selector.js`

建议持久状态文件：

- `data/p2p_selector_state.json`

### 模块职责

这个模块只负责 4 件事：

1. 维护候选节点全集
2. 持续探测候选节点并更新状态
3. 排序并输出当前最优节点
4. 处理外部模块的租赁、释放和结果回报

外部业务模块不再自己做复杂选点。

## 状态模型

### 持久状态

每个节点至少记录：

```json
{
  "endpoint": "1.2.3.4:8333",
  "score": 82,
  "lastUpdatedAt": 1774733000000,
  "lastProbeAt": 1774732995000,
  "lastConnectOkAt": 1774732995000,
  "lastConnectFailAt": 1774731000000,
  "lastHandshakeOkAt": 1774732995200,
  "avgConnectMs": 180,
  "avgHandshakeMs": 260,
  "successCount": 1200,
  "failCount": 40,
  "consecutiveFails": 0,
  "cooldownUntil": 0,
  "bannedUntil": 0,
  "source": "wallet"
}
```

### 运行时状态

仅放内存：

```js
{
  leasedCount: 0,
  inProbe: false,
  inUse: false,
  lastLeaseAt: 0,
  lastReleaseAt: 0,
  lastReportedStage: '',
}
```

## 排序原则

排序不能只看历史 score，必须把实时状态放前面。

建议采用两段式判定：

### 1. 可用性门控

先过滤：

- `bannedUntil > now`
- `cooldownUntil > now`
- 当前 probe 失败且过新
- 当前租赁数达到上限

### 2. 有效分排序

建议综合：

- 历史基础分 `baseScore`
- 最近成功时间
- 最近 probe 成功时间
- 平均连接/握手延迟
- 最近失败时间
- 连续失败次数
- 是否当前 live

核心原则：

- 实时成功 > 历史高分
- 最近成功 > 很久以前成功
- 低延迟 > 高延迟
- 低失败率 > 高失败率

## 常驻探测策略

selector 一旦启动，就持续进行后台探测，但必须限流。

### 探测分层

第一层：TCP connect
- 快速判断端口是否可达

第二层：`BitcoinP2P.connect()`
- 判断握手是否真实成功

第三层：轻量可选探测
- 后续可考虑 `ping` / `getheaders`
- 第一版不建议过重

### 探测优先级

优先探测：

- 当前前排节点
- 刚失败的节点
- 长时间未更新的高分节点

轮转探测：

- 中后排候选
- 新加入节点

## 对外接口

建议第一版提供：

```js
start()
stop()

refreshCandidates(candidates)

acquireNodes({ count, purpose, exclude })
acquireBackupNode({ exclude, purpose })

releaseNode(node, meta)
reportSuccess(node, meta)
reportFailure(node, meta)

getSnapshot()
```

### 接口语义

- `acquireNodes`
  - 批量租赁节点
  - 节点一旦被租出，应标记为 in-use

- `acquireBackupNode`
  - 为 backup 场景拿更严格筛选后的节点
  - 比 primary 更保守

- `releaseNode`
  - 释放租赁占用
  - 不等于成功或失败，只是归还节点

- `reportSuccess`
  - 更新成功次数、延迟、最新成功时间

- `reportFailure`
  - 根据失败阶段分别更新：
    - `connect`
    - `handshake`
    - `getheaders`
    - `getblock`

## 业务接入方式

### 当前结构

当前同步器自己做：

- 候选收集
- 排序
- ban/cooldown
- worker 失败处理

### 迁移后

同步器只做：

- 向 selector 要节点
- 执行任务
- 把结果回报给 selector

即：

```js
const nodes = selector.acquireNodes({ count: 16, purpose: 'block_sync' });
```

失败后：

```js
selector.reportFailure(node, { stage: 'connect', error, latencyMs });
selector.releaseNode(node);
```

如果还要补位：

```js
const backup = selector.acquireBackupNode({ exclude: usedNodes, purpose: 'block_sync_backup' });
```

## 与现有代码的关系

### 可复用部分

这些逻辑可以直接迁移进 selector：

- `server_market.js`
  - `getP2PSyncNodeHealth`
  - `markP2PSyncNodeSuccess`
  - `markP2PSyncNodeFailure`
  - `compareP2PSyncNodes`

- `wallet.js`
  - `getSpvNodeSnapshot`
  - reserve probe / rebalance 的思路

### 需要弱化的部分

- `server_market.js` 自己排序选点
- `wallet.js` 作为同步节点最终裁决者

### 保留职责

- `wallet.js`
  - 继续作为候选节点来源
  - 继续维护 SPV listener

- `server_market.js`
  - 继续负责任务调度、块下载、结果提交
  - 不再负责复杂节点排序

## 分阶段落地

### 阶段 1

抽离 selector 基础模块：

- 新建 `p2p_node_selector.js`
- 接管 P2P 节点健康状态
- 先提供 `acquire/release/report`
- 仍然从 wallet snapshot 获取候选

### 阶段 2

接入后台 probe：

- 持续测试候选节点
- 加入实时成功时间、握手成功时间
- 改用 selector 排序结果供同步器使用

### 阶段 3

接管 backup / frontier 专用策略：

- backup 只发健康节点
- frontier 节点优先发最稳节点
- connect fail 后立即候补下一批

## 风险

1. 常驻探测过猛
   - 可能给外部节点带来额外压力
   - 需要限流

2. 状态复杂度提高
   - 如果接口设计不清晰，容易出现节点租赁泄漏

3. 双状态迁移期
   - 迁移过程中 `wallet` 和 `server_market` 可能短期并存
   - 需要明确谁是唯一真源

## 推荐结论

这个方案值得做，而且与当前代码不是冲突关系，而是“收束现有能力”。

当前代码已经有：

- 历史打分
- ban/cooldown
- 持久化
- 常驻 probe 雏形

真正缺的是：

- 独立模块
- 实时活性优先
- 统一 acquire/release/report
- connect-fail 后快速补位

所以这不是推倒重来，而是把现有分散逻辑统一成一个 selector 服务。
