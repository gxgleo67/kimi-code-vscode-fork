# Kimi Code VS Code 插件 —— 个人修改版 (Fork)

**Kimi Code for VS Code — Unofficial Personal Fork**

<p align="center">
  <img src="https://raw.githubusercontent.com/gxgleo67/kimi-code-vscode-fork/main/docs/images/hero.jpg" alt="Kimi Code (Fork)" width="100%">
</p>

> **本插件是 Moonshot AI 官方 Kimi Code VS Code 插件的第三方修改版（fork）。**
>
> - **原版地址**：[MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code)（插件位于其 `apps/vscode` 子目录）
> - **本 fork 仓库**：[gxgleo67/kimi-code-vscode-fork](https://github.com/gxgleo67/kimi-code-vscode-fork)（已从原版 monorepo 提取并精简，仅保留构建本插件所需的代码）
>
> *English:*
>
> **This extension is a third-party modified build (fork) of Moonshot AI's official Kimi Code VS Code extension.**
>
> - **Upstream**: [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code) (the extension lives in its `apps/vscode` directory)
> - **This fork's repo**: [gxgleo67/kimi-code-vscode-fork](https://github.com/gxgleo67/kimi-code-vscode-fork) (extracted and slimmed down from the upstream monorepo, keeping only the code required to build this extension)

<div align="center">

**市场地址 / Marketplace:[marketplace.visualstudio.com/items?itemName=GXGLEO.kimicode-vscode-fork](https://marketplace.visualstudio.com/items?itemName=GXGLEO.kimicode-vscode-fork)(缓存看不到最新版本时请以此为准 / Check here if a cached page hides the latest release)**

**最后更新：2026-10-15 | Last updated: 2026-10-15**

**⚠️ 注意：该插件项目由 K3 MAX 自主修改并同步，跟随官方引擎侧更新，拥有更多可自定义权限。**

**⚠️ Note: this fork is modified and maintained with K3 MAX — it tracks official engine-side updates and adds more customizable options.**

</div>

## ⚠️ 声明 | Disclaimer

- 本插件是 **个人定制修改版**，与官方版 **完全隔离**：扩展 ID `moonshot-ai.kimicode-vscode-fork`、displayName "Kimi Code (Fork)"，命令 / 设置前缀均为 `kimifork.*`，视图容器 `kimifork-sidebar`。可与官方版同时共存，互不冲突。
- 本项目 **不隶属于 Moonshot AI**，不提供官方支持，使用风险自负。
- 原版仓库删除了与 VS Code 无关的部分（Kimi Code CLI/TUI、kimi-web、kap-server、vis 等）；本仓库只包含 `apps/vscode` 插件及构建闭包内必需的 11 个私有内部包（它们不发布到 npm registry，是编译必需依赖）。
- 定位：本插件是**跟随官方 KIMI CODE 引擎侧等功能同步的集合体**——官方修复与引擎更新按批次同步（当前已同步至官方 CLI 2.2.0 / PR #4230），在此之上提供官方未暴露的可自定义权限与交互定制。

*English:*

- This is a **personal customized build**, **fully isolated** from the official one: extension ID `moonshot-ai.kimicode-vscode-fork`, display name "Kimi Code (Fork)", `kimifork.*` command/setting prefixes, and a `kimifork-sidebar` view container. It coexists with the official extension without conflicts.
- This project is **not affiliated with Moonshot AI**; no official support is provided — use at your own risk.
- Parts unrelated to VS Code were dropped (Kimi Code CLI/TUI, kimi-web, kap-server, vis, etc.); this repo contains only the `apps/vscode` extension plus the 11 private internal packages in its build closure (not published to npm; required to compile).
- Positioning: this fork is a **bundle that tracks the official Kimi Code engine-side updates** — upstream fixes and engine changes are synced in batches (currently through CLI 2.2.0 / PR #4230) — with extra customization options the official build doesn't expose.

## ✨ 与原版的差异（定制功能） | Differences from Upstream

### 🔄 官方同步 | Official Sync

**引擎侧按批同步**：官方引擎修复、模型/供应商适配、协议变化按批次移植。最近一批（CLI 2.2.0 / #4230，共 18 项）：恢复会话后媒体工具可用、中断时取消视频上传、swarm 子代理状态持久化、fork 会话不再继承定时任务、Gemini 4 thinkingLevel 适配、completion token 上限按需省略、子代理请求前缀缓存对齐、MCP OAuth offline_access 等。

**Engine-side sync in batches**: upstream engine fixes, model/provider adaptation and protocol changes are ported in batches. Latest batch (CLI 2.2.0 / #4230, 18 items): media tools available after session resume, video uploads cancelled on interrupt, persisted swarm subagent state, no cron inheritance on fork, Gemini 4 thinking levels, completion-token cap omitted unless configured, subagent request-prefix cache parity, MCP OAuth offline_access, and more.

### 👥 多账号 | Multi-Account

**多账号不同登录方式**：支持同时登录多个 Kimi Code 官方账号（VS Code 内完成 OAuth 设备码流程），第三方自定义供应商（API Key）与官方账号统一在「账号管理」中管理；一键按窗口切换账号（不同窗口可各用各的账号）、手动排序、星标默认账号；每个账号独立显示 5 小时 / 7 天（或月度）额度与重置倒计时。

**Multiple accounts, different sign-in methods**: stay signed in to several official Kimi Code accounts at once (OAuth device flow inside VS Code); third-party custom providers (API keys) are managed alongside official accounts in Account Management; one-click per-window account switching (different windows can use different accounts), manual ordering, starred default account; per-account 5-hour / 7-day (or monthly) quota with reset countdowns.

### 🤖 会话与标题 | Sessions & Titles

**会话标题自动生成**：官方 V2 引擎已提供该功能但默认关闭，本插件默认开启（可用 `auto_session_title` 配置关闭）。

**Automatic session titles**: provided by the official v2 engine but off by default; this fork turns it on by default (can be disabled via the `auto_session_title` config).

### 📊 额度 | Quota

**额度状态栏**：5 小时 / 7 天额度同心环实时显示，颜色随用量变化（70% 起黄 → 100% 红），含重置倒计时与 Tooltip；适配无 7 天上限的新套餐（自动切换月度额度），悬浮显示套餐名；额度查询固定走直连，不经系统代理，避免代理导致偶发查询失败。

**Quota status rings**: live concentric rings for the 5-hour / 7-day quotas; color shifts with usage (yellow from 70%, red at 100%), with reset countdown and tooltip; adapts to plans without a weekly cap (switches to the monthly quota) and shows the plan name on hover. Quota lookups always connect directly, bypassing the system proxy, to avoid intermittent proxy-related failures.

### 🛡️ 权限与审批 | Permissions & Approval

**Plan 审批（Claude 式 UX）**：Plan 模式弹窗支持 执行 / Revise+反馈 / 选项，不再在 YOLO 下静默直接执行；计划完成时先在编辑器中打开计划文件，再弹窗确认。

**Plan approval (Claude-style UX)**: the plan-mode dialog offers Execute / Revise with feedback / options instead of silently auto-executing in YOLO mode; when planning finishes, the plan file opens in the editor first, then the confirmation dialog appears.

**更多权限自定义**：`Shift+Tab` 循环切换权限模式（逐条确认 → 自动通过 → 完全自主）；可选设置：计划模式自动拉满思考强度、在编辑器中以渲染预览打开计划文档等。

**More permission customization**: `Shift+Tab` cycles permission modes (confirm each → auto-approve → full autonomy); optional settings include max thinking effort in plan mode, opening plan documents as rendered previews in the editor, and more.

### 🧠 上下文 | Context

**压缩后界面同步**：`/compact` 完成后对话列表与引擎真实上下文同步——压缩记录显示为 Claude Code 风格的单行标记（手动/自动 + 释放 token 数），点击可展开压缩摘要；上下文查看器打开时自动刷新。

**Post-compaction UI sync**: after `/compact`, the chat list matches the engine's real context — the compaction entry renders as a Claude Code–style single-line marker (manual/auto + tokens freed) that expands to the compaction summary; the context viewer refreshes automatically while open.

### 📜 历史记录 | History

**历史记录加载体验**：打开 / 切换历史对话立即显示加载遮罩；加载完成后直接定位到最新消息，不再有从上往下的滚动动画；点选会话后列表立即收起，不再挂在遮罩上。

**History loading UX**: opening or switching to a past conversation shows a loading overlay immediately; once loaded it jumps straight to the newest message (no top-to-bottom scroll animation); picking a session collapses the list at once instead of leaving it hanging over the overlay.

**Kimi 眼睛加载动画**：历史加载、会话列表、上下文查看器等加载场景，居中显示毛玻璃加载胶囊——左侧 Kimi 眼睛徽标（左右漂移 + 眨眼，复刻 Kimi Web 左上角图标动画），右侧「加载中…」文案。

**Kimi eyes loading animation**: loading states (history, session list, context viewer) show a centered frosted-glass capsule — the Kimi eyes badge on the left (drifting and blinking, replicating the Kimi Web top-left icon animation) with "Loading…" text on the right.

### 🤝 子代理 | Subagents

**子代理自定义供应商**：可在 VS Code 内为子代理配置自定义供应商（密钥存 SecretStorage，安全），支持添加 / 编辑（密钥留空保持不变）/ 删除。

**Custom subagent providers**: configure custom providers for subagents inside VS Code (keys stored securely in SecretStorage); add / edit (leave the key field empty to keep the stored key) / delete supported.

**子代理独立模型（secondary model）**：子代理可绑定独立供应商模型（如 DeepSeek），主代理 Kimi + 子代理 DeepSeek 分流，高峰期更稳更快。

**Dedicated subagent model (secondary model)**: subagents can bind an independent provider/model (e.g. DeepSeek) — main agent on Kimi, subagents on DeepSeek — for steadier, faster runs at peak hours.

**子代理模型徽标**：使用第三方模型的子代理在卡片尾部标注紫色模型名徽标，跟随主模型的不标记（实时与历史回放均生效）。

**Subagent model badge**: subagents running on third-party models show a purple model-name badge at the end of their card; subagents following the main model stay unmarked (works live and in history replay).

### 🌐 界面 | UI

**界面语言**：中英文切换（设置 `kimifork.language`）。

**UI language**: Chinese/English switch (setting `kimifork.language`).

**Logo 与视觉**：复刻 Kimi Code CLI 蓝色标识、对话框头像、状态栏布局调整；所有开关 开 = 蓝色 / 关 = 灰色，状态一眼可辨。

**流式动效（桌面端同款）**：正在输出的正文末尾显示闪烁的打字机光标；思考块标签在推理期间以 1.6 秒呼吸动画提示进行中（均尊重系统「减少动态效果」设置）。

**Logo & visuals**: the Kimi Code CLI blue logo, chat avatars, and an adjusted status-bar layout; every toggle is blue when on and gray when off — state at a glance.

**Streaming motion (same as the desktop app)**: a blinking typewriter cursor follows the tail of in-flight text, and the thinking label breathes while reasoning streams (both honor reduced motion).

**Web 同款输入区**：状态行左侧保留队列 / 文件修改，右侧为后台 Bash / 子 Agent / 当前进度（待办）/ 上下文查看器（仅在本对话调用过后显示）；模式与模型选择器（参考 kimi code web 界面）；有待发消息时队列按钮蓝色高亮。

**Web-style input area**: the status row keeps queue / file-changes on the left, and background Bash / sub-agents / current progress (todos) / context viewer on the right (each shown only after use in the current conversation); mode & model pickers modeled on the Kimi Code Web UI; the queue button highlights blue while messages are pending.

## 🖼️ 界面预览 | UI Preview

<p align="center">
  <img src="https://raw.githubusercontent.com/gxgleo67/kimi-code-vscode-fork/main/docs/images/UI.jpg" alt="插件界面效果 | UI preview" width="80%">
</p>

## ⌨️ 快捷键 | Keyboard Shortcuts

**本 fork 独有**：

| 快捷键 | 作用 |
| --- | --- |
| `Ctrl/Cmd + Enter` | 立即发送：任务进行中把消息直接插入当前回合（不经过排队），空闲时等同普通发送 |
| `Shift + Tab` | 循环切换权限模式（逐条确认 → 自动通过 → 完全自主），仅插件窗口内生效，弹窗打开时不抢占焦点导航 |
| `Ctrl/Cmd + Enter`（审批弹窗内） | 审批 / 计划弹窗的修改意见框内提交修改意见（`Esc` 取消修改） |

*English (fork-only):*

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + Enter` | Send now: while a task is running, insert the message directly into the current turn (bypassing the queue); equals a normal send when idle |
| `Shift + Tab` | Cycle permission modes (confirm each → auto-approve → full autonomy); only inside the extension window, and never steals focus navigation while a dialog is open |
| `Ctrl/Cmd + Enter` (in approval dialogs) | Submit feedback in the revision box of approval / plan dialogs (`Esc` cancels) |

**官方原有**（沿用上游，行为未改动）：

| 快捷键 | 作用 |
| --- | --- |
| `Ctrl/Cmd + Shift + K` | 聚焦插件输入框 |
| `Alt + K` | 在编辑器中把选中代码作为 `@` 引用插入对话 |
| `Ctrl/Cmd + N` | 新建对话 |
| `Enter` / `Shift + Enter` | 发送 / 换行（设置里可切换为 `Ctrl + Enter` 发送） |
| `↑` / `↓` | 输入框翻阅历史输入 |
| `@` 菜单：`↑↓` 选择、`Tab/Enter` 确认、`←→` 进出文件夹、`Esc` 关闭 | 文件引用选择 |
| `Esc` | 关闭图片预览、队列面板等弹层 |

*English (upstream, unchanged):*

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + Shift + K` | Focus the extension input box |
| `Alt + K` | Insert the selected editor code into the conversation as an `@` reference |
| `Ctrl/Cmd + N` | New conversation |
| `Enter` / `Shift + Enter` | Send / newline (can be switched to `Ctrl + Enter` send in settings) |
| `↑` / `↓` | Browse input history in the input box |
| `@` menu: `↑↓` select, `Tab/Enter` confirm, `←→` enter/leave folders, `Esc` close | File reference picker |
| `Esc` | Close overlays such as image preview and the queue panel |

## 🔧 构建与打包 | Build & Package

环境要求：**Node.js >= 24.15.0**、**pnpm 10.33.0**（`engine-strict` 已启用，版本不满足会直接失败）。

*English:* Requirements: **Node.js >= 24.15.0**, **pnpm 10.33.0** (enforced via `engine-strict`; the install fails on older versions).

```bash
pnpm install
cd apps/vscode
pnpm typecheck
pnpm build
node scripts/vsix-package.mjs
```

产出 | Output：`apps/vscode/artifacts/vsix/kimi-code-<版本号>-universal.vsix`（默认打通用包，全平台可装;文件名带版本号,如 `kimi-code-0.9.1-universal.vsix`,多次打包不再互相覆盖。需要分平台包时执行 `node scripts/vsix-package.mjs all`)

### 安装到 VS Code | Install into VS Code

解包 vsix 中的 `extension/` 子树到 VS Code 扩展目录（如 `~/.vscode/extensions/moonshot-ai.kimicode-vscode-fork-<版本号>`），然后执行 **`Developer: Reload Window`**。

*English:* Unpack the `extension/` subtree from the vsix into your VS Code extensions directory (e.g. `~/.vscode/extensions/moonshot-ai.kimicode-vscode-fork-<version>`), then run **`Developer: Reload Window`**.

> 注意：扩展菜单里的 "Reset Kimi" 只刷新 webview，不重载扩展宿主；修改代码后必须 Reload Window 才生效。
>
> *English:* "Reset Kimi" in the extension menu only refreshes the webview, not the extension host — after code changes you must Reload Window for them to take effect.

## 📁 目录结构 | Repository Layout

```
apps/vscode/          # 插件源码（extension host + React webview UI + 打包脚本）
packages/             # 构建闭包内的 11 个私有内部包（编译需要）
build/                # 构建工具（raw-text loader 等）
scripts/              # postinstall（node-pty 修复）
```

*English:*

```
apps/vscode/          # extension source (host + React webview UI + packaging scripts)
packages/             # 11 private internal packages in the build closure (required to compile)
build/                # build tooling (raw-text loader, etc.)
scripts/              # postinstall (node-pty fix)
```

## 🕓 更改日志 | Changelog

更改日志独立维护在 [CHANGELOG.md](https://github.com/gxgleo67/kimi-code-vscode-fork/blob/main/apps/vscode/CHANGELOG.md)，不再随插件详情页展示。

*English:* The changelog is maintained separately in [CHANGELOG.md](https://github.com/gxgleo67/kimi-code-vscode-fork/blob/main/apps/vscode/CHANGELOG.md) and no longer ships on the extension details page.

## License

[Apache-2.0](https://github.com/gxgleo67/kimi-code-vscode-fork/blob/main/apps/vscode/LICENSE)，基于 Moonshot AI 原版修改。原版版权归 Moonshot AI 所有。

[Apache-2.0](https://github.com/gxgleo67/kimi-code-vscode-fork/blob/main/apps/vscode/LICENSE) — modified from Moonshot AI's original project. Original copyright belongs to Moonshot AI.
