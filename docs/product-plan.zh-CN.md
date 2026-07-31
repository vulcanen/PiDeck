# PiDeck 产品与技术方案（全功能覆盖版）

> 状态：方案冻结，待实现
>
> 更新日期：2026-07-31
>
> 目标平台：Windows、macOS、Linux 桌面端
>
> 首要验收平台：Windows

## 1. 项目定位

PiDeck 是 Pi Agent Harness 的桌面界面端。

PiDeck 不重新实现 Agent、模型接入、会话存储或工具系统，而是在 Pi 已有能力之上提供一个适合长期使用的图形化工作台。目标不是只覆盖“聊天 + Diff”的核心闭环，而是让 Pi CLI 的每一项能力都有明确的桌面入口：

- 用 Codex 式布局组织项目、任务、对话、终端与代码变更。
- 用编辑部风格强化标题、摘要、日期和内容层级。
- 用 Claude 式暖中性色降低高密度开发界面的视觉压力。
- 使用 MiSans、PT Serif、Noto Serif SC 和 JetBrains Mono 建立中英文排版体系。
- 补充 Pi 默认没有提供的图形化操作审批与风险提示。
- 对 CLI 的交互命令、启动参数、资源系统和包管理提供原生界面；无法安全图形化的进程模式保留兼容入口，保证不丢失能力。

边界说明：

- PiDeck 不创建 PiDeck 账户，不做 PiDeck 登录、云端工作区、会话同步或团队协作。
- Pi 支持的 Provider 登录、OAuth、API Key、模型目录刷新仍然属于必须保留的本地能力。
- Provider 凭据由 Pi Runtime 在本机管理；PiDeck 只提供设置界面，不把凭据上传到 PiDeck 服务。

### 1.1 设计判断

将产品理解为：

> 面向开发者的桌面级 AI 工作台，信息密度高，结构克制，排版带有编辑部气质，交互以效率和可观察性为第一优先级。

设计参数：

| 参数 | 数值 | 含义 |
| --- | ---: | --- |
| Design Variance | 5/10 | 有适度编辑感，但不牺牲工作区稳定性 |
| Motion Intensity | 3/10 | 只使用状态反馈动画 |
| Visual Density | 8/10 | 保持开发工具所需的信息密度 |

### 1.2 全功能成功标准

用户可以在 PiDeck 中完成以下闭环，并且不需要退回命令行：

1. 打开本地项目。
2. 创建或恢复 Pi 会话。
3. 选择模型与思考等级。
4. 发送提示并查看流式输出。
5. 查看 Agent 的读取、搜索、编辑和命令执行过程。
6. 对需要风险确认的操作进行审批。
7. 查看本次任务产生的文件变更。
8. 在任务终端中执行和观察命令。
9. 在多个任务之间切换，后台任务不被终止。
10. 切换中文、英文以及浅色、深色主题。
11. 使用命令面板执行 Pi 的全部内置斜杠命令。
12. 配置 Provider、API Key、OAuth、模型范围、思考等级、工具白名单与黑名单。
13. 管理 Extension、Skill、Prompt Template、Theme、Context File 和 Pi Package。
14. 使用 Print、JSON、RPC、Export、Auth Print 等 CLI 兼容模式。
15. 通过 `@file`、图片、标准输入和多条初始消息构造与 CLI 等价的 Prompt。
16. 在第三方 Extension 注册命令、工具、快捷键、CLI Flag 和 UI 对话框时，仍能在 PiDeck 中运行；扩展自定义 UI 通过扩展桥接层映射到桌面组件。

## 2. 已确认的 Pi 能力

PiDeck 使用 `@earendil-works/pi-coding-agent` 的 Node.js SDK 作为唯一 Agent 后端。

当前 Pi 已经提供：

- 流式 Agent 会话和事件订阅。
- 多模型、多 Provider、API Key 和 OAuth。
- 思考等级切换。
- 持久化会话、会话列表、命名、恢复、克隆与分叉。
- 会话树、稳定 Entry ID、标签和上下文压缩。
- Steering 与 Follow-up 队列。
- Read、Bash、Edit、Write、Grep、Find、Ls 内置工具。
- Extension、Skill、Prompt Template 和自定义工具。
- 工具调用前拦截与阻止。
- 用户主动 Bash 执行和流式输出。
- Token、费用和上下文占用统计。

相关代码入口：

- [SDK 创建接口](../../pi/packages/coding-agent/src/core/sdk.ts)
- [AgentSession](../../pi/packages/coding-agent/src/core/agent-session.ts)
- [会话运行时](../../pi/packages/coding-agent/src/core/agent-session-runtime.ts)
- [SessionManager](../../pi/packages/coding-agent/src/core/session-manager.ts)
- [ModelRuntime](../../pi/packages/coding-agent/src/core/model-runtime.ts)
- [Extension 类型](../../pi/packages/coding-agent/src/core/extensions/types.ts)
- [权限门示例](../../pi/packages/coding-agent/examples/extensions/permission-gate.ts)

### 2.1 接入结论

- Electron 主进程不直接运行 Pi SDK；Pi SDK 放入独立的 Electron Utility Process。主进程只负责窗口、生命周期和 IPC 编排，避免长时间模型请求、扩展代码或 Bash 阻塞桌面 UI。
- Renderer 通过 Preload 访问稳定的 PiDeck Bridge，Bridge 再通过 `MessagePort` 与 Pi Utility Process 通信。
- 不使用 `pi-server`，因为它仍属于实验性接口。
- 不把 Pi CLI 作为默认子进程启动，也不以 JSONL RPC 作为应用内部主协议；Print、JSON、RPC、Export、Auth Print 等模式通过“CLI 兼容通道”按原语义执行。
- 不引入 PiDeck 账户和云同步服务；Provider Auth 仍由 Pi SDK/CLI 在本机完成。
- PiDeck 保持独立仓库，不修改 `pi` 仓库。
- 依赖固定到与当前仓库一致的明确版本，首次实现基线为 `0.83.0`。
- Pi 升级通过依赖版本升级和适配层测试完成。

## 3. 产品信息架构

```text
PiDeck
├─ Projects
│  ├─ Project A
│  │  ├─ Active tasks
│  │  └─ History
│  └─ Project B
├─ Task Workspace
│  ├─ Conversation
│  ├─ Changes
│  ├─ Files
│  └─ Terminal
└─ Settings
   ├─ Models and providers
   ├─ Permissions
   ├─ Appearance
   ├─ Language
   └─ About and licenses
```

### 3.1 核心对象

**项目 Project**

- 由绝对 `cwd` 标识。
- 包含最近打开时间、显示名称和关联 Pi 会话。
- 不复制项目代码或建立项目索引数据库。

**任务 Task**

- 对应一个 Pi Session。
- 具有名称、状态、模型、思考等级、上下文占用和最后更新时间。
- 运行状态可以是：
  - `idle`
  - `running`
  - `waiting-approval`
  - `compacting`
  - `retrying`
  - `completed`
  - `failed`

**审阅 Review**

- 聚合任务期间产生的 Edit patch、Write 记录和当前 Git 工作区变化。
- 支持文件级导航、统一 diff、并排 diff 和打开外部编辑器。

**审批 Approval**

- 对一个具体工具调用作出允许或拒绝决定。
- 允许范围为单次、当前任务或当前项目。

## 4. 桌面布局

整体结构参考 Codex 的桌面工作区，但使用 PiDeck 自有品牌和视觉语言。

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Window controls   Project / Task                  Search / Commands │
├──────────────┬──────────────────────────────┬───────────────────────┤
│              │                              │                       │
│ Project and  │ Conversation                 │ Changes / Files       │
│ task sidebar │                              │ inspector             │
│              │                              │                       │
│              │                              │                       │
│              ├──────────────────────────────┤                       │
│              │ Composer                     │                       │
├──────────────┴──────────────────────────────┴───────────────────────┤
│ Terminal                                                            │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.1 顶部栏

- 高度 48px。
- 使用无边框自定义窗口栏。
- 左侧显示当前项目和任务名称。
- 中部不放置常驻导航。
- 右侧提供全局搜索、命令面板、面板开关和窗口控制。
- 拖拽区与交互元素严格分离。

### 4.2 左侧栏

- 默认宽度 280px，可调范围 240-360px。
- 折叠后宽度 56px。
- 顶部为新建任务主操作。
- 会话按项目分组，项目内分为运行中和历史任务。
- 每个任务只显示标题、时间和真实状态。
- 运行、等待审批和失败使用语义状态图标，不使用装饰性彩点。
- 支持搜索、重命名、克隆、分叉和归档。

### 4.3 对话区

- 正文最大阅读宽度约 860px。
- 对话时间线不把每条消息包成独立大卡片。
- 用户消息使用轻量表面色区分。
- Assistant 正文直接排版在内容流中。
- Tool Call 使用可折叠的紧凑过程块。
- 思考内容默认折叠，只显示简短状态和耗时。
- 错误、重试、压缩和队列拥有独立的语义状态。
- 长会话采用虚拟列表，保留滚动锚点。

### 4.4 输入区

- 固定在对话区底部，不覆盖最后一条消息。
- 支持多行输入、图片拖入和工作区文件引用。
- 提供模型、思考等级和发送模式选择。
- Agent 运行时发送按钮切换为停止按钮。
- 运行期间的新输入明确选择 Steering 或 Follow-up。
- 支持斜杠命令、Skill 和 Prompt Template 自动补全。

### 4.5 右侧审阅区

- 默认宽度 420px，可调范围 340px 到窗口宽度的 50%。
- 具有 Changes 和 Files 两个一级视图。
- Changes 顶部显示文件数量和增删统计。
- 中部显示文件列表。
- 主体使用懒加载 Monaco Diff Editor。
- 支持统一 diff 和并排 diff。
- 可跳转到首个变更行或外部编辑器。

### 4.6 底部终端

- 默认收起，展开高度为窗口的 30%。
- 使用 xterm.js。
- 显示 Pi Bash Tool 的实时输出。
- 用户可手动执行命令，结果按 Pi 的 `BashExecutionMessage` 进入会话上下文。
- 每个任务保存独立终端缓冲区。
- 危险命令在执行前进入审批流程。

### 4.7 小窗口策略

- 最小窗口尺寸为 960×640。
- 宽度低于 1180px 时，右侧审阅区变为覆盖式抽屉。
- 宽度低于 1024px 时，左侧栏默认折叠。
- 不把桌面工作区重排成移动端卡片流。

## 5. 视觉系统

### 5.1 字体

| 用途 | 字体 |
| --- | --- |
| 正文、按钮、菜单、设置 | MiSans Variable |
| 英文标题 | PT Serif |
| 中文标题 | Noto Serif SC |
| 代码、路径、终端、数值 | JetBrains Mono |

字体规则：

- 正文默认 14px，行高 1.55。
- 侧栏与工具元信息默认 12-13px。
- 会话标题 22-28px，使用编辑部衬线字体。
- 控件禁止使用衬线字体。
- 代码默认 12.5-13px。
- 中英文混排时使用语言选择器切换标题字体。
- 字体全部本地打包并使用 `font-display: swap`。

MiSans 许可要求：

- 在“关于 PiDeck”中注明使用 MiSans。
- 提供指向小米官方字体许可页面的链接。
- 不修改或二次开发字体轮廓。
- 不把字体文件作为独立资源提供下载。

参考：

- [MIMOcode 文档站](https://mimo.xiaomi.com/mimocode/start)
- [MiSans 官方页面](https://hyperos.mi.com/font/zh)
- [MiSans 官方 FAQ](https://hyperos.mi.com/font/en/faq/)

### 5.2 色彩

浅色主题：

| Token | 色值 | 用途 |
| --- | --- | --- |
| `canvas` | `#F9F9F7` | 主背景 |
| `sidebar` | `#F0EFEB` | 左侧栏 |
| `surface` | `#FEFDFB` | 输入区、菜单、浮层 |
| `surface-muted` | `#F4F2EE` | 用户消息、选中行 |
| `text-primary` | `#1F1E1B` | 主文本 |
| `text-secondary` | `#706E68` | 次要文本 |
| `border` | `#DEDCD6` | 分隔线 |
| `accent` | `#B45A3C` | 链接、焦点、关键状态 |
| `selection` | `#EAD7CD` | 文本与列表选中 |
| `danger` | `#A33B34` | 危险操作 |

深色主题：

| Token | 色值 | 用途 |
| --- | --- | --- |
| `canvas` | `#1D1C1A` | 主背景 |
| `sidebar` | `#171614` | 左侧栏 |
| `surface` | `#25231F` | 输入区、菜单、浮层 |
| `surface-muted` | `#2D2A26` | 用户消息、选中行 |
| `text-primary` | `#F2EFE9` | 主文本 |
| `text-secondary` | `#AAA59C` | 次要文本 |
| `border` | `#393631` | 分隔线 |
| `accent` | `#DF8A68` | 链接、焦点、关键状态 |
| `selection` | `#53372D` | 文本与列表选中 |
| `danger` | `#ED8178` | 危险操作 |

所有颜色在实现阶段通过自动化对比度测试，正文和交互控件达到 WCAG AA。

### 5.3 形状与材质

- 主面板圆角 10px。
- 输入、菜单和普通按钮圆角 8px。
- 状态标签可以使用全圆角。
- 主要层级依赖背景、留白和细分隔线，不依赖阴影。
- 浮层只使用一层带暖色调的柔和阴影。
- 不使用 AI 紫色、霓虹外发光、渐变文字或全局玻璃效果。

### 5.4 动效

- 面板展开：180ms。
- 菜单与提示：150ms。
- 消息增量不逐 Token 做位移动画。
- 工具状态变化只使用透明度和轻微位移。
- 审批出现时不抖动、不闪烁。
- 所有非必要动画尊重 `prefers-reduced-motion`。

## 6. 技术架构

### 6.1 技术选型

| 层级 | 选型 |
| --- | --- |
| 桌面容器 | Electron |
| 构建 | Vite |
| UI | React + TypeScript |
| 状态 | Zustand |
| 无障碍组件 | Radix Primitives |
| 图标 | Phosphor Icons |
| 国际化 | i18next + react-i18next |
| Markdown | react-markdown + remark-gfm |
| 代码高亮 | Shiki，Worker 内按需加载 |
| Diff | Monaco Diff Editor，按需加载 |
| 终端 | xterm.js |
| Schema | Zod |
| 单元测试 | Vitest |
| 端到端测试 | Playwright Electron |
| 打包 | electron-builder |

所有直接依赖固定到明确版本，不使用宽泛版本范围。

### 6.2 进程边界

```text
┌────────────────────────────────────────────────────────────┐
│ Electron Main                                               │
│ WindowLifecycle · IpcRouter · AppServices · CliCompat        │
│ 只做桌面生命周期、权限边界和消息路由，不运行 Agent Turn       │
└───────────────────────┬────────────────────────────────────┘
                        │ MessagePort + typed IPC
┌───────────────────────▼────────────────────────────────────┐
│ Electron Utility Process: PiHost                           │
│ PiAdapter · SessionRegistry · PermissionEngine              │
│ Model/Auth · Resource/Package · Bash/Workspace              │
│ @earendil-works/pi-coding-agent                             │
│ 一个任务一个运行上下文；崩溃可隔离、可重启、可恢复            │
└───────────────────────┬────────────────────────────────────┘
                        │ validated bridge
┌───────────────────────▼────────────────────────────────────┐
│ Preload                                                    │
│ contextBridge + Zod schemas + capability-scoped API         │
└───────────────────────┬────────────────────────────────────┘
                        │ window.pideck
┌───────────────────────▼────────────────────────────────────┐
│ Sandboxed React Renderer                                   │
│ Sidebar · Conversation · Review · Terminal · Settings       │
│ Command Palette · Resource Manager · Compatibility Console  │
└────────────────────────────────────────────────────────────┘
```

进程职责固定为：

| 进程 | 允许做什么 | 明确禁止 |
| --- | --- | --- |
| Main | BrowserWindow、菜单、单实例、更新检查、IPC 路由、Utility Process 生命周期 | 直接调用 Pi SDK、保存 API Key、执行任意 Bash |
| PiHost Utility Process | 创建 `ModelRuntime`/`AgentSession`、加载扩展、会话读写、工具执行、Bash 流、模型认证 | 直接访问 Renderer DOM、暴露原始 Node 对象 |
| Preload | 暴露最小能力接口、校验参数、订阅事件 | 转发任意 `ipcRenderer`、提供任意文件或 Shell API |
| Renderer | 展示状态、收集用户输入、渲染扩展 UI、发起领域命令 | 读取凭据、导入 Pi 包、直接访问文件系统 |

安全设置：

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- 严格 Content Security Policy
- 禁止任意页面导航和任意新窗口
- 外部链接必须通过白名单校验后使用系统浏览器打开
- 每个 IPC Handler 校验发送者和输入
- 渲染层永远拿不到 API Key、Token 或 Pi Credential 对象

参考：

- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Electron contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge)

### 6.3 模块化 Workspace 结构

采用 npm workspaces（后续可切换 pnpm），把“领域模型、Pi 适配、桌面壳、UI”分成可测试的边界。包数量保持克制，每个包只有一个变化原因。

```text
PiDeck/
├─ apps/
│  └─ desktop/
│     └─ src/
│        ├─ main/                 # Electron Main：窗口、生命周期、IPC 路由
│        ├─ preload/              # capability-scoped bridge
│        ├─ renderer/
│        │  ├─ app/               # 路由、布局、全局 store
│        │  ├─ features/          # conversation、sessions、review、terminal...
│        │  ├─ command-palette/   # CLI 命令、快捷键、搜索
│        │  ├─ resources/         # extension/skill/prompt/theme/package
│        │  └─ settings/
│        └─ utility/
│           └─ pi-host/            # Utility Process 启动入口
├─ packages/
│  ├─ domain/                     # 纯 TypeScript：Project、Task、Entry、Approval、Capability
│  ├─ contracts/                  # IPC command/event schema（Zod）与版本号
│  ├─ pi-adapter/                 # 唯一允许依赖 Pi SDK 的适配层
│  ├─ pi-host/                    # PiHost ports、任务生命周期和崩溃恢复
│  ├─ permission-engine/          # 路径/命令风险分类、规则记忆、审批决策
│  ├─ workspace-service/          # cwd、基线、Git/非 Git diff、文件快照
│  ├─ resource-service/           # Extension、Skill、Prompt、Theme、Context、Package
│  ├─ cli-compat/                 # print/json/rpc/export/auth/stdio 等原语义通道
│  ├─ ui-system/                  # PiDeck tokens、MiSans、组件与可访问性基元
│  ├─ i18n/                       # zh-CN/en 资源与 key 校验
│  └─ testkit/                    # Mock Pi、事件工厂、E2E fixtures
├─ resources/
│  ├─ fonts/
│  └─ icons/
├─ docs/
├─ tests/
└─ package.json
```

依赖方向只能向下，禁止循环依赖：

```text
renderer features ──▶ ui-system + i18n + contracts + domain
preload ────────────▶ contracts
main ───────────────▶ contracts + domain + pi-host + services
pi-host ────────────▶ pi-adapter + permission-engine + workspace-service
pi-adapter ─────────▶ @earendil-works/pi-coding-agent
domain ─────────────▶ 无 Electron、React、Pi SDK 依赖
```

规则：

- `domain` 不知道 Electron、React 和 Pi；它是最稳定的内核。
- `pi-adapter` 是 Pi 类型变化的唯一隔离带；Renderer 不得 import Pi 包。
- 跨进程只传可序列化 DTO，不传函数、类实例、AbortController、Credential 或文件句柄。
- 每条 IPC command/event 都有 `schemaVersion`，未知版本拒绝并给出升级提示。
- UI Store 只保存当前视图所需的投影，不复制完整 Session JSONL。
- 新增能力先进入 `CapabilityCatalog`，再绑定 UI、命令面板或兼容通道。

## 7. Pi 运行时设计

### 7.1 PiAdapter 与 PiHost

`PiAdapter` 是唯一接触 Pi SDK 的模块；`PiHost` 负责在 Utility Process 中编排它。

`PiAdapter` 职责：

- 创建 `ModelRuntime`。
- 创建和恢复 `AgentSession`。
- 订阅 Pi 事件。
- 将 Pi 类型转换为稳定的 PiDeck 领域事件。
- 暴露模型、认证、资源、会话、工具、压缩、重试和统计等端口。

`PiHost` 职责：

- 一个任务一个运行上下文，维护任务到 `AgentSession` 的映射。
- 处理跨进程请求、取消、超时、崩溃和重启恢复。
- 管理模型、思考等级、队列和上下文压缩。
- 管理关闭前的 Session 与 Settings 刷盘。

不允许 React 渲染层或 Electron Main 直接依赖 Pi 类型。Pi 升级造成的类型变化只能影响 `packages/pi-adapter` 与其契约测试。

### 7.2 SessionRegistry

- 使用 `SessionManager.listAll()` 加载现有会话。
- 按规范化 `cwd` 对会话分组。
- 每个正在运行的任务持有独立 `AgentSession`，由 PiHost Utility Process 托管。
- 非运行任务可释放内存并保留持久化文件。
- 重新打开任务时从 Session File 恢复。
- 切换选中任务不会中止后台执行。
- 应用退出时：
  1. 阻止新的 Prompt。
  2. 提示仍在运行的任务。
  3. 等待或中止任务。
  4. Flush 设置和会话。
  5. 释放事件订阅。

### 7.3 事件归一化

渲染层只处理以下事件族：

```ts
type PiDeckEvent =
  | { type: "task.state"; taskId: string; state: TaskState }
  | { type: "message.snapshot"; taskId: string; messages: UiMessage[] }
  | { type: "message.delta"; taskId: string; messageId: string; delta: UiDelta }
  | { type: "tool.started"; taskId: string; tool: UiToolCall }
  | { type: "tool.updated"; taskId: string; toolCallId: string; update: UiToolUpdate }
  | { type: "tool.finished"; taskId: string; result: UiToolResult }
  | { type: "approval.requested"; taskId: string; approval: ApprovalRequest }
  | { type: "terminal.delta"; taskId: string; executionId: string; delta: string }
  | { type: "workspace.changed"; taskId: string; summary: ChangeSummary }
  | { type: "session.stats"; taskId: string; stats: UiSessionStats }
  | { type: "notification"; level: NotificationLevel; message: LocalizedError };
```

流式增量按浏览器动画帧批量提交，避免每个 Token 触发完整 React 渲染。

### 7.4 消息模型

```ts
type UiMessage =
  | UiUserMessage
  | UiAssistantMessage
  | UiToolMessage
  | UiBashMessage
  | UiCompactionMessage
  | UiBranchSummaryMessage
  | UiCustomMessage;
```

每条消息保留：

- Pi Entry ID。
- Parent ID。
- 角色与内容块。
- 创建时间。
- 是否仍在流式生成。
- Tool Call 与 Tool Result 关联。
- 是否属于当前活动分支。
- 原始错误详情。

## 8. IPC 契约

预加载层提供如下最小能力：

```ts
interface PiDeckBridge {
  projects: {
    list(): Promise<ProjectSummary[]>;
    open(): Promise<ProjectSummary | null>;
    reveal(path: string): Promise<void>;
  };

  sessions: {
    list(projectId?: string): Promise<TaskSummary[]>;
    create(input: CreateTaskInput): Promise<TaskSnapshot>;
    open(taskId: string): Promise<TaskSnapshot>;
    rename(taskId: string, name: string): Promise<void>;
    fork(taskId: string, entryId: string): Promise<TaskSnapshot>;
    clone(taskId: string): Promise<TaskSnapshot>;
    tree(taskId: string): Promise<SessionTree>;
    navigateTree(taskId: string, entryId: string, options?: TreeNavigationOptions): Promise<void>;
    switch(taskId: string, sessionPath: string): Promise<TaskSnapshot>;
    getEntries(taskId: string): Promise<SessionEntry[]>;
    getStats(taskId: string): Promise<SessionStats>;
    export(taskId: string, format: "html" | "jsonl", outputPath?: string): Promise<string>;
    close(taskId: string): Promise<void>;
  };

  agent: {
    prompt(input: PromptInput): Promise<void>;
    steer(input: PromptInput): Promise<void>;
    followUp(input: PromptInput): Promise<void>;
    abort(taskId: string): Promise<void>;
    compact(taskId: string, instructions?: string): Promise<void>;
    retry(taskId: string): Promise<void>;
    setModel(taskId: string, provider: string, modelId: string): Promise<void>;
    setThinkingLevel(taskId: string, level: ThinkingLevel): Promise<void>;
    setScopedModels(taskId: string, patterns: string[]): Promise<void>;
    setSteeringMode(taskId: string, mode: SteeringMode): Promise<void>;
    setFollowUpMode(taskId: string, mode: FollowUpMode): Promise<void>;
  };

  terminal: {
    run(taskId: string, command: string, excludeFromContext?: boolean): Promise<string>;
    abort(taskId: string, executionId: string): Promise<void>;
  };

  approvals: {
    resolve(input: ApprovalDecision): Promise<void>;
  };

  providers: {
    list(): Promise<ProviderSummary[]>;
    models(search?: string): Promise<ModelSummary[]>;
    login(providerId: string, method: AuthMethod): Promise<void>;
    logout(providerId: string): Promise<void>;
    setApiKey(providerId: string, apiKey: string): Promise<void>;
  };

  resources: {
    list(): Promise<ResourceCatalog>;
    reload(): Promise<void>;
    install(input: PackageInstallInput): Promise<void>;
    remove(source: string): Promise<void>;
    update(source?: string | "self" | "pi"): Promise<void>;
    configure(scope: "global" | "project"): Promise<void>;
  };

  extensions: {
    invokeCommand(taskId: string, command: string, args?: string[]): Promise<void>;
    resolveUiRequest(requestId: string, result: unknown): Promise<void>;
  };

  cli: {
    run(input: CliCompatInput): Promise<CliCompatResult>;
    cancel(runId: string): Promise<void>;
  };

  settings: {
    get(): Promise<AppSettings>;
    update(patch: AppSettingsPatch): Promise<AppSettings>;
  };

  events: {
    subscribe(listener: (event: PiDeckEvent) => void): () => void;
  };
}
```

禁止暴露：

- 原始 `ipcRenderer`。
- 任意文件读取接口。
- 任意 Shell 执行接口。
- Pi `ModelRuntime` 或 Credential 对象。
- 任意 URL 打开接口。

## 8.1 Pi CLI 全功能覆盖矩阵

PiDeck 的能力目录（`CapabilityCatalog`）必须逐项记录 Pi CLI 的命令、参数、输入和输出。每项能力只能落到以下三种表面之一：

- **原生 UI**：在侧栏、设置、对话、审阅区、终端或资源管理器中完成。
- **命令面板**：通过 `Ctrl/Cmd+K` 搜索并执行，结果回到当前任务。
- **兼容通道**：启动隔离的 Pi CLI 进程，保留原始 stdout/stderr、退出码和 stdin 语义。

| Pi CLI 能力 | PiDeck 入口 | 备注 |
| --- | --- | --- |
| Interactive TUI | 原生 UI | Codex 式三栏工作区 + 底部终端 |
| `--print/-p`、stdin、JSON 输出 | 兼容通道 / “一次性运行”面板 | 支持文本、JSON、退出码和完整日志 |
| `--mode text/json/rpc` | 兼容通道 | RPC 不作为内部主协议，但可用于脚本和集成 |
| `--export` | 任务菜单、命令面板 | HTML/JSONL 导出，支持指定路径 |
| `auth print-api-key`、`auth print-bearer-token` | 设置 > Provider > 外部客户端凭据 | 复用 Pi 的本机凭据，凭据只在一次性安全窗口显示 |
| `--provider`、`--model`、`--models`、`--list-models` | 顶栏模型选择器、模型管理器 | 支持 provider/model、glob、模糊搜索和思考等级 |
| `--thinking` | 顶栏思考等级 | `off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max` |
| `--api-key`、环境变量、OAuth | Provider 设置 | API Key 不落 Renderer，不写入事件日志 |
| `--continue/-c`、`--resume/-r`、`--session`、`--session-id` | 任务列表、快速切换 | 保留跨项目查找和恢复语义 |
| `--fork`、`/fork`、`/clone`、`/tree` | 会话树视图 | 支持分叉、克隆、树导航、分支摘要和标签 |
| `--session-dir`、`PI_SESSION_DIR` | 设置 > 存储 | 显示当前路径，允许安全迁移 |
| `--no-session`、`--name/-n` | 新建任务高级选项、任务菜单 | 临时任务不写入会话文件 |
| `--system-prompt`、`--append-system-prompt` | 任务高级提示词设置 | 支持文本与文件内容追加 |
| `@file`、图片、初始多条消息 | Composer 附件与文件引用 | 与 CLI `@files... messages...` 等价 |
| `--tools/-t`、`--exclude-tools/-xt`、`--no-tools`、`--no-builtin-tools` | 工具策略面板 | 任务级显示最终生效的工具集 |
| `--extension/-e`、`--no-extensions` | 资源管理器 | 支持显式路径、发现开关、热重载 |
| `--skill`、`--no-skills` | Skill 选择器 | 支持项目/全局作用域 |
| `--prompt-template`、`--no-prompt-templates` | Prompt Template 选择器 | Composer 自动补全 |
| `--theme`、`--no-themes` | 外观设置 | PiDeck 主题与 Pi 资源主题分层管理 |
| `--no-context-files`、`--approve/-a`、`--no-approve/-na` | 项目可信度面板 | 明确展示 AGENTS.md/CLAUDE.md 是否加载 |
| `--offline`、`PI_OFFLINE` | 网络与诊断设置 | 禁止启动网络操作，保留本地会话 |
| `--verbose`、版本、帮助 | 关于与诊断 | 原文帮助可复制，启动诊断可下载 |
| `pi install/remove/uninstall/update/list/config` | 资源管理器 | 包操作前走权限审批，输出流式展示 |
| `/settings`、`/model`、`/scoped-models` | 命令面板 / 设置 | 支持键盘和鼠标 |
| `/export`、`/import`、`/share`、`/copy` | 任务菜单 | Share 需要显式网络确认 |
| `/name`、`/session`、`/changelog`、`/hotkeys` | 任务信息 / 帮助 | 技术详情可复制 |
| `/trust`、`/login`、`/logout` | 项目可信度 / Provider 设置 | Provider 登录写入 Pi 本机凭据，不创建 PiDeck 账户 |
| `/new`、`/compact`、`/resume`、`/reload`、`/quit` | 命令面板 | Reload 只重载资源，不重启窗口 |
| Steering、Follow-up、Abort、Retry | Composer 状态栏和任务菜单 | 队列模式可见、可切换 |
| Read/Bash/Edit/Write/Grep/Find/Ls 与自定义 Tool | 对话过程块、审批卡、终端、审阅区 | 保留流式更新、详情、错误和自定义渲染 |
| Extension command/shortcut/CLI flag/UI request | 扩展桥接层 | `select/confirm/input/editor/custom/widget/status/title` 映射桌面组件 |

兼容通道不是“降级模式”：它是对脚本、自动化和尚未有专用 UI 的扩展能力的稳定逃生舱。每个版本的 CI 都要从 Pi `--help`、内置斜杠命令和包管理器生成清单，检查 `CapabilityCatalog` 无遗漏。

## 9. 权限与审批

Pi 本身不提供内置权限系统。PiDeck 通过 Inline Extension 的 `tool_call` 事件增加操作审批。

### 9.1 默认规则

| 操作 | 默认行为 |
| --- | --- |
| 工作区内 Read/Grep/Find/Ls | 自动允许 |
| 工作区外读取 | 询问 |
| 工作区内 Edit/Write | 询问，可记忆到任务或项目 |
| 工作区外 Edit/Write | 每次询问，不允许长期记忆 |
| Bash | 询问 |
| 包安装、下载、网络请求 | 每次询问 |
| 删除、移动、覆盖 | 每次询问 |
| 权限提升和系统配置 | 每次询问 |
| 未知自定义工具 | 询问 |

### 9.2 审批界面

审批卡必须显示：

- 工具名称。
- 具体命令或路径。
- 当前工作目录。
- 风险原因。
- 编辑操作的变更预览。
- 允许一次。
- 当前任务允许。
- 当前项目允许。
- 拒绝。

高风险操作不显示“当前项目允许”。

### 9.3 路径安全

所有路径先执行：

1. 绝对路径解析。
2. `.` 与 `..` 规范化。
3. 符号链接真实路径解析。
4. Windows 大小写和盘符规范化。
5. 与项目根目录比较。

审批规则只保存规范化路径或命令签名，不保存模糊字符串匹配。

## 10. 变更审阅

### 10.1 数据来源

- Edit Tool 的 `details.patch`。
- Edit Tool 的 `firstChangedLine`。
- Write Tool 的路径和写入记录。
- Git 项目中的 `git diff` 与 `git status`。
- 非 Git 项目的任务级文件快照。

### 10.2 行为

- Agent 每次编辑完成后增量刷新变更摘要。
- 文件列表区分 modified、added、deleted、renamed。
- 已存在的用户变更不能被标记为 Agent 新增变更。
- PiDeck 在任务开始时记录基线，只展示任务造成的增量和当前完整工作区 diff 两种视图。
- 默认只读审阅，不在 v1 中实现逐块暂存或回滚。
- 不自动运行 Git Reset、Checkout 或 Clean。

## 11. 设置与本地化

### 11.1 设置分类

**Models**

- Provider 登录状态。
- API Key 与 OAuth。
- 默认模型。
- 默认思考等级。

**Permissions**

- 默认审批策略。
- 项目级允许规则。
- 清除规则。

**Appearance**

- 跟随系统、浅色、深色。
- 字号与代码字号。
- 侧栏与面板布局。

**Language**

- 跟随系统。
- 简体中文。
- English。

**About**

- PiDeck 版本。
- Pi SDK 版本。
- 开源许可。
- MiSans 字体声明。

### 11.2 国际化规则

- UI 资源放在 `packages/i18n/locales/zh-CN` 和 `en`。
- CI 校验两套资源 Key 完全一致。
- 日期、时间、数字、费用和 Token 使用 `Intl`。
- UI 切换语言后立即更新，不要求重启。
- 模型输出、代码、路径、命令和第三方 Extension 文案保持原文。
- Pi 内置英文错误显示本地化摘要，并提供“技术详情”查看原文。

## 12. 状态设计

所有主要界面都必须实现完整状态：

### 12.1 项目与任务

- 首次使用空状态。
- 无历史任务。
- 会话文件损坏。
- 项目目录不存在。
- 会话正在从磁盘加载。

### 12.2 模型

- 没有配置任何 Provider。
- API Key 无效。
- OAuth 等待浏览器授权。
- 模型已从 Provider 下线。
- 原会话模型不可恢复并发生回退。

### 12.3 Agent

- 正常流式生成。
- 工具运行中。
- 等待审批。
- Steering 排队。
- Follow-up 排队。
- 上下文压缩。
- 自动重试。
- 用户中止。
- Provider 返回错误。

### 12.4 审阅与终端

- 没有变更。
- 非 Git 项目。
- Diff 过大。
- 二进制文件。
- 命令无输出。
- 输出被截断并提供完整日志路径。

## 13. 快捷键

| 动作 | Windows/Linux | macOS |
| --- | --- | --- |
| 新建任务 | `Ctrl+N` | `Cmd+N` |
| 全局搜索 | `Ctrl+K` | `Cmd+K` |
| 聚焦输入区 | `Ctrl+L` | `Cmd+L` |
| 发送 | `Ctrl+Enter` | `Cmd+Enter` |
| 停止 | `Esc` | `Esc` |
| 切换侧栏 | `Ctrl+B` | `Cmd+B` |
| 切换审阅区 | `Ctrl+Shift+D` | `Cmd+Shift+D` |
| 切换终端 | `Ctrl+J` | `Cmd+J` |
| 下一个任务 | `Ctrl+Tab` | `Ctrl+Tab` |
| 设置 | `Ctrl+,` | `Cmd+,` |

快捷键在输入法组合期间不得触发。

## 14. 性能要求

- 冷启动到首屏可交互小于 2.5 秒。
- 已缓存项目的会话列表在 500ms 内出现骨架或内容。
- 流式文字更新维持 60fps，最低不低于 45fps。
- 10,000 条消息的会话仍可滚动。
- Monaco、xterm 和 Shiki 不进入首屏主包。
- Pi Session 事件不完整复制到多个 Store。
- 终端缓冲区有明确上限，并支持查看 Pi 生成的完整日志文件。

## 15. 测试方案

### 15.1 单元测试

- Pi 事件到 UI 事件的转换。
- 流式 Delta 合并。
- Tool Call 与 Tool Result 配对。
- 会话按 `cwd` 分组和排序。
- 权限风险分类。
- Windows 与 Unix 路径边界。
- 符号链接逃逸。
- 设置迁移和损坏恢复。
- 中英文资源 Key 一致性。

### 15.2 集成测试

- 使用 Mock `AgentSession` 模拟完整对话。
- 消息流式更新过程中切换任务。
- 多个后台任务并行。
- Edit/Write/Bash 审批允许与拒绝。
- 当前任务与当前项目权限记忆。
- 模型切换和思考等级切换。
- Steering、Follow-up 和 Abort。
- 自动压缩与自动重试。
- 会话恢复、克隆和分叉。

### 15.3 Electron E2E

1. 首次启动并选择语言。
2. 打开项目。
3. 配置 Provider。
4. 创建任务并发送提示。
5. 审批一次文件修改。
6. 查看 diff。
7. 执行终端命令。
8. 切换到另一个后台任务。
9. 重启应用并恢复会话。
10. 切换浅色、深色和中英文。

### 15.4 安全测试

- Renderer 无法访问 Node.js。
- 非法 IPC Sender 被拒绝。
- IPC 参数 Schema 错误被拒绝。
- 任意外部 URL 无法直接打开。
- 工作区外路径必须审批。
- 符号链接不能绕过项目边界。
- API Key 不出现在日志、事件或 DevTools。
- Content Security Policy 不允许远程脚本。

### 15.5 可访问性

- 所有功能可通过键盘完成。
- 焦点顺序与可见焦点正确。
- Dialog 和 Menu 正确管理焦点。
- 状态变化通过 ARIA Live 区域通知。
- 浅色和深色主题通过 WCAG AA。
- 200% 缩放下不丢失核心功能。

## 16. 实施阶段

### 阶段 A：桌面外壳

- Electron、Vite、React、TypeScript。
- 安全 BrowserWindow 和 Preload。
- 自定义窗口栏。
- Codex 式三栏与底部面板。
- 主题、字体和中英文框架。

验收：无 Pi 后端时可以完整浏览所有界面状态。

### 阶段 B：Pi Runtime 全功能接入

- `PiHost Utility Process` 与 `PiAdapter`。
- 项目与会话列表。
- 新建、恢复、重命名、克隆、分叉、树导航、导入和导出。
- 流式消息和 Tool Call。
- 模型、认证、思考等级、停止、队列、压缩、重试和统计。
- CLI 兼容通道：Print、JSON、RPC、Export、Auth Print、stdin。

验收：`CapabilityCatalog` 覆盖 Pi CLI 帮助和内置斜杠命令，真实项目中可完成读写型任务。

### 阶段 C：权限系统

- Inline Permission Extension。
- 审批队列。
- 路径和命令风险分类。
- 一次、任务、项目三级规则。
- Provider 凭据隔离。

验收：未经允许的写入和命令不能执行。

### 阶段 D：审阅与终端

- 工作区基线和变更聚合。
- 文件列表与 Monaco Diff。
- xterm.js。
- 用户 Bash 和实时输出。

验收：可以完成一次代码修改、运行测试并审阅结果。

### 阶段 E：资源系统与产品化

- Extension、Skill、Prompt Template、Theme、Context File 和 Package 管理。
- 完整异常状态。
- 性能优化。
- 键盘与无障碍。
- 安装包。
- 字体和依赖许可清单。

验收：Windows 安装包通过完整 E2E、安全测试和 CLI 功能覆盖测试。

## 17. 本版本明确不做

- 云端同步。
- 团队协作和多人会话。
- 远程 SSH 工作区。
- 插件市场。
- 浏览器 Web 版本。
- 自动更新服务。
- Git 暂存、提交、回滚和冲突解决。
- 内置完整代码编辑器。
- 对第三方 Extension 文案进行自动翻译。

这些能力不属于 Pi CLI 的本地功能范围，可以在核心架构稳定后逐项进入后续版本。

## 18. 默认决策

- 产品名暂定为 PiDeck。
- 首版采用跨平台 Electron，Windows 优先验收。
- 以 Pi CLI 功能完整覆盖为硬约束，原生 UI 与兼容通道共同完成能力对齐。
- 默认开启操作审批。
- 默认主题跟随系统。
- 默认语言跟随系统。
- Pi 会话文件是对话事实来源。
- PiDeck 只保存界面偏好、最近项目和权限规则，不建立第二套消息数据库。
- 不修改 `D:\projects\pi`。
- 布局参考 Codex，配色参考 Claude，排版参考 MIMOcode，但不复制任何品牌资产。
