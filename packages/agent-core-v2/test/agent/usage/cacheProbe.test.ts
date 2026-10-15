import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import {
  IAgentLLMRequesterService,
  type AgentLLMTurnRequestSnapshot,
} from '#/agent/llmRequester/llmRequester';
import { IAgentScopeContext, makeAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { IAgentStateService } from '#/agent/state/agentState';
import { AgentStateService } from '#/agent/state/agentStateService';
import { AgentCacheProbeService } from '#/agent/usage/cacheProbeService';
import { IAgentUsageService } from '#/agent/usage/usage';
import { AgentUsageService } from '#/agent/usage/usageService';
import { IEventBus } from '#/app/event/eventBus';
import { EventBusService } from '#/app/event/eventBusService';
import { ITelemetryService } from '#/app/telemetry/telemetry';
import { IModelCatalog } from '#/kosong/model/catalog';
import { IAgentLifecycleService } from '#/session/agentLifecycle/agentLifecycle';
import { ILogService } from '#/_base/log/log';
import { IEventDispatcher } from '#/state/eventDispatcher';
import { EventDispatcherService } from '#/state/eventDispatcherService';
import { AppendLogStore } from '#/persistence/backends/node-fs/appendLogStore';
import { InMemoryStorageService } from '#/persistence/backends/memory/inMemoryStorageService';
import { IAppendLogStore } from '#/persistence/interface/appendLogStore';
import { IFileSystemStorageService } from '#/persistence/interface/storage';

import { registerTestAgentWire, testWireScope } from '../../wire/stubs';
import { stubLog } from '../../_base/log/stubs';

const MODEL = 'model-a';
const USAGE = { inputOther: 1, output: 2, inputCacheRead: 3, inputCacheCreation: 4 };
const TURN = { type: 'turn', turnId: 1 } as const;

function snapshot(
  overrides: Partial<AgentLLMTurnRequestSnapshot> = {},
): AgentLLMTurnRequestSnapshot {
  return {
    modelAlias: MODEL,
    contextRevision: 1,
    toolsHash: 'tools-a',
    systemPromptHash: 'system-a',
    inputTokens: 1_200,
    startedAt: 1_000,
    finishedAt: 4_000,
    ...overrides,
  };
}

interface ProbeStubs {
  readonly parent?: () => AgentLLMTurnRequestSnapshot | undefined;
  readonly parentRevision?: number;
  readonly own?: () => AgentLLMTurnRequestSnapshot | undefined;
}

describe('AgentCacheProbeService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let usage: IAgentUsageService;

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    ix.stub(ITelemetryService, { track: () => {}, track2: () => {} });
    ix.stub(IFileSystemStorageService, new InMemoryStorageService());
    ix.stub(ILogService, stubLog());
    ix.set(IAgentStateService, new AgentStateService());
    ix.set(IAppendLogStore, new SyncDescriptor(AppendLogStore));
    ix.set(IEventBus, new SyncDescriptor(EventBusService));
    ix.set(IAgentUsageService, new SyncDescriptor(AgentUsageService));
    ix.set(IEventDispatcher, new SyncDescriptor(EventDispatcherService));
    registerTestAgentWire(ix, testWireScope('wire', 'cache-probe'), {
      log: ix.get(IAppendLogStore),
      eventBus: ix.get(IEventBus),
    });
    usage = ix.get(IAgentUsageService);
  });

  afterEach(() => disposables.dispose());

  function stubProbe(forkedFrom: string | undefined, stubs: ProbeStubs = {}): ReturnType<typeof vi.fn> {
    const track2 = vi.fn();
    ix.stub(ITelemetryService, { track: () => {}, track2 });
    ix.stub(
      IAgentScopeContext,
      makeAgentScopeContext({ agentId: 'child', agentScope: 'agents/child', forkedFrom }),
    );
    ix.stub(IAgentLLMRequesterService, {
      _serviceBrand: undefined,
      lastTurnRequest: stubs.own ?? (() => undefined),
    } as unknown as IAgentLLMRequesterService);
    const parentRequester = {
      _serviceBrand: undefined,
      lastTurnRequest: stubs.parent ?? (() => undefined),
    } as unknown as IAgentLLMRequesterService;
    const parentContext = {
      _serviceBrand: undefined,
      prefixRevision: () => stubs.parentRevision ?? 1,
    } as unknown as IAgentContextMemoryService;
    ix.stub(IAgentLifecycleService, {
      _serviceBrand: undefined,
      get: (agentId: string) =>
        agentId === forkedFrom
          ? {
              accessor: {
                get: (id: unknown) =>
                  id === IAgentContextMemoryService ? parentContext : parentRequester,
              },
            }
          : undefined,
    } as unknown as IAgentLifecycleService);
    ix.stub(IModelCatalog, {
      _serviceBrand: undefined,
      get: () => ({ protocol: 'anthropic', providerType: 'kimi' }),
    } as unknown as IModelCatalog);
    disposables.add(ix.createInstance(AgentCacheProbeService));
    return track2;
  }

  it('reports the parity fields for a fork whose prefix matches the parent request', () => {
    const track2 = stubProbe('main', {
      parent: () => snapshot(),
      own: () => snapshot({ inputTokens: 8, startedAt: 6_500, finishedAt: 7_000 }),
    });

    usage.record(MODEL, USAGE, TURN);

    expect(track2).toHaveBeenCalledWith('prompt_cache_probe', {
      source: 'fork',
      turn_id: 1,
      provider_type: 'kimi',
      protocol: 'anthropic',
      input_tokens: 8,
      input_cache_read: 3,
      input_cache_creation: 4,
      output_tokens: 2,
      tools_match: true,
      system_prompt_match: true,
      parent_input_tokens: 1_200,
      parent_request_gap_ms: 2_500,
    });
  });

  it('reports a divergent prefix against the parent request', () => {
    const track2 = stubProbe('main', {
      parent: () => snapshot(),
      own: () =>
        snapshot({
          toolsHash: 'tools-b',
          systemPromptHash: 'system-b',
          inputTokens: 8,
          startedAt: 6_500,
          finishedAt: 7_000,
        }),
    });

    usage.record(MODEL, USAGE, TURN);

    expect(track2).toHaveBeenCalledWith(
      'prompt_cache_probe',
      expect.objectContaining({ tools_match: false, system_prompt_match: false }),
    );
  });

  it('leaves the comparison out when the parent completed no turn request', () => {
    const track2 = stubProbe('main', { own: () => snapshot({ inputTokens: 8 }) });

    usage.record(MODEL, USAGE, TURN);

    const [, properties] = track2.mock.calls[0] as [string, Record<string, unknown>];
    expect(track2.mock.calls[0]?.[0]).toBe('prompt_cache_probe');
    expect(properties['tools_match']).toBeUndefined();
    expect(properties['system_prompt_match']).toBeUndefined();
    expect(properties['parent_input_tokens']).toBeUndefined();
    expect(properties['parent_request_gap_ms']).toBeUndefined();
  });

  it('leaves the comparison out when the parent request ran on another model', () => {
    const track2 = stubProbe('main', {
      parent: () => snapshot({ modelAlias: 'model-b' }),
      own: () => snapshot({ inputTokens: 8 }),
    });

    usage.record(MODEL, USAGE, TURN);

    const [, properties] = track2.mock.calls[0] as [string, Record<string, unknown>];
    expect(properties['tools_match']).toBeUndefined();
    expect(properties['system_prompt_match']).toBeUndefined();
    expect(properties['parent_input_tokens']).toBeUndefined();
  });

  it('drops the captured parent request once the parent prefix revision moves on', () => {
    const track2 = stubProbe('main', {
      parent: () => snapshot(),
      parentRevision: 2,
      own: () => snapshot({ inputTokens: 8 }),
    });

    usage.record(MODEL, USAGE, TURN);

    const [, properties] = track2.mock.calls[0] as [string, Record<string, unknown>];
    expect(properties['tools_match']).toBeUndefined();
    expect(properties['system_prompt_match']).toBeUndefined();
    expect(properties['parent_input_tokens']).toBeUndefined();
  });

  it('reports the parent token baseline without a comparison when the child has no snapshot yet', () => {
    const track2 = stubProbe('main', { parent: () => snapshot() });

    usage.record(MODEL, USAGE, TURN);

    const [, properties] = track2.mock.calls[0] as [string, Record<string, unknown>];
    expect(properties['parent_input_tokens']).toBe(1_200);
    expect(properties['tools_match']).toBeUndefined();
  });

  it('probes only the first recorded request', () => {
    const track2 = stubProbe('main', {
      parent: () => snapshot(),
      own: () => snapshot({ inputTokens: 8 }),
    });

    usage.record(MODEL, USAGE, TURN);
    usage.record(MODEL, USAGE, { type: 'turn', turnId: 2 });

    expect(track2).toHaveBeenCalledTimes(1);
  });

  it('stays silent for an agent that was not forked', () => {
    const track2 = stubProbe(undefined, { parent: () => snapshot(), own: () => snapshot() });

    usage.record(MODEL, USAGE, TURN);

    expect(track2).not.toHaveBeenCalled();
  });
});
