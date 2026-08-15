# Changelog

All notable PiDeck changes are documented here. Release artifacts and generated
release notes remain available on GitHub Releases.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Native GitHub Actions installers for macOS arm64, macOS x64, and Windows x64.
- Signing, notarization, checksums, SBOM generation, provenance attestations,
  packaged PiHost smoke tests, and release-maintainer documentation.
- GitHub issue/PR templates, dependency updates, dependency review, and CodeQL.

### Changed

- Updated the Pi CLI / SDK compatibility baseline to 0.84.2.
- Packaged builds now prefer the bundled, lockfile-pinned Pi SDK unless an
  explicit `PIDECK_PI_MODULE` override is supplied.

### Security

- Added a restrictive Renderer Content Security Policy and blocked in-window
  navigation.
- Scoped signing credentials to native packaging steps and pinned release/CI
  actions to immutable commit SHAs.

[Unreleased]: https://github.com/vulcanen/PiDeck/compare/v0.1.0...HEAD
