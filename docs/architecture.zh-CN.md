# PiDeck 架构说明

> 与 [产品与技术方案](product-plan.zh-CN.md) 配套。本文只冻结模块边界、运行时边界和 Pi CLI 覆盖策略。

## 1. 架构目标

PiDeck 的核心约束：

1. Pi CLI 的本地能力不丢失。
2. UI 不依赖 Pi SDK 类型，Pi 升级只影响适配层。
3. Agent、扩展、Bash 和文件操作不能阻塞桌面渲染。
4. 凭据、文件系统和 Shell 权限保持在 Renderer 之外。
5. 每个模块只有一个主要变化原因，可以独立测试和替换。

身份边界：PiDeck 本身没有账户、登录、云端工作区和同步服务。Provider 登录（API Key、OAuth、Token 刷新）仍由 Pi Runtime 提供，凭据只保留在本机 Pi 配置目录中。

## 2. 运行时拓扑

```text
React Renderer
  └─ Preload: window.pideck（能力受限、Zod 校验）
      └─ Electron Main
          ├─ WindowLifecycle
          ├─ IpcRouter
          ├─ AppServices
          └─ PiHostClient
              └─ MessagePort
                  └─ Electron Utility Process: PiHost
                      ├─ PiAdapter
                      ├─ SessionRegistry
                      ├─ PermissionEngine
                      ├─ WorkspaceService
                      ├─ ResourceService
                      └─ CliCompatRunner
                          └─ Pi SDK / Pi CLI
```

Main 进程只做桌面编排。PiHost 承载所有可能长时间运行的工作：模型请求、Agent Turn、扩展代码、Bash、会话读写、资源发现和包操作。PiHost 退出后，Main 保留窗口并显示“运行时已断开”，用户可以重启 PiHost 并从 Session File 恢复。

开发阶段 PiHost 会从本机全局 `pi` 命令定位 `@earendil-works/pi-coding-agent`；也可以通过 `PIDECK_PI_MODULE` 指定 SDK 的 `dist/index.js` 路径。打包阶段再把同版本 Pi SDK 固定进应用资源。

## 3. Workspace 结构

```text
PiDeck/
├─ apps/desktop/
│  └─ src/
│     ├─ main/                  # Electron Main
│     ├─ preload/               # capability-scoped bridge
│     ├─ renderer/
│     │  ├─ app/                # 路由、布局、全局状态投影
│     │  ├─ features/           # conversation/sessions/review/terminal
│     │  ├─ command-palette/    # CLI 命令、快捷键、搜索
│     │  ├─ resources/          # 资源管理器
│     │  └─ settings/
│     └─ utility/pi-host/       # Utility Process 入口
├─ packages/
│  ├─ domain/                   # 纯领域对象和端口
│  ├─ contracts/                # IPC DTO、事件、schemaVersion
│  ├─ pi-adapter/               # 唯一依赖 Pi SDK 的包
│  ├─ pi-host/                  # 运行时编排、崩溃恢复
│  ├─ permission-engine/        # 风险分类和审批规则
│  ├─ workspace-service/        # cwd、基线、diff、文件快照
│  ├─ resource-service/         # extension/skill/prompt/theme/context/package
│  ├─ cli-compat/               # Pi CLI 原语义兼容执行
│  ├─ ui-system/                # 视觉 token、组件、字体、A11y
│  ├─ i18n/                     # zh-CN/en 与 key 校验
│  └─ testkit/                  # Mock、事件工厂、E2E fixture
├─ resources/
├─ docs/
└─ tests/
```

依赖只能沿以下方向流动：

```text
renderer → ui-system/i18n/contracts/domain
preload  → contracts
main     → contracts/domain/pi-host/services
pi-host  → pi-adapter/permission-engine/workspace-service
pi-adapter → @earendil-works/pi-coding-agent
domain   → 无 Electron、React、Pi 依赖
```

禁止规则：

- Renderer 不得 import Pi SDK、Node builtin 或 Credential 类型。
- Main 不得直接创建 `AgentSession`。
- `pi-adapter` 不得 import React 或 Electron。
- 跨进程只传 JSON 可序列化 DTO；不传类实例、函数、句柄和 AbortController。
- 任何新 IPC 先定义在 `packages/contracts`，再实现 Handler 和 UI。

## 4. 核心端口

`packages/domain` 定义稳定端口，具体实现可替换：

```ts
interface AgentSessionPort {
  prompt(input: PromptInput): Promise<void>;
  steer(input: PromptInput): Promise<void>;
  followUp(input: PromptInput): Promise<void>;
  abort(): Promise<void>;
  compact(instructions?: string): Promise<void>;
  retry(): Promise<void>;
}

interface SessionPort {
  list(cwd?: string): Promise<TaskSummary[]>;
  open(id: string): Promise<TaskSnapshot>;
  fork(id: string, entryId: string): Promise<TaskSnapshot>;
  clone(id: string): Promise<TaskSnapshot>;
  navigateTree(id: string, entryId: string, options?: TreeNavigationOptions): Promise<void>;
  export(id: string, format: "html" | "jsonl"): Promise<string>;
}

interface ResourcePort {
  discover(cwd: string): Promise<ResourceCatalog>;
  reload(): Promise<void>;
  install(input: PackageInstallInput): Promise<void>;
  remove(source: string): Promise<void>;
  update(source?: string): Promise<void>;
}
```

PiAdapter 把 `ModelRuntime`、`AgentSession`、`SessionManager`、扩展 UI 和 Pi 工具转换成这些端口。Pi 的事件先归一化为 `PiDeckEvent`，Renderer 只订阅归一化事件。

## 5. Pi CLI 覆盖策略

### 原生 UI

- Interactive TUI：三栏工作区、Composer、审阅区、终端。
- Session：new、continue、resume、session、name、fork、clone、tree、import、export。
- Agent：prompt、steer、follow-up、abort、compact、retry。
- Model/Auth：provider、model、models、thinking、API Key、OAuth、offline；这是 Provider 能力，不是 PiDeck 账户体系。
- Tools：Read、Bash、Edit、Write、Grep、Find、Ls、自定义工具、审批。
- Resources：Extension、Skill、Prompt Template、Theme、Context File、Package。

### 命令面板

命令面板注册所有内置斜杠命令，并允许 Extension 注册 command、shortcut 和 CLI flag：

`/settings`、`/model`、`/scoped-models`、`/export`、`/import`、`/share`、`/copy`、`/name`、`/session`、`/changelog`、`/hotkeys`、`/fork`、`/clone`、`/tree`、`/trust`、`/login`、`/logout`、`/new`、`/compact`、`/resume`、`/reload`、`/quit`。

其中 `/login` 和 `/logout` 只管理 Pi Provider 凭据；PiDeck 不会为自己创建登录态。`/share` 属于用户主动触发的 Pi CLI 能力，不等同于 PiDeck 同步，默认不在工作区常驻入口展示。

Extension 的 `select`、`confirm`、`input`、`editor`、`custom`、`setWidget`、`setStatus`、`setTitle` 等请求映射到桌面 Dialog、Overlay、Widget、Status Bar 和窗口标题。

### 兼容通道

以下能力保持 Pi 原始进程语义，不强行重做：

- `--print/-p`、stdin、多条初始消息和 `@file`。
- `--mode text/json/rpc`。
- `--export`。
- `auth print-api-key`、`auth print-bearer-token`。
- `--system-prompt`、`--append-system-prompt`。
- 任意 Extension 自定义 CLI Flag。
- 尚未有专用界面的脚本化资源或包操作。

兼容通道在 Utility Process 中运行，拥有独立的 stdout/stderr、退出码、取消和日志；用户可以在“兼容控制台”中查看原始输出，也可以复制为可执行 CLI 命令。

## 6. 功能对齐验收

CI 维护 `CapabilityCatalog`，来源包括：

- Pi `--help` 与版本信息。
- `packages/coding-agent/src/modes/interactive/slash-commands.ts` 的内置命令。
- Pi 包管理器的 `install/remove/uninstall/update/list/config` 命令。
- Extension API 的 command、shortcut、CLI flag 和 UI request 类型。

每一项必须具备：

1. 稳定的 capability ID。
2. 原始 CLI/Extension 语义说明。
3. 原生 UI、命令面板或兼容通道中的一个入口。
4. 成功、取消、错误和权限拒绝测试。
5. 中英文名称与帮助文本。

任何未映射项都会让覆盖测试失败。这样“全部功能”不是口号，而是可持续验证的清单。

## 7. 性能与故障隔离

- Renderer 首屏不加载 Monaco、xterm、Shiki 和 Pi SDK。
- PiHost 通过 MessagePort 批量发送事件；流式 Delta 按动画帧合并。
- 单个任务崩溃不关闭窗口，不影响其他任务的只读状态。
- Utility Process 重启后从 Session File 恢复任务，不重复提交未确认的 Prompt。
- 终端和工具输出有上限，完整日志落盘并可打开。
- 10,000 条消息使用虚拟列表；Session JSONL 不整体复制到多个 Store。

## 8. 安全边界

- `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`。
- API Key、OAuth Token、Credential 只存在于 PiHost 或 Pi 的本机凭据存储，不进入 PiDeck Renderer，也不上传到 PiDeck 服务。
- 所有工具调用先经过 PermissionEngine；高风险命令默认每次确认。
- 路径检查包含规范化、真实路径、符号链接、Windows 盘符和大小写处理。
- 外部 URL 只能通过白名单交给系统浏览器。
- CLI 兼容通道也必须经过同一套项目可信度和审批策略。
