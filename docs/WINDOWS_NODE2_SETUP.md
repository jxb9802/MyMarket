# Windows 主机作为第二节点（Node-2）

## 目标
- 在 Windows 主机启动第二个 `bsv_market` 节点。
- 与 VM 节点并行运行，不冲突。

## 预置
- 已安装 Node.js 24+（含 npm，且支持内建 `node:sqlite`）。
- 已把项目目录同步到 Windows 主机。

## 一键启动（只执行一个脚本）
- 双击或命令行执行：
  - `scripts\windows_node2_setup_and_run.bat`

脚本会自动完成：
1. 检查 `node/npm`
2. 检查 `node:sqlite`
3. 首次自动 `npm install`
4. 设置 Node-2 环境变量（默认端口 `8091`）
5. 启动服务并输出日志到 `log\bsv_market_node2.log`

## 健康检查
- 执行：
  - `scripts\windows_node2_healthcheck.bat`

若要检查其他端口：
- `scripts\windows_node2_healthcheck.bat 8091`

## 说明
- Node-2 默认监听：`http://127.0.0.1:8091`
- 聊天首版为 P2P + 订单聊天上链。
- 关闭节点：在运行窗口按 `Ctrl + C`。
- Windows 目录后续将接入启动期数据迁移管理器：
  - 若目录数据版本低于当前基线，会先自动升级到 `Data Version 1`
  - 再启动服务
- 运行日志统一放在项目目录下的 `log\`：
  - `log\bsv_market_node2.log`
  - `log\market-debug.log`
  - `log\steward-worker.log`
  - `log\recover-debug.log`
  - `log\send-debug.log`

## 便携离线包（推荐）
- 若安装包已包含完整 `node_modules`，可直接运行：
  - `scripts\windows_node2_run_portable.bat`
- 此模式不依赖联网安装 npm 依赖。

## 安装包输出约定（管理）
- 以后当需要准备 Windows 安装包时，统一执行：
  - 将 `bsv_market` 打包为单个 zip（默认含完整 `node_modules`，排除 `data`）。
  - 默认输出并拷贝到：`/home/jb9802/share`
- 当前默认文件名：
  - `bsv_market_node2_fullbundle.zip`
