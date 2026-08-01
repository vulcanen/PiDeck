# PiDeck UI/UX 开发规范

> 本规范适用于 `apps/desktop/src/renderer` 的新组件、交互修复和视觉调整。
> 它将 UI/UX Pro Max 的高优先级规则转化为 PiDeck 的桌面工作台约束。

## 1. 设计方向

PiDeck 是本地开发者工具，不是营销页面。界面采用：

- 信息密度适中的技术工作台布局。
- 清晰的主次层级：会话、对话、执行过程、审批、Provider/权限设置。
- 低饱和中性色为基础，橙色强调危险/主要动作，绿色表示成功，琥珀色表示等待，红色表示失败。
- SVG 线性图标，禁止用 Emoji 作为功能图标。
- 视觉效果服务于状态表达，不为了装饰给每个元素添加动画。

## 2. 可访问性（最高优先级）

- 所有图标按钮必须同时有 `aria-label` 和 `title`。
- 所有输入框必须有 `label`、`aria-label` 或可关联的描述。
- 普通文本对比度至少达到 WCAG 4.5:1；禁用态不能成为唯一状态信息。
- 所有可交互元素必须有可见 `:focus-visible` 状态。
- Modal、Drawer、Command Palette 必须：
  - 打开后聚焦第一个可交互元素。
  - Tab 在弹层内部循环。
  - Escape 按层级关闭。
  - 关闭后恢复打开前的焦点。
- 提供跳转到主要内容的 skip link。
- 动态状态使用 `role="status"`、`aria-live="polite"` 或 `role="alert"`。
- 图片必须有有意义的 `alt`；纯装饰图片也要明确处理。
- 不用颜色作为唯一状态表达，必须同时提供文字、图标、形状或动画差异。

## 3. 交互与状态

所有异步操作至少有四种状态：`idle`、`loading`、`success/ready`、`error`。

- 加载超过约 300ms 显示 skeleton、spinner 或明确的等待文案。
- 正在提交、授权、删除或切换权限时禁用重复操作。
- 错误必须显示在相关操作附近，并提供重试或修复动作。
- 审批请求必须显示工具名、参数、风险状态和允许/拒绝动作。
- Session 切换不能让旧 Session 的流式消息、审批或运行状态串入新 Session。
- 会话列表使用右侧 spinner 表示运行中；等待审批使用独立警示状态；不要在左侧堆叠无语义状态圆点。
- 重要动作必须可点击完成，不能只依赖 hover；hover 只用于补充信息。

## 4. 命令输入框

- 普通文本、`/command`、`/skill:name` 和 `@file` 必须有可辨识但不刺眼的差异。
- Slash 高亮只能作用于 Pi 动态 command catalog 中的命令，或 Pi 明确支持的 `/skill:*`；不能用“出现 `/`”作为判断条件。
- 路径、比例、URL 和普通句子中的 `/` 不得被当成命令。
- Command suggestion 必须来自 Pi Runtime；静态列表只能作为不可用时的 fallback。
- 粘贴图片后在输入框顶部显示缩略图，必须可逐张删除；只有图片没有文字时也必须可以发送。
- 输入框的视觉高亮层不能破坏原生 textarea 的键盘选择、光标和滚动同步。
- Enter 发送，Shift+Enter 换行；快捷键不能抢占输入框内的字符。

## 5. 对话与执行过程

- User 消息、Assistant 回复、Thinking、Tool Call、Tool Result 有明确层级。
- 一次 `agent_start → agent_end/agent_settled` 归为一个 execution group。
- 执行组默认只显示摘要：思考段数、工具次数、耗时。
- 展开后按时间顺序显示工具名、参数、结果和错误。
- Tool Result 不得继续作为普通消息重复展示。
- 流式消息和执行摘要必须按 `taskId` 隔离。
- 长参数、结果和代码必须使用 `pre-wrap`、最大高度和独立滚动，不能撑破对话布局。
- Session 切换直接定位到已保存位置或最新位置，不播放跨会话平滑滚动动画。

## 6. 动画与性能

- 普通交互动画保持在 150–300ms；只动画 `transform` 和 `opacity`。
- 不使用连续滚动监听制造昂贵重排。
- 必须实现 `@media (prefers-reduced-motion: reduce)`，禁用非必要动画和滚动动画。
- 一屏最多保留少量有意义的动态状态：运行 spinner、加载 skeleton、弹层进入动画。
- 长会话应准备 `content-visibility` 或虚拟列表方案；不要无条件渲染数千条消息。
- 图片使用缩略图和受限尺寸；不让用户粘贴的原图撑开输入区或对话区。
- 第三方 Markdown 渲染保持 lazy loading，不能阻塞首屏工作区。

## 7. 响应式布局

验收宽度至少包括：375、560、760、1024、1440px。

- 560px 以下隐藏非核心侧栏，将主要操作保留在对话和输入框。
- 760px 以下 Inspector 使用抽屉，不挤压主对话。
- 触控目标建议至少 44px；桌面紧凑控件不得小于 32px，且必须有键盘可达路径。
- Popover、Tooltip、Command Palette 不能被父级 `overflow: hidden` 裁切。
- 任何固定浮层都必须避开输入框、Inspector、Toast 和系统边界。

## 8. 文案与数据边界

- 所有可见中英文放在 `apps/desktop/src/renderer/i18n.ts`，组件只读取 key。
- 文案要说明当前状态和下一步动作，避免只显示“失败”。
- Renderer 不保存 Pi 凭据，不直接访问 Node/Pi SDK。
- UI 展示的上下文用量、模型、权限和 Provider 状态必须来自 Pi Bridge 的真实 API。
- 不把规划中的能力伪装成已支持；失败时显示可操作的错误。

## 9. 变更前后检查

### 开发前

```bash
python3 C:/Users/chenyang.wu/.agents/skills/ui-ux-pro-max/scripts/search.py "desktop developer tool React accessibility" --design-system -p PiDeck
python3 C:/Users/chenyang.wu/.agents/skills/ui-ux-pro-max/scripts/search.py "focus modal keyboard loading motion" --domain ux
```

### 提交前

- [ ] 运行、等待审批、失败、空状态和加载状态都有明确视觉反馈。
- [ ] 键盘可以完成主要流程，Modal 的焦点可进入/退出/恢复。
- [ ] 触控尺寸、focus ring、对比度和 reduced-motion 已检查。
- [ ] 命令、Skill、文件引用不会误高亮普通文本。
- [ ] 图片、长文本、长命令在小窗口下不会溢出。
- [ ] 新 IPC 已先更新 `packages/contracts`。
- [ ] 新文案已同步中英文 i18n。
- [ ] 结构或 UI 能力变化已同步更新 `docs/`。
- [ ] `npm run typecheck` 和 `npm run build` 通过。
