# Stream Block Probe v1

## 目标

- 单独做一个专用工具，不接当前线上同步流程。
- 用单节点、单区块验证 `bsv-p2p` 的 `stream: true` 模式是否能稳定支撑我们的块下载与 `BMMKT2` 快速筛选。
- 重点验证：
  - 不再依赖“整块完整进内存后再处理”
  - 下载过程中可以边收边处理 `tx/output`
  - 命中的 `BMMKT2` 事件可以被提取
  - 大块场景下内存峰值明显低于当前 `peer.getBlock()` 整块模型

## 非目标

- 不替换当前 `independent_sync_service`
- 不处理多节点竞速/调度
- 不更新线上 SQLite 当前态
- 不做 reorg
- 不做历史兼容协议解析

## 工具文件

- `scripts/stream_block_probe.js`

第一版先不额外拆 helper 文件，减少耦合。跑通后再把通用逻辑抽到 `lib/`。

## 输入参数

- `--node host:port`
- `--hash <64-hex>`
- `--connect-timeout-ms <n>`
- `--idle-timeout-ms <n>`
- `--hard-timeout-ms <n>`
- `--memory-log-interval-ms <n>`
- `--max-events <n>`
- `--dump-events`
- `--accept-legacy-bmmkt1`
- `--validate`
- `--label <name>`

默认建议：

- `connect-timeout-ms = 15000`
- `idle-timeout-ms = 10000`
- `hard-timeout-ms = 1800000`
- `memory-log-interval-ms = 5000`
- `max-events = 100`
- `validate = false`

说明：

- `--accept-legacy-bmmkt1` 只用于工具验证历史链上命中，不改变线上系统当前“只认 BMMKT2”的协议边界。

## 运行方式

```bash
node scripts/stream_block_probe.js \
  --node 135.125.170.182:8333 \
  --hash 00000000000000001f87e063a3aa175ed88c600989f3f408ec4d20f282c33d47 \
  --idle-timeout-ms 10000 \
  --hard-timeout-ms 1800000
```

## 内部处理流程

1. 建立单节点 P2P 连接
2. 启用 `bsv-p2p` 的 `stream: true`
3. 请求指定区块
4. 监听：
   - `block_chunk`
   - `transactions`
   - `error_message`
   - `error_socket`
   - `disconnected`
5. 在 `transactions` 事件中逐 tx 检查 output：
   - 先找 `OP_RETURN`
   - 再检查是否命中 `BMMKT2|`
   - 命中后记录最小必要信息
6. 统计：
   - `bytesRead`
   - `firstDataElapsedMs`
   - `downloadElapsedMs`
   - `txCount`
   - `matchedEventCount`
   - `peakRss`
   - `peakExternal`
7. 输出最终 JSON 总结

## 第一版输出

最终输出结构：

```json
{
  "ok": true,
  "node": "135.125.170.182:8333",
  "blockHash": "....",
  "firstDataElapsedMs": 210,
  "elapsedMs": 1820,
  "bytesRead": 5199095,
  "chunkCount": 42,
  "txCountObserved": 14907,
  "matchedEventCount": 0,
  "peakRssMb": 74.2,
  "peakExternalMb": 11.3
}
```

如果加 `--dump-events`，额外输出命中的 `BMMKT2` 事件数组。

## 已知边界

### 1. 这仍然是“整块经过网络”

即使 `stream: true`，节点仍然会把整块 payload 传过来。  
收益在于：

- 不需要整块长期保存在 Node 内存里
- 可以边收边解析并丢弃无关 tx

### 2. `transactions` 事件是批量 tx 回调

`bsv-p2p` 在流式模式下会把当前 chunk 内已解析的 tx 通过 `transactions` 事件回调出来。  
工具层不需要自己实现 P2P message framing，但仍要注意：

- 一个 `transactions` 事件里可能有多笔 tx
- 需要通过 `header.getHash()` 绑定当前块
- `finished` 才表示该块 tx 流结束

### 3. `validate=true` 会做 merkle 验证

第一版默认 `validate=false`，先聚焦：

- 流式下载是否稳定
- 内存是否下降
- `BMMKT2` 快筛是否可用

之后需要再补“带 merkle 验证”的对照测试。

### 4. 超时模型

第一版必须使用：

- connect timeout
- read idle timeout
- hard timeout

只要 socket 仍持续有数据，就不因总耗时过长而失败。

## 验收标准

第一版算通过，需要满足：

1. 普通 5MB 块能完整跑通
2. 单节点大块测试时，内存峰值明显低于整块模式
3. 工具能稳定输出 `BMMKT2` 命中计数
4. 对无命中块，`matchedEventCount = 0`
5. 空闲超时只在无新字节时触发

## 后续升级方向

- 把 `BMMKT2` 提取逻辑抽成独立模块
- 增加 merkle/txid 校验模式
- 增加“把命中事件写入临时 SQLite”的实验模式
- 最后再考虑替换当前在线同步中的整块解析路径
