# Pi CLI → PiDeck 当前功能矩阵

> 本文只记录当前仓库已经接入的能力。未实现能力会明确标记，不把产品计划写成现状。
> 权威来源是当前安装的 `@earendil-works/pi-coding-agent`、`packages/contracts` 和 PiHost 实现。

## 已接入

| Pi 能力 | PiDeck 入口 | 当前实现 |
| --- | --- | --- |
| 项目发现 | 启动时自动加载工作区 | `projects.list` |
| 会话列表 | 左侧 Sessions | `SessionManager.list(cwd)` |
| 新建会话 | New task / 空状态按钮 | `SessionManager.create(cwd)` |
| 会话消息 | 中央对话线程 | `AgentSession.messages` |
| 会话删除 | 会话更多菜单 | `sessions.delete` |
| Provider 列表 | Provider 设置 | `ModelRuntime.getProviders()`、`listCredentials()` |
| API Key / OAuth | Provider 设置 | `ModelRuntime.login()`、Pi auth 回调 |
| 模型列表 | Composer 模型选择器 | `ModelRuntime.getModels()` |
| 思考等级 | Composer Thinking 菜单 | `AgentSession.getAvailableThinkingLevels()` |
| Pi slash command catalog | `/` 建议、命令面板 | Pi 内置 catalog、Prompt、Skill、Extension command |
| `@file` 提示 | Composer `@` | 当前工作区文件快照 |
| Agent 流式事件 | 中央线程 | `agent_start`、`message_update`、`tool_execution_*` 等 |
| 工具审批 | 中央审批卡 | 当前 PiHost `beforeToolCall` 适配 |
| 工具过程 | 可折叠过程块 | Tool Result、工具名称、成功/失败状态 |
| 本地终端 | Composer Terminal / `Ctrl/Cmd + J` | `AgentSession.executeBash()` |
| 工作区变更 | Inspector → Changes | Git status 与 numstat |
| 工作区文件 | Inspector → Files | 文件系统快照 |
| 上下文压缩 | Command Palette | `AgentSession.compact()` |
| Session 导出 | Command Palette | `AgentSession.exportToJsonl()` / `exportToHtml()` |
| Runtime 状态 | Sidebar | Main/PiHost runtime status event |
| 中英文 | 顶部语言按钮 | Renderer i18n |
| 浅色/深色 | 顶部主题按钮 | Renderer theme preference |

## Slash 命令状态

当前 Composer 会读取 Pi 的真实 slash command catalog，并为命令提供建议。命令的最终执行仍必须遵循 Pi CLI 语义：

- 已有明确 Bridge 的命令应调用对应 PiHost 能力，例如 `/compact`、`/export`、`/model`、`/login`、`/logout`。
- 只有展示 catalog、但没有对应 Bridge 的命令不能伪装成已执行。
- `/skill:name` 由 Pi `AgentSession.prompt()` 负责展开；PiDeck 当前只避免用完整内容命名会话，展开后的 `<skill>` block 折叠引用卡片仍未完成。
- Extension command 的权威来源是当前 Pi `ResourceLoader`，不是静态 fallback。

## 权限与审批边界

当前代码的审批适配位于 `apps/desktop/src/utility/pi-host/index.ts`：

- `read`、`grep`、`find`、`ls` 默认直接允许。
- 其他工具进入 PiDeck 审批卡。
- 拒绝会通过 Pi Agent 的 `beforeToolCall` 返回阻止结果。

`@gotgenes/pi-permission-system` 确实是 npm 上存在的 Pi Extension，当前版本提供 `allow`、`ask`、`deny` 和 `yoloMode`。但当前 PiDeck 代码没有加载该包，也没有桥接它的 `permissions:ui_prompt` / `permissions:decision` 事件。因此在完成真实 Extension 加载和配置读写前，不能把它写成当前审批来源，也不能把 PiDeck 自定义审批规则与该插件混为一谈。

## 尚未接入

以下能力目前只有 PiHost/SDK 类型或产品计划，不能在当前 UI 中宣称已完成：

- Session tree 可视化、树导航、克隆、分支选择器。
- 图片附件和多模态输入。
- Steering / Follow-up 队列模式切换。
- Extension UI request 的完整桌面映射。
- Pi Package install/remove/update/config 管理器。
- Print、JSON、RPC、stdin、Auth Print 等 CLI 兼容通道。
- 完整 Monaco Diff、任务基线 diff、逐块审阅。
- `@gotgenes/pi-permission-system` 的真实配置加载、`allow/ask/deny` 切换和审批事件桥接。

新增能力必须先更新 `packages/contracts`，再更新 PiHost、Preload、Renderer 和本文矩阵。
