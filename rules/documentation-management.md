# Documentation Sync Rules

## Purpose

PiDeck documentation must reflect the current code and the capabilities of the currently installed Pi SDK. Do not present product plans, target architecture, or example code as implemented features.

## Mandatory Constraints

1. When the project structure changes, update the affected documents in the same change:
   - `README.md`: entry points, how to run, project positioning.
   - `docs/architecture.zh-CN.md`: process boundaries, directory structure, dependency direction, runtime topology.
   - `docs/pi-cli-feature-matrix.zh-CN.md`: the actual mapping from Pi capabilities to UI/command palette/compatibility channels.
   - `docs/product-plan.zh-CN.md`: the current implementation baseline and unimplemented plans.
2. When a `packages/contracts` IPC command, event, DTO, or field changes, update the architecture doc, the feature matrix, and the corresponding runtime validation checklist.
3. When adding or removing UI capabilities, Pi SDK capabilities, Extensions, Providers, permission mechanisms, or CLI command mappings, update the feature matrix; unimplemented capabilities must be marked "not implemented".
4. Directories, package names, APIs, SDK versions, the Electron communication model, and command lists in documentation must follow the current code or the currently installed Pi SDK. Content that cannot be verified belongs only in "planned/target" sections.
5. When a third-party Pi Extension is added, removed, or replaced, record: package name, version, loading method, config source, event bridging, and how duplicate capabilities are removed.
6. Documentation must not describe a second Agent, permission, credential, session, or model implementation that bypasses Pi CLI/SDK.
7. Dependency upgrades must check the Pi SDK type declarations and changelog, and update versions, capabilities, and compatibility notes in the relevant docs.
8. When the Renderer entry split, session pane cache, timeline rendering/folding, scroll anchoring, queue following, or message persistence restore behavior changes, also review [Renderer session timeline and scrolling rules](renderer-session-timeline.md) and the architecture/product baseline; do not update JSX alone while leaving stale directory or behavior descriptions.
9. Documentation must not describe the Renderer runtime `activity` / `completedActivity` as Pi Session persistence fields; Pi's raw thinking/tool content and presentation-layer inferred summaries must be clearly distinguished.

## Pre-commit Checks

```bash
rg -n "utilityProcess|MessagePort|Zod|Zustand|Monaco|xterm|pi-adapter|permission-engine" docs README.md
rg -n "App\.tsx|app-conversation|timeline-utils|use-conversation-scroll|overflow-anchor|completedActivity" docs rules README.md
# The timeline is deliberately not virtualized. Any hit here means a doc or the
# code drifted back toward a virtual list; see renderer-session-timeline.md §4.
rg -n "react-virtual|useVirtualizer|virtualiz" docs rules README.md apps/desktop/src packages/*/src
rg -n "PiHostCommand|PiDeckRuntimeEvent|interface PideckBridge" packages/contracts/src/index.ts
npm run typecheck
npm run test:renderer
npm run build
```

If an architecture term or capability found by these searches does not exist in the current code, remove it, mark it "planned", or complete the implementation before keeping it.
