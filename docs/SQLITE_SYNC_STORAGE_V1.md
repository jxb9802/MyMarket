# SQLITE_SYNC_STORAGE_V1

## 目标

- 把链同步主数据从大 JSON 文件迁移到 SQLite。
- 保留原始 `anchor_events`，供审计、修复、重放使用。
- `rawtx` 不作为主数据库热数据，改为外部文件存储。
- 区块下载后立刻按事件类型分类写入，不再依赖全量 `anchors` 重建业务状态。
- `products/categories` 等业务表只保留当前有效态，后续事件覆盖旧值。
- 本次切换后直接重同步，不做旧 JSON 数据迁移。
- 继续支持用户“一键运行批处理即可安装和使用”。

## 已确认约束

1. 原始层保留 `anchor_events`，`rawtx` 可外存。
2. 直接切 SQLite，不做长期双写。
3. `products/categories` 只保留当前有效态。
4. 历史全量回放只保留给迁移/修复工具。
5. 各模块允许写，但必须走统一加锁写入模块。
6. `market.db` 固定放在项目 `data/` 目录。
7. 不考虑旧数据迁移，改完后重新同步。
8. 允许使用原生 Node 模块。

## 非目标

- 不在第一阶段把钱包 UTXO / SPV 全部迁入 SQLite。
- 不在第一阶段长期保留完整 block 原文。
- 不在第一阶段支持多个独立进程自由直写同一批业务表。

补充：
- `wallet tx contexts` 现已纳入 SQLite 范围，替代原 `tx_contexts.json`。
- 这部分只迁 `tx_contexts`，不在本轮把全部钱包索引表一次性搬入 SQLite。
- 当前这套 SQLite 主存储 + `BMMKT2` + 流式同步状态，后续在迁移管理里定义为 `Data Version 1` 基线。

## 总体结构

采用“两层存储 + 一条增量处理链”：

1. 原始层
- 保存链上解析得到的 `anchor_events`
- 保存必要的 block / tx 元信息
- 保留 `rawtx` 文件路径引用

2. 索引层
- 保存业务当前态
- API 与页面优先读索引层
- 不再从全量历史 `anchors` 推导页面状态

3. 增量处理链
- 下载区块
- 解析交易 / 事件
- 在同一事务内写入原始表
- 立即按事件类型分流更新索引表
- 提交事务

## 文件布局

### SQLite 主库

- `data/market.db`

### SQLite 运行默认

- journal mode: `WAL`
- 单写连接，由独立写服务持有
- `busy_timeout=5000`
- `synchronous=NORMAL`
- checkpoint 先保持默认自动行为，必要时再补人工 checkpoint 策略

### rawtx 外部文件

- `data/rawtx/pending/<requestId>-<txid>.rawtx`
- `data/rawtx/YYYY-MM/DD/<txid>.rawtx`

说明：

- 按日期分目录，避免单目录文件过多。
- SQLite 只保存 `txid` 与 `file_path`。
- 默认保留原始 hex 文本。
- 后续如需节省空间，可加 gzip，但 V1 先不引入。
- V1 采用“先写文件，再写库”：
  - 先落到 `pending/`
  - 数据库事务成功后再 rename 到正式路径
  - 若数据库写失败，则允许留下 pending 文件，交给启动清理逻辑处理

## 数据库表设计

### 1. `schema_meta`

用途：
- 保存 schema 版本、迁移标记、重建状态。

字段：
- `key TEXT PRIMARY KEY`
- `value TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

推荐键：
- `schema_version`
- `sync_bootstrap_height`
- `last_rebuild_started_at`
- `last_rebuild_finished_at`

### 2. `sync_state`

用途：
- 保存链同步当前状态，替代 `state.sync` 的主持久化职责。

字段：
- `scope TEXT PRIMARY KEY`
- `bootstrap_height INTEGER NOT NULL`
- `local_height INTEGER NOT NULL`
- `network_height INTEGER NOT NULL`
- `fixed_sync_last_height INTEGER NOT NULL`
- `p2p_tip_height INTEGER NOT NULL`
- `p2p_tip_hash TEXT NOT NULL DEFAULT ''`
- `p2p_header_cursor_height INTEGER NOT NULL`
- `p2p_header_cursor_hash TEXT NOT NULL DEFAULT ''`
- `online INTEGER NOT NULL DEFAULT 0`
- `mode TEXT NOT NULL DEFAULT ''`
- `lag INTEGER NOT NULL DEFAULT 0`
- `session_epoch INTEGER NOT NULL DEFAULT 0`
- `updated_at TEXT NOT NULL`

说明：
- `scope` V1 固定用 `'main'`
- 便于后续扩展多钱包/多视图

### 3. `blocks`

用途：
- 保存已处理区块的最小元信息，不保存完整 block 原文。

字段：
- `height INTEGER NOT NULL`
- `block_hash TEXT NOT NULL`
- `prev_hash TEXT NOT NULL DEFAULT ''`
- `tx_count INTEGER NOT NULL DEFAULT 0`
- `source_node TEXT NOT NULL DEFAULT ''`
- `seen_at TEXT NOT NULL`
- `PRIMARY KEY (height, block_hash)`

索引：
- `CREATE INDEX idx_blocks_hash ON blocks(block_hash);`

### 4. `tx_store`

用途：
- 保存交易与 rawtx 文件引用。

字段：
- `txid TEXT PRIMARY KEY`
- `block_height INTEGER`
- `block_hash TEXT NOT NULL DEFAULT ''`
- `tx_index INTEGER NOT NULL DEFAULT 0`
- `rawtx_path TEXT NOT NULL DEFAULT ''`
- `stored_at TEXT NOT NULL`

索引：
- `CREATE INDEX idx_tx_store_height ON tx_store(block_height);`

说明：
- V1 不把 `rawtx` 大文本直接塞进 SQLite。
- 若某 tx 不需要保留 rawtx，则 `rawtx_path=''`。

### 5. `anchor_events`

用途：
- 作为原始业务事件事实表。

字段：
- `event_id INTEGER PRIMARY KEY AUTOINCREMENT`
- `txid TEXT NOT NULL`
- `block_height INTEGER NOT NULL DEFAULT 0`
- `block_hash TEXT NOT NULL DEFAULT ''`
- `event_index INTEGER NOT NULL DEFAULT 0`
- `event_type TEXT NOT NULL`
- `merchant_id TEXT NOT NULL DEFAULT ''`
- `entity_id TEXT NOT NULL DEFAULT ''`
- `wallet_id TEXT NOT NULL DEFAULT ''`
- `ts TEXT NOT NULL`
- `confirmed INTEGER NOT NULL DEFAULT 1`
- `source_node TEXT NOT NULL DEFAULT ''`
- `payload_json TEXT NOT NULL`
- `payload_hash TEXT NOT NULL`
- `dedupe_key TEXT NOT NULL`
- `inserted_at TEXT NOT NULL`

索引：
- `CREATE UNIQUE INDEX idx_anchor_events_dedupe ON anchor_events(dedupe_key);`
- `CREATE INDEX idx_anchor_events_type_height ON anchor_events(event_type, block_height);`
- `CREATE INDEX idx_anchor_events_merchant_type ON anchor_events(merchant_id, event_type);`
- `CREATE INDEX idx_anchor_events_wallet_type ON anchor_events(wallet_id, event_type);`
- `CREATE INDEX idx_anchor_events_txid ON anchor_events(txid);`

说明：
- 原始事件保留历史，不做业务态折叠。
- `dedupe_key` 用于防止同一区块/同一交易重复 ingest。

### 6. `categories`

用途：
- 保存分类当前有效态。

字段：
- `category_id TEXT PRIMARY KEY`
- `merchant_id TEXT NOT NULL`
- `name TEXT NOT NULL DEFAULT ''`
- `status TEXT NOT NULL DEFAULT 'active'`
- `updated_at TEXT NOT NULL`
- `last_event_id INTEGER NOT NULL`
- `last_txid TEXT NOT NULL DEFAULT ''`

索引：
- `CREATE INDEX idx_categories_merchant ON categories(merchant_id);`

规则：
- `category_add` 插入或覆盖。
- `category_edit` 更新。
- `category_delete` 不删原始事件，只把 `status='deleted'`。

### 7. `products`

用途：
- 保存商品当前有效态。

字段：
- `product_id TEXT PRIMARY KEY`
- `merchant_id TEXT NOT NULL`
- `category_id TEXT NOT NULL DEFAULT ''`
- `title TEXT NOT NULL DEFAULT ''`
- `description TEXT NOT NULL DEFAULT ''`
- `image_url TEXT NOT NULL DEFAULT ''`
- `price INTEGER NOT NULL DEFAULT 0`
- `stock INTEGER NOT NULL DEFAULT 0`
- `sold_count INTEGER NOT NULL DEFAULT 0`
- `status TEXT NOT NULL DEFAULT 'active'`
- `updated_at TEXT NOT NULL`
- `last_event_id INTEGER NOT NULL`
- `last_txid TEXT NOT NULL DEFAULT ''`

索引：
- `CREATE INDEX idx_products_merchant ON products(merchant_id);`
- `CREATE INDEX idx_products_category ON products(category_id);`

规则：
- `product_add` 插入或覆盖。
- `product_edit` 更新。
- `product_delete` 标记 `status='deleted'`。

### 8. `profiles`

用途：
- 保存商家/钱包资料当前态。

字段：
- `profile_key TEXT PRIMARY KEY`
- `merchant_id TEXT NOT NULL DEFAULT ''`
- `wallet_id TEXT NOT NULL DEFAULT ''`
- `name TEXT NOT NULL DEFAULT ''`
- `payload_json TEXT NOT NULL DEFAULT '{}'`
- `updated_at TEXT NOT NULL`
- `last_event_id INTEGER NOT NULL`

说明：

### 9. `tx_contexts`

用途：
- 保存钱包 strict BEEF / 本地广播链所需的 tx 上下文。

字段：
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

规则：
- `rawtx_hex` 完整保留。
- `proof_hex` 直接存 SQLite，不另走文件。
- V1 只按 `txid` 查询，不先拆 `tx_context_inputs`。
- `tx_contexts.json` 删除，不导入旧数据，切换后直接重同步。
- `profile_key` 推荐取 `merchant_id`，没有则退化为 `wallet_id`

### 9. `wallet_key_binds`

用途：
- 保存聊天公钥绑定当前态。

字段：
- `wallet_id TEXT PRIMARY KEY`
- `merchant_id TEXT NOT NULL DEFAULT ''`
- `chat_pub_key TEXT NOT NULL DEFAULT ''`
- `endpoint_hints_json TEXT NOT NULL DEFAULT '[]'`
- `relay_hints_json TEXT NOT NULL DEFAULT '[]'`
- `signature_ok INTEGER NOT NULL DEFAULT 0`
- `updated_at TEXT NOT NULL`
- `last_event_id INTEGER NOT NULL`
- `last_txid TEXT NOT NULL DEFAULT ''`

索引：
- `CREATE INDEX idx_wallet_key_binds_merchant ON wallet_key_binds(merchant_id);`
- `CREATE INDEX idx_wallet_key_binds_chat_pub_key ON wallet_key_binds(chat_pub_key);`

### 10. `chat_threads`

用途：
- 保存聊天线程当前态。

字段：
- `thread_id TEXT PRIMARY KEY`
- `self_wallet_id TEXT NOT NULL`
- `peer_wallet_id TEXT NOT NULL`
- `merchant_id TEXT NOT NULL DEFAULT ''`
- `display_name TEXT NOT NULL DEFAULT ''`
- `last_message_at TEXT NOT NULL DEFAULT ''`
- `last_message_id TEXT NOT NULL DEFAULT ''`
- `unread_count INTEGER NOT NULL DEFAULT 0`
- `updated_at TEXT NOT NULL`

索引：
- `CREATE INDEX idx_chat_threads_self ON chat_threads(self_wallet_id);`
- `CREATE INDEX idx_chat_threads_peer ON chat_threads(peer_wallet_id);`

### 11. `chat_messages`

用途：
- 保存聊天消息当前可读索引。

字段：
- `msg_id TEXT PRIMARY KEY`
- `txid TEXT NOT NULL DEFAULT ''`
- `thread_id TEXT NOT NULL`
- `from_wallet_id TEXT NOT NULL DEFAULT ''`
- `to_wallet_id TEXT NOT NULL DEFAULT ''`
- `direction TEXT NOT NULL DEFAULT ''`
- `transport TEXT NOT NULL DEFAULT ''`
- `text TEXT NOT NULL DEFAULT ''`
- `ciphertext TEXT NOT NULL DEFAULT ''`
- `nonce TEXT NOT NULL DEFAULT ''`
- `auth_tag TEXT NOT NULL DEFAULT ''`
- `status TEXT NOT NULL DEFAULT ''`
- `ts TEXT NOT NULL`
- `confirmed INTEGER NOT NULL DEFAULT 0`
- `fee_sat INTEGER NOT NULL DEFAULT 0`
- `updated_at TEXT NOT NULL`

索引：
- `CREATE INDEX idx_chat_messages_thread_ts ON chat_messages(thread_id, ts);`
- `CREATE INDEX idx_chat_messages_txid ON chat_messages(txid);`

## `dedupe_key` 规则

V1 建议：

- `sha256(txid + '|' + event_index + '|' + event_type + '|' + entity_id + '|' + payload_hash)`

说明：
- 同一笔交易里不同事件要能区分。
- 不把“当前态”逻辑压到事实表。
- 事实表只去掉真正重复 ingest。

## 写入模块

新增统一写入层：

- `market_db.js`
- `market_db_writer.js`

职责：

1. `market_db.js`
- 提供只读查询接口
- 提供向写服务发送请求的客户端封装
- 维护 request/response 关联、超时、错误码转换

2. `market_db_writer.js`
- 由主进程启动并保活
- 独占持有 SQLite 写连接
- 创建 schema
- 顺序执行事务写入
- 回传“已成功写入 / 写入失败 / 超时”

### 强制规则

- 业务代码不得直接持有 SQLite 写连接
- 所有写入只能通过 `market_db.js` -> `market_db_writer.js`
- 所有“原始事件 + 当前态更新”必须在同一事务内提交
- 数据库层不负责业务补偿、回滚编排、事件顺序判定、读写一致性判断

## 单写服务策略

### 目标

- 允许多个模块发起写请求
- 但实际写入必须串行化
- 防止 SQLite 写锁冲突
- 把数据库写入边界收敛到单一进程

### V1 方案

采用主进程子进程写服务：

1. 主进程启动时 `fork('market_db_writer.js')`
2. 写服务随主进程一起启动
3. 写服务异常退出时由主进程自动重启
4. 所有模块通过进程 IPC 发写请求
5. 写服务内部串行消费请求队列
6. 数据库层只返回请求是否成功写入，不负责模块级补偿

### IPC 默认协议

V1 默认使用 `child_process.fork()` 自带 IPC。

请求消息：

- `requestId: string`
- `action: string`
- `payload: object`
- `timeoutMs: number`

响应消息：

- `requestId: string`
- `ok: boolean`
- `code: string`
- `data: object | null`
- `error: string`

默认动作建议：

- `init_schema`
- `ingest_block_batch`
- `upsert_sync_state`
- `write_tx_store`
- `health_check`

说明：

- IPC 选择优先考虑实现简单、跨平台和恢复成本，不单独引入本地 socket。
- 业务方必须自带 `requestId`，以便重试、超时和日志定位。
- 大 payload 在 V1 仍走 IPC；如后续出现瓶颈，再考虑分离大对象落盘后只传文件引用。

### 事务规则

- 单个 block ingest 使用单事务
- 同一批事件的原始写入与索引更新必须同事务
- 禁止“原始表已写，业务表未写”的半成状态
- 文件预写不属于 SQLite 事务的一部分
- 数据库层只保证已进入事务的数据原子提交，不保证文件与数据库跨介质原子一致

## 同步处理流程

### 当前问题

当前流程接近：

1. 下载区块
2. 解析为 anchors
3. 堆进 `state.json`
4. 后续由 `rebuildCatalogFromAnchors` / `refreshChatArtifacts` 等全量扫描历史

这会导致：

- 历史数据越大越慢
- chat 为了处理 3 条消息被迫扫 8000+ 条事件
- JSON 全量读写越来越重

### 新流程

1. 下载区块
2. 解析交易
3. 解析出业务事件
4. 业务模块先把 `rawtx` 写入 `data/rawtx/pending/`
5. 通过 `market_db.js` 发 IPC 请求到写服务
6. 写服务开启事务
7. 写 `blocks`
8. 写 `tx_store` 与正式 rawtx 文件引用
9. 写 `anchor_events`
10. 事件分流更新：
- `category_*` -> `categories`
- `product_*` -> `products`
- `profile_*` -> `profiles`
- `wallet_key_bind` -> `wallet_key_binds`
- `chat_message` -> `chat_messages` / `chat_threads`
- 同步高度 -> `sync_state`
11. 提交事务成功后 rename pending rawtx 到正式路径
12. 更新轻量运行态缓存

失败语义：

- 若文件写失败，则业务模块不得发起数据库写请求
- 若数据库写失败，则本次请求返回失败，由调用模块决定重试或补偿
- 若数据库已返回成功，则视为写入完成；后续模块不得假设数据库层会再做回滚
- 若 pending rename 失败，必须按错误上报并记录待清理文件

## 事件分流规则

### category

- `category_add`: upsert 当前态
- `category_edit`: 更新字段
- `category_delete`: `status='deleted'`

### product

- `product_add`: upsert 当前态
- `product_edit`: 更新字段
- `product_delete`: `status='deleted'`

### profile

- `profile_set`: 覆盖当前 profile 当前态

### wallet key bind

- 先做签名校验
- 再 upsert 到 `wallet_key_binds`

### chat

- chat 只处理 `wallet_key_bind` / `chat_message`
- 不再扫描商品和分类事件
- 线程状态由消息增量更新

## 读取路径调整

### `/api/state`

改为优先读：

- `sync_state`
- `categories`
- `products`
- `profiles`
- `chat_threads` / `chat_messages`
- 少量 session / runtime 覆盖字段

不再依赖：

- `loadState()` 全量加载
- `refreshChatArtifacts()` 全量回放
- `rebuildCatalogFromAnchors()` 全量重建

### `/api/sync/status`

继续保持 snapshot-only 思路，但数据源切到：

- SQLite `sync_state`
- 轻量 heartbeat / worker 状态文件

### chat 读取

直接查询：

- `wallet_key_binds`
- `chat_threads`
- `chat_messages`

线上主路径不再全量回放聊天历史。

## 旧 JSON 文件的处理

### 单一真相源规则

- 能迁入 SQLite 的字段就迁入 SQLite
- 迁入后必须从原 JSON 文件删除对应字段
- 不能迁移的 runtime/session 字段才允许继续留在 `state.json`
- 同一字段不得同时在 SQLite 和 JSON 中各维护一份

### 文件边界

1. SQLite 主持久化：
- `sync_state`
- `anchor_events`
- `products`
- `categories`
- `profiles`
- `wallet_key_binds`
- `chat_threads`
- `chat_messages`
- `tx_store`

2. 文件继续保留：
- 纯 runtime/session 临时态
- worker heartbeat / job 状态快照
- rawtx 实体文件

3. 废弃方向：
- `anchors_global.json` 停止参与在线业务主路径
- 旧 `state.json` 里已迁移的业务字段全部删除

## 重同步策略

本次改造后不做旧数据迁移，直接重同步：

1. 停服务
2. 备份旧 `data/`
3. 删除旧 `market.db`、旧 rawtx 存储目录
4. 初始化 SQLite schema
5. 把同步起点重置到 `bootstrapHeight - 1`
6. 从固定高度重新同步
7. 新数据只写 SQLite + rawtx 文件

服务策略：

- 重同步期间允许对外服务
- 读写一致性窗口由调用模块自行判断
- 数据库层不额外阻断写请求，也不负责业务级可见性控制

## 启动恢复与清理

### 写服务启动恢复

- 主进程启动后立即拉起 `market_db_writer.js`
- 写服务启动时先执行 schema 检查
- 写服务启动时写入健康信息

推荐至少记录到 `schema_meta`：

- `schema_version`
- `writer_started_at`
- `writer_pid`
- `last_health_at`

### rawtx pending 清理

- 写服务启动时扫描 `data/rawtx/pending/`
- 超过阈值时间的遗留 pending 文件直接删除或转移到隔离目录
- 清理策略只处理 pending 文件，不处理正式目录文件

### 数据库层恢复边界

- 不负责推断业务级补偿
- 不负责重排事件顺序
- 不负责重建读侧一致性
- 只负责把“数据库可写、schema 正常、pending 目录已做基础清理”建立起来

## 回放 / 修复工具

保留离线工具，不再作为线上主路径：

- `scripts/rebuild_sqlite_from_anchor_events.js`
- `scripts/rebuild_chat_indexes.js`
- `scripts/rebuild_catalog_indexes.js`

用途：

- 修库
- 调试
- 索引重建
- 校验一致性

## 安装与部署

### Node 依赖

V1 推荐使用原生模块：

- `better-sqlite3`

原因：

- 本地单机性能更稳
- 同步写事务更直接
- 代码复杂度低

### 一键运行要求

用户仍然只需要运行批处理/启动脚本：

1. 检查 `node_modules`
2. 如缺依赖则执行安装
3. 检查 `data/market.db`
4. 如不存在则自动建库建表
5. 启动服务

### Windows 注意点

- `market.db` 必须放项目自身 `data/` 中
- 不额外引入独立数据库服务
- 若项目位于共享目录，V1 默认仍按用户要求放在该目录 `data/market.db`
- 但需要额外观察共享目录文件锁表现

## 风险点

1. 写路径改造面较大
- 同步 ingest、商品读取、chat 读取都会受影响

2. 多模块写库如果绕过统一层，会重新引入锁冲突

3. Windows 共享目录上的 SQLite 文件锁表现需要实测

4. 切换阶段若仍保留旧 JSON 读取，很容易产生双源不一致

## 实施顺序

### Phase 1: 基础设施

1. 新增 `market_db.js`
2. 建立 SQLite schema
3. 增加 rawtx 文件存储模块
4. 增加统一写锁与事务包装

### Phase 2: 同步写入链路

1. 区块解析后直接写 `blocks` / `tx_store` / `anchor_events`
2. 同事务内更新 `products/categories/profiles/chat/sync_state`
3. 停止把业务主数据写回大 JSON

### Phase 3: 读取路径切换

1. `/api/sync/status` 读 SQLite
2. `/api/state` 读 SQLite
3. chat 页面/API 读 SQLite
4. catalog 页面/API 读 SQLite

### Phase 4: 清理旧路径

1. 废弃 `refreshChatArtifacts()` 线上主路径职责
2. 废弃 `rebuildCatalogFromAnchors()` 线上主路径职责
3. 把全量回放函数收口到 repair 工具

## 验收标准

1. 同步过程中不再因全量扫描 `anchors` 导致主进程 100% CPU。
2. chat 读取不再扫描所有商品/分类历史事件。
3. `/api/state` 与 `/api/sync/status` 在同步期能稳定快速返回。
4. `products/categories` 当前态与链上最终事件一致。
5. `anchor_events` 可用于离线重建索引。
6. rawtx 可按 `txid` 找回原始文件。
7. 用户仍可通过单个启动脚本完成安装与运行。

## 对现有热点问题的直接修复意义

当前 Linux 热点已经证明：

- `refreshChatArtifacts()` 为了处理极少量 chat 事件，全量扫描了 8000+ 条历史 anchors
- 其中绝大部分其实是 `product_add/category_add`

SQLite 改造后的核心收益就是：

- chat 只读 chat 自己的索引表
- 商品只读商品自己的索引表
- 原始历史仍保留，但不再被每次页面请求全量扫描
