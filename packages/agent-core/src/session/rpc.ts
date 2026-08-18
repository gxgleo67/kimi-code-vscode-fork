import { ErrorCodes, KimiError } from '#/errors';
import { McpServerConfigSchema } from '#/config/schema';
import type { SessionWarning } from '@moonshot-ai/protocol';
import { createUserMessage, extractText, type GenerateResult } from '@moonshot-ai/kosong';
import { applyCompletionBudget } from '#/utils/completion-budget';
import type { Agent } from '../agent';
import type { GenerateOptionsWithRequestLogFields } from '../agent/llm-request-logger';
import type {
  ActivateSkillPayload,
  ActivatePluginCommandPayload,
  AddAdditionalDirPayload,
  AddAdditionalDirResult,
  AgentAPI,
  BeginCompactionPayload,
  CancelPayload,
  CancelPlanPayload,
  CancelShellCommandPayload,
  CreateGoalPayload,
  DetachBackgroundPayload,
  EmptyPayload,
  EnterSwarmPayload,
  GetBackgroundOutputPayload,
  GetBackgroundPayload,
  ImportContextPayload,
  McpServerInfo,
  McpStartupMetrics,
  PromptPayload,
  RunShellCommandPayload,
  ReconnectMcpServerPayload,
  RenameSessionPayload,
  RegisterToolPayload,
  SessionAPI,
  SetActiveToolsPayload,
  SetModelPayload,
  SetPermissionPayload,
  SetThinkingPayload,
  SkillSummary,
  PluginCommandDef,
  SteerPayload,
  StopBackgroundPayload,
  UndoHistoryPayload,
  UnregisterToolPayload,
  UpdateSessionMetadataPayload,
} from '#/rpc';
import type { PromisableMethods } from '#/utils/types';

import type { Session, SessionMeta } from '.';
import {
  promptMetadataTextFromPayload,
  promptMetadataTextFromPluginCommand,
  promptMetadataTextFromSkill,
  titleFromPromptMetadataText,
} from './prompt-metadata';

type AgentScopedPayload<T> = T & { agentId: string };

export class SessionAPIImpl implements PromisableMethods<SessionAPI> {
  constructor(protected readonly session: Session) {}

  async renameSession(payload: RenameSessionPayload): Promise<void> {
    const title = payload.title.trim();
    if (title.length === 0) {
      throw new KimiError(ErrorCodes.SESSION_TITLE_EMPTY, 'Session title cannot be empty');
    }
    this.session.metadata = {
      ...this.session.metadata,
      title,
      isCustomTitle: true,
      updatedAt: new Date().toISOString(),
    };
    await this.session.writeMetadata();
  }

  async updateSessionMetadata(payload: UpdateSessionMetadataPayload): Promise<void> {
    this.session.metadata = {
      ...this.session.metadata,
      ...payload.metadata,
      agents: this.session.metadata.agents,
    };
    await this.session.writeMetadata();
  }

  getSessionMetadata(_payload: EmptyPayload): SessionMeta {
    return this.session.metadata;
  }

  listSkills(_payload: EmptyPayload): Promise<readonly SkillSummary[]> {
    return this.session.listSkills();
  }

  listPluginCommands(_payload: EmptyPayload): readonly PluginCommandDef[] {
    return this.session.listPluginCommands();
  }

  listMcpServers(_payload: EmptyPayload): readonly McpServerInfo[] {
    return this.session.mcp.list();
  }

  async getMcpStartupMetrics(_payload: EmptyPayload): Promise<McpStartupMetrics> {
    await this.session.mcp.waitForInitialLoad();
    return { durationMs: this.session.mcp.initialLoadDurationMs() };
  }

  async reconnectMcpServer(payload: ReconnectMcpServerPayload): Promise<void> {
    if (payload.config === undefined) {
      await this.session.mcp.reconnect(payload.name);
      return;
    }
    const parsed = McpServerConfigSchema.safeParse(payload.config);
    if (!parsed.success) {
      throw new KimiError(
        ErrorCodes.CONFIG_INVALID,
        `Invalid MCP server config for "${payload.name}": ${parsed.error.message}`,
      );
    }
    await this.session.mcp.reconnect(payload.name, parsed.data);
  }

  generateAgentsMd(_payload: EmptyPayload): Promise<void> {
    return this.session.generateAgentsMd();
  }

  getSessionWarnings(_payload: EmptyPayload): Promise<readonly SessionWarning[]> {
    return this.session.getSessionWarnings();
  }

  waitForBackgroundTasksOnPrint(_payload: EmptyPayload): Promise<void> {
    return this.session.waitForBackgroundTasksOnPrint();
  }

  handlePrintMainTurnCompleted(_payload: EmptyPayload): Promise<'finish' | 'continue'> {
    return this.session.handlePrintMainTurnCompleted();
  }

  addAdditionalDir(payload: AddAdditionalDirPayload): Promise<AddAdditionalDirResult> {
    return this.session.addAdditionalDir(payload.path, payload.persist);
  }

  async prompt({ agentId, ...payload }: AgentScopedPayload<PromptPayload>) {
    let written: { lastPrompt: string; easyTitle: string } | undefined;
    if (agentId === 'main') {
      written = await this.updatePromptMetadata(promptMetadataTextFromPayload(payload));
    }
    const result = await (await this.getAgent(agentId)).prompt(payload);
    // The llm title refinement is scheduled only after the turn has been
    // kicked off: firing it concurrently with the first turn's requests on
    // the same provider races and never settles (see generateLlmTitle).
    if (written !== undefined) {
      this.scheduleLlmTitle(written.lastPrompt, written.easyTitle);
    }
    return result;
  }

  async steer({ agentId, ...payload }: AgentScopedPayload<SteerPayload>) {
    let written: { lastPrompt: string; easyTitle: string } | undefined;
    if (agentId === 'main') {
      // A steer is user input like a prompt — and can even launch the
      // session's first turn (e.g. goal mode) — so keep title/lastPrompt in
      // sync the same way.
      written = await this.updatePromptMetadata(promptMetadataTextFromPayload(payload));
    }
    const result = await (await this.getAgent(agentId)).steer(payload);
    if (written !== undefined) {
      this.scheduleLlmTitle(written.lastPrompt, written.easyTitle);
    }
    return result;
  }

  async runShellCommand({ agentId, ...payload }: AgentScopedPayload<RunShellCommandPayload>) {
    return (await this.getAgent(agentId)).runShellCommand(payload);
  }

  async cancelShellCommand({ agentId, ...payload }: AgentScopedPayload<CancelShellCommandPayload>) {
    return (await this.getAgent(agentId)).cancelShellCommand(payload);
  }

  async cancel({ agentId, ...payload }: AgentScopedPayload<CancelPayload>) {
    return (await this.getAgent(agentId)).cancel(payload);
  }

  async undoHistory({ agentId, ...payload }: AgentScopedPayload<UndoHistoryPayload>) {
    return (await this.getAgent(agentId)).undoHistory(payload);
  }

  async setModel({ agentId, ...payload }: AgentScopedPayload<SetModelPayload>) {
    return (await this.getAgent(agentId)).setModel(payload);
  }

  async setThinking({ agentId, ...payload }: AgentScopedPayload<SetThinkingPayload>) {
    return (await this.getAgent(agentId)).setThinking(payload);
  }

  async setPermission({ agentId, ...payload }: AgentScopedPayload<SetPermissionPayload>) {
    return (await this.getAgent(agentId)).setPermission(payload);
  }

  async getModel({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getModel(payload);
  }

  async enterPlan({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).enterPlan(payload);
  }

  async cancelPlan({ agentId, ...payload }: AgentScopedPayload<CancelPlanPayload>) {
    return (await this.getAgent(agentId)).cancelPlan(payload);
  }

  async clearPlan({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).clearPlan(payload);
  }

  async enterSwarm({ agentId, ...payload }: AgentScopedPayload<EnterSwarmPayload>) {
    return (await this.getAgent(agentId)).enterSwarm(payload);
  }

  async exitSwarm({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).exitSwarm(payload);
  }

  async getSwarmMode({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getSwarmMode(payload);
  }

  async beginCompaction({ agentId, ...payload }: AgentScopedPayload<BeginCompactionPayload>) {
    return (await this.getAgent(agentId)).beginCompaction(payload);
  }

  async cancelCompaction({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).cancelCompaction(payload);
  }

  async registerTool({ agentId, ...payload }: AgentScopedPayload<RegisterToolPayload>) {
    return (await this.getAgent(agentId)).registerTool(payload);
  }

  async unregisterTool({ agentId, ...payload }: AgentScopedPayload<UnregisterToolPayload>) {
    return (await this.getAgent(agentId)).unregisterTool(payload);
  }

  async setActiveTools({ agentId, ...payload }: AgentScopedPayload<SetActiveToolsPayload>) {
    return (await this.getAgent(agentId)).setActiveTools(payload);
  }

  async stopBackground({ agentId, ...payload }: AgentScopedPayload<StopBackgroundPayload>) {
    return (await this.getAgent(agentId)).stopBackground(payload);
  }

  async detachBackground({ agentId, ...payload }: AgentScopedPayload<DetachBackgroundPayload>) {
    return (await this.getAgent(agentId)).detachBackground(payload);
  }

  async clearContext({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).clearContext(payload);
  }

  async importContext({ agentId, ...payload }: AgentScopedPayload<ImportContextPayload>) {
    return (await this.getAgent(agentId)).importContext(payload);
  }

  async activateSkill({ agentId, ...payload }: AgentScopedPayload<ActivateSkillPayload>) {
    await (await this.getAgent(agentId)).activateSkill(payload);
    if (agentId === 'main') {
      await this.updatePromptMetadata(promptMetadataTextFromSkill(payload));
    }
  }

  async activatePluginCommand({
    agentId,
    ...payload
  }: AgentScopedPayload<ActivatePluginCommandPayload>) {
    await (await this.getAgent(agentId)).activatePluginCommand(payload);
    if (agentId === 'main') {
      await this.updatePromptMetadata(promptMetadataTextFromPluginCommand(payload));
    }
  }

  async startBtw({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>): Promise<string> {
    return (await this.getAgent(agentId)).startBtw(payload);
  }

  async createGoal({ agentId, ...payload }: AgentScopedPayload<CreateGoalPayload>) {
    return (await this.getAgent(agentId)).createGoal(payload);
  }

  async getGoal({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getGoal(payload);
  }

  async pauseGoal({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).pauseGoal(payload);
  }

  async resumeGoal({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).resumeGoal(payload);
  }

  async cancelGoal({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).cancelGoal(payload);
  }

  async getCronTasks({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getCronTasks(payload);
  }

  async getBackgroundOutput({
    agentId,
    ...payload
  }: AgentScopedPayload<GetBackgroundOutputPayload>) {
    return (await this.getAgent(agentId)).getBackgroundOutput(payload);
  }

  async getContext({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getContext(payload);
  }

  async getConfig({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getConfig(payload);
  }

  async getPermission({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getPermission(payload);
  }

  async getPlan({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getPlan(payload);
  }

  async getUsage({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getUsage(payload);
  }

  async getTools({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getTools(payload);
  }

  async getBackground({ agentId, ...payload }: AgentScopedPayload<GetBackgroundPayload>) {
    return (await this.getAgent(agentId)).getBackground(payload);
  }

  private async getAgent(agentId: string): Promise<PromisableMethods<AgentAPI>> {
    const agent = await this.session.ensureAgentResumed(agentId);
    return agent.rpcMethods;
  }

  private needUpdateEasyTitle(metadata: SessionMeta): boolean {
    if (hasCustomTitle(metadata)) return false;
    if (!isUntitled(metadata.title)) return false;
    return true;
  }

  private async updatePromptMetadata(
    lastPrompt: string | undefined,
  ): Promise<{ lastPrompt: string; easyTitle: string } | undefined> {
    if (lastPrompt === undefined) return undefined;

    const title = this.needUpdateEasyTitle(this.session.metadata)
      ? titleFromPromptMetadataText(lastPrompt)
      : undefined;
    const now = new Date().toISOString();
    const nextMetadata = {
      ...this.session.metadata,
      lastPrompt,
      updatedAt: now,
    };
    if (title !== undefined) {
      nextMetadata.title = title;
      nextMetadata.isCustomTitle = false;
    }

    this.session.metadata = nextMetadata;
    await this.session.writeMetadata();
    await this.session.rpc.emitEvent({
      type: 'session.meta.updated',
      agentId: 'main',
      title,
      patch: {
        title,
        isCustomTitle: title === undefined ? undefined : false,
        lastPrompt,
      },
    });

    // Report the freshly written easy title so the caller can schedule the
    // llm refinement once the turn is running (not from here — the title
    // request must not race the first turn's requests).
    return title === undefined ? undefined : { lastPrompt, easyTitle: title };
  }

  /**
   * Fire-and-forget LLM title refinement (VSCode host only): the easy title
   * written above is a hard truncation of the first prompt; replace it with a
   * short model-generated title once the response arrives. This must never
   * block or fail the prompt path — any error leaves the easy title in place.
   */
  private scheduleLlmTitle(prompt: string, easyTitle: string): void {
    if (this.session.options.uiMode !== 'vscode') return;
    void this.generateLlmTitle(prompt, easyTitle).catch((error: unknown) => {
      this.session.log.warn('llm session title generation failed', { error });
    });
  }

  private async generateLlmTitle(prompt: string, easyTitle: string): Promise<void> {
    const agent = await this.session.ensureAgentResumed('main');
    // The title request shares the provider with the session's own turn; sent
    // concurrently with the first turn's requests it never settles. Wait for
    // that turn to finish first — a cancel still counts as finished — and
    // take the delay as a feature: the title can then draw on the reply.
    if (agent.turn.hasActiveTurn) {
      await agent.turn.waitForCurrentTurn().catch(() => undefined);
    }
    // A failed or empty attempt must not be the end: transient provider
    // errors (peak-hour throttling) and thinking models that spend the whole
    // completion budget on reasoning both leave the session stuck with the
    // truncated easy title. Retry a few times on a delay; each attempt
    // re-checks that the easy title is still in place.
    for (let attempt = 1; attempt <= LLM_TITLE_MAX_ATTEMPTS; attempt++) {
      // The user may have renamed the session while a previous attempt or the
      // first turn was in flight.
      const beforeRequest = this.session.metadata;
      if (hasCustomTitle(beforeRequest) || beforeRequest.title !== easyTitle) return;
      try {
        const settled = await this.requestLlmTitle(prompt, easyTitle, agent);
        if (settled) return;
      } catch (error) {
        this.session.log.warn('llm session title attempt failed', { attempt, error });
      }
      if (attempt < LLM_TITLE_MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, LLM_TITLE_RETRY_DELAY_MS));
      }
    }
  }

  /** Single title attempt; returns true once the refined title is written. */
  private async requestLlmTitle(prompt: string, easyTitle: string, agent: Agent): Promise<boolean> {
    // Thinking is disabled and the completion budget is small: a title is a
    // few words. The budget still has to absorb reasoning from models whose
    // thinking cannot be switched off, or they return no text at all.
    const provider = applyCompletionBudget({
      provider: agent.config.provider.withThinking('off'),
      budget: { hardCap: LLM_TITLE_MAX_COMPLETION_TOKENS },
      capability: agent.config.modelCapabilities,
    });
    const generateOptions: GenerateOptionsWithRequestLogFields = {
      requestLogFields: { kind: 'session-title' },
    };
    const response = await agent.generate(
      provider,
      LLM_TITLE_SYSTEM_PROMPT,
      [],
      [createUserMessage(llmTitleInput(prompt, agent))],
      undefined,
      generateOptions,
    );
    const title = sanitizeLlmTitle(llmTitleText(response));
    if (title === undefined) {
      this.session.log.debug('llm session title generation returned no text');
      return false;
    }
    // The user may have renamed the session (or otherwise changed the title)
    // while the request was in flight — only ever replace the exact easy
    // title this call set out to refine, and never a custom title.
    const metadata = this.session.metadata;
    if (hasCustomTitle(metadata) || metadata.title !== easyTitle) return true;
    this.session.metadata = {
      ...metadata,
      title,
      isCustomTitle: false,
      updatedAt: new Date().toISOString(),
    };
    await this.session.writeMetadata();
    await this.session.rpc.emitEvent({
      type: 'session.meta.updated',
      agentId: 'main',
      title,
      patch: {
        title,
        isCustomTitle: false,
        lastPrompt: prompt,
      },
    });
    return true;
  }
}

function isUntitled(title: unknown): boolean {
  return typeof title !== 'string' || title.trim().length === 0 || title === 'New Session';
}

function hasCustomTitle(metadata: SessionMeta): boolean {
  if (metadata.isCustomTitle) return true;
  return typeof (metadata as SessionMeta & { customTitle?: unknown }).customTitle === 'string';
}

const LLM_TITLE_SYSTEM_PROMPT =
  'Generate a short conversation title (3-6 words) for the conversation below. ' +
  "The input is the user's request, optionally followed by the assistant's first reply. " +
  "Use the same language as the user's message. " +
  'Output only the title itself: no quotes, no trailing punctuation, no prefixes, no explanation.';
const LLM_TITLE_MAX_PROMPT_CHARS = 1000;
const LLM_TITLE_MAX_REQUEST_CHARS = 800;
const LLM_TITLE_MAX_RESPONSE_CHARS = 400;
const LLM_TITLE_MAX_COMPLETION_TOKENS = 1024;
const LLM_TITLE_MAX_LENGTH = 60;
const LLM_TITLE_MAX_ATTEMPTS = 3;
const LLM_TITLE_RETRY_DELAY_MS = 8_000;

/**
 * Build the title-request user message: the prompt alone when the first turn
 * produced no reply, otherwise the request plus a truncated reply summary so
 * the title reflects what the conversation is actually about.
 */
function llmTitleInput(prompt: string, agent: Agent): string {
  const reply = lastAssistantReplyText(agent);
  if (reply === undefined) return prompt.slice(0, LLM_TITLE_MAX_PROMPT_CHARS);
  return (
    `<request>\n${prompt.slice(0, LLM_TITLE_MAX_REQUEST_CHARS)}\n</request>\n` +
    `<response>\n${reply.slice(0, LLM_TITLE_MAX_RESPONSE_CHARS)}\n</response>`
  );
}

/** Text of the last assistant message in the agent's context, if any. */
function lastAssistantReplyText(agent: Agent): string | undefined {
  const messages = agent.context.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message === undefined || message.role !== 'assistant') continue;
    const text = extractText(message).trim();
    return text.length > 0 ? text : undefined;
  }
  return undefined;
}

function llmTitleText(response: GenerateResult): string {
  const content = response.message.content;
  return typeof content === 'string'
    ? content
    : content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

function sanitizeLlmTitle(raw: string): string | undefined {
  const collapsed = raw.replaceAll(/\s+/g, ' ').trim();
  // Models sometimes wrap the title in quotes despite the instruction.
  const unquoted = collapsed.replace(/^["'“”‘’「」『』`]+|["'“”‘’「」『』`]+$/g, '').trim();
  if (unquoted.length === 0) return undefined;
  return unquoted.slice(0, LLM_TITLE_MAX_LENGTH);
}
