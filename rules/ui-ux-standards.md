# PiDeck UI/UX Development Standards

> These standards apply to new components, interaction fixes, and visual adjustments in `apps/desktop/src/renderer`.
> They translate the high-priority rules from UI/UX Pro Max into constraints for PiDeck's desktop workspace.

## 1. Design Direction

PiDeck is a local developer tool, not a marketing page. The interface uses:

- A technical workspace layout with moderate information density.
- A clear primary/secondary hierarchy: sessions, conversation, execution progress, approvals, Provider/permission settings.
- Low-saturation neutral colors as the base; orange emphasizes danger/primary actions, green means success, amber means waiting, red means failure.
- SVG line icons; do not use Emoji as functional icons.
- Visual effects serve state expression; do not add animation to every element for decoration.

## 2. Accessibility (Highest Priority)

- Every icon button must have both `aria-label` and `title`.
- Every input must have a `label`, `aria-label`, or an associated description.
- Normal text contrast must reach at least WCAG 4.5:1; a disabled state must not be the only state information.
- All interactive elements must have a visible `:focus-visible` state.
- Modal, Drawer, and Command Palette must:
  - Focus the first interactive element when opened.
  - Trap Tab cycling within the overlay.
  - Close by layer on Escape.
  - Restore focus to the previously focused element on close.
- Provide a skip link to the main content.
- Dynamic status uses `role="status"`, `aria-live="polite"`, or `role="alert"`.
- Images must have meaningful `alt`; purely decorative images must also be handled explicitly.
- Do not use color as the only state expression; also provide differences in text, icon, shape, or animation.

## 3. Interaction and State

Every asynchronous operation has at least four states: `idle`, `loading`, `success/ready`, `error`.

- Show a skeleton, spinner, or explicit waiting copy when loading exceeds about 300ms.
- Disable repeated actions while submitting, authorizing, deleting, or switching permissions.
- Errors must appear near the related action and provide a retry or repair action.
- Approval requests must show tool name, arguments, risk state, and allow/deny actions.
- Switching sessions must not leak the old session's streaming messages, approvals, or running state into the new session.
- The session list uses a right-side spinner for running; awaiting approval uses a distinct warning state; do not stack meaningless status dots on the left.
- Important actions must be completable by click, not rely on hover alone; hover is only for supplementary information.

## 4. Command Input

- Normal text, `/command`, `/skill:name`, and `@file` must be distinguishable but not glaring.
- Slash highlighting may only apply to commands in Pi's dynamic command catalog, or to `/skill:*` that Pi explicitly supports; do not use "a `/` appears" as the condition.
- `/` inside paths, ratios, URLs, and normal sentences must not be treated as a command.
- Command suggestions must come from Pi Runtime; a static list is only a fallback when unavailable.
- After pasting images, show thumbnails above the input and allow removing them one by one; sending must work even with images but no text.
- The input's visual highlight layer must not break the native textarea's keyboard selection, caret, or scroll sync.
- Enter sends, Shift+Enter inserts a newline; shortcuts must not steal characters inside the input.

## 5. Conversation and Execution Progress

- User messages, Assistant replies, Thinking, Tool Call, and Tool Result have clear hierarchy.
- One `agent_start → agent_end/agent_settled` forms one execution group.
- An execution group shows only a summary by default: number of thinking segments, number of tool calls, and duration.
- When expanded, show tool name, arguments, results, and errors in chronological order.
- Tool Results must not be re-displayed as regular messages.
- Long arguments, results, and code must use `pre-wrap`, a max height, and independent scrolling; they must not break the conversation layout.
- Switching sessions jumps directly to the saved or latest position; do not play cross-session smooth-scroll animations.
- TaskId isolation, stable timeline items, restart restoration, and long-session constraints follow [Renderer session timeline and scrolling rules](renderer-session-timeline.md) (§1 and §3).

## 6. Animation and Performance

- Keep normal interaction animations at 150–300ms; animate only `transform` and `opacity`.
- Do not use continuous scroll listeners that cause expensive reflows.
- Implement `@media (prefers-reduced-motion: reduce)` to disable non-essential animations and scroll animations.
- Keep only a few meaningful dynamic states on screen: running spinner, loading skeleton, overlay entrance animation.
- Long sessions must bound the number of mounted rows by folding older messages behind a "show earlier" affordance; do not render thousands of messages unconditionally. Do **not** solve this with a virtual list — see [Renderer session timeline and scrolling rules](renderer-session-timeline.md) §4 for why measurement-based virtualization is incompatible with asynchronously sized rows.
- Do not add `contain` or `content-visibility` to timeline rows: they must be free to resolve their own height so native scroll anchoring can compensate.
- Images use thumbnails and constrained sizes; do not let user-pasted originals blow out the input or conversation area.
- Keep third-party Markdown rendering lazy-loaded so it does not block the first-paint workspace.

## 7. Responsive Layout

Acceptance widths include at least: 375, 560, 760, 1024, 1440px.

- Below 560px, hide non-core sidebars and keep primary actions in the conversation and input.
- Below 760px, the Inspector uses a drawer and must not squeeze the main conversation.
- Touch targets should be at least 44px; desktop compact controls must not be smaller than 32px and must have a keyboard-reachable path.
- Popover, Tooltip, and Command Palette must not be clipped by a parent `overflow: hidden`.
- Any fixed overlay must avoid the input, Inspector, Toast, and system bounds.

## 8. Copy and Data Boundaries

- All visible zh/en copy lives in `packages/i18n/src/index.ts`; components read keys only (see AGENTS.md Code Boundaries).
- Copy should state the current state and the next action; avoid showing only "failed".
- Context usage, models, permissions, and Provider state shown in the UI must come from the Pi Bridge's real APIs.
- Do not disguise planned capabilities as supported; on failure, show an actionable error.

## 9. Checks Before and After Changes

### Before Development

When a UI/UX Pro Max skill is available, run its search with these queries to load relevant design-system and interaction constraints:

```bash
python3 "$UI_UX_PRO_MAX_SEARCH" "desktop developer tool React accessibility" --design-system -p PiDeck
python3 "$UI_UX_PRO_MAX_SEARCH" "focus modal keyboard loading motion" --domain ux
```

`$UI_UX_PRO_MAX_SEARCH` points at the skill's `scripts/search.py`; when the skill is not installed, rely on §1–§8 directly.

### Before Commit

- [ ] Running, awaiting approval, failure, empty state, and loading state all have clear visual feedback.
- [ ] The main flows are completable by keyboard; Modal focus can enter/exit/restore.
- [ ] Touch sizes, focus rings, contrast, and reduced-motion have been checked.
- [ ] Commands, Skills, and file references do not falsely highlight normal text.
- [ ] Images, long text, and long commands do not overflow in small windows.
- [ ] New IPC updates `packages/contracts` first.
- [ ] New copy is synced to both zh and en i18n.
- [ ] Structure or UI capability changes are synced to `docs/`.
- [ ] `npm run typecheck` and `npm run build` pass.
- [ ] `npm run test:renderer` passes and covers message order, turn grouping, stable keys, restart summaries, and long-session boundaries.
