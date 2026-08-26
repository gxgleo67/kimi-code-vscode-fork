# Changelog

> **Fork 定制说明**:本文件的官方部分保留原版更新记录;本 fork 的定制功能按编号汇总在下方,完整功能清单见根目录 [README.md](../README.md)。

## Fork 定制

### 2026-08-24

1. 每次打开插件默认从首页开始,不再自动恢复上次对话
2. Alt+Enter 立即发送:任务进行中直接把消息插入当前回合(不经过排队),空闲时等同普通发送;插入的消息以行内气泡即时显示
3. 切换权限模式不再弹顶部提示窗;新增 Shift+Tab 循环切换权限模式(逐条确认 → 自动通过 → 完全自主),仅插件窗口内生效
4. 设置开关保存失败时回滚并弹错提示,不再静默丢失
5. 「精简模式」开关:输入框按钮任意宽度下图标化;模型名称与思考强度永不截断;窄宽度下工具栏自动折叠(完整 → 图标 → ⋯ 菜单)
6. 错误卡片移除「重试」按钮,报错后在输入框手动重输指令

### 2026-08-25

1. 立即发送(Alt+Enter / 队列 ⚡)的消息气泡正常显示图片,不再只见文字
2. 消息加入队列时队列按钮闪烁提醒动画,不再弹顶部横幅
3. 引擎报错按界面语言显示:额度不足/限流/认证失败等卡片与提醒已汉化,原文保留在详情行

### 2026-08-26

1. 每条对话显示时间戳(今天显示时分,跨天带日期),历史回放保留原始发送时间
2. 修复 v2 引擎下上下文用量圆环消失/冻结:状态事件只有 token 数没有比例时自动换算;重新进入会话时状态播报补齐上下文快照
3. 立即发送快捷键由 Shift+Enter 改为 Alt+Enter,Shift+Enter 恢复换行

### 2026-08-21

1. 修复切窗或重载后当前对话从界面消失:窗口内重载自动重附着会话并回放,进行中回合恢复流式状态
2. 修复重发请求丢失中断前的思考记录显示,有内容的中断轮次保留为历史
3. 子代理供应商支持编辑已保存项(密钥留空保持不变)
4. 计划文件改为在 VS Code 编辑器中打开审查;计划输出注入文档编排格式更易读
5. 修复切换计划模式后模型选择被状态播报打回旧模型
6. 同步官方 0.37.1~0.38.0 共 11 项引擎/扩展修复;提问对话框多选题改为勾选 + 提交

### 2026-08-20

1. 子代理卡片显示第三方模型徽标(跟随主模型不标记)
2. 额度查询固定直连、绕过系统代理
3. 运行中发消息自动排队、回合结束按序补发;有排队时队列按钮蓝色高亮
4. 待办胶囊更名「当前进度 done/total」
5. 历史记录点选后立即收起列表

### 2026-08-19

1. KIMI 眼睛加载动画 + 毛玻璃居中加载模块(历史 / 会话列表 / 上下文查看器)
2. 子代理可绑定独立模型/供应商,高峰期分流
3. /compact 压缩标记改为单行可展开
4. 修复历史对话图片裂开(引擎 blobref 引用按需解析)
5. 修复额度用尽后重试导致最后一轮对话从界面消失

### 2026-08-18

1. AI 自动生成会话摘要标题(已手动命名不覆盖)
2. 模式开关拆分为 计划 / 目标 / Swarm 三个并排按钮,说明悬浮显示;目标激活可暂停 / 继续 / 取消
3. 附件曲别针点击直接打开文件选择器,不再向输入框写入 @
4. 上下文圆环点击直接压缩上下文;可选设置:上下文超 256K 自动压缩
5. 上下文查看器打开自动刷新;状态行胶囊按本对话使用情况显示
6. 打开历史对话显示加载动画并直达最新消息
7. 开关控件统一:开 = 蓝色,关 = 灰色

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
