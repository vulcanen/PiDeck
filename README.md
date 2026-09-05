# PiDeck

[English](README.en.md)

[![CI](https://github.com/vulcanen/PiDeck/actions/workflows/ci.yml/badge.svg)](https://github.com/vulcanen/PiDeck/actions/workflows/ci.yml)
[![GitHub Release](https://img.shields.io/github/v/release/vulcanen/PiDeck?display_name=tag&sort=semver)](https://github.com/vulcanen/PiDeck/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

PiDeck 是 [Pi](https://github.com/earendil-works/pi) 的开源桌面界面，将 Pi CLI / Pi SDK 的项目、会话、模型、Provider、工具和扩展能力整合到一个 Electron 工作区中。

> **声明**：PiDeck 是独立的非官方项目，与 Pi 官方团队无隶属关系，也未获得其背书。PiDeck 不实现第二套 Agent、模型目录、会话存储或凭据系统；相关能力仍以 Pi CLI / Pi SDK 为权威来源。

当前适配基线：Pi CLI / SDK `0.84.4`，Electron `43.3.0`。

![PiDeck 深色主题工作台，显示项目侧栏、空会话区域和消息输入区](docs/assets/pideck-workspace.png)

## 主要功能

- 同时浏览多个项目及其 Pi Session，并在独立会话工作区之间切换。
- 在桌面端配置 Provider、API Key、OAuth、模型和 Thinking Level。
- 展示流式回复、Thinking、工具调用、执行结果和运行耗时。
- 支持工具审批、权限等级以及 Steering / Follow-up 消息队列。
- 支持 Pi slash command、Prompt、Skill、Extension command 和 Pi Package 管理。
- 渲染 Markdown、代码、Mermaid 图和数学公式，并保留每个 Session 的阅读位置。
- 提供中英文界面以及浅色、深色主题。

准确的已实现范围和待支持能力见 [Pi CLI → PiDeck 功能矩阵](docs/pi-cli-feature-matrix.zh-CN.md)。

## 下载与系统要求

从 [GitHub Releases](https://github.com/vulcanen/PiDeck/releases/latest) 下载最新公开版本：

| 平台 | 系统要求 | 安装包 |
| --- | --- | --- |
| Windows | Windows 10 / 11，x64 | `PiDeck-VERSION-windows-x64-setup.exe` |
| macOS Apple Silicon | macOS 12 Monterey 或更高版本，arm64 | `PiDeck-VERSION-macos-arm64.dmg` |
| macOS Intel | macOS 12 Monterey 或更高版本，x64 | `PiDeck-VERSION-macos-x64.dmg` |
| Linux | 暂无经过发布验证的安装包 | — |

将文件名中的 `VERSION` 替换为 Release 显示的版本号。Mac 的“关于本机”中显示“芯片”时选择 arm64；显示“处理器”时选择 Intel x64。

PiDeck 安装包包含项目锁定的 Pi SDK，不要求另行安装 Pi CLI。正式安装包始终优先使用内置的 `0.84.4`；只有显式设置 `PIDECK_PI_MODULE` 才会覆盖它，用于开发或兼容性测试。

## 安装

### Windows

1. 下载 `PiDeck-VERSION-windows-x64-setup.exe`。
2. 运行 NSIS 安装器，按需选择安装目录。
3. 从开始菜单或安装目录启动 PiDeck。

Windows 顶栏在“工作台”右侧提供“编辑 / 查看 / 帮助”，窗口较窄时合并为“菜单”；macOS 使用系统菜单栏。这些入口复用 Electron 原生菜单，编辑操作保留输入框选区。

### macOS

1. 根据 Mac 架构下载 arm64 或 x64 DMG。
2. 安装前，在“系统设置 → 隐私与安全性”中开启“允许任何来源”。
3. 打开 DMG，将 PiDeck 拖入“应用程序”。
4. 从“应用程序”启动 PiDeck。

## 首次启动

1. 添加一个本地项目目录，或从已有 Pi Session 中选择项目。
2. 在 Provider 设置中通过 API Key 或 OAuth 完成认证。
3. 选择模型、Thinking Level 和工具权限等级。
4. 新建或打开 Session 后开始对话。

Pi Session、Provider 凭据、OAuth 和 Pi Package 配置由本机 Pi Runtime 管理，因此可以与兼容的 Pi CLI 环境共用。PiDeck 自己只在 Electron `userData` 中保存项目目录引用、显示顺序和界面偏好；从侧栏移除项目不会删除项目文件或 Pi Session。

PiHost 网络请求与 Pi CLI 使用同一套代理分发器。代理优先级为显式 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` 环境变量、Pi 全局设置中的 `httpProxy`，最后才是 Electron 在 Windows、macOS 或 Linux 上按请求目标解析到的系统代理；PAC、绕过列表和按域分流会逐请求生效。浏览器中的 OAuth 页面仍由系统浏览器及 Provider 自己处理。

PiDeck 不配置分析或遥测导出器。Provider 请求仍由用户选择的 Pi Runtime 和模型服务处理；请按对应 Provider 的隐私政策评估要发送的代码与会话内容。

Agent 工具和 Extension 可能根据当前权限设置读取、修改项目文件或执行命令。首次使用第三方 Package 前请检查其来源，并使用合适的审批级别。

## 校验下载文件

每个 Release 都包含 `SHA256SUMS.txt`，并为 macOS arm64、macOS x64 和 Windows x64 安装包分别提供基于最终打包内容生成的 CycloneDX SBOM。下载校验文件和安装包后，分别计算哈希并与对应行比较；GitHub Artifact Attestation 可用于验证产物来自仓库发布工作流。

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
- 本地终端面板未接入；Shell 仍由 Pi Agent 的真实工具能力执行。
- `/fork`、`/clone`、`/tree` 已接入统一的 Session Tree 界面，支持分支预览、筛选、键盘导航、克隆/分叉后的任务切换，以及可选的离开分支摘要。
- 任务基线 Diff 审查已经接入，支持统一/拆分视图、筛选、语法高亮和变更块导航；变更块接受/撤销以及可编辑合并仍未实现。
- Pi Print、JSON、RPC、stdin 和 Auth Print 兼容通道当前未暴露到桌面端。
- Extension 的交互式 `custom` UI 已通过受限的终端式画面/输入桥接，文本 Widget、实时编辑器文本和主题颜色也已支持；组件 Widget、Footer/Header 实例、通用终端输入、同步编辑器组件和自动补全仍不支持跨桌面桥接。
- 显式覆盖的外部 Pi SDK 可能改变 API 行为；非 `0.84.4` 版本不在当前兼容保证内。

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

需要 Pi 的无头兼容通道时，使用同一锁定 Runtime 的透明 CLI 入口；其 Print、JSON、RPC、stdin JSONL 和 `auth print-*` 行为由 Pi 官方 `main()` 直接提供：

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

- [发布维护指南](docs/releasing.zh-CN.md)
- [变更日志](CHANGELOG.md)
- [产品与技术方案](docs/product-plan.zh-CN.md)
- [架构说明](docs/architecture.zh-CN.md)
- [Pi CLI 功能矩阵](docs/pi-cli-feature-matrix.zh-CN.md)
- [项目开发说明与规范](AGENTS.md)

## 参与项目

- [报告 Bug 或提出功能建议](https://github.com/vulcanen/PiDeck/issues/new)
- 安全问题请按 [安全策略](SECURITY.md) 私下报告
- 提交代码前请阅读 [贡献指南](CONTRIBUTING.md)
- 参与社区时请遵守 [行为准则](CODE_OF_CONDUCT.md)
- 本项目基于 [MIT 协议](LICENSE) 开源
- 随安装包发布的依赖许可清单见 [第三方声明](THIRD_PARTY_NOTICES.txt)
