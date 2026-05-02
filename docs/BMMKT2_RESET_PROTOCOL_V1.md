# BMMKT2_RESET_PROTOCOL_V1

## 目标

- 从当前链上业务历史中断代，后续新写入统一使用 `BMMKT2`。
- 明确停止解析 `BMMKT1` 与 `MARKETPLACE_*` 历史协议。
- 让未来区块同步可以更早识别“是不是本系统数据”，显著降低无效 `OP_RETURN` 深解析成本。

## 核心决定

1. 当前写入协议头改为 `BMMKT2`
- 适用范围：
  - `profile`
  - `categories`
  - `products`
  - `orders`
  - `wallet_key_bind`
  - `chat_message`
  - `chat_invite`
  - `chat_connect_ack`

2. `BMMKT1` 不再用于新写入，也不再用于读取
- 新生成的链上业务数据一律写 `BMMKT2`。
- 旧的 `BMMKT1` / `MARKETPLACE_*` 数据视为废弃历史，不再参与当前系统重建。

3. 当前同步直接只走 `BMMKT2` 快路径
- 快路径：
  - 先找 `OP_RETURN`
  - 再识别 `BMMKT2`
  - 命中后才进入事件解析
- 不再保留旧协议慢路径。

## 当前线格式

V1 先保持文本协议，避免一次引入二进制重构风险：

- `BMMKT2|<eventType>|<json>`

示例：

```text
BMMKT2|profile_set|{"name":"Alice","_v":3}
```

说明：

- 这不是最终极限性能格式，但已经足够让同步先按 marker 快速过滤。
- 后续如果还要继续提速，再把 `BMMKT2` 升级成“固定第一 push + 二进制 payload”。

## 为什么同步会明显提速

当前性能瓶颈不是保存，而是大量 `OP_RETURN` 候选进入深解析后才发现“不是我们的业务数据”。

`BMMKT2` 的收益在于：

1. 新块里可以优先只认 `BMMKT2`
- 大部分无关 `OP_RETURN` 会在 very early stage 被跳过。

2. 解析器不再跑旧协议兼容链
- 不再把 `OP_RETURN` 当作潜在 `BMMKT1` / `MARKETPLACE_*` 深解析对象。

3. 未来可按高度切快路径
- 新 bootstrap 或新阶段之后的区块，可以直接把 `BMMKT2` 作为主筛选条件。

## 历史处理策略

- 当前策略已经是“重新开服”：
  - 写侧只认 `BMMKT2`
  - 读侧也只认 `BMMKT2`
- `BMMKT1` / `MARKETPLACE_*` 不再参与：
  - 区块同步筛选
  - spool 下载
  - spool 回放
  - 业务当前态重建

## 实施规则

1. `buildAnchorWireText()` 默认输出 `BMMKT2`
2. `parseAnchorPayloadText()` 只接受 `BMMKT2`
3. `isSystemDefinedOpReturn()` 与同步筛选只识别 `BMMKT2`
4. 新的性能优化优先围绕 `BMMKT2` 快路径展开
5. 旧协议不再作为可恢复历史的一部分

## 验收要点

1. 新发出的 `profile/product/order/chat` 链上事件都带 `BMMKT2`
2. 旧的 `BMMKT1` 数据不会再被当前读侧识别
3. 同步日志中未来窗口的无效深解析占比下降
4. 当前系统业务历史以 `BMMKT2` 启用后的数据为准
