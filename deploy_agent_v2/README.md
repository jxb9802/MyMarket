# Deploy Agent V2

跨平台部署代理，目标是让目标机器只跑一个代理进程，`bsv_market` 的安装、启动、重启、日志抓取都通过代理完成。

## 能力

- 支持 `windows/linux/mac` 的同一套 Node 代理
- 通过 HTTP JSON API 管理应用
- 支持注册应用配置
- 支持压缩归档上传并安装到部署目录
- 支持 `start / stop / restart / status / logs / exec`
- 每个应用独立保存：
  - 部署目录
  - 运行状态
  - stdout/stderr 日志
- 内置 `bsv_market` 专用一键部署命令

## 目录

- `agent_server.js`: 代理服务
- `client.js`: 开发侧 CLI
- `examples/bsv_market.appspec.json`: 当前项目示例配置
- `examples/bsv_market.files.txt`: 当前项目示例部署清单
- `sample_app/`: 本地自测应用

## 启动代理

推荐统一用自举脚本启动，不要直接手写 `node agent_server.js`。这样目标机就算没有 Node，或者系统 Node 太老，也会自动拉起代理专用 Node，而且代理会一直保持前台运行，不会在装完 Node 后自己退出。

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

如果你明确知道目标机系统 Node 已经足够新，也仍然可以直接这样启动：

```bash
cd deploy_agent_v2
DEPLOY_AGENT_TOKEN=local-dev-token node agent_server.js
```

默认监听：

- `host = 0.0.0.0`
- `port = 18766`

可覆盖环境变量：

- `DEPLOY_AGENT_HOST`
- `DEPLOY_AGENT_PORT`
- `DEPLOY_AGENT_TOKEN`
- `DEPLOY_AGENT_ROOT_DIR`
- `DEPLOY_AGENT_NODE_VERSION`
- `DEPLOY_AGENT_MIN_NODE_VERSION`

## 一键部署 bsv_market

目标机器先启动代理：

```bash
cd deploy_agent_v2
bash bootstrap_agent.sh
```

开发机或当前机器直接执行一条命令：

```bash
cd deploy_agent_v2
node client.js deploy-bsv-market \
  --url http://目标机器IP:18766 \
  --token local-dev-token \
  --source ..
```

这条命令会自动完成：

- 注册 `bsv-market`
- 自动扫描当前项目文件
- 排除 `data/log/node_modules/.env.market` 等不应覆盖的内容
- 打成 `gzip` 压缩归档上传
- 远程安装到代理目录
- 远程安装 app-local Node `24.14.0`
- 远程执行 `npm install`
- 远程重启 `bsv_market`

如果只想上传不重启：

```bash
node client.js deploy-bsv-market \
  --url http://目标机器IP:18766 \
  --token local-dev-token \
  --source .. \
  --no-restart
```

如果目标机器依赖已经装好，不想每次跑 `npm install`：

```bash
node client.js deploy-bsv-market \
  --url http://目标机器IP:18766 \
  --token local-dev-token \
  --source .. \
  --skip-install
```

## 其它命令

```bash
cd deploy_agent_v2
node client.js ping --url http://127.0.0.1:18766 --token local-dev-token
node client.js register --app sample-app --spec ./examples/sample_app.appspec.json
node client.js deploy-manifest --app sample-app --source ./sample_app --manifest ./examples/sample_app.files.txt
node client.js start --app sample-app
node client.js status --app sample-app
node client.js logs --app sample-app
node client.js exec --app sample-app --command "node -v"
```

## Manifest 格式

`deploy-manifest` 仍然保留给高级用法。Manifest 文件是纯文本，每行一个相对路径：

```txt
server_market.js
sync_domain.js
steward_subprocess.js
```

注释行以 `#` 开头。

## 说明

- 这个新代理和现有 `scripts/windows_restart_agent.js` 是并存关系，不会替换旧代理。
- `deploy-bsv-market` 走的是压缩归档上传，不需要用户手工维护文件清单。
- 当前压缩格式是 `gzip + JSON archive`，这样在 Windows/Linux/macOS 都不用额外依赖解压工具。
- `bsv_market` 的运行不再依赖目标机器系统里的 Node 版本。部署时会先安装 app-local Node 到 `.deploy/node`，后续 `npm install` 和启动都会优先走这份 Node。
- 这样即使目标机器系统 Node 很旧，代理进程本身也不会因为安装新版 Node 自动退出；代理继续跑在原来的宿主 Node 上，应用跑在 app-local Node 上。

## 目标机器没有 Node 或 Node 太老

如果目标机器连 Node 都没有，或者系统 Node 版本太老，自举脚本会自动下载一份代理专用 Node：

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

这会先下载一份代理专用 Node 到：

- `deploy_agent_v2/.agent_node`

然后用这份 Node 启动代理。

默认行为：

- 系统 Node `>= 20.0.0`：直接用系统 Node 跑代理
- 系统 Node 缺失或 `< 20.0.0`：自动下载 `24.14.0` 到 `deploy_agent_v2/.agent_node`
- 启动后代理保持前台运行，不会因为“刚装了新 Node”就自动退出
