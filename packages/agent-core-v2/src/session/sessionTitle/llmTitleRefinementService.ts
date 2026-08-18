import { Disposable, DisposableStore } from '#/_base/di/lifecycle';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { ILogService } from '#/_base/log/log';
import { retryErrorFields, sleepForRetry } from '#/_base/utils/retry';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IEventService } from '#/app/event/event';
import { IEventBus } from '#/app/event/eventBus';
import { LifecycleScope } from '#/app/scopes';
import { IAgentProfileService } from '#/agent/profile/profile';
import { TurnEnded } from '#/agent/loop/turnOps';
import { titleFromPromptMetadataText } from '#/agent/prompt/promptMetadataText';
import { createUserMessage, extractText, type Message } from '#/kosong/contract/message';
import { IModelCatalog } from '#/kosong/model/catalog';
import {
  IAgentLifecycleService,
  MAIN_AGENT_ID,
} from '#/session/agentLifecycle/agentLifecycle';
import { ISessionContext } from '#/session/sessionContext/sessionContext';
import { ISessionMetadata } from '#/session/sessionMetadata/sessionMetadata';
import { SessionMetaUpdated } from '#/session/sessionMetadata/sessionMetaEvents';

import { IAgentTitlePromptSource } from './agentTitlePromptSource';
import { ISessionLlmTitleRefinement } from './llmTitleRefinement';

const VSCODE_HOST_PRODUCT_NAME = 'kimi-code-vscode';

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

interface PendingRefinement {
  readonly prompt: string;
  readonly easyTitle: string;
}

export class SessionLlmTitleRefinementService
  extends Disposable
  implements ISessionLlmTitleRefinement
{
  declare readonly _serviceBrand: undefined;

  private pending: PendingRefinement | undefined;
  private running = false;
  private readonly abortController = new AbortController();
  private mainSubscription: DisposableStore | undefined;

  constructor(
    @ISessionContext private readonly ctx: ISessionContext,
    @ISessionMetadata private readonly metadata: ISessionMetadata,
    @IAgentLifecycleService private readonly agents: IAgentLifecycleService,
    @IEventService private readonly eventService: IEventService,
    @IModelCatalog private readonly modelCatalog: IModelCatalog,
    @IBootstrapService bootstrap: IBootstrapService,
    @ILogService private readonly log: ILogService,
  ) {
    super();
    if (bootstrap.clientIdentity.productName !== VSCODE_HOST_PRODUCT_NAME) return;
    this._register(
      this.metadata.onDidChangeMetadata((event) => {
        if (!event.changed.includes('title')) return;
        void this.captureEasyTitle().catch((error: unknown) => {
          this.log.warn('llm session title capture failed', retryErrorFields(error));
        });
      }),
    );
    this._register(
      this.agents.onDidCreate((handle) => {
        if (handle.id === MAIN_AGENT_ID) this.attachMain();
      }),
    );
    this._register(
      this.agents.onDidDispose((agentId) => {
        if (agentId !== MAIN_AGENT_ID) return;
        this.mainSubscription?.dispose();
        this.mainSubscription = undefined;
      }),
    );
    this._register({
      dispose: () => {
        this.abortController.abort();
        this.mainSubscription?.dispose();
        this.mainSubscription = undefined;
      },
    });
    this.attachMain();
  }

  private attachMain(): void {
    if (this.mainSubscription !== undefined) return;
    const bus = this.agents.get(MAIN_AGENT_ID)?.accessor.get(IEventBus);
    if (bus === undefined) return;
    const subscription = new DisposableStore();
    this.mainSubscription = subscription;
    subscription.add(
      bus.subscribe(TurnEnded, () => {
        this.onTurnEnded();
      }),
    );
  }

  private async captureEasyTitle(): Promise<void> {
    const meta = await this.metadata.read();
    const title = meta.title;
    const prompt = meta.lastPrompt;
    if (meta.titleKind !== 'replaceable' || title === undefined || prompt === undefined) return;
    if (title !== titleFromPromptMetadataText(prompt)) return;
    if (this.pending?.easyTitle === title) return;
    this.pending = { prompt, easyTitle: title };
  }

  private onTurnEnded(): void {
    const pending = this.pending;
    if (pending === undefined || this.running) return;
    this.pending = undefined;
    this.running = true;
    void this.refine(pending)
      .catch((error: unknown) => {
        this.log.warn('llm session title generation failed', retryErrorFields(error));
      })
      .finally(() => {
        this.running = false;
      });
  }

  private async refine(pending: PendingRefinement): Promise<void> {
    const signal = this.abortController.signal;
    for (let attempt = 1; attempt <= LLM_TITLE_MAX_ATTEMPTS; attempt++) {
      if (signal.aborted) return;
      if (!(await this.stillRefinable(pending))) return;
      try {
        const title = await this.requestTitle(pending.prompt, signal);
        if (title === undefined) {
          this.log.debug('llm session title generation returned no text');
        } else {
          if (!(await this.stillRefinable(pending))) return;
          const applied = await this.metadata.setGeneratedTitleIfUncustomized(title);
          if (!applied) return;
          this.eventService.publish(
            new SessionMetaUpdated({
              payload: {
                agentId: MAIN_AGENT_ID,
                sessionId: this.ctx.sessionId,
                title,
                patch: { title, isCustomTitle: false, lastPrompt: pending.prompt },
              },
            }),
          );
          return;
        }
      } catch (error) {
        if (signal.aborted) return;
        this.log.warn('llm session title attempt failed', {
          attempt,
          ...retryErrorFields(error),
        });
      }
      if (attempt < LLM_TITLE_MAX_ATTEMPTS) {
        try {
          await sleepForRetry(LLM_TITLE_RETRY_DELAY_MS, signal);
        } catch {
          return;
        }
      }
    }
  }

  private async stillRefinable(pending: PendingRefinement): Promise<boolean> {
    const meta = await this.metadata.read();
    return meta.titleKind === 'replaceable' && meta.title === pending.easyTitle;
  }

  private async requestTitle(prompt: string, signal: AbortSignal): Promise<string | undefined> {
    const main = this.agents.get(MAIN_AGENT_ID);
    if (main === undefined) return undefined;
    const profile = main.accessor.get(IAgentProfileService);
    const requester = this.modelCatalog.getRequester(profile.resolveModelContext().modelAlias);
    const excerpt = await main.accessor.get(IAgentTitlePromptSource).firstTurnExcerpt();
    let message: Message | undefined;
    for await (const event of requester.request(
      {
        systemPrompt: LLM_TITLE_SYSTEM_PROMPT,
        tools: [],
        messages: [createUserMessage(llmTitleInput(prompt, excerpt.assistant))],
      },
      signal,
      { thinkingEffort: 'off', maxCompletionTokens: LLM_TITLE_MAX_COMPLETION_TOKENS },
    )) {
      if (event.type === 'finish') message = event.message;
    }
    if (message === undefined) return undefined;
    return sanitizeLlmTitle(extractText(message));
  }
}

function llmTitleInput(prompt: string, reply: string | undefined): string {
  if (reply === undefined) return prompt.slice(0, LLM_TITLE_MAX_PROMPT_CHARS);
  return (
    `<request>\n${prompt.slice(0, LLM_TITLE_MAX_REQUEST_CHARS)}\n</request>\n` +
    `<response>\n${reply.slice(0, LLM_TITLE_MAX_RESPONSE_CHARS)}\n</response>`
  );
}

function sanitizeLlmTitle(raw: string): string | undefined {
  const collapsed = raw.replaceAll(/\s+/g, ' ').trim();
  const unquoted = collapsed.replaceAll(/^["'“”‘’「」『』`]+|["'“”‘’「」『』`]+$/g, '').trim();
  if (unquoted.length === 0) return undefined;
  return unquoted.slice(0, LLM_TITLE_MAX_LENGTH);
}

registerScopedService(
  LifecycleScope.Session,
  ISessionLlmTitleRefinement,
  SessionLlmTitleRefinementService,
  ScopeActivation.OnScopeCreated,
  'sessionTitle',
);
