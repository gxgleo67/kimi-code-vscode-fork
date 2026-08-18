/**
 * English dictionary (source of truth for keys).
 * Keys are flat, dot-separated, grouped by component in comment sections.
 * Add a new key here first, then mirror it in zh.ts (type-checked).
 */
export const en = {
  // ── Common ──────────────────────────────────────────────────────────────
  "common.cancel": "Cancel",
  "common.continue": "Continue",
  "common.delete": "Delete",
  "common.deleting": "Deleting...",
  "common.retry": "Retry",
  "common.send": "Send",
  "common.loading": "Loading...",
  "common.add": "Add",
  "common.update": "Update",
  "common.copy": "Copy",
  "common.copied": "Copied",
  "common.browse": "Browse...",
  "common.reset": "Reset",

  // ── InputArea ───────────────────────────────────────────────────────────
  "input.placeholder": "Ask Kimi Code... (/ commands · @ files · Alt+K code)",
  "input.placeholderStreaming": "Add a follow-up...",
  "input.addFilesOrMedia": "Add files or media",
  "input.noModels": "No models available",
  "input.switchCacheNote":
    "Note: Switching models or thinking effort invalidates the existing prompt cache. Start a new conversation to avoid extra token costs.",
  "input.exitPlanMode.title": "Exit Plan Mode",
  "input.exitPlanMode.description":
    "The agent is still working. Exiting plan mode now will affect the current turn. Are you sure you want to exit plan mode immediately?",
  "input.exitPlanMode.confirm": "Exit Now",

  // ── StreamingConfirmDialog ──────────────────────────────────────────────
  "dialog.streamingDescription":
    "The current conversation is still generating a response. This action will truncate the output. Are you sure you want to continue?",

  // ── ActionMenu ──────────────────────────────────────────────────────────
  "menu.settings": "Settings",
  "menu.workingDirectory": "Working Directory",
  "menu.mcpServers": "MCP Servers",
  "menu.generalConfig": "General Config",
  "menu.support": "Support",
  "menu.showLogs": "Show Logs",
  "menu.resetKimi": "Reset Kimi",
  "menu.account": "Account",
  "menu.processing": "Processing...",
  "menu.signOut": "Sign out",
  "menu.signIn": "Sign in",
  "menu.signInFailed": "Sign-in failed. Check the logs for details.",
  "menu.language": "Language / 语言",

  // ── WelcomeScreen / useWelcomeHint ──────────────────────────────────────
  "welcome.commands": "⚡ Commands",
  "welcome.viewAllCommands": "View all commands",
  "welcome.initDesc": "Scan project and generate AGENTS.md file",
  "welcome.compactDesc": "Trim context so that I focus on the essentials",
  "welcome.tips": "💡 Tips",
  "welcome.browseHistory": "Browse input history",
  "welcome.addFiles": "Add/Search files to reference",
  "welcome.altK": "Add selected code directly from editor",
  "welcome.proTips": "🚀 Pro Tips",
  "welcome.proYolo": "• Use YOLO mode to auto-approve tool calls",
  "welcome.proAgentsMd": "• AGENTS.md helps me understand your codebase",
  "welcome.proThinking": "• Enable Thinking for complex tasks",
  "welcome.quickStart": "Quick Start Guide",
  "welcome.mapCodebase.title": "Let me map your codebase",
  "welcome.mapCodebase.desc": "Run /init to scan the project and generate docs",
  "welcome.refCode.title": "Reference specific code",
  "welcome.refCode.desc": "Type @ to select files, or press Alt+K with code highlighted",
  "welcome.seeWhatICanDo.title": "See what I can do",
  "welcome.seeWhatICanDo.desc": "Type / for all commands—like /compact to trim context",
  "welcome.deeperAnalysis.title": "Need deeper analysis?",
  "welcome.deeperAnalysis.desc": "Enable thinking mode for complex architecture or debugging",
  "welcome.moreThanCode.title": "More than code",
  "welcome.moreThanCode.desc": "Paste a screenshot or design and I'll help implement it",
  "welcome.addMoreTools.title": "Add more tools",
  "welcome.addMoreTools.desc": "Connect external services via MCP servers in settings",
  "welcome.fewerInterruptions.title": "Prefer fewer interruptions?",
  "welcome.fewerInterruptions.desc": "Enable YOLO mode to auto-approve",
  "welcome.longContext.title": "Context getting long?",
  "welcome.longContext.desc": "Type /compact to keep only the essentials",

  // ── LoginScreen ─────────────────────────────────────────────────────────
  "login.waiting": "Waiting for authentication...",
  "login.browserHint": "A browser window should open automatically. Complete the sign-in process there.",
  "login.browserNotOpened": "If the browser didn't open, visit this URL:",
  "login.openInBrowser": "Open in browser",
  "login.welcomeTitle": "Welcome to Kimi Code",
  "login.welcomeDesc": "Use Kimi Code with your Kimi account subscription or your existing API setup.",
  "login.failed": "Login failed",
  "login.signInWithKimi": "Sign in with Kimi Account",
  "login.signInHint": "Use your Kimi account and Kimi Code subscription.",
  "login.skip": "Skip",
  "login.skipHint": "Use your existing API key configuration.",
  "login.subscriptionRequired": "Subscription Required",
  "login.subscriptionDesc":
    "Your account does not have an active Kimi Code subscription. Please subscribe to continue using Kimi Code with your account.",
  "login.subscribe": "Subscribe",

  // ── ConfigErrorScreen ───────────────────────────────────────────────────
  "error.starting": "Starting Kimi Code...",
  "error.noWorkspace": "No workspace open",
  "error.noWorkspaceDesc": "Open a folder to start using Kimi Code.",
  "error.openFolder": "Open Folder",
  "error.modelSetupRequired": "Model setup required",
  "error.modelSetupDesc":
    "Sign in with a Kimi account, or configure a provider and model in your shared Kimi Code config.toml.",
  "error.sharedConfig": "Shared Kimi Code configuration",
  "error.sharedConfigDesc":
    "VS Code and the terminal UI use the same Kimi Code home, configuration, credentials, and sessions.",
  "error.backToSignIn": "Back to sign in",
  "error.reload": "Reload",
  "error.couldNotStart": "Kimi Code could not start",
  "error.couldNotStartDesc":
    "Check the error below. Full diagnostics are available in the Kimi Code output channel.",
  "error.details": "Error details",

  // ── ChatStatus / TokenInfo ──────────────────────────────────────────────
  "status.tokenUsage": "Token Usage",
  "status.context": "Context",
  "status.input": "Input",
  "status.output": "Output",
  "status.retry": "Retry {attempt}/{max}",
  "status.retryingIn": "Retrying in {seconds}s: {message}",
  "status.contextWindowUsage": "Context Window Usage",
  "status.totalInputTokens": "Total Input Tokens",
  "status.totalOutputTokens": "Total Output Tokens",

  // ── UsageStatusBar ──────────────────────────────────────────────────────
  "usage.contextWindow": "Context window",
  "usage.tokenCount": "{used} / {limit} tokens",
  "usage.fiveHourLimit": "5h quota",
  "usage.weeklyLimit": "7-day quota",
  "usage.unavailable": "Usage unavailable: {error}",
  "usage.loading": "Loading usage...",
  "usage.percentUsed": "{percent}% used",
  "usage.resetsInDays": "resets in {days}d {hours}h",
  "usage.resetsInHours": "resets in {hours}h {minutes}m",
  "usage.resetsInMinutes": "resets in {minutes}m",
  "usage.resetRefreshing": "reset, refreshing…",

  // ── QueuedMessagesPanel / BottomToolbar ─────────────────────────────────
  "queue.media": "(media)",
  "queue.plusMedia": "+ media",
  "queue.insertNow": "Insert now (steer)",
  "queue.queuedCount": "{count} Queued",
  "changes.changedCount": "{count} Changed",

  // ── ApprovalDialog (incl. plan review) ──────────────────────────────────
  "approval.allowThis": "Allow this {action}?",
  "approval.yes": "Yes",
  "approval.yesForSession": "Yes, for this session",
  "approval.no": "No",
  "approval.executeThisPlan": "Execute this plan?",
  "approval.failedToLoad": "Failed to load {path}: {error}",
  "approval.loadingPlan": "Loading plan...",
  "approval.revisePlaceholder": "What should the plan change?",
  "approval.sendFeedback": "Send feedback",
  "approval.execute": "Execute",
  "approval.revise": "Revise",
  "approval.reject": "Reject",

  // ── QuestionDialog ──────────────────────────────────────────────────────
  "question.progress": "Question {current} of {total}",
  "question.enterResponse": "Enter your response...",
  "question.customResponse": "Custom response...",

  // ── WorkDirModal ────────────────────────────────────────────────────────
  "workdir.title": "Select Working Directory",
  "workdir.root": "(root)",

  // ── Header / SessionList ────────────────────────────────────────────────
  "header.session": "Session",
  "header.history": "History",
  "header.sessionDetails": "Session Details",
  "header.sessionDetailsDesc": "Details for this conversation.",
  "header.sessionId": "Session ID",
  "header.messages": "Messages",
  "header.newTitle": "Start New Conversation?",
  "header.newDesc":
    "The current conversation is still generating a response. Starting a new one will truncate the output. Are you sure you want to continue?",
  "header.newConversation": "New Conversation",
  "session.searchPlaceholder": "Search conversations...",
  "session.noneFound": "No conversations found",
  "session.noneYet": "No conversations yet",
  "session.untitled": "Untitled",
  "session.deleteTitle": "Delete Conversation?",
  "session.deleteDesc": "This will permanently delete this conversation. This action cannot be undone.",
  "session.switchTitle": "Switch Conversation?",
  "session.switchDesc":
    "The current conversation is still generating a response. Switching will truncate the output. Are you sure you want to continue?",
  "session.switch": "Switch",
  "session.unableToOpen": "Unable to open the conversation: {error}",
  "session.unableToDelete": "Unable to delete the conversation: {error}",
  "session.rename": "Rename",
  "session.unableToRename": "Unable to rename the conversation: {error}",
  "session.showMore": "Show more ({count})",

  // ── ChatMessage ─────────────────────────────────────────────────────────
  "chat.processing": "Processing...",
  "chat.showEarlier": "Show earlier messages ({count})",
  "context.label": "Context",
  "context.tooltip": "Inspect the exact context sent to the model (post-compaction state)",
  "context.title": "Current Context",
  "context.stats": "{tokens} tokens · {count} messages",
  "context.refresh": "Refresh",
  "context.copyAll": "Copy all",
  "context.copied": "Copied to clipboard",
  "context.empty": "No context yet",
  "context.loadFailed": "Failed to load the context",
  "chat.forkTooltip": "Fork conversation from this point",
  "chat.forkTitle": "Fork Conversation",
  "chat.forkDescStreaming":
    "The current conversation is still generating a response. Forking will stop the generation and create a new conversation from this point. Continue?",
  "chat.forkDesc":
    "This will create a new conversation branching from this point. All messages after this turn will be removed in the forked conversation. Continue?",
  "chat.fork": "Fork",
  "chat.forkFailed": "Failed to fork conversation: {error}",

  // ── CompactionCard ──────────────────────────────────────────────────────
  "compaction.compacting": "Compacting context...",
  "compaction.compacted": "Context compacted",

  // ── CopyButton ──────────────────────────────────────────────────────────
  "copy.message": "Copy message",

  // ── PlanCard / PlanModeButton ───────────────────────────────────────────
  "plan.mode": "Plan Mode",
  "planMode.active": "Plan mode active (click to exit)",
  "planMode.enter": "Enter plan mode",
  "permMode.manual": "Manual",
  "permMode.yolo": "YOLO",
  "permMode.auto": "Auto",
  "permMode.tooltipManual": "Manual mode: tool calls need your approval",
  "permMode.tooltipYolo": "YOLO mode: tool calls are auto-approved; the agent may still ask questions",
  "permMode.tooltipAuto": "Auto mode: fully autonomous; tool calls are auto-approved and questions auto-dismissed",
  "permMode.switched": "Permission mode: {mode}",
  "permMode.switchFailed": "Failed to change permission mode: {error}",
  "permMode.pendingNext": "{mode} — applies when the next conversation starts",
  "permMode.descManual": "Ask for approval on every tool action",
  "permMode.descYolo": "Auto-approve tool actions, but the agent may still ask questions",
  "permMode.descAuto": "Fully autonomous — the agent decides everything without asking",

  // ── ModeMenu (plan / swarm / goal) ──────────────────────────────────────
  "modes.label": "Mode",
  "modes.plan": "Plan",
  "modes.planDesc": "Have the agent make a plan before changing files",
  "modes.swarm": "Swarm",
  "modes.swarmDesc": "Run parallel agents for broader exploration",
  "modes.goal": "Goal",
  "modes.goalDesc": "Track one objective until it is complete",
  "modes.needSession": "Available after the first message",
  "modes.goalPlaceholder": "What should the agent achieve?",
  "modes.goalStart": "Start",
  "modes.goalPause": "Pause",
  "modes.goalResume": "Resume",
  "modes.goalCancel": "Cancel",
  "modes.goalStatus.active": "Active",
  "modes.goalStatus.paused": "Paused",
  "modes.goalStatus.blocked": "Blocked",
  "modes.goalStatus.complete": "Complete",

  // ── StatusPills (background tasks / todos) ──────────────────────────────
  "pills.bash": "Background Bash ({count})",
  "pills.agents": "Sub Agents ({count})",
  "pills.todos": "Todos ({done}/{total})",
  "pills.bashTitle": "Background Bash · {count} running",
  "pills.agentsTitle": "Sub Agents · {count} running",
  "pills.todosTitle": "Todos · {done}/{total}",
  "pills.statusRunning": "Running · {seconds}s",
  "pills.statusDone": "Done · {seconds}s",
  "pills.statusFailed": "Failed · {seconds}s",
  "pills.badgeBash": "bash",
  "pills.badgeAgent": "subagent",

  // ── ModelPicker / ModelPickerDialog ─────────────────────────────────────
  "modelPicker.title": "Switch Model",
  "modelPicker.searchPlaceholder": "Search models...",
  "modelPicker.all": "All",
  "modelPicker.favorites": "Starred",
  "modelPicker.more": "More models...",
  "modelPicker.thinking": "Thinking",
  "modelPicker.thinkingOn": "On",
  "modelPicker.thinkingOff": "Off",
  "modelPicker.capThinking": "Thinking",
  "modelPicker.capImage": "Image input",
  "modelPicker.capVideo": "Video input",
  "modelPicker.capTools": "Tool use",
  "modelPicker.empty": "No matching models",
  "modelPicker.footerHint": "↑↓ Navigate · Enter Select · Esc Close",

  // ── ThinkingBlock / ThinkingButton ──────────────────────────────────────
  "thinking.label": "Thinking",
  "thinking.effortTooltip": "Thinking effort: {effort}",
  "thinking.alwaysOn": "Thinking is always enabled for this model",
  "thinking.enabled": "Thinking enabled",
  "thinking.enable": "Enable thinking",

  // ── ToolRenderers ───────────────────────────────────────────────────────
  "tools.expand": "Expand +{count}",
  "tools.less": "Less",
  "tools.todoUpdated": "Todo list updated",
  "tools.written": "✓ Written",
  "tools.replaced": "✓ Replaced successfully",
  "tools.done": "✓ Done",
  "tools.failed": "✗ Failed",
  "tools.stepCount.one": "{count} step",
  "tools.stepCount.other": "{count} steps",
  "tools.stepN": "Step {n}",
  "tools.updateTodos": "Update Todos",
  "tools.globIn": "in {directory}",

  // ── DisplayBlocks ───────────────────────────────────────────────────────
  "display.shellCommand": "Shell Command",

  // ── SlashCommandMenu ────────────────────────────────────────────────────
  "slash.noCommands": "No commands found",

  // ── FilePickerMenu ──────────────────────────────────────────────────────
  "filePicker.selectMedia": "Select images or videos...",
  "filePicker.browseFolders": "Browse folders...",
  "filePicker.backToSearch": "Back to search",
  "filePicker.noFilesFound": "No files found",
  "filePicker.emptyFolder": "Empty folder",

  // ── FileChangesPanel ────────────────────────────────────────────────────
  "files.viewChanges": "View Changes",
  "files.undoChanges": "Undo Changes",
  "files.keepChanges": "Keep Changes",
  "files.noChanges": "No file changes",
  "files.count.one": "{count} file",
  "files.count.other": "{count} files",
  "files.keepAll": "Keep All",
  "files.undoAll": "Undo All",
  "files.unableToUndo": "Unable to undo changes: {error}",
  "files.unableToKeep": "Unable to keep changes: {error}",

  // ── MCPServersModal ─────────────────────────────────────────────────────
  "mcp.title": "MCP Servers",
  "mcp.addServer": "Add MCP Server",
  "mcp.addServerSubmit": "Add Server",
  "mcp.adding": "Adding",
  "mcp.recommended": "Recommended",
  "mcp.allInstalled": "All recommended servers installed",
  "mcp.none": "No MCP servers configured",
  "mcp.deleteTitle": "Delete MCP Server?",
  "mcp.deleteDesc": "This will remove \"{name}\" from your configuration. This action cannot be undone.",
  "mcp.nameRequired": "Name required",
  "mcp.urlRequired": "URL required",
  "mcp.commandRequired": "Command required",
  "mcp.name": "Name",
  "mcp.transport": "Transport",
  "mcp.requiresOAuth": "Requires OAuth",
  "mcp.headers": "Headers",
  "mcp.bearerToken": "Bearer Token Environment Variable",
  "mcp.command": "Command",
  "mcp.arguments": "Arguments",
  "mcp.envVars": "Environment Variables",
  "mcp.addField": "+ Add",
  "mcp.updateFailed": "Update failed: {error}",
  "mcp.error": "Error: {error}",

  // ── SubagentModelDialog ─────────────────────────────────────────────────
  "subagent.tooltip": "Subagent model: {label}",
  "subagent.followsMain": "follows the main model",
  "subagent.title": "Subagent Model",
  "subagent.description":
    "The model Agent-tool subagents bind to instead of the main model (e.g. a faster provider at peak hours).",
  "subagent.followMain": "Follow main model",
  "subagent.defaultSuffix": "default",
  "subagent.infoBody":
    "Subagents can run on any provider — not just Kimi models. Add a custom provider below, or declare one under [models] in config.toml and it becomes selectable here. The [secondary_model] recipe also accepts default_effort and the model override fields as subagent-only patches.",
  "subagent.infoExperimental": "Experimental feature, enabled by default in this fork.",
  "subagent.docsLink": "Docs: secondary_model",
  "subagent.customProviders": "Custom providers",
  "subagent.addCustomProvider": "Add custom provider",
  "subagent.form.alias": "Provider alias",
  "subagent.form.aliasPlaceholder": "e.g. deepseek",
  "subagent.form.providerType": "Provider type",
  "subagent.form.baseUrl": "Base URL",
  "subagent.form.baseUrlPlaceholder": "https://api.deepseek.com/v1",
  "subagent.form.modelId": "Model ID",
  "subagent.form.modelIdPlaceholder": "e.g. deepseek-chat",
  "subagent.form.maxContextSize": "Max context size",
  "subagent.form.displayName": "Display name (optional)",
  "subagent.form.apiKey": "API key",
  "subagent.form.securityNote":
    "The API key is stored in VS Code Secret Storage (system-encrypted) and is never written to any configuration file.",
  "subagent.form.submit": "Add provider",
  "subagent.form.submitting": "Adding...",
  "subagent.deleteTitle": "Remove custom provider?",
  "subagent.deleteDesc":
    "This removes \"{alias}\" and its model from config.toml and deletes the stored API key. This action cannot be undone.",
  "subagent.error.required": "Alias, base URL, model ID and API key are required.",
  "subagent.error.aliasInvalid":
    "The alias must start with a lowercase letter or digit and use only lowercase letters, digits and dashes.",
  "subagent.error.maxContext": "Max context size must be a positive integer.",
  "subagent.error.addFailed": "Failed to add the custom provider: {error}",
  "subagent.error.removeFailed": "Failed to remove the custom provider: {error}",
  "subagent.added": "Custom provider \"{alias}\" added.",
  "subagent.removed": "Custom provider \"{alias}\" removed.",

  // ── Toasts (stores, media upload) ───────────────────────────────────────
  "toast.noRunningTask": "No running task to stop.",
  "toast.saveModelSettingsFailed": "Failed to save model settings: {error}",
  "toast.processMediaFailed": "Failed to process media file",
  "toast.pickMediaFailed": "Failed to pick media",

  // ── Media validation (lib/media-utils) ──────────────────────────────────
  "media.maxCount": "Maximum {max} media files allowed",
  "media.unsupportedFormat": "Unsupported format. Use PNG, JPEG, GIF, WebP, HEIC, MP4, WebM or MOV",
  "media.fileTooLarge": "File exceeds {max}MB limit",
  "media.totalTooLarge": "Total media size exceeds {max}MB limit",
} as const;

export type TranslationKey = keyof typeof en;
