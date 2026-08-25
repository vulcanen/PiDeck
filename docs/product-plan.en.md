# PiDeck Product and Technical Plan

> Document status: aligned with the current code baseline; unimplemented items are explicitly marked as planned.
>
> Last updated: 2026-08-25
>
> Target platforms: Windows, macOS

## 1. Product Positioning and Boundaries

PiDeck is a desktop UI adaptation layer for `@earendil-works/pi-coding-agent`. It does not reimplement agents, models, session storage, credentials, or tooling; it maps the local capabilities of the Pi SDK/CLI onto a desktop workspace.

Explicitly out of scope:

- A second agent, model catalog, credential store, or message database.
- Product capabilities not supported by the Pi SDK/CLI.

Provider API keys, OAuth, token refresh, and session files remain managed by the Pi Runtime; credentials never enter the Renderer.

## 2. Current Implementation Baseline

Pi SDK baseline: `@earendil-works/pi-coding-agent@0.84.3`. PiDeck leaves `createAgentSession.tools` unset, so Pi 0.84.3 applies its project/global `defaultTools` setting—including the optional Windows `powershell` tool when configured—while keeping Extension and custom tools enabled. Model summaries omit thinking levels that Pi explicitly maps to `null`; active sessions continue to use the authoritative `AgentSession.getAvailableThinkingLevels()` result. Model and thinking changes remain session-scoped because PiDeck calls `setModel()` / `setThinkingLevel()` without Pi's explicit `persist` option, and `/thinking [level]` maps to the desktop thinking selector.

Current runnable topology:

```text
React Renderer
  → Preload contextBridge(window.pideck)
  → Electron Main IPC
  → child_process.fork(PiHost)
  → Electron bundled Node (ELECTRON_RUN_AS_NODE)
  → @earendil-works/pi-coding-agent
```

The current code is neither Electron `utilityProcess` nor MessagePort. `packages/pi-host` uses plain Node `process.send/process.on("message")`. PiHost runs in Electron's bundled Node (which satisfies the Pi SDK Node engines and can read the asar transparently); node_modules stay packed in the asar, with only native `.node` modules and `apps/desktop/assets` unpacked.

### 2.1 Current Layout

```text
apps/desktop/
├─ index.html                    # Vite Renderer host page
├─ vite.config.mts               # Renderer ESM build config, outputs to dist-renderer/
├─ assets/ · native/ · public/   # Icons, macOS native customization source, static assets
├─ scripts/                      # build-native.mjs, renderer-regressions.test.cjs
└─ src/
   ├─ main/index.ts              # Main, application menu, and IPC orchestration
   ├─ preload/index.ts           # contextBridge
   └─ renderer/
      ├─ App.tsx                 # Entry and composition
      ├─ main.tsx                # Renderer mount entry
      ├─ app-view.tsx            # Workspace shell and global layout
      ├─ app-sidebar.tsx         # Project/Session sidebar
      ├─ app-conversation.tsx    # Session pane and Composer
      ├─ app-overlays.tsx        # Command palette and dialog overlays
      ├─ use-app-controller.tsx  # State and action orchestration
      ├─ use-session-data.ts     # Session data loading
      ├─ use-runtime-events.ts   # PiHost event normalization
      ├─ use-conversation-scroll.ts # Scroll snapshots and latest position
      ├─ use-stream-deltas.ts    # Bounded streaming-delta batching
      ├─ use-global-shortcuts.ts # Global shortcuts and focus boundaries
      ├─ use-preferences.ts      # Language and theme preferences
      ├─ use-notice.ts           # Lightweight notice state
      ├─ use-sent-images-cache.ts # Pending-send image cache
      ├─ timeline-utils.ts       # Turn grouping and execution summaries
      ├─ message-utils.ts        # Message merging and identity
      ├─ types.ts                # Renderer state and helper types
      ├─ image-cache.ts · pi-capabilities.ts · styles.css · vite-env.d.ts
      └─ ui/                     # Timeline, message, Composer, command palette, dialog, settings components

packages/
├─ contracts/                    # Bridge/IPC types, type-only package without dist
├─ domain/                       # Types and shared domain helpers
├─ pi-adapter/                   # Pi SDK resolution, loading, and public API adaptation
├─ pi-host/                      # PiHost process entry
├─ permission-engine/            # Permission configuration and approval adaptation
├─ i18n/                         # zh/en copy
└─ ui-system/                    # Shared Renderer UI primitives
```

For the complete boundary, see [current architecture](architecture.en.md).

## 3. Current User Flows

Currently supported:

1. Start PiHost and show runtime status.
2. Auto-discover projects that own Pi Sessions, remember manually added project directories, and support hiding directory references via the project context menu (without deleting files or Sessions).
3. Expand multiple projects' session lists at once; project expansion states are independent, and the central workspace switches only when a specific session is clicked. Projects without sessions can create their first Session directly in the expanded area; creating, switching, and deleting local Sessions are supported.
4. Read and display Session messages.
5. Select an authenticated Provider/Model and thinking level.
6. Send prompts, view streaming replies, and stop runs.
7. View tool calls, tool results, and approval cards.
8. Reference workspace files via `@file`.
9. Compact context and export JSONL/HTML; import Pi JSONL sessions, rename, and view session stats.
10. Use Pi slash command catalog, Prompt, Skill, and Extension command suggestions.
11. Authenticate locally with Provider API keys/OAuth; OpenAI Codex browser login uses Pi's loopback callback by default, exposes manual callback entry only as a fallback, and refocuses PiDeck after success. PiHost network calls honor explicit proxy environment variables, Pi's global `httpProxy`, and the cross-platform system proxy in that order.
12. Switch Chinese/English and light/dark themes.
13. Use Steering/Follow-up queues, batch mode, and the queue panel.
14. Use a plain document-flow list with earlier-message folding for long sessions (only the most recent 200 messages stay mounted; older ones fold behind a "show earlier" button), caching message panes, scroll positions, and follow state per Session.
15. Desktop mappings of `/copy`, `/share`, `/changelog`, `/hotkeys`, `/trust`, `/resume`, `/quit`, and `/scoped-models`; `/share` requires a local `gh` CLI.
16. Persist precise per-run start/end times in Pi Session custom entries so "processed" durations stay consistent across restarts.

## 4. Message and Conversation Behavior

- Pi's raw Session messages are the source of truth.
- The Renderer never receives Pi SDK instances; only serializable message objects are passed to components.
- Markdown, code blocks, tables, and links are rendered in the Renderer presentation layer without altering Pi's raw messages.
- Session titles avoid embedding full Skill text; after the first user message, the title first uses a reload-safe truncated fallback, then asynchronously upgrades to a 3–8 word LLM summary of the first message (new `sessions.generateTitle` bridge: PiHost summarizes with `ModelRuntime.complete`, then persists via `sessions.rename`). Manual renames take precedence over LLM upgrades. The collapsed Skill reference card for expanded `<skill>` content is still pending; it must not be claimed as complete.
- Tool calls and thinking should render as collapsible activity blocks showing tool count, thinking-block count, and duration.
- Pi's raw thinking/tool content is used to rebuild the step content of "processed" summaries; exact durations come from `pideck.execution-run` metadata written by PiHost via `SessionManager.appendCustomEntry()` at `agent_start`, Follow-up group boundaries, and `agent_settled`; Steering messages share the same execution group. Runtime `completedActivity` is still not a persisted field; old sessions without metadata only show "processed" and never infer durations from message timestamps.
- Thinking summaries, streaming replies, and final Assistant messages reuse stable timeline items, avoiding unmount/rebuild of the whole message list when a reply completes.
- Switching Sessions immediately jumps to the session's latest or saved position without cross-session scroll animations.
- When the user manually leaves the bottom, a "jump to latest" affordance appears; scroll position is never force-restored.
- Queue message additions, insertions, and processing auto-scroll only while the user is still following; scrolling up exits follow immediately.

## 5. Current Bridge Contract

`packages/contracts/src/index.ts` is the single authoritative definition. Main capabilities:

```text
app.setLanguage/setWindowTheme/quit
runtime.status
projects.list/chooseDirectory/remove/setTrust
sessions.list/create/delete/remove/messages/runMetadata/capabilities/compact/export/import/rename/generateTitle/stats/share/changelog
models.list
workspace.snapshot
providers.list/login/logout/setApiKey/resolveAuth/openAuthUrl
agent.prompt/abort/setThinkingLevel/setModel/setScopedModels
agent.queue/setQueueModes/clearQueue/promoteQueue
approvals.resolve
events.subscribe
extensions.resolveUi
packages.list/install/remove/update/configure
permissions.status/setMode
```

Renderer → Preload → Main → PiHost is the only communication path. New IPC must update contracts first, then Main, Preload, and Renderer.

## 6. Slash Command Strategy

The authoritative slash command catalog comes from the Pi ResourceLoader/SDK; fallbacks are used only when runtime resources are unavailable.

Commands currently mapped or to be mapped to native UI:

- `/login`, `/logout` → Provider settings.
- `/model` → model selector.
- `/compact` → `AgentSession.compact()`.
- `/export` → Pi Session HTML/JSONL export.
- `/new` → create Session.
- `/reload` → reload Pi resources / re-read initial data.
- `/import`, `/name`, `/session`, `/share` → PiHost session import through Electron's native JSONL picker, naming, stats, and GitHub Gist sharing.
- `/copy`, `/changelog`, `/hotkeys`, `/resume`, `/quit` → Renderer/Electron desktop operations.
- `/trust`, `/scoped-models` → Pi project trust storage and model scoping.
- `/fork`, `/clone`, `/tree` → not shown yet; on the to-support list.

Commands without a stable Bridge must not be executed by the model as plain prompts, nor be faked as completed. The UI should show an actionable "not yet supported on the desktop" message.

`/skill:name` must go through `AgentSession.prompt()`; Pi SDK handles Skill expansion. PiDeck currently only renders the title; the collapsed Skill reference card is still planned.

## 7. Permissions and Approvals

### 7.1 Current Implementation

PiHost currently adapts via `AgentSession.agent.beforeToolCall`:

- `read`, `grep`, `find`, `ls` are allowed by default.
- Other tools go to the PiDeck approval card.
- User denial returns a blocked result.

### 7.2 `@gotgenes/pi-permission-system` Status

PiDeck has `@gotgenes/pi-permission-system@25.2.2` as an Extension dependency of the desktop PiHost, loaded via Pi `DefaultResourceLoader.additionalExtensionPaths`. This version resolves `$HOME`, `${HOME}`, and `$PWD` paths in bash before applying the `external_directory` gate, and improves subagent approval forwarding, Authorizer Chain records, and nested-command checks in redirects and heredocs. The desktop offers these modes:

- `allow`: silently allow tool execution.
- `ask`: Pi's permission system requests approval before execution.
- `deny`: block tool execution.
- `yolo`: enables the plugin's `yoloMode`, auto-approving `ask`, for fully automated execution.

Settings changes write to the plugin's global Pi configuration and are shown in the permission-level control below the input. Switching does not interrupt a running agent; idle Sessions are lazily rebuilt under the new policy before the next prompt. When the Extension cannot load, PiHost falls back to the built-in `beforeToolCall` approval adapter.

Integration constraints:

1. Load the real package in PiHost via the Pi Extension mechanism.
2. Keep the plugin using its own Pi config directory and schema.
3. Map `allow/ask/deny` and `yoloMode` to read-only state/settings UI.
4. Normalize the plugin's approval and decision events into contracts.
5. Remove duplicate PiDeck custom approval gates to avoid two approval flows per tool call.
6. Verify allow, ask, deny, session approval, and failure-close behavior through real tool calls.

## 8. Currently Unimplemented Capabilities

Still planned, not current product promises:

- Print, JSON, RPC, stdin, and Auth Print compatibility channels.
- Monaco Diff, task-level baselines, and chunk-by-chunk review.
- Extension TUI-only `custom` components, themes, Widgets, Footers, Headers — anything that cannot pass component instances across processes.

## 9. Technical and Security Constraints

- Node.js `>=22.19.0`, satisfying the current Pi SDK engines.
- Renderer must not use Node builtins, the Pi SDK, Credentials, or arbitrary IPC.
- Main handles only windows, IPC orchestration, and PiHost lifecycle.
- PiHost owns the Pi SDK, Agent, Tool, Provider, Session, and resources.
- Cross-process messages carry only JSON/structured-clone serializable DTOs.
- External URLs are limited to HTTP(S) and open in the system browser.
- The Renderer enforces a restrictive Content Security Policy and rejects in-window navigation.
- Packaged builds load the bundled, lockfile-pinned Pi SDK unless `PIDECK_PI_MODULE` explicitly overrides it.
- API keys and OAuth tokens never enter the Renderer, logs, events, or DevTools.
- PiHost installs Pi's version-matched proxy-aware HTTP dispatcher before becoming connected; explicit environment configuration wins over Pi `httpProxy`, which wins over Electron's system-proxy fallback.
- Failure states must be visible and offer retry or repair actions.

## 10. Acceptance Commands

Run after any change to dependencies, contracts, PiHost, Providers, Sessions, or core Renderer interactions:

```bash
npm install
npm run notices:check
npm ls --all
npm ls --depth=0 --workspaces
npm run typecheck
npm run test:renderer
npm run build
```

Release tags must resolve to a commit contained in `main`; the workflow pins that SHA, runs the same verification on Linux, then builds the Windows x64, macOS arm64, and macOS x64 installers on matching native GitHub runners. It generates a separate SBOM from each final package and creates a draft release with SHA-256 checksums; trusted public distribution additionally requires platform signing and macOS notarization secrets in the protected `release-signing` Environment.

PiHost-related changes additionally verify:

```text
runtime.status
projects.list
models.list
providers.list
sessions.create
sessions.runMetadata
sessions.capabilities
workspace.snapshot
```

## 11. Development Notes

For development boundaries, code conventions, dependency management, and acceptance requirements, see [AGENTS.md](../AGENTS.md).
