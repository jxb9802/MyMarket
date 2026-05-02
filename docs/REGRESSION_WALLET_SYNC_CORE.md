# 钱包同步核心回归（必跑）

## 覆盖问题
1. 切换钱包后，不同步或同步区块起点错误。
2. 同步后没有合并到其它钱包商品数据路径。
3. 新建钱包未清空本机旧数据，出现跨钱包污染。

## 一键执行
- Linux / WSL:
  - `bash scripts/regression_wallet_sync_core.sh`

## 回归脚本做了什么
- 静态断言（防回退）：
  - 钱包切换入口必须 `preserveSyncHints: false`。
  - 同步轮必须 `includeGlobalCache: true`。
  - 必须存在同步 epoch 隔离逻辑（防旧轮次覆盖新钱包状态）。
- 运行时断言：
  - 注入脏本地状态（高位高度 + 假商品/订单）。
  - 执行 `wallet/switch mode=create`。
  - 断言切换响应中本地数据已清空。
  - 断言同步起点回到 `bootstrapHeight`（通过 `market-debug.log` 里的 `p2p_sync_scheduler.startHeight`）。

## 输出
- 报告目录：`data/diagnostics`
- 文件名：`regression-wallet-sync-core-YYYYMMDD-HHMMSS.log`

## 通过标准
- 脚本退出码为 `0`。
- 报告最后 `fail=0`。
