import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import type { ContextMessage } from '#/agent/contextMemory/types';

import { createTestAgent, type TestAgentContext } from '../../harness';

function message(text: string): ContextMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    toolCalls: [],
    origin: { kind: 'user' },
  };
}

describe('AgentContextMemoryService.prefixRevision', () => {
  let ctx: TestAgentContext;
  let context: IAgentContextMemoryService;

  beforeEach(() => {
    ctx = createTestAgent();
    context = ctx.get(IAgentContextMemoryService);
  });

  afterEach(async () => {
    await ctx?.dispose();
  });

  it('stays put while the conversation only grows', () => {
    context.append(message('first'));

    expect(context.prefixRevision()).toBe(0);

    context.append(message('second'));

    expect(context.prefixRevision()).toBe(0);
  });

  it('moves when the prefix is rewritten by clear, undo, or compaction', () => {
    context.append(message('first'), message('assistant reply'), message('second'));

    context.undo(1);
    expect(context.prefixRevision()).toBe(1);

    context.append(message('third'));
    expect(context.prefixRevision()).toBe(1);

    context.applyCompaction({ summary: 'summary', compactedCount: 2, tokensBefore: 100 });
    expect(context.prefixRevision()).toBe(2);

    context.clear();
    expect(context.prefixRevision()).toBe(3);
  });
});
