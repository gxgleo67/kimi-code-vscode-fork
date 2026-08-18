/**
 * prompt-metadata — the session title / lastPrompt text derived from a
 * prompt payload.
 *
 * Tests pin:
 *   - media parts render as `[image]` / `[video]` / `[audio]` placeholders
 *   - an inline image-compression caption (harness metadata placed next to
 *     the image by prompt ingestion) never leaks into titles/lastPrompt,
 *     whether it is a standalone text part or merged into the user's text
 *   - SessionAPIImpl.steer updates title/lastPrompt exactly like prompt —
 *     a steer can launch the session's first turn (e.g. goal mode)
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import type { ProviderConfig } from '@moonshot-ai/kosong';
import { extractText } from '@moonshot-ai/kosong';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Agent, AgentOptions } from '../../src/agent';
import type { ResolvedAgentProfile } from '../../src/profile';
import type { SDKSessionRPC } from '../../src/rpc';
import { Session } from '../../src/session';
import { promptMetadataTextFromPayload } from '../../src/session/prompt-metadata';
import { ProviderManager } from '../../src/session/provider-manager';
import { SessionAPIImpl } from '../../src/session/rpc';
import { buildImageCompressionCaption } from '../../src/tools/support/image-compress';
import { createScriptedGenerate } from '../agent/harness/scripted-generate';
import { testKaos } from '../fixtures/test-kaos';

const CAPTION = buildImageCompressionCaption({
  original: { width: 3264, height: 666, byteLength: 344 * 1024, mimeType: 'image/png' },
  final: { width: 2000, height: 408, byteLength: 282 * 1024, mimeType: 'image/png' },
  originalPath: '/tmp/originals/shot.png',
});

describe('promptMetadataTextFromPayload', () => {
  it('renders text and media placeholders', () => {
    const text = promptMetadataTextFromPayload({
      input: [
        { type: 'text', text: 'look at this' },
        { type: 'image_url', imageUrl: { url: 'data:image/png;base64,AAAA' } },
      ],
    });
    expect(text).toBe('look at this [image]');
  });

  it('keeps a standalone image-compression caption out of the metadata text', () => {
    const text = promptMetadataTextFromPayload({
      input: [
        { type: 'text', text: CAPTION },
        { type: 'image_url', imageUrl: { url: 'data:image/png;base64,AAAA' } },
      ],
    });
    expect(text).toBe('[image]');
  });

  it('strips a caption merged into the user text and keeps the rest', () => {
    const text = promptMetadataTextFromPayload({
      input: [
        { type: 'text', text: `能展示但是没有快捷键提示${CAPTION}` },
        { type: 'image_url', imageUrl: { url: 'data:image/png;base64,AAAA' } },
      ],
    });
    expect(text).toBe('能展示但是没有快捷键提示 [image]');
    expect(text).not.toContain('<system>');
    expect(text).not.toContain('Image compressed');
  });
});

describe('SessionAPIImpl prompt metadata', () => {
  it('derives title and lastPrompt from a steer the same way as a prompt', async () => {
    const sessionDir = await makeTempDir();
    const events: Array<Record<string, unknown>> = [];
    const scripted = createScriptedGenerate();
    const session = track(
      new Session({
        id: 'prompt-metadata-steer',
        kaos: testKaos.withCwd(sessionDir),
        homedir: sessionDir,
        rpc: createSessionRpc(events),
        skills: { explicitDirs: [join(sessionDir, 'missing-skills')] },
        providerManager: testProviderManager(),
      }),
    );
    const { agent } = await session.createAgent(
      { type: 'main', generate: scripted.generate },
      { profile: testProfile() },
    );
    agent.config.update({ modelAlias: MOCK_PROVIDER.model, thinkingEffort: 'off' });
    agent.permission.setMode('yolo');

    const api = new SessionAPIImpl(session);
    await api.steer({ agentId: 'main', input: [{ type: 'text', text: 'steered goal objective' }] });
    if (agent.turn.hasActiveTurn) {
      await agent.turn.waitForCurrentTurn();
    }

    expect(session.metadata.title).toBe('steered goal objective');
    expect(session.metadata.lastPrompt).toBe('steered goal objective');
  });
});

/**
 * LLM session title (VSCode host only) — after the first prompt writes the
 * easy (truncated) title and the first turn finishes, a fire-and-forget
 * request to the session's own provider replaces it with a short
 * model-generated title. The request waits for the turn because it shares
 * the provider: sent concurrently with the first turn's requests it never
 * settles.
 *
 * Tests pin:
 *   - uiMode 'vscode': the LLM title replaces the easy title (unquoted,
 *     truncated, `isCustomTitle` stays false) and a second
 *     `session.meta.updated` event carries it
 *   - any other uiMode: the easy title stays, no title request is issued
 *   - a user rename racing the in-flight request wins: the stale LLM title
 *     is dropped, never overwrites a custom title
 *   - the title request input carries the first assistant reply next to the
 *     user request once the turn has completed
 */
describe('SessionAPIImpl llm session title', () => {
  it('replaces the easy title with the model-generated title under uiMode vscode', async () => {
    const events: Array<Record<string, unknown>> = [];
    const { generate } = createTitleAwareGenerate('  "Refactor Login Page Hooks"  ');
    const { session, agent, api } = await createLlmTitleSession({
      id: 'llm-title-replace',
      uiMode: 'vscode',
      generate,
      events,
    });

    await api.steer({
      agentId: 'main',
      input: [{ type: 'text', text: 'help me refactor the login page to use react hooks' }],
    });

    // The easy title is written (and emitted) before the turn starts; the
    // model-generated title replaces it once the first turn has finished and
    // the background request resolves.
    const metaEventTitles = (): unknown[] =>
      events.filter((event) => event['type'] === 'session.meta.updated').map((event) => event['title']);
    expect(metaEventTitles()[0]).toBe('help me refactor the login page to use react hooks');
    // The meta.updated event trails the metadata write, so waiting on it
    // proves the whole background pipeline (request → write → emit) finished.
    await vi.waitFor(() => {
      expect(metaEventTitles().at(-1)).toBe('Refactor Login Page Hooks');
    });
    if (agent.turn.hasActiveTurn) {
      await agent.turn.waitForCurrentTurn();
    }
    expect(session.metadata.title).toBe('Refactor Login Page Hooks');
    expect(session.metadata.isCustomTitle).toBe(false);
  });

  it('keeps the easy title and issues no title request without uiMode vscode', async () => {
    const events: Array<Record<string, unknown>> = [];
    const { generate, calls } = createTitleAwareGenerate('Should Never Appear');
    const { session, agent, api } = await createLlmTitleSession({
      id: 'llm-title-gated',
      generate,
      events,
    });

    await api.steer({ agentId: 'main', input: [{ type: 'text', text: 'first prompt text' }] });
    if (agent.turn.hasActiveTurn) {
      await agent.turn.waitForCurrentTurn();
    }

    expect(session.metadata.title).toBe('first prompt text');
    expect(calls.filter((call) => call.systemPrompt.includes(TITLE_PROMPT_MARKER))).toHaveLength(0);
  });

  it('drops the llm title when the user renamed the session while in flight', async () => {
    const events: Array<Record<string, unknown>> = [];
    let resolveTitle!: (text: string) => void;
    const titleText = new Promise<string>((resolve) => {
      resolveTitle = resolve;
    });
    const { generate } = createTitleAwareGenerate(titleText);
    const { session, agent, api } = await createLlmTitleSession({
      id: 'llm-title-renamed',
      uiMode: 'vscode',
      generate,
      events,
    });

    await api.steer({ agentId: 'main', input: [{ type: 'text', text: 'first prompt text' }] });
    await api.renameSession({ title: 'My Custom Title' });
    resolveTitle('Model Generated Title');
    // The post-response pipeline (guard check included) is microtask-only, so
    // draining to a macrotask proves the dropped write never happened.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (agent.turn.hasActiveTurn) {
      await agent.turn.waitForCurrentTurn();
    }

    expect(session.metadata.title).toBe('My Custom Title');
    expect(session.metadata.isCustomTitle).toBe(true);
    const metaTitles = events
      .filter((event) => event['type'] === 'session.meta.updated')
      .map((event) => event['title']);
    expect(metaTitles).not.toContain('Model Generated Title');
  });

  it('feeds the first assistant reply into the title request', async () => {
    const events: Array<Record<string, unknown>> = [];
    const { generate, titleCalls } = createReplyAwareGenerate(
      'Done — the login form now uses react hooks, with useState holding the form state.',
      'Login Form Hooks Migration',
    );
    const { session, agent, api } = await createLlmTitleSession({
      id: 'llm-title-reply-aware',
      uiMode: 'vscode',
      generate,
      events,
    });

    await api.steer({
      agentId: 'main',
      input: [{ type: 'text', text: 'migrate the login form to react hooks' }],
    });
    if (agent.turn.hasActiveTurn) {
      await agent.turn.waitForCurrentTurn();
    }
    await vi.waitFor(() => {
      expect(session.metadata.title).toBe('Login Form Hooks Migration');
    });

    expect(titleCalls).toHaveLength(1);
    const input = titleCalls.flatMap((call) => call.history.map((m) => extractText(m))).join('\n');
    expect(input).toContain('<request>');
    expect(input).toContain('migrate the login form to react hooks');
    expect(input).toContain('<response>');
    expect(input).toContain('useState holding the form state');
  });
});

type GenerateFn = NonNullable<AgentOptions['generate']>;

/** Marker substring of the llm-title system prompt (see rpc.ts). */
const TITLE_PROMPT_MARKER = 'conversation title';

/**
 * A generate mock that answers the llm-title request (routed by its system
 * prompt, so turn/step calls racing it cannot consume the scripted response)
 * and throws for anything else — a stray turn call errors out harmlessly.
 */
function createTitleAwareGenerate(titleText: string | Promise<string>) {
  const calls: Array<{ readonly systemPrompt: string }> = [];
  const generate: GenerateFn = async (_provider, systemPrompt, _tools, _history, _callbacks, options) => {
    options?.signal?.throwIfAborted();
    calls.push({ systemPrompt });
    if (!systemPrompt.includes(TITLE_PROMPT_MARKER)) {
      throw new Error('Unexpected non-title generate call');
    }
    const text = await titleText;
    return titleResult(text);
  };
  return { generate, calls };
}

/**
 * A generate mock whose turn call succeeds with a fixed assistant reply, so
 * the title request (routed by its system prompt, as above) runs against a
 * completed turn and can be checked for the reply summary in its input.
 */
function createReplyAwareGenerate(replyText: string, titleText: string) {
  const titleCalls: Array<{ readonly history: Parameters<GenerateFn>[3] }> = [];
  const generate: GenerateFn = async (_provider, systemPrompt, _tools, history, _callbacks, options) => {
    options?.signal?.throwIfAborted();
    if (systemPrompt.includes(TITLE_PROMPT_MARKER)) {
      titleCalls.push({ history });
      return titleResult(titleText);
    }
    return {
      id: 'mock-turn',
      message: {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: replyText }],
        toolCalls: [],
      },
      usage: null,
      finishReason: 'completed' as const,
      rawFinishReason: 'stop',
      traceId: null,
    };
  };
  return { generate, titleCalls };
}

function titleResult(text: string) {
  return {
    id: 'mock-title',
    message: {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text }],
      toolCalls: [],
    },
    usage: null,
    finishReason: 'completed' as const,
    rawFinishReason: 'stop',
    traceId: null,
  };
}

async function createLlmTitleSession(options: {
  readonly id: string;
  readonly uiMode?: string;
  readonly generate: GenerateFn;
  readonly events: Array<Record<string, unknown>>;
}): Promise<{ session: Session; agent: Agent; api: SessionAPIImpl }> {
  const sessionDir = await makeTempDir();
  const session = track(
    new Session({
      id: options.id,
      kaos: testKaos.withCwd(sessionDir),
      homedir: sessionDir,
      rpc: createSessionRpc(options.events),
      skills: { explicitDirs: [join(sessionDir, 'missing-skills')] },
      providerManager: testProviderManager(),
      uiMode: options.uiMode,
    }),
  );
  const { agent } = await session.createAgent(
    { type: 'main', generate: options.generate },
    { profile: testProfile() },
  );
  agent.config.update({ modelAlias: MOCK_PROVIDER.model, thinkingEffort: 'off' });
  agent.permission.setMode('yolo');
  return { session, agent, api: new SessionAPIImpl(session) };
}

const MOCK_PROVIDER = {
  type: 'kimi',
  apiKey: 'test-key',
  model: 'mock-model',
} as const satisfies ProviderConfig;

const tempDirs: string[] = [];
const openSessions: Session[] = [];

function track(session: Session): Session {
  openSessions.push(session);
  return session;
}

afterEach(async () => {
  // Close sessions first so their async metadata/wire writes settle before the
  // temp dirs are removed (otherwise rm races with a write -> ENOTEMPTY).
  await Promise.allSettled(openSessions.splice(0).map((s) => s.close()));
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kimi-prompt-metadata-'));
  tempDirs.push(dir);
  return dir;
}

function testProviderManager(): ProviderManager {
  return new ProviderManager({
    config: {
      providers: {
        test: { type: MOCK_PROVIDER.type, apiKey: MOCK_PROVIDER.apiKey },
      },
      models: {
        [MOCK_PROVIDER.model]: {
          provider: 'test',
          model: MOCK_PROVIDER.model,
          maxContextSize: 1_000_000,
        },
      },
    },
  });
}

function testProfile(): ResolvedAgentProfile {
  return {
    name: 'test',
    systemPrompt: () => '<system-prompt>',
    tools: [],
  };
}

function createSessionRpc(events: Array<Record<string, unknown>>): SDKSessionRPC {
  return {
    emitEvent: vi.fn(async (event) => {
      events.push(event);
    }),
    requestApproval: vi.fn(async () => ({ decision: 'cancelled' })),
    requestQuestion: vi.fn(async () => null),
    toolCall: vi.fn(async () => ({
      output: 'custom tools are not supported in this test',
      isError: true,
    })),
  } as unknown as SDKSessionRPC;
}
