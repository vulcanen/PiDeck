# Pi CLI → PiDeck 当前功能矩阵

> 本文只记录当前仓库已经接入的能力。未实现能力会明确标记，不把产品计划写成现状。
> 权威来源是当前安装的 `@earendil-works/pi-coding-agent`、`packages/contracts` 和 PiHost 实现。

## 已接入

| Pi 能力 | PiDeck 入口 | 当前实现 |
| --- | --- | --- |
| 项目发现、浏览与移除 | 左侧项目树；多个项目可同时展开，单击项目只切换自身展开状态，右键项目可从列表移除；560px 以下通过顶部按钮打开会话抽屉 | `SessionManager.listAll()` + Main 有序/隐藏 `cwd` 清单 → `projects.list` / `projects.remove`；移除不删除项目文件或 Pi Session |
| 会话列表与切换 | 展开任意项目后按最近更新时间倒序显示会话；只有单击具体会话才切换中央工作区 | `SessionManager.list(cwd)` / `updatedAt` |
| 新建会话 | New task；展开无会话项目时的“新建任务”按钮；空状态按钮 | `SessionManager.create(cwd)` |
| 会话消息 | 中央对话线程 | `AgentSession.messages`；按 Pi `parseSkillBlock()` 语义将 Skill 引用与用户原文分层展示 |
| 执行耗时恢复 | “已处理”执行摘要 | PiHost 在 `agent_start`、Follow-up 分组边界和 `agent_settled` 记录 execution group，通过 `SessionManager.appendCustomEntry("pideck.execution-run", ...)` 将精确起止时间写入 Pi Session；Steering 仍合并为同一组，`sessions.runMetadata` 在重启后恢复，旧会话不伪造耗时 |
| 会话命名 | 会话列表与对话标题 | 从首条用户意图移除 Skill/命令/资源前缀后生成短标题，并通过 `AgentSession.setSessionName()` 持久化 |
| 会话删除 | 会话更多菜单 | `sessions.delete` |
| 会话位置与长会话 | 中央虚拟化对话线程 | `@tanstack/react-virtual`；每个 Session 缓存 pane、DOM `scrollTop`、follow 状态和测量快照；首次打开定位最新消息，切换恢复保存位置 |
| Provider 列表 | Provider 设置（搜索、认证状态筛选） | `ModelRuntime.getProviders()`、`listCredentials()` |
| API Key / OAuth | Provider 设置（本机凭据、移除确认） | `ModelRuntime.login()`、`ModelRuntime.logout()`、Pi auth 回调 |
| 模型列表 | Composer 模型选择器 | `ModelRuntime.getModels()` |
| 思考等级 | Composer Thinking 菜单 | `AgentSession.getAvailableThinkingLevels()` |
| Pi slash command catalog | 行首已知 `/` 前缀建议、命令面板 | Pi 内置 catalog、Prompt、Skill、Extension command；路径和普通文本不触发命令建议 |
| `@file` 提示 | Composer `@` | `workspace.snapshot` 返回的当前工作区文件快照 |
| Agent 流式事件 | 中央线程 | `agent_start`、`agent_end.messages`、`agent_settled`、`message_update`、`tool_execution_*` 等 |
| Steering / Follow-up 队列 | Composer 队列面板与投递菜单 | `agent.queue`、`setQueueModes`、`clearQueue`、`promoteQueue`；队列新增、插入和处理在 follow 状态下自动跟随 |
| 工具审批 | 中央审批卡 | 当前 PiHost `beforeToolCall` 适配 |
| 工具过程 | 可折叠过程块 | Tool Result、工具名称、成功/失败状态 |
| 本地终端 | Composer Terminal / `Ctrl/Cmd + J` | `AgentSession.executeBash()` |
| 上下文压缩 | Command Palette | `AgentSession.compact()` |
| Session 导出 | Command Palette | `AgentSession.exportToJsonl()` / `exportToHtml()` |
| Runtime 状态 | Sidebar | Main/PiHost runtime status event |
| 中英文 | 顶部语言按钮 | Renderer i18n |
| 浅色/深色 | 顶部主题按钮 | Renderer theme preference |

## Slash 命令状态

当前 Composer 会读取 Pi 的真实 slash command catalog，并为命令提供建议。命令的最终执行仍必须遵循 Pi CLI 语义：

- 已有明确 Bridge 的命令应调用对应 PiHost 能力，例如 `/compact`、`/export`、`/model`、`/login`、`/logout`。
- 只有展示 catalog、但没有对应 Bridge 的命令不能伪装成已执行。
- `/skill:name` 由 Pi `AgentSession.prompt()` 负责展开；PiDeck 按 Pi TUI 的 `parseSkillBlock()` 规则仅显示紧凑 Skill 引用和用户实际输入，不把注入的 Skill 正文重复显示为用户消息。
- Extension command 的权威来源是当前 Pi `ResourceLoader`，不是静态 fallback。

当前已接入的桌面命令包括 `/import`、`/share`、`/copy`、`/name`、`/session`、`/changelog`、`/hotkeys`、`/trust`、`/resume`、`/quit` 和 `/scoped-models`。这些命令分别通过 PiHost、Electron 系统能力或已有会话列表完成桌面映射；`/share` 仍要求本机安装并登录 `gh` CLI。

`/fork`、`/clone` 与 `/tree` 暂不在 Composer 建议和命令面板中显示，并列入待支持列表。它们需要把 Pi 的 Session Tree 分支导航、会话替换和消息时间线恢复完整映射到 PiDeck，当前手动输入会提示待支持，不会伪装成已执行。

## 权限与审批边界

当前 PiHost 优先通过 Pi Extension 机制加载 `@gotgenes/pi-permission-system`：

- `allow`：自动允许工具执行。
- `ask`：由 Pi 权限系统产生审批请求，再由 PiDeck 审批卡响应。
- `deny`：阻止工具执行。
- `yoloMode`：自动批准 `ask`，用于全自动执行。

PiDeck 在输入框下方提供当前权限级别切换，并写入插件的 Pi 配置文件。切换不会中断正在运行的 Agent；空闲 Session 会在下一次提示前按新策略惰性重建。Extension 不可加载时才回退到 PiHost `beforeToolCall` 适配。

当前审批事件只提供工具名和参数，没有独立的风险等级字段；审批卡因此明确标记为“工具调用”，不会根据工具名伪造风险等级。

## 已接入的扩展能力

以下能力已经完成基础桌面映射：

- Extension UI request 的 select、confirm、input、editor、notify 请求；请求会在桌面窗口中显示并回传结果。
- Pi Package install/remove/update/config 管理器；入口位于命令面板中的 Pi packages。
当前仍有边界：Extension 的 TUI 专属 `custom` 组件、主题/Widget/Footer/Header 等函数无法跨 PiHost 与 Renderer 直接传递组件实例，暂不伪装成完整等价实现。PiDeck 不嵌入 Pi CLI 的独立 CLI 面板，命令执行统一通过 Pi Agent 与本地终端入口完成。

Diff 预览、任务基线 diff 和逐块审阅仍未接入。Pi 提供编辑工具的底层 diff 计算，但 Monaco 编辑器和审阅工作流属于 PiDeck 的桌面产品能力。

新增能力必须先更新 `packages/contracts`，再更新 PiHost、Preload、Renderer 和本文矩阵。
