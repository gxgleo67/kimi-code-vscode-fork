# Changelog

> This file tracks only the fork's own releases, numbered independently. For upstream Kimi Code releases, see [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code/blob/main/apps/vscode/CHANGELOG.md).
>
> *中文:* 本文件只记录本 fork(Kimi Code (Fork))自身的更新,版本号独立编号。官方上游的更新记录请见 [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code/blob/main/apps/vscode/CHANGELOG.md)。

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
4. Clicking the context ring compacts the context immediately; optional setting: auto-compact above 256K.
5. The context viewer refreshes on open; status pills reflect this conversation's own usage.
6. Opening a history conversation shows a loading animation and jumps straight to the latest message.
7. Toggle controls are unified: on = blue, off = gray.

*中文:*

1. AI 自动生成会话摘要标题(已手动命名不覆盖)
2. 模式开关拆分为 计划 / 目标 / Swarm 三个并排按钮,说明悬浮显示;目标激活可暂停 / 继续 / 取消
3. 附件曲别针点击直接打开文件选择器,不再向输入框写入 @
4. 上下文圆环点击直接压缩上下文;可选设置:上下文超 256K 自动压缩
5. 上下文查看器打开自动刷新;状态行胶囊按本对话使用情况显示
6. 打开历史对话显示加载动画并直达最新消息
7. 开关控件统一:开 = 蓝色,关 = 灰色
