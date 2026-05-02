# RUNTIME_BUS_AND_PERSIST_V1

Date: 2026-04-06
Workspace: `/home/jb9802/.openclaw/workspace/app/bsv_market`

## 目标

把当前系统从“全局 `event_log` 同时承担消息、回放、恢复、投影更新”改成两层：

1. `runtime bus`
- 默认跨进程
- 非持久化
- 无回放
- 没有消费者就直接丢弃

2. `persist`
- 唯一持久化执行层
- 负责 SQLite / JSON / 运行期快照文件写入
- projection 是恢复源

## 当前问题

当前旧模型有这些结构性问题：

- 消息通知和状态持久化耦合
- projection 依赖 `list_events_after(...)` 全局回放
- 主进程和子进程容易重复发事件、重复更新 projection
- consumer offset 一旦卡住，会反复回放大量无关 payload
- `event_log` 越积越大，运行时链路被无关历史拖慢

## 新模型

### 1. `runtime bus`

`runtime bus` 是标准运行时消息队列：

- `publish(topic, payload, meta)`
- `subscribe(topic, handler)`
- `unsubscribe()`

规则：

1. 默认不持久化
2. 默认不回放
3. 没有消费者就直接丢弃
4. 只传“变化通知”或“执行通知”
5. 不承担恢复职责

### 2. `persist`

`persist` 是唯一持久化执行层。

所有模块：

- 可以决定何时保存
- 可以决定保存什么内容
- 但不能直接写 DB / JSON / 运行时 snapshot 文件

真正落盘只能走统一 IPC：

- `persistClient.saveSyncState(...)`
- `persistClient.mergeCatalogEntities(...)`
- `persistClient.saveProfile(...)`
- `persistClient.saveLocalState(...)`
- `persistClient.saveWalletReadModel(...)`
- `persistClient.writeStateJsonSnapshot(...)`

## 核心规则

### 规则 1

消息只是通知，不承担恢复。

### 规则 2

状态恢复只依赖 projection，不依赖消息回放。

### 规则 3

模块决定持久化时机和内容，统一 `persist` 层执行实际写入。

### 规则 4

主进程和子进程都不能直接写 SQLite / `state.json` / 运行期快照文件。

### 规则 5

跨进程消息默认使用非持久化 `runtime bus`。

### 规则 6

持久化消息模式不是默认模型，不进入同步主路径。

## 进程职责

### 主进程

负责：

- HTTP
- 主缓存
- 业务协调
- 接收子进程 IPC
- 发布 `runtime bus` 消息

不负责：

- 直接持久化写入

### 子进程

负责：

- 同步
- 计算
- 解析
- 上报结果

不负责：

- 直接持久化
- 自己维护跨进程一致性

### `persist` 进程

负责：

- SQLite 写入
- JSON / snapshot 文件写入
- projection 更新
- 单写串行保证

### `runtime bus`

负责：

- 即时消息分发
- 运行时通知

不负责：

- 历史回放
- 恢复
- 审计

## 启动顺序

必须严格按这个顺序：

1. 启动 `persist`
2. 从 projection 恢复模块 cache
3. 绑定消费者
4. 启动生产者

同步场景下：

1. `bhs` 先恢复
2. `bhs` 先 ready
3. `sync` 最后启动

说明：

- 不是“BHS 最后绑定”
- 而是“同步生产者最后启动”

## 模块落地原则

### `bhs`

- BHS 头变化时发布 `bhs.tip.changed`
- 同时按需持久化 BHS projection
- 不再靠轮询检查决定是否触发同步

### `sync`

- 收到 BHS tip 变化后，决定是否需要同步
- 需要同步时入队 job
- 同步结果直接更新 sync projection
- 不再依赖全局 `event_log` catch-up

### `catalog/profile/local_state/wallet_read`

- 默认走：
  - runtime message 通知
  - direct projection persist
- 不再使用全局 `list_events_after(...)`

## 两种消息模式

系统允许存在两种消息模式，但默认只使用第一种：

### A. 默认模式

跨进程非持久化消息：

- 无回放
- 无历史
- 无消费者即丢弃

### B. 特批模式

持久化可回放消息：

- 只给极少数明确需要可靠投递或审计的场景
- 不进入同步主路径
- 不作为日常模块联动默认模型

## 禁止事项

禁止：

1. 模块直接写 SQLite
2. 模块直接写 `state.json`
3. 模块直接写运行期 snapshot 文件
4. 子进程自己做 projection catch-up
5. 默认把业务更新写入全局持久化消息日志

## 错误处理策略

改造过程中：

1. 默认按设计继续自动推进
2. 某一类错误出现时，优先采用当前设计中的第一修复方案
3. 同一类错误连续出现 3 次以上，再暂停并人工讨论

## 迁移顺序

1. 固定设计边界
2. 收口自动同步触发链路
3. 抽象跨进程 `runtime bus`
4. 把当前 writer 升级成唯一 `persist`
5. 去掉 `sync` 残余旧 `event_log` 依赖
6. 迁移 `bhs`
7. 迁移 `catalog`
8. 迁移 `profile`
9. 迁移 `local_state`
10. 迁移 `wallet_read`

## 备注

`docs/EVENT_BUS_ARCHITECTURE_V1.md` 中“`event_log` 是默认事实源 / projection 可由 event_log 重放恢复”的模型，不再作为当前主方向。

当前主方向以本文件为准。
