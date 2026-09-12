# PiDeck

[English](README.en.md)

[![CI](https://github.com/vulcanen/PiDeck/actions/workflows/ci.yml/badge.svg)](https://github.com/vulcanen/PiDeck/actions/workflows/ci.yml)
[![GitHub Release](https://img.shields.io/github/v/release/vulcanen/PiDeck?display_name=tag&include_prereleases&sort=semver)](https://github.com/vulcanen/PiDeck/releases)
[![Status: Beta](https://img.shields.io/badge/status-beta-orange.svg)](#beta-说明)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

PiDeck 是 [Pi](https://github.com/earendil-works/pi) 的非官方桌面界面。它把项目、会话、模型、工具调用和审批集中到一个本地应用里；真正的 Agent 运行、模型访问、会话保存和凭据管理仍由 Pi 完成。

> PiDeck 由社区独立维护，与 Pi 官方无隶属关系。

当前适配基线：Pi CLI / SDK `0.85.1`，Electron `43.4.1`。

## Beta 说明

PiDeck 目前处于 Beta 阶段，核心工作流已经可用，但界面细节、兼容范围和安装方式仍可能调整。重要项目请正常使用 Git 或其他方式保留可恢复的版本，并在升级前查看 [变更日志](CHANGELOG.md)。

## 只为 Pi 提供桌面界面

PiDeck 不在 Pi 之外再造一套 Agent，也不维护独立的模型目录、凭据库或会话数据库。界面中的模型、命令、Tool、Session、Extension、Package 和权限状态，都来自 Pi CLI / SDK。

除了桌面交互和呈现，PiDeck 不增加 Pi 本身没有的产品能力。如果某项能力暂时无法可靠映射到桌面界面，PiDeck 会明确保留在 Pi CLI，而不是模拟一个看似可用的实现。目标很直接：保留 Pi 的简单和效率，把日常交互搬到桌面上。

![PiDeck 中的真实 DeepSeek 会话，显示项目、对话、模型和文件修改摘要](docs/assets/pideck-conversation.png)

## 主要功能

- 在侧栏管理多个项目和会话，随时切换当前任务。
- 配置 Provider、API Key、OAuth、模型和 Thinking Level。
- 实时查看回复、Thinking、工具调用、执行结果和耗时。
- 审批工具调用，调整权限，并管理 Steering / Follow-up 队列。
- 使用 Pi 的 slash command、Prompt、Skill、Extension 和 Package。
- 通过 `/fork`、`/clone`、`/tree` 浏览会话分支；查看每轮文件改动，逐块接受或撤销，并直接编辑合并结果。
- 渲染 Markdown、代码、Mermaid 图和数学公式，支持中英文及浅色、深色主题。

完整支持情况见 [Pi CLI → PiDeck 功能矩阵](docs/pi-cli-feature-matrix.zh-CN.md)。

## 界面预览

下面的画面来自 `Qwen Token Plan CN / DeepSeek V4 Pro 0813` 的真实运行，会话和文件都位于独立的演示工作区。

### 实时执行过程

Thinking、工具调用和执行状态按发生顺序显示；任务完成后，这些内容会收进可展开的执行摘要。

![DeepSeek 正在 PiDeck 中思考并执行任务](docs/assets/pideck-live-activity.png)

### 文件改动审查

每轮任务产生的文件改动可以按文件浏览，支持统一或拆分 Diff、逐块接受或撤销，以及可编辑合并。

![PiDeck 文件改动审查，显示文件树、Diff 和逐块操作](docs/assets/pideck-change-review.png)

### 会话树

`/tree`、`/fork` 和 `/clone` 直接使用 Pi 的 Session 能力，分支浏览和切换不会创建另一套会话格式。

![PiDeck 会话树，显示真实会话中的消息节点和分支操作](docs/assets/pideck-session-tree.png)

### Pi 设置与 Provider

默认模型、Thinking 和其他会话行为写入 Pi 的设置；Provider 凭据也由 Pi 保存在本机配置目录中，不进入 Renderer。

![PiDeck 的 Pi 设置，显示 DeepSeek 模型和 Thinking 配置](docs/assets/pideck-pi-settings.png)

![PiDeck 的 Provider 认证页，显示已配置的 Qwen Token Plan CN](docs/assets/pideck-provider-settings.png)

快捷设置把 Pi 设置、Provider、Package、模型范围、任务操作和命令入口放在同一个面板中。

![PiDeck 快捷设置面板](docs/assets/pideck-quick-settings.png)

## 下载与系统要求

从 [GitHub Releases](https://github.com/vulcanen/PiDeck/releases) 下载最新公开版本：

| 平台 | 系统要求 | 安装包 |
| --- | --- | --- |
| Windows | Windows 10 / 11，x64 | `PiDeck-VERSION-windows-x64-setup.exe` |
| macOS Apple Silicon | macOS 12 Monterey 或更高版本，arm64 | `PiDeck-VERSION-macos-arm64.dmg` |
| macOS Intel | macOS 12 Monterey 或更高版本，x64 | `PiDeck-VERSION-macos-x64.dmg` |
| Linux | 暂无经过发布验证的安装包 | — |

将文件名中的 `VERSION` 换成 Release 页面显示的版本号。Mac 的“关于本机”中显示“芯片”时选择 arm64；显示“处理器”时选择 Intel x64。

安装包已包含 Pi SDK `0.85.1`，无需另外安装 Pi CLI。`PIDECK_PI_MODULE` 仅用于开发和兼容性测试。

## 安装

### Windows

1. 下载 `PiDeck-VERSION-windows-x64-setup.exe`。
2. 运行 NSIS 安装器，按需选择安装目录。
3. 从开始菜单或安装目录启动 PiDeck。

### macOS

1. 根据 Mac 架构下载 arm64 或 x64 DMG。
2. 打开 DMG，将 PiDeck 拖入“应用程序”。
3. 从“应用程序”启动 PiDeck。如果 macOS 拦截了未签名版本，请在“系统设置 → 隐私与安全性”中确认打开。

## 首次启动

1. 添加一个本地项目目录，或从已有 Pi Session 中选择项目。
2. 在 Provider 设置中通过 API Key 或 OAuth 完成认证。
3. 选择模型、Thinking Level 和工具权限等级。
4. 新建或打开 Session 后开始对话。

项目、会话、Provider 凭据和 Pi Package 配置仍由 Pi 保存在本机。PiDeck 只额外保存项目列表和界面偏好；从侧栏移除项目不会删除项目文件或 Pi 会话。

PiDeck 支持 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY`、Pi 的 `httpProxy` 设置和系统代理，优先使用环境变量中的配置。OAuth 登录仍在系统浏览器中完成。

PiDeck 不收集使用数据。你发送的代码和对话会交给所选模型的 Provider 处理，请留意对应服务的隐私政策。

工具和 Extension 可能读取或修改项目文件，也可能执行命令。使用第三方 Package 前请检查来源，并选择合适的权限等级。

## 校验下载文件

每个 Release 都提供 `SHA256SUMS.txt` 和对应平台的 CycloneDX SBOM。下载后可用以下命令核对安装包哈希；GitHub Artifact Attestation 可用于确认文件来自本仓库的发布流程。

macOS：

```bash
shasum -a 256 PiDeck-VERSION-macos-arm64.dmg
grep 'PiDeck-VERSION-macos-arm64.dmg' SHA256SUMS.txt
```

Windows PowerShell：

```powershell
Get-FileHash .\PiDeck-VERSION-windows-x64-setup.exe -Algorithm SHA256
Select-String -Path .\SHA256SUMS.txt -Pattern 'PiDeck-VERSION-windows-x64-setup.exe'
```

使用 Intel Mac 时，将示例中的 `arm64` 改为 `x64`。

## 当前限制

- 暂不提供 Linux 发行安装包。
- 暂无应用内自动更新；新版本通过 GitHub Releases 获取。
- 没有独立的本地终端面板；Shell 命令仍可通过 Pi 工具及 `!command`、`!!command` 使用。
- 二进制、超大或仅保留了截断差异的文件不能逐块处理或编辑合并。
- Print、JSON、RPC、stdin 和 Auth Print 没有桌面入口，需要通过 `npm run cli` 或 `pideck-cli` 使用。
- 依赖像素级终端显示或任意 DOM 的 Extension 仍需使用 Pi CLI。
- 当前只保证与 Pi SDK `0.85.1` 兼容。

## 从源码运行

要求：

- Node.js `>=22.19.0`
- npm
- macOS 上需要 Xcode Command Line Tools，用于编译最小化窗口原生扩展

安装锁定依赖并启动开发版：

```bash
npm ci
npm run dev
```

要使用 Pi 的 Print、JSON、RPC、stdin JSONL 或 `auth print-*` 命令，可以直接通过 PiDeck 的 CLI 入口运行：

```bash
npm run cli -- --help
npm run cli -- --mode rpc --no-session
npm run cli -- auth print-api-key --provider openai
```

运行项目检查：

```bash
npm run lint
npm run typecheck
npm run test:renderer
npm run build
npm run smoke:runtime
npm run smoke:cli
npm run notices:check
npm ls --all
```

本机打包：

```bash
npm run package:win:x64
npm run package:mac
```

`package:mac` 按当前 Mac 的原生架构打包。`package:mac:arm64` 和 `package:mac:x64` 用于对应架构的 CI Runner，不建议跨架构生成包含原生依赖的安装包。

源码安装已经包含兼容的 Pi SDK。只有在开发、兼容性测试或故障排查时，才通常需要覆盖 SDK 路径：

```bash
export PIDECK_PI_MODULE="/path/to/pi-coding-agent/dist/index.js"
```

Windows PowerShell：

```powershell
$env:PIDECK_PI_MODULE = "D:\path\to\pi-coding-agent\dist\index.js"
```

## 发布与文档

- [v0.2.0 首个开源 Beta 发布说明](docs/releases/v0.2.0.md)
- [发布维护指南](docs/releasing.zh-CN.md)
- [变更日志](CHANGELOG.md)
- [产品与技术方案](docs/product-plan.zh-CN.md)
- [架构说明](docs/architecture.zh-CN.md)
- [Pi CLI 功能矩阵](docs/pi-cli-feature-matrix.zh-CN.md)
- [网络验收矩阵](docs/network-acceptance-matrix.zh-CN.md)
- [项目开发说明与规范](AGENTS.md)

## 参与项目

- [报告 Bug 或提出功能建议](https://github.com/vulcanen/PiDeck/issues/new)
- 安全问题请按 [安全策略](SECURITY.md) 私下报告
- 提交代码前请阅读 [贡献指南](CONTRIBUTING.md)
- 参与社区时请遵守 [行为准则](CODE_OF_CONDUCT.md)
- 本项目基于 [MIT 协议](LICENSE) 开源
- 随安装包发布的依赖许可清单见 [第三方声明](THIRD_PARTY_NOTICES.txt)
