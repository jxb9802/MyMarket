# DATA_MIGRATION_MANAGER_V1

## 目标

- 为项目增加启动期数据版本管理与自动迁移能力。
- 用户不需要手工删除旧文件、清理旧库、或参与升级步骤。
- 迁移失败时不允许继续启动，并且必须自动回滚到迁移前状态。
- 允许跨多个版本升级，但程序内部必须逐级执行迁移，保证逻辑一致。

## Data Version 1 基线定义

当前代码状态定义为：

- `Data Version 1`

`Data Version 1` 表示系统已经处于以下统一状态：

- SQLite 是主业务持久化真相源
- `market.db` 为主库
- `tx_contexts.json` 已退役，`tx_contexts` 进入 SQLite
- `anchors_global.json` 已退役
- `state.json` 不再持久化 `anchors`
- anchor 主真相源是 SQLite `anchor_events`
- 内存仅保留 `pendingAnchors` 作为未确认 overlay
- 业务协议只认 `BMMKT2`
- 区块下载路径已切到流式读取/解析

这意味着：

- 当前 Linux 工作目录已经可视为 `Data Version 1`
- Windows 目录上的旧工作副本，应在启动时自动升级到 `Data Version 1`

## 版本真相源

版本状态采用双源，但有主次：

1. SQLite `meta` 表为主
2. `data/runtime_version.json` 为 fallback

原因：

- 首次建库前，SQLite 还不存在，必须有文件级 fallback
- 建库后，SQLite `meta` 才是长期真相源

## 版本元信息

### SQLite `meta`

建议最少包含：

- `app_data_version`
- `migration_status`
- `last_migration_from`
- `last_migration_to`
- `last_migration_at`

### `data/runtime_version.json`

建议结构：

```json
{
  "app_data_version": 1,
  "migration_status": "ready",
  "last_migration_from": 0,
  "last_migration_to": 1,
  "last_migration_at": "2026-04-01T00:00:00.000Z",
  "current_step": "",
  "current_step_from": 0,
  "current_step_to": 0
}
```

允许值：

- `migration_status = ready`
- `migration_status = migrating`
- `migration_status = failed`

## 启动期迁移流程

启动顺序固定为：

1. 读取 `runtime_version.json`
2. 尝试读取 SQLite `meta`
3. 判定当前数据版本
4. 与代码内置 `CURRENT_DATA_VERSION` 比较
5. 若数据版本落后，则逐级执行迁移
6. 全部迁移成功后，才允许主服务继续启动
7. 任一迁移失败：
   - 立即停止启动
   - 自动回滚文件与版本元信息
   - 恢复到迁移前状态

## 升级规则

### 允许跳版本

允许：

- `v0 -> v2`
- `v0 -> v3`

但程序内部必须逐级执行：

- `v0 -> v1`
- `v1 -> v2`
- `v2 -> v3`

不允许写“跨多版本的一次性混合迁移”作为主路径。

## 回滚规则

迁移失败时：

1. 停止继续启动
2. 删除迁移过程中创建的新文件
3. 从迁移前备份恢复旧文件
4. 恢复 `runtime_version.json`
5. 若 SQLite `meta` 已改写，则也恢复旧状态
6. 写入失败日志并退出

迁移失败后，系统必须保持“和迁移前一致”，而不是半新半旧。

## 自动备份规则

每次迁移开始前，自动创建：

- `data/migration_backups/<timestamp>_vX_to_vY/`

备份内容：

- 将被修改或删除的运行态文件
- SQLite 文件
- 配置文件
- 版本元信息文件

备份用途：

- 迁移失败自动恢复
- 用户后续人工排查配置差异

## 保留与清理原则

### 默认保留

- 钱包/密钥文件
- 用户明确要求保留的配置

当前建议默认保留：

- `data/keystore.json`
- `data/wallet_state.json`
- `.env.market`

### 默认清理或重建

对“断代迁移”允许自动清理：

- `data/market.db`
- `data/market.db-wal`
- `data/market.db-shm`
- `data/state.json`
- `data/state.json.bak*`
- `data/tx_contexts.json`
- `data/anchors_global.json`
- `data/p2p_sync_receipts.json`
- `data/independent_sync_status.json`
- `data/wallet_index_state.json`
- `data/public_state_cache.json`
- `data/command_queue.json`
- `data/job_state.json`

## Version 0 -> Version 1

### 语义

`v0 -> v1` 定义为：

- 从旧 JSON / 旧兼容缓存 / 旧同步状态
- 自动进入当前 SQLite + `BMMKT2` + 流式同步体系

这是一次“断代迁移”，不是旧业务历史导入迁移。

### 自动执行内容

1. 创建迁移备份
2. 保留钱包/密钥/配置
3. 删除旧运行态与旧同步状态文件
4. 删除旧 SQLite 文件并重建 schema
5. 写入 `runtime_version.json`
6. 写入 SQLite `meta.app_data_version = 1`
7. 重置同步状态为“需要从 bootstrap 重新同步”

### 不做的事

- 不导入旧 `BMMKT1` 历史事件
- 不导入旧 `tx_contexts.json`
- 不恢复旧 `anchors_global.json`
- 不尝试把旧缓存修补成新模型

## Windows 目录场景

Windows 共享目录上的现有工作副本，视为“可能处于 v0”。

因此 Windows 节点启动时应自动：

1. 判定目录当前版本
2. 如果低于 `Data Version 1`
3. 自动执行 `v0 -> v1`
4. 完成后再启动服务

这样用户不需要手工：

- 删除旧 `data/`
- 删除旧 `tx_contexts.json`
- 删除旧 `anchors_global.json`
- 手动重建 SQLite

## 模块划分

建议新增：

- `data_version.js`
- `data_migration.js`

### `data_version.js`

职责：

- 提供 `CURRENT_DATA_VERSION`
- 读取 `runtime_version.json`
- 读取/写入 SQLite `meta`
- 合并主/备版本信息

### `data_migration.js`

职责：

- `ensureDataVersion()`
- `migrateV0ToV1()`
- 备份
- 恢复
- 清理
- 迁移日志

## 日志要求

迁移日志必须至少记录：

- 检测到的旧版本
- 目标版本
- 迁移开始时间
- 备份目录
- 清理文件列表
- 保留文件列表
- 成功或失败状态
- 失败时是否已完成回滚

另外，服务启动时也必须直接向用户输出迁移进度，例如：

- `current=v0 target=v1`
- `starting v0 -> v1`
- `completed v0 -> v1`

未来多步迁移时应表现为：

- `starting v1 -> v2`
- `completed v1 -> v2`
- `starting v2 -> v3`
- `completed v2 -> v3`

## 当前实施顺序

1. 先落文档
2. 再实现：
   - `data_version.js`
   - `data_migration.js`
3. 然后把 `server_market.js` 启动入口接到迁移管理器
4. 再把 Windows 启动脚本切到“先迁移再启动”
