/**
 * UI-facing compatibility types for the released Webview.
 *
 * The extension host adapts v1 Node SDK events into this shape while the UI is
 * migrated without a visual rewrite. This file contains no legacy SDK runtime.
 */

/**
 * Legacy string form stays valid for simple approvals. The object form carries
 * plan-review details: `selectedLabel` names the chosen plan option (or
 * 'Revise' when asking for changes) and `feedback` is the revision request.
 */
export type ApprovalResponse =
  | 'approve'
  | 'approve_for_session'
  | 'reject'
  | {
      decision: 'approve' | 'approve_for_session' | 'reject';
      feedback?: string;
      selectedLabel?: string;
    };

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'think'; think: string; encrypted?: string | null }
  | { type: 'image_url'; image_url: { url: string; id?: string | null } }
  | { type: 'audio_url'; audio_url: { url: string; id?: string | null } }
  | { type: 'video_url'; video_url: { url: string; id?: string | null } };

export interface BriefBlock {
  type: 'brief';
  text: string;
}

export interface DiffBlock {
  type: 'diff';
  path: string;
  old_text: string;
  new_text: string;
}

export interface TodoBlock {
  type: 'todo';
  items: Array<{ title: string; status: 'pending' | 'in_progress' | 'done' }>;
}

export interface ShellBlock {
  type: 'shell';
  language: string;
  command: string;
}

export interface UnknownBlock {
  type: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export type DisplayBlock = BriefBlock | DiffBlock | TodoBlock | ShellBlock | UnknownBlock;

export interface ToolCall {
  type: 'function';
  id: string;
  function: { name: string; arguments?: string | null };
  extras?: Record<string, unknown> | null;
}

export interface ToolReturnValue {
  is_error: boolean;
  output: string | ContentPart[];
  message: string;
  display: DisplayBlock[];
  extras?: Record<string, unknown> | null;
}

export interface ToolResult {
  tool_call_id: string;
  return_value: ToolReturnValue;
}

export interface TurnBegin {
  user_input: string | ContentPart[];
}

export interface TokenUsage {
  input_other: number;
  output: number;
  input_cache_read: number;
  input_cache_creation: number;
}

export interface StatusUpdate {
  context_usage?: number | null;
  context_tokens?: number | null;
  max_context_tokens?: number | null;
  token_usage?: TokenUsage | null;
  message_id?: string | null;
  plan_mode?: boolean | null;
  swarm_mode?: boolean | null;
  goal?: GoalStateInfo | null;
  model?: string | null;
  thinking_effort?: string | null;
  permission?: 'manual' | 'yolo' | 'auto' | null;
  /** Engine-side busy truth, sent by announceStatus when a view attaches or
   * re-enters a session: lets a recreated view lock the composer while a
   * turn is still running. Absent from periodic status updates. */
  turn_active?: boolean | null;
  retrying?: {
    next_attempt: number;
    max_attempts: number;
    delay_ms: number;
    message: string;
  } | null;
}

export interface GoalStateInfo {
  objective: string;
  status: "active" | "paused" | "blocked" | "complete";
  turnsUsed: number;
  tokensUsed: number;
  wallClockMs: number;
  terminalReason?: string;
}

export interface BackgroundTaskItem {
  taskId: string;
  kind: string;
  description: string;
  status: string;
  startedAt: number;
  endedAt: number | null;
}

export interface SessionContextMessageView {
  role: string;
  text: string;
  isError?: boolean;
  /** "compaction_summary" marks the message the compactor wrote; absent otherwise. */
  kind?: "compaction_summary";
}

/** The agent's live (post-compaction) context, for the inspection viewer. */
export interface SessionContextSnapshot {
  tokenCount: number;
  messages: SessionContextMessageView[];
}

export interface ApprovalRequestPayload {
  id: string;
  tool_call_id: string;
  sender: string;
  action: string;
  description: string;
  display?: DisplayBlock[];
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionItem {
  question: string;
  header?: string;
  options: QuestionOption[];
  multi_select?: boolean;
}

export interface QuestionRequest {
  id: string;
  tool_call_id: string;
  questions: QuestionItem[];
}

export interface QuestionResponse {
  request_id: string;
  answers: Record<string, string>;
}

export interface SubagentEvent {
  parent_tool_call_id: string;
  event: LegacyWireEvent;
}

export interface SubagentSpawned {
  /** The Agent/AgentSwarm tool call card this child hangs off (scoped id). */
  tool_call_id: string;
  /** Display-normalized model alias the child is bound to. */
  model?: string;
  subagent_name?: string;
}

export type LegacyWireEvent =
  | { type: 'TurnBegin'; payload: TurnBegin & { forkable?: boolean } }
  | { type: 'TurnEnd'; payload: Record<string, never> }
  | { type: 'StepBegin'; payload: { n: number } }
  | { type: 'StepInterrupted'; payload: Record<string, never> }
  | { type: 'CompactionBegin'; payload: Record<string, never> }
  | { type: 'CompactionEnd'; payload: Record<string, never> }
  | { type: 'StatusUpdate'; payload: StatusUpdate }
  | { type: 'ContentPart'; payload: ContentPart }
  | { type: 'ToolCall'; payload: ToolCall }
  | { type: 'ToolCallPart'; payload: { tool_call_id?: string; arguments_part?: string | null } }
  | { type: 'ToolResult'; payload: ToolResult }
  | { type: 'SteerInput'; payload: { user_input: string | ContentPart[] } }
  | { type: 'SubagentEvent'; payload: SubagentEvent }
  | { type: 'SubagentSpawned'; payload: SubagentSpawned }
  | { type: string; payload: unknown };

export type StreamEvent =
  | LegacyWireEvent
  | { type: 'ApprovalRequest'; payload: ApprovalRequestPayload }
  | { type: 'QuestionRequest'; payload: QuestionRequest }
  | { type: 'error'; code: string; message: string; raw?: string };

export interface RunResult {
  status: 'finished' | 'cancelled' | 'max_steps_reached';
  steps?: number;
}

export interface SlashCommandInfo {
  name: string;
  description: string;
  aliases: string[];
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  capabilities: string[];
  max_context_tokens?: number;
  adaptive_thinking?: boolean;
  support_efforts?: string[];
  default_effort?: string;
  /** True when the provider entry is a VS Code–managed custom provider (deletable from the UI). */
  custom?: boolean;
}

/** Parameters for Methods.AddCustomProvider; the API key goes to SecretStorage only. */
export interface AddCustomProviderParams {
  alias: string;
  providerType: string;
  baseUrl: string;
  modelId: string;
  maxContextSize: number;
  displayName?: string;
  apiKey: string;
}

export interface RemoveCustomProviderParams {
  alias: string;
  modelAlias: string;
}

/** Editable details of a VS Code–managed custom provider (never the API key). */
export interface CustomProviderDetails {
  alias: string;
  providerType: string;
  baseUrl: string;
  modelId: string;
  maxContextSize: number;
  displayName?: string;
}

/** The subagent (secondary) model recipe projected to the Webview. */
export interface SecondaryModelSelection {
  model: string;
  defaultEffort?: string;
}

export interface KimiConfig {
  defaultModel: string | null;
  defaultThinking: boolean;
  defaultThinkingEffort?: string;
  models: ModelConfig[];
  /** Subagents bind this model instead of the main one; null/absent = follow the main model. */
  secondaryModel?: SecondaryModelSelection | null;
}

/** Placeholder returned to the Webview instead of a stored MCP credential. */
export const MCP_SECRET_MASK = '••••••••';

export interface MCPServerConfig {
  name: string;
  transport: 'http' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  auth?: 'oauth';
  bearerTokenEnvVar?: string;
  /** Unified management view tags; absent on cores predating the management plane. */
  source?: 'global' | 'plugin' | 'caller';
  /** global: defining file path; plugin: plugin id. */
  origin?: string;
  /** false for plugin / project-layer entries — the panel hides mutating actions for them. */
  mutable?: boolean;
}

export interface UpdateMCPServerRequest {
  originalName: string;
  server: MCPServerConfig;
}

export interface SessionInfo {
  id: string;
  workDir: string;
  updatedAt: number;
  brief: string;
}

export type ThinkingMode = 'none' | 'switch' | 'always' | 'effort';

export interface MCPTestResult {
  success: boolean;
  output: string;
}

export interface LoginResult {
  success: boolean;
  error?: string;
}

export function formatContentOutput(output: string | ContentPart[]): string {
  if (typeof output === 'string') return output;
  if (!Array.isArray(output)) return JSON.stringify(output);
  return output
    .map((item) => item.type === 'text' ? item.text : `[${item.type}]`)
    .filter(Boolean)
    .join('\n');
}
