# Deploy Agent V2

`deploy_agent_v2` 是给 `bsv_market` 单独做的新部署代理，和旧代理并存，不替换旧实现。

## 目标

- 目标机器只运行一个代理程序
- 部署、启动、重启、日志抓取都走代理
- 支持 `Windows / Linux / macOS`
- 支持远程压缩上传部署
- 支持远程机器没有 Node 或系统 Node 太老

## 目录

- [deploy_agent_v2/agent_server.js](/home/jb9802/.openclaw/workspace/app/bsv_market/deploy_agent_v2/agent_server.js)
- [deploy_agent_v2/client.js](/home/jb9802/.openclaw/workspace/app/bsv_market/deploy_agent_v2/client.js)
- [deploy_agent_v2/bootstrap_agent.sh](/home/jb9802/.openclaw/workspace/app/bsv_market/deploy_agent_v2/bootstrap_agent.sh)
- [deploy_agent_v2/bootstrap_agent.bat](/home/jb9802/.openclaw/workspace/app/bsv_market/deploy_agent_v2/bootstrap_agent.bat)
- [deploy_agent_v2/remote_helpers/ensure_node.js](/home/jb9802/.openclaw/workspace/app/bsv_market/deploy_agent_v2/remote_helpers/ensure_node.js)
- [deploy_agent_v2/remote_helpers/run_with_managed_node.js](/home/jb9802/.openclaw/workspace/app/bsv_market/deploy_agent_v2/remote_helpers/run_with_managed_node.js)

## 启动代理

推荐统一用自举脚本。

Linux / macOS:

```bash
cd deploy_agent_v2
bash bootstrap_agent.sh
```

Windows:

```bat
cd deploy_agent_v2
bootstrap_agent.bat
```

行为：

- 系统 Node `>= 20.0.0`：直接用系统 Node 跑代理
- 系统 Node 缺失或 `< 20.0.0`：自动下载 `24.14.0` 到 `deploy_agent_v2/.agent_node`
- 启动后代理保持前台运行，不会在安装 Node 后自动退出

## 一键部署

开发机执行：

```bash
cd deploy_agent_v2
node client.js deploy-bsv-market \
  --url http://目标机器IP:18766 \
  --token 你的token \
  --source ..
```

这条命令会自动完成：

- 注册 `bsv-market`
- 自动扫描项目文件
- 排除 `data`、`log`、`node_modules`、`.env.market` 等不应覆盖的内容
- 打成 `gzip + JSON archive`
- 上传到目标机器并安装
- 安装 app-local Node `24.14.0`
- 用 app-local Node 执行 `npm install`
- 远程重启应用

## 部署路径

默认路径：

- 代理运行根目录：`deploy_agent_v2/.runtime`
- 应用目录：`deploy_agent_v2/.runtime/apps/bsv-market`
- 当前版本：`deploy_agent_v2/.runtime/apps/bsv-market/current`
- 日志目录：`deploy_agent_v2/.runtime/apps/bsv-market/logs`

## 运行时 Node 策略

分两层：

1. 代理自身运行 Node

- 由 `bootstrap_agent.sh` / `bootstrap_agent.bat` 负责
- 若系统 Node 太老或不存在，下载代理专用 Node 到 `.agent_node`

2. 应用运行 Node

- 由 `ensure_node.js` 负责
- 下载 app-local Node 到部署目录下的 `.deploy/node`
- 后续 `npm install` 和 `market_ctl.sh start` 都通过 `run_with_managed_node.js` 优先走这份 Node

这样即使目标机器系统 Node 很旧，也不会影响代理继续运行。

## 常用命令

```bash
node client.js status --url http://目标机器IP:18766 --token 你的token --app bsv-market
node client.js logs --url http://目标机器IP:18766 --token 你的token --app bsv-market --max-bytes 65536
node client.js restart --url http://目标机器IP:18766 --token 你的token --app bsv-market
node client.js exec --url http://目标机器IP:18766 --token 你的token --app bsv-market --command "./market_ctl.sh restart"
```
