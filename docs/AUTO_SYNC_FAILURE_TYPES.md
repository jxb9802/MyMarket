# 不能自动同步的问题类型清单

更新时间：2026-04-20

这个文档只记录会导致节点不能自动追链、假同步完成、或同步推进异常缓慢的已知类型。普通的单个 P2P 节点超时，如果系统能自动切换备用节点并继续提交窗口，不归为“不能自动同步”。

## 类型 1：BHS 被禁用导致最高高度假正常

触发条件：

- `BSV_MARKET_DISABLE_BHS=1`
- 同时没有其它可靠的 chain http / header source

典型现象：

- `/api/sync/status` 里 `highestBlock` 长时间停在旧高度。
- `lag=0`，但实际上其它节点和 WOC 已经有更高区块。
- 本地 `localHeight` 不推进，因为节点认为自己没有落后。

判定证据：

- Windows 节点曾经停在 `945246`。
- Linux / 公网节点 / WOC 已经到 `945626+`。
- Windows `.env.market` 里曾有 `BSV_MARKET_DISABLE_BHS=1`。

处理状态：

- 已修复 Windows 配置为 `BSV_MARKET_DISABLE_BHS=0`。
- 建议后续增加启动防呆：如果禁用 BHS 且没有其它高度源，不允许进入假 `lag=0` 状态。

## 类型 2：BHS 已更新但没有触发链同步队列

触发条件：

- BHS 正常更新 tip。
- 启动代码只调用 `startBhsRuntimeBridge()`。
- 没有调用会触发 `run_chain_sync` 的 `startBhsDrivenSyncLoop()`。
- 同时 `BSV_MARKET_DISABLE_STARTUP_CHAIN_SYNC=1` 时更容易暴露。

典型现象：

- `bhs.tipHeight` 是新的。
- `localHeight` 落后。
- `commandQueue` 没有新的 `run_chain_sync`，或不会随 BHS tip 变化自动入队。

判定证据：

- Windows 启用 BHS 后，BHS tip 能追到最新，但链同步没有自动开始。
- 启动代码之前是 `startEmbeddedBlockHeadersCore()` 后接 `startBhsRuntimeBridge()`。

处理状态：

- 已改为启动时调用 `startBhsDrivenSyncLoop()`。
- Windows 重启后自动创建 `run_chain_sync`，并从 `945246` 追到最新高度。

## 类型 3：同步 worker 需要区块 hash，但本地 hash 覆盖缺失

触发条件：

- 链同步要处理某个高度。
- 本地 BHS / height-to-hash 覆盖中没有该高度 hash。
- 又没有可用的 chain http source 兜底。

典型现象：

- 队列会反复启动同步任务。
- 同步任务很快失败。
- `localHeight` 不推进。

判定证据：

```text
missing height hash for 945247: no chain http source configured
```

处理状态：

- 这次 Windows 问题中，它是类型 1 和类型 2 的后续表现。
- 根因修复后，BHS 提供连续 hash，worker 正常推进。

## 类型 4：BHS 本地索引/压缩状态损坏或覆盖起点过高

触发条件：

- BHS 本地状态被错误压缩或迁移。
- 只保留了近期窗口，历史高度到 hash 的覆盖不连续。
- 同步要回补较旧高度时，找不到对应 hash。

典型现象：

- BHS tip 可能看起来正常。
- 但同步旧高度或回补时失败。
- 错误通常表现为某个历史高度没有 hash。

判定证据：

- 之前文档和记忆中记录过 BHS 过度裁剪问题。
- 需要检查 BHS checkpoint、tip、以及 height/hash 覆盖范围是否连续。

处理状态：

- 之前已加过 BHS 自修复路径：检测到过度裁剪状态时，从 checkpoint 重建 height-to-hash 映射。

## 类型 5：P2P getblock 节点超时导致同步变慢

触发条件：

- 个别 BSV P2P 节点连接正常，但 `getblock` 长时间无数据。

典型现象：

- 日志出现 `getblock idle timeout`。
- 当前高度窗口第一轮有失败，但第二轮换备用节点后成功。
- `localHeight` 仍持续推进。

判定证据：

```text
getblock idle timeout: 162.19.222.167:8333
independent_sync_window_finished ... failedCount:0
```

处理状态：

- 这不是“不能自动同步”，只是同步变慢。
- 已有备用节点重试机制。
- 可优化：降低慢节点权重，`parallelBlocks` 不要超过健康优选节点数量。

## 当前统计

目前清单里共有 5 类：

1. BHS 被禁用导致最高高度假正常。
2. BHS 已更新但没有触发链同步队列。
3. 同步 worker 需要区块 hash，但本地 hash 覆盖缺失。
4. BHS 本地索引/压缩状态损坏或覆盖起点过高。
5. P2P getblock 节点超时导致同步变慢。

其中真正会导致“不能自动同步”的是类型 1、2、3、4。类型 5 目前只是性能和稳定性风险，不是硬故障。
