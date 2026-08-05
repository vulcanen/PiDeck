# Renderer Session Timeline and Scrolling Rules

> These rules apply to changes in `apps/desktop/src/renderer` involving session messages, streaming replies, execution summaries, queued messages, and long-session performance.
> They come from real fixes for session switching, scroll restoration, queue following, and "thinking → final reply" jitter.

## 1. Source of Truth and State Boundaries

- Pi `AgentSession.messages` / Session JSONL is the source of truth for messages; the Renderer stores only serializable DTOs and does not duplicate a message database.
- Pi persists raw `thinking`, `toolCall`, `toolResult`, and final message content; it does not guarantee a ready-made UI summary such as "processed for xx seconds".
- `TaskUiState.activity`, `streamText`, and `completedActivity` are runtime state of the current Renderer lifecycle and are lost after a restart.
- The step content of historical execution summaries should preferably be rebuilt from Pi's saved thinking/tool content; exact durations must only be read from the `pideck.execution-run` metadata that PiHost writes via `SessionManager.appendCustomEntry()`, never inferred from user/assistant message timestamps.
- Do not write Renderer activity details back into the Pi Session, and do not change the Pi Session file format to restore UI positions. PiHost may use Pi's official custom entry API to store minimal, versionable run start/end metadata; that data must not enter the LLM context.

## 2. Renderer Structure

- `App.tsx` only calls `useAppController()` and composes `AppView`.
- The workspace, sidebar, session panel, and input live in `app-view.tsx`, `app-sidebar.tsx`, `app-conversation.tsx`, and `ui-components.tsx` respectively.
- State and side effects are placed by responsibility in hooks such as `use-app-controller.tsx`, `use-session-data.ts`, `use-runtime-events.ts`, and `use-conversation-scroll.ts`.
- Timeline construction rules live in `timeline-utils.ts`; do not reassemble execution groups from the message array in JSX, to avoid different turn groupings from different entry points.

## 3. Timeline Stability

- Thinking summaries, streaming replies, and the final persisted reply must be stable timeline items of the same logical turn.
- The execution summary of an active turn uses a stable key; the streaming reply and the final Assistant message must reuse the same response key. Do not unmount/rebuild them through footer, temporary nodes, and final messages interchangeably.
- Each session, each turn, and each execution group must be isolated by `taskId`. When a message has no Pi id, use a stable role/timestamp/content identity; do not use array index as a long-term key.
- `agent_start → turn/message/tool events → agent_end/agent_settled` must only update the state of the corresponding turn, not trigger a rebuild of the whole page or the whole message list.
- When adding or changing message snapshot merge logic, preserve Pi's canonical order; do not reorder queued turns by timestamp.

## 4. Long Sessions and Scroll Containers

- Long sessions use a single TanStack Virtual scroll container; do not maintain a parent `scrollTop`, child scroll containers, and a second set of virtual offsets at the same time.
- Each Session keeps its own pane, virtualizer snapshot, DOM `scrollTop`, follow state, and measurement cache; switching Sessions does not unmount visited panes, nor play cross-session smooth-scroll animations.
- When opening a session for the first time with no saved position, jump to the latest message; with a saved position, restore the user's position. Saved positions must prefer the real DOM `scrollTop`, not only TanStack internal offsets.
- A virtual item's `measureElement` and `content-visibility` must not hide or fake each other's heights. Do not blindly add `content-visibility: auto` to message/execution-summary rows that need measurement; the virtual list already reduces DOM count.
- After initial layout, queue insertion, or a last-item height change, if a correction to the bottom is needed, run it in a `requestAnimationFrame` after measurement completes and re-check whether the user is still in follow state.

## 5. Auto-follow and User Scrolling

- "Follow the latest message" is an explicit state, not equivalent to "within some threshold of the bottom". When the user scrolls up, set follow to `false` immediately, even if still within the 80px threshold.
- Restore follow only when the user scrolls back to the bottom, clicks "jump to latest", or explicitly sends a new message.
- For queue list changes, formal insertion of queued messages, a queued turn starting processing, and streaming text growth, auto-scroll only when follow is `true`; auto-scroll must run after the new virtual item is committed/measured.
- Do not trigger expensive React list recomputation on every scroll event; use lightweight DOM snapshots, passive listeners, and virtualizer callbacks.
- Any auto-follow fix must verify: scrolling up from the bottom does not jerk, an intentional swipe up is not pulled back, switching sessions still restores the original position, and first open still lands at the latest position.

## 6. Timestamps and Hover Information

- Message dates are auxiliary information, hidden by default, shown only on message hover/focus; user messages and Assistant messages must use the same accessible hover/focus behavior.
- Do not display message times with a global fixed date, the previous Session's date nodes, or absolutely positioned elements across panes.
- Date formatting lives in `message-utils.ts`; visible copy and localized formats come from `packages/i18n`.

## 7. Pre-commit Regression Checklist

- [ ] On first launch, each Session is at its latest message.
- [ ] After scrolling up, switching Session and back keeps the position and virtual measurement cache unchanged.
- [ ] Thinking summaries, streaming replies, and final replies do not jitter or reorder the whole list at the moment of completion.
- [ ] Queue additions, insertions, processing, and streaming growth auto-follow when at the bottom; they do not steal position after scrolling up.
- [ ] After a restart, historical turns with `pideck.execution-run` metadata show the exact duration consistent with runtime; old sessions do not fake durations.
- [ ] Message dates appear only on hover/focus, with no stale Session residue.
- [ ] Run `npm run typecheck`, `npm run test:renderer`, `npm run build`, and `git diff --check`.
