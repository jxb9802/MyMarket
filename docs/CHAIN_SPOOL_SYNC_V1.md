# CHAIN_SPOOL_SYNC_V1

## 目标
- 解决“同步完成但无商品”定位困难问题。
- 解决“切换节点后重复下载”问题。
- 解决“新建/恢复/切换钱包后沿用旧高度”问题。

## 强制规则
- 触发动作：`新建钱包`、`恢复钱包`、`切换钱包`。
- 触发后必须：
1. 清空当前钱包本地业务数据（anchors/categories/products/orders 等运行态）。
2. 同步游标回到固定起点：`bootstrapHeight - 1`（逻辑起扫高度为 `bootstrapHeight`）。
3. 先执行本地 `chain_spool.ndjson` 回放重建，再做网络增量同步。

## 两阶段同步
1. 下载阶段（网络 -> 文件）
- 从固定高度开始扫描区块。
- 只要命中系统定义协议 OP_RETURN（当前只认 `BMMKT2`），就把原始记录写入 `data/chain_spool.ndjson`。
- 同步写入 `data/chain_spool_state.json`（records/bytes/lastHeight）。

2. 解析阶段（文件 -> 数据库/内存态）
- 从 `chain_spool.ndjson` 逐条解析并生成 anchors。
- 再由 anchors 重建 categories/products 等业务视图。
- 节点切换后，优先回放本地 spool，只同步 `spool.lastHeight` 之后的增量区块。

## 诊断日志
- `chain_spool_append`：每轮追加写入统计。
- `chain_spool_replay_done`：回放统计（records/rows/addedAnchors/maxHeight）。
- `wallet_switch_spool_replay`：钱包切换时本地回放结果。
- `p2p_anchor_scan_diagnose`：增加 `spoolCandidates/spoolAppended` 指标。

## 验收要点
1. 新设备首次运行：无钱包时登录页仅显示“创建钱包/导入助记词”，不显示密码登录。
2. 新建钱包后：`localHeight` 从 `bootstrapHeight - 1` 起跳，不复用旧钱包高度。
3. 同步完成后：商品可见；若不可见，能从 spool 文件与解析日志明确定位是下载层还是解析层问题。
