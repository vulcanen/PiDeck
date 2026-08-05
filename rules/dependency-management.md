# Dependency Upgrades and Runtime Compatibility

## Version Baseline

- Use current stable versions from the npm registry; do not pin to old major versions by hand.
- The Node.js baseline must satisfy the Pi SDK `engines`; currently `>=22.19.0`.
- Electron's bundled Node version must be compatible with the Pi SDK. When the bundled Node satisfies the Pi SDK engines, PiHost runs directly in the bundled Node (`ELECTRON_RUN_AS_NODE` fork) and reads the asar; if the bundled Node is below the requirement, switch to an external system Node and unpack node_modules entirely (a system Node cannot read asar).

## Upgrade Order

1. Close this project's Electron/Vite/Node dev processes first so Windows does not lock the Electron binaries.
2. Run `npm outdated --workspaces --include-workspace-root`.
3. Upgrade the peer dependencies of Vite and `@vitejs/plugin-react` first, then Electron, React, TypeScript, and the toolchain.
4. Run `npm install`; commit `package.json` and `package-lock.json`.
5. Run `npm ls --depth=0 --workspaces`; confirm there are no `ERESOLVE`, invalid, or extraneous entries.
6. Run `npm run typecheck` and `npm run build`.

## Prohibited

- Do not use `--force` or `--legacy-peer-deps` to mask peer dependency conflicts.
- Do not replace `node_modules/electron` while an old Electron process is still running.
- Do not lower the Node engines or roll back the Pi SDK for build convenience.
