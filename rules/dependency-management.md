# 依赖升级与运行时兼容

## 版本基线

- 使用 npm registry 当前稳定版，不手工停留在旧主版本。
- Node.js 基线必须满足 Pi SDK 的 `engines`；当前为 `>=22.19.0`。
- Electron 的内置 Node 版本必须与 Pi SDK 兼容。若 Electron 内置 Node 低于 Pi SDK 要求，PiHost 必须运行在外部系统 Node 中，不能把 SDK 硬塞进 Electron utility process。

## 升级顺序

1. 先关闭本项目的 Electron/Vite/Node 开发进程，避免 Windows 锁住 Electron 二进制文件。
2. 查询 `npm outdated --workspaces --include-workspace-root`。
3. 先升级 Vite 与 `@vitejs/plugin-react` 的 peer 依赖，再升级 Electron、React、TypeScript 和工具链。
4. 运行 `npm install`，提交 `package.json` 和 `package-lock.json`。
5. 运行 `npm ls --depth=0 --workspaces`，确认没有 `ERESOLVE`、invalid 或 extraneous。
6. 运行 `npm run typecheck` 和 `npm run build`。

## 禁止事项

- 不要使用 `--force` 或 `--legacy-peer-deps` 掩盖 peer dependency 冲突。
- 不要在旧 Electron 进程仍运行时强行替换 `node_modules/electron`。
- 不要因为构建方便而降低 Node engines 或回退 Pi SDK。
