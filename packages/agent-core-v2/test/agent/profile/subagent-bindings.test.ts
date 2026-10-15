import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { normalizeAgentProfile } from '#/app/agentProfileCatalog/agentProfileCatalog';
import { IAgentProfileRegistry } from '#/app/agentProfileCatalog/agentProfileRegistry';
import { registerAgentProfile } from '#/app/agentProfileCatalog/contribution';
import { IAgentProfileService } from '#/agent/profile/profile';

import { createTestAgent, hostEnvironmentServices, type TestAgentContext } from '../../harness';

const MOCK_MODEL = 'mock-model';

describe('AgentProfileService subagent allowlist binding', () => {
  let ctx: TestAgentContext | undefined;
  let homeDir: string;

  beforeAll(() => {
    registerAgentProfile({
      name: 'agent',
      description: 'Default agent',
      subagents: ['explore'],
      systemPrompt: () => 'You are the default agent.',
    });
    registerAgentProfile({
      name: 'explore',
      description: 'Explorer',
      systemPrompt: () => 'You are the explorer.',
    });
    registerAgentProfile({
      name: 'delegator',
      description: 'Delegator',
      tools: ['Agent'],
      systemPrompt: () => 'You are the delegator.',
    });
    registerAgentProfile({
      name: 'unrestricted',
      description: 'Unrestricted agent',
      systemPrompt: () => 'You are the unrestricted agent.',
    });
    registerAgentProfile({
      name: 'wild-main',
      description: 'Wildcard main agent',
      subagents: ['*'],
      systemPrompt: () => 'You are the wildcard main agent.',
    });
  });

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'kimi-subagent-binding-'));
  });

  afterEach(async () => {
    await ctx?.dispose();
    ctx = undefined;
    await rm(homeDir, { recursive: true, force: true });
  });

  function buildContext(): IAgentProfileService {
    ctx = createTestAgent(hostEnvironmentServices(homeDir));
    return ctx.get(IAgentProfileService);
  }

  function registerDiscovered(name: string, tools?: readonly string[]): void {
    if (ctx === undefined) throw new Error('no context');
    ctx.get(IAgentProfileRegistry).register({
      sourceId: 'workspace',
      priority: 30,
      contribution: {
        profiles: [
          normalizeAgentProfile({
            name,
            description: name,
            ...(tools === undefined ? {} : { tools }),
            systemPrompt: () => name,
          }),
        ],
      },
    });
  }

  it('unions the discovered agent types into the bound allowlist of the main agent', async () => {
    const profile = buildContext();
    registerDiscovered('code-reviewer');

    await profile.bind({ profile: 'agent', model: MOCK_MODEL });

    expect(profile.data().subagents).toEqual(['explore', 'code-reviewer']);
  });

  it('leaves the bound allowlist untouched without discovered agent types', async () => {
    const profile = buildContext();

    await profile.bind({ profile: 'agent', model: MOCK_MODEL });

    expect(profile.data().subagents).toEqual(['explore']);
  });

  it('unions discovered agent types that can delegate themselves', async () => {
    const profile = buildContext();
    registerDiscovered('agent-runner', ['Agent', 'Read']);

    await profile.bind({ profile: 'agent', model: MOCK_MODEL });

    expect(profile.data().subagents).toEqual(['explore', 'agent-runner']);
  });

  it('keeps an explicit wildcard subagents list unrestricted', async () => {
    const profile = buildContext();
    registerDiscovered('code-reviewer');

    await profile.bind({ profile: 'wild-main', model: MOCK_MODEL });

    expect(profile.data().subagents).toEqual(['*']);
  });

  it('keeps an unrestricted profile free of a discovered-only allowlist', async () => {
    const profile = buildContext();
    registerDiscovered('code-reviewer');

    await profile.bind({ profile: 'unrestricted', model: MOCK_MODEL });

    expect(profile.data().subagents).toBeUndefined();
  });
});
