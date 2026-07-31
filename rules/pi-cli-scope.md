# Pi CLI 能力边界

## 原则

PiDeck 只做 Pi CLI 的桌面化适配层。功能名称、参数、状态和错误语义应以当前安装的 Pi CLI/SDK 为准。

优先复用：

- `ModelRuntime`
- `AgentSession`
- `SessionManager`
- `ResourceLoader`
- Pi 内置 slash commands
- Pi Agent event stream
- Pi 的 Provider/auth storage
- Pi 的 built-in tools 和 session export

禁止在适配层复制一套“看起来类似”的 Agent、模型目录、认证存储或 session 数据库。

## UI 映射规则

- Pi slash command -> composer suggestion / command palette。
- Pi `@file` / resource -> workspace resource suggestion。
- Pi model/provider/auth -> PiDeck model/provider UI。
- Pi agent event -> conversation stream / tool result / approval state。
- Pi session file/tree/export -> session list / session operations。
- Pi CLI 无对应能力的 UI，不要伪造为已支持；应隐藏或标记为未实现。

## 可维护性

- 中文、英文及未来语言的可见文案集中在 i18n 配置中。
- 组件不得继续新增散落的双语字符串；新增文案先增加稳定 key，再在各语言配置中补齐。
- Pi 命令、模型和资源目录优先从运行时读取；必要的 fallback 必须单独放在 capability 配置模块。

## 兼容性

当 Pi SDK 升级时，先阅读其类型声明和 changelog，再修改 adapter。不要依赖未公开的内部属性，除非同时提供版本兼容保护和清晰错误。
