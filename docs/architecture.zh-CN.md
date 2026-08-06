# PiDeck 当前架构说明

> 本文描述当前仓库已经实现的结构，不描述尚未落地的目标架构。
> 目标方案和后续计划请见 [产品与技术方案](product-plan.zh-CN.md)。

## 1. 产品边界

PiDeck 是 `@earendil-works/pi-coding-agent` 的桌面适配层：Renderer 负责交互和呈现，PiHost 负责 Pi Session、ModelRuntime、Agent、Tool、Provider、资源和 CLI 兼容能力。

PiDeck 不提供：

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
              └─ Electron 内置 Node（ELECTRON_RUN_AS_NODE）
                  └─ @earendil-works/pi-coding-agent
```

当前实现使用普通 Node `child_process.fork` 和 `process.send/process.on("message")`，不是 Electron `utilityProcess`，也不是 MessagePort。fork 目标是 Electron 自身可执行文件并带 `ELECTRON_RUN_AS_NODE=1`，即 Electron 内置 Node：内置 Node 满足 Pi SDK engines 时不存在 WebIDL/undici 兼容问题，且能透明读取 asar 归档，因此 node_modules 全部打包进 asar，仅原生 `.node` 模块与 `apps/desktop/assets` 经 `asarUnpack` 解包。若内置 Node 低于 Pi SDK 要求，则必须改用外部系统 Node 并整体解包 node_modules（系统 Node 不能读取 asar）。

### 2.1 Main

`apps/desktop/src/main/index.ts`

Main 只负责：

- 创建和销毁 BrowserWindow。
- 启动、监听和停止 PiHost。
- 在 Renderer IPC 与 PiHost 请求之间做编排。
- 为请求设置超时，处理 Host 断开。
- 通过系统浏览器打开经过协议校验的 HTTP(S) URL。
- 在 Electron `userData/projects.json` 中记录项目目录引用、隐藏引用及其显示顺序。

项目目录清单只保存 `cwd`，不保存 Session 或工作区内容。Renderer 单击项目时通过 `sessions.list(cwd)` 按需展开会话列表，并以独立展开状态保留其它项目，不改变当前中央会话；只有单击具体会话才切换工作区。项目右键“移除”只把 `cwd` 加入隐藏引用，不删除项目文件或 Pi Session。Main 不创建 `AgentSession`，不保存 Provider 凭据，也不执行用户 Shell 命令。

### 2.2 Preload

`apps/desktop/src/preload/index.ts`

Preload 通过 `contextBridge` 暴露 capability-scoped 的 `window.pideck`。Renderer 只能使用 contracts 中声明的能力，不能获得原始 `ipcRenderer`、Node 对象或 Credential 对象。

### 2.3 PiHost

`packages/pi-host/src/index.ts`

PiHost 负责：

- 编排 `@pideck/pi-adapter`、SessionManager、AgentSession 和 ModelRuntime。
- 读取/恢复 Pi Session。
- 转发 Agent event、Approval event、Auth event。
- 执行 Pi built-in tools、Bash、Provider 登录和会话操作。
- 将跨进程数据转换成可 JSON 序列化的响应。

Pi SDK 的动态定位、加载和模型/Session 适配集中在 `packages/pi-adapter`。Pi 权限配置、Extension UI 绑定、审批等待和策略切换集中在 `packages/permission-engine`。两者都不创建第二套 Agent、Provider 或 Session 存储；权威来源仍是 Pi SDK 和 `@gotgenes/pi-permission-system`。

## 3. 当前仓库结构

```text
PiDeck/
├─ apps/desktop/
│  └─ src/
│     ├─ main/index.ts              # Electron Main 与 IPC 编排
│     ├─ preload/index.ts           # contextBridge
│     ├─ renderer/
│     │  ├─ App.tsx                 # 仅入口与 Controller/View 组合
│     │  ├─ app-view.tsx            # 工作区壳层与全局面板组合
│     │  ├─ app-sidebar.tsx         # 项目树、Session 列表与侧栏交互
│     │  ├─ app-conversation.tsx    # 会话 pane 缓存、对话区与 Composer 组合
│     │  ├─ ui-components.tsx       # 消息、时间线、Composer、弹层等 UI
│     │  ├─ timeline-utils.ts       # 回合分组、执行摘要和稳定时间线项
│     │  ├─ use-app-controller.tsx  # 页面状态与动作编排
│     │  ├─ use-session-data.ts     # Session/能力/消息加载
│     │  ├─ use-runtime-events.ts   # PiHost Agent event 状态归一化
│     │  ├─ use-conversation-scroll.ts # Session 滚动快照与最新位置
│     │  ├─ use-global-shortcuts.ts # 全局快捷键与焦点边界
│     │  ├─ use-sent-images-cache.ts # 待发送图片缓存
│     │  ├─ ui-performance.ts       # 终端输出等有界性能 helper
│     │  ├─ message-utils.ts        # 消息 identity、快照合并和时间格式化
│     │  ├─ types.ts                # Renderer 状态与消息辅助类型
│     │  ├─ image-cache.ts          # 图片预览缓存
│     │  ├─ pi-capabilities.ts      # Pi 不可用时的独立命令 fallback
│     │  ├─ styles.css              # 当前 UI token 与布局样式
│     │  ├─ main.tsx                # Renderer 入口
│     │  └─ vite-env.d.ts
├─ packages/
│  ├─ contracts/                    # Bridge、IPC command、runtime event 类型
│  ├─ domain/                       # Task、Project 类型及共享运行时 helper
│  ├─ pi-adapter/                   # Pi SDK 定位、加载及模型/Session 适配
│  ├─ pi-host/                      # PiHost 进程入口和 Host command 编排
│  ├─ permission-engine/            # Pi 权限配置、Extension UI 和审批等待
│  ├─ ui-system/                    # Renderer 共享 Icon、焦点和剪贴板基元
│  └─ i18n/                         # zh/en 文案和命令描述
├─ docs/
├─ rules/
└─ package.json
```

上述 `packages/pi-adapter`、`packages/pi-host`、`packages/permission-engine`、`packages/ui-system`、`packages/i18n` 已作为当前实现的独立 workspace 包存在；它们负责代码边界拆分，不引入第二套 Agent、权限、会话或凭据系统。

## 4. 依赖方向与边界

```text
renderer → contracts/domain/i18n/ui-system
preload  → contracts
main     → contracts + pi-host（仅启动进程）
pi-host  → contracts + domain + pi-adapter + permission-engine
pi-adapter → Pi SDK（仅动态加载和公开 API 适配）
permission-engine → contracts + Pi Permission System 配置
```

这些 workspace 包的类型入口保留在 `src/index.ts` / `src/index.tsx`，运行时入口指向构建生成的 `dist/index.js`。桌面开发和生产构建会先编译 `domain`、`pi-adapter`、`permission-engine`、`pi-host`、`i18n` 和 `ui-system`，避免 PiHost Node 进程或 Renderer 直接加载未编译的 TypeScript。

必须遵守：

- Renderer 不得 import Pi SDK、Node builtin 或凭据对象。
- Main 不得直接创建 AgentSession。
- PiHost 是当前唯一允许依赖 Pi SDK 的代码边界。
- 跨进程消息只能传 JSON/structured-clone 可序列化数据。
- 新增 IPC 必须先更新 `packages/contracts`，再实现 Main、Preload 和 Renderer。
- Pi fallback 能力必须独立于 UI 组件，并标明权威来源仍为 Pi CLI/SDK。

Renderer 的会话时间线由 `app-conversation.tsx` 和 `ui-components.tsx` 组合，使用 `@tanstack/react-virtual` 管理长会话。每个访问过的 Session 保留独立 pane、DOM `scrollTop`、follow 状态和虚拟器测量快照；首次打开无快照时定位到最新消息，有快照时恢复用户位置。用户向上滚动后立即退出 follow，队列变化和流式增长不会抢回用户位置。

PiDeck 的 Renderer `activity/completedActivity` 仍是当前进程内的展示状态，不会直接写回会话。为稳定恢复“已处理”耗时，PiHost 在 `agent_start`、非 Steering 的 Follow-up 边界和 `agent_settled` 记录每个 execution group 的 `startedAt/endedAt/durationMs`，并通过 Pi 官方 `SessionManager.appendCustomEntry()` 写入 `pideck.execution-run` 自定义 entry；该 entry 不进入 LLM context。Renderer 通过 `sessions.runMetadata` 读取精确耗时，Pi 原始 thinking/tool 仅用于重建步骤内容。没有该元数据的旧会话显示“已处理”但不再从消息时间戳推断耗时。

## 5. 当前 Bridge 能力

以 `packages/contracts/src/index.ts` 为准，当前已声明：

- `runtime.status`
- `projects.list/chooseDirectory/remove/setTrust`
- `sessions.list/create/delete/messages/runMetadata/capabilities/compact/export/import/rename/stats/share/changelog`
- `agent.queue/setQueueModes/clearQueue/promoteQueue`
- `extensions.resolveUi`
- `packages.list/install/remove/update/configure`
- `permissions.status/setMode`
- `models.list`
- `workspace.snapshot`
- `terminal.execute`
- `providers.list/login/logout/setApiKey/auth-response/open-auth-url`
- `agent.prompt/abort/setThinkingLevel/setModel/setScopedModels`
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

认证提示通过 `providers.auth-response` 回传文本、选择项或取消状态；取消会结束 Pi 的等待，不会遗留挂起的登录请求。

`agent.event` 当前覆盖 Agent start/end、agent settled、turn start/end、message start/update/end/snapshot、tool execution start/update/end、queue update 等事件。`agent_end` 的 `messages` 来自 Pi SDK，Renderer 在后续自动重试或队列续接前即可合并本轮消息；`agent_settled` 再读取最终 Session 快照。Renderer 只使用可序列化的归一化对象，不接触 AgentSession 实例。

## 7. Pi 能力映射

- Pi Session / `cwd` → 左侧项目树、项目内会话列表与中央对话。
- Pi ModelRuntime → Provider 设置、模型选择和思考等级。
- Pi slash command / Prompt / Skill catalog → Composer 建议和命令面板。
- Pi Agent event → 流式回复、工具过程、审批和运行状态。
- Pi Session export/compact → 会话操作和命令面板入口；Session Tree 的 `/fork`、`/clone`、`/tree` 仍列入待支持。
- Pi Agent steering/follow-up queue → Composer 队列面板、投递方式和批处理模式。
- Pi workspace / git status → Files 与 Changes 面板。

对于当前没有稳定 Bridge 或 UI 的能力，必须显示未实现，不能伪造成功状态。PiDeck 不额外维护一套独立的 Pi CLI 执行面板。

## 8. 运行时验证

修改 PiHost、contracts、Main、Preload 或 Provider/Session 相关能力后，至少执行：

```text
runtime.status
projects.list
models.list
providers.list
sessions.create
sessions.runMetadata
sessions.capabilities
workspace.snapshot
terminal.execute（仅无副作用命令）
```

同时运行：

```bash
npm run typecheck
npm run test:renderer
npm run build
```
