# Changelog

All notable PiDeck changes are documented here. Release artifacts and generated
release notes remain available on GitHub Releases.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Pi-backed `/settings`, live `/reload`, and user `!command` / `!!command` desktop mappings, including persisted default model/Thinking selection.
- Serializable Extension UI status, working indicator, Widget, title, and editor presentation, with explicit compatibility notices for TUI-only component APIs.
- Pi 0.85.1 SDK compatibility, including its dynamically discovered GPT-6 Astra
  model catalog and upstream Agent, provider, and session fixes.
- Updated the bundled `@gotgenes/pi-permission-system` Extension to `31.1.1` and
  synchronized its lockfile, package notices, and runtime compatibility checks.
- Pi 0.84.3 `/thinking` command mapping and optional PowerShell `defaultTools`
  compatibility on Windows.
- Native GitHub Actions installers for macOS arm64, macOS x64, and Windows x64.
- Signing, notarization, checksums, SBOM generation, provenance attestations,
  packaged PiHost smoke tests, and release-maintainer documentation.
- GitHub issue/PR templates, dependency updates, dependency review, and CodeQL.
- Per-run Git worktree review with live debounced previews, a Composer summary, draggable dividers, dated/outcome-aware run selection, filtered aggregate keyboard directory tree, unified/split diff, wrapping, whitespace filtering, syntax highlighting, hunk navigation, incremental row folding, rename/mode/binary/truncation states, copy-path action, and actionable availability/retry states. The newest non-empty summary remains visible while a queued Follow-up starts empty.

### Changed

- Split diff now follows Codex's two-column review treatment with stronger pane separation, aligned line gutters, contiguous add/delete blocks, hatched missing-side regions, and compact unmodified-line separators.
- The review file tree now uses one state-aware expand/collapse-all control instead of two competing buttons, while manual folder collapse remains respected for the selected file.
- Change-review persistence now uses one minimal Pi Session anchor plus an atomically replaced sidecar capped at 20 runs/12 MB. Review-list IPC sends summaries only and lazily loads the selected bounded detail; imported/legacy records are strictly sanitized, candidate scans and previews are capped/cancellable, final writes are serialized, and graceful Host shutdown drains pending persistence.
- Review view state now restores the selected file, expanded folders, split sizes, diff options, and per-file scroll position across Session switches and app restarts; responsive review drawers trap/restore focus and make the title bar, project sidebar, dividers, and covered conversation inert.
- The project sidebar divider is keyboard- and pointer-resizable, with its desktop width retained locally.
- Queued messages use a compact inset stack attached directly to the Composer instead of a separate header card and gap.
- Queue rows preserve image attachments while supporting promotion, in-place editing, and arbitrary deletion; processing-mode choices now expose Pi's confirmed selection and pending state, and the queue trigger stays intact when change review narrows the Composer.
- Running execution summaries are now non-expandable elapsed-time indicators; completed process details move into a bounded, internally scrollable summary.
- Conversation typography now uses a consistent turn/continuation/section rhythm; consecutive Assistant commentary flows naturally into a low-emphasis inline live Activity view without hidden status placeholders, while retaining unique timeline identities.
- The queued-message panel now uses a denser responsive layout, previews queued image thumbnails, and supports editing a queued message in its original Pi queue position.
- Updated the Pi CLI / SDK compatibility baseline to 0.85.1. Its public root
  runtime exports remain compatible with PiDeck; OpenAI Codex OAuth preflight
  now covers fixed-loopback SDK versions through 0.85.1.
- Packaged builds now prefer the bundled, lockfile-pinned Pi SDK unless an
  explicit `PIDECK_PI_MODULE` override is supplied.

### Fixed

- `/reload` now removes stale Extension UI status, Widget, title, and working presentation left by extensions that were deleted or disabled.
- Extension slash commands that wait for desktop input now leave the running state after submission while preserving any model run already in progress.
- Manual `/compact` now keeps messages submitted during compaction in an editable queue and resumes them in order, instead of losing the prompt or leaving the Session stuck as busy.
- Review load failures, non-Git workspaces, oversized collections, and per-file truncation no longer collapse into a misleading “no changes” state; each now has precise copy and retry guidance.
- Review generation now represents rename, executable-mode, binary, oversized, and committed-HEAD changes while keeping pre-run dirty files excluded unless they change during the run.
- Restarting PiDeck after context compaction now restores the complete persisted Session branch instead of showing only the compacted model context.
- Cancelling an in-progress Provider OAuth login by closing settings now aborts the Pi auth operation, allowing the next attempt to open a fresh browser authorization flow.
- The live execution panel now interleaves Markdown thinking blocks with expandable tool calls, compacts excessive provider blank lines, and intelligently follows refreshed or late-resizing content without nested scrolling changing the outer transcript position.
- Project switches keep sidebar sessions strictly scoped to their workspace instead of briefly showing the previous project's conversations.

### Security

- Added a restrictive Renderer Content Security Policy and blocked in-window
  navigation.
- Scoped signing credentials to native packaging steps and pinned release/CI
  actions to immutable commit SHAs.

[Unreleased]: https://github.com/vulcanen/PiDeck/compare/v0.1.0...HEAD
