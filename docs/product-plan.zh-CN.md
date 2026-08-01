# PiDeck 产品与技术方案

> 文档状态：与当前代码基线对齐；未实现项单独标记为计划。
>
> 更新日期：2026-08-01
>
> 目标平台：Windows、macOS、Linux 桌面端；Windows 优先验收。

## 1. 产品定位与边界

PiDeck 是 `@earendil-works/pi-coding-agent` 的桌面 UI 适配层。它不重新实现 Agent、模型、会话存储、凭据或工具系统，而是把 Pi SDK/CLI 的本地能力映射到桌面工作区。

明确不做：

- PiDeck 账户、云端登录、云端工作区、团队协作和会话同步。
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
  → 系统 Node.js
  → @earendil-works/pi-coding-agent
```

当前代码不是 Electron `utilityProcess`，也不是 MessagePort。PiHost 使用普通 Node `process.send/process.on("message")`，以满足 Pi SDK 的 Node engines。

### 2.1 当前目录

```text
apps/desktop/src/
├─ main/index.ts
├─ preload/index.ts
├─ renderer/
│  ├─ App.tsx
│  ├─ styles.css
│  ├─ i18n.ts
│  ├─ ui.tsx
│  ├─ pi-capabilities.ts
│  └─ main.tsx
└─ utility/pi-host/index.ts

packages/
├─ contracts/src/index.ts
└─ domain/src/index.ts
```

完整边界见 [当前架构说明](architecture.zh-CN.md)。

## 3. 当前用户闭环

当前已支持：

1. 启动 PiHost 并显示 Runtime 状态。
2. 自动发现当前项目和 Pi Session。
3. 创建、切换、删除本地 Session。
4. 读取和显示 Session 消息。
5. 选择已认证 Provider/Model 和思考等级。
6. 发送 Prompt、查看流式回复和停止运行。
7. 查看工具调用、工具结果和审批卡。
8. 查看工作区文件、Git Changes 和本地终端。
9. 压缩上下文并导出 JSONL/HTML。
10. 使用 Pi slash command catalog、Prompt、Skill 和 Extension command 建议。
11. 使用 Provider API Key/OAuth 本地认证。
12. 切换中文/英文和浅色/深色主题。

## 4. 消息与对话行为

- Pi 原始 Session message 是事实来源。
- Renderer 不把 Pi SDK 实例传入组件，只接受可序列化消息对象。
- Markdown、代码块、表格和链接由 Renderer 展示层渲染，不改变 Pi 原始消息。
- 会话标题已经避免直接使用完整 Skill 文本；Skill 展开后的 `<skill>` 内容仍需补充独立的折叠引用卡片，当前不应宣称已经完成。
- 工具调用和思考过程应作为可折叠 Activity 展示，并显示工具数量、思考块数量和耗时。
- 切换 Session 时立即定位到该会话的最新位置或保存的位置，不播放跨会话滚动动画。
- 用户手动离开底部时显示“回到最新消息”，不强制抢夺滚动位置。

## 5. 当前 Bridge 契约

当前唯一权威定义是 `packages/contracts/src/index.ts`。主要能力：

```text
runtime.status
projects.list
sessions.list/create/delete/messages/capabilities/tree/navigate/fork/compact/export
models.list
workspace.snapshot
terminal.execute
providers.list/login/logout/setApiKey/auth-response/open-auth-url
agent.prompt/abort/setThinkingLevel/setModel
approvals.resolve
events.subscribe
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

设置变更写入插件的全局 Pi 配置，并重建 AgentSession。Extension 不可加载时，PiHost 才回退到内置 `beforeToolCall` 审批适配。

接入约束：

1. 在 PiHost 中通过 Pi Extension 机制加载真实包。
2. 让插件配置继续使用其 Pi 配置目录和 schema。
3. 将 `allow/ask/deny` 和 `yoloMode` 映射为只读状态/设置 UI。
4. 将插件的审批事件和决定事件归一化到 contracts。
5. 移除重复的 PiDeck 自定义审批门，避免一次工具调用出现两套审批。
6. 通过真实工具调用验证 allow、ask、deny、session approval 和失败关闭行为。

## 8. 当前未实现能力

以下仍是计划，不是当前产品承诺：

- Session tree 可视化导航、克隆和分支选择器。
- Steering/Follow-up 队列模式。
- Extension UI request 的完整映射。
- Pi Package install/remove/update/config 管理器。
- Print、JSON、RPC、stdin、Auth Print 兼容通道。
- Monaco Diff、任务级基线和逐块审阅。
- 10,000 条消息虚拟列表。

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
npm run build
```

PiHost 相关修改还要验证：

```text
runtime.status
projects.list
models.list
providers.list
sessions.create
sessions.capabilities
workspace.snapshot
terminal.execute（无副作用命令）
```

## 11. 后续设计原则

- 先保证 Pi 语义和状态正确，再做视觉装饰。
- 不把规划中的目录、包、IPC 或能力写成当前已实现。
- 所有新能力必须能追溯到 Pi SDK/CLI 的真实 API、事件或资源。
- 项目结构、contracts、运行时边界、依赖和用户可见能力发生变化时，必须同步更新相关文档。
