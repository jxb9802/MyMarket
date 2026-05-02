# Block Headers Service v1

## 目标
- 为系统提供一个不会被错误 P2P `start_height` 直接污染的可信高度层。
- 用受控 checkpoint 锁定正确链起点，再从 P2P 仅同步可连续验证的 `headers`。
- 当节点池质量差时，系统应当“停住不前”，而不是跳到明显错误的高位。

## 当前实现
- 服务文件：`block_headers_service.js`
- 运行模式：
  - 独立运行：`npm run bhs:start`
  - 内嵌运行：`server_market.js` 启动时自动拉起
- 状态文件：`data/bhs_state.json`
- 日志文件：`log/bhs.log`

## Checkpoint 来源
- 默认起点高度：`BSV_MARKET_BOOTSTRAP_HEIGHT - 1`
- 默认起点哈希：`BSV_MARKET_BOOTSTRAP_PREV_HASH`
- 如需单独覆盖：
  - `BSV_BHS_CHECKPOINT_HEIGHT`
  - `BSV_BHS_CHECKPOINT_HASH`

该 checkpoint 用来保证：
- 任何不经过这个锚点的链都不能进入本地可信高度
- 以后即使随机 P2P 节点继续上报 `942xxx/944xxx`，也只能作为候选噪声，不能直接污染主状态
- 当 bootstrap 提高时，BHS 也会自动从新的 bootstrap 前一块开始维护连续 header 状态

## 同步机制
1. 从 checkpoint 或当前 BHS tip 开始向多个 P2P 节点发 `getheaders`
2. 对返回 `headers` 做本地连续性校验：
   - `prevHash` 必须与上一块哈希严格连续
   - 哈希格式必须合法
3. 只保留能从当前可信 tip 连续延伸的分支
4. 更新 `data/bhs_state.json`
5. 若没有任何节点能继续延伸，则保持当前 tip 不动

## 与主系统的集成方式
- `server_market.js` 启动时会内嵌启动 BHS
- `loadState()` 会把主系统同步高度按 BHS tip 做一次钳制
- `saveState()` 会在落盘前再做一次钳制

被钳制的字段：
- `sync.localHeight`
- `sync.fixedSyncLastHeight`
- `sync.networkHeight`
- `sync.p2pTipHeight`
- `sync.p2pHeaderCursorHeight`

## 展示策略
- `/api/state`
- `/api/sync/status`

这两个接口现在都应以 BHS tip 作为展示上的可信高度来源。

含义：
- `localHeight`：主系统当前确认完成的可信高度
- `networkHeight`：默认展示为 BHS tip
- `lag`：按 BHS tip 与本地可信高度计算

## 设计取舍
- 选择“宁可停住，也不跳错”
- 不再直接信多数节点报的 `start_height`
- 不再允许错误高值长期写入 `data/state.json`

## 当前边界
- 如果节点池本身太差，BHS 可能只能停在较低但可信的高度
- 这时需要扩充更干净的节点池，而不是放宽校验
- 当前 v1 默认跟随 market bootstrap；如需独立运行，可单独设置 `BSV_BHS_CHECKPOINT_*`
