# PiDeck

PiDeck 是为 [Pi Agent Harness](https://pi.dev) 设计的桌面界面端。

产品方向：

- Codex 式桌面工作区布局
- 编辑部风格的信息层级与排版
- Claude 式暖中性色
- MiSans 为界面主字体
- 中文、英文双语
- 直接接入 `@earendil-works/pi-coding-agent`
- Pi Provider 的 API Key/OAuth 认证由 Pi Runtime 管理

当前仓库已具备可运行的 Electron + React + PiHost 基线，功能状态以 `docs/pi-cli-feature-matrix.zh-CN.md` 为准；未接入能力会明确标记为计划。

## 文档

- [PiDeck 产品与技术方案（当前基线与后续计划）](docs/product-plan.zh-CN.md)
- [PiDeck 架构说明](docs/architecture.zh-CN.md)
- [Pi CLI 功能矩阵](docs/pi-cli-feature-matrix.zh-CN.md)
- [文档同步规则](rules/documentation-management.md)
- [UI/UX 开发规范](rules/ui-ux-standards.zh-CN.md)

## 本地开发

PiDeck 会优先从本机全局 `pi` 命令定位 Pi 0.83.x。若需要指定 SDK 文件，可设置：

```powershell
$env:PIDECK_PI_MODULE = "D:\path\to\pi-coding-agent\dist\index.js"
```
