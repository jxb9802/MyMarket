# P2P getBlock 超时接手方案 v1

## 目标
- 只做“硬超时后接手”。
- 不做提前竞速，不做同块双发。
- 避免单个节点 `getBlock` 卡住时拖死整轮同步。

## 当前实现结论
- 当前模型是“每个节点一个 worker，从共享任务队列取块后串行下载”。
- 单个 worker 在 `peer.getBlock(hash)` 超时前会一直卡住。
- 超时后任务会被重新放回队列，等待别的 worker 再领取。
- 因此当前已有“超时后重试”的雏形，但没有每高度的独立状态机保护。

## v1 建议边界
- 一个高度任意时刻只允许一个 owner。
- 只有 owner 的 `getBlock` 硬超时后，才允许把该高度重新置回 `queued`。
- 下一次领取时，优先交给其他健康节点，避免原慢节点立刻再次拿回。

## 必须有的状态字段
```js
{
  height,
  hash,
  status: 'queued' | 'inflight' | 'done' | 'failed',
  ownerNode: '',
  ownerAttemptId: 0,
  retries: 0,
  lastError: '',
  lastTimedOutNode: '',
  resultCommitted: false,
}
```

## 必须守住的状态机规则
1. 旧 attempt 不得回写当前任务状态。
2. 中途超时但仍可接手时，不得写入 `failedHeights`。
3. 同一高度只允许一次成功提交。
4. 超时节点下一轮不得优先重新领取同一高度。

## 主风险
- 如果继续只用裸 `tasks` 数组表达任务状态，容易出现旧 worker 回写、重复失败、重复完成。
- 如果没有 `ownerAttemptId`，超时后的旧执行流可能污染新 owner 的任务状态。
- 如果没有 `resultCommitted`，后续扩展时很容易出现重复提交。

## 推荐实施顺序
1. 先把“高度任务状态”从队列元素中抽离。
2. 保持单 owner 语义，只做超时后重新入队。
3. 补日志，验证“超时后由其他节点接手”是否真实发生。
