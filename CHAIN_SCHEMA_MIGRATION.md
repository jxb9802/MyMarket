# BMMKT 链上 Schema 迁移说明（v1 -> v2 -> v3）

## 1. 目标
- 保证任意历史版本链上数据可被新版本程序读取。
- 迁移规则写死在程序中，按显式函数链执行。
- 读取时迁移到当前版本；写链时统一写当前版本。

当前版本常量：
- `CHAIN_SCHEMA_VERSION = 3`

相关代码：
- [server_market.js](/home/jb9802/.openclaw/workspace/app/bsv_market/server_market.js)

---

## 2. 版本演进

### v1（历史）
- 基础字段存在，但部分对象缺少 `merchantId`。
- `profile_set` 常见仅有：
  - `name`

### v2
- 补齐身份关联字段：
  - `profile_set.merchantId`
  - `category_*.merchantId`
  - `product_*.merchantId`

### v3（当前）
- 在 v2 基础上做结构规范化与数值清洗：
  - `profile_set`
    - `name: string`
    - `merchantId: string`
  - `category_*`
    - `id: string`
    - `name: string`（缺失时回退到 `id`）
    - `merchantId: string`
  - `product_*`
    - `id: string`
    - `merchantId: string`
    - `categoryId: string`
    - `title: string`（缺失时回退到 `id`）
    - `price: number >= 0`
    - `stock: number >= 0`
    - `soldCount: number >= 0`
    - `imageUrl: string`
    - `description: string`
    - `version: integer >= 1`

---

## 3. 显式迁移函数链

事件族：
- `profile_set` -> `profile`
- `category_*` -> `category`
- `product_*` -> `product`
- 其它 -> `other`

迁移函数：
- `profile`
  - `migrateProfileV1ToV2`
  - `migrateProfileV2ToV3`
- `category`
  - `migrateCategoryV1ToV2`
  - `migrateCategoryV2ToV3`
- `product`
  - `migrateProductV1ToV2`
  - `migrateProductV2ToV3`

执行入口：
- `migratePayloadToCurrent(eventType, payload)`
  - 自动检测 `_v`（无 `_v` 视为 `v1`）
  - 按 `v1 -> v2 -> v3` 逐步执行
  - 产出目标版本 `v3`

---

## 4. 读写策略

读取链上数据：
1. 解析事件 payload
2. 调 `migratePayloadToCurrent` 迁移到 `v3`
3. 调 `normalizeEventPayload` 规范化并进入内存/本地状态

写入链上数据：
1. 调 `withSchemaMeta`
2. 写入 `_v=3` 和 `_updatedAt`
3. 不写内部迁移辅助字段（如 `_sourceV`）

---

## 5. 向后兼容约定
- 老数据没有 `_v` 时默认视为 `v1`。
- 未识别事件族（`other`）按“仅提升版本号”策略处理，不做字段改写。
- 迁移函数必须幂等，重复执行不应破坏数据。

---

## 6. 后续扩展（v4+）
- 增加新版本时只需：
1. 新增 `migrate*V3ToV4` 函数
2. 将 `CHAIN_SCHEMA_VERSION` 提升到 `4`
3. 在 `CHAIN_MIGRATION_STEPS` 注册 `3 -> 4`
4. 更新本文档的字段差异

*** End Patch
