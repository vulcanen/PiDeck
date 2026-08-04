# PiDeck

[English](README.en.md)

PiDeck 是 [Pi](https://pi.dev) 的桌面界面。它将 Pi CLI / Pi SDK 提供的项目、会话、模型、Provider 和工具交互整合到 Electron 工作区中。

PiDeck 不另行实现 Agent、模型目录、会话存储或凭据系统。Provider 的 API Key、OAuth 和 Session 数据继续由 Pi Runtime 管理。

左侧项目树支持同时展开多个项目下的 Pi Session；单击项目不会收起其它项目或切换当前会话，单击具体会话后才切换工作区。项目可通过右键菜单从列表移除，该操作不会删除项目文件或 Pi Session。

中央对话区支持长会话虚拟列表、每个 Session 独立的滚动位置缓存、流式回复稳定时间线和 Steering/Follow-up 排队消息。首次打开会话定位到最新消息；用户主动上滑后保留当前位置，不会被后台流式更新抢回。

当前版本：`0.1.0`  
Pi CLI / SDK 基线：`0.83.0`  
Electron：`43.2.0`

### 平台运行

#### Windows

- 正式安装包：待发布
- 下载地址：待补充
- 当前状态：可通过本地源码运行

#### macOS

- 正式安装包：待发布
- 下载地址：待补充
- 当前状态：可通过本地源码运行

### 本地源码运行

要求：

- Node.js `>=22.19.0`
- 已安装并可访问 Pi CLI，或准备好 Pi SDK 文件路径

安装依赖：

```bash
npm install
```

启动开发版：

```bash
npm run dev
```

运行类型检查和生产构建：

```bash
npm run typecheck
npm run test:renderer
npm run build
```

PiDeck 默认从本机的 `pi` 命令定位 Pi SDK。需要指定 SDK 文件时，可以设置 `PIDECK_PI_MODULE`：

Windows PowerShell：

```powershell
$env:PIDECK_PI_MODULE = "D:\path\to\pi-coding-agent\dist\index.js"
```

macOS / Linux：

```bash
export PIDECK_PI_MODULE="/path/to/pi-coding-agent/dist/index.js"
```

### 文档

- [产品与技术方案](docs/product-plan.zh-CN.md)
- [架构说明](docs/architecture.zh-CN.md)
- [Pi CLI 功能矩阵](docs/pi-cli-feature-matrix.zh-CN.md)
- [项目开发说明与规范](AGENTS.md)
