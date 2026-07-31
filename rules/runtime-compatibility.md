# Electron / PiHost 通信与验证

## 通信模型

- Renderer -> Preload -> Main IPC -> PiHost -> Pi SDK。
- PiHost 在 Windows 上优先使用系统 Node 启动，避免 Electron 内置 Node 与 Pi SDK/undici 的 WebIDL 版本冲突。
- Electron `utilityProcess` 的 `process.parentPort` 只适用于 Electron utility runtime；使用普通 Node `child_process.fork` 时必须使用 `process.send` / `process.on("message")`。
- Main 必须监听 Host 的启动、消息、错误和退出事件，并为挂起请求设置超时。

## 冒烟验证

构建后至少验证：

- PiHost runtime status
- `projects.list`
- `models.list`
- `providers.list`
- `sessions.create`
- `sessions.capabilities`
- `workspace.snapshot`
- `terminal.execute`（只使用无副作用命令）

真实模型 prompt 会产生网络和 Provider 副作用，未经用户明确授权不要自动执行。

## 常见故障

- `PiHost request timed out`：先检查 Host 是否启动、IPC 事件是否被正确读取，再检查 SDK 初始化错误。
- `webidl.util.markAsUncloneable is not a function`：通常是 Pi SDK/undici 在旧 Electron Node 中运行，切换到满足 Pi SDK engines 的系统 Node。
- 模型空列表：区分“模型目录为空”“Provider 未认证”和“IPC 请求失败”，UI 不得把三者都显示成同一个空状态。
- 交互式认证（尤其 OAuth 浏览器回调）不是普通短请求，`providers.login` 必须允许足够长的等待时间，并持续显示“授权中”状态；禁止使用统一的短超时掩盖等待中的回调。
