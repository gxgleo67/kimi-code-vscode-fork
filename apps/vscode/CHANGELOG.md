# Changelog

> **Fork 定制说明**:本文件的官方部分保留原版更新记录;本 fork 的定制功能以日期小节追加在下方,完整功能清单见根目录 [README.md](../README.md)。

## Fork 定制

### 2026-08-21

- 同步官方引擎/扩展 bug 修复(0.37.1 ~ 0.38.0 及 main 未发布项,不含行为变更与新功能):
- 粘贴图片首次发送不再丢失:legacy video resolver 不再遮蔽 media resolver(#3053)
- 第三方模型:OpenAI 兼容供应商带工具调用不再报 422(assistant 消息空文本发 null content,#3052)
- 后台子代理:spawned 事件改到任务注册后发射,刚出现即可停止、启动失败不再残留行(#3005;上游 #3134 的重复事件问题随之不存在)
- config.toml 有语法错误或被外部编辑时不再丢失条目(#3121)
- Windows:Git Bash POSIX 路径(/c/... 等)可被文件工具正确解析(#2200)
- 需登录的远程 MCP 无论就绪时序都注册 authenticate 工具(#3083)
- 被供应商内容过滤拦截时立即显示提示,不再反复重试(#3101)
- 非多模态模型遇到图片/二进制时不再被告知可用 ReadMediaFile(#3046,仅源码;测试文件随上游重构另行同步)
- 提问对话框:多选问题选中一项不再自动跳下一题,改为勾选 + 提交/下一题按钮(官方 #3079,已融合 fork 的 i18n)
- 会话关闭/归档/退出时排空在途持久化与日志写入,降低记录丢失风险(#3122)

### 2026-08-20

- 子代理卡片:使用第三方模型的子代理在卡片尾部显示紫色模型名徽标,跟随主模型的不标记(实时与历史回放均生效)
- 额度查询直连:额度圆圈请求固定走直连 dispatcher,不再被系统代理/环境变量代理劫持导致偶发查询失败(仅 /usages 查询链路,其余请求行为不变)
- 待办胶囊更名「当前进度 done/total」,对齐 Kimi Web 样式
- 历史记录:点击会话标题立即收起列表弹层,不再挂在加载遮罩上(原为加载完成后才关闭)
- 队列胶囊蓝色高亮:有排队消息时蓝底凸显
- 修复引擎忙时发送消息弹错并丢失的问题:视图订阅/进入会话时同步引擎忙闲(turn_active),忙时发送直接入队;仍撞上"already being generated"拒绝的在途消息插回队首并提示已入队,回合结束后自动按序发出

### 2026-08-19

- 加载动画:接入 Kimi Code web 同款的 KIMI 眼睛徽章动画(眨眼 + 左右看 + 弹入),历史对话加载 / 会话列表 / 上下文查看器统一为居中的毛玻璃加载模块
- 用量状态条:上下文圆环可点击,直接发送 /compact 压缩上下文(目标模式 armed 时拦截提示)
- 修复运行中发送消息的排队逻辑;窄宽度下输入框工具栏折叠
- 修复额度用尽后点「重试」导致最后一轮对话从界面消失:重试不再提前删除原「问题 + 错误」,引擎确认接受(TurnBegin)后才替换;重试再失败现场原样保留(引擎侧数据始终安全,纯显示层问题)

### 2026-08-18

- 模式开关拆分为三个并排按钮:计划 / 目标 / Swarm(替代原"模式"下拉菜单),说明文案改为悬浮 tooltip;目标激活时点击弹出 暂停 / 继续 / 取消 控制
- 附件按钮(曲别针):点击后直接打开文件选择器,不再向输入框写入 @,取消选择不再残留字符
- 修复任务停止 / 压缩进行中发送消息被引擎拒绝("already being generated")导致消息丢失并弹错误提示的问题:这些窗口期内的发送现在一律进入队列,随回合结束自动发出
- AI 会话标题:回合完成后自动调用引擎的 managed 标题服务生成 LLM 摘要标题(自动开启 `auto_session_title` 实验开关;仅 v2 引擎 + Kimi Code 订阅登录生效;已手动重命名或已生成的标题不会被覆盖,对应官方 CLI 0.36.1 的实验性同名功能)
- Plan 审批:计划完成时先在 VS Code 编辑器打开计划文件,再弹出 执行 / Revise / 拒绝 确认窗
- 新增 `kimifork.autoCompactContext` 设置(默认关闭):任务结束后上下文超过 256K 自动执行 /compact;设置菜单一键开关(语言设置下方)
- /compact 压缩标记:Claude Code 风格单行记录(● 上下文已压缩 · 手动/自动 · 释放 XXk tokens),点击展开压缩摘要,聊天历史保持原样不再重建
- 修复历史对话图片裂开:引擎把图片存为 blobref 引用,回放时按需解析为 data URI(缩略图 / 大图预览 / 流式图片),20MB 上限 + 缓存
- 上下文查看器:打开时自动刷新
- 状态行布局:队列 / 文件修改固定左侧;后台 Bash / 子 Agent / 待办 / 上下文查看器居右,且仅在本对话调用过后显示
- 打开历史对话:显示加载遮罩,完成后直接定位到最新消息(去除滚动动画)
- 开关控件:开 = 蓝色,关 = 灰色

## 0.7.0

### Minor Changes

- [#2916](https://github.com/MoonshotAI/kimi-code/pull/2916) [`7475c2e`](https://github.com/MoonshotAI/kimi-code/commit/7475c2e2e3dd86ac0b8a8d51d4f1d233ed7df797) Thanks [@Grapedge](https://github.com/Grapedge)! - Run the extension on the v2 agent engine by default; the interface, sessions, and workflows are unchanged. To roll back, enable the `kimi.useAgentCoreV1` setting and reload the window.

### Patch Changes

- Updated dependencies [[`6be2697`](https://github.com/MoonshotAI/kimi-code/commit/6be26978b123bacf1c5ebce52bbeb6f7b7ff0629), [`7475c2e`](https://github.com/MoonshotAI/kimi-code/commit/7475c2e2e3dd86ac0b8a8d51d4f1d233ed7df797), [`7475c2e`](https://github.com/MoonshotAI/kimi-code/commit/7475c2e2e3dd86ac0b8a8d51d4f1d233ed7df797), [`7475c2e`](https://github.com/MoonshotAI/kimi-code/commit/7475c2e2e3dd86ac0b8a8d51d4f1d233ed7df797)]:
  - @moonshot-ai/kimi-code-sdk@0.18.0

## 0.6.9

### Patch Changes

- Updated dependencies [[`c9bfe8b`](https://github.com/MoonshotAI/kimi-code/commit/c9bfe8b2c8314ba4ef8806fb3b92ac654c1d1860), [`c212ae9`](https://github.com/MoonshotAI/kimi-code/commit/c212ae9715371c0d7939c15e664acbe0d7cf7fc3)]:
  - @moonshot-ai/kimi-code-sdk@0.17.0

## 0.6.8

### Patch Changes

- Updated dependencies [[`437a1b8`](https://github.com/MoonshotAI/kimi-code/commit/437a1b8ba1b7e0f6662bdadc669564fdc58c3f5a), [`0b2e803`](https://github.com/MoonshotAI/kimi-code/commit/0b2e803d5e71afaab45212bb2ee6117ecbf8bbc9), [`3c9e3b2`](https://github.com/MoonshotAI/kimi-code/commit/3c9e3b297cf5286c761159c1b4d642c478fd394d)]:
  - @moonshot-ai/kimi-code-sdk@0.16.0

## 0.6.7

### Patch Changes

- [#2326](https://github.com/MoonshotAI/kimi-code/pull/2326) [`302b2cd`](https://github.com/MoonshotAI/kimi-code/commit/302b2cd680e0ec66f68b4572238de84ce311c5f4) Thanks [@gaoyuan1223m](https://github.com/gaoyuan1223m)! - Fix only the first question being answerable when the agent asked multiple questions at once; each question is now answered one by one and submitted together.

## 0.6.6

### Patch Changes

- [#2393](https://github.com/MoonshotAI/kimi-code/pull/2393) [`6d0a046`](https://github.com/MoonshotAI/kimi-code/commit/6d0a046488edda56219961b253c4787abae7a113) Thanks [@wbxl2000](https://github.com/wbxl2000)! - Fix new users getting stranded on "Model setup required" with no way back to sign-in when the first login finishes authorization but fails to complete model setup; the screen now offers a path back to the sign-in page so login can be retried.
- [#2402](https://github.com/MoonshotAI/kimi-code/pull/2402) [`0f3b106`](https://github.com/MoonshotAI/kimi-code/commit/0f3b106c4260ad626f66bc5c457a535d3163f2bc) Thanks [@wbxl2000](https://github.com/wbxl2000)! - Reword the sign-in waiting message from "Waiting for authorization" to "Waiting for authentication".

- Updated dependencies [[`40172c7`](https://github.com/MoonshotAI/kimi-code/commit/40172c7ca96ca981b043b793588dd32e898979fa)]:
  - @moonshot-ai/kimi-code-sdk@0.15.0

## 0.6.5

### Patch Changes

- [#1994](https://github.com/MoonshotAI/kimi-code/pull/1994) [`beeb964`](https://github.com/MoonshotAI/kimi-code/commit/beeb964393c8f9a38c2b1e2273e4415fc434b16d) Thanks [@RealKai42](https://github.com/RealKai42)! - Reduce webview streaming re-render churn: settled assistant messages no longer re-render on every streaming delta, and local images over 10MB are no longer inlined into the webview DOM.
- Updated dependencies [[`ec88d35`](https://github.com/MoonshotAI/kimi-code/commit/ec88d352e8f4dc5e8ffd1212f016138458f69893), [`b5efba7`](https://github.com/MoonshotAI/kimi-code/commit/b5efba7abcaf4041f81ec520097a61e6546e8c50), [`ce0e3ce`](https://github.com/MoonshotAI/kimi-code/commit/ce0e3ceb04223bdaad8e8931bad46eff561055b6), [`e458323`](https://github.com/MoonshotAI/kimi-code/commit/e45832398d0d9cad98dbad1cbf1e5b103a20aace)]:
  - @moonshot-ai/kimi-code-sdk@0.14.0

## 0.6.4

### Changed

- Picking a model's highest thinking effort now applies to the current session
  only instead of becoming the global default: the top tier saves just the
  on/off toggle, lower tiers persist as the default as before, and
  re-confirming the current effort no longer rewrites the saved preference.
  The model and thinking pickers also note that switching mid-conversation
  invalidates the existing prompt cache.
- Unified the YOLO and Auto permission mode naming and descriptions with the
  CLI (`/afk` is now `/auto`), and approval requests that fall outside the
  active permission mode (sensitive files, plan reviews, ask rules) are now
  always shown to you instead of being auto-approved.

## 0.6.3

### Fixed

- Editor mentions now work for files outside the working directory, and paths
  containing spaces are quoted correctly.
- Cancelling a running turn now reliably reaches the engine, and the UI no
  longer reports a task as stopped when there is nothing to cancel.
- Attaching to or resuming an existing session no longer overwrites its model
  and thinking effort with the configured defaults; model or effort changes
  picked in the composer are applied when the prompt is sent.

## 0.6.2

### Fixed

- A core error arriving in the middle of a turn no longer corrupts the active
  turn; the turn now ends cleanly with an error instead of leaving the chat in
  a broken state.
- Kimi sign-in and connection failures now include the underlying transport
  cause (for example DNS or connection refused) instead of a generic error.
- Closed several FetchURL SSRF bypasses and the DNS-rebinding window.
- Tool calls interrupted mid-stream are now recorded and closed, so they no
  longer corrupt the session history.

## 0.6.1

### Fixed

- The **Sign in** action in the settings (gear) menu now actually starts the
  Kimi login flow and shows an error toast when sign-in fails, instead of
  silently doing nothing.

## 0.6.0

### Breaking

- Raised the minimum supported editor version to VS Code 1.100.0.
- Legacy Kimi Code OAuth credentials and MCP OAuth credentials are deliberately
  not migrated. Sign in to Kimi Code again and re-authorize affected MCP
  servers after upgrading.
- Removed the `kimi.executablePath` and `kimi.environmentVariables` settings.
  The old `kimi.environmentVariables.KIMI_SHARE_DIR` value is consulted only to
  discover legacy data during migration; it is not applied to the new runtime.
  The system-level `KIMI_CODE_HOME` environment variable remains supported.

### Changed

- Replaced the legacy Python/stdio runtime with the in-process Kimi Code Node
  SDK. The extension no longer downloads or starts a separate Kimi executable.
- The in-process engine is the same one that powers the Kimi Code CLI, so the
  agent gains CLI-parity capabilities beyond the legacy runtime, including
  parallel subagent swarms, background tasks, and long-running goal runs.
- Added an opt-in legacy migration prompt on the first launch that detects data
  from version 0.5.x. The migration copies or merges supported data into the
  current Kimi Code home and does not delete the legacy source. If migration is
  skipped or needs to be retried, run **Kimi Code: Migrate Legacy Data** from the
  Command Palette.
- When VS Code and the Kimi Code terminal app resolve to the same
  `KIMI_CODE_HOME`, they use the same configuration and session storage. Running
  the same session concurrently from multiple processes is not supported or
  protected by cross-process locking.
- The model picker groups models by provider when multiple providers are
  configured, keeps provider identity when display names match, and recognizes
  adaptive-thinking metadata. A configured custom default provider no longer
  requires dismissing the Kimi account login screen on every launch.
- The file changes panel and Undo actions use extension-maintained baselines.
  Files changed through Kimi's Write and Edit operations are tracked on a
  best-effort basis. File deletions performed inside Bash are not tracked by
  this baseline and therefore cannot be restored by the panel's Undo action.

### Fixed

- The `kimi.yoloMode` setting now reaches the permission engine: enabling it
  maps to the core `yolo` permission mode and takes effect when a session
  attaches, including sessions that previously stored a disabled auto-approve
  state.
- Kept the chat header and input toolbar readable when the sidebar is narrow:
  controls wrap and shrink instead of being clipped.

### Distribution boundary

Release packaging produces target-specific VSIX files for `darwin-x64`,
`darwin-arm64`, `linux-x64`, `linux-arm64`, `win32-x64`, and `win32-arm64`.
Archive and static verification for a target does not by itself prove that the
extension has run successfully in that target's Extension Host; runtime test
results must be recorded separately for each operating system and architecture.
