# Changelog

> This file tracks only the fork's own releases, numbered independently. For upstream Kimi Code releases, see [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code/blob/main/apps/vscode/CHANGELOG.md).
>
> *中文:* 本文件只记录本 fork(Kimi Code (Fork))自身的更新,版本号独立编号。官方上游的更新记录请见 [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code/blob/main/apps/vscode/CHANGELOG.md)。

## 0.9.16(2026-09-20)

1. Ported the desktop app's brand logo (BrandLogo): the chat avatar, panel header, and account fallback avatar now use the desktop's Kimi Code CLI logo — a rounded-square tile (black on light themes, white on dark) with the blue gradient face, eyes, and the tiny `>_` terminal bar — replacing the old flat blue-rectangle Kimi avatar image.
2. Ported the desktop's eye easter egg: the logo's eyes look around every 16 s and blink every 11 s on their own, and clicking any logo (chat avatar, panel header) makes it blink once. Pure CSS/SVG, honors "reduced motion".
3. The extension's marketplace icon and activity-bar icon now match the desktop app icon (ported from the desktop build's official `icon.ico` / brand SVG).

*中文:*

1. 移植桌面端品牌 Logo(BrandLogo):对话头像、面板顶部、账号兜底头像全部改用桌面端 Kimi Code CLI 标志——圆角方块底板(浅色主题黑底、深色主题白底)+ 蓝色渐变圆脸 + 眼睛 + 迷你 `>_` 终端条,替换旧的蓝色圆角矩形头像图片
2. 移植桌面端彩蛋:Logo 眼睛每 16 秒会左右瞟动、每 11 秒自动眨一次眼,点击任意 Logo(对话头像、面板顶部)会立即眨一次眼。纯 CSS/SVG 实现,尊重系统「减少动态效果」设置
3. 扩展的市场图标和侧边栏图标改用桌面端官方应用图标(来自桌面端安装包的 `icon.ico` / 品牌 SVG)

## 0.9.15(2026-09-20)

1. Working indicator reworked to match the current desktop app: the desktop no longer ships the Rive mascot — its working indicator is now a pure-CSS "Kimi face" (a small rounded-rect blue badge whose eyes glance sideways and blink). The fork ports that exact implementation, replacing 0.9.14's Rive version which rendered the mascot's resting state as a plain blue circle. This also drops the Rive runtime entirely: no `@rive-app/canvas-lite` dependency, no `kimi-mascot.riv`/`rive.wasm` assets, ~8 MB smaller webview bundle, and the temporary `wasm-unsafe-eval` CSP relaxation is reverted. Honors "reduced motion".

*中文:*

1. 工作状态指示器重做,对齐桌面端现版:桌面端已不再使用 Rive 吉祥物,其工作指示器改为纯 CSS 的「Kimi 小脸」(圆角矩形蓝色小脸,眼睛会左右瞟动和眨眼)。本 fork 原样移植该实现,替换 0.9.14 的 Rive 版本(其静止状态渲染成一个蓝色圆球)。同时完全移除 Rive 运行时:去掉 `@rive-app/canvas-lite` 依赖与 `kimi-mascot.riv`/`rive.wasm` 资源,webview 包体减小约 8 MB,并撤回 0.9.14 临时加入的 `wasm-unsafe-eval` CSP 放宽。尊重系统「减少动态效果」设置

## 0.9.14(2026-09-20)

1. Desktop-style working indicator in the chat: while a turn is in flight, the animated Kimi mascot (the desktop app's Rive avatar animation, with its static fallback while loading) appears under the last message with a breathing status label — "请求中…" until the first content streams, then "工作中…". The old spinner + "处理中..." row is gone.
2. The assistant message avatar (Kimi logo) now renders with rounded corners.
3. Webview CSP gains `wasm-unsafe-eval` so the Rive runtime can instantiate its WebAssembly module.

*中文:*

1. 对话区内上线桌面端同款工作状态指示:回合进行中,最后一条消息下方显示 Kimi 吉祥物动画(桌面端 Rive 头像动画,加载完成前用静态备用图),旁边是呼吸状态文字——首个内容流出前显示「请求中…」,之后变为「工作中…」。原来的转圈 + 「处理中...」移除
2. 助手消息头像(Kimi 图标)改为圆角显示
3. Webview CSP 增加 `wasm-unsafe-eval`,允许 Rive 运行时实例化 WebAssembly 模块

## 0.9.13(2026-09-20)

1. Fixed a regression introduced by the 0.9.12 upstream sync (#3785): the engine now fail-fast validates the `[secondary_model]` subagent recipe on every session create/resume, so one stale alias (e.g. left behind after a custom provider was removed or renamed) made **every** conversation fail to open with `[secondary_model.models] entry "..." could not be resolved`. The extension now checks the recipe at startup against the `[models]` sections in config.toml and silently resets it to "follow the main model" (with a warning notification) when it points at undefined models.

*中文:*

1. 修复 0.9.12 同步上游(#3785)引入的回归:引擎现在每次创建/恢复会话都会对子代理 `[secondary_model]` 配置做快速失败校验,只要配方里残留一个失效的模型别名(例如自定义供应商被删除或改名后留下的),**所有**对话都会打不开,报 `[secondary_model.models] entry "..." could not be resolved`。现在扩展启动时会用 config.toml 里的 `[models]` 段落校验该配方,发现指向未定义模型时自动重置为「跟随主模型」并弹出警告提示

## 0.9.12(2026-09-20)

1. Streaming UX ported from the Kimi desktop app: a blinking typewriter cursor is now pinned to the tail of in-flight text, and the thinking block's label breathes (1.6s opacity loop) instead of spinning while reasoning streams. Both honor "reduced motion".
2. Goal mode fixes: goal updates now render live in the chat, goal control (cancel/stop) no longer freezes the dialog on long sessions, and streaming rendering is smoother.
3. Synced upstream fixes from MoonshotAI/kimi-code through mid-September: #3889 large-workspace session resume & index speedup (scan cache skips unchanged `state.json` reads, O(1) session lookup via the session-index mapping, automatic `session_index.jsonl` compaction); #3778 finished subagent scopes move to an LRU cache (memory bounded on long sessions); #3892 workspace watcher flood fix; #3891/#3906 steer queue message pairing; #3840 Windows 8.3 short-path watch crash; #3887 session delete/archive occasionally never finishing; #3907 turn trace ids; #3837 chat transcript rebuilt after undo; #3911 compaction pre-shrinks history to the effective model window; #3750 configurable compaction attempt limit; #3787 managed-usage quota model; #3869 yolo mode approves unanalyzable bash commands; #3879 system prompt no longer bans paths outside the working directory; #3878 subagent tool menu hides unusable media tools with clearer Read errors; #3785 early error when `secondary_model.default_effort` is unsupported; #3752 tower roster identity conflicts; #3846 MCP 401 marks needs-auth; #3667 deferred MCP tool disclosure for official models; #3764 client metadata on prompts and skill activation; plus smaller batch ports (#3459-class fixes through #3749 auto session title GA).

*中文:*

1. 流式体验对齐 Kimi 桌面端:正在输出的正文末尾显示闪烁的打字机光标;思考块的标签在推理流式期间改为呼吸动画(1.6 秒透明度循环),不再转圈。两者都尊重系统「减少动态效果」设置
2. 目标模式修复:目标更新在对话里实时渲染;长对话下目标的取消/停止不再卡死弹窗;流式渲染更顺滑
3. 同步官方上游修复(MoonshotAI/kimi-code,截至九月中旬):#3889 大仓库会话恢复与索引提速(扫描缓存跳过未变更的 state.json、经会话索引映射 O(1) 定位会话、自动压缩 session_index.jsonl);#3778 已完成的子代理作用域改用 LRU 缓存(长会话内存有界);#3892 工作区监视器洪水修复;#3891/#3906 插队消息配对;#3840 Windows 8.3 短路径监听崩溃;#3887 会话删除/归档偶发卡死;#3837 撤销后重建对话记录;#3911 压缩前按模型实际窗口预裁剪历史;#3750 压缩重试次数可配置;#3787 托管用量配额模型;#3869 yolo 模式放行无法分析的 bash 命令;#3879 系统提示不再禁止工作目录外路径;#3878 子代理菜单隐藏不可用媒体工具;#3785 secondary_model.default_effort 不支持时提前报错;#3752 tower 名册身份冲突;#3846 MCP 401 标记需重新授权;#3667 官方模型的 MCP 工具延迟披露;#3764 提示词与技能激活携带客户端元数据;以及批次 0 等更早的小项(含 #3749 自动会话标题转正)

## 0.9.11(2026-09-14)

1. Re-release of 0.9.10 with a bumped version number to work around a silent marketplace upload rejection (no functional changes).

*中文:*

1. 0.9.10 内容不变,仅递增版本号重新发布,绕过市场网页端静默上传失败(无功能变更)

## 0.9.10(2026-09-14)

1. The file-changes pill in the top bar no longer shows inline `+N -N` line counts — it shows only the changed-file count (`[N] changes`), and hovering reveals the exact added/deleted lines.
2. Switching accounts no longer resets the session model to the account's first alphabetical alias: the switch now matches the current model id across accounts (e.g. staying on K3-256K instead of jumping back to K3), and the previous thinking effort is restored when the target model supports it.
3. Synced upstream fixes from MoonshotAI/kimi-code: #3459 stop-handoff steps & subagent `stop_reason`; #3734 discard a retried attempt's partial stream state (fixes duplicated/garbled text after retries); #3654 MCP structured tool results; #3649 HEIC/HEIF/BMP image support; #3652 image-format gating by provider capability; #3645 paged reads for large files; #3658 glob result pagination; #3688 MCP tool-result attachments; #3657 goal time budgets (partial — parts depending on upstream's pause-on-close lifecycle do not apply to this fork). Upstream #3697 (steer interrupts background waits) was reviewed and is not portable: it depends on upstream's machine/WaitFor layer that this fork does not have.

*中文:*

1. 顶部「变更」胶囊不再内联显示 `+N/-N` 行数,只显示变更数量(`[N]个变更`),鼠标悬停才显示具体增删行数
2. 切换账号不再把模型重置为该账号按字母序的第一个别名:现在按当前模型 id 跨账号匹配(例如保持 K3-256K,不再跳回 K3),目标模型支持时还会恢复原有思考强度
3. 同步官方上游修复(MoonshotAI/kimi-code):#3459 停止交接步骤与子代理 stop_reason;#3734 重试时作废上一段流式残留(修复重试后文本乱码/重复);#3654 MCP 结构化工具结果;#3649 支持 HEIC/HEIF/BMP 图片;#3652 按供应商能力做图片格式门控;#3645 大文件分页读取;#3658 glob 结果分页;#3688 MCP 工具结果附件;#3657 目标时间预算(部分移植——依赖上游「关闭时暂停」生命周期的部分本 fork 不适用)。#3697(插队打断后台等待)经评审不可移植:依赖本 fork 没有的上游 machine/WaitFor 层

## 0.9.9(2026-09-12)

1. Removed the legacy v1 engine rollback switch: the `kimifork.useAgentCoreV1` setting and the `KIMI_CODE_LEGACY_FLAG` env var are gone, the extension always runs the v2 engine, and engine startup errors no longer suggest rolling back. (The v1 harness package remains inside the SDK for session interop.)
2. New setting "Max thinking in plan mode" (default off): entering plan mode raises the session's thinking effort to the current model's highest supported level, and exiting plan mode (approve / revise / manual toggle) restores the previous effort — restored from session metadata even after a window reload mid-plan.

*中文:*

1. 移除 v1 旧引擎回退开关:`kimifork.useAgentCoreV1` 设置与 `KIMI_CODE_LEGACY_FLAG` 环境变量已删除,扩展固定运行 v2 引擎,启动失败的报错不再提示回退(SDK 内的 v1 包仍保留用于会话互通)
2. 新增设置项「计划模式最高思考强度」(默认关闭):进入计划模式时自动把思考强度提升到当前模型支持的最高档,退出计划模式(执行/拒绝/手动关闭)时恢复原有强度;窗口重载后退出计划模式也能从会话元数据中恢复

## 0.9.8(2026-09-12)

1. Plan review redesigned to match Claude Code: the plan is rendered inline in the approval dialog with full Markdown formatting (headings, bold, lists, tables, code highlighting) instead of auto-opening the raw `.md` source in a VS Code editor tab and falling back to unformatted plain text.
2. New setting "Open plan in editor" (default off): when enabled, a plan review also opens the plan document in VS Code as a rendered Markdown preview (`markdown.showPreview`, no longer the raw source). The approval dialog keeps a manual "Open in editor" link next to the plan path.

*中文:*

1. 计划审批界面参考 Claude Code 重做:计划正文在审批对话框内以完整 Markdown 格式渲染(标题/加粗/列表/表格/代码高亮),不再自动打开原始 `.md` 源码标签页、也不再退化为无格式纯文本
2. 新增设置项「在编辑器中打开计划」(默认关闭):开启后计划审批出现时自动在 VS Code 中以渲染预览(Markdown Preview,不再是源码)打开计划文档;审批对话框计划路径旁保留手动「在编辑器中打开」入口

## 0.9.7(2026-09-12)

1. Fixed queue "Insert now (steer)" silently dropping the message: the steer echo is no longer discarded when it lands outside a live step (e.g. between TurnBegin and StepBegin, or right after attaching to a busy session) — it now attaches to a created step or falls back to a plain user bubble, so steered text and images always show up in the conversation.
2. Queue "Insert now" failures are no longer silent: a rejected steer request surfaces an error toast and keeps the message in the queue instead of vanishing into an unhandled rejection.

*中文:*

1. 修复队列「立即插入(插队)」消息被静默丢弃:插队回显落在没有活动步骤的时间窗时(如 TurnBegin 与 StepBegin 之间、刚附着到忙碌会话时)不再丢弃——自动补建步骤或退化为普通用户气泡,插队的文字和图片都会显示在对话里
2. 队列「立即插入」失败不再静默:请求被拒绝时弹出错误提示,消息保留在队列中,不再沉入未处理的异常

## 0.9.6(2026-09-04)

1. Account Management dialog: the quota line now shows each window's reset countdown and exact reset timestamp on an always-visible line below it (no hover needed).
2. Settings menu account rows: the text quota ("5h 45% · 7d 12%") is replaced by the same concentric ring indicator as the composer status bar (outer ring = 5h, inner ring = 7d, same color rules); hovering the rings shows percent used and reset countdowns.
3. Settings menu account rows: the "default" badge and the current-account check moved to right after the account name, so the quota rings stay right-aligned across rows.

*中文:*

1. 账号管理弹窗:额度行下方新增一行常显的重置信息——各窗口的重置倒计时 + 精确重置时间(无需悬停)
2. 设置菜单账号行:文字额度(「5h 45% · 7d 12%」)改为与输入框状态栏一致的同心圆环(外环 5 小时、内环 7 天,颜色规则相同);悬停圆环显示已用百分比与重置倒计时
3. 设置菜单账号行:「默认」标签与当前账号对号移到账号名称后面,额度圆环保持右对齐

## 0.9.5(2026-09-03)

1. Synced from official upstream: queued prompts no longer get stuck after an interrupted session resumes — the prompt resolution events are now persisted to the session log, so a restored queue knows which entries were already settled (upstream PR #3371).
2. Synced from official upstream: dangerous bash commands (e.g. `rm -rf`, disk/format operations) now require approval in every permission mode, including YOLO — auto mode denies them outright, and non-interactive hosts skip the guard; it can be turned off via config (upstream PR #3290).
3. Synced from official upstream: the subagent secondary-model pool graduated out of experimental and is enabled by default — subagents resolve their model from `[secondary_model]` without any flag, and the bound model plus how it was chosen (forced / primary override / inherited / pool pick) is reported with each spawned subagent (upstream PR #3334).
4. Synced from official upstream: step retry and interrupt events are now persisted to the session wire log, so a resumed session preserves the retry/interrupt history of every step (upstream PR #3428; the fork's realtime retry-discard fix from 0.9.2 is unaffected and keeps working).

**⚠ Not yet synced from upstream (planned for a later release):** PR #3459 — a text-only handoff step after forced stops (repeat-breaker / step cap) so subagents report their stop reason and a resume hint to the parent agent. It depends on an upstream DI rework of the subagent lifecycle that this fork has not adopted yet; porting it is scheduled as its own round.

*中文:*

1. 同步官方上游:会话中断恢复后队列消息不再卡死——prompt 决议事件现已持久化到会话日志,恢复后的队列知道哪些条目已了结(官方 PR #3371)
2. 同步官方上游:危险 bash 命令(如 `rm -rf`、磁盘/格式化操作)在所有权限模式下都需批准,YOLO 模式也不例外——auto 模式直接拒绝,非交互宿主跳过守卫;可通过配置关闭(官方 PR #3290)
3. 同步官方上游:子代理次模型池从实验特性毕业、默认启用——子代理无需开关即从 `[secondary_model]` 解析模型,每个派生的子代理都会上报绑定的模型及其来源(强制/主模型指定/继承/池选)(官方 PR #3334)
4. 同步官方上游:步骤重试与中断事件现已持久化到会话 wire 日志,恢复的会话保留每个步骤的重试/中断历史(官方 PR #3428;0.9.2 的实时重试丢弃修复不受影响,继续生效)

**⚠ 暂未同步的官方更新(留待后续版本):** PR #3459——强制停止(重复熔断/步骤上限)后追加一个纯文本交接步骤,让子代理向主代理汇报停止原因和恢复提示。它依赖官方对子代理生命周期的 DI 重构,本 fork 尚未采用,将单独安排一轮移植。

## 0.9.4(2026-09-02)

1. Multiple official Kimi Code accounts can now be signed in at the same time: open Account Management from the composer menu to add accounts (full OAuth device flow inside VS Code), switch the active account per model pick, or log any of them out. The usage bar below the composer follows the account that owns the current model, showing its own 5-hour/7-day quota and reset times.
2. Account polish: account cards fall back to the Kimi logo when the profile avatar is missing or fails to load; each account gets an editable display name (pencil icon) and a star to mark it as the default account, which points the config's default model at that account so new sessions start on it.
3. Per-account quota at a glance: the settings menu lists every signed-in account as a secondary row under Account Management with its name and 5-hour/7-day usage, and the Account Management dialog shows the same usage line per account.
4. Third-party provider access (e.g. DeepSeek) now lives inside Account Management too — the custom provider form and list were extracted from the subagent model dialog into a shared section, so both entries manage the same providers.
5. Menu layout: Account Management moved below Compact Mode, separated by dividers; the bottom account row keeps only sign-in/out.
6. Right-click any of your own messages to edit or delete it. Both actions roll the conversation back to just before that message through the engine's conversation undo — the records stay in the session log but stop feeding the context. Edit refills the input box with the original text so you can adjust and resend (Doubao-style); deleting or editing while a response is streaming stops the generation first. The menu also keeps a "Copy message" entry, restoring the copy action the custom menu had displaced.
7. One-click account switching: clicking an account row in the settings menu switches this window's session to that account (session-level — the global default model is untouched), with a check marking the account this window is using. Different windows can now run on different accounts at the same time; clicking a signed-out account opens the management dialog to log in first.

Thanks [@firehot](https://github.com/firehot) for the ACP adaptation proposal in PR [#1](https://github.com/gxgleo67/kimi-code-vscode-fork/pull/1) — it inspired the multi-account work in this release.

*中文:*

1. 支持同时登录多个 Kimi Code 官方账号:从输入框菜单打开「账号管理」即可添加账号(VS Code 内完成 OAuth 设备码流程)、按模型切换当前账号或单独退出任一账号;输入框下方的额度条跟随当前模型所属账号,显示该账号的 5 小时/7 天额度与重置时间
2. 账号体验完善:头像缺失或加载失败时回落到 Kimi 默认头像;每个账号支持编辑显示名(铅笔图标),并可加星标设为默认账号——默认账号会把配置的默认模型指向它,新会话直接从该账号启动
3. 每账号额度一目了然:设置菜单在「账号管理」下以二级行列出每个已登录账号的名字和 5 小时/7 天用量,账号管理弹窗内同样逐账号显示额度
4. 第三方模型接口(如 DeepSeek)并入账号管理——自定义供应商表单和列表从子代理模型对话框抽成共享区块,两个入口管理同一份供应商
5. 菜单布局调整:「账号管理」移到「精简模式」下方并以分隔线划分,底部账号行只保留登录/退出
6. 右键点击自己发送的消息可修改或删除:两种操作都通过引擎的会话 undo 把对话回滚到该消息之前——记录仍保留在会话日志中,但不再参与上下文。修改会把原文填回输入框,改完重新发送即重新生成(豆包式);生成进行中执行删除/修改会先停止当前生成。菜单同时保留「复制消息」入口,找回被自定义菜单顶掉的复制操作
7. 一键切换账号:点设置菜单里的账号行即把当前窗口的会话切到该账号(会话级,不动全局默认模型),✓ 标记本窗口正在使用的账号——不同窗口现在可以同时各用各的账号;点未登录的账号则打开管理弹窗先登录

感谢 [@firehot](https://github.com/firehot) 在 PR [#1](https://github.com/gxgleo67/kimi-code-vscode-fork/pull/1) 中提供的 ACP 适配思路,本版本的多账号能力受此启发。

## 0.9.3(2026-08-31)

1. Queued messages show their images/videos as numbered chips (Image 1 / Video 1) in light blue, with a hover thumbnail preview — replacing the bare "+ media" marker.
2. Queue rows are roomier: larger message text, and the actions (steer / edit / move up / delete) now live in a dedicated right-side zone separated by a divider, always visible at 32px instead of hover-only 20px icons; the edit row grows to match.
3. Removed the fork's UI-level auto-compact toggle (a fixed 256K-token threshold firing /compact after a turn ended) — compaction is now left entirely to the engine's own auto-compaction (85% of the current model's context window, triggered mid-turn), matching upstream behavior; manual /compact is unaffected.

*中文:*

1. 队列消息中的图片/视频显示为淡蓝色编号标签(图片 1/视频 1),悬停弹出缩略图预览——取代原来的「+ 媒体」文字标记
2. 队列行排布加宽:消息文字调大,操作按钮(插队/修改/上移/删除)独立到竖线分隔的右侧区域,常显 32px 大按钮(原为悬停才出现的 20px 小图标);编辑行同步放大
3. 移除界面层的「自动压缩上下文」开关(原为回合结束后按固定 256K 阈值自动补发 /compact)——压缩完全交给引擎自身的自动压缩(按当前模型上下文窗口 85%、回合进行中触发),与官方行为对齐;手动 /compact 不受影响

## 0.9.2(2026-08-29)

1. Fix: subagents bound to a custom provider failed with "AnthropicChatProvider: apiKey is required" — the v2 engine silently dropped the `api_key_env_var` indirection the extension writes (a v1-only feature); the v2 provider schema, auth resolution, and the settings-page "configured" check now honor it.
2. Fix: garbled, self-repeating text after long unattended turns — a retryable mid-step error re-ran the step under a new number and re-streamed its text with no rollback marker, and the webview kept every copy; the failed attempt's partial step is now discarded as soon as the engine announces a retry (main agent and subagent steps alike).
3. Switching conversations no longer cancels a running turn: a busy session survives its last view detaching and keeps working in the background; it is reaped only after its work settles with no view re-attaching within 60 seconds.
4. Fix: switching back to a conversation that kept running in the background no longer loses everything generated while you were away — a kept-alive session replayed from a resume snapshot frozen at its first open; re-attaching now re-reads the wire log and replays the latest state.
5. The header now shows the current conversation's title next to the Kimi Code logo — resolved when a session loads and refreshed live when the LLM-generated title lands or the session is renamed.
6. The header status pill drops the context-usage percentage (the composer status row below already shows the context ring); it keeps the retry indicator and input/output token counts, and the session-details dialog still shows the context figure.
7. "Open in New Tab" no longer mirrors the conversation another window is showing: a newly created panel starts on the welcome screen (pick a history session or start fresh); the exemption is consumed on first mount, so later in-place reloads of that panel re-attach to its own session as before.
8. Reload re-attach now prefers the view's own attached session instead of the most recently opened one — with several windows open, each window reliably returns to its own conversation.
9. The mid-stream switch/new-conversation confirmation no longer claims the output will be truncated; it now says the task keeps running in the background and can be revisited from History.

*中文:*

1. 修复:绑定自定义供应商模型的子代理报 "AnthropicChatProvider: apiKey is required"——扩展写入配置的 api_key_env_var 间接引用(v1 特性)被 v2 引擎静默丢弃;v2 供应商 schema、密钥解析与设置页「已配置」判断现已支持该字段
2. 修复:无人值守长回合后文本乱码、整段自我重复——步骤中途遇可重试错误会以新步骤号重跑并重发已输出文本且没有回滚标记,webview 每份都保留;现引擎宣告重试时即丢弃失败 attempt 的残留步骤(主代理与子代理一致)
3. 切换会话不再中断进行中的回合:最后一个视图离开时忙碌的会话转后台继续运行,回合结束且 60 秒内无视图重挂才回收
4. 修复:切回后台继续运行的会话时,切走期间生成的内容全部丢失——保活的会话回放的是首次打开时冻结的快照;重附着现在现读 wire 日志、回放最新状态
5. 头部在 Kimi Code 标识右侧显示当前会话标题——加载会话时解析,LLM 标题生成或重命名后实时刷新
6. 头部状态胶囊移除上下文占比(下方输入区已有上下文圆环),保留重试指示与输入/输出 token 数;会话详情弹窗仍显示上下文数值
7. 「在新标签页打开」不再镜像其他窗口正在显示的会话:新建面板落在欢迎页(自行挑选历史会话或直接开新任务);免附着标记只在首次挂载生效,该面板之后原地重载仍正常重附着到自己的会话
8. 原地重载的重附着改为优先回到视图自己挂着的会话(原来取最近打开的会话),多窗口并行时各回各的对话
9. 生成中切换/新建对话的确认文案不再声称「将截断输出」,改为说明任务会在后台继续运行、可随时从历史记录切回

## 0.9.1(2026-08-28)

1. The marketplace description and this changelog now list English before Chinese.
2. The vsix filename carries the version number (`kimi-code-<version>-<target>.vsix`), so repeated packaging no longer overwrites the same file.

*中文:*

1. 商店介绍与更新日志改为英文在前、中文在后
2. vsix 产物文件名携带版本号(kimi-code-<版本号>-<平台>.vsix),多次打包不再互相覆盖

## 0.9.0(2026-08-28)

1. Fix: after re-attaching to a session mid-turn (window switch / panel reload), the send button now turns into Stop and the "processing" indicator stays — the history replay ends with the engine's busy announcement instead of unconditionally resetting the streaming state.
2. Fix: the todo list pill above the composer never appeared — the webview matched a stale tool name (SetTodoList) instead of the engine's actual TodoList, and the v2 engine's TodoList result carried no structured display payload (added, mirroring v1).
3. Fix two Windows-only issues in the manifest generators: backslash dynamic-import paths rejected by Node ESM, and flipped path separators in the generated metadata.

*中文:*

1. 修复:长回合中重附着会话(切窗口/重载面板)后发送按钮不变停止、「处理中」消失——历史回放末尾追加引擎忙闲宣告,加载不再无条件复位流式状态
2. 修复:输入框右上的待办列表从不显示——webview 匹配的工具名(SetTodoList)与引擎实际名(TodoList)不一致,且 v2 引擎的 TodoList 结果未携带结构化展示数据(已补齐,对齐 v1)
3. 修复 manifest 生成器在 Windows 下的两个问题:动态 import 反斜杠路径被拒、生成的清单元数据路径分隔符倒转

## 0.8.8(2026-08-28)

1. Synced upstream fix: resuming an interrupted session no longer crashes repeatedly — the agent lifecycle context stays active through scope teardown, and the session-close path awaits async teardown (#3206).
2. Synced upstream fix: corrupted session journals now self-heal — restore detects corrupted/truncated wire logs, truncates them to the valid prefix, and keeps a .bak backup instead of failing to resume (#3281).
3. Synced upstream fix: on resume, the model is told its previous-session background tasks were terminated — delivered as a single system-reminder injection with no auto-turn (#3292).
4. Synced upstream fix: stale "manually stopped" status after undo — undoing a turn now clears the turn outcome it describes (#3278).
5. Synced upstream fix: secondary-bound subagents now honor the default thinking effort — secondary_model.default_effort takes precedence (#3191).
6. Synced upstream fix: OAuth login no longer cancels itself when its own provisioning writes the provider (#3294).
7. Synced upstream fix: swarms get an independent [swarm] timeout_ms and no longer follow the subagent timeout (#3198).
8. Synced upstream fix: the task protocol carries run_in_background, so foreground subagents are no longer misreported as background tasks (#3239).

*中文:*

1. 同步官方修复:恢复被中断的会话不再反复崩溃——代理生命周期上下文在 scope 拆除期间保持激活,会话关闭路径等待异步拆除完成(#3206)
2. 同步官方修复:会话日志损坏自愈——恢复时检测到损坏/截断的 wire 日志,自动截断到有效前缀并保留 .bak 备份,不再导致会话无法恢复(#3281)
3. 同步官方修复:恢复会话时告知模型「之前的后台任务已被终止」——合并为一条 system-reminder 注入,不自动开新回合(#3292)
4. 同步官方修复:undo 后「手动停止」状态残留——undo 回卷对应回合时同步清除回合结果(#3278)
5. 同步官方修复:绑定 secondary 模型的子代理忽略默认思考强度——secondary_model.default_effort 现在优先生效(#3191)
6. 同步官方修复:OAuth 登录被自身 provisioning 写入误取消——自身写入不再终止登录流程(#3294)
7. 同步官方修复:swarm 独立 [swarm] timeout_ms 配置,不再跟随 subagent 超时(#3198)
8. 同步官方修复:任务协议携带 run_in_background,前台子代理不再被误报为后台任务(#3239)

## 0.8.7(2026-08-28)

1. Synced upstream fix: duplicate streaming renders from concurrently opening/re-attaching the same session are gone — view opens are now serialized (#3276).
2. Synced upstream fix: the v2 status snapshot now carries the contextUsage field, so SDK-side context-usage data is complete (#3098).
3. Synced upstream fix: a subagent's custom model (secondary_model) is no longer cascaded-overwritten by the engine's model pool (#3284).
4. Synced upstream fix: a thinking effort above the model's default tier now applies to the current session only, instead of being persisted as the model's default (#3205).
5. Synced upstream fix: MCP tool results no longer double-print when structuredContent duplicates the text content (#3234).
6. Synced upstream fix: the abort-listener ceiling is raised for bursts of parallel tool calls, so long turns no longer spam MaxListeners warnings (#3241).
7. Synced upstream fix: AskUserQuestion hides and rejects its background parameter when background questions are unavailable, preventing stuck subagent questions at peak hours (#3159).
8. Restored the upstream .gitattributes (forced LF checkouts), fixing engine test snapshot hash drift from CRLF tool-description files on Windows.
9. Fix: sent text silently returning to the composer mid-turn — the send RPC's 10-minute bridge timeout fired mid-turn and was misread as "never sent" rollback. The RPC no longer has a client-side timeout, and failures arriving after the handshake are treated as runtime errors that keep the exchange on screen.

*中文:*

1. 同步官方修复:同一会话并发打开/重附着导致的流式消息重复渲染,视图打开操作串行化后不再出现(#3276)
2. 同步官方修复:v2 状态快照补齐 contextUsage 字段,SDK 侧上下文用量数据完整(#3098)
3. 同步官方修复:子代理自定义模型(secondary_model)不再被引擎按模型池级联覆写(#3284)
4. 同步官方修复:思考强度超过模型默认档时仅当前会话生效,不再意外写成该模型的持久默认(#3205)
5. 同步官方修复:MCP 工具结果中 structuredContent 与正文重复时不再双倍输出(#3234)
6. 同步官方修复:并行工具调用集中触发时提升 abort 监听器上限,长回合不再刷 MaxListeners 警告(#3241)
7. 同步官方修复:不允许后台提问时 AskUserQuestion 隐藏并拒绝 background 参数,避免高峰期子代理问题卡死(#3159)
8. 补回上游 .gitattributes(强制 LF 检出),修复 Windows 下工具描述文件 CRLF 导致的引擎测试快照哈希漂移
9. 修复长回合进行中已发送文本莫名回到输入框:发送 RPC 的 10 分钟桥接超时在回合中途误触发并被误判为「未发送成功」回滚;现该 RPC 不再设客户端超时,握手完成后到达的失败按运行时错误保留现场,不再回填输入框

## 0.8.6(2026-08-26)

1. Every message now shows a timestamp (HH:mm today, date included across days); history replay keeps the original send times.
2. Fix the context-usage ring disappearing/freezing under the v2 engine: token-count-only status events are converted to a ratio, and re-entering a session announces the context snapshot.
3. The send-immediately shortcut moved from Shift+Enter to Alt+Enter; Shift+Enter is a newline again.
4. Fix failing saves when editing a subagent's custom provider: the engine expands `source` into a sub-table when rewriting the config, and re-saving without stripping the old sub-table caused a TOML redefinition error; an empty key with no stored key now asks you to re-enter it once.

*中文:*

1. 每条对话显示时间戳(今天显示时分,跨天带日期),历史回放保留原始发送时间
2. 修复 v2 引擎下上下文用量圆环消失/冻结:状态事件只有 token 数没有比例时自动换算;重新进入会话时状态播报补齐上下文快照
3. 立即发送快捷键由 Shift+Enter 改为 Alt+Enter,Shift+Enter 恢复换行
4. 修复编辑子代理自定义供应商保存失败:引擎重写配置把 source 展成子表后,再次保存未剥除旧子表导致 TOML 重定义报错;密钥留空且无已存密钥时改为明确提示重填一次

## 0.8.5(2026-08-25)

1. Send-immediately (Alt+Enter / queue ⚡) message bubbles now render images, not just text.
2. Queuing a message flashes the queue button instead of showing a top banner.
3. Engine errors follow the UI language: quota-exceeded / rate-limit / auth-failure cards and toasts are localized, with the original text kept in the detail line.

*中文:*

1. 立即发送(Alt+Enter / 队列 ⚡)的消息气泡正常显示图片,不再只见文字
2. 消息加入队列时队列按钮闪烁提醒动画,不再弹顶部横幅
3. 引擎报错按界面语言显示:额度不足/限流/认证失败等卡片与提醒已汉化,原文保留在详情行

## 0.8.2~0.8.4(2026-08-24)

1. The extension now opens on the home page instead of auto-restoring the last conversation.
2. Alt+Enter sends immediately: mid-turn it steers the message straight into the running turn (no queue); idle it behaves like a normal send; steered messages appear inline at once.
3. Switching the permission mode no longer pops a top banner; Shift+Tab cycles permission modes (confirm each → auto-approve → full autonomy), scoped to the extension window only.
4. A failed settings-toggle save now rolls back with an error toast instead of being silently lost.
5. New "compact mode" toggle: composer buttons collapse to icons at any width; the model name and thinking effort are never truncated; the toolbar collapses progressively in narrow widths (full → icons → ⋯ menu).
6. The Retry button is removed from error cards — re-enter the command in the composer after a failure.

*中文:*

1. 每次打开插件默认从首页开始,不再自动恢复上次对话
2. Alt+Enter 立即发送:任务进行中直接把消息插入当前回合(不经过排队),空闲时等同普通发送;插入的消息以行内气泡即时显示
3. 切换权限模式不再弹顶部提示窗;新增 Shift+Tab 循环切换权限模式(逐条确认 → 自动通过 → 完全自主),仅插件窗口内生效
4. 设置开关保存失败时回滚并弹错提示,不再静默丢失
5. 「精简模式」开关:输入框按钮任意宽度下图标化;模型名称与思考强度永不截断;窄宽度下工具栏自动折叠(完整 → 图标 → ⋯ 菜单)
6. 错误卡片移除「重试」按钮,报错后在输入框手动重输指令

## 0.8.0~0.8.1(2026-08-21)

1. Fix the current conversation vanishing after a window switch or reload: in-place reloads re-attach to the live session and replay it, restoring the streaming state of a running turn.
2. Fix retries losing the pre-interrupt thinking display — interrupted turns with content are kept as history.
3. Subagent providers can now be edited after saving (leave the key blank to keep it).
4. Plan files now open in the VS Code editor for review, and the plan output injects document-formatting guidance for readability.
5. Fix the model pick being snapped back to the old model by status announcements after entering plan mode.
6. Synced 11 upstream engine/extension fixes from official 0.37.1~0.38.0; multi-select questions in the question dialog now use checkboxes with a submit button.

*中文:*

1. 修复切窗或重载后当前对话从界面消失:窗口内重载自动重附着会话并回放,进行中回合恢复流式状态
2. 修复重发请求丢失中断前的思考记录显示,有内容的中断轮次保留为历史
3. 子代理供应商支持编辑已保存项(密钥留空保持不变)
4. 计划文件改为在 VS Code 编辑器中打开审查;计划输出注入文档编排格式更易读
5. 修复切换计划模式后模型选择被状态播报打回旧模型
6. 同步官方 0.37.1~0.38.0 共 11 项引擎/扩展修复;提问对话框多选题改为勾选 + 提交

## 0.7.2(2026-08-20)

1. Subagent cards show a third-party model badge (subagents following the main model stay unmarked).
2. Quota lookups always connect directly, bypassing the system proxy.
3. Messages sent mid-run are queued automatically and delivered in order when the turn ends; the queue button highlights blue while the queue is non-empty.
4. The todo pill is renamed to "current progress (done/total)".
5. Picking a history entry now collapses the list immediately.

*中文:*

1. 子代理卡片显示第三方模型徽标(跟随主模型不标记)
2. 额度查询固定直连、绕过系统代理
3. 运行中发消息自动排队、回合结束按序补发;有排队时队列按钮蓝色高亮
4. 待办胶囊更名「当前进度 done/total」
5. 历史记录点选后立即收起列表

## 0.7.1(2026-08-19)

1. KIMI-eyes loading animation plus a frosted centered loading block (history / session list / context viewer).
2. Subagents can bind their own model/provider to offload peak-hour traffic.
3. The /compact marker is now a single expandable line.
4. Fix broken images in history (engine blobref references are resolved on demand).
5. Fix the last exchange vanishing from the UI when retrying after quota exhaustion.

*中文:*

1. KIMI 眼睛加载动画 + 毛玻璃居中加载模块(历史 / 会话列表 / 上下文查看器)
2. 子代理可绑定独立模型/供应商,高峰期分流
3. /compact 压缩标记改为单行可展开
4. 修复历史对话图片裂开(引擎 blobref 引用按需解析)
5. 修复额度用尽后重试导致最后一轮对话从界面消失

## 0.7.0(2026-08-18)

1. AI-generated session summary titles (manually renamed sessions are never overwritten).
2. The mode toggle splits into three side-by-side buttons — Plan / Goal / Swarm — with hover descriptions; an active goal can be paused / resumed / cancelled.
3. The attachment paperclip opens the file picker directly instead of writing @ into the composer.
4. Clicking the context ring compacts the context immediately.
5. The context viewer refreshes on open; status pills reflect this conversation's own usage.
6. Opening a history conversation shows a loading animation and jumps straight to the latest message.
7. Toggle controls are unified: on = blue, off = gray.

*中文:*

1. AI 自动生成会话摘要标题(已手动命名不覆盖)
2. 模式开关拆分为 计划 / 目标 / Swarm 三个并排按钮,说明悬浮显示;目标激活可暂停 / 继续 / 取消
3. 附件曲别针点击直接打开文件选择器,不再向输入框写入 @
4. 上下文圆环点击直接压缩上下文
5. 上下文查看器打开自动刷新;状态行胶囊按本对话使用情况显示
6. 打开历史对话显示加载动画并直达最新消息
7. 开关控件统一:开 = 蓝色,关 = 灰色
