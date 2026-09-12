# Changelog

All notable PiDeck changes are documented here. Release artifacts and generated
release notes remain available on GitHub Releases.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-09-12

PiDeck `0.2.0` is the first public open-source Beta. The complete supported-feature inventory, downloads, verification notes, and known limitations are recorded in the [v0.2.0 release notes](docs/releases/v0.2.0.md).

### Added

- Added per-hunk accept/revert actions and a CodeMirror-based editable merge view to per-run file change review, with external-edit conflict detection and safe atomic writes.
- Added real DeepSeek interface screenshots and a Beta-focused README that documents PiDeck's Pi-only product boundary.

### Changed

- Prepared the repository, contribution documentation, security policy, release workflow, and three-platform packaging for the first public source release.

### Fixed

- Release automation now keeps newly generated installers as a Draft Release until they pass manual signing and installation checks.

## [0.1.5] - 2026-09-07

### Added

- Added `/fork`, `/clone`, and `/tree` with one searchable, keyboard-accessible Session Tree browser, branch previews, task switching, and optional abandoned-branch summaries.
- Added Pi settings for retry behavior, compaction and summary limits, proxy and network timeouts, default tools, thinking and image handling, project trust defaults, shell/npm/session paths, Skill commands, warnings, telemetry, and per-model Thinking overrides.
- Added the remaining Extension UI bridge for component Widgets, Footer/Header, custom editors, terminal input, autocomplete providers, and interactive `custom` components, including Pi's native `/llama` flow.

### Changed

- Updated the bundled Pi CLI / SDK to `0.85.1`, `@gotgenes/pi-permission-system` to `31.1.1`, and Electron to `43.4.1`.
- Kept long Session Trees left-aligned and bounded instead of increasing indentation with message depth; Skill-backed user messages now show only the Skill reference and the user's text.
- Tightened conversation spacing, simplified Session Tree detail typography, hid the model-list scrollbar without disabling scrolling, and made notices dismissible with a longer display time.
- Rewrote the README around user-facing features and current limitations, and added public-repository housekeeping and canonical noreply author mapping.

### Fixed

- Manual compaction now calls Pi's compaction abort path, preserves queued prompts, and leaves the Session in a usable state after cancellation.
- `/model provider/model` and `/export path` now preserve their full arguments, including paths with spaces.
- Session Tree projection is iterative and capped, preventing deep or large conversations from freezing the desktop.
- Pi settings preserve unknown nested values and proxy credentials while exposing actionable validation errors instead of silently discarding configuration.

### Security

- Project-scoped Pi resources remain gated by Pi's trust decision, while credentials and component instances stay outside the Renderer process.
- Dependency alerts and automatic security updates are enabled for the repository; release and CI actions remain pinned to immutable revisions.

[Unreleased]: https://github.com/vulcanen/PiDeck/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/vulcanen/PiDeck/compare/v0.1.5...v0.2.0
[0.1.5]: https://github.com/vulcanen/PiDeck/compare/v0.1.4...v0.1.5
