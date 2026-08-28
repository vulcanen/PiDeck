# Changelog

All notable PiDeck changes are documented here. Release artifacts and generated
release notes remain available on GitHub Releases.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Pi 0.84.3 `/thinking` command mapping and optional PowerShell `defaultTools`
  compatibility on Windows.
- Native GitHub Actions installers for macOS arm64, macOS x64, and Windows x64.
- Signing, notarization, checksums, SBOM generation, provenance attestations,
  packaged PiHost smoke tests, and release-maintainer documentation.
- GitHub issue/PR templates, dependency updates, dependency review, and CodeQL.
- Per-run file change review with a live Composer summary after mutating tools, draggable conversation/review and diff/file dividers, a rounded keyboard-accessible run picker, collapsible changed-file directory tree, per-Session review-view restoration, unified line diff, and persisted task-baseline metadata generated through Pi's public diff API. The most recent non-empty change count remains visible while a queued Follow-up starts a new empty run.

### Changed

- The project sidebar divider is keyboard- and pointer-resizable, with its desktop width retained locally.
- Queued messages use a compact inset stack attached directly to the Composer instead of a separate header card and gap.
- Queue rows preserve image attachments while supporting promotion, in-place editing, and arbitrary deletion; processing-mode choices now expose Pi's confirmed selection and pending state, and the queue trigger stays intact when change review narrows the Composer.
- Running execution summaries are now non-expandable elapsed-time indicators; completed process details move into a bounded, internally scrollable summary.
- Conversation typography now uses a consistent turn/continuation/section rhythm; consecutive Assistant commentary flows naturally into a low-emphasis inline live Activity view without hidden status placeholders, while retaining unique timeline identities.
- The queued-message panel now uses a denser responsive layout, previews queued image thumbnails, and supports editing a queued message in its original Pi queue position.
- Updated the Pi CLI / SDK compatibility baseline to 0.84.3.
- Packaged builds now prefer the bundled, lockfile-pinned Pi SDK unless an
  explicit `PIDECK_PI_MODULE` override is supplied.

### Fixed

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
