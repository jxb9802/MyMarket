# 方案 C 实施文档 v1

## 结论
- 方案 C 可做，但不能把它理解成“向普通 BSV 节点直接查询地址 UTXO”。
- 正确做法是：
  - 用支持 `NODE_BLOOM` / `filterload` / `filteradd` / `merkleblock` 的节点池；
  - 只针对当前钱包前 `50` 个地址做过滤恢复；
  - 由本地根据相关交易自行重建 UTXO 集。
- 当前实测结果：
  - 广告支持 bloom/filter 的 peer：`40 / 60`
  - 基础 filter 命令链完整通过的 peer：`37 / 60`
  - 真实能走到 filtered block 响应的 peer：`7`
- 因此 v1 必须使用**专用节点池**，不能直接复用普通同步节点池。

## 1. 目标

### 1.1 要解决的问题
- 当前“钱包同步”在本地 `spv_index` 为空时，恢复 confirmed UTXO 仍主要依赖 WOC。
- 用户希望尽量不依赖 WOC。
- 我们需要一条“仅依赖公网 P2P 节点”的恢复路径。

### 1.2 v1 的目标边界
- 只恢复前 `50` 个派生地址。
- 只恢复：
  - confirmed UTXO
  - 已确认交易历史
  - 与这些地址相关的花费关系
- 不在 v1 里解决：
  - 全量无上限地址恢复
  - 任意深度账户发现
  - 商品/聊天全链发现
  - mempool 全量恢复

## 2. 方案核心

方案 C 的核心不是“按地址查 UTXO”，而是：

1. 为前 `50` 个地址构造脚本匹配条件。
2. 向支持 bloom/filter 的 peer 下发 filter。
3. 向 peer 请求区块头与相关区块数据。
4. 接收：
  - `merkleblock`
  - 命中的 `tx`
5. 在本地对这些相关交易做：
  - 输入输出分析
  - 花费链跟踪
  - UTXO 重建
6. 写回：
  - `spv_index.json`
  - `cache.json`
  - 钱包交易历史

## 3. v1 节点池

v1 专用节点池：

见 [scheme_c_nodes.txt](/home/jb9802/.openclaw/workspace/app/bsv_market/scheme_c_nodes.txt)

当前节点列表：

```text
100.11.85.230:8333
100.49.247.84:8333
100.7.12.142:8333
107.136.51.230:8333
107.210.90.217:8333
115.187.38.11:8333
135.148.136.25:8333
```

选择规则：
- 通过阶段 1：
  - `connect`
  - `ping`
  - `filterload`
  - `filteradd`
  - `filterclear`
- 通过阶段 2：
  - `connect`
  - `filterload`
  - `getheaders`
  - `MSG_FILTERED_BLOCK -> merkleblock/tx`

说明：
- 这份节点池只用于方案 C 恢复。
- 不替换普通 `spv_nodes.txt`。
- 需要周期性重测并更新。

## 4. 运行入口

建议新增一个独立恢复入口：

- `POST /api/wallet/recover-scheme-c`

请求参数：

```json
{
  "addressLimit": 50,
  "startHeight": 0,
  "nodePool": "scheme_c",
  "forceRebuild": true
}
```

说明：
- `addressLimit`
  - 默认 `50`
- `startHeight`
  - `0` 表示按本地 checkpoint / 已知最低相关高度决定
- `nodePool`
  - `scheme_c`
- `forceRebuild`
  - 是否清空当前本地索引后重建

## 5. 地址与脚本准备

### 5.1 地址范围
- 从当前钱包助记词派生前 `50` 个地址。
- v1 建议包含：
  - 外部接收地址链
  - 变更地址链

### 5.2 过滤目标
对每个地址构造：
- `P2PKH` scriptPubKey
- 对应的 `pubKeyHash`

本地维护：

```json
{
  "address": "1xxx",
  "branch": "receive|change",
  "index": 0,
  "scriptHex": "...",
  "scriptHash": "...",
  "pubKeyHash": "..."
}
```

### 5.3 Bloom/filter
v1 用途：
- 只为“相关交易发现”服务
- 不拿来当最终可信来源

## 6. 恢复流程

### 6.1 阶段 A：准备
1. 读取 `scheme_c_nodes.txt`
2. 加载前 `50` 个地址脚本
3. 初始化恢复任务状态：
  - `status = preparing`
  - `testedNodes = []`
  - `matchedBlocks = []`
  - `matchedTxs = []`

### 6.2 阶段 B：节点握手
1. 并发连接节点池
2. 对每个节点执行：
  - `version/verack`
  - `ping`
  - `filterload`
  - `filteradd`（可以分批）
3. 通过的节点进入 `activeSchemeCPeers`

最低要求：
- 至少 `3` 个活跃 peer

### 6.3 阶段 C：头部同步
1. 先拿 headers 建立本地高度链
2. 优先用当前已有的：
  - `p2pHeightHashCache`
  - `p2pTipHeight`
3. 若恢复专用节点给出更高 headers，按现有 header 连续性验证规则推进

### 6.4 阶段 D：相关区块请求
方式：
- 从 `startHeight` 到 tip 分窗口推进
- 对每个窗口：
  - 拿对应 block hash
  - 发 `getdata(MSG_FILTERED_BLOCK)`
  - 接收 `merkleblock`
  - 接收匹配的 `tx`

本地记录：
- 哪个块回了 `merkleblock`
- 哪些 tx 属于相关交易
- 哪些块未回任何过滤结果

### 6.5 阶段 E：本地 UTXO 重建
对收到的相关交易：
1. 遍历 outputs
  - 命中本地脚本 -> 新增 UTXO
2. 遍历 inputs
  - 如果花费了本地已知 UTXO -> 标记 spent
3. 计算：
  - confirmed balance
  - tx history
  - address activity

### 6.6 阶段 F：持久化
写回：
- `spv_index.json`
- `cache.json`
- `wallet_state.json` 中的恢复摘要
- 恢复日志

### 6.7 阶段 G：校验
至少做：
1. UTXO 自洽校验
2. 已知相关交易输入输出平衡校验
3. 多节点命中块的一致性比对

## 7. 本地状态设计

建议新增：

```json
{
  "schemeCRecovery": {
    "running": false,
    "status": "idle",
    "startedAt": "",
    "finishedAt": "",
    "addressLimit": 50,
    "activePeers": [],
    "failedPeers": [],
    "currentHeight": 0,
    "targetHeight": 0,
    "matchedBlocks": 0,
    "matchedTxs": 0,
    "rebuiltUtxos": 0,
    "lastError": ""
  }
}
```

## 8. 前端提示

建议新增：

- `钱包恢复（方案 C）`
- 同步进度显示：
  - 当前节点数
  - 已准备地址数
  - 当前高度
  - 匹配区块数
  - 匹配交易数
  - 已恢复 UTXO 数

示例：
- `方案 C 恢复中：节点 4/7，地址 50，扫描高度 940000/944222，命中区块 12，命中交易 38，已恢复 UTXO 4`

## 9. 与现有恢复链的关系

### 9.1 不替代普通 SPV
普通 SPV 继续负责：
- 新交易监听
- 广播
- mempool 感知
- 增量维护

### 9.2 不默认替代 WOC
v1 应该是新增一条恢复链：
- 普通钱包同步
- WOC 恢复
- 方案 C 恢复

先作为实验能力，不先替换现有主恢复逻辑。

## 10. 推荐实施顺序

### 第一步
- 新增 `scheme_c_nodes.txt`
- 新增恢复任务状态结构
- 新增后端入口 `/api/wallet/recover-scheme-c`

### 第二步
- 地址脚本生成
- 专用节点池握手与 filter 初始化

### 第三步
- `MSG_FILTERED_BLOCK` / `merkleblock` 接收与解析

### 第四步
- 本地相关交易索引与 UTXO 重建

### 第五步
- 前端恢复进度展示

### 第六步
- 多节点一致性与异常回退

## 11. 主要风险

### 11.1 节点支持不稳定
- 广告支持 bloom 的节点，不一定真能稳定返回 `merkleblock`
- 当前实测：
  - `40` 个广告支持
  - 但只有 `7` 个完整通过第二阶段

风险：
- 恢复成功率随节点池变化而波动

### 11.2 协议兼容性问题
- 不同节点对 `filterload/filteradd` 支持质量不同
- 有些节点会：
  - 接受 `filterload`
  - 但 `getheaders` 后不给 `filtered block`
  - 或直接超时/断开

### 11.3 恢复速度慢
- 就算只扫前 `50` 个地址
- 从历史高度一路回放到最新 tip，仍然会慢

### 11.4 实现复杂度高
- 这不是“查地址 UTXO”接口
- 而是自己实现一个迷你钱包恢复器：
  - 过滤
  - 相关交易发现
  - 花费跟踪
  - UTXO 重建

### 11.5 结果不确定性高于 WOC
- WOC/索引服务给的是直接索引结果
- 方案 C 给的是协议级原材料
- 一旦 peer 行为差异大，恢复结果更容易抖动

### 11.6 历史覆盖范围问题
- 只扫前 `50` 个地址是 v1 的边界
- 如果真实资金落在更深地址，恢复会漏

### 11.7 调试难度高
- 一旦恢复结果不对，很难快速判断问题来自：
  - 节点没回
  - filter 命中缺失
  - 本地交易解析错误
  - 花费链跟踪错误

## 12. 风险控制建议

1. 方案 C 只作为实验恢复入口，不直接替代主恢复链。
2. 只使用专用节点池。
3. 至少 `3` 个节点交叉命中才接受高价值恢复结果。
4. 恢复结果写入前先做本地一致性校验。
5. 先限制前 `50` 个地址，不直接放开更深地址。
6. 恢复完成后保留详细报告，便于复查。

## 13. 当前建议

当前最合理的推进方式是：

1. 先做方案 C 的后端实验恢复器
2. 只针对前 `50` 个地址
3. 只用这 `7` 个专用节点
4. 先验证能否稳定恢复一个已知钱包的 confirmed UTXO
5. 成功后再考虑把它接入正式 UI

一句话：

- 方案 C **不是不能做**
- 但它本质上是在本项目里新增一个“轻量 SPV 钱包恢复器”
- 最大风险不是技术上完全不可行，而是 **节点兼容性和恢复稳定性不够高**
