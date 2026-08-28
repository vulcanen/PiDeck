# Pi CLI → PiDeck Current Feature Matrix

> This document records only capabilities already integrated in the current repository. Unimplemented capabilities are explicitly marked; product plans are not written as current state.
> The authoritative sources are the installed `@earendil-works/pi-coding-agent`, `packages/contracts`, and the PiHost implementation.

## Integrated

| Pi capability | PiDeck entry point | Current implementation |
| --- | --- | --- |
| Project discovery, browsing, removal | Left project tree; multiple projects expand at once, clicking a project only toggles its own expansion, right-click removes from the list; below 560px a top button opens the focus-trapped session drawer and makes the background inert | `SessionManager.listAll()` + Main ordered/hidden `cwd` list → `projects.list` / `projects.remove`; removal never deletes project files or Pi Sessions |
| Session list and switching | Sessions of any expanded project are listed newest-first; only clicking a specific session switches the central workspace | `SessionManager.list(cwd)` / `updatedAt`; each expanded group renders from its own `projectTasksByCwd[cwd]` cache so cross-project intermediate renders cannot borrow the previous project's rows |
| Create session | New task; the "new task" button for expanded projects without sessions; empty-state button | `SessionManager.create(cwd)` |
| Session messages | Central conversation thread | Full active transcript from `SessionManager.getBranch()` projected with Pi's `sessionEntryToContextMessages()`; `AgentSession.messages` remains the compacted model context, so pre-compaction turns stay visible after restart; Skill references are layered separately from the user's original text per Pi's `parseSkillBlock()` semantics |
| Execution duration restore | "Processed" execution summary | PiHost records execution groups at `agent_start`, Follow-up group boundaries, and `agent_settled`, writing precise start/end times into the Pi Session via `SessionManager.appendCustomEntry("pideck.execution-run", ...)`; Steering merges into the same group; `sessions.runMetadata` restores after restart; old sessions never fake durations |
| Session naming | Session list and conversation title | After the first user message: first `deriveSessionTitle` produces a prefix-stripped short title persisted via `sessions.rename` (Pi `AgentSession.setSessionName()`) as the reload-safe fallback; then the `sessions.generateTitle` bridge (PiHost summarizes the first message into 3–8 words via `ModelRuntime.complete`) asynchronously upgrades the title and persists again via `sessions.rename`. Upgrade happens only while the title is still a truncated/placeholder name; manual renames are never overwritten; LLM failure falls back to the truncated title |
| Session deletion | Session more menu | `sessions.delete(taskId, cwd)`; PiHost keys runtime state by normalized project path plus session ID, so same-ID imported sessions in other projects are untouched |
| Session position and long sessions | Central conversation thread (plain document flow + earlier-message folding) | No virtual list; only the most recent 200 messages stay mounted, older ones fold behind a "show earlier" button. Anti-jump relies on native scroll anchoring via `overflow-anchor: auto`; inactive panes keep `scrollTop` naturally with `visibility: hidden` and suspend their DOM observers; follow exits only on real wheel/touch upward gestures and is latched during programmatic scrolling |
| Provider list | Provider settings (search, auth-status filter) | `ModelRuntime.getProviders()`, `listCredentials()` |
| API Key / OAuth | Provider settings (local credentials, removal confirmation) | `ModelRuntime.login()`, `ModelRuntime.logout()`, Pi auth callback; closing settings aborts an unfinished login through `AuthInteraction.signal`, and a new attempt supersedes stale same-Provider auth before reopening the browser; OpenAI Codex browser login preflights Pi 0.84.2–0.84.3's fixed loopback port, keeps manual callback entry as an explicit fallback, and refocuses the desktop window after success; PiHost initializes Pi's proxy-aware HTTP dispatcher with explicit environment → Pi `httpProxy` → Electron system-proxy precedence before token exchange |
| Model list | Composer model selector | `ModelRuntime.getModels()` |
| Thinking level | Composer Thinking menu; `/thinking [level]` | `AgentSession.getAvailableThinkingLevels()` / `setThinkingLevel()`; changes stay session-scoped unless Pi's explicit persistence option is used |
| Default built-in tools | Pi global/project `settings.json`; no separate PiDeck catalog | PiDeck leaves `createAgentSession.tools` unset, so Pi 0.84.3 applies `defaultTools`, including the optional Windows `powershell` tool when configured; Extension/custom tools remain enabled according to Pi SDK semantics |
| Pi slash command catalog | Suggestions for known `/` prefixes at line start; command palette | Pi built-in catalog, Prompt, Skill, Extension commands; paths and plain text never trigger command suggestions |
| `@file` suggestions | Composer `@` | Workspace file snapshot from `workspace.snapshot` |
| Agent streaming events | Central thread | `agent_start`, `agent_end.messages`, `agent_settled`, `message_update`, `tool_execution_*`, etc. |
| Steering / Follow-up queue | Composer queue panel and delivery menu | `agent.queue`, `setQueueModes`, `clearQueue`, `promoteQueue`, `editQueue`, `deleteQueue`; the batch-mode radio rows show Pi's confirmed current mode plus in-flight feedback, the queue trigger stays single-line under change-review split compression, and stable-ID rows show image thumbnails and support re-editing or deleting any pending steering/follow-up item. Because Pi has no arbitrary-row deletion API, PiHost validates the stable sidecar ID and atomically rebuilds the remaining queue with Pi's official clear-and-ordered-requeue APIs, restoring the original queue on failure; queue additions, edits, deletions, insertions, and processing auto-follow while in follow state |
| Tool approval | Central approval card | Current PiHost `beforeToolCall` adapter |
| Tool process | Non-expandable running timer plus live chronological activity feed; collapsible completed process block | During execution, the summary only reports elapsed time while thinking blocks and tool calls are interleaved in Pi event order below it as a low-emphasis inline flow using the shared conversation rhythm. After settlement, the complete process moves into the expandable summary; live/completed detail regions share a bounded height with internal overflow scrolling, the live region follows refreshed and late-resizing content until the user intentionally scrolls upward without changing the outer transcript follow state, and completed groups retain Tool Result, tool name, and success/failure state |
| Per-run file change review | Change summary above the Composer opens a split review pane with a rounded accessible run picker, collapsible changed-file directory tree, unified line diff, additions/deletions, pointer/keyboard-resizable dividers, and per-Session view restoration; queued empty runs retain the latest non-empty summary | PiHost captures the Git working-tree state at each `agent_start`/Follow-up boundary, refreshes an in-progress preview after known mutating tools, compares it authoritatively at settlement, generates text patches with Pi's public `generateUnifiedPatch()`, and persists `pideck.change-review` custom entries. Pre-existing dirty files are excluded unless the run changes them; edit/write/bash/PowerShell outcomes are covered by the task baseline, while binary/oversized content is reported without unsafe IPC payload growth |
| Local terminal | Not integrated: the terminal panel and `Ctrl/Cmd + J` were removed, the `terminal.execute` bridge was deleted | `AgentSession.executeBash()` |
| Context compaction | Command Palette | `AgentSession.compact()` reduces subsequent model context; the desktop transcript continues to display the complete persisted active Session branch |
| Session export | Command Palette | `AgentSession.exportToJsonl()` / `exportToHtml()` |
| Runtime status | Sidebar | Main/PiHost runtime status event plus sanitized `runtime.error` startup failures |
| Chinese/English | Language button in the header | Renderer i18n |
| Light/dark theme | Theme button in the header | Renderer theme preference |

## Slash Command Status

The Composer reads Pi's real slash command catalog and suggests commands. Final execution must still follow Pi CLI semantics:

- Commands with a clear Bridge should call the corresponding PiHost capability, e.g. `/compact`, `/export`, `/model`, `/login`, `/logout`.
- Commands with a catalog entry but no Bridge must not be faked as executed.
- `/skill:name` expansion is handled by Pi `AgentSession.prompt()`; PiDeck shows only a compact Skill reference and the user's actual input per Pi TUI's `parseSkillBlock()` rules, never re-displaying the injected Skill body as a user message.
- The authoritative source of Extension commands is the current Pi `ResourceLoader`, not a static fallback.

Desktop commands currently integrated include `/import`, `/share`, `/copy`, `/name`, `/session`, `/changelog`, `/hotkeys`, `/trust`, `/resume`, `/quit`, and `/scoped-models`. These map to desktop actions through PiHost, Electron system capabilities, or the existing session list. `/import` opens Electron's native JSONL picker and does not accept a Renderer-supplied path; `/share` still requires a local, logged-in `gh` CLI.

`/fork`, `/clone`, and `/tree` are not shown in Composer suggestions or the command palette and are on the to-support list. They require fully mapping Pi's Session Tree branch navigation, session replacement, and message timeline restoration to PiDeck; typing them manually currently shows a "to be supported" prompt rather than faking execution.

## Permission and Approval Boundaries

PiHost currently prefers loading `@gotgenes/pi-permission-system` through the Pi Extension mechanism:

- `allow`: automatically allows tool execution.
- `ask`: the Pi permission system produces an approval request, answered by the PiDeck approval card.
- `deny`: blocks tool execution.
- `yoloMode`: auto-approves `ask` for fully automated execution.

PiDeck provides the current permission-level switch below the input, writing to the plugin's Pi config file. Switching never interrupts a running agent; idle Sessions are lazily rebuilt under the new policy before the next prompt. Only when the Extension cannot load does PiHost fall back to the `beforeToolCall` adapter.

Approval events currently provide only the tool name and arguments, with no separate risk-level field; the approval card is therefore explicitly labeled "tool call" and never fabricates a risk level from the tool name.

## Integrated Extension Capabilities

The following capabilities have a basic desktop mapping:

- Extension UI request select, confirm, input, editor, and notify requests; requests render in the desktop window and results are returned.
- Pi Package install/remove/update/config manager; entry point in the Pi packages panel of the command palette.

Remaining boundary: Extension TUI-only `custom` components and theme/Widget/Footer/Header functions cannot pass component instances across PiHost and the Renderer, so they are not faked as fully equivalent implementations. PiDeck does not embed a standalone Pi CLI panel; command execution always goes through the Pi Agent.

Task-baseline unified diff review is integrated. Chunk acceptance/revert and a Monaco-based editable merge workflow remain unimplemented; PiDeck does not claim those actions until they have a safe Pi/desktop mapping.

New capabilities must first update `packages/contracts`, then PiHost, Preload, Renderer, and this matrix.
