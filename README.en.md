# PiDeck

[中文](README.md)

PiDeck is a desktop interface for [Pi](https://pi.dev). It brings the projects, sessions, models, providers, and tool interactions exposed by the Pi CLI / SDK into an Electron workspace.

PiDeck does not implement a separate agent, model catalog, session store, or credential system. Provider API keys, OAuth credentials, and session data remain managed by the Pi Runtime.

The project tree can keep multiple projects' Pi sessions expanded at once. Clicking a project neither collapses other projects nor switches the active conversation; the workspace changes only after selecting a specific session. Projects can be removed from the list through their context menu without deleting project files or Pi sessions.

Current version: `0.1.0`  
Pi CLI / SDK baseline: `0.83.0`  
Electron: `43.2.0`

## Platform availability

### Windows

- Official installer: To be released
- Download: To be added
- Current status: Available from the local source tree

### macOS

- Official installer: To be released
- Download: To be added
- Current status: Available from the local source tree

## Run from source

Requirements:

- Node.js `>=22.19.0`
- Pi CLI available on the system, or a local path to the Pi SDK

Install dependencies:

```bash
npm install
```

Start the development application:

```bash
npm run dev
```

Run type checking and a production build:

```bash
npm run typecheck
npm run build
```

PiDeck looks for the Pi SDK through the local `pi` command by default. To use a specific SDK file, set `PIDECK_PI_MODULE`.

Windows PowerShell:

```powershell
$env:PIDECK_PI_MODULE = "D:\path\to\pi-coding-agent\dist\index.js"
```

macOS / Linux:

```bash
export PIDECK_PI_MODULE="/path/to/pi-coding-agent/dist/index.js"
```

## Documentation

- [Product and technical plan](docs/product-plan.zh-CN.md)
- [Architecture](docs/architecture.zh-CN.md)
- [Pi CLI feature matrix](docs/pi-cli-feature-matrix.zh-CN.md)
- [Project development instructions](AGENTS.md)
