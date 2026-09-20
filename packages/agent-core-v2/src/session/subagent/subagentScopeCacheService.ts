import { Disposable, DisposableStore } from '#/_base/di/lifecycle';
import type { IAgentScopeHandle } from '#/_base/di/scope';
import { onUnexpectedError } from '#/_base/errors/unexpectedError';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { LifecycleScope } from '#/app/scopes';
import { IEventBus } from '#/app/event/eventBus';
import { IAgentLoopService } from '#/agent/loop/loop';
import { IAgentTaskService } from '#/agent/task/task';
import { SubagentSuspended } from '#/features/swarm/session/sessionSwarmService';
import { IAgentLifecycleService } from '#/session/agentLifecycle/agentLifecycle';
import { ILogService } from '#/_base/log/log';
import { IEventDispatcher } from '#/state/eventDispatcher';

import { SubagentCancelled, SubagentCompleted, SubagentFailed, SubagentStarted } from './mirrorAgentRun';
import {
  ISessionSubagentScopeCacheService,
  resolveSubagentScopeCacheSize,
  resolveSubagentScopeEvictTimeoutMs,
} from './subagentScopeCache';

const MAX_EVICT_ATTEMPTS = 3;

type EvictOutcome = 'removed' | 'missing' | 'closing' | 'deferred' | 'timeout' | 'failed';

export class SessionSubagentScopeCacheService
  extends Disposable
  implements ISessionSubagentScopeCacheService
{
  declare readonly _serviceBrand: undefined;

  private readonly capacity: number;
  private readonly removeTimeoutMs: number;
  private readonly retired = new Map<string, number>();
  private readonly closing = new Set<string>();
  private readonly agentSubscriptions = new Map<string, DisposableStore>();
  private evictions: Promise<void> = Promise.resolve();

  constructor(
    @IAgentLifecycleService private readonly agentLifecycle: IAgentLifecycleService,
    @ILogService private readonly log: ILogService,
  ) {
    super();
    this.capacity = resolveSubagentScopeCacheSize();
    this.removeTimeoutMs = resolveSubagentScopeEvictTimeoutMs();
    if (this.capacity === 0) return;
    for (const handle of this.agentLifecycle.list()) this.attachAgent(handle);
    this._register(
      this.agentLifecycle.onDidCreate((handle) => {
        this.revive(handle.id);
        this.attachAgent(handle);
      }),
    );
    this._register(
      this.agentLifecycle.onDidDispose((agentId) => {
        this.closing.delete(agentId);
        this.revive(agentId);
        this.agentSubscriptions.get(agentId)?.dispose();
        this.agentSubscriptions.delete(agentId);
      }),
    );
  }

  private attachAgent(handle: IAgentScopeHandle): void {
    if (this.agentSubscriptions.has(handle.id)) return;
    const bus = handle.accessor.get(IEventBus);
    const store = new DisposableStore();
    store.add(bus.subscribe(SubagentCompleted, (event) => this.retire(event.subagentId)));
    store.add(bus.subscribe(SubagentFailed, (event) => this.retire(event.subagentId)));
    store.add(bus.subscribe(SubagentCancelled, (event) => this.retire(event.subagentId)));
    store.add(bus.subscribe(SubagentStarted, (event) => this.revive(event.subagentId)));
    store.add(bus.subscribe(SubagentSuspended, (event) => this.revive(event.subagentId)));
    this.agentSubscriptions.set(handle.id, store);
  }

  private retire(agentId: string): void {
    this.retired.delete(agentId);
    this.retired.set(agentId, 0);
    this.evictions = this.evictions.then(() => this.evictOverflow()).catch(onUnexpectedError);
  }

  private revive(agentId: string): void {
    this.retired.delete(agentId);
  }

  private async evictOverflow(): Promise<void> {
    const skipped = new Set<string>();
    while (this.retired.size > this.capacity) {
      const candidate = this.oldestCandidate(skipped);
      if (candidate === undefined) return;
      const [agentId, attempts] = candidate;
      this.retired.delete(agentId);
      const outcome = await this.evict(agentId);
      if (outcome === 'removed' || outcome === 'missing') continue;
      skipped.add(agentId);
      if (outcome === 'deferred') {
        this.log.debug('subagent scope eviction deferred; agent still busy', { agentId });
        if (!this.retired.has(agentId)) this.retired.set(agentId, attempts);
        continue;
      }
      if (outcome === 'closing' || outcome === 'failed') {
        if (!this.retired.has(agentId)) this.retired.set(agentId, attempts);
        continue;
      }
      const nextAttempt = attempts + 1;
      if (nextAttempt >= MAX_EVICT_ATTEMPTS) {
        this.log.warn('subagent scope eviction abandoned; agent still busy', {
          agentId,
          attempts: nextAttempt,
        });
      }
      if (!this.retired.has(agentId)) this.retired.set(agentId, nextAttempt);
    }
  }

  private oldestCandidate(skipped: ReadonlySet<string>): [string, number] | undefined {
    for (const entry of this.retired) {
      if (entry[1] < MAX_EVICT_ATTEMPTS && !skipped.has(entry[0])) return entry;
    }
    return undefined;
  }

  private async evict(agentId: string): Promise<EvictOutcome> {
    const handle = this.agentLifecycle.get(agentId);
    if (handle === undefined) return this.closing.has(agentId) ? 'closing' : 'missing';
    if (this.busy(handle)) return 'deferred';
    try {
      await handle.accessor.get(IEventDispatcher).flush();
    } catch (error) {
      this.log.warn('subagent scope eviction skipped; wire flush failed', { agentId, error });
      return 'failed';
    }
    if (this.agentLifecycle.get(agentId) !== handle) {
      return this.closing.has(agentId) ? 'closing' : 'missing';
    }
    if (this.busy(handle)) return 'deferred';
    const startedAt = Date.now();
    this.closing.add(agentId);
    const removal = this.agentLifecycle
      .remove(agentId)
      .then(
        () => 'removed' as const,
        (error: unknown) => ({ error }),
      )
      .finally(() => {
        this.closing.delete(agentId);
      });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      removal,
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), this.removeTimeoutMs);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    const durationMs = Date.now() - startedAt;
    if (outcome === 'timeout') {
      this.log.warn('subagent scope eviction timed out; moving on to the next eviction', {
        agentId,
        durationMs,
      });
      return 'timeout';
    }
    if (outcome === 'removed') {
      this.log.debug('subagent scope evicted', { agentId, durationMs });
      return 'removed';
    }
    const gone = this.agentLifecycle.get(agentId) === undefined && !this.closing.has(agentId);
    this.log.warn('subagent scope eviction failed', {
      agentId,
      durationMs,
      error: outcome.error,
    });
    return gone ? 'removed' : 'failed';
  }

  private busy(handle: IAgentScopeHandle): boolean {
    const snapshot = handle.accessor.get(IAgentLoopService).status();
    if (snapshot.state === 'running' || snapshot.hasPendingRequests) return true;
    return handle.accessor.get(IAgentTaskService).list(true).length > 0;
  }
}

registerScopedService(
  LifecycleScope.Session,
  ISessionSubagentScopeCacheService,
  SessionSubagentScopeCacheService,
  ScopeActivation.OnScopeCreated,
  'subagent',
);
