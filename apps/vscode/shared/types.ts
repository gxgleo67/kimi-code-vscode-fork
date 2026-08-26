import type { RunResult, SecondaryModelSelection, StreamEvent } from "./legacy-sdk";

export interface SessionConfig {
  model: string;
  thinking?: boolean;
  effort?: string;
  /**
   * Whether the user explicitly changed the effort. Re-confirming the effort
   * already shown is not an explicit choice: the model is persisted but the
   * stored effort preference is left alone (mirrors the TUI's
   * persistModelSelection). Treated as true when omitted.
   */
  effortChanged?: boolean;
  /**
   * Subagent (secondary) model selection: an object persists the recipe,
   * `null` clears it (subagents follow the main model). Omitted = unchanged.
   */
  secondaryModel?: SecondaryModelSelection | null;
}

export interface ProjectFile {
  path: string;
  name: string;
  isDirectory: boolean;
}

export interface FileChange {
  path: string;
  status: "Modified" | "Added" | "Deleted";
  additions: number;
  deletions: number;
}

export interface ExtensionConfig {
  /** Embedded SDK is the default; externalAcp delegates account routing to the router. */
  backend?: "embedded" | "externalAcp";
  acpTarget?: string;
  acpAccounts?: string[];
  yoloMode: boolean;
  autosave: boolean;
  useCtrlEnterToSend: boolean;
  enableNewConversationShortcut: boolean;
  showThinkingContent: boolean;
  showThinkingExpanded: boolean;
  language: "en" | "zh";
  defaultThinkingEffort: string;
  /**
   * Auto-run /compact when a turn ends with the context above 256K tokens, so
   * long sessions on 256K-context models (e.g. K3-256k) don't overflow and
   * lose context. Default off — compacting costs tokens, so the user decides.
   */
  autoCompactContext: boolean;
  /**
   * Compact composer: show the permission/mode buttons under the composer as
   * icons regardless of width, saving space in narrow sidebars. The model
   * name and thinking effort are never compacted or truncated — they always
   * stay fully visible. Default off.
   */
  compactComposer: boolean;
  version: string;
}

/** Per-session permission mode (mirrors the engine's PermissionMode). */
export type PermissionMode = "manual" | "yolo" | "auto";

export interface WorkspaceStatus {
  hasWorkspace: boolean;
  path?: string;
  workspaceRoot?: string;
}

export type ErrorPhase = "preflight" | "runtime";

export interface StreamError {
  type: "error";
  code: string;
  message: string;
  detail?: string; // 原始服务器错误信息
  phase: ErrorPhase;
  /**
   * `false` marks a mid-turn warning: the turn is still running, so UIs must
   * not treat it as turn-ending. Do not unlock the composer, offer Retry, or
   * flush the queued messages for non-terminal errors.
   */
  terminal?: boolean;
}

export type UIStreamEvent =
  | { type: "session_start"; sessionId: string; model?: string; _sessionId?: string }
  | { type: "stream_complete"; result: RunResult; _sessionId?: string }
  | (StreamError & { _sessionId?: string })
  | (StreamEvent & { _sessionId?: string });

export interface LoginStatus {
  loggedIn: boolean;
}

export type { QuestionRequest, QuestionItem, QuestionOption, QuestionResponse } from "./legacy-sdk";
