# PiDeck

PiDeck 是为 [Pi Agent Harness](https://pi.dev) 设计的桌面界面端。

产品方向：

- Codex 式桌面工作区布局
- 编辑部风格的信息层级与排版
- Claude 式暖中性色
- MiSans 为界面主字体
- 中文、英文双语
- 直接接入 `@earendil-works/pi-coding-agent`
- PiDeck 自身不提供账户登录与云同步；Pi Provider 的 API Key/OAuth 认证仍保留

当前阶段为方案冻结，准备按模块实现与做 Pi CLI 功能覆盖验收。

## 文档

- [PiDeck 产品与技术方案（全功能覆盖版）](docs/product-plan.zh-CN.md)
- [PiDeck 架构说明](docs/architecture.zh-CN.md)

## 本地开发

PiDeck 会优先从本机全局 `pi` 命令定位 Pi 0.83.x。若需要指定 SDK 文件，可设置：

```powershell
$env:PIDECK_PI_MODULE = "D:\path\to\pi-coding-agent\dist\index.js"
```
