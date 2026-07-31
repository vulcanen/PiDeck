# Pi CLI → PiDeck 功能矩阵

PiDeck 的原则是：界面层只负责交互与呈现，Pi Runtime 负责会话、模型、认证、工具和资源的真实行为。

## 当前已接入

| Pi 能力 | PiDeck 入口 | 数据来源 |
| --- | --- | --- |
| 会话列表 | 左侧 Sessions | `SessionManager.list(cwd)` |
| 新建会话 | 左侧 New task / 空状态按钮 | `SessionManager.create(cwd)` |
| 会话消息 | 中央线程 | `AgentSession.messages` / `SessionManager.getEntries()` |
| Provider 列表与凭据状态 | 右上角 Provider 设置 | `ModelRuntime.getProviders()`、`listCredentials()` |
| API Key / OAuth 登录 | Provider 设置 | `ModelRuntime.login()` |
| 模型列表 | 输入框下方模型选择器 | `ModelRuntime.getModels()` |
| 思考等级 | 输入框下方 Thinking 菜单 | `AgentSession.getAvailableThinkingLevels()` |
| Slash 命令、Prompt、Skill 提示 | 输入 `/` | Pi 内置 Slash Commands、ResourceLoader |
| 文件提及提示 | 输入 `@` | 当前工作区真实文件树 |
| 工具审批 | 中央线程审批卡 | `AgentSession.agent.beforeToolCall` |
| 本地终端 | 输入框工具栏 / `Ctrl/Cmd + J` | 内嵌终端调用 `AgentSession.executeBash()` |
| 变更列表 | 右侧 Changes | 当前工作区 Git 状态与 numstat |
| 文件列表 | 右侧 Files | 当前工作区文件系统快照 |
| Session tree / navigate / fork | PiHost 会话操作 API（命令面板入口逐步补齐） | `SessionManager.getTree()`、`AgentSession.navigateTree()`、`createBranchedSession()` |
| 上下文压缩 | 命令面板 → 压缩上下文 | `AgentSession.compact()` |
| 会话导出 | 命令面板 → 导出 JSONL / HTML | `AgentSession.exportToJsonl()` / `exportToHtml()` |
| Extension Slash Command | 输入 `/` | `ExtensionRunner.getRegisteredCommands()` |
| 中英切换 | 顶部语言按钮 | PiDeck UI 层 |
| 明暗主题 | 顶部主题按钮 | PiDeck UI 层 |

## 接下来逐项补齐

- 上下文统计、自动压缩状态与 `/compact` 参数编辑
- Session tree 的可视化导航与分支选择器
- Extension 注册的快捷键
- 图片附件与多模态输入
- 终端流式输出、取消执行和进程树管理

这些功能都可以继续复用当前 PiHost IPC 边界，不需要把 Pi 逻辑复制到 React 组件中。

## 已知边界

- 当前工作区如果不是 Git 仓库，Changes 面板会如实显示为空，不会伪造 diff。
- OAuth 认证需要浏览器跳转的 Provider，当前采用 Pi 的交互回调并在设置面板中展示认证地址；不会代替用户完成外部登录。
- 终端命令是用户主动输入后执行，Pi 自动触发的工具调用仍然走审批桥。
