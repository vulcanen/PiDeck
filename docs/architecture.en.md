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
- `PIDECK_PI_MODULE`: explicitly sets the Pi SDK entry file. Packaged builds otherwise require the lockfile-pinned SDK inside `app.asar`; development builds may additionally discover a global Pi installation.

`packages/pi-host` posts messages to both `process.send` and the `worker_threads` `parentPort`, so the process host can be swapped, but Main currently only uses `child_process.fork`.

### 2.1 Main

`apps/desktop/src/main/index.ts`

Main is only responsible for:

- Creating and destroying the BrowserWindow (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`).
- Starting, listening to, and stopping PiHost. Lifecycle callbacks are bound to the process instance that emitted them, so a late `exit` from a replaced Host cannot tear down its replacement; restart resolves only after a real `runtime.status` IPC round trip.
- Resolving the operating-system proxy through an internal Main/PiHost bridge for each request URL when neither explicit proxy environment variables nor Pi `httpProxy` are set.
- Orchestrating between Renderer IPC and PiHost requests.
- Setting timeouts for requests (default 60s; `providers.login`, `sessions.share` 15min; `packages.*` 10min; `agent.prompt` unbounded — its completion is signaled by `agent_settled`, not the RPC response) and handling Host disconnects.
- Opening protocol-validated HTTP(S) URLs in the system browser and rejecting in-window navigation.
- Recording project directory references, hidden references, and their display order in Electron `userData/projects.json`.
- Building the application menu and switching menu language via `app:set-language`; copy comes from `@pideck/i18n`.
- On Windows, using Electron Window Controls Overlay and hiding the native menu bar so the themed Renderer surface continues behind the system window controls; `app:set-window-theme` synchronizes the native background and control-symbol colors with the Renderer theme. Renderer title-bar colors match that native overlay exactly, while right-side settings/package drawers start below the 48px caption strip so their header controls never enter the minimize/maximize/close hit area.
- Opening native dialogs for directory picking, session import, etc.
- Setting the Dock icon on macOS and attempting to load `pideck-miniwindow.node` for the minimized-window icon; failures degrade to a warning.

The project directory list stores only `cwd`, never Session or workspace content. Clicking a project in the Renderer expands its session list on demand via `sessions.list(cwd)`, keeping other projects' expansion states independent and leaving the central session untouched; only clicking a specific session switches the workspace. Every expanded group renders from its own `projectTasksByCwd[cwd]` cache, so the intermediate render of a cross-project switch cannot place the previous project's Sessions under the newly selected project. Right-click "remove" on a project only adds `cwd` to hidden references and never deletes project files or Pi Sessions. Main never creates `AgentSession`, never stores Provider credentials, and never executes user Shell commands.

### 2.2 Preload

`apps/desktop/src/preload/index.ts`

Preload exposes a capability-scoped `window.pideck` via `contextBridge`. The Renderer can only use the capabilities declared in contracts; it never gains access to the raw `ipcRenderer`, Node objects, or Credential objects.

### 2.3 PiHost

`packages/pi-host/src/index.ts`

PiHost is responsible for:

- Orchestrating `@pideck/pi-adapter`, SessionManager, AgentSession, and ModelRuntime.
- Reading/restoring Pi Sessions, projecting the complete active `SessionManager.getBranch()` as the desktop transcript while leaving `AgentSession.messages` as Pi's compacted model context, and writing `pideck.execution-run` run metadata via `SessionManager.appendCustomEntry()`.
- Forwarding Agent events, Approval events, Auth events, and Extension UI requests.
- Executing Pi built-in tools, Bash, Provider login, Pi package management, permission-mode reads/writes, and session operations.
- Initializing Pi's own proxy-aware HTTP dispatcher before reporting `runtime.status=connected`, so OAuth token exchange, model requests, and Provider HTTP calls share the same PiHost route. Package-manager subprocesses such as npm, pnpm, and git retain their own proxy configuration.
- Converting cross-process data into JSON-serializable responses (`jsonSafe`) and keeping stable IDs plus queued image attachments in a PiHost sidecar so queue thumbnails, `promoteQueue`, `editQueue`, and `deleteQueue` can rebuild Pi's queue without dropping attachments.
- Scoping every in-memory SessionManager, AgentSession, queue, approval, and lifecycle resource by normalized `cwd` plus Pi session ID. Imported JSONL files may preserve the same ID in different projects, but deletion, abort, and queue operations remain project-isolated.
- Running Git workspace inspection and `gh` sharing commands asynchronously with bounded timeouts so external processes do not block the PiHost IPC loop.

Dynamic Pi SDK resolution, loading, and model/Session adaptation live in `packages/pi-adapter`. Pi permission configuration, Extension UI binding, approval waiting, and policy switching live in `packages/permission-engine`. Neither creates a second agent, Provider, or Session store; the authoritative sources remain the Pi SDK and `@gotgenes/pi-permission-system`.

Proxy precedence is explicit `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`, Pi's global `httpProxy` setting, then Electron's cross-platform system-proxy resolution. `pi-adapter` first calls Pi's version-matched `configureHttpDispatcher()`; only when no explicit/Pi proxy exists does it install a thin dispatcher that asks Main to run `session.resolveProxy(url)` for every request URL. PAC, bypass, and domain-specific rules therefore remain URL-aware instead of being flattened into a startup snapshot. Resolution failures reject the request rather than silently falling back to direct traffic. A missing or incompatible dispatcher fails PiHost startup with a sanitized `runtime.error` before process exit.

## 3. Current Repository Structure

```text
PiDeck/
├─ apps/desktop/
│  ├─ index.html                          # Vite Renderer host page
│  ├─ vite.config.mts                     # Renderer ESM build config, outputs to root dist-renderer/
│  ├─ entitlements.mac.plist              # Hardened-runtime entitlements for signed macOS builds
│  ├─ assets/                             # App icons, mac Info.plist, native plugin artifacts
│  ├─ native/miniwindow.mm                # macOS minimized-window icon native customization source
│  ├─ public/                             # Renderer static assets
│  ├─ scripts/
│  │  ├─ build-native.mjs                 # Native plugin build (skipped on non-macOS)
│  │  ├─ behavior-regressions.test.cjs    # Security, concurrency, and packaging behavior regressions
│  │  └─ renderer-regressions.test.cjs    # Renderer behavior and structural guards
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
│        ├─ use-change-review.ts          # Per-Session persisted run-review loading/state
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
│           ├─ live-activity.tsx          # Live thinking and chronological tool-call feed
│           ├─ change-review.tsx          # Split-pane per-run unified diff review
│           ├─ pane-resize-handle.tsx     # Accessible pointer/keyboard pane separator
│           ├─ composer.tsx               # Input, suggestions, queue thumbnails/editing
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
├─ docs/                                  # Architecture, product plan, Pi capability matrix, release guide
├─ rules/                                 # Development and documentation sync rules
├─ .github/workflows/
│  ├─ ci.yml                              # Main/PR verification
│  └─ release.yml                         # Tagged native installers and draft GitHub Release
├─ scripts/verify-package-contents.mjs    # Packaged asar runtime/license/denylist verifier
├─ scripts/smoke-source-runtime.mjs       # Starts built PiHost and exercises a real runtime IPC call
├─ scripts/smoke-session-isolation.mjs    # Verifies same-ID sessions remain isolated across projects
├─ scripts/smoke-packaged-runtime.mjs     # Starts packaged PiHost and verifies the bundled Pi SDK
├─ scripts/generate-packaged-sbom.mjs     # Inventories the final asar into a platform-specific CycloneDX SBOM
├─ scripts/generate-third-party-notices.mjs # Deterministic production dependency license inventory
├─ scripts/verify-release-version.mjs     # Release tag/package version guard
├─ dist-renderer/                         # Renderer build output (not committed)
├─ release/                               # electron-builder artifacts (not committed)
├─ electron-builder.config.cjs            # Shared runtime whitelist and platform packaging rules
├─ AGENTS.md
└─ package.json                           # npm workspaces and build/package scripts
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

PiHost restores the desktop transcript by projecting every entry on Pi's complete active `SessionManager.getBranch()`. It deliberately does not expose `AgentSession.messages` as history because that array is the compaction-aware model context and omits the summarized prefix after a restart. Context compaction therefore remains effective for subsequent model requests without hiding persisted pre-compaction turns from the user.

The Renderer session timeline is composed of `app-conversation.tsx` and `ui/message-timeline.tsx` as a **plain document-flow list with earlier-message folding** — no virtual list. Consecutive Assistant commentary records inside one turn retain unique React identities and use a shared three-level rhythm for turn, continuation, and section spacing through the transition into live Activity, while the final record alone reuses the live response key. During a run, the execution summary is a non-interactive elapsed-time indicator while `ui/live-activity.tsx` renders normalized thinking blocks and tool calls in their actual chronological order as a low-emphasis inline flow rather than a separate raised card. After settlement, the live panel retracts and the complete process moves into the expandable summary. Both live and completed process regions have the same bounded viewport-relative height and scroll internally on overflow; while the live region is following, `ActivityStep` refreshes and late Markdown/diagram resizes keep its inner viewport pinned to the newest output, an intentional upward wheel/touch gesture pauses that follow, and returning to the inner bottom resumes it. These process regions are marked as nested scroll islands, so their wheel/touch/captured-scroll events never change the outer transcript follow state or show its "jump to latest" control. Tool arguments/results stay collapsed per call, and excessive provider blank lines are compacted for presentation only. Because Mermaid, KaTeX, and syntax highlighting are asynchronously sized, the measure-position loop of virtual lists is fundamentally incompatible with them (jumping, overlap, rubber-banding); instead only the most recent `FOLD_WINDOW = 200` messages stay mounted, with older messages folded behind a "show earlier" button revealing `FOLD_STEP = 200` at a time. Anti-jump relies on native scroll anchoring: `.conversation-scroll` must keep `overflow-anchor: auto` (the virtual-list-era `none` disables that mechanism).

Per-run change review is owned by PiHost plus `session-change-review.ts`. At `agent_start`, PiHost captures the current Git working-tree baseline without changing the user's index; a non-Steering Follow-up closes the previous segment and reuses the same boundary snapshot as the next baseline, while Steering remains in the active segment. Known mutating tool completions (edit, write, Bash, and PowerShell) compare against the active baseline to emit an in-progress review preview. Settlement performs the authoritative final comparison, including any other workspace changes, then uses Pi's public `generateUnifiedPatch()` and persists a bounded `pideck.change-review` custom entry. The `sessions.changeReviews` bridge restores the latest 20 entries after restart, and a `change-review.updated` agent event updates the active Renderer. `ui/change-review.tsx` opens from the summary above the Composer as a wide split pane or a responsive overlay drawer. Its run picker is a rounded keyboard-accessible popover rather than a native square menu, and changed paths are projected into a collapsible directory tree without changing the flat PiHost review DTO. On desktop, the project/conversation, conversation/review, and diff/file-list separators support pointer dragging and keyboard arrows; review-open state, selected run, and pane widths are cached per Session, while the global sidebar width is retained locally. A newly queued Follow-up may create an empty running review, so the Composer launcher falls back to the newest non-empty review until that run changes a file. Binary/oversized files remain visible as changed without sending unbounded content across IPC. Existing dirty files are excluded unless their actual working-tree content changes during the run.

Each visited Session keeps its own pane; inactive panes use `visibility: hidden` instead of `display: none`, so the browser naturally preserves each pane's `scrollTop` without manual restore logic, while their scroll/resize/mutation observers are disconnected until the pane is active again. The `ConversationScrollSnapshot` is only `{ top, follow }`. Leaving follow is driven **only by real input gestures** (`wheel` with `deltaY < 0`, or an upward touch drag) — never by inferring direction from a shrinking `scrollTop`, because content legitimately shrinks (a live row replaced by the final message, the working indicator disappearing, an execution summary collapsing) and a delta-based guess misreads that as "user scrolled up", killing auto-follow mid-stream. During programmatic smooth scrolling, `pinningRef` (with a 1000ms timeout safety valve) latches follow so the "jump to latest" button does not flash back mid-animation. Modal overlays mark the application shell inert/hidden from assistive technology, and the shared focus primitive lets only the topmost nested dialog handle Escape.

PiDeck's Renderer `activity`/`completedActivity` remains presentation state of the current process and is never written back into the Session. To restore "processed" durations reliably, PiHost records each execution group's `startedAt/endedAt/durationMs` at `agent_start`, non-Steering Follow-up boundaries, and `agent_settled`, writing them as a `pideck.execution-run` custom entry via Pi's official `SessionManager.appendCustomEntry()`; the entry never enters the LLM context. The Renderer reads exact durations through `sessions.runMetadata`; Pi's raw thinking/tool content is used only to rebuild step content. Old sessions without this metadata show "processed" but never infer durations from message timestamps.

## 5. Current Bridge Capabilities

Per `PideckBridge` in `packages/contracts/src/index.ts`, currently declared:

- `app.setLanguage/setWindowTheme/quit`
- `runtime.status`
- `projects.list/chooseDirectory/remove/setTrust`
- `sessions.list/create/delete/remove/messages/runMetadata/changeReviews/capabilities/compact/export/import/rename/generateTitle/stats/share/changelog`
- `models.list`
- `workspace.snapshot`
- `providers.list/login/cancelLogin/logout/setApiKey/resolveAuth/openAuthUrl`
- `agent.prompt/abort/setThinkingLevel/setModel/setScopedModels/queue/setQueueModes/clearQueue/promoteQueue/editQueue/deleteQueue`
- `extensions.resolveUi`
- `packages.list/install/remove/update/configure`
- `approvals.resolve`
- `permissions.status/setMode`

Every invoke handler validates that the caller is the active PiDeck window's main frame. Project-scoped calls accept only directories already recorded in Electron's project registry; new directories enter that registry only through the native directory picker. Session import likewise always obtains its JSONL path from Electron's native file picker—the Renderer cannot provide an arbitrary filesystem path.
- `events.subscribe`

Three naming relationships need attention:

- `sessions.remove` is an alias of `sessions.delete`; both go through the same `sessions:delete` IPC channel.
- `providers.resolveAuth` / `providers.cancelLogin` / `providers.openAuthUrl` correspond to IPC channels `providers:auth-response` / `providers:cancel-login` / `providers:open-auth-url`; the first two are forwarded to PiHost commands `providers.auth-response` / `providers.cancelLogin`, while the last is opened by Main directly in the system browser.
- `sessions.changelog` maps to the PiHost command `app.changelog`; `projects.list/chooseDirectory/remove` are composed by Main from `projects.json` plus the PiHost `projects.list` and `sessions.list` commands, with no one-to-one Host command.

If the docs disagree with `packages/contracts`, contracts and the implementation win; the docs must be updated in the same change.

## 6. Current Event Flow

`PiDeckRuntimeEvent` declares the types `runtime.status`, `runtime.error`, `agent.event`, `auth.event`, `approval.requested`, `approval.resolved`, `extension.ui.request`, `extension.ui.notify`.

Six message shapes are currently dispatched with a top-level `type`:

```ts
{ type: "runtime.status", payload: "connected" | "starting" | "disconnected" }
{ type: "runtime.error", payload: { message: string } }
{ type: "agent.event", taskId, event }
{ type: "approval.requested", taskId, requestId, event: { toolName, args } }
{ type: "auth.event", requestId, event }
{ type: "extension.ui.request", taskId, requestId, event: ExtensionUiRequest }
```

`approval.resolved` and `extension.ui.notify` are emitted by `packages/permission-engine` through PiHost's `emit()`, so when they reach the Renderer they are wrapped in `agent.event` under `event.type` rather than at the top level. `approval.resolved` is only produced when switching permission modes auto-approves or denies a pending approval; the approval card is then cleared locally by the Renderer after `permissions.setMode` succeeds. The `approval.resolved` branch matched by top-level `type` in `use-runtime-events.ts` currently never hits; making top-level events work requires posting directly from PiHost and updating this section in the same change.

`runtime.status` is published by Main: `connected` when PiHost reports it, `starting` during process startup, `disconnected` at process exit with all pending requests rejected.

Auth prompts come back through `providers.resolveAuth` (IPC `providers:auth-response`) as text, options, or a cancel state; cancelling ends Pi's wait without leaving a pending login request, and PiHost also propagates Pi's per-prompt abort signal so SDK-cancelled fallback prompts do not leave stale waiters. Each Renderer OAuth attempt carries an opaque operation ID. Closing Provider settings calls `providers.cancelLogin`, and PiHost aborts that operation through Pi's `AuthInteraction.signal`; starting another attempt for the same Provider also supersedes any stale operation before invoking `ModelRuntime.login()`. For the version-guarded Pi 0.84.2–0.84.3 OpenAI Codex browser flow, PiHost probes the SDK's fixed loopback listener endpoint before resolving the browser-method prompt. A failed probe keeps that prompt active so the Renderer can show an actionable error and the user can choose Pi's device-code method. The SDK's concurrent manual-code prompt stays a secondary fallback while the loopback callback is pending, and Main restores/focuses the PiDeck window after `providers.login` succeeds.

`agent.event` currently covers agent start/end, agent settled, turn start/end, message start/update/end/snapshot, tool execution start/update/end, and queue update events. Queue updates are normalized into stable-ID entries with text and serializable image payloads; clear-and-rebuild mutations suppress intermediate empty/partial updates and publish one authoritative result. The `messages` of `agent_end` come from the Pi SDK, so the Renderer can merge the round's messages before any automatic retry or queue continuation; `agent_settled` then reads the final Session snapshot. The Renderer only consumes serializable normalized objects, never `AgentSession` instances.

## 7. Pi Capability Mapping

- Pi Session / `cwd` → left project tree, per-project session lists, and the central conversation.
- Pi ModelRuntime → Provider settings, model selection, and thinking level.
- Pi slash command / Prompt / Skill catalog → Composer suggestions and command palette.
- Pi Agent event → streaming replies, tool process, approvals, and run status.
- Pi Session export/compact → session operations and command palette entries; Session Tree `/fork`, `/clone`, `/tree` remain on the to-support list.
- Pi Agent steering/follow-up queue → compact Composer-attached queue stack, delivery mode, batch mode, image thumbnails, promotion, in-place re-editing, and deletion of any queued row. The batch-mode radio rows reflect Pi's current `steeringMode`/`followUpMode`, expose an in-flight state, and close only after Pi confirms the mutation. The Composer toolbar responds to the conversation pane's container width, so opening or resizing change review trims secondary hints/model metadata before preserving the queue trigger as a single-line control. Pi has no arbitrary-row removal API, so editing and deletion validate the stable sidecar ID, then atomically use Pi's official `clearQueue()` plus ordered `steer()`/`followUp()` rebuilding under a PiHost mutation lock; failures restore the original queue.
- Pi Package management → Pi packages settings panel in the command palette.
- Pi permission system modes → permission-level control below the input.
- Pi workspace file list → `@file` reference candidates in the Composer. `workspace.snapshot` also returns git `changes`, but the current UI has no standalone Files/Changes panel, so the field is not yet consumed.

Capabilities without a stable Bridge or UI must be shown as unimplemented, never faked as successful. PiDeck does not maintain a separate Pi CLI execution panel.

## 8. Packaging and Distribution

Local packaging keeps the current-host `package:mac` command and exposes explicit `package:mac:arm64`, `package:mac:x64`, and `package:win:x64` commands for matching native runners. Installer filenames include the operating system and architecture; package verification checks the asar runtime entries, PiDeck notices, Electron/Chromium runtime licenses, and denylist after each build. Native packaging jobs then start PiHost from the packaged `app.asar`, call `runtime.status`, and verify through `app.info` that the bundled Pi SDK matches the locked version.

`.github/workflows/release.yml` starts on a matching version tag (or a manual rebuild of an existing tag), requires the tag commit to be contained in `main`, pins that commit SHA, rejects tags that differ from `package.json`, reruns dependency-notice/lint/typecheck/test/build checks, and packages Windows x64, macOS arm64, and macOS x64 separately. Each native job inventories its final `app.asar` into a platform-specific CycloneDX SBOM. The final job generates `SHA256SUMS.txt`, creates GitHub provenance attestations, and creates or updates a draft GitHub Release.

The native packaging jobs run through the protected `release-signing` Environment and expose certificate material only to their `electron-builder` step. macOS hardened runtime, entitlements, and notarization are enabled when the corresponding signing and Apple API secrets are present; Windows Authenticode uses its own certificate secrets. Without trusted certificates the workflow remains useful for test installers, but those artifacts are not suitable as trusted public releases.

## 9. Runtime Verification

After changing PiHost, contracts, Main, Preload, or Provider/Session-related capabilities, at minimum execute:

```text
runtime.status
projects.list
models.list
providers.list
sessions.create
sessions.runMetadata
sessions.capabilities
agent.queue
agent.deleteQueue (missing stable ID must fail without mutation)
workspace.snapshot
```

And run:

```bash
npm run lint
npm run typecheck
npm run test:renderer
npm run build
```

`npm run test:renderer` first runs `prebuild` to compile all workspace packages, then runs the structural renderer guards and behavior-level security/concurrency regressions in `apps/desktop/scripts/*.test.cjs` with `node --test`.
