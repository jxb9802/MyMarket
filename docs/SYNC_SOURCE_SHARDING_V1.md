# 同步分片与多源调度 v1

## 目标
- 同步任务按区块高度分片分配给多个数据源，避免单源瓶颈。
- 默认保留兼容兜底；可通过配置降低对 WOC 的依赖。

## 当前实现
- 分片调度：每轮高度分片会按源权重动态分配。
- 源权重维度：
  - 成功率
  - 延迟 EWMA
  - 失败惩罚
  - 类型偏置（`woc` 权重低于自定义源）
- 失败降级：单次请求失败会自动切换到下一候选源（最多 `BSV_MARKET_CHAIN_HTTP_MAX_TRIES`）。
- 统计持久化：`state.sync.sourceStats` 保存每个源的 `success/fail/latency/score`。

## 配置
- 环境变量（`.env.market`）：
  - `BSV_MARKET_CHAIN_HTTP_SOURCES`：自定义源列表，逗号分隔。
  - `BSV_MARKET_ALLOW_WOC_FALLBACK`：`1/0`，是否允许 WOC 兜底。
  - `BSV_MARKET_CHAIN_HTTP_MAX_TRIES`：单请求最大尝试源数。
- 运行时 API：
  - `POST /api/steward` 支持 `chainSources` 数组，写入 `state.sync.chainSources`。

## 说明
- 这是“去中心化优先”的第一版调度器。
- 若未配置自定义源，仍会使用 WOC（兼容模式）。
- 纯 P2P（直接从 SPV 节点抓区块并解析）不在本版内。
