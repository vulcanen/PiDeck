# Security Policy

PiDeck handles Provider API keys, OAuth credentials, and session data. Security issues are taken seriously.

## Reporting a vulnerability

Do **not** open a public issue for security vulnerabilities. Instead, report privately:

- **Preferred**: GitHub Private Vulnerability Reporting
  - Go to the repository's **Security** tab → **Report a vulnerability**
- **Alternative**: email the maintainer with the subject prefix `[PiDeck Security]`

Please include:

- Affected versions and environment (OS, Node.js version, Electron version)
- A minimal reproduction or proof of concept
- Impact description and any suggested mitigation

You will receive an acknowledgment within 5 business days, and a timeline for resolution and disclosure.

## Scope

The following are in scope:

- Code execution, privilege escalation, or sandbox escape in the Electron main/renderer process
- Unsanctioned access to Provider credentials, OAuth tokens, or session data
- Path traversal or arbitrary file read/write through PiDeck features
- Supply-chain tampering in dependencies or CI

Out of scope:

- Credential handling and session storage implemented inside the Pi CLI / SDK runtime (report to the [Pi project](https://github.com/earendil-works/pi) instead)
- Provider (Anthropic, OpenAI, etc.) platform issues
- Local machine compromise where the attacker already controls the user account

## Supported versions

Security fixes are released on the latest version. Patch releases may be cut for critical vulnerabilities.
