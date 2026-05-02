# BHS Triggered Sync Allocation V1

## Goal

定义一个简单、可执行的节点分配策略：

- `BHS` 作为唯一高度来源
- 主线程统一控制“追块”和“钱包”
- 同步不再视为常驻线程，而是按需启动的追块任务
- 首次大落后时给同步更多节点
- 平时只在发现新块时用少量节点追尾

## Core Decisions

### 1. Single Height Authority

当前版本中，`BHS tip` 是唯一高度来源。

系统统一使用：

- `bhsTip`
- `localHeight`
- `lag = bhsTip - localHeight`

来决定是否追块、追块规模、钱包是否可用。

不再用 `p2pTipHeight` 决定是否触发追块。

### 2. Main Thread Owns Orchestration

主线程负责：

- 读取 `BHS` tip
- 判断当前 `lag`
- 决定是否启动 sync job
- 决定 wallet listener 是否启动或停止
- 决定当前节点预算给 wallet 还是给 sync

`independent_sync_service` 只负责执行一次追块任务，不负责长期策略。

### 3. Sync Is a Job, Not a Resident Role

同步被定义为“追块过程”，不是一个常驻线程角色。

语义如下：

- 需要追块时启动一次 sync job
- sync job 结束后释放节点和 lease
- 下一次再由主线程根据 `BHS` tip 决定是否重新启动

## Operating Modes

### Mode A: Full Sync Priority

触发条件：

- `lag >= 16`

资源策略：

- sync 最多使用 `16` 个节点
- wallet 不可用
- 主线程不启动 wallet listener

产品语义：

- 当区块落后明显时，优先尽快追平区块
- 此阶段钱包不提供可用性承诺

### Mode B: Catch-up Sync

触发条件：

- `0 < lag < 16`
- 且 `bhsTip > localHeight`

资源策略：

- sync 最多使用 `2` 个节点
- sync 优先获得所需节点
- 后续追块阶段允许使用原本钱包优选节点
- 在满足 sync 之后，如仍有空闲节点，则继续分配给 wallet listener
- 如果某一时刻 sync 实际只占用少于 `2` 个节点，剩余空闲节点仍可继续给 wallet 使用
- wallet 可看、可监听、不可发送

产品语义：

- 平时只做小规模追尾
- 一旦有新块，由主线程触发一次小同步
- catch-up 阶段 wallet 是否可继续可用，取决于 sync 占用后是否还有剩余可工作的 listener 节点

### Mode C: Wallet Active

触发条件：

- `bhsTip <= localHeight`

资源策略：

- wallet listener 正常运行
- 钱包默认持有 `8` 个优选节点用于监听/发送
- 没有活跃 sync job

## Trigger Rules

### Startup

软件启动后：

1. 读取 `bhsTip`
2. 读取 `localHeight`
3. 计算 `lag`

如果：

- `lag > 0`

则主线程根据 `lag` 决定：

- `lag >= 16`：启动 Full Sync Priority
- `0 < lag < 16`：启动 Catch-up Sync

### Runtime

运行过程中：

- `BHS` 持续更新 tip
- 主线程定期读取 `BHS` 状态
- 当发现 `bhsTip > localHeight` 时，触发追块

当前建议：

- `BHS` 本身默认每 `15s` 更新一次
- 主线程按 `15s` 周期检查一次 `BHS` 状态

## Dynamic Target Height

`catchup_sync` 和大同步都不是固定目标高度。

规则：

- sync job 启动时记录一个初始 `targetHeight`
- 执行过程中如果 `BHS tip` 继续前进
- 则把当前 job 的 `targetHeight` 动态更新为新的更高高度

也就是：

- 不追到“启动时看到的 tip”
- 而是追到“当前最新 BHS tip”

## Failure Handling

后续追块失败时，不进入终止态，不切换到“钱包优先并停止追块”。

规则：

- 某个节点失败后，立即换下一个节点
- sync job 持续运行，直到成功追上目标高度

这意味着：

- “失败”主要是节点级失败
- 不是策略级失败

## Wallet Rules

### During Full Sync

- wallet 不可用
- 不启动 listener
- 不要求发送可用
- 不要求余额/历史/UTXO 对外可用

### After Sync Completes

- 当 `bhsTip <= localHeight` 时，主线程负责启动 wallet listener
- 不需要额外再跑一次“钱包同步”
- 区块处理本身负责把本地钱包索引推进到可用状态

### During Catch-up Sync

- wallet 可以继续显示余额和历史
- wallet 在有剩余节点时可以继续监听事件
- wallet listener 能保留时尽量保留
- wallet 发送功能不可用
- sync 先拿节点，wallet 使用剩余容量
- 如果 sync 占用后没有剩余 listener 节点，则 wallet 进入不可用态

## Required Implementation Meaning

“同步用 2 个节点”或“同步用 16 个节点”的语义是：

- sync job 在任意时刻的**总同时占用节点数上限**

不是：

- 每个块每轮尝试 2 个节点

这点必须严格执行。

否则会出现名义上只给 `2` 个节点，实际上同步仍然并发占用很多节点的问题。

## Suggested State Fields

建议主线程维护这些最小状态：

- `bhsTip`
- `localHeight`
- `lag`
- `syncMode`: `idle` | `full_sync` | `catchup_sync`
- `walletActive`: `true` | `false`
- `syncTargetHeight`
- `syncNodeBudget`

如果继续沿用独立同步状态文件，可补充：

- `jobType`: `full_sync` | `catchup_sync`
- `startedAt`
- `finishedAt`
- `triggerSource`: `startup` | `bhs_tip_advanced` | `manual`

## Wallet Internal State Model

为避免后续实现继续漂移，`wallet.js` 内部建议明确维护一组节点管理状态。

### 1. Candidate State

- `candidatePool`
  - 当前已知候选节点集合
- `candidateScores`
  - 每个候选节点的成功率、延迟、失败次数、冷却状态
- `probeQueue`
  - 待测试或待复测节点

这组状态用于替代原 selector 的候选池、评分、probe 能力。

### 2. Working Pool State

- `workingPool`
  - 当前已进入工作集的节点
- `workingTarget`
  - 正常态期望工作节点数，当前默认 `8`
- `standbyPool`
  - 已验证可用但暂未分配到角色的候补节点

语义上：

- `workingPool` 是 wallet 当前真正可调度的节点全集
- listener / sync / send 都从这个统一工作池中取节点
- 但统一工作池不意味着所有节点对所有角色同样合适

### 2.1 Role Preference Inside Working Pool

统一工作池采用“统一池 + 角色偏好评分”模型，而不是硬角色固定。

每个节点应维护至少这些用途偏好：

- `listenerScore`
  - 节点对 listener / 持续监听 / 回调稳定性的适配分
- `syncScore`
  - 节点对区块同步 / 拉块 / 稳定吞吐的适配分
- `sendScore`
  - 节点对广播 / 发送确认路径的适配分

规则：

- 节点仍属于统一工作池
- wallet 分配时优先按目标角色的用途偏好排序选节点
- 只有当对应角色的高分节点不足时，才跨角色挪用其它节点
- 因此：
  - 某节点可以更适合 `sync`
  - 某节点也可以更适合 `listener`
  - 但它们都仍属于同一个 wallet 工作池

这意味着：

- 统一工作池解决的是“节点主权统一”
- 角色偏好评分解决的是“节点用途并不完全同质”

### 3. Role Assignment State

- `listenerAssigned`
  - 当前分配给 listener 的节点集合
- `syncAssigned`
  - 当前分配给 sync 的节点集合
- `sendAssigned`
  - 当前临时分配给 send 的节点集合
- `listenerTarget`
  - 当前 listener 目标节点数
- `syncTarget`
  - 当前 sync 目标节点数

语义上：

- `listenerAssigned + syncAssigned + sendAssigned` 都是 `workingPool` 的角色切片
- 同一时刻一个节点只能属于一个主角色

为避免分配状态和连接现实混淆，建议进一步拆成两层：

- `listenerAssignedTarget` / `syncAssignedTarget` / `sendAssignedTarget`
  - wallet 当前希望达到的目标分配
- `listenerAssignedActual` / `syncAssignedActual` / `sendAssignedActual`
  - 当前连接切换完成后真正已经生效的分配

规则：

- `Target` 可以先变化
- `Actual` 只能在连接切换完成后更新
- 对外可用性判断只认 `Actual`

### 4. Connection State

- `listenerSessions`
  - listener 当前持有的持久连接
- `syncSessions`
  - sync 当前使用的会话
- `connectingNodes`
  - 正在建立连接的节点
- `disconnectingNodes`
  - 正在回收或切换角色的节点

这组状态用于避免“分配已经切换，但连接现实还没切换”的中间态失控。

### 4.1 Role Switch Discipline

当某个节点需要从 `listener` 切到 `sync` 时，切换顺序必须固定：

1. 先更新目标分配
   - 例如把节点从 `listenerAssignedTarget` 移到 `syncAssignedTarget`
2. 再执行 listener 断开与回调解绑
3. listener 完全退出后，再建立 sync session
4. sync session 建立成功后，更新 `syncAssignedActual`
5. 若 listener 已退出，则同步更新 `listenerAssignedActual`

反向切换（`sync -> listener`）也必须遵守相同原则：

1. 先改 `Target`
2. 再切连接
3. 最后改 `Actual`

禁止：

- 只改分配，不做连接切换
- 连接尚未切完就提前宣布角色已生效
- 对外直接用 `Target` 推导 wallet 可用性

### 5. Availability State

- `walletAvailable`
  - 当前 wallet 是否可对外提供可读可监听能力
- `walletReadable`
  - 当前是否仍允许余额/历史读取
- `walletSendEnabled`
  - 当前是否允许发送
- `availabilityReason`
  - 当前可用性变化原因，例如 `full_sync`, `catchup_no_listener_capacity`

建议规则：

- `listenerAssigned >= 1` 时，wallet 可读且可监听
- `listenerAssigned == 0` 时，wallet 不可用
- catch-up 期间 `walletSendEnabled = false`

更严格地说，应以 `listenerAssignedActual` 为准：

- `listenerAssignedActual >= 1` 时，wallet 可读且可监听
- `listenerAssignedActual == 0` 时，wallet 不可用
- `walletAvailable`、`walletReadable` 都不应从 `Target` 直接推导

### 6. Reallocation Rule

每次 `lag`、sync 需求或节点健康发生变化时，wallet 按以下顺序重算：

1. 先确定 `syncTarget`
2. 从 `workingPool` 中优先满足 `syncAssigned`
3. 用剩余节点填充 `listenerAssigned`
4. 如有发送高优先级需求，再执行显式节点收回
5. 若某角色节点失效，则从 `standbyPool` 或 `candidatePool` 中补位

这条顺序必须固定，避免不同调用路径各自做一次隐式重分配。

补充规则：

- 在执行第 2 步和第 3 步时，应优先选择该角色用途偏好更高的节点
- 只有当高偏好节点不足时，才允许跨角色用途挪用
- catch-up 阶段允许 listener 质量下降，但应优先保护 sync 的高适配节点给 sync 使用

### 7. Catch-up Availability Rule

在 `0 < lag < 16` 时：

- `syncTarget = min(2, 当前实际可用工作节点数)`
- sync 优先获得所需节点
- wallet 使用剩余容量
- 如果 `syncAssigned` 之后 `listenerAssigned >= 1`，则 wallet 继续可读可监听
- 如果 `listenerAssigned == 0`，则 wallet 暂时不可用

这意味着：

- catch-up 是“有剩余容量则可用”
- 不是“始终可用”
- 也不是“一进入 catch-up 就强制不可用”

## Node Capability Semantics

当前方案明确采用以下能力语义：

- 节点不是完全等价资源
- 不同节点对 `listener` / `sync` / `send` 的适配度可以不同
- 但这些差异不再由独立 selector 模块裁决，而由 wallet 内部评分模型维护

因此：

- 不需要把工作池硬拆成“listener 节点池”和“sync 节点池”
- 也不应假设任意节点在所有角色上表现都一样
- 正确实现应是：
  - 一个统一工作池
  - 一套按角色区分的用途偏好评分
  - 一套在节点不足时允许跨用途借用的重分配规则

## Module Responsibilities

### `server_market.js`

负责：

- 读取 `BHS` tip
- 判断 `lag`
- 启停 sync job
- 启停 wallet listener
- 统一模式切换

### `block_headers_service.js`

负责：

- 维护可信 tip 高度
- 向主线程提供 `BHS tip`

不负责：

- 块下载
- 钱包调度

### `independent_sync_service.js`

负责：

- 执行单次 sync job
- 支持动态 `targetHeight`
- 遵守 `syncNodeBudget`
- 结束后释放 lease

不负责：

- 决定 wallet 是否可用
- 决定什么时候开始或停止策略模式

### `wallet.js`

负责：

- 作为唯一节点资源管理器
- 维护统一工作池，并决定节点当前分配给 listener / send / sync
- 在主线程允许时启动 listener
- 在主线程要求时停止或让出节点
- 在需要发送时优先收回节点并组装发送路径
- 维护候选池、评分、probe、working set、补位
- 正常处理监听、发送、索引更新

不应长期负责：

- 绕过统一工作池再维护另一套隐式节点分配
- 让 sync 脱离 wallet 自己抢占节点

## Selector / Wallet Responsibility Cleanup

当前实现里，`wallet.js` 和 selector 存在功能重合：

- selector 已经在做候选池、评分、探测、lease
- wallet 仍在做活跃 listener 连接维护、失败补位、重平衡

长期目标应当收口为：

### Wallet Owns Node Management

`wallet.js` 应成为节点资源的总管。

wallet 应负责：

- 维护统一的 `8` 节点工作池视图
- 吸收原 selector 的候选池、评分、probe、lease、补位能力
- 决定 listener / send / sync 当前各占多少节点
- 在 catch-up 阶段把节点让给 sync
- 在发送发生前按优先级收回节点
- 决定哪些 listener 连接继续保留，哪些需要让位
- 在不打断业务语义的前提下协调重分配

### Runtime / Session Owns Connection Primitive

`p2p_node_runtime.js` 应负责：

- 把 wallet 发出的节点分配变成可用 session
- 统一连接、断开、成功/失败上报
- 提供 fresh / persistent 两类连接原语

### Sync Becomes A Wallet-Controlled Consumer

sync 应作为 wallet 下的节点消费者。

sync 应负责：

- 声明自己当前需要多少节点
- 消费 wallet 分给它的节点完成追块
- 在任务结束后释放占用

不应负责：

- 自己和 listener 抢节点
- 自己定义全局优先级
- 绕过 wallet 单独形成另一套节点调度

### Wallet Owns Business Behavior

wallet 应负责：

- 在已分配节点上建立 listener
- 处理监听到的交易/事件
- 广播与发送业务
- 索引更新

wallet 不应再负责：

- 自己维护独立于总管视图之外的第二套工作池
- 失败后自己盲选替补
- 用自己的局部逻辑和 selector 再实现一套并行调度

### Practical Meaning

未来应逐步收口成：

- wallet 持有统一工作池，并声明当前角色目标
  - 例如 `listenerDesired: 8`
  - `syncDesired: 2`
  - `sendPriority: highest`
- wallet 内部负责候选、lease、替补与分配
- runtime 把分配结果变成 session
- sync 只消费 wallet 分配给它的节点
- 节点失败后由 wallet 内部挑选替补，并决定替补给哪个角色

## Wallet Working Set And Background Probe

钱包正常工作时，采用“两层节点池”：

### 1. Wallet Working Set

- 钱包平台尽量维持 `8` 个优选工作节点
- 这 `8` 个节点主要用于监听和发送
- 如果当前可用优选节点不足，允许少于 `8` 个运行

### 2. Selector Background Probe Pool

- selector 后台持续测试其它候选节点状态
- 测试完成后可以主动断开，不需要长期占用连接
- 这些测试节点用于维护候选池排序、可用性和后备补位来源

### 3. Failure Replacement

- 当钱包工作池中的某个节点失败时
- 不应临时盲选一个新节点
- 应优先从 selector 后台最近测试通过的候选节点中补位

替补优先级应基于：

- 最近成功
- 低延迟
- 对应用途评分高

失败节点则退出工作池，进入冷却或重新探测队列。

## Final Rule Summary

最终规则可压缩为：

1. `BHS` 是唯一高度来源。
2. `lag >= 16` 时，sync 优先，最多 `12` 节点，wallet 不可用。
3. `0 < lag < 16` 时，主线程启动小规模追尾，sync 最多 `2` 节点并优先获得所需节点；如有剩余空闲节点则 wallet 继续可看可监听但不可发，如无剩余 listener 节点则 wallet 暂时不可用。
4. `lag <= 0` 时，sync 空闲，wallet 正常持有 `8` 个优选节点。
5. sync 的目标高度必须动态跟随最新 `BHS tip`。
6. 节点失败后立即换节点，持续追到成功。
7. 首次追平后不需要额外做一次钱包刷新来生成 UTXO。
8. 主线程按 `15s` 周期检查 `BHS` 状态。
9. 当前版本完全信任 `BHS`，不加 fallback 高度源。
10. 钱包正常态尽量维持 `8` 个优选工作节点，并在 wallet 内部持续测试其它候选节点，供失败补位使用。

## Open Boundary Questions

下面这些边界还需要最终确认：

1. wallet 的 `8` 个工作节点是否要区分角色配额

- 例如：
  - `listener` 固定若干
  - `send` 固定若干
- 还是继续把 `8` 个节点视为一个统一工作池

2. Catch-up 阶段 sync 的 `2` 个节点是否有抢占优先级

已确认：

- sync 的 `2` 个节点具有优先级
- 必要时可以挤掉部分 listener 节点
- 但应尽量保留剩余 listener 连接和事件回调能力
- 如果 sync 实际占用后仍有空闲节点，则这些节点继续给 wallet 使用
- 如果 sync 占用后没有剩余 listener 节点，则 wallet 暂时不可用

3. selector 是否只接管“节点集合维护”，还是也接管连接生命周期

已调整方向：

- 原 selector 能力逐步并入 `wallet.js`
- `wallet.js` 成为唯一节点资源管理器
- runtime/session 只保留底层连接原语
- 不再单独保留 selector 作为长期独立调度边界

4. wallet send 是否应单独拥有保底节点

- 当前设计里，send 和 listener 还共享“8 个优选节点”概念
- 是否要给 send 单独留出少量专用节点，还未确定

5. Full Sync 阶段 selector 是否仍要为 wallet 保留只读 listener

- 当前产品语义是 wallet 不可用
- 但前端仍允许查看余额/历史
- 是否需要最小只读监听能力，还是完全不保留连接，仍需明确
