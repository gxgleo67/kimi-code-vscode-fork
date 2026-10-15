import { afterEach, describe, expect, it } from 'vitest';

import { Emitter, Event } from '#/_base/event';
import type { ServiceIdentifier } from '#/_base/di/instantiation';
import { LifecycleScope } from '#/app/scopes';
import { type IAgentScopeHandle } from '#/_base/di/scope';
import { CRON_SESSION_TAG, type CronTask } from '#/app/cron/cronTask';
import { ICronTaskPersistence } from '#/app/cron/cronTaskPersistence';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import type { ContextMessage } from '#/agent/contextMemory/types';
import { IAgentLifecycleService } from '#/session/agentLifecycle/agentLifecycle';
import { ISessionCronService } from '#/session/cron/sessionCronService';

import { createTestAgent, sessionService, type TestAgentContext } from '../../harness';

const WORKSPACE_ID = 'test-workspace';
const SOURCE_SESSION_ID = 'source-session';

function sourceTask(id: string, prompt: string): CronTask {
  return {
    id,
    cron: '0 9 * * *',
    prompt,
    createdAt: 1,
    recurring: true,
    tags: { [CRON_SESSION_TAG]: SOURCE_SESSION_ID },
  };
}

function textOf(message: ContextMessage): string {
  return message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

describe('session cron fork handoff', () => {
  const contexts: TestAgentContext[] = [];

  function forkedSession(): TestAgentContext {
    let mainHandle: IAgentScopeHandle | undefined;
    const lifecycleStub: IAgentLifecycleService = {
      _serviceBrand: undefined,
      onDidCreate: Event.None as Event<IAgentScopeHandle>,
      onDidDispose: Event.None as Event<string>,
      create: () => Promise.reject(new Error('not supported in this test')),
      fork: () => Promise.reject(new Error('not supported in this test')),
      get: (agentId) => (agentId === 'main' ? mainHandle : undefined),
      list: () => (mainHandle === undefined ? [] : [mainHandle]),
      broadcastPermissionMode: () => {},
      remove: () => Promise.resolve(),
    };
    const ctx = createTestAgent(sessionService(IAgentLifecycleService, lifecycleStub));
    contexts.push(ctx);
    const accessor = { get: <T,>(id: ServiceIdentifier<T>): T => ctx.get(id) };
    mainHandle = { id: 'main', kind: LifecycleScope.Agent, accessor, dispose: () => {} };
    ctx.kimiConfig = {
      ...ctx.kimiConfig,
      cron: {
        debug: false,
        noJitter: true,
        noStale: false,
        disabled: false,
        manualTick: true,
      },
    };
    return ctx;
  }

  afterEach(async () => {
    for (const ctx of contexts.splice(0)) await ctx.dispose();
  });

  it('keeps the source session tasks out of the fork and tells the model once', async () => {
    const ctx = forkedSession();
    await ctx.get(ICronTaskPersistence).save(WORKSPACE_ID, sourceTask('aa11bb22', 'inherited'));

    const cron = ctx.get(ISessionCronService);
    await cron.notifySessionForked(SOURCE_SESSION_ID);

    expect(cron.list()).toEqual([]);
    const reminder = ctx.get(IAgentContextMemoryService).get().at(-1);
    expect(reminder?.origin).toEqual({ kind: 'injection', variant: 'cron_fork_cleared' });
    const text = textOf(reminder!);
    expect(text).toContain('This fork does not have any scheduled cron tasks.');
    expect(text).toContain('Tasks from the source session continue to run in the source session.');
  });

  it('stays silent when the source session never scheduled a task', async () => {
    const ctx = forkedSession();

    const cron = ctx.get(ISessionCronService);
    await cron.notifySessionForked(SOURCE_SESSION_ID);

    expect(cron.list()).toEqual([]);
    expect(ctx.get(IAgentContextMemoryService).get()).toEqual([]);
  });

  it('leaves tasks created inside the fork untouched', async () => {
    const ctx = forkedSession();
    await ctx.get(ICronTaskPersistence).save(WORKSPACE_ID, sourceTask('aa11bb22', 'inherited'));

    const cron = ctx.get(ISessionCronService);
    await cron.notifySessionForked(SOURCE_SESSION_ID);
    cron.addTask({ cron: '0 10 * * *', prompt: 'fork own', recurring: true });
    await cron.flushPersist();
    await cron.loadFromStore();

    expect(cron.list().map((task) => task.prompt)).toEqual(['fork own']);
  });
});
