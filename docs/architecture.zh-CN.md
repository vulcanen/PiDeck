# PiDeck 当前架构说明

> 本文描述当前仓库已经实现的结构，不描述尚未落地的目标架构。
> 目标方案和后续计划请见 [产品与技术方案](product-plan.zh-CN.md)。

## 1. 产品边界

PiDeck 是 `@earendil-works/pi-coding-agent` 的桌面适配层：Renderer 负责交互和呈现，PiHost 负责 Pi Session、ModelRuntime、Agent、Tool、Provider、资源和 CLI 兼容能力。

PiDeck 不提供：

- PiDeck 账户、云端登录、云端会话同步或团队工作区。
- 第二套 Agent、模型目录、凭据存储或会话数据库。
- Renderer 侧的 Node.js、文件系统、Shell 或 Pi SDK 访问。

Provider API Key、OAuth 和其他凭据继续由 Pi Runtime 保存在本机 Pi 配置目录。

## 2. 当前运行时拓扑

```text
Sandboxed React Renderer
  └─ Preload: window.pideck
      └─ Electron Main
          ├─ BrowserWindow 生命周期
          ├─ IPC handler 编排
          └─ child_process.fork(PiHost)
              └─ 系统 Node.js
                  └─ @earendil-works/pi-coding-agent
```

当前实现使用普通 Node `child_process.fork` 和 `process.send/process.on("message")`，不是 Electron `utilityProcess`，也不是 MessagePort。这样可以让 Pi SDK 运行在满足 Node engines 的系统 Node 中，避免 Electron 内置 Node 与 Pi SDK/undici 的兼容问题。

### 2.1 Main

`apps/desktop/src/main/index.ts`

Main 只负责：

- 创建和销毁 BrowserWindow。
- 启动、监听和停止 PiHost。
- 在 Renderer IPC 与 PiHost 请求之间做编排。
- 为请求设置超时，处理 Host 断开。
- 通过系统浏览器打开经过协议校验的 HTTP(S) URL。

Main 不创建 `AgentSession`，不保存 Provider 凭据，也不执行用户 Shell 命令。

### 2.2 Preload

`apps/desktop/src/preload/index.ts`

Preload 通过 `contextBridge` 暴露 capability-scoped 的 `window.pideck`。Renderer 只能使用 contracts 中声明的能力，不能获得原始 `ipcRenderer`、Node 对象或 Credential 对象。

### 2.3 PiHost

`apps/desktop/src/utility/pi-host/index.ts`

PiHost 负责：

- 定位并动态加载 Pi SDK。
- 创建和缓存 `SessionManager`、`AgentSession` 和 `ModelRuntime`。
- 读取/恢复 Pi Session。
- 转发 Agent event、Approval event、Auth event。
- 执行 Pi built-in tools、Bash、Provider 登录和会话操作。
- 将跨进程数据转换成可 JSON 序列化的响应。

当前审批实现是 PiHost 内的 `beforeToolCall` 适配：`read`、`grep`、`find`、`ls` 默认直接允许，其他工具通过 PiDeck 审批卡确认。当前仓库没有显式加载 `@gotgenes/pi-permission-system`；该包虽然存在于 npm，并提供 `allow/ask/deny` 与 `yoloMode`，不能在文档中声称它已经是 PiDeck 的实际运行时依赖，除非完成真实的 Pi Extension 加载和事件桥接。

## 3. 当前仓库结构

```text
PiDeck/
├─ apps/desktop/
│  └─ src/
│     ├─ main/index.ts              # Electron Main 与 IPC 编排
│     ├─ preload/index.ts           # contextBridge
│     ├─ renderer/
│     │  ├─ App.tsx                 # 当前工作区、对话、设置和面板
│     │  ├─ styles.css              # 当前 UI token 与布局样式
│     │  ├─ i18n.ts                 # zh/en 文案
│     │  ├─ ui.tsx                  # Icon、焦点管理、剪贴板等共享基元
│     │  ├─ pi-capabilities.ts      # Pi 不可用时的独立命令 fallback
│     │  ├─ main.tsx                # Renderer 入口
│     │  └─ vite-env.d.ts
│     └─ utility/pi-host/index.ts   # PiHost 入口
├─ packages/
│  ├─ contracts/                    # Bridge、IPC command、runtime event 类型
│  └─ domain/                       # Task、Project 等纯领域类型
├─ docs/
├─ rules/
└─ package.json
```

目前尚未存在 `packages/pi-adapter`、`packages/pi-host`、`packages/permission-engine`、`packages/ui-system`、`packages/i18n` 等独立包。它们是未来拆分方向，不应在当前文档中被写成已存在模块。

## 4. 依赖方向与边界

```text
renderer → contracts/domain
preload  → contracts
main     → contracts
pi-host  → contracts + Pi SDK
```

必须遵守：

- Renderer 不得 import Pi SDK、Node builtin 或凭据对象。
- Main 不得直接创建 AgentSession。
- PiHost 是当前唯一允许依赖 Pi SDK 的代码边界。
- 跨进程消息只能传 JSON/structured-clone 可序列化数据。
- 新增 IPC 必须先更新 `packages/contracts`，再实现 Main、Preload 和 Renderer。
- Pi fallback 能力必须独立于 UI 组件，并标明权威来源仍为 Pi CLI/SDK。

## 5. 当前 Bridge 能力

以 `packages/contracts/src/index.ts` 为准，当前已声明：

- `runtime.status`
- `projects.list`
- `sessions.list/create/delete/messages/capabilities/tree/navigate/fork/compact/export`
- `models.list`
- `workspace.snapshot`
- `terminal.execute`
- `providers.list/login/logout/setApiKey/auth-response/open-auth-url`
- `agent.prompt/abort/setThinkingLevel/setModel`
- `approvals.resolve`
- `events.subscribe`

如果文档与 `packages/contracts` 不一致，以 contracts 和实现为准，文档必须在同一个变更中更新。

## 6. 当前事件流

PiHost 将以下事件发送到 Renderer：

```ts
{ type: "runtime.status", payload: "connected" | "starting" | "disconnected" }
{ type: "agent.event", taskId, event }
{ type: "approval.requested", taskId, requestId, event: { toolName, args } }
{ type: "auth.event", requestId, event }
```

`agent.event` 当前覆盖 Agent start/end、turn start/end、message update/snapshot、tool execution start/update/end 等事件。Renderer 只使用可序列化的归一化对象，不接触 AgentSession 实例。

## 7. Pi 能力映射

- Pi Session → 左侧会话列表与中央对话。
- Pi ModelRuntime → Provider 设置、模型选择和思考等级。
- Pi slash command / Prompt / Skill catalog → Composer 建议和命令面板。
- Pi Agent event → 流式回复、工具过程、审批和运行状态。
- Pi Session export/compact/tree → 会话操作和命令面板入口。
- Pi workspace / git status → Files 与 Changes 面板。

对于当前没有稳定 Bridge 或 UI 的能力，必须显示未实现或通过 Pi CLI 兼容通道提供，不能伪造成功状态。

## 8. 运行时验证

修改 PiHost、contracts、Main、Preload 或 Provider/Session 相关能力后，至少执行：

```text
runtime.status
projects.list
models.list
providers.list
sessions.create
sessions.capabilities
workspace.snapshot
terminal.execute（仅无副作用命令）
```

同时运行：

```bash
npm run typecheck
npm run build
```
