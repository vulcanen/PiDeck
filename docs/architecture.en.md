# PiDeck Current Architecture

> This document describes only what is implemented in the current repository, not a target architecture.
> For target plans and follow-ups, see the [product and technical plan](product-plan.en.md).

## 1. Product Boundary

PiDeck is a desktop adaptation layer for `@earendil-works/pi-coding-agent`: the Renderer handles interaction and presentation, while PiHost owns Pi Session, ModelRuntime, Agent, Tool, Provider, resources, and CLI compatibility capabilities.

PiDeck does not provide:

- A second agent, model catalog, credential store, or session database.
- Node.js, filesystem, Shell, or Pi SDK access from the Renderer side.

Provider API keys, OAuth, and other credentials remain stored by the Pi Runtime in the local Pi config directory.

## 2. Current Runtime Topology

```text
Sandboxed React Renderer
  └─ Preload: window.pideck
      └─ Electron Main
          ├─ BrowserWindow lifecycle
          ├─ IPC handler orchestration
          └─ child_process.fork(PiHost)
              └─ Electron bundled Node (ELECTRON_RUN_AS_NODE)
                  └─ @earendil-works/pi-coding-agent
```

The current implementation uses plain Node `child_process.fork` with `process.send/process.on("message")` — not Electron `utilityProcess`, not MessagePort. The fork targets the Electron executable itself with `ELECTRON_RUN_AS_NODE=1`, i.e. Electron's bundled Node: when the bundled Node satisfies the Pi SDK engines there is no WebIDL/undici compatibility issue, and it reads the asar archive transparently, so node_modules are fully packed into the asar with only native `.node` modules and `apps/desktop/assets` unpacked via `asarUnpack`. If the bundled Node is below the Pi SDK requirement, an external system Node must be used with node_modules fully unpacked (a system Node cannot read asar).

Two runtime resolution entry points:

- `PIDECK_NODE_EXECUTABLE`: explicitly sets the Node executable used by PiHost; defaults to `process.execPath` (Electron bundled Node).
- `PIDECK_PI_MODULE`: explicitly sets the Pi SDK entry file; defaults to lookup through candidate paths in `packages/pi-adapter`.

`packages/pi-host` posts messages to both `process.send` and the `worker_threads` `parentPort`, so the process host can be swapped, but Main currently only uses `child_process.fork`.

### 2.1 Main

`apps/desktop/src/main/index.ts`

Main is only responsible for:

- Creating and destroying the BrowserWindow (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`).
- Starting, listening to, and stopping PiHost.
- Orchestrating between Renderer IPC and PiHost requests.
- Setting timeouts for requests (default 60s; `providers.login`, `sessions.share` 15min; `agent.prompt` and `packages.*` 10min) and handling Host disconnects.
- Opening protocol-validated HTTP(S) URLs in the system browser and rejecting in-window navigation.
- Recording project directory references, hidden references, and their display order in Electron `userData/projects.json`.
- Building the application menu and switching menu language via `app:set-language`; copy comes from `@pideck/i18n`.
- Opening native dialogs for directory picking, session import, etc.
- Setting the Dock icon on macOS and attempting to load `pideck-miniwindow.node` for the minimized-window icon; failures degrade to a warning.

The project directory list stores only `cwd`, never Session or workspace content. Clicking a project in the Renderer expands its session list on demand via `sessions.list(cwd)`, keeping other projects' expansion states independent and leaving the central session untouched; only clicking a specific session switches the workspace. Right-click "remove" on a project only adds `cwd` to hidden references and never deletes project files or Pi Sessions. Main never creates `AgentSession`, never stores Provider credentials, and never executes user Shell commands.

### 2.2 Preload

`apps/desktop/src/preload/index.ts`

Preload exposes a capability-scoped `window.pideck` via `contextBridge`. The Renderer can only use the capabilities declared in contracts; it never gains access to the raw `ipcRenderer`, Node objects, or Credential objects.

### 2.3 PiHost

`packages/pi-host/src/index.ts`

PiHost is responsible for:

- Orchestrating `@pideck/pi-adapter`, SessionManager, AgentSession, and ModelRuntime.
- Reading/restoring Pi Sessions and writing `pideck.execution-run` run metadata via `SessionManager.appendCustomEntry()`.
- Forwarding Agent events, Approval events, Auth events, and Extension UI requests.
- Executing Pi built-in tools, Bash, Provider login, Pi package management, permission-mode reads/writes, and session operations.
- Converting cross-process data into JSON-serializable responses (`jsonSafe`) and saving queued image attachments out-of-band so `promoteQueue` does not drop them.

Dynamic Pi SDK resolution, loading, and model/Session adaptation live in `packages/pi-adapter`. Pi permission configuration, Extension UI binding, approval waiting, and policy switching live in `packages/permission-engine`. Neither creates a second agent, Provider, or Session store; the authoritative sources remain the Pi SDK and `@gotgenes/pi-permission-system`.

## 3. Current Repository Structure

```text
PiDeck/
├─ apps/desktop/
│  ├─ index.html                          # Vite Renderer host page
│  ├─ vite.config.ts                      # Renderer build, outputs to root dist-renderer/
│  ├─ assets/                             # App icons, mac Info.plist, native plugin artifacts
│  ├─ native/miniwindow.mm                # macOS minimized-window icon native customization source
│  ├─ public/                             # Renderer static assets
│  ├─ scripts/
│  │  ├─ build-native.mjs                 # Native plugin build (skipped on non-macOS)
│  │  └─ renderer-regressions.test.cjs    # node --test Renderer regression cases
│  └─ src/
│     ├─ main/index.ts                    # Electron Main, app menu, and IPC orchestration
│     ├─ preload/index.ts                 # contextBridge
│     └─ renderer/
│        ├─ App.tsx                       # Entry and Controller/View composition only
│        ├─ main.tsx                      # Renderer mount entry
│        ├─ app-view.tsx                  # Workspace shell and global layout
│        ├─ app-sidebar.tsx               # Project tree, Session list, sidebar interactions
│        ├─ app-conversation.tsx          # Session pane caching, conversation, Composer composition
│        ├─ app-overlays.tsx              # Command palette, dialogs, global overlays
│        ├─ use-app-controller.tsx        # Page state and action orchestration
│        ├─ use-session-data.ts           # Session/capability/message loading
│        ├─ use-runtime-events.ts         # PiHost runtime event normalization
│        ├─ use-conversation-scroll.ts    # Session scroll snapshots and latest position
│        ├─ use-stream-deltas.ts          # Bounded batching of streaming deltas
│        ├─ use-global-shortcuts.ts       # Global shortcuts and focus boundaries
│        ├─ use-preferences.ts            # Language and theme preferences
│        ├─ use-notice.ts                 # Lightweight notice state
│        ├─ use-sent-images-cache.ts      # Pending-send image cache
│        ├─ timeline-utils.ts             # Turn grouping, execution summaries, stable timeline items
│        ├─ message-utils.ts              # Message identity, snapshot merging, time formatting
│        ├─ image-cache.ts                # Image preview cache
│        ├─ pi-capabilities.ts            # Slash command fallback when Pi resources are unavailable
│        ├─ types.ts                      # Renderer state and message helper types
│        ├─ styles.css                    # Current UI tokens and layout styles
│        ├─ vite-env.d.ts
│        └─ ui/                           # Presentation components, split by UI responsibility
│           ├─ index.ts                   # Unified UI export
│           ├─ message-timeline.tsx       # Session timeline (document flow + earlier-message folding)
│           ├─ message-view.tsx           # Single-message rendering
│           ├─ execution-summary.tsx      # "Processed" execution summary
│           ├─ composer.tsx               # Input, suggestions, queue delivery
│           ├─ command-palette.tsx        # Command palette
│           ├─ dialogs.tsx                # Rename/trust/resume/extension dialogs
│           ├─ approval-card.tsx          # Tool approval card
│           ├─ provider-settings.tsx      # Provider auth settings
│           ├─ package-settings.tsx       # Pi package management
│           ├─ permission-level.tsx       # Permission-level control
│           ├─ context-ring.tsx           # Context usage indicator
│           ├─ working-indicator.tsx      # Running indicator
│           ├─ task-row.tsx               # Session row and status markers
│           ├─ skeletons.tsx              # Skeleton screens
│           ├─ markdown.tsx               # Markdown, code blocks, math, Mermaid rendering
│           └─ shared.ts                  # Clipboard and menu keyboard-navigation helpers
├─ packages/
│  ├─ contracts/                          # Bridge, IPC command, runtime event types (type-only, no build output)
│  ├─ domain/                             # Task, Project types and shared runtime helpers
│  ├─ pi-adapter/                         # Pi SDK resolution, loading, model/Session adaptation
│  ├─ pi-host/                            # PiHost process entry and Host command orchestration
│  ├─ permission-engine/                  # Pi permission config, Extension UI, approval waiting
│  ├─ ui-system/                          # Shared Renderer Icon, focus, clipboard primitives
│  └─ i18n/                               # zh/en copy and command descriptions
├─ docs/                                  # Architecture, product plan, Pi capability matrix
├─ rules/                                 # Development and documentation sync rules
├─ dist-renderer/                         # Renderer build output (not committed)
├─ release/                               # electron-builder artifacts (not committed)
├─ AGENTS.md
└─ package.json                           # npm workspaces root config and electron-builder config
```

Each `packages/*` package currently has a single `src/index.ts` entry (`ui-system` uses `src/index.tsx`) with no deeper directory layering. They enforce code-boundary splits without introducing a second agent, permission, session, or credential system.

All Renderer presentation components live in `renderer/ui/`, re-exported through `ui/index.ts`; bounded streaming-delta batching lives in `use-stream-deltas.ts`. The single-file UI components and performance helpers of earlier versions have been replaced by these two structures; historical docs referencing old filenames should be corrected per this section.

## 4. Dependency Direction and Boundaries

```text
renderer → contracts + domain + i18n + ui-system
preload  → contracts
main     → contracts + i18n (menu copy); forks packages/pi-host/dist/index.js by path, never imports its modules
pi-host  → contracts + domain + pi-adapter + permission-engine
pi-adapter → Pi SDK (dynamic resolution, loading, public API adaptation only)
permission-engine → contracts + @gotgenes/pi-permission-system config
```

`packages/contracts` is a type-only package whose `exports` point directly at `src/index.ts`; it does not participate in builds and is not executed separately in the `typecheck` script. The other workspace packages keep type entries in `src/index.ts` / `src/index.tsx`, with runtime entries pointing at the built `dist/index.js`; desktop development (`predev`) and production builds (`prebuild`) compile in the order `domain → pi-adapter → permission-engine → pi-host → i18n → ui-system` so neither the PiHost Node process nor the Renderer loads uncompiled TypeScript.

Must be observed:

- The Renderer must not import the Pi SDK, Node builtins, or credential objects.
- Main must not create `AgentSession` directly.
- PiHost is currently the only code boundary allowed to depend on the Pi SDK.
- Cross-process messages carry only JSON/structured-clone serializable data.
- New IPC must update `packages/contracts` first, then Main, Preload, and Renderer.
- Pi fallback capabilities must live outside UI components and state that the Pi CLI/SDK remains the authoritative source.

The Renderer session timeline is composed of `app-conversation.tsx` and `ui/message-timeline.tsx` as a **plain document-flow list with earlier-message folding** — no virtual list. Because Mermaid, KaTeX, and syntax highlighting are asynchronously sized, the measure-position loop of virtual lists is fundamentally incompatible with them (jumping, overlap, rubber-banding); instead only the most recent `FOLD_WINDOW = 200` messages stay mounted, with older messages folded behind a "show earlier" button revealing `FOLD_STEP = 200` at a time. Anti-jump relies on native scroll anchoring: `.conversation-scroll` must keep `overflow-anchor: auto` (the virtual-list-era `none` disables that mechanism).

Each visited Session keeps its own pane; inactive panes use `visibility: hidden` instead of `display: none`, so the browser naturally preserves each pane's `scrollTop` without manual restore logic; the `ConversationScrollSnapshot` is only `{ top, follow }`. Leaving follow is driven **only by real input gestures** (`wheel` with `deltaY < 0`, or an upward touch drag) — never by inferring direction from a shrinking `scrollTop`, because content legitimately shrinks (a live row replaced by the final message, the working indicator disappearing, an execution summary collapsing) and a delta-based guess misreads that as "user scrolled up", killing auto-follow mid-stream. During programmatic smooth scrolling, `pinningRef` (with a 1000ms timeout safety valve) latches follow so the "jump to latest" button does not flash back mid-animation.

PiDeck's Renderer `activity`/`completedActivity` remains presentation state of the current process and is never written back into the Session. To restore "processed" durations reliably, PiHost records each execution group's `startedAt/endedAt/durationMs` at `agent_start`, non-Steering Follow-up boundaries, and `agent_settled`, writing them as a `pideck.execution-run` custom entry via Pi's official `SessionManager.appendCustomEntry()`; the entry never enters the LLM context. The Renderer reads exact durations through `sessions.runMetadata`; Pi's raw thinking/tool content is used only to rebuild step content. Old sessions without this metadata show "processed" but never infer durations from message timestamps.

## 5. Current Bridge Capabilities

Per `PideckBridge` in `packages/contracts/src/index.ts`, currently declared:

- `app.setLanguage/quit`
- `runtime.status`
- `projects.list/chooseDirectory/remove/setTrust`
- `sessions.list/create/delete/remove/messages/runMetadata/capabilities/compact/export/import/rename/generateTitle/stats/share/changelog`
- `models.list`
- `workspace.snapshot`
- `providers.list/login/logout/setApiKey/resolveAuth/openAuthUrl`
- `agent.prompt/abort/setThinkingLevel/setModel/setScopedModels/queue/setQueueModes/clearQueue/promoteQueue`
- `extensions.resolveUi`
- `packages.list/install/remove/update/configure`
- `approvals.resolve`
- `permissions.status/setMode`
- `events.subscribe`

Three naming relationships need attention:

- `sessions.remove` is an alias of `sessions.delete`; both go through the same `sessions:delete` IPC channel.
- `providers.resolveAuth` / `providers.openAuthUrl` correspond to IPC channels `providers:auth-response` / `providers:open-auth-url`; only the former is forwarded to the PiHost command `providers.auth-response`, while the latter is opened by Main directly in the system browser.
- `sessions.changelog` maps to the PiHost command `app.changelog`; `projects.list/chooseDirectory/remove` are composed by Main from `projects.json` plus the PiHost `projects.list` and `sessions.list` commands, with no one-to-one Host command.

If the docs disagree with `packages/contracts`, contracts and the implementation win; the docs must be updated in the same change.

## 6. Current Event Flow

`PiDeckRuntimeEvent` declares the types `runtime.status`, `agent.event`, `auth.event`, `approval.requested`, `approval.resolved`, `extension.ui.request`, `extension.ui.notify`.

Five message shapes are currently dispatched with a top-level `type`:

```ts
{ type: "runtime.status", payload: "connected" | "starting" | "disconnected" }
{ type: "agent.event", taskId, event }
{ type: "approval.requested", taskId, requestId, event: { toolName, args } }
{ type: "auth.event", requestId, event }
{ type: "extension.ui.request", taskId, requestId, event: ExtensionUiRequest }
```

`approval.resolved` and `extension.ui.notify` are emitted by `packages/permission-engine` through PiHost's `emit()`, so when they reach the Renderer they are wrapped in `agent.event` under `event.type` rather than at the top level. `approval.resolved` is only produced when switching permission modes auto-approves or denies a pending approval; the approval card is then cleared locally by the Renderer after `permissions.setMode` succeeds. The `approval.resolved` branch matched by top-level `type` in `use-runtime-events.ts` currently never hits; making top-level events work requires posting directly from PiHost and updating this section in the same change.

`runtime.status` is published by Main: `connected` when PiHost reports it, `starting` during process startup, `disconnected` at process exit with all pending requests rejected.

Auth prompts come back through `providers.resolveAuth` (IPC `providers:auth-response`) as text, options, or a cancel state; cancelling ends Pi's wait without leaving a pending login request.

`agent.event` currently covers agent start/end, agent settled, turn start/end, message start/update/end/snapshot, tool execution start/update/end, and queue update events. The `messages` of `agent_end` come from the Pi SDK, so the Renderer can merge the round's messages before any automatic retry or queue continuation; `agent_settled` then reads the final Session snapshot. The Renderer only consumes serializable normalized objects, never `AgentSession` instances.

## 7. Pi Capability Mapping

- Pi Session / `cwd` → left project tree, per-project session lists, and the central conversation.
- Pi ModelRuntime → Provider settings, model selection, and thinking level.
- Pi slash command / Prompt / Skill catalog → Composer suggestions and command palette.
- Pi Agent event → streaming replies, tool process, approvals, and run status.
- Pi Session export/compact → session operations and command palette entries; Session Tree `/fork`, `/clone`, `/tree` remain on the to-support list.
- Pi Agent steering/follow-up queue → Composer queue panel, delivery mode, and batch mode.
- Pi Package management → Pi packages settings panel in the command palette.
- Pi permission system modes → permission-level control below the input.
- Pi workspace file list → `@file` reference candidates in the Composer. `workspace.snapshot` also returns git `changes`, but the current UI has no standalone Files/Changes panel, so the field is not yet consumed.

Capabilities without a stable Bridge or UI must be shown as unimplemented, never faked as successful. PiDeck does not maintain a separate Pi CLI execution panel.

## 8. Runtime Verification

After changing PiHost, contracts, Main, Preload, or Provider/Session-related capabilities, at minimum execute:

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

And run:

```bash
npm run lint
npm run typecheck
npm run test:renderer
npm run build
```

`npm run test:renderer` first runs `prebuild` to compile all workspace packages, then runs `apps/desktop/scripts/renderer-regressions.test.cjs` with `node --test`.
