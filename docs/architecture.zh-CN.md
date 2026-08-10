# PiDeck 当前架构说明

> 本文描述当前仓库已经实现的结构，不描述尚未落地的目标架构。
> 目标方案和后续计划请见 [产品与技术方案](product-plan.en.md)。

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

两个运行时定位入口：

- `PIDECK_NODE_EXECUTABLE`：显式指定 PiHost 使用的 Node 可执行文件，缺省为 `process.execPath`（Electron 内置 Node）。
- `PIDECK_PI_MODULE`：显式指定 Pi SDK 入口文件，缺省由 `packages/pi-adapter` 在候选路径中查找。

`packages/pi-host` 同时向 `process.send` 和 `worker_threads` 的 `parentPort` 投递消息，因此进程宿主方式可替换，但当前 Main 只使用 `child_process.fork`。

### 2.1 Main

`apps/desktop/src/main/index.ts`

Main 只负责：

- 创建和销毁 BrowserWindow（`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`）。
- 启动、监听和停止 PiHost。
- 在 Renderer IPC 与 PiHost 请求之间做编排。
- 为请求设置超时（默认 60s；`providers.login`、`sessions.share` 15min，`packages.*` 10min；`agent.prompt` 不设超时——其完成由 `agent_settled` 事件标示，而非 RPC 响应），处理 Host 断开。
- 通过系统浏览器打开经过协议校验的 HTTP(S) URL，并拒绝窗口内新开链接。
- 在 Electron `userData/projects.json` 中记录项目目录引用、隐藏引用及其显示顺序。
- 构建应用菜单并按 `app:set-language` 切换菜单语言，文案取自 `@pideck/i18n`。
- 打开目录选择、会话导入等原生对话框。
- macOS 上设置 Dock 图标，并尝试加载 `pideck-miniwindow.node` 定制最小化窗口图标；加载失败只降级告警。

项目目录清单只保存 `cwd`，不保存 Session 或工作区内容。Renderer 单击项目时通过 `sessions.list(cwd)` 按需展开会话列表，并以独立展开状态保留其它项目，不改变当前中央会话；只有单击具体会话才切换工作区。项目右键“移除”只把 `cwd` 加入隐藏引用，不删除项目文件或 Pi Session。Main 不创建 `AgentSession`，不保存 Provider 凭据，也不执行用户 Shell 命令。

### 2.2 Preload

`apps/desktop/src/preload/index.ts`

Preload 通过 `contextBridge` 暴露 capability-scoped 的 `window.pideck`。Renderer 只能使用 contracts 中声明的能力，不能获得原始 `ipcRenderer`、Node 对象或 Credential 对象。

### 2.3 PiHost

`packages/pi-host/src/index.ts`

PiHost 负责：

- 编排 `@pideck/pi-adapter`、SessionManager、AgentSession 和 ModelRuntime。
- 读取/恢复 Pi Session，并通过 `SessionManager.appendCustomEntry()` 写入 `pideck.execution-run` 运行元数据。
- 转发 Agent event、Approval event、Auth event 和 Extension UI 请求。
- 执行 Pi built-in tools、Bash、Provider 登录、Pi package 管理、权限模式读写和会话操作。
- 将跨进程数据转换成可 JSON 序列化的响应（`jsonSafe`），并对队列中的图片附件做旁路保存，避免 `promoteQueue` 丢附件。

Pi SDK 的动态定位、加载和模型/Session 适配集中在 `packages/pi-adapter`。Pi 权限配置、Extension UI 绑定、审批等待和策略切换集中在 `packages/permission-engine`。两者都不创建第二套 Agent、Provider 或 Session 存储；权威来源仍是 Pi SDK 和 `@gotgenes/pi-permission-system`。

## 3. 当前仓库结构

```text
PiDeck/
├─ apps/desktop/
│  ├─ index.html                          # Vite Renderer 宿主页面
│  ├─ vite.config.ts                      # Renderer 构建，输出到根目录 dist-renderer/
│  ├─ assets/                             # 应用图标、mac Info.plist、原生插件产物
│  ├─ native/miniwindow.mm                # macOS 最小化窗口图标原生定制源码
│  ├─ public/                             # Renderer 静态资源
│  ├─ scripts/
│  │  ├─ build-native.mjs                 # 原生插件构建（非 macOS 跳过）
│  │  └─ renderer-regressions.test.cjs    # node --test Renderer 回归用例
│  └─ src/
│     ├─ main/index.ts                    # Electron Main、应用菜单与 IPC 编排
│     ├─ preload/index.ts                 # contextBridge
│     └─ renderer/
│        ├─ App.tsx                       # 仅入口与 Controller/View 组合
│        ├─ main.tsx                      # Renderer 挂载入口
│        ├─ app-view.tsx                  # 工作区壳层与全局布局
│        ├─ app-sidebar.tsx               # 项目树、Session 列表与侧栏交互
│        ├─ app-conversation.tsx          # 会话 pane 缓存、对话区与 Composer 组合
│        ├─ app-overlays.tsx              # 命令面板、对话框等全局浮层组合
│        ├─ use-app-controller.tsx        # 页面状态与动作编排
│        ├─ use-session-data.ts           # Session/能力/消息加载
│        ├─ use-runtime-events.ts         # PiHost 运行时事件状态归一化
│        ├─ use-conversation-scroll.ts    # Session 滚动快照与最新位置
│        ├─ use-stream-deltas.ts          # 流式增量的有界批处理
│        ├─ use-global-shortcuts.ts       # 全局快捷键与焦点边界
│        ├─ use-preferences.ts            # 语言与主题偏好
│        ├─ use-notice.ts                 # 轻量提示状态
│        ├─ use-sent-images-cache.ts      # 待发送图片缓存
│        ├─ timeline-utils.ts             # 回合分组、执行摘要和稳定时间线项
│        ├─ message-utils.ts              # 消息 identity、快照合并和时间格式化
│        ├─ image-cache.ts                # 图片预览缓存
│        ├─ pi-capabilities.ts            # Pi 资源不可用时的 slash 命令 fallback
│        ├─ types.ts                      # Renderer 状态与消息辅助类型
│        ├─ styles.css                    # 当前 UI token 与布局样式
│        ├─ vite-env.d.ts
│        └─ ui/                           # 展示层组件，按 UI 职责拆分文件
│           ├─ index.ts                   # UI 统一出口
│           ├─ message-timeline.tsx       # 会话时间线（文档流 + 早期消息折叠）
│           ├─ message-view.tsx           # 单条消息渲染
│           ├─ execution-summary.tsx      # “已处理”执行摘要
│           ├─ composer.tsx               # 输入区、建议与队列投递
│           ├─ command-palette.tsx        # 命令面板
│           ├─ dialogs.tsx                # 重命名/信任/恢复/扩展 UI 等对话框
│           ├─ approval-card.tsx          # 工具审批卡
│           ├─ provider-settings.tsx      # Provider 认证设置
│           ├─ package-settings.tsx       # Pi package 管理
│           ├─ permission-level.tsx       # 权限等级控件
│           ├─ context-ring.tsx           # 上下文占用指示
│           ├─ working-indicator.tsx      # 运行中指示
│           ├─ task-row.tsx               # 会话行与状态标记
│           ├─ skeletons.tsx              # 骨架屏
│           ├─ markdown.tsx               # Markdown、代码块、数学公式与 Mermaid 图表渲染
│           └─ shared.ts                  # 剪贴板与菜单键盘导航 helper
├─ packages/
│  ├─ contracts/                          # Bridge、IPC command、runtime event 类型（纯类型包，无构建产物）
│  ├─ domain/                             # Task、Project 类型及共享运行时 helper
│  ├─ pi-adapter/                         # Pi SDK 定位、加载及模型/Session 适配
│  ├─ pi-host/                            # PiHost 进程入口和 Host command 编排
│  ├─ permission-engine/                  # Pi 权限配置、Extension UI 和审批等待
│  ├─ ui-system/                          # Renderer 共享 Icon、焦点和剪贴板基元
│  └─ i18n/                               # zh/en 文案和命令描述
├─ docs/                                  # 架构、产品方案与 Pi 能力矩阵
├─ rules/                                 # 开发与文档同步规则
├─ dist-renderer/                         # Renderer 构建产物（不入库）
├─ release/                               # electron-builder 打包产物（不入库）
├─ AGENTS.md
└─ package.json                           # npm workspaces 根配置与 electron-builder 配置
```

`packages/*` 每个包当前都只有单一 `src/index.ts`（`ui-system` 为 `src/index.tsx`）作为入口，没有更深的目录分层。它们负责代码边界拆分，不引入第二套 Agent、权限、会话或凭据系统。

Renderer 的展示层组件全部收敛在 `renderer/ui/`，并统一由 `ui/index.ts` 再导出；流式增量的有界批处理由 `use-stream-deltas.ts` 负责。早期版本中的单文件 UI 组件与性能 helper 已被这两处结构取代，历史文档若仍引用旧文件名，应按本节结构订正。

## 4. 依赖方向与边界

```text
renderer → contracts + domain + i18n + ui-system
preload  → contracts
main     → contracts + i18n（菜单文案）；按路径 fork packages/pi-host/dist/index.js，不 import 其模块
pi-host  → contracts + domain + pi-adapter + permission-engine
pi-adapter → Pi SDK（仅动态定位、加载和公开 API 适配）
permission-engine → contracts + @gotgenes/pi-permission-system 配置
```

`packages/contracts` 是纯类型包，`exports` 直接指向 `src/index.ts`，不参与构建也不在 `typecheck` 脚本里单独执行。其余 workspace 包的类型入口保留在 `src/index.ts` / `src/index.tsx`，运行时入口指向构建生成的 `dist/index.js`；桌面开发（`predev`）和生产构建（`prebuild`）按 `domain → pi-adapter → permission-engine → pi-host → i18n → ui-system` 顺序编译，避免 PiHost Node 进程或 Renderer 直接加载未编译的 TypeScript。

必须遵守：

- Renderer 不得 import Pi SDK、Node builtin 或凭据对象。
- Main 不得直接创建 AgentSession。
- PiHost 是当前唯一允许依赖 Pi SDK 的代码边界。
- 跨进程消息只能传 JSON/structured-clone 可序列化数据。
- 新增 IPC 必须先更新 `packages/contracts`，再实现 Main、Preload 和 Renderer。
- Pi fallback 能力必须独立于 UI 组件，并标明权威来源仍为 Pi CLI/SDK。

Renderer 的会话时间线由 `app-conversation.tsx` 与 `ui/message-timeline.tsx` 组合，采用**普通文档流列表 + 早期消息折叠**，不使用虚拟列表。原因是 Mermaid、KaTeX、语法高亮都是异步定高，虚拟列表的测量-定位循环与之根本冲突（跳动、重叠、回弹）；改为只挂载最近 `FOLD_WINDOW = 200` 条消息，更早的消息折叠在"显示更早消息"按钮后，每次展开 `FOLD_STEP = 200` 条。防跳动依赖浏览器原生 scroll anchoring：`.conversation-scroll` 必须保持 `overflow-anchor: auto`（虚拟列表时代的 `none` 会关闭该机制）。

每个访问过的 Session 保留独立 pane，非活动 pane 用 `visibility: hidden` 而非 `display: none`，浏览器因此天然保留各自的 `scrollTop`，无需手动恢复逻辑；快照 `ConversationScrollSnapshot` 只剩 `{ top, follow }`。follow 状态的退出**只认真实输入事件**（`wheel` 且 `deltaY < 0`、touch 上滑），不再从 `scrollTop` 变小推断——因为内容会真实收缩（流式行被最终消息替换、working 指示器消失、执行摘要折叠），按位移推断会误判成"用户上滚"从而杀死自动跟随。程序化平滑滚动期间用 `pinningRef`（含 1000ms 兜底超时）latch 住 follow，避免"跳到最新"按钮在动画中途闪回。

PiDeck 的 Renderer `activity/completedActivity` 仍是当前进程内的展示状态，不会直接写回会话。为稳定恢复“已处理”耗时，PiHost 在 `agent_start`、非 Steering 的 Follow-up 边界和 `agent_settled` 记录每个 execution group 的 `startedAt/endedAt/durationMs`，并通过 Pi 官方 `SessionManager.appendCustomEntry()` 写入 `pideck.execution-run` 自定义 entry；该 entry 不进入 LLM context。Renderer 通过 `sessions.runMetadata` 读取精确耗时，Pi 原始 thinking/tool 仅用于重建步骤内容。没有该元数据的旧会话显示“已处理”但不再从消息时间戳推断耗时。

## 5. 当前 Bridge 能力

以 `packages/contracts/src/index.ts` 的 `PideckBridge` 为准，当前已声明：

- `app.setLanguage/quit`
- `runtime.status`
- `projects.list/chooseDirectory/remove/setTrust`
- `sessions.list/create/delete/remove/messages/runMetadata/capabilities/compact/export/import/rename/generateTitle/stats/share/changelog`
- `models.list`
- `workspace.snapshot`
- `providers.list/login/logout/setApiKey/resolveAuth/openAuthUrl`
- `agent.prompt/abort/setThinkingLevel/setModel/setScopedModels/queue/setQueueModes/clearQueue/promoteQueue`
- `extensions.resolveUi`
- `packages.list/install/remove/update/configure`
- `approvals.resolve`
- `permissions.status/setMode`
- `events.subscribe`

命名对应关系需要注意三处：

- `sessions.remove` 是 `sessions.delete` 的别名，两者走同一个 `sessions:delete` IPC 通道。
- `providers.resolveAuth` / `providers.openAuthUrl` 对应 IPC 通道 `providers:auth-response` / `providers:open-auth-url`；只有前者转发到 PiHost 命令 `providers.auth-response`，后者由 Main 直接用系统浏览器打开。
- `sessions.changelog` 对应 PiHost 命令 `app.changelog`；`projects.list/chooseDirectory/remove` 由 Main 结合 `projects.json` 与 PiHost `projects.list`、`sessions.list` 组合完成，没有一一对应的 Host 命令。

如果文档与 `packages/contracts` 不一致，以 contracts 和实现为准，文档必须在同一个变更中更新。

## 6. 当前事件流

`PiDeckRuntimeEvent` 声明的类型为 `runtime.status`、`agent.event`、`auth.event`、`approval.requested`、`approval.resolved`、`extension.ui.request`、`extension.ui.notify`。

当前实际以顶层 `type` 下发的消息有五种：

```ts
{ type: "runtime.status", payload: "connected" | "starting" | "disconnected" }
{ type: "agent.event", taskId, event }
{ type: "approval.requested", taskId, requestId, event: { toolName, args } }
{ type: "auth.event", requestId, event }
{ type: "extension.ui.request", taskId, requestId, event: ExtensionUiRequest }
```

`approval.resolved` 和 `extension.ui.notify` 由 `packages/permission-engine` 经 PiHost 的 `emit()` 下发，因此实际落到 Renderer 时是被包在 `agent.event` 的 `event.type` 里，而不是顶层 `type`。`approval.resolved` 只在切换权限模式导致挂起审批被自动放行或拒绝时产生，此时审批卡的清理由 Renderer 在 `permissions.setMode` 成功后本地完成；`use-runtime-events.ts` 中按顶层 `type` 匹配 `approval.resolved` 的分支当前不会命中。若要让顶层事件生效，需要在 PiHost 侧改为直接 `postMessage`，并在同一变更中更新本节。

`runtime.status` 由 Main 统一发布：PiHost 上报 `connected`，进程启动阶段为 `starting`，进程退出时为 `disconnected` 并拒绝所有挂起请求。

认证提示通过 `providers.resolveAuth`（IPC `providers:auth-response`）回传文本、选择项或取消状态；取消会结束 Pi 的等待，不会遗留挂起的登录请求。

`agent.event` 当前覆盖 Agent start/end、agent settled、turn start/end、message start/update/end/snapshot、tool execution start/update/end、queue update 等事件。`agent_end` 的 `messages` 来自 Pi SDK，Renderer 在后续自动重试或队列续接前即可合并本轮消息；`agent_settled` 再读取最终 Session 快照。Renderer 只使用可序列化的归一化对象，不接触 AgentSession 实例。

## 7. Pi 能力映射

- Pi Session / `cwd` → 左侧项目树、项目内会话列表与中央对话。
- Pi ModelRuntime → Provider 设置、模型选择和思考等级。
- Pi slash command / Prompt / Skill catalog → Composer 建议和命令面板。
- Pi Agent event → 流式回复、工具过程、审批和运行状态。
- Pi Session export/compact → 会话操作和命令面板入口；Session Tree 的 `/fork`、`/clone`、`/tree` 仍列入待支持。
- Pi Agent steering/follow-up queue → Composer 队列面板、投递方式和批处理模式。
- Pi Package 管理 → 命令面板中的 Pi packages 设置面板。
- Pi 权限系统模式 → 输入框下方的权限等级控件。
- Pi workspace 文件列表 → Composer 的 `@file` 引用候选。`workspace.snapshot` 同时返回 git `changes`，但当前 UI 没有独立的 Files / Changes 面板，该字段暂未消费。

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
```

同时运行：

```bash
npm run lint
npm run typecheck
npm run test:renderer
npm run build
```

`npm run test:renderer` 会先执行 `prebuild` 编译全部 workspace 包，再用 `node --test` 运行 `apps/desktop/scripts/renderer-regressions.test.cjs`。
