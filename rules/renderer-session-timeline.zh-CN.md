# Renderer 会话时间线与滚动规则

> 本规则适用于 `apps/desktop/src/renderer` 的会话消息、流式回复、执行摘要、排队消息和长会话性能改动。
> 这些规则来自会话切换、滚动恢复、队列跟随和“思考 → 正式回复”抖动问题的实际修复。

## 1. 事实来源与状态边界

- Pi `AgentSession.messages` / Session JSONL 是消息事实来源；Renderer 只保存可序列化 DTO，不复制一套消息数据库。
- Pi 持久化的是原始 `thinking`、`toolCall`、`toolResult` 和正式消息内容，不保证存在“已处理 xx 秒”这样的现成 UI 摘要。
- `TaskUiState.activity`、`streamText` 和 `completedActivity` 是当前 Renderer 生命周期的运行时状态，重启后会丢失。
- 历史执行摘要的步骤内容优先从 Pi 保存的 thinking/tool 内容重建；精确耗时只读取 PiHost 通过 `SessionManager.appendCustomEntry()` 写入的 `pideck.execution-run` 元数据，不从用户/助手消息时间戳推断。
- 不要把 Renderer 的活动详情写回 Pi Session，也不要为了恢复 UI 位置改动 Pi Session 文件格式。允许 PiHost 使用 Pi 官方 custom entry API 保存最小化、可版本化的运行起止元数据；该数据不得进入 LLM context。

## 2. Renderer 结构

- `App.tsx` 只负责调用 `useAppController()` 并组合 `AppView`。
- 工作区、侧栏、会话面板和输入框分别放在 `app-view.tsx`、`app-sidebar.tsx`、`app-conversation.tsx` 和 `ui-components.tsx`。
- 状态和副作用按职责放在 `use-app-controller.tsx`、`use-session-data.ts`、`use-runtime-events.ts`、`use-conversation-scroll.ts` 等 Hook 中。
- 时间线构建规则集中在 `timeline-utils.ts`；不要在 JSX 中重新按消息数组拼装执行组，避免不同入口产生不同的 turn 分组。

## 3. 时间线稳定性

- 思考摘要、流式回复和最终持久化回复必须是同一逻辑回合的稳定时间线项。
- 活动回合的执行摘要使用稳定 key；流式回复与正式 Assistant 消息必须复用同一个 response key。禁止通过 footer、临时节点和正式消息互相卸载重建。
- 每个会话、每个回合和每个 execution group 必须按 `taskId` 隔离。消息没有 Pi id 时使用稳定的 role/timestamp/content identity，不能用数组 index 作为长期 key。
- `agent_start → turn/message/tool events → agent_end/agent_settled` 只更新对应回合的状态，不触发整个页面或整个消息列表重建。
- 新增或修改消息快照合并逻辑时，必须保留 Pi 的 canonical order，不能按 timestamp 重新排序排队回合。

## 4. 长会话与滚动容器

- 长会话使用 TanStack Virtual 的单一滚动容器；不要同时维护父级 `scrollTop`、子级滚动容器和第二套虚拟 offset。
- 每个 Session 保留自己的 pane、virtualizer snapshot、DOM `scrollTop`、follow 状态和测量缓存；切换 Session 不卸载已访问 pane，也不播放跨会话平滑滚动动画。
- 首次打开会话且没有保存位置时定位到最新消息；有保存位置时恢复用户位置。保存位置优先使用真实 DOM `scrollTop`，不能只使用 TanStack 内部 offset。
- 虚拟项的 `measureElement` 与 `content-visibility` 不能互相隐藏或伪造高度。不要给需要测量的消息/执行摘要行盲目添加 `content-visibility: auto`；虚拟列表已经负责减少 DOM 数量。
- 初次布局、队列插入或最后一项高度变化后，如需校正到底部，必须在测量完成后的 `requestAnimationFrame` 执行，并再次检查用户是否仍处于 follow 状态。

## 5. 自动跟随与用户滚动

- “跟随最新消息”是显式状态，不等同于“距离底部小于某个阈值”。用户向上滚动时必须立即将 follow 设为 `false`，即使仍在 80px 阈值内。
- 只有用户重新滚到底部、点击“回到最新消息”或明确发送新消息时，才恢复 follow。
- 排队列表变化、排队消息正式插入、排队回合开始处理和流式文本增长时，只在 follow 为 `true` 时自动滚动；自动滚动要在新虚拟项提交/测量后执行。
- 不要在每次 scroll 事件里触发昂贵的 React 列表重算；使用轻量 DOM 快照、passive listener 和虚拟器回调。
- 任何自动跟随修复都必须验证：底部上滚不抽动、主动上滑不被拉回、切换会话仍恢复原位置、首次打开仍在最新位置。

## 6. 时间戳与悬浮信息

- 消息日期属于辅助信息，默认隐藏，仅在消息 hover/focus 时显示；用户消息和 Assistant 消息必须使用同一套可访问的 hover/focus 行为。
- 不允许用全局固定日期、上一个 Session 的日期节点或跨 pane 的绝对定位元素显示消息时间。
- 日期格式化集中在 `message-utils.ts`，可见文案和本地化格式来自 `packages/i18n`。

## 7. 提交前回归清单

- [ ] 首次启动每个 Session 在最新消息处。
- [ ] 用户上滑后切换 Session 再切回，位置和虚拟测量缓存保持不变。
- [ ] 思考摘要、流式回复、正式回复不会在完成瞬间抖动或重排整个列表。
- [ ] 排队新增、插入、处理和流式增长在底部时自动跟随；上滑后不抢位置。
- [ ] 重启后有 `pideck.execution-run` 元数据的历史回合显示与运行时一致的精确耗时；旧会话不伪造耗时。
- [ ] 消息日期只在 hover/focus 显示，且没有旧 Session 残留。
- [ ] 运行 `npm run typecheck`、`npm run test:renderer`、`npm run build` 和 `git diff --check`。
