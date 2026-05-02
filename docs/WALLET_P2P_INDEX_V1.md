# 钱包 P2P 扫块与本地索引设计 V1

## 背景
- 当前钱包“发送前检查”与“钱包全量重建同步”耦合过深。
- 当前钱包重建依赖 WOC 地址查询：
  - `confirmed/unspent`
  - `confirmed/history`
- 这会导致：
  - 同步慢，用户感知像死机。
  - 发送关键路径依赖中心化 HTTP 服务。
  - strict BEEF 与 SPV 的边界越来越模糊，系统越来越重。

## 本设计的目标
- 去掉“钱包发送前检查必须依赖 WOC 全量重建”的现状。
- 将钱包索引与系统固定高度同步合并为一条本地增量流水线。
- 取消独立“钱包同步”入口，日常只保留统一的“区块同步”。
- 保持 strict BEEF 所需的本地上下文能力，但只围绕“会花到的链”维护。
- 让用户看到的是：
  - 首次冷启动可接受地慢
  - 后续日常同步快
  - 发送前检查轻量、稳定、可解释

## 已确认的架构约束
### 约束 1：系统同步有固定起始高度
- 市场系统本身已经从一个固定高度开始同步。
- 不需要从创世块开始做钱包发现。

### 约束 2：钱包地址只在该固定高度之后使用
- 系统内钱包地址一定是在固定起始高度之后开始使用。
- 本设计不需要支持“固定高度之前就已持币的旧地址历史”。

### 约束 3：钱包可用地址窗口固定且有限
- 当前可明确按“前 20 个地址”作为受支持钱包地址窗口。
- 本地索引与交易匹配只需要处理这组地址。

### 约束 4：发送规则仍要求 strict BEEF
- 普通“能花”不够。
- 对需要发送的 UTXO，本地必须能拿到足够的祖先上下文以构造 strict BEEF。

### 约束 5：发送成功后应按新状态续用资格
- 发送成功后不是粗暴失效。
- 必须按新的本地 UTXO / 上下文状态重新评估是否仍可继续发送。

### 约束 6：WOC 不应继续处于发送关键路径
- WOC 最多只能作为调试、修复、fallback。
- 常规钱包同步、发送前检查、上下文维护不应依赖 WOC。

### 约束 7：不再保留独立钱包同步
- 日常只有“区块同步”。
- 区块同步推进时，必须同时完成钱包 UTXO、钱包交易、BEEF 上下文的本地索引更新。
- 不再要求用户在区块同步后额外点击“钱包同步”。

### 约束 8：导入钱包单独走初始化路径
- 新生成钱包、系统内钱包走统一的区块同步索引路径。
- 外部导入钱包允许使用 WOC 做一次初始化建档。
- 初始化完成后，导入钱包也必须回到本地增量索引体系，不再走常规 WOC 同步。

## 非目标
- 不支持固定起始高度之前的旧钱包全历史恢复。
- 不做任意地址窗口自动扩展。
- 不在 V1 中追求“任意外部钱包导入即完全自动发现所有旧资产”。
- 不保留常规 `wallet/sync` 重建入口。

## 设计总览
将“系统同步”与“钱包索引同步”合并为一条流水线，并把重型执行从主进程迁到后台管家：

1. 从固定起始高度同步区块头与区块。
2. 扫描每个区块里的交易。
3. 对照本地支持的 20 个地址，提取与钱包相关的交易。
4. 写入本地钱包索引数据库：
   - 交易表
   - UTXO 表
   - outpoint 花费关系
   - 上下文表
5. 对“未来可能会花到的链”同步沉淀上下文 tx，供 strict BEEF 使用。
6. 更新发送资格快照，发送前检查只查本地钱包索引，不再触发全量钱包重建。

## 运行时职责划分
### 主进程
- 提供 HTTP API。
- 读取状态表并返回给前端。
- 写入同步命令、导入命令、重建命令。
- 不直接执行区块扫描、钱包索引、上下文补全等重任务。

### 后台管家线程
- 执行区块同步。
- 执行钱包相关交易提取。
- 执行 UTXO / tx / context 本地索引更新。
- 执行区块监控与增量回放。
- 更新任务状态表和钱包状态表。

### 状态沟通原则
- 主进程通过 `command_queue` 下达命令。
- 管家线程通过 `job_state`、`chain_state`、`wallet_state` 回写进度。
- 执行中的任务状态只允许对应管家线程写入，主进程只读。

## 命令与状态模型
### `command_queue`
- 用途：主进程向管家线程发命令。
- 字段：
  - `id`
  - `commandType`
    - `run_chain_sync`
    - `rebuild_chain_indexes`
    - `import_wallet_bootstrap`
  - `payload`
  - `status`
    - `pending`
    - `claimed`
    - `done`
    - `failed`
  - `createdAt`
  - `claimedAt`
  - `finishedAt`

### `job_state`
- 用途：向主进程和前端暴露当前后台任务进度。
- 字段：
  - `jobId`
  - `jobType`
  - `status`
  - `stage`
  - `progressCurrent`
  - `progressTotal`
  - `lastError`
  - `startedAt`
  - `updatedAt`

### `wallet_state`
- 用途：记录当前钱包索引快照。
- 字段：
  - `walletKey`
  - `walletScanCursorHeight`
  - `walletRelevantTxCount`
  - `walletUtxoCount`
  - `contextReadyCount`
  - `sendPreflightStatus`
  - `lastIndexedAt`

## 数据模型
### 1. `wallet_address_window`
- 用途：定义当前钱包支持的地址集合。
- 字段：
  - `walletKey`
  - `pathBase`
  - `addressIndex`
  - `address`
  - `active`

### 2. `wallet_tx_index`
- 用途：记录与本钱包相关的交易。
- 字段：
  - `txid`
  - `height`
  - `blockHash`
  - `confirmed`
  - `firstSeenAt`
  - `lastSeenAt`
  - `rawtx`
  - `relevance`
    - `credit`
    - `debit`
    - `self_transfer`
    - `context_only`

### 3. `wallet_utxo_index`
- 用途：记录本钱包当前可见 UTXO。
- 字段：
  - `txid`
  - `vout`
  - `address`
  - `satoshis`
  - `height`
  - `confirmed`
  - `spentByTxid`
  - `spentAtHeight`
  - `ancestorDepth`
  - `contextReady`

### 4. `wallet_outpoint_spend_index`
- 用途：记录某个输入花掉了哪个 outpoint。
- 字段：
  - `prevTxid`
  - `prevVout`
  - `spendTxid`
  - `spendHeight`
  - `confirmed`

### 5. `wallet_tx_context_index`
- 用途：记录 strict BEEF 所需上下文。
- 字段：
  - `txid`
  - `rawtx`
  - `height`
  - `confirmed`
  - `parents`
  - `children`
  - `contextSource`
    - `p2p_block_scan`
    - `local_send`
    - `fallback_import`

## 已拍板的 `tx_contexts` SQLite 落地方案

### 目标
- 彻底移除 `data/tx_contexts.json` 作为主持久化。
- `tx_contexts` 改为 SQLite 唯一真相源。
- 主查询路径固定为“按 `txid` 查”，不再支持全量读入整个上下文仓库作为主路径。
- 改完后直接从头重新同步一次，不做旧 `tx_contexts.json` 导入。

### 表设计

V1 先使用单表，不先拆 `tx_context_inputs`：

- `tx_contexts`
  - `txid TEXT PRIMARY KEY`
  - `rawtx_hex TEXT NOT NULL DEFAULT ''`
  - `input_txids_json TEXT NOT NULL DEFAULT '[]'`
  - `source TEXT NOT NULL DEFAULT ''`
  - `kind TEXT NOT NULL DEFAULT ''`
  - `confirmed INTEGER NOT NULL DEFAULT 0`
  - `proof_type TEXT NOT NULL DEFAULT ''`
  - `proof_source TEXT NOT NULL DEFAULT ''`
  - `proof_hex TEXT NOT NULL DEFAULT ''`
  - `proof_encoding TEXT NOT NULL DEFAULT ''`
  - `proof_verified INTEGER NOT NULL DEFAULT 0`
  - `proof_verified_at TEXT`
  - `proof_block_height INTEGER`
  - `proof_block_hash TEXT NOT NULL DEFAULT ''`
  - `proof_merkle_root TEXT NOT NULL DEFAULT ''`
  - `first_seen_at TEXT NOT NULL`
  - `last_seen_at TEXT NOT NULL`
  - `updated_at TEXT NOT NULL`

索引：
- `CREATE INDEX idx_tx_contexts_confirmed ON tx_contexts(confirmed, last_seen_at);`

### 为什么 V1 不先拆两张表
- 当前主路径是按 `txid` 读取上下文。
- 目前没有高频“按某个 parent/input txid 反查子交易集合”的查询。
- 因此先拆 `tx_context_inputs` 不会直接提升当前主瓶颈，反而会扩大改动面。
- 如果后续确认存在高频 input 反查，再在 V2 增补从表和索引。

### 行为约束
- `rawtx_hex` 必须完整保留。
- `proof_hex` 必须进入 SQLite。
- 写入先按单笔 tx 立即 upsert，不先做批量队列。
- 允许上层保留一个很小的内存 cache，但 cache 只作为读加速，不作为持久化。
- 删除 `tx_contexts.json` 主路径；旧文件不导入。

### 读写规则
- 写：
  - 新交易进入本地索引时，立即按 `txid` upsert `tx_contexts`
  - proof 回填、confirmed 标记都写回同一行
- 读：
  - `getTxContext(txid)`
  - `getTxContextsByTxids(txids[])`
  - 不再提供“读取整仓 JSON”作为常规路径

### 重置策略
- `clearWalletLocalIndex()` 需要同时清空 SQLite `tx_contexts`
- 然后从固定 bootstrap 高度重新同步
- 因为这是一次断代切换，所以不保留旧 `tx_contexts.json` 迁移兼容

## 同步流水线
### 阶段 A：头同步
- 继续使用现有 BHS / P2P 头同步。
- 输出：
  - `localHeight`
  - `networkHeight`
  - `cursorHeight`

### 阶段 B：区块交易扫描
- 从 `walletScanCursorHeight + 1` 到 `trustedTipHeight` 逐块推进。
- 对每个区块：
  - 读取交易列表
  - 遍历 outputs，判断是否命中 20 个地址
  - 遍历 inputs，判断是否花掉本地已有 UTXO

### 阶段 C：钱包索引更新
- 若 output 命中钱包地址：
  - 写入 `wallet_tx_index`
  - 新建 `wallet_utxo_index`
- 若 input 花掉本地 UTXO：
  - 更新 `wallet_utxo_index.spentByTxid`
  - 写入 `wallet_outpoint_spend_index`
  - 将 spend tx 自身写入 `wallet_tx_index`

### 阶段 D：上下文沉淀
- 对命中的 credit / debit / self_transfer 交易：
  - 将交易原文写入 `wallet_tx_context_index`
  - 将直接父交易关系写入 `parents`
- 原则：
  - 不追求一次性缓存“全钱包所有上下文”
  - 只保证“本钱包相关且未来会花到的链”上下文持续完整

### 阶段 E：提交同步进度
- 每轮提交：
  - `walletScanCursorHeight`
  - `walletUtxoCount`
  - `walletRelevantTxCount`
  - `contextReadyCount`
- 供前端同步弹窗逐项展示。

## 钱包类型分流
### 新生成钱包 / 系统内钱包
- 不走 WOC。
- 直接纳入区块同步增量索引。
- “区块同步完成”就意味着钱包索引也完成到同一高度。

### 外部导入钱包
- 允许走一次 `import_wallet_bootstrap`。
- 可使用 WOC 拉取：
  - 当前 UTXO
  - 历史交易
  - 必要上下文交易
- 写入本地：
  - `wallet_tx_index`
  - `wallet_utxo_index`
  - `wallet_tx_context_index`
- 初始化完成后回到统一的区块同步增量路径。

## 发送前检查
### 新规则
- 发送前检查不再调用 WOC 地址扫描。
- 仅依赖本地钱包索引。

### 需要检查的内容
1. 是否存在足够金额的可花 UTXO。
2. 候选 UTXO 是否未被本地已知交易花掉。
3. 候选 UTXO 的 `contextReady` 是否满足 strict BEEF。
4. 未确认链深是否在允许范围内。

### 输出状态
- `ready_confirmed_only`
- `ready_with_unconfirmed_chain`
- `blocked_need_sync`
- `blocked_need_beef_context`

## 发送成功后的本地更新
发送成功后立即执行本地写入，不等待全量同步：

1. 写入新交易到 `wallet_tx_index`
2. 标记输入 UTXO 已花费
3. 写入新找零 UTXO
4. 写入新交易 rawtx 到 `wallet_tx_context_index`
5. 重新计算：
   - `ancestorDepth`
   - `contextReady`
   - 发送资格状态

这样才能支持连续发送。

## 与 strict BEEF 的边界
strict BEEF 需要本地上下文完整，但这不等于每次发送前都重扫整个钱包。

正确做法是：
- 平时同步时持续积累本钱包相关上下文
- 发送时只检查“将要花的那条链”是否完整

这使得：
- strict BEEF 仍成立
- SPV 的轻量特征尽可能保留

## WOC 的新定位
V1 目标是让 WOC 退出常规关键路径。

### 保留为 fallback 的场景
- 导入钱包初始化建档
- 手工修复工具
- 调试按钮

### 不应再依赖 WOC 的场景
- 常规页面刷新
- 常规区块同步
- 常规发送前检查
- 发送成功后的资格续用判断

## 前端与接口调整
### 日常入口
- 只保留“同步”按钮。
- 该按钮触发 `run_chain_sync`。
- 区块同步过程中同时推进：
  - 商品数据同步
  - 聊天数据同步
  - 钱包 UTXO 索引
  - 钱包交易索引
  - BEEF 上下文索引

### 特殊入口
- 新增“导入钱包初始化”入口。
- 该入口触发 `import_wallet_bootstrap`。
- 初始化完成后不再显示独立“钱包同步”按钮。

## 前端同步体验建议
同步中应显示可勾选的步骤清单，而不是只有“同步中”。

建议步骤：
1. `同步区块头`
2. `扫描新增区块`
3. `同步商品与聊天数据`
4. `提取钱包相关交易`
5. `更新本地 UTXO`
6. `补全 strict BEEF 上下文`
7. `完成发送前检查`

每一步应显示：
- `pending`
- `running`
- `done`
- `failed`

## 迁移计划
### 第一步
- 保留现有 P2P 头同步。
- 建立 `command_queue`、`job_state`、`wallet_state`。
- 将区块同步执行权迁到管家线程。

### 第二步
- 将钱包相关交易提取并入现有区块扫描。
- 增加独立的 `walletScanCursorHeight`。
- 新建本地钱包索引表结构。

### 第三步
- 删除独立 `wallet/sync` 日常路径。
- 发送前检查改为本地索引判断。
- 发送成功后本地增量更新资格状态。

### 第四步
- 新增 `import_wallet_bootstrap`。
- 仅在导入钱包初始化时调用 WOC 生成本地钱包索引与上下文。

### 第五步
- 将 WOC 降级为导入初始化和手工修复模式。
- 前端只保留统一“同步”入口和“导入钱包初始化”入口。

## 验收标准
- 页面刷新不触发钱包全量重建。
- 常规区块同步不再调用 WOC 地址历史扫描。
- 同步完成后，发送资格仅依赖本地钱包索引。
- 发送成功后，可按本地新状态继续连续发送。
- strict BEEF 所需上下文可在同步期和发送后本地持续维护。
- 区块同步完成后，不再需要单独钱包同步。
- 导入钱包完成初始化后，后续增量同步不再依赖 WOC。
