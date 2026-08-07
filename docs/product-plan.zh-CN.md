# PiDeck 产品与技术方案

> 文档状态：与当前代码基线对齐；未实现项单独标记为计划。
>
> 更新日期：2026-08-04
>
> 目标平台：Windows、macOS

## 1. 产品定位与边界

PiDeck 是 `@earendil-works/pi-coding-agent` 的桌面 UI 适配层。它不重新实现 Agent、模型、会话存储、凭据或工具系统，而是把 Pi SDK/CLI 的本地能力映射到桌面工作区。

明确不做：

- 第二套 Agent、模型目录、凭据存储或消息数据库。
- 未经 Pi SDK/CLI 支持的业务能力。

Provider API Key、OAuth、Token 刷新和 Session 文件仍由 Pi Runtime 管理，凭据不进入 Renderer。

## 2. 当前实现基线

当前可运行结构：

```text
React Renderer
  → Preload contextBridge(window.pideck)
  → Electron Main IPC
  → child_process.fork(PiHost)
  → Electron 内置 Node（ELECTRON_RUN_AS_NODE）
  → @earendil-works/pi-coding-agent
```

当前代码不是 Electron `utilityProcess`，也不是 MessagePort。`packages/pi-host` 使用普通 Node `process.send/process.on("message")`。PiHost 运行在 Electron 内置 Node 中（满足 Pi SDK 的 Node engines 且可读取 asar），node_modules 打包进 asar，仅原生 `.node` 模块与 `apps/desktop/assets` 解包。

### 2.1 当前目录

```text
apps/desktop/
├─ index.html                    # Vite Renderer 宿主页面
├─ vite.config.ts                # Renderer 构建，输出 dist-renderer/
├─ assets/ · native/ · public/   # 图标、macOS 原生定制源码、静态资源
├─ scripts/                      # build-native.mjs、renderer-regressions.test.cjs
└─ src/
   ├─ main/index.ts              # Main、应用菜单与 IPC 编排
   ├─ preload/index.ts           # contextBridge
   └─ renderer/
      ├─ App.tsx                 # 入口与组合
      ├─ main.tsx                # Renderer 挂载入口
      ├─ app-view.tsx            # 工作区壳层与全局布局
      ├─ app-sidebar.tsx         # 项目/Session 侧栏
      ├─ app-conversation.tsx    # 会话 pane 与 Composer
      ├─ app-overlays.tsx        # 命令面板与对话框浮层
      ├─ use-app-controller.tsx  # 状态与动作编排
      ├─ use-session-data.ts     # Session 数据加载
      ├─ use-runtime-events.ts   # PiHost 事件归一化
      ├─ use-conversation-scroll.ts # 滚动快照与最新位置
      ├─ use-stream-deltas.ts    # 流式增量有界批处理
      ├─ use-global-shortcuts.ts # 全局快捷键与焦点边界
      ├─ use-preferences.ts      # 语言与主题偏好
      ├─ use-notice.ts           # 轻量提示状态
      ├─ use-sent-images-cache.ts # 待发送图片缓存
      ├─ timeline-utils.ts       # 回合分组与执行摘要
      ├─ message-utils.ts        # 消息合并与 identity
      ├─ types.ts                # Renderer 状态与辅助类型
      ├─ image-cache.ts · pi-capabilities.ts · styles.css · vite-env.d.ts
      └─ ui/                     # 时间线、消息、Composer、命令面板、对话框、设置等展示组件

packages/
├─ contracts/                    # Bridge/IPC 类型，纯类型包无 dist
├─ domain/                       # 类型与共享领域 helper
├─ pi-adapter/                   # Pi SDK 定位、加载和公开 API 适配
├─ pi-host/                      # PiHost 进程入口
├─ permission-engine/            # 权限配置与审批适配
├─ i18n/                         # zh/en 文案
└─ ui-system/                    # Renderer 共享 UI 基元
```

完整边界见 [当前架构说明](architecture.zh-CN.md)。

## 3. 当前用户闭环

当前已支持：

1. 启动 PiHost 并显示 Runtime 状态。
2. 自动发现 Pi Session 所属项目，记住用户手动添加的项目目录，并支持通过项目右键菜单隐藏目录引用（不删除文件或 Session）。
3. 按需同时展开多个项目的会话列表；项目展开状态彼此独立，仅在用户单击具体会话时切换中央工作区；无会话项目可在其展开区域直接创建首个 Session，并支持创建、切换、删除本地 Session。
4. 读取和显示 Session 消息。
5. 选择已认证 Provider/Model 和思考等级。
6. 发送 Prompt、查看流式回复和停止运行。
7. 查看工具调用、工具结果和审批卡。
8. 通过 `@file` 引用工作区文件。
9. 压缩上下文并导出 JSONL/HTML，导入 Pi JSONL 会话、重命名和查看会话统计。
10. 使用 Pi slash command catalog、Prompt、Skill 和 Extension command 建议。
11. 使用 Provider API Key/OAuth 本地认证。
12. 切换中文/英文和浅色/深色主题。
13. 使用 Steering / Follow-up 队列、批处理模式和队列消息面板。
14. 对长会话使用 TanStack Virtual，并按 Session 缓存消息 pane、滚动位置和测量快照。
15. 使用 `/copy`、`/share`、`/changelog`、`/hotkeys`、`/trust`、`/resume`、`/quit` 和 `/scoped-models` 的桌面映射；`/share` 依赖本机 `gh` CLI。
16. 在 Pi Session 自定义 entry 中持久化每次 Agent 运行的精确起止时间，关闭并重启后保持“已处理”耗时一致。

## 4. 消息与对话行为

- Pi 原始 Session message 是事实来源。
- Renderer 不把 Pi SDK 实例传入组件，只接受可序列化消息对象。
- Markdown、代码块、表格和链接由 Renderer 展示层渲染，不改变 Pi 原始消息。
- 会话标题已经避免直接使用完整 Skill 文本；首条用户消息后，标题在重新加载安全的截断回退基础上，会异步升级为 LLM 对首条消息的 3–8 词摘要（新增 `sessions.generateTitle` 桥：PiHost 用 `ModelRuntime.complete` 摘要首条消息，成功后再经 `sessions.rename` 持久化），手动改名优先于 LLM 升级。Skill 展开后的 `<skill>` 内容仍需补充独立的折叠引用卡片，当前不应宣称已经完成。
- 工具调用和思考过程应作为可折叠 Activity 展示，并显示工具数量、思考块数量和耗时。
- Pi 原始 thinking/tool 内容用于重建“已处理”摘要里的步骤内容；精确耗时来自 PiHost 在 `agent_start`、Follow-up 分组边界和 `agent_settled` 通过 `SessionManager.appendCustomEntry()` 写入的 `pideck.execution-run` 元数据，Steering 消息继续共享同一 execution group。运行时 `completedActivity` 仍不是持久化字段；没有元数据的旧会话只显示“已处理”，不根据消息时间戳推断耗时。
- 思考摘要、流式回复和最终 Assistant 消息复用稳定时间线项，避免回复完成时卸载/重建整段消息列表。
- 切换 Session 时立即定位到该会话的最新位置或保存的位置，不播放跨会话滚动动画。
- 用户手动离开底部时显示“回到最新消息”，不强制抢夺滚动位置。
- 排队消息新增、插入和处理时，只有在用户仍处于 follow 状态才自动滚动；用户向上滚动后立即退出 follow。

## 5. 当前 Bridge 契约

当前唯一权威定义是 `packages/contracts/src/index.ts`。主要能力：

```text
app.setLanguage/quit
runtime.status
projects.list/chooseDirectory/remove/setTrust
sessions.list/create/delete/remove/messages/runMetadata/capabilities/compact/export/import/rename/generateTitle/stats/share/changelog
models.list
workspace.snapshot
providers.list/login/logout/setApiKey/resolveAuth/openAuthUrl
agent.prompt/abort/setThinkingLevel/setModel/setScopedModels
agent.queue/setQueueModes/clearQueue/promoteQueue
approvals.resolve
events.subscribe
extensions.resolveUi
packages.list/install/remove/update/configure
permissions.status/setMode
```

Renderer → Preload → Main → PiHost 是唯一通信链路。新增 IPC 必须先更新 contracts，再实现 Main、Preload 和 Renderer。

## 6. Slash 命令策略

Pi CLI 内置 slash command 的权威清单来自 Pi ResourceLoader/SDK，fallback 只在运行时资源不可用时使用。

当前已映射或应映射到原生 UI 的命令：

- `/login`、`/logout` → Provider 设置。
- `/model` → 模型选择器。
- `/compact` → `AgentSession.compact()`。
- `/export` → Pi Session HTML/JSONL 导出。
- `/new` → 新建 Session。
- `/reload` → 重载 Pi 资源/重新读取初始数据。
- `/import`、`/name`、`/session`、`/share` → PiHost 会话导入、命名、统计和 GitHub Gist 分享。
- `/copy`、`/changelog`、`/hotkeys`、`/resume`、`/quit` → Renderer/Electron 桌面操作。
- `/trust`、`/scoped-models` → Pi 项目信任存储和模型范围设置。
- `/fork`、`/clone`、`/tree` → 暂不显示，列入待支持列表。

没有稳定 Bridge 的命令不得让模型把它当普通 Prompt 执行，也不得伪装成已经完成。UI 应显示可操作的“当前桌面端尚未支持”提示。

`/skill:name` 必须交给 `AgentSession.prompt()`，由 Pi SDK 负责 Skill 展开；PiDeck 当前只整理标题，Skill 内容折叠引用卡片仍在计划中。

## 7. 权限与审批

### 7.1 当前实现

当前 PiHost 使用 `AgentSession.agent.beforeToolCall` 做适配：

- `read`、`grep`、`find`、`ls` 默认允许。
- 其他工具进入 PiDeck 审批卡。
- 用户拒绝后返回阻止结果。

### 7.2 `@gotgenes/pi-permission-system` 现状

PiDeck 已将 `@gotgenes/pi-permission-system@24.0.0` 作为桌面 PiHost 的 Extension 依赖，并通过 Pi `DefaultResourceLoader.additionalExtensionPaths` 加载。桌面端提供以下模式：

- `allow`：静默允许工具执行。
- `ask`：执行前由 Pi 权限系统请求审批。
- `deny`：阻止工具执行。
- `yolo`：开启插件 `yoloMode`，自动批准 `ask`，用于全自动执行。

设置变更写入插件的全局 Pi 配置，并显示在输入框下方的当前权限等级控件中。切换不会中断正在运行的 Agent；空闲 Session 会在下一次提示前按新策略惰性重建。Extension 不可加载时，PiHost 才回退到内置 `beforeToolCall` 审批适配。

接入约束：

1. 在 PiHost 中通过 Pi Extension 机制加载真实包。
2. 让插件配置继续使用其 Pi 配置目录和 schema。
3. 将 `allow/ask/deny` 和 `yoloMode` 映射为只读状态/设置 UI。
4. 将插件的审批事件和决定事件归一化到 contracts。
5. 移除重复的 PiDeck 自定义审批门，避免一次工具调用出现两套审批。
6. 通过真实工具调用验证 allow、ask、deny、session approval 和失败关闭行为。

## 8. 当前未实现能力

以下仍是计划，不是当前产品承诺：

- Print、JSON、RPC、stdin、Auth Print 兼容通道。
- Monaco Diff、任务级基线和逐块审阅。
- Extension 的 TUI 专属 `custom` 组件、主题、Widget、Footer、Header 等无法跨进程传递组件实例的能力。

## 9. 技术与安全约束

- Node.js `>=22.19.0`，并满足当前 Pi SDK engines。
- Renderer 禁止 Node builtins、Pi SDK、Credential 和任意 IPC。
- Main 只做窗口、IPC 编排和 PiHost 生命周期。
- PiHost 承担 Pi SDK、Agent、Tool、Provider、Session 和资源。
- 跨进程只传 JSON/structured-clone 可序列化 DTO。
- 外部 URL 只允许 HTTP(S)，通过系统浏览器打开。
- API Key、OAuth Token 不进入 Renderer、日志、事件或 DevTools。
- 失败状态必须可见并提供重试或修复操作。

## 10. 验收命令

每次修改依赖、contracts、PiHost、Provider、Session 或 Renderer 核心交互后运行：

```bash
npm install
npm ls --depth=0 --workspaces
npm run typecheck
npm run test:renderer
npm run build
```

PiHost 相关修改还要验证：

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

## 11. 开发说明

项目开发边界、代码规范、依赖管理和验收要求见 [AGENTS.md](../AGENTS.md)。
