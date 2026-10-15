# Changelog

> This file tracks only the fork's own releases, numbered independently. For upstream Kimi Code releases, see [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code/blob/main/apps/vscode/CHANGELOG.md).
>
> *中文:* 本文件只记录本 fork(Kimi Code (Fork))自身的更新,版本号独立编号。官方上游的更新记录请见 [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code/blob/main/apps/vscode/CHANGELOG.md)。

## 0.9.23(2026-10-15)

1. Synced upstream engine fixes through CLI 2.2.0 (#4230): media tools (image/video reading) are available again after resuming a session, and cancelling a turn now aborts in-flight video uploads instead of letting them run in the background.
2. Sub-agents: lifecycle events are persisted so swarm members survive a window reload; forking a session no longer inherits the source session's cron tasks (a one-time notice appears when any were cleared); forked sessions inherit the source's title behavior; forked sub-agent requests keep the exact same prompt prefix as the parent so provider prompt caching actually hits, with a new cache-parity probe in telemetry.
3. Conversation: undoing a turn also removes the "interrupted" reminder it left behind; UserPromptSubmit hook output is folded into your prompt message instead of appearing as a separate message; permission-mode changes are pushed to the panel immediately.
4. Models: Gemini 4 models use thinking levels — effort "off" now fails fast with a clear error (Gemini 4 cannot disable thinking) instead of failing every request with HTTP 400; the completion-token cap is omitted unless explicitly configured; new `KIMI_CODE_LLM_HEADERS_TIMEOUT_MS` env var for the LLM headers timeout.
5. Config: new `auto_session_title` option (default on) to toggle LLM-generated session titles; new `KIMI_CODE_REPEAT_BREAKER` env switch for the repeated-tool-call breaker; MCP OAuth requests `offline_access` when the server advertises it, so MCP logins stay alive longer.
6. The send-now shortcut moved from `Alt+Enter` to the more universal `Ctrl/Cmd+Enter` (idle behavior is unchanged; if "Ctrl+Enter to send" is enabled, Ctrl+Enter still simply sends).
7. Marketplace description rewritten; the README is reorganized around the fork's current positioning — an official-sync bundle with extra customization — and drops claims about issues upstream has since fixed; the changelog no longer ships on the extension details page.

*中文:*

1. 同步官方至 CLI 2.2.0(#4230)的引擎修复:恢复会话后媒体工具(读图/视频)重新可用;中断回合时会同时取消进行中的视频上传,不再后台跑完
2. 子代理:生命周期事件持久化,窗口重载后 swarm 成员不丢失;fork 会话不再继承源会话的 cron 定时任务(有清理时一次性提醒);fork 会话继承源会话的标题行为;fork 子代理请求前缀与父代理完全一致,prompt 缓存真正命中,并新增缓存一致性探针遥测
3. 对话:撤销回合时连同「已打断」提醒一起移除;UserPromptSubmit 钩子输出折进你的 prompt 消息,不再单独成条;权限模式变化即时推送到面板
4. 模型:Gemini 4 改用 thinkingLevel——「关闭思考」会立即报明确的错(Gemini 4 无法关闭思考),不再每个请求都 400;未显式配置时不再发送 completion token 上限;新增 `KIMI_CODE_LLM_HEADERS_TIMEOUT_MS` 环境变量配置 LLM 响应头超时
5. 配置:新增 `auto_session_title` 开关(默认开)控制 LLM 自动生成会话标题;新增 `KIMI_CODE_REPEAT_BREAKER` 环境开关控制重复工具调用熔断;MCP OAuth 在服务端支持时请求 `offline_access`,登录态更持久
6. 立即发送快捷键由 `Alt+Enter` 改为更通用的 `Ctrl/Cmd+Enter`(空闲时行为不变;若开启了「Ctrl+Enter 发送」,Ctrl+Enter 仍是普通发送)
7. 商店介绍重写;README 按当前定位重新整理(官方同步集合体 + 更多可自定义权限),删掉官方已修复问题的相关表述;更新记录不再随插件详情页展示

## 0.9.22(2026-09-20)

1. Fixed a full-panel crash introduced in 0.9.20: the settings menu's account quota rows still called the quota-ring component with its old props, so once an account's quota loaded successfully, rendering threw and the whole webview went blank until VS Code was restarted. The menu now uses the new props (with the same weekly/monthly adaptation and plan name as the status bar).
2. The build now runs `tsc --noEmit` over both the extension host and the webview before bundling (`pnpm build` includes `typecheck`), so a props mismatch like this fails the build instead of shipping as a runtime crash.

*中文:*

1. 修复 0.9.20 引入的整个面板崩溃:设置菜单里的账号额度行仍按旧参数调用额度环组件,账号额度一旦加载成功,渲染就会抛异常导致整个 webview 白屏,只能重启 VS Code。菜单已改用新参数(与状态栏一致的 7 天/月度自适应和套餐名)
2. 构建流程在打包前新增 `tsc --noEmit` 类型检查(宿主 + webview,`pnpm build` 内含 `typecheck`),这类参数不匹配以后直接构建失败,不会再以运行时崩溃的形式流出

## 0.9.21(2026-09-20)

1. The account manager now supports manual ordering: each account row has up/down buttons, the arrangement is persisted across restarts, and accounts added later append at the end until you move them.

*中文:*

1. 账号管理支持手动排序:每个账号行新增上移/下移按钮,顺序跨重启保留;新登录的账号默认排在末尾,可再手动调整

## 0.9.20(2026-09-20)

1. The quota indicator adapts to the new plans without a weekly cap: when the platform reports no 7-day window, the inner ring and its tooltip switch to the monthly quota (code window first, total as fallback). Classic plans keep the 7-day ring unchanged.
2. The usage tooltip now shows the subscription plan name (e.g. Allegretto / Pro) from the account's user info; the plan-name lookup is best-effort and never blocks or fails the quota fetch.

*中文:*

1. 额度指示适配没有 7 天上限的新套餐:平台不再返回 7 天窗口时,内圈和悬浮提示自动切换为月度额度(优先 Code 窗口,缺省回退月度总额);老套餐的 7 天环显示不变
2. 用量悬浮提示顶部新增套餐名(如 Allegretto / Pro),取自账号用户信息;套餐名查询失败不影响额度显示

## 0.9.19(2026-09-20)

1. Brand refresh: the logo tile is now always black (previously white on dark themes) everywhere it appears — header, chat avatars, account dialog.
2. The welcome screen's static square banner is replaced by a round, animated brand logo (idle eye motion, blink, gentle bob) next to a KIMI CODE wordmark; honors "reduced motion".

*中文:*

1. 品牌更新:logo 底色统一为黑色(此前深色主题下为白色),覆盖顶栏、对话头像、账号弹窗等所有出现位置
2. 欢迎页的静态方形横幅换成圆形动态品牌 Logo(眼睛自动巡视/眨眼 + 轻微漂浮),旁边配 KIMI CODE 文字标;尊重系统「减少动态效果」设置

## 历史版本(0.9.18 及更早)| Earlier releases (0.9.18 and earlier)

| 版本 | 日期 | 摘要 |
| --- | --- | --- |
| 0.9.18 | 2026-09-20 | 品牌同步:README 头图换新,无功能变化。Brand sync only; new README hero image |
| 0.9.16 | 2026-09-20 | 桌面端品牌 Logo + 眨眼彩蛋 + 市场图标;移除 Rive 运行时,动画全面纯 CSS/SVG(webview 减小约 8MB)。Desktop brand logo + blink easter egg; Rive removed, all animations pure CSS/SVG |
| 0.9.15 | 2026-09-20 | 工作指示器改为桌面端同款纯 CSS Kimi 小脸。Desktop-style pure-CSS Kimi-face working indicator |
| 0.9.14 | 2026-09-20 | 桌面端吉祥物工作指示(Rive,已被 0.9.15 替换);助手头像圆角。Desktop mascot indicator (superseded by 0.9.15); rounded assistant avatar |
| 0.9.13 | 2026-09-20 | 修复失效 secondary_model 别名导致所有对话打不开。Fixed stale secondary_model aliases blocking every conversation |
| 0.9.12 | 2026-09-20 | 桌面端流式动效(打字机光标/思考呼吸);目标模式修复;同步官方 20+ 修复(#3889/#3778/#3911 等)。Desktop streaming motion; goal-mode fixes; 20+ upstream fixes |
| 0.9.11 | 2026-09-14 | 重新发布,无功能变更。Re-release, no functional changes |
| 0.9.10 | 2026-09-14 | 变更胶囊悬停显示增删行;切账号保持当前模型;同步官方 #3459/#3734 等。Changes-pill hover details; account switch keeps the model; upstream #3459/#3734 etc. |
| 0.9.9 | 2026-09-12 | 移除 v1 引擎回退开关;新增「计划模式最高思考强度」设置。v1 engine fallback removed; max-thinking-in-plan-mode setting |
| 0.9.8 | 2026-09-12 | 计划审批界面重做(Claude Code 风格 Markdown 渲染);「在编辑器中打开计划」设置。Plan review redesigned (in-dialog Markdown); open-plan-in-editor setting |
| 0.9.7 | 2026-09-12 | 修复插队消息被静默丢弃;插队失败弹错并保留队列。Fixed steered messages silently dropped; steer failures surface an error |
| 0.9.6 | 2026-09-04 | 账号管理常显重置倒计时;设置菜单账号行额度圆环。Always-on reset countdowns; quota rings in settings account rows |
| 0.9.5 | 2026-09-03 | 官方同步 #3371/#3290/#3334/#3428。Upstream sync #3371/#3290/#3334/#3428 |
| 0.9.4 | 2026-09-02 | 右键修改/删除自己的消息;多账号同时登录与一键切换;第三方供应商并入账号管理。Edit/delete your own messages; multi-account sign-in & one-click switching; providers in Account Management |
| 0.9.3 | 2026-08-31 | 队列媒体编号标签与加大操作按钮;移除界面层自动压缩开关。Queue media chips & larger actions; UI auto-compact toggle removed |
| 0.9.2 | 2026-08-29 | 修复自定义供应商 apiKey 缺失;重试残留乱码;切会话后台保活 + 重附着回放最新状态。Custom-provider apiKey fix; retry garbling fix; background keep-alive & latest-state replay |
| 0.9.1 | 2026-08-28 | 商店介绍改为英前中后;vsix 文件名带版本号。English-first description; versioned vsix filenames |
| 0.9.0 | 2026-08-28 | 重附着后发送按钮/处理中状态恢复;待办胶囊显示修复。Send-button/streaming state restored on re-attach; todo pill fix |
| 0.8.8 | 2026-08-28 | 官方同步 #3206/#3281/#3292/#3278/#3191/#3294/#3198/#3239。Upstream sync batch |
| 0.8.7 | 2026-08-28 | 官方同步 #3276/#3098/#3284 等;修复长回合已发送文本回流输入框。Upstream sync; fixed sent text flowing back into the composer |
| 0.8.6 | 2026-08-26 | 消息时间戳;上下文圆环修复;立即发送改为 Alt+Enter(0.9.23 起为 Ctrl+Enter);供应商保存修复。Message timestamps; context ring fix; send-now moved to Alt+Enter |
| 0.8.5 | 2026-08-25 | 插队气泡显示图片;队列按钮闪烁提醒;引擎报错汉化。Steered bubbles render images; queue button flash; localized engine errors |
| 0.8.2~0.8.4 | 2026-08-24 | 默认首页;Alt+Enter 立即发送;Shift+Tab 切权限模式;精简模式。Home page by default; Alt+Enter send-now; Shift+Tab permission cycling; compact mode |
| 0.8.0~0.8.1 | 2026-08-21 | 切窗/重载会话恢复;中断轮次保留历史;同步官方 0.37.1~0.38.0 共 11 项。Session restore on reload; interrupted turns kept; 11 upstream fixes |
| 0.7.2 | 2026-08-20 | 子代理模型徽标;额度直连;运行中消息自动排队。Subagent model badges; direct quota lookups; mid-run queueing |
| 0.7.1 | 2026-08-19 | Kimi 眼睛加载动画;子代理独立模型;/compact 单行标记。Kimi-eyes loading; dedicated subagent models; single-line /compact marker |
| 0.7.0 | 2026-08-18 | AI 会话标题;计划/目标/Swarm 模式按钮;上下文圆环点击压缩。AI session titles; Plan/Goal/Swarm buttons; click-to-compact context ring |
