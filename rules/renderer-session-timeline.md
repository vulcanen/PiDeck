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
- The workspace shell, sidebar, session panel, and global overlays live in `app-view.tsx`, `app-sidebar.tsx`, `app-conversation.tsx`, and `app-overlays.tsx` respectively. Presentational components live under `renderer/ui/` (timeline in `ui/message-timeline.tsx`, input in `ui/composer.tsx`) and are re-exported through `ui/index.ts`; do not reintroduce a single catch-all component file.
- State and side effects are placed by responsibility in hooks such as `use-app-controller.tsx`, `use-session-data.ts`, `use-runtime-events.ts`, `use-conversation-scroll.ts`, and `use-stream-deltas.ts` (bounded streaming-delta batching).
- Timeline construction rules live in `timeline-utils.ts`; do not reassemble execution groups from the message array in JSX, to avoid different turn groupings from different entry points.

## 3. Timeline Stability

- Thinking summaries, streaming replies, and the final persisted reply must be stable timeline items of the same logical turn: the execution summary of an active turn uses a stable key, and the streaming reply and the final Assistant message must reuse the same response key. Do not unmount/rebuild them through footer, temporary nodes, and final messages interchangeably.
- Each session, each turn, and each execution group must be isolated by `taskId`. When a message has no Pi id, use a stable role/timestamp/content identity; do not use array index as a long-term key.
- `agent_start → turn/message/tool events → agent_end/agent_settled` must only update the state of the corresponding turn, not trigger a rebuild of the whole page or the whole message list.
- When adding or changing message snapshot merge logic, preserve Pi's canonical order; do not reorder queued turns by timestamp.

## 4. Long Sessions and Scroll Containers

- **Do not reintroduce a virtual list.** Rows render in plain document flow, the same way ChatGPT and Claude desktop render transcripts. Agent messages contain asynchronously sized content (Mermaid SVG, KaTeX, syntax highlighting) whose height is unknown until after paint; any measurement cache is permanently one paint stale, which is what produced jumping, overlapping rows and rubber-banding.
- Long sessions are bounded by **folding, not virtualization**: only the newest `FOLD_WINDOW` (200) items stay mounted, older ones sit behind a "show earlier" button that reveals `FOLD_STEP` (200) more. Because the window is measured from the end, a growing conversation never has to touch that state.
- `.conversation-scroll` must keep `overflow-anchor: auto`. This is load-bearing: native scroll anchoring is the whole anti-jump mechanism now that heights resolve late. `overflow-anchor: none` was a virtual-list-era setting and must not come back.
- Timeline rows must not use absolute positioning, transforms, `contain`, or `content-visibility`. Rows must be free to resolve their own height, and containment would create a containing block that defeats scroll anchoring.
- Revealing earlier messages must **not** manually compensate the scroll offset. Native anchoring already holds the reader's row in place; doing both double-corrects and reintroduces the jump this replaces.
- Each Session keeps its own pane; inactive panes are hidden with `visibility: hidden` (plus `opacity`/`pointer-events`), **never** `display: none`. Keeping the layout box is what makes the browser preserve each pane's `scrollTop` for free — do not add manual save/restore logic on task switch.
- The persisted snapshot is only `{ top, follow }`. Do not grow it back into a measurement cache.
- When opening a session for the first time with no saved position, jump to the latest message; with a saved position, restore the offset. The first-paint effect must run once (guarded by a ref), because later task switches are pure visibility changes.
- Late resizes from Mermaid/KaTeX land after React's layout effects. Re-pin from a `ResizeObserver` on the list host, and only when follow is `true`; non-following readers are handled by scroll anchoring alone.

## 5. Auto-follow and User Scrolling

- "Follow the latest message" is an explicit state, not equivalent to "within some threshold of the bottom". When the user scrolls up, set follow to `false` immediately, even if still within the 80px threshold.
- **Leaving follow must be driven by a real input gesture** (`wheel` with `deltaY < 0`, or a touch drag while a finger is down) — never by inferring direction from a shrinking `scrollTop`. The transcript legitimately shrinks when a live row is replaced by the final message, the working indicator disappears, or an execution summary collapses; a delta-based guess reads that as "the user scrolled up" and silently kills auto-scroll mid-stream.
- Touch is the one exception that may infer direction, because it emits no wheel events — and only while the touch is active, since a programmatic pin cannot happen with a finger down.
- A programmatic smooth scroll reports "not at the bottom" for its whole duration. Latch follow with a pinning flag while it is in flight (with a timeout safety valve so an interrupted scroll cannot leave it latched), otherwise the "jump to latest" button flashes back on mid-animation.
- Restore follow only when the user scrolls back to the bottom, clicks "jump to latest", or explicitly sends a new message.
- `scrollToLatest` must record the follow *intent*, not just the current offset: `sendPrompt` calls it before the optimistic message exists, so the flag is what keeps the viewport pinned once the new rows render.
- For queue list changes, formal insertion of queued messages, a queued turn starting processing, and streaming text growth, auto-scroll only when follow is `true`.
- Do not trigger expensive React list recomputation on every scroll event; use lightweight DOM snapshots and passive listeners. Scroll handlers must not call `onAtEndChange` from an inactive pane.
- Any auto-follow fix must verify: scrolling up from the bottom does not jerk, an intentional swipe up is not pulled back, switching sessions still restores the original position, and first open still lands at the latest position.

## 6. Timestamps and Hover Information

- Message dates are auxiliary information, hidden by default, shown only on message hover/focus; user messages and Assistant messages must use the same accessible hover/focus behavior.
- Do not display message times with a global fixed date, the previous Session's date nodes, or absolutely positioned elements across panes.
- Date formatting lives in `message-utils.ts`; visible copy and localized formats come from `packages/i18n`.

## 7. Pre-commit Regression Checklist

- [ ] On first launch, each Session is at its latest message.
- [ ] After scrolling up, switching Session and back keeps the position unchanged.
- [ ] A message containing Mermaid/KaTeX/highlighted code does not shift the reader's position when it finishes rendering above the viewport.
- [ ] Sending a new message pins to the bottom and stays pinned through streaming; the reply completing (live row → final message) does not drop follow.
- [ ] "Jump to latest" scrolls smoothly without the button flashing back on mid-animation.
- [ ] A session longer than 200 items shows the "show earlier" button, and expanding it does not jump the viewport.
- [ ] Thinking summaries, streaming replies, and final replies do not jitter or reorder the whole list at the moment of completion.
- [ ] Queue additions, insertions, processing, and streaming growth auto-follow when at the bottom; they do not steal position after scrolling up.
- [ ] After a restart, historical turns with `pideck.execution-run` metadata show the exact duration consistent with runtime; old sessions do not fake durations.
- [ ] Message dates appear only on hover/focus, with no stale Session residue.
- [ ] Run `npm run typecheck`, `npm run test:renderer`, `npm run build`, and `git diff --check`.
