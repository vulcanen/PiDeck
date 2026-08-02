# Pi CLI → PiDeck 当前功能矩阵

> 本文只记录当前仓库已经接入的能力。未实现能力会明确标记，不把产品计划写成现状。
> 权威来源是当前安装的 `@earendil-works/pi-coding-agent`、`packages/contracts` 和 PiHost 实现。

## 已接入

| Pi 能力 | PiDeck 入口 | 当前实现 |
| --- | --- | --- |
| 项目发现与切换 | 左侧项目树；560px 以下通过顶部按钮打开会话抽屉 | `SessionManager.listAll()` + Main 有序 `cwd` 清单 → `projects.list` |
| 会话列表 | 展开当前项目后按最近更新时间倒序显示会话 | `SessionManager.list(cwd)` / `updatedAt` |
| 新建会话 | New task / 空状态按钮 | `SessionManager.create(cwd)` |
| 会话消息 | 中央对话线程 | `AgentSession.messages`；按 Pi `parseSkillBlock()` 语义将 Skill 引用与用户原文分层展示 |
| 会话命名 | 会话列表与对话标题 | 从首条用户意图移除 Skill/命令/资源前缀后生成短标题，并通过 `AgentSession.setSessionName()` 持久化 |
| 会话删除 | 会话更多菜单 | `sessions.delete` |
| Provider 列表 | Provider 设置（搜索、认证状态筛选） | `ModelRuntime.getProviders()`、`listCredentials()` |
| API Key / OAuth | Provider 设置（本机凭据、移除确认） | `ModelRuntime.login()`、`ModelRuntime.logout()`、Pi auth 回调 |
| 模型列表 | Composer 模型选择器 | `ModelRuntime.getModels()` |
| 思考等级 | Composer Thinking 菜单 | `AgentSession.getAvailableThinkingLevels()` |
| Pi slash command catalog | 行首已知 `/` 前缀建议、命令面板 | Pi 内置 catalog、Prompt、Skill、Extension command；路径和普通文本不触发命令建议 |
| `@file` 提示 | Composer `@` | `workspace.snapshot` 返回的当前工作区文件快照 |
| Agent 流式事件 | 中央线程 | `agent_start`、`message_update`、`tool_execution_*` 等 |
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

## 权限与审批边界

当前 PiHost 优先通过 Pi Extension 机制加载 `@gotgenes/pi-permission-system`：

- `allow`：自动允许工具执行。
- `ask`：由 Pi 权限系统产生审批请求，再由 PiDeck 审批卡响应。
- `deny`：阻止工具执行。
- `yoloMode`：自动批准 `ask`，用于全自动执行。

PiDeck 在输入框下方提供当前权限级别切换，并写入插件的 Pi 配置文件。切换不会中断正在运行的 Agent；空闲 Session 会在下一次提示前按新策略惰性重建。Extension 不可加载时才回退到 PiHost `beforeToolCall` 适配。

当前审批事件只提供工具名和参数，没有独立的风险等级字段；审批卡因此明确标记为“工具调用”，不会根据工具名伪造风险等级。

## 尚未接入

以下能力目前只有 PiHost/SDK 类型或产品计划，不能在当前 UI 中宣称已完成：

- Session tree 可视化、树导航、克隆、分支选择器。
- Steering / Follow-up 队列模式切换。
- Extension UI request 的完整桌面映射。
- Pi Package install/remove/update/config 管理器。
- Print、JSON、RPC、stdin、Auth Print 等 CLI 兼容通道。
- 完整 Monaco Diff、任务基线 diff、逐块审阅。

新增能力必须先更新 `packages/contracts`，再更新 PiHost、Preload、Renderer 和本文矩阵。
