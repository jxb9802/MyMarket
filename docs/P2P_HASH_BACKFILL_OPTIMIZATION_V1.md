# P2P Hash Backfill Optimization V1

## 背景

当前 P2P 同步已经具备：

- `16` 个节点参与调度
- `getBlock timeout -> backup 节点接手` 的 failover 机制

但从最近多轮日志看，单轮同步总耗时里仍然存在明显的预处理长尾：

- `task_queue_ready` 常见为 `8s ~ 21s`
- 对应 `hashBackfillElapsedMs` 几乎等于 `task_queue_ready`

说明任务准备阶段的 `height -> hash` 回填已经成为仅次于 `getBlock` 下载的第二大瓶颈。

## 已确认根因

### 1. hash backfill 当前是串行 HTTP 请求

代码路径：

- `syncAnchorsFromP2P()` 中的 `queueTask()` / `ensureHeightHash()`
- `ensureHeightHash()` 调用 `getBlockHashByHeight(state, h)`
- `getBlockHashByHeight()` 最终走 `chainGet('/block/height/:height')`

当前任务入队阶段是：

- 逐高度循环
- 对每个缺 hash 的高度 `await ensureHeightHash()`
- 因而形成严格串行的 HTTP 请求链

效果上等价于：

- 缺 `96` 个 hash
- 平均每个请求 `~200ms`
- 总耗时约 `19s ~ 21s`

这和日志完全一致。

### 2. 不是 header sync 失效，而是 BHS 覆盖起点太高

当前 [`data/bhs_state.json`](/home/jb9802/.openclaw/workspace/app/bsv_market/data/bhs_state.json) 中本地可信 header 状态为：

- `min = 940022`
- `max = 942353`
- `count = 2332`
- 连续无 gap

因此：

- `940022` 以上的高度，BHS 可直接提供连续 hash
- `940022` 以下的高度，不在 `trustedBhsHeaders` 覆盖范围内

而当前同步起点仍在：

- `938626`
- `938722`
- `938783`

这意味着在追平到 `940022` 之前，`938xxx -> 940021` 这段高度仍然必须靠 `getBlockHashByHeight()` 单独回填。

## 当前耗时结构

从最近日志可以归纳出同步耗时排名：

1. `block_workers_done`
   - 真正的 `peer.getBlock(...)` 阶段
   - 目前仍然是最大头

2. `task_queue_ready`
   - 几乎全部由 `hashBackfillElapsedMs` 构成
   - 是第二大瓶颈

3. `header_sync / state_saved / catalog_rebuild`
   - 相比前两者不是当前主要矛盾

## 目标

优化目标不是改整体架构，而是把 `hashBackfill` 的等待从“串行长尾”降为“可控并发 + 可复用缓存”。

目标效果：

- 在追到 `940022` 之前，明显压缩 `task_queue_ready`
- 在追到 `940022` 之后，尽量让 backfill 接近 `0`
- 不额外打爆 HTTP 链源
- 不影响现有 `getBlock timeout backup` 机制

## 方案候选

### 方案 A：预热历史 height->hash cache

思路：

- 针对 `bootstrapHeight -> trustedBhsMinHeight - 1` 这一段缺失历史
- 单独做一次后台预热
- 把 `height -> hash` 提前写入 `state.sync.p2pHeightHashCache`

优点：

- 一旦预热完成，后续每轮同步几乎不再为这段历史付出 backfill 成本
- 同步主流程改动较小

缺点：

- 需要额外设计预热任务的入口、进度和容错
- 首次预热本身也要消耗时间和 HTTP 请求
- 如果缓存失效或状态回滚，仍要重新准备

适用场景：

- 当前系统会长期反复从 bootstrap 附近追平
- 希望把历史缺口一次性补齐

### 方案 B：将当前串行 backfill 改成限流并发

思路：

- 保留现有 `queueTask()` 语义
- 但把 `ensureHeightHash()` 从逐高度串行改成固定并发窗口
- 例如并发 `4` 或 `6`

目标是把：

- `96 * 220ms ≈ 21s`

压到近似：

- `(96 / 4) * 220ms ≈ 5s`
- `(96 / 6) * 220ms ≈ 3.5s`

实际会比理论值略高，但仍明显优于串行。

优点：

- 直接命中当前瓶颈
- 改动面相对可控
- 对现有同步流程最友好

缺点：

- 仍然依赖 HTTP 链源
- 并发过高会放大链源压力
- 在追到 `940022` 前，每轮仍然要做 backfill，只是更快

适用场景：

- 希望先快速降低同步等待
- 接受后续再做缓存预热增强

## 推荐方案

推荐采用分阶段方案：

### 第一阶段：先做方案 B

先把现有串行 `hashBackfill` 改成限流并发。

理由：

- 收益直接
- 改动集中
- 不改变已有同步状态机
- 能立刻降低 `task_queue_ready`

建议参数：

- `BSV_MARKET_P2P_HASH_BACKFILL_CONCURRENCY=4`

第一版不要超过 `6`，避免瞬间把链源打爆。

### 第二阶段：再补方案 A

等并发版稳定后，再增加一次性历史预热。

理由：

- 并发版解决“当前慢”
- 预热版解决“以后还会慢”

两者并不冲突，可以叠加：

- 预热命中时不需要 backfill
- 未命中时再走并发 backfill

## 第一阶段详细落地

### 1. 保留 `ensureHeightHash()` 不变

不要先改底层取 hash 函数。

保持：

- 先查 `heightToHash`
- 再查 `state.sync.p2pHeightHashCache`
- 最后才走 `getBlockHashByHeight()`

这样风险最小。

### 2. 改造任务入队阶段

当前逻辑是：

- unresolved gaps 串行 `await queueTask(...)`
- `startHeight -> roundEndHeight` 串行 `await queueTask(...)`

改成两步：

1. 先收集本轮候选高度
2. 对缺 hash 的高度做限流并发回填
3. 回填完成后统一入队

建议数据流：

```js
const plannedHeights = [];
for (let h = startHeight; h <= roundEndHeight; h += 1) plannedHeights.push(h);

const missingHeights = plannedHeights.filter((h) => !hasHashLocally(h));
await backfillMissingHeightsWithConcurrency(missingHeights, 4);

for (const h of plannedHeights) {
  if (hasHashLocally(h)) enqueueTask(h);
  else break;
}
```

### 3. 限流并发实现要求

要求：

- 固定并发，不要无限并发
- 高度顺序可保持，但网络请求可并发
- 失败高度不应阻塞全部 worker 退出
- 回填结果写入：
  - `heightToHash`
  - `state.sync.p2pHeightHashCache`

### 4. 日志要求

建议新增：

- `p2p_hash_backfill_batch_started`
- `p2p_hash_backfill_batch_done`
- `p2p_hash_backfill_batch_failed`

记录：

- 本轮缺失高度数
- 并发度
- 命中缓存数量
- 实际 HTTP 拉取数量
- 总耗时

### 5. 保护措施

需要加两条保护：

- 如果同步 epoch 已过期，立即中断 backfill batch
- 如果某高度 backfill 失败，不要让整个 round 崩掉，只按现有逻辑在该高度停止扩展或保留 gap

## 第二阶段详细落地

增加一个后台预热任务：

- 目标区间：
  - `bootstrapHeight -> trustedBhsMinHeight - 1`
- 每次只推进一小段，比如 `200 ~ 500` 高度
- 使用相同的限流并发 backfill 能力
- 持续写入 `state.sync.p2pHeightHashCache`

触发方式建议二选一：

1. 服务启动后低优先级后台跑
2. 在同步空闲轮次中穿插推进

第一版更建议第二种，避免和正在进行的大同步抢资源。

## 风险评估

### 低风险

- 并发度 `4` 的 backfill
- 保持 `ensureHeightHash()` 和缓存结构不变
- 只改任务准备阶段

### 中风险

- 后台预热与主同步同时请求链源
- 需要防止过度占用 HTTP 源

### 当前不建议做

- 把 `getBlockHashByHeight()` 直接改成新的批量 API 依赖
- 用 P2P header 流完全替代这段历史 hash 准备
- 在这一步引入新的复杂状态机

## 验收标准

第一阶段完成后，应看到：

- `task_queue_ready` 明显下降
- `hashBackfillElapsedMs` 明显下降
- 大轮 `96` 块时，pretask 不再稳定落在 `16s ~ 21s`

理想目标：

- `96` 个 backfill 高度时，`task_queue_ready` 控制在 `3s ~ 6s`

第二阶段完成后，应看到：

- 在追到 `940022` 之前，backfill 请求数逐轮下降
- 追到 `940022` 后，`hashBackfillCount` 接近 `0`

## 建议执行顺序

1. 先实现并发 `hashBackfill`
2. 观察 3 到 5 轮同步日志
3. 确认 HTTP 链源无明显异常
4. 再决定是否增加历史预热任务

## 结论

当前 `hashBackfill` 慢的核心原因不是 header 同步失败，而是：

- BHS 可信 header 覆盖从 `940022` 才开始
- 当前同步起点还在 `938xxx`
- 这一段历史高度只能靠串行 HTTP 回填 hash

因此推荐优先做：

- **限流并发的 hash backfill**

这是当前改动最小、收益最直接、风险最低的优化路线。
