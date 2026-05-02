# BSV Market Regional Chain Protocol v1 (RCP-v1)

## 1. 目标
- 定义一个公开、可互操作的链上协议。
- 任何 AI/程序只要实现本协议，即可独立实现兼容客户端。
- 协议支持“区域优先 + 全网可发现”的去中心化市场。

## 2. 术语
- `RCP`: Regional Chain Protocol。
- `Envelope`: 链上消息统一封包。
- `region_code`: 区域代码（如 `CN-SH`, `CN-GD`, `US-CA`, `GLOBAL`）。
- `shop_id`: 卖家身份 ID（由公钥派生）。
- `order_id`: 订单 ID（全局唯一）。

## 3. 兼容性与版本
- `protocol`: 固定 `bsv_market`。
- `version`: 固定 `1`（语义版本仅在重大不兼容时升级主版本）。
- 未知字段必须忽略，不得导致解析失败。

## 4. 链上封包（Envelope）

所有业务消息统一采用以下 JSON 结构（UTF-8，字段名区分大小写）：

```json
{
  "protocol": "bsv_market",
  "version": 1,
  "network": "mainnet",
  "region_code": "CN-SH",
  "type": "product_upsert",
  "object_id": "prod_01J...",
  "timestamp": 1770000000,
  "publisher_pubkey": "02ab...",
  "payload": {"...": "..."},
  "sig": "3044..."
}
```

字段规则：
- `timestamp`: Unix 秒级时间戳。
- `object_id`: 当前对象 ID（商品/订单/消息等）。
- `publisher_pubkey`: 发布者压缩公钥（33 字节 hex）。
- `sig`: 对“规范化待签名文本”签名。

## 5. 规范化签名规则

待签名文本（按顺序拼接）：
1. `protocol`
2. `version`
3. `network`
4. `region_code`
5. `type`
6. `object_id`
7. `timestamp`
8. `payload_canonical_json`

要求：
- `payload` 使用 Canonical JSON（键名按字典序，无多余空白）。
- 签名算法：secp256k1 + ECDSA DER。
- 客户端必须校验 `sig` 与 `publisher_pubkey`。

## 6. 消息类型

### 6.1 商品

#### `product_upsert`
```json
{
  "shop_id": "shop_...",
  "product_id": "prod_...",
  "product_version": 7,
  "title": "手工皮具钱包",
  "description": "...",
  "price_sats": 100000,
  "stock": 8,
  "category": "fashion",
  "image_mode": "onchain",
  "images": [
    {"content_hash": "sha256:...", "ref": "tx:...:0", "bytes": 34567}
  ],
  "shipping_region": ["CN-*"],
  "status": "active"
}
```

#### `product_offline`
```json
{
  "shop_id": "shop_...",
  "product_id": "prod_...",
  "reason": "sold_out"
}
```

### 6.2 订单

#### `order_open`
```json
{
  "order_id": "ord_...",
  "product_id": "prod_...",
  "product_version_snapshot": 7,
  "buyer_shop_id": "shop_buyer_...",
  "seller_shop_id": "shop_seller_...",
  "price_snapshot_sats": 100000,
  "stock_snapshot": 8,
  "buyer_deposit_rate_bps": 2000,
  "seller_deposit_rate_bps": 1000,
  "escrow_policy": "2of2",
  "escrow_script_hash": "sha256:...",
  "buyer_lock_txid": "..."
}
```

#### `order_ship`
```json
{
  "order_id": "ord_...",
  "seller_lock_txid": "...",
  "carrier": "optional",
  "tracking_cipher": "base64cipher..."
}
```

#### `order_confirm`
```json
{
  "order_id": "ord_...",
  "settle_txid": "..."
}
```

#### `order_return_request`
```json
{
  "order_id": "ord_...",
  "reason_code": "not_match",
  "detail_cipher": "base64cipher..."
}
```

#### `order_return_accept`
```json
{
  "order_id": "ord_...",
  "refund_txid": "..."
}
```

#### `order_cancel_before_ship`
```json
{
  "order_id": "ord_...",
  "cancel_txid": "..."
}
```

#### `order_dispute_lock`
```json
{
  "order_id": "ord_...",
  "lock_note": "frozen_in_2of2"
}
```

### 6.3 聊天（密文）

#### `chat_msg`
```json
{
  "order_id": "ord_...",
  "session_id": "sess_...",
  "seq": 12,
  "sender_role": "buyer",
  "cipher": "base64...",
  "nonce": "hex...",
  "cipher_suite": "xchacha20poly1305"
}
```

规则：
- 聊天内容必须密文。
- 明文不得上链。

## 7. 订单状态机（强约束）

合法状态迁移：
1. `NEW -> OPENED` (`order_open`)
2. `OPENED -> SHIPPED` (`order_ship`)
3. `SHIPPED -> CONFIRMED` (`order_confirm`)
4. `SHIPPED -> RETURN_REQUESTED` (`order_return_request`)
5. `RETURN_REQUESTED -> RETURN_ACCEPTED` (`order_return_accept`)
6. `OPENED -> CANCELED_BY_BUYER` (`order_cancel_before_ship`)
7. `SHIPPED|RETURN_REQUESTED -> DISPUTE_LOCKED` (`order_dispute_lock`)

非法跳转必须拒绝。

额外一致性规则：
- `order_open` 必须绑定下单时的商品版本快照（`product_version_snapshot`）。
- 卖家接单/发货前必须校验：当前商品版本是否与快照一致。
- 不一致时，订单应进入“待重报价/待买家确认”，不得按旧版本直接成交。

## 8. 区域分片规则
- 每条消息必须带 `region_code`。
- 区域查询默认只查本地区；可切换全网查询。
- `GLOBAL` 用于跨区商品或公共公告。
- 区域代码建议兼容 `ISO3166-2` 前缀，如 `CN-SH`。

## 9. 去中心化索引节点互操作（推荐 API）

为保证不同客户端可发现数据，建议索引节点实现下列只读接口：

1. `GET /rcp/v1/regions`
2. `GET /rcp/v1/products?region=CN-SH&updated_after=1770000000&limit=200`
3. `GET /rcp/v1/orders?shop_id=shop_xxx&updated_after=...`
4. `GET /rcp/v1/chat?order_id=ord_xxx&after_seq=10`
5. `GET /rcp/v1/tx-proof?txid=...`

返回必须包含：`txid`, `block_height`, `block_hash`, 可选 `merkle_proof`。

## 10. 客户端最小合规要求
- 必须：
  - 校验 Envelope 签名。
  - 执行订单状态机合法性校验。
  - 校验关键资金交易与订单 ID 关联。
  - 聊天仅接受密文消息。
- 应该：
  - 多索引节点交叉验证。
  - 支持回放补扫（基于 `last_scanned_height`）。

## 11. 失败与冲突处理
- 同一 `object_id` 多版本：按 `timestamp` 新者优先；同时间戳按 `txid` 字典序。
- 签名无效、状态非法、字段缺失：标记无效消息，不入主库。
- 索引节点冲突：以链上可验证凭据（tx + proof）为准。

## 12. 安全注意
- 私钥与聊天密钥分离。
- 禁止把助记词、私钥、明文聊天写入链上。
- 对大图片与大 payload 设上限，防止资源耗尽攻击。

## 13. 参考实现建议（非强制）
- 本地存储：SQLite（WAL）。
- 后台管家：周期轮询 + 事件订阅 + 回放补扫。
- 图片策略：优先缩略图上链，原图可分片上链。

## 14. 测试向量（实现方自检）
- Case-1: 合法 `product_upsert` 能被所有客户端解析并展示。
- Case-2: 缺失 `sig` 的消息必须拒绝。
- Case-3: `OPENED -> CONFIRMED` 跳过 `SHIPPED` 必须拒绝。
- Case-4: `chat_msg` 包含明文字段应拒绝。
- Case-5: 多节点返回冲突时，能按 proof 选出有效结果。
