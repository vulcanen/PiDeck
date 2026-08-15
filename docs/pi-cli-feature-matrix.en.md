# Pi CLI → PiDeck Current Feature Matrix

> This document records only capabilities already integrated in the current repository. Unimplemented capabilities are explicitly marked; product plans are not written as current state.
> The authoritative sources are the installed `@earendil-works/pi-coding-agent`, `packages/contracts`, and the PiHost implementation.

## Integrated

| Pi capability | PiDeck entry point | Current implementation |
| --- | --- | --- |
| Project discovery, browsing, removal | Left project tree; multiple projects expand at once, clicking a project only toggles its own expansion, right-click removes from the list; below 560px a top button opens the session drawer | `SessionManager.listAll()` + Main ordered/hidden `cwd` list → `projects.list` / `projects.remove`; removal never deletes project files or Pi Sessions |
| Session list and switching | Sessions of any expanded project are listed newest-first; only clicking a specific session switches the central workspace | `SessionManager.list(cwd)` / `updatedAt` |
| Create session | New task; the "new task" button for expanded projects without sessions; empty-state button | `SessionManager.create(cwd)` |
| Session messages | Central conversation thread | `AgentSession.messages`; Skill references are layered separately from the user's original text per Pi's `parseSkillBlock()` semantics |
| Execution duration restore | "Processed" execution summary | PiHost records execution groups at `agent_start`, Follow-up group boundaries, and `agent_settled`, writing precise start/end times into the Pi Session via `SessionManager.appendCustomEntry("pideck.execution-run", ...)`; Steering merges into the same group; `sessions.runMetadata` restores after restart; old sessions never fake durations |
| Session naming | Session list and conversation title | After the first user message: first `deriveSessionTitle` produces a prefix-stripped short title persisted via `sessions.rename` (Pi `AgentSession.setSessionName()`) as the reload-safe fallback; then the `sessions.generateTitle` bridge (PiHost summarizes the first message into 3–8 words via `ModelRuntime.complete`) asynchronously upgrades the title and persists again via `sessions.rename`. Upgrade happens only while the title is still a truncated/placeholder name; manual renames are never overwritten; LLM failure falls back to the truncated title |
| Session deletion | Session more menu | `sessions.delete` |
| Session position and long sessions | Central conversation thread (plain document flow + earlier-message folding) | No virtual list; only the most recent 200 messages stay mounted, older ones fold behind a "show earlier" button. Anti-jump relies on native scroll anchoring via `overflow-anchor: auto`; inactive panes keep `scrollTop` naturally with `visibility: hidden`; follow exits only on real wheel/touch upward gestures and is latched during programmatic scrolling |
| Provider list | Provider settings (search, auth-status filter) | `ModelRuntime.getProviders()`, `listCredentials()` |
| API Key / OAuth | Provider settings (local credentials, removal confirmation) | `ModelRuntime.login()`, `ModelRuntime.logout()`, Pi auth callback; PiHost initializes Pi's proxy-aware HTTP dispatcher with explicit environment → Pi `httpProxy` → Electron system-proxy precedence before token exchange |
| Model list | Composer model selector | `ModelRuntime.getModels()` |
| Thinking level | Composer Thinking menu | `AgentSession.getAvailableThinkingLevels()` |
| Default built-in tools | Pi global/project `settings.json`; no separate PiDeck catalog | PiDeck leaves `createAgentSession.tools` unset, so Pi 0.84.2 applies `defaultTools`; Extension/custom tools remain enabled according to Pi SDK semantics |
| Pi slash command catalog | Suggestions for known `/` prefixes at line start; command palette | Pi built-in catalog, Prompt, Skill, Extension commands; paths and plain text never trigger command suggestions |
| `@file` suggestions | Composer `@` | Workspace file snapshot from `workspace.snapshot` |
| Agent streaming events | Central thread | `agent_start`, `agent_end.messages`, `agent_settled`, `message_update`, `tool_execution_*`, etc. |
| Steering / Follow-up queue | Composer queue panel and delivery menu | `agent.queue`, `setQueueModes`, `clearQueue`, `promoteQueue`; queue additions, insertions, and processing auto-follow while in follow state |
| Tool approval | Central approval card | Current PiHost `beforeToolCall` adapter |
| Tool process | Collapsible process block | Tool Result, tool name, success/failure state |
| Local terminal | Not integrated: the terminal panel and `Ctrl/Cmd + J` were removed, the `terminal.execute` bridge was deleted | `AgentSession.executeBash()` |
| Context compaction | Command Palette | `AgentSession.compact()` |
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

Diff preview, task-baseline diff, and chunk-by-chunk review are not yet integrated. Pi provides the underlying diff computation for edit tools, but the Monaco editor and review workflow are PiDeck desktop product capabilities.

New capabilities must first update `packages/contracts`, then PiHost, Preload, Renderer, and this matrix.
