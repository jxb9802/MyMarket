# P2P_TRANSPORT_MODULE_V1

## 1. 目标

提供一个可独立部署、可单独测试、后续可直接集成进聊天系统的 P2P 通讯模块。

当前版本包含三条路径：

- `direct`
- `holepunch`
- `relay`

优先级：

- `direct > holepunch > relay`

## 2. 文件

- [p2p_protocol.js](/home/jb9802/.openclaw/workspace/app/bsv_market/p2p_protocol.js)
- [p2p_transport_core.js](/home/jb9802/.openclaw/workspace/app/bsv_market/p2p_transport_core.js)
- [p2p_probe_device.js](/home/jb9802/.openclaw/workspace/app/bsv_market/tools/p2p_probe_device.js)

## 3. 当前能力

- 独立 HTTP 信息接口
- WebSocket 直连握手与消息收发
- 在线/离线拒绝
- 黑名单拒绝
- UDP 打洞测试
- Relay 注册与转发
- 独立设备程序可部署在不同机器

## 4. 运行方式

启动设备端：

```bash
node tools/p2p_probe_device.js serve \
  --wallet-id node-a \
  --port 9777 \
  --udp-port 9777 \
  --advertise-host 192.168.1.10
```

探测对端：

```bash
node tools/p2p_probe_device.js probe \
  --target http://192.168.1.11:9777
```

直连发消息：

```bash
node tools/p2p_probe_device.js direct-send \
  --wallet-id node-a \
  --port 9781 \
  --udp-port 9781 \
  --advertise-host 192.168.1.10 \
  --target http://192.168.1.11:9777 \
  --text hello
```

UDP 打洞消息测试：

```bash
node tools/p2p_probe_device.js holepunch-send \
  --wallet-id node-a \
  --port 9782 \
  --udp-port 9782 \
  --advertise-host 192.168.1.10 \
  --target http://192.168.1.11:9777 \
  --text hello
```

启用 relay 节点：

```bash
node tools/p2p_probe_device.js serve \
  --wallet-id relay-node \
  --port 9780 \
  --udp-port 9780 \
  --advertise-host 192.168.1.12 \
  --enable-relay true
```

客户端挂到 relay：

```bash
node tools/p2p_probe_device.js serve \
  --wallet-id node-b \
  --port 9777 \
  --udp-port 9777 \
  --advertise-host 192.168.1.11 \
  --relay-url http://192.168.1.12:9780
```

通过 relay 发消息：

```bash
node tools/p2p_probe_device.js relay-send \
  --wallet-id node-a \
  --port 9783 \
  --udp-port 9783 \
  --advertise-host 192.168.1.10 \
  --relay http://192.168.1.12:9780 \
  --target-wallet node-b \
  --text hello
```

## 5. 现阶段边界

这是传输测试模块，不是完整聊天业务模块。

当前不包含：

- 钱包签名绑定校验
- 聊天密文加解密
- 好友关系
- 消息持久化
- UI

这些会在后续聊天系统集成时挂在该模块之上。

