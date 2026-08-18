import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DisposableStore, type IDisposable } from '#/_base/di/lifecycle';
import { createServices, type TestInstantiationService } from '#/_base/di/test';
import type { IAgentScopeHandle } from '#/_base/di/scope';
import { LifecycleScope } from '#/app/scopes';
import { Emitter } from '#/_base/event';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IEventService } from '#/app/event/event';
import { IEventBus } from '#/app/event/eventBus';
import type { Event2, Event2Class } from '#/app/event/event2';
import { IAgentProfileService } from '#/agent/profile/profile';
import { TurnEnded } from '#/agent/loop/turnOps';
import { titleFromPromptMetadataText } from '#/agent/prompt/promptMetadataText';
import { createAssistantMessage } from '#/kosong/contract/message';
import { IModelCatalog } from '#/kosong/model/catalog';
import type {
  ModelRequestEvent,
  ModelRequestInput,
  ModelRequestParams,
  ModelRequester,
} from '#/kosong/model/modelRequester';
import {
  IAgentLifecycleService,
  MAIN_AGENT_ID,
} from '#/session/agentLifecycle/agentLifecycle';
import { ISessionContext, makeSessionContext } from '#/session/sessionContext/sessionContext';
import {
  ISessionMetadata,
  type SessionMeta,
  type SessionMetaPatch,
  type SessionMetadataChangedEvent,
} from '#/session/sessionMetadata/sessionMetadata';
import { SessionMetaUpdated } from '#/session/sessionMetadata/sessionMetaEvents';
import {
  IAgentTitlePromptSource,
  type TitleTurnExcerpt,
} from '#/session/sessionTitle/agentTitlePromptSource';
import { ISessionLlmTitleRefinement } from '#/session/sessionTitle/llmTitleRefinement';
import { SessionLlmTitleRefinementService } from '#/session/sessionTitle/llmTitleRefinementService';

import { registerLogServices } from '../../_base/log/stubs';

const SESSION_ID = 'sess-llm-title';
const MODEL_ALIAS = 'test-model';
const FIRST_PROMPT = '帮我修复登录页的崩溃问题';
const FIRST_REPLY = '好的，我先查看登录页代码。';

class FakeBus {
  private readonly handlers = new Map<string, Array<(e: Event2) => void>>();

  publish(event: Event2): void {
    for (const h of this.handlers.get(event.type) ?? []) h(event);
  }

  subscribe(typeOrClass: unknown, handler?: unknown) {
    const type =
      typeof typeOrClass === 'string' ? typeOrClass : (typeOrClass as Event2Class).type;
    const list = this.handlers.get(type) ?? [];
    const fn = handler as (e: Event2) => void;
    list.push(fn);
    this.handlers.set(type, list);
    return { dispose: () => this.handlers.set(type, list.filter((h) => h !== fn)) };
  }
}

class FakeEventService implements IEventService {
  declare readonly _serviceBrand: undefined;
  private readonly emitter = new Emitter<Event2>();
  readonly onDidPublish = this.emitter.event;
  readonly published: Event2[] = [];

  publish(event: Event2): void {
    this.published.push(event);
    this.emitter.fire(event);
  }

  subscribe(handler: (event: Event2) => void): IDisposable {
    return this.emitter.event(handler);
  }
}

class FakeSessionMetadata implements ISessionMetadata {
  declare readonly _serviceBrand: undefined;
  readonly ready = Promise.resolve();
  private readonly emitter = new Emitter<SessionMetadataChangedEvent>();
  readonly onDidChangeMetadata = this.emitter.event;
  meta: SessionMeta = { id: SESSION_ID, createdAt: 0, updatedAt: 0, archived: false };

  read(): Promise<SessionMeta> {
    return Promise.resolve(this.meta);
  }

  update(patch: SessionMetaPatch): Promise<void> {
    this.meta = { ...this.meta, ...patch };
    this.emitter.fire({ changed: Object.keys(patch) as (keyof SessionMeta)[] });
    return Promise.resolve();
  }

  setTitle(title: string): Promise<void> {
    return this.update({ title, titleKind: 'custom' });
  }

  async setGeneratedTitleIfUncustomized(
    title: string,
    opts?: { force?: boolean },
  ): Promise<boolean> {
    if (opts?.force !== true && this.meta.titleKind === 'custom') return false;
    await this.update({ title, titleKind: 'generated' });
    return true;
  }

  setArchived(archived: boolean): Promise<void> {
    return this.update({ archived });
  }

  registerAgent(): Promise<void> {
    return Promise.resolve();
  }
}

interface RequestGate {
  readonly promise: Promise<void>;
  readonly release: () => void;
}

function createGate(): RequestGate {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SessionLlmTitleRefinementService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let metadata: FakeSessionMetadata;
  let events: FakeEventService;
  let bus: FakeBus;
  let productName: string;
  let responses: (string | Error)[];
  let turnExcerpt: TitleTurnExcerpt;
  let gate: RequestGate | undefined;
  let requestCount: number;
  let capturedAliases: string[];
  let capturedInputs: ModelRequestInput[];
  let capturedParams: (ModelRequestParams | undefined)[];

  const until = async (condition: () => boolean): Promise<void> => {
    for (let i = 0; i < 50 && !condition(); i++) await tick();
    expect(condition()).toBe(true);
  };

  const writeEasyTitle = async (prompt: string): Promise<string> => {
    const easyTitle = titleFromPromptMetadataText(prompt);
    await metadata.update({ lastPrompt: prompt, title: easyTitle, titleKind: 'replaceable' });
    return easyTitle;
  };

  const turnEnded = (turnId = 1) => {
    bus.publish(new TurnEnded({ turnId, reason: 'completed' }));
  };

  const metaUpdatedEvents = () =>
    events.published.filter((e): e is SessionMetaUpdated => e instanceof SessionMetaUpdated);

  beforeEach(() => {
    productName = 'kimi-code-vscode';
    responses = ['"修复登录崩溃"\n'];
    turnExcerpt = { user: FIRST_PROMPT, assistant: FIRST_REPLY };
    gate = undefined;
    requestCount = 0;
    capturedAliases = [];
    capturedInputs = [];
    capturedParams = [];

    metadata = new FakeSessionMetadata();
    events = new FakeEventService();
    bus = new FakeBus();

    const requester = {
      model: { id: MODEL_ALIAS, name: MODEL_ALIAS },
      request: (input: ModelRequestInput, _signal?: AbortSignal, params?: ModelRequestParams) => {
        capturedInputs.push(input);
        capturedParams.push(params);
        const index = requestCount++;
        return (async function* (): AsyncGenerator<ModelRequestEvent> {
          if (gate !== undefined) await gate.promise;
          const response = responses[Math.min(index, responses.length - 1)]!;
          if (response instanceof Error) throw response;
          yield { type: 'finish', message: createAssistantMessage([{ type: 'text', text: response }]) };
        })();
      },
    } as unknown as ModelRequester;

    const mainAgent = {
      id: MAIN_AGENT_ID,
      kind: LifecycleScope.Agent,
      accessor: {
        get: (token: unknown) => {
          if (token === IEventBus) return bus;
          if (token === IAgentProfileService) {
            return { resolveModelContext: () => ({ modelAlias: MODEL_ALIAS }) };
          }
          if (token === IAgentTitlePromptSource) {
            return { firstTurnExcerpt: async () => turnExcerpt };
          }
          return undefined;
        },
      },
      dispose: () => undefined,
    } as unknown as IAgentScopeHandle;

    const createEmitter = new Emitter<IAgentScopeHandle>();
    const disposeEmitter = new Emitter<string>();

    disposables = new DisposableStore();
    ix = createServices(disposables, {
      base: [registerLogServices],
      additionalServices: (reg) => {
        reg.defineInstance(
          ISessionContext,
          makeSessionContext({
            sessionId: SESSION_ID,
            workspaceId: 'ws-1',
            sessionDir: '/tmp/sess-llm-title',
            sessionScope: 'sessions/sess-llm-title',
            cwd: '/tmp',
          }),
        );
        reg.defineInstance(ISessionMetadata, metadata);
        reg.defineInstance(IEventService, events);
        reg.definePartialInstance(IBootstrapService, {
          clientIdentity: {
            get productName() {
              return productName;
            },
            version: '0.0.0-test',
            platform: 'test_platform',
          },
        });
        reg.definePartialInstance(IModelCatalog, {
          getRequester: (id: string) => {
            capturedAliases.push(id);
            return requester;
          },
        });
        reg.definePartialInstance(IAgentLifecycleService, {
          get: (agentId: string) => (agentId === MAIN_AGENT_ID ? mainAgent : undefined),
          onDidCreate: createEmitter.event,
          onDidDispose: disposeEmitter.event,
        });
        reg.define(ISessionLlmTitleRefinement, SessionLlmTitleRefinementService);
      },
    });
  });

  afterEach(() => {
    disposables.dispose();
  });

  it('replaces the easy title with a refined title once the first turn ends', async () => {
    ix.get(ISessionLlmTitleRefinement);
    const easyTitle = await writeEasyTitle(FIRST_PROMPT);
    await tick();

    turnEnded();
    await until(() => metadata.meta.titleKind === 'generated');

    expect(metadata.meta.title).toBe('修复登录崩溃');
    expect(capturedAliases).toEqual([MODEL_ALIAS]);
    expect(capturedParams[0]).toMatchObject({ thinkingEffort: 'off', maxCompletionTokens: 1024 });

    const input = capturedInputs[0]!;
    expect(input.systemPrompt).toContain('3-6 words');
    expect(input.tools).toEqual([]);
    const part = input.messages[0]?.content[0];
    const text = part?.type === 'text' ? part.text : '';
    expect(text).toContain(`<request>\n${FIRST_PROMPT}\n</request>`);
    expect(text).toContain(`<response>\n${FIRST_REPLY}\n</response>`);

    const published = metaUpdatedEvents();
    expect(published).toHaveLength(1);
    expect(published[0]!.payload.sessionId).toBe(SESSION_ID);
    expect(published[0]!.payload.patch).toEqual({
      title: '修复登录崩溃',
      isCustomTitle: false,
      lastPrompt: FIRST_PROMPT,
    });

    turnEnded(2);
    await tick();
    expect(requestCount).toBe(1);
    expect(metadata.meta.title).not.toBe(easyTitle);
  });

  it('never replaces a custom title, and never issues the request', async () => {
    ix.get(ISessionLlmTitleRefinement);
    await writeEasyTitle(FIRST_PROMPT);
    await metadata.setTitle('用户自己改的标题');
    await tick();

    turnEnded();
    await tick();

    expect(requestCount).toBe(0);
    expect(metadata.meta.title).toBe('用户自己改的标题');
    expect(metadata.meta.titleKind).toBe('custom');
    expect(metaUpdatedEvents()).toEqual([]);
  });

  it('does not overwrite a custom title set while the request is in flight', async () => {
    gate = createGate();
    ix.get(ISessionLlmTitleRefinement);
    await writeEasyTitle(FIRST_PROMPT);
    await tick();

    turnEnded();
    await until(() => requestCount === 1);

    await metadata.setTitle('飞行中改名');
    gate.release();
    await tick();
    await tick();

    expect(metadata.meta.title).toBe('飞行中改名');
    expect(metadata.meta.titleKind).toBe('custom');
    expect(metaUpdatedEvents()).toEqual([]);
  });

  it('stays inert for non-vscode hosts', async () => {
    productName = 'kimi-code-cli';
    ix.get(ISessionLlmTitleRefinement);
    const easyTitle = await writeEasyTitle(FIRST_PROMPT);
    await tick();

    turnEnded();
    await tick();

    expect(requestCount).toBe(0);
    expect(metadata.meta.title).toBe(easyTitle);
    expect(metadata.meta.titleKind).toBe('replaceable');
    expect(metaUpdatedEvents()).toEqual([]);
  });

  it('retries when the model returns no text and applies a later success', async () => {
    responses = ['   ', '重试后的标题'];
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      ix.get(ISessionLlmTitleRefinement);
      const easyTitle = await writeEasyTitle(FIRST_PROMPT);
      await vi.advanceTimersByTimeAsync(0);

      turnEnded();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(requestCount).toBe(1);
      expect(metadata.meta.title).toBe(easyTitle);

      await vi.advanceTimersByTimeAsync(8_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(requestCount).toBe(2);
      expect(metadata.meta.title).toBe('重试后的标题');
      expect(metadata.meta.titleKind).toBe('generated');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after three failed attempts and never reschedules', async () => {
    responses = [new Error('provider down')];
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      ix.get(ISessionLlmTitleRefinement);
      const easyTitle = await writeEasyTitle(FIRST_PROMPT);
      await vi.advanceTimersByTimeAsync(0);

      turnEnded();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(8_000);
      await vi.advanceTimersByTimeAsync(8_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(requestCount).toBe(3);
      expect(metadata.meta.title).toBe(easyTitle);
      expect(metadata.meta.titleKind).toBe('replaceable');

      turnEnded(2);
      await vi.advanceTimersByTimeAsync(0);
      expect(requestCount).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
