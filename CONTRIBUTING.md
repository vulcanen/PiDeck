# Contributing to PiDeck

Thanks for your interest in contributing to PiDeck.

## Before you start

- Read [AGENTS.md](AGENTS.md) first — it documents the product boundary (PiDeck maps the existing capabilities of the Pi CLI/SDK onto a desktop UI; no second agent implementation) and the development conventions.
- PiDeck is only a UI over Pi CLI / Pi SDK. Feature requests that Pi itself does not support belong upstream at [earendil-works/pi](https://github.com/earendil-works/pi).

## Getting started

Requirements:

- Node.js `>=22.19.0`
- npm

The locked Pi SDK is installed with the repository dependencies. A separate Pi
CLI is not required; `PIDECK_PI_MODULE` is only for explicit compatibility
testing.

```bash
npm ci
npm run dev
```

Before opening a pull request, verify:

```bash
npm run lint
npm run typecheck
npm run test:renderer
npm run build
npm run smoke:runtime
npm run notices:check
npm ls --all
```

## Submitting changes

- Keep changes focused; one logical change per pull request.
- Follow existing code style and the rules in [AGENTS.md](AGENTS.md) (i18n copy lives in the i18n package; renderer never imports the Pi SDK directly; new IPC goes through `packages/contracts` first).
- New UI copy must be added to both `zh` and `en` locales.
- Update documentation in `docs/` when behavior changes.
- Never commit secrets, credentials, or local environment files.

## Reporting issues

- Use the repository's bug or feature request template.
- Include PiDeck version, OS, and steps to reproduce.
- For security vulnerabilities, follow [SECURITY.md](SECURITY.md) and report privately.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
