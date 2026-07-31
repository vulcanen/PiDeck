# PiDeck 开发说明

PiDeck 的唯一产品边界是：把 `@earendil-works/pi-coding-agent`（Pi CLI）的既有能力映射到桌面 UI。

不要在本项目中优先添加 Pi CLI 没有的产品能力、云端服务、账号体系或第二套 Agent 实现。任何 UI 能力都必须能追溯到 Pi CLI / Pi SDK 的真实 API、事件或资源。

## 开发前必读规则

- [Pi CLI 边界与适配原则](rules/pi-cli-scope.md)
- [依赖升级与运行时兼容](rules/dependency-management.md)
- [Electron/PiHost 通信与验证](rules/runtime-compatibility.md)

## 运行环境

- Node.js：`>=22.19.0`，与当前 Pi SDK 的 engines 要求一致。
- Electron：使用当前稳定版；Pi SDK 不应直接运行在低于其 Node engines 的 Electron 内置 Node 中。
- Pi SDK 路径优先使用 `PIDECK_PI_MODULE`；开发机可从全局 `pi` / npm root 定位。
- 修改依赖后必须更新 `package-lock.json`，并运行 `npm run typecheck`、`npm run build`。

## 代码边界

- Renderer 只通过 Preload Bridge 访问 Pi 能力，不得直接 import Pi SDK、Node built-ins 或凭据对象。
- 可见文案必须放在独立的 i18n 配置/模块中，组件只读取 key，不在 JSX 中持续堆积中英文字符串。
- Pi 能力的 fallback 目录必须独立于 UI 组件，并明确标注权威来源仍是 Pi CLI/SDK。
- Main 只负责窗口、IPC 编排和 Host 生命周期。
- PiHost 负责 Session、ModelRuntime、Agent、Tool、Provider、资源和 CLI 兼容能力。
- 跨进程消息必须是可 JSON/structured-clone 序列化的数据，不传递函数、类实例或 AbortController。
- 新增 IPC 必须先更新 `packages/contracts`，再实现 Main、Preload 和 Renderer。

## 完成标准

任何功能修复都必须同时验证：

1. PiHost 能启动并报告 runtime status。
2. 至少有一个真实 IPC 冒烟调用成功。
3. TypeScript 检查和生产构建通过。
4. 失败时 UI 显示可操作的错误，而不是无限 loading 或静默空白。
