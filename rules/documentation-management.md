# 文档同步规则

## 目的

PiDeck 的文档必须反映当前代码和当前安装的 Pi SDK 能力，不得把产品规划、目标架构或示例代码误写成已实现功能。

## 强制约束

1. 项目结构发生变化时，必须在同一个变更中更新以下受影响文档：
   - `README.md`：入口、运行方式和项目定位。
   - `docs/architecture.zh-CN.md`：进程边界、目录结构、依赖方向和运行时拓扑。
   - `docs/pi-cli-feature-matrix.zh-CN.md`：Pi 能力到 UI/命令面板/兼容通道的实际映射。
   - `docs/product-plan.zh-CN.md`：当前实现基线与未实现计划。
2. `packages/contracts` 的 IPC command、event、DTO 或字段发生变化时，必须同步更新架构文档、功能矩阵和对应的运行时验证清单。
3. 新增或删除 UI 能力、Pi SDK 能力、Extension、Provider、权限机制或 CLI 命令映射时，必须更新功能矩阵；未实现能力必须明确标记为“未实现”。
4. 文档中的目录、包名、API、SDK 版本、Electron 通信模型和命令列表必须以当前代码或当前安装 Pi SDK 为准。无法验证的内容只能放在“计划/目标”章节。
5. 当第三方 Pi Extension 被加入、移除或替换时，必须记录：包名、版本、加载方式、配置来源、事件桥接和重复能力的移除方案。
6. 不得用文档描述绕过 Pi CLI/SDK 的第二套 Agent、权限、凭据、会话或模型实现。
7. 依赖升级必须同时检查 Pi SDK 类型声明和 changelog，并更新相关文档中的版本、能力和兼容性说明。
8. Renderer 的入口拆分、会话 pane 缓存、虚拟时间线、队列跟随或消息持久化恢复行为发生变化时，必须同步检查 [Renderer 会话时间线与滚动规则](renderer-session-timeline.zh-CN.md) 和架构/产品基线；不得只更新 JSX 而留下旧的目录或行为描述。
9. 文档不得把 Renderer 运行时 `activity` / `completedActivity` 描述为 Pi Session 持久化字段；Pi 原始 thinking/tool 内容和展示层推断摘要必须明确区分。

## 提交前检查

```bash
rg -n "utilityProcess|MessagePort|Zod|Zustand|Monaco|xterm|pi-adapter|permission-engine" docs README.md
rg -n "App\.tsx|app-conversation|timeline-utils|use-conversation-scroll|@tanstack/react-virtual|completedActivity" docs rules README.md
rg -n "PiHostCommand|PiDeckRuntimeEvent|interface PideckBridge" packages/contracts/src/index.ts
npm run typecheck
npm run build
```

如果检索到的架构名词或能力在当前代码中不存在，应删除、改为“计划”，或补齐实现后再保留。
