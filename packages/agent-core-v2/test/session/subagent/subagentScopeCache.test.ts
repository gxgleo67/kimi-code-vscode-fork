import { afterEach, describe, expect, it, vi } from 'vitest';

import { toDisposable, type IDisposable } from '#/_base/di/lifecycle';
import type { IAgentScopeHandle } from '#/_base/di/scope';
import type { Event2, Event2Class } from '#/app/event/event2';
import { IEventBus } from '#/app/event/eventBus';
import type { ILogService } from '#/_base/log/log';
import { IAgentLoopService } from '#/agent/loop/loop';
import { IAgentTaskService } from '#/agent/task/task';
import { IEventDispatcher } from '#/state/eventDispatcher';
import { Error2, ErrorCodes } from '#/errors';
import type { IAgentLifecycleService } from '#/session/agentLifecycle/agentLifecycle';
import { createAgentAwaitingClose } from '#/session/agentLifecycle/createAwaitingClose';
import {
  SubagentCancelled,
  SubagentCompleted,
  SubagentFailed,
  SubagentStarted,
} from '#/session/subagent/mirrorAgentRun';
import {
  DEFAULT_SUBAGENT_SCOPE_CACHE_SIZE,
  DEFAULT_SUBAGENT_SCOPE_EVICT_TIMEOUT_MS,
  resolveSubagentScopeCacheSize,
  resolveSubagentScopeEvictTimeoutMs,
  SUBAGENT_SCOPE_CACHE_SIZE_ENV,
  SUBAGENT_SCOPE_EVICT_TIMEOUT_ENV,
} from '#/session/subagent/subagentScopeCache';
import { SessionSubagentScopeCacheService } from '#/session/subagent/subagentScopeCacheService';

const noopLog = {
  _serviceBrand: undefined,
  level: 'off',
  setLevel: () => {},
  flush: async () => {},
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  child: () => noopLog,
} as unknown as ILogService;

class StubAgentBus implements IEventBus {
  readonly _serviceBrand = undefined;
  private readonly typedHandlers = new Map<string, Array<(event: Event2) => void>>();

  publish(event: Event2): void {
    for (const handler of this.typedHandlers.get(event.type) ?? []) handler(event);
  }

  subscribe(
    typeOrHandler: string | Event2Class | ((event: Event2) => void),
    maybeHandler?: (event: Event2) => void,
  ): IDisposable {
    if (typeof typeOrHandler === 'function' && !('type' in typeOrHandler)) {
      return toDisposable(() => {});
    }
    const type =
      typeof typeOrHandler === 'string' ? typeOrHandler : (typeOrHandler as Event2Class).type;
    const list = this.typedHandlers.get(type) ?? [];
    const handler = maybeHandler!;
    list.push(handler);
    this.typedHandlers.set(type, list);
    return toDisposable(() => {
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    });
  }
}

interface FakeAgentOptions {
  readonly running?: boolean;
  readonly hasPendingRequests?: boolean;
  readonly activeTasks?: number;
  readonly flushError?: unknown;
}

function fakeAgentHandle(agentId: string, bus: StubAgentBus, options: FakeAgentOptions = {}) {
  const state = {
    running: options.running ?? false,
    hasPendingRequests: options.hasPendingRequests ?? false,
    activeTasks: options.activeTasks ?? 0,
    flushError: options.flushError as unknown,
  };
  const handle = {
    id: agentId,
    kind: 'agent',
    accessor: {
      get: (token: unknown): unknown => {
        if (token === IEventBus) return bus;
        if (token === IAgentLoopService) {
          return {
            status: () => ({
              state: state.running ? 'running' : 'idle',
              hasPendingRequests: state.hasPendingRequests,
            }),
          };
        }
        if (token === IAgentTaskService) {
          return { list: () => Array.from({ length: state.activeTasks }, () => ({})) };
        }
        if (token === IEventDispatcher) {
          return {
            flush: async () => {
              if (state.flushError !== undefined) throw state.flushError;
            },
          };
        }
        throw new Error(`unexpected accessor get: ${String(token)}`);
      },
    },
    dispose: () => {},
  } as unknown as IAgentScopeHandle;
  return { handle, state };
}

class FakeAgentLifecycle {
  private readonly handles = new Map<string, IAgentScopeHandle>();
  private readonly createListeners: Array<(handle: IAgentScopeHandle) => void> = [];
  private readonly disposeListeners: Array<(agentId: string) => void> = [];
  readonly removed: string[] = [];
  removeImpl: (agentId: string) => Promise<void> = async (agentId) => {
    this.handles.delete(agentId);
    this.fireDispose(agentId);
  };

  get onDidCreate() {
    return (listener: (handle: IAgentScopeHandle) => void): IDisposable => {
      this.createListeners.push(listener);
      return toDisposable(() => {});
    };
  }

  get onDidDispose() {
    return (listener: (agentId: string) => void): IDisposable => {
      this.disposeListeners.push(listener);
      return toDisposable(() => {});
    };
  }

  get(agentId: string): IAgentScopeHandle | undefined {
    return this.handles.get(agentId);
  }

  list(): readonly IAgentScopeHandle[] {
    return [...this.handles.values()];
  }

  add(handle: IAgentScopeHandle): void {
    this.handles.set(handle.id, handle);
    for (const listener of this.createListeners) listener(handle);
  }

  async remove(agentId: string): Promise<void> {
    this.removed.push(agentId);
    await this.removeImpl(agentId);
  }

  fireDispose(agentId: string): void {
    for (const listener of this.disposeListeners) listener(agentId);
  }
}

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('resolveSubagentScopeCacheSize', () => {
  afterEach(() => {
    setEnv(SUBAGENT_SCOPE_CACHE_SIZE_ENV, undefined);
    setEnv(SUBAGENT_SCOPE_EVICT_TIMEOUT_ENV, undefined);
  });

  it('defaults when unset or blank', () => {
    expect(resolveSubagentScopeCacheSize({})).toBe(DEFAULT_SUBAGENT_SCOPE_CACHE_SIZE);
    expect(resolveSubagentScopeCacheSize({ [SUBAGENT_SCOPE_CACHE_SIZE_ENV]: '  ' })).toBe(
      DEFAULT_SUBAGENT_SCOPE_CACHE_SIZE,
    );
    expect(resolveSubagentScopeEvictTimeoutMs({})).toBe(DEFAULT_SUBAGENT_SCOPE_EVICT_TIMEOUT_MS);
  });

  it('parses integers and clamps cache size at zero', () => {
    expect(resolveSubagentScopeCacheSize({ [SUBAGENT_SCOPE_CACHE_SIZE_ENV]: '5' })).toBe(5);
    expect(resolveSubagentScopeCacheSize({ [SUBAGENT_SCOPE_CACHE_SIZE_ENV]: '-3' })).toBe(0);
    expect(
      resolveSubagentScopeEvictTimeoutMs({ [SUBAGENT_SCOPE_EVICT_TIMEOUT_ENV]: '250' }),
    ).toBe(250);
  });

  it('rejects non-integer values', () => {
    expect(() => resolveSubagentScopeCacheSize({ [SUBAGENT_SCOPE_CACHE_SIZE_ENV]: 'x' })).toThrow(
      /must be an integer/,
    );
    expect(() =>
      resolveSubagentScopeEvictTimeoutMs({ [SUBAGENT_SCOPE_EVICT_TIMEOUT_ENV]: '0' }),
    ).toThrow(/must be a positive integer/);
  });
});

describe('SessionSubagentScopeCacheService', () => {
  afterEach(() => {
    setEnv(SUBAGENT_SCOPE_CACHE_SIZE_ENV, undefined);
    setEnv(SUBAGENT_SCOPE_EVICT_TIMEOUT_ENV, undefined);
  });

  function setup(capacity: number, evictTimeoutMs?: number) {
    setEnv(SUBAGENT_SCOPE_CACHE_SIZE_ENV, String(capacity));
    if (evictTimeoutMs !== undefined) {
      setEnv(SUBAGENT_SCOPE_EVICT_TIMEOUT_ENV, String(evictTimeoutMs));
    }
    const lifecycle = new FakeAgentLifecycle();
    const service = new SessionSubagentScopeCacheService(
      lifecycle as unknown as IAgentLifecycleService,
      noopLog,
    );
    return { lifecycle, service };
  }

  it('evicts the oldest retired subagent scope over capacity', async () => {
    const { lifecycle, service } = setup(1);
    const a = fakeAgentHandle('agent-1', new StubAgentBus());
    const b = fakeAgentHandle('agent-2', new StubAgentBus());
    lifecycle.add(a.handle);
    lifecycle.add(b.handle);

    a.handle.accessor.get(IEventBus).publish(new SubagentCompleted({ subagentId: 'agent-1', resultSummary: '' }));
    b.handle.accessor.get(IEventBus).publish(new SubagentCompleted({ subagentId: 'agent-2', resultSummary: '' }));
    await vi.waitFor(() => expect(lifecycle.removed).toEqual(['agent-1']));

    expect(lifecycle.get('agent-1')).toBeUndefined();
    expect(lifecycle.get('agent-2')).toBeDefined();
    service.dispose();
  });

  it('revives a retired subagent when it starts again', async () => {
    const { lifecycle, service } = setup(1);
    const busA = new StubAgentBus();
    const a = fakeAgentHandle('agent-1', busA);
    const b = fakeAgentHandle('agent-2', new StubAgentBus());
    const c = fakeAgentHandle('agent-3', new StubAgentBus());
    lifecycle.add(a.handle);
    lifecycle.add(b.handle);
    lifecycle.add(c.handle);

    busA.publish(new SubagentCompleted({ subagentId: 'agent-1', resultSummary: '' }));
    busA.publish(new SubagentStarted({ subagentId: 'agent-1' }));
    b.handle.accessor.get(IEventBus).publish(new SubagentCompleted({ subagentId: 'agent-2', resultSummary: '' }));
    c.handle.accessor.get(IEventBus).publish(new SubagentCompleted({ subagentId: 'agent-3', resultSummary: '' }));
    await vi.waitFor(() => expect(lifecycle.removed).toEqual(['agent-2']));

    expect(lifecycle.get('agent-1')).toBeDefined();
    expect(lifecycle.get('agent-3')).toBeDefined();
    service.dispose();
  });

  it('defers eviction while the subagent is busy', async () => {
    const { lifecycle, service } = setup(1);
    const busA = new StubAgentBus();
    const a = fakeAgentHandle('agent-1', busA, { running: true });
    const b = fakeAgentHandle('agent-2', new StubAgentBus());
    lifecycle.add(a.handle);
    lifecycle.add(b.handle);

    busA.publish(new SubagentCompleted({ subagentId: 'agent-1', resultSummary: '' }));
    b.handle.accessor.get(IEventBus).publish(new SubagentCompleted({ subagentId: 'agent-2', resultSummary: '' }));
    await vi.waitFor(() => expect(lifecycle.removed).toEqual(['agent-2']));

    expect(lifecycle.get('agent-1')).toBeDefined();
    service.dispose();
  });

  it('keeps the scope resident when the wire flush fails', async () => {
    const { lifecycle, service } = setup(1);
    const busA = new StubAgentBus();
    const a = fakeAgentHandle('agent-1', busA, { flushError: new Error('disk full') });
    const b = fakeAgentHandle('agent-2', new StubAgentBus());
    lifecycle.add(a.handle);
    lifecycle.add(b.handle);

    busA.publish(new SubagentFailed({ subagentId: 'agent-1', error: 'boom' }));
    b.handle.accessor.get(IEventBus).publish(new SubagentCancelled({ subagentId: 'agent-2' }));
    await vi.waitFor(() => expect(lifecycle.removed).toEqual(['agent-2']));

    expect(lifecycle.get('agent-1')).toBeDefined();
    service.dispose();
  });

  it('does nothing when the cache size is zero', async () => {
    const { lifecycle, service } = setup(0);
    const busA = new StubAgentBus();
    const a = fakeAgentHandle('agent-1', busA);
    lifecycle.add(a.handle);

    busA.publish(new SubagentCompleted({ subagentId: 'agent-1', resultSummary: '' }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(lifecycle.removed).toEqual([]);
    expect(lifecycle.get('agent-1')).toBeDefined();
    service.dispose();
  });
});

describe('createAgentAwaitingClose', () => {
  it('retries while the previous scope is closing', async () => {
    let attempts = 0;
    const handle = fakeAgentHandle('agent-1', new StubAgentBus()).handle;
    const lifecycle = {
      create: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error2(ErrorCodes.AGENT_ALREADY_EXISTS, 'exists');
        }
        return handle;
      },
    };
    const result = await createAgentAwaitingClose(
      lifecycle as unknown as IAgentLifecycleService,
      { agentId: 'agent-1' },
    );
    expect(result).toBe(handle);
    expect(attempts).toBe(3);
  });

  it('stops retrying when the caller aborts', async () => {
    const controller = new AbortController();
    const lifecycle = {
      create: async () => {
        controller.abort();
        throw new Error2(ErrorCodes.AGENT_ALREADY_EXISTS, 'exists');
      },
    };
    await expect(
      createAgentAwaitingClose(
        lifecycle as unknown as IAgentLifecycleService,
        { agentId: 'agent-1' },
        controller.signal,
      ),
    ).rejects.toThrow();
  });
});
