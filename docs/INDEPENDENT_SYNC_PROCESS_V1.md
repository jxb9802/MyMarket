# Independent Sync Process V1

## 结论

可以保留当前主进程，让独立同步进程负责链同步，主进程只消费同步结果。

但要区分两类数据：

1. 市场链同步数据
2. 钱包 UTXO / 本地可花余额索引

如果主进程不再自己参与历史同步，只靠读取同步结果，那么主进程**不能凭空推导出全历史花费记录**。  
因此，想要主进程只读结果而仍然正确生成 UTXO，有两种方式：

1. 独立同步进程直接维护钱包本地索引（推荐最终形态）
2. 独立同步进程至少提供完整的钱包相关交易流输入，供主进程重建索引

## 当前代码现状

### 市场链同步

当前主进程中的链同步能力主要在：

- `server_market.js`
  - P2P headers / blocks 拉取
  - anchors 解析
  - `localHeight` / `fixedSyncLastHeight` / `p2pGapHeights`
  - 结果写入 `state.json`

### 钱包 UTXO 索引

当前钱包 UTXO 主要在：

- `wallet.js`
  - `SPV_INDEX_FILE = data/spv_index.json`
  - `ingestTxIntoSpvIndex(...)`
  - `upsertUtxoToSpvIndex(...)`
  - `listSpendableUtxosForState(...)`
  - `getLocalIndexStats()`

这说明当前“可花 UTXO”不是从 market anchors 直接算出来的，而是从钱包本地 SPV 交易索引算出来的。

## 关键判断

### 主进程只读同步结果时，为什么不能单独正确生成 UTXO

因为 UTXO 索引需要知道：

- 哪些交易属于自己
- 每笔交易花掉了哪些历史 outpoint
- 哪些输出又回到了自己的地址

也就是说，UTXO 生成依赖的是**完整交易流**，不是单纯的同步高度。

如果主进程只有：

- `localHeight`
- `anchors`
- 若干同步状态

而没有完整钱包相关交易输入，那么它并不知道全历史花费关系，自然不能可靠生成 UTXO。

## 推荐拆分方案

### 第一阶段

保留主进程，独立同步进程先只接管：

- P2P block sync
- anchors 解析
- `state.sync` 高度推进
- 相关 receipt / gap / cache 文件

主进程继续负责：

- `spv_index.json`
- 钱包余额
- 可花 UTXO
- 发送 / 签名 / 本地交易回放

### 第二阶段

等独立同步进程稳定后，再把这些逐步迁过去：

- 钱包相关交易 ingest
- `spv_index.json` 维护
- confirmed / spent / ancestorDepth 更新
- wallet local index stats

### 最终形态

独立同步进程负责：

- 链同步
- 钱包交易索引
- UTXO 索引

主进程只读：

- `state.json`
- `spv_index.json`
- 同步进程生成的快照 / 状态文件

## 当前最稳的执行顺序

1. 继续增强独立同步进程，使其先稳定接管链同步
2. 保持主进程继续读写 `spv_index.json`
3. 等独立同步进程稳定后，再迁 UTXO 索引

## 单实例同步补充规则

独立同步进程最终应收敛为：

- 系统内始终只有一个常驻 `Sync Service` 实例
- 外部模块不再通过“再起一个同步任务”来触发同步
- 只通过更新控制状态来切换：
  - `resume`
  - `rebuild`
  - `stop`
  - `epoch`
  - `startHeight`

### 新同步发起时的冲突处理

当用户发起新同步时，可能仍有旧节点在处理旧 generation 的块。

这里不能简单地：

- 无限等待旧节点全部结束
- 也不能允许旧结果继续提交

应采用：

1. 立即切换到新 epoch / generation
2. 旧 generation 不再分配新任务
3. 旧结果返回时按 epoch 校验，过期结果直接丢弃
4. 给旧 lease 一个很短的 `drain` 窗口自然收尾
5. 如果当前可用节点不足，允许同步服务主动补充新的节点 lease

### 目的

- 防止旧同步污染新同步
- 防止新同步因为老节点都在忙而长时间卡住
- 在旧节点忙时，通过补充新节点提高首次窗口启动速度

## 补充

当前项目里确实存在多个模块同时连接 P2P 节点：

- `wallet.js`
  - 常驻 SPV peer 池
  - probe / rebalance
  - mempool / tx listener
- `server_market.js`
  - header sync
  - block sync
  - quickstart / frontier fetch
- `block_headers_service.js`
  - 独立 BHS headers 拉取
- `scripts/test_frontier_selector_sync.js`
  - 独立测试同步脚本

因此，如果继续推进独立同步进程方案，后续需要把“节点连接职责”也逐步收口，避免多个模块同时争用同一批公网节点。
