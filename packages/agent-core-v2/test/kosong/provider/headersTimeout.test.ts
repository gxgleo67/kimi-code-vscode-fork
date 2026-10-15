import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '#/kosong/contract/message';
import type { ChatProvider, StreamedMessage } from '#/kosong/contract/provider';
import { AnthropicChatProvider } from '#/kosong/provider/bases/anthropic/anthropic';
import { OpenAILegacyChatProvider } from '#/kosong/provider/bases/openai/openai-legacy';
import { OpenAIResponsesChatProvider } from '#/kosong/provider/bases/openai/openai-responses';
import {
  LLM_HEADERS_TIMEOUT_ENV,
  getLlmHeadersTimeoutDispatcher,
  resolveLlmHeadersTimeoutMs,
} from '#/kosong/provider/timeout';

const PROBE_ENV_KEYS = [
  LLM_HEADERS_TIMEOUT_ENV,
  'http_proxy',
  'HTTP_PROXY',
  'https_proxy',
  'HTTPS_PROXY',
  'all_proxy',
  'ALL_PROXY',
  'no_proxy',
  'NO_PROXY',
] as const;

const PROBE_HISTORY: Message[] = [
  { role: 'user', content: [{ type: 'text', text: 'Hi' }], toolCalls: [] },
];

const OPENAI_SSE = [
  'data: {"id":"chatcmpl-probe","object":"chat.completion.chunk","created":0,"model":"probe-model","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":"stop"}]}',
  '',
  'data: [DONE]',
  '',
  '',
].join('\n');

const RESPONSES_SSE = [
  'event: response.completed',
  'data: {"type":"response.completed","response":{"id":"resp_probe","status":"completed","usage":{"input_tokens":3,"output_tokens":1,"total_tokens":4}}}',
  '',
  '',
].join('\n');

const ANTHROPIC_SSE = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_probe","type":"message","role":"assistant","content":[],"model":"probe-model","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":3,"output_tokens":1}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":2}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
  '',
].join('\n');

const SSE_BY_PROTOCOL = {
  openai: OPENAI_SSE,
  openai_responses: RESPONSES_SSE,
  anthropic: ANTHROPIC_SSE,
} as const;

type ProbeProtocol = keyof typeof SSE_BY_PROTOCOL;

function providerFor(protocol: ProbeProtocol): ChatProvider {
  const connection = { model: 'probe-model', apiKey: 'sk-probe', baseUrl: 'https://example.test/v1' };
  if (protocol === 'openai') return new OpenAILegacyChatProvider({ ...connection, stream: true });
  if (protocol === 'openai_responses') return new OpenAIResponsesChatProvider({ ...connection });
  return new AnthropicChatProvider({ ...connection });
}

async function request(protocol: ProbeProtocol, fetchStub: ReturnType<typeof vi.fn>): Promise<void> {
  fetchStub.mockImplementation(
    async () =>
      new Response(SSE_BY_PROTOCOL[protocol], {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
  );
  const stream: StreamedMessage = await providerFor(protocol).generate('', [], PROBE_HISTORY);
  for await (const part of stream) void part;
}

function lastFetchOptions(fetchStub: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return (fetchStub.mock.calls.at(-1)?.[1] ?? {}) as Record<string, unknown>;
}

describe('resolveLlmHeadersTimeoutMs', () => {
  it('reads a positive integer from the environment', () => {
    expect(resolveLlmHeadersTimeoutMs({})).toBeUndefined();
    expect(resolveLlmHeadersTimeoutMs({ [LLM_HEADERS_TIMEOUT_ENV]: '  ' })).toBeUndefined();
    expect(resolveLlmHeadersTimeoutMs({ [LLM_HEADERS_TIMEOUT_ENV]: '45000' })).toBe(45_000);
    expect(resolveLlmHeadersTimeoutMs({ [LLM_HEADERS_TIMEOUT_ENV]: '2147483647' })).toBe(
      2_147_483_647,
    );
  });

  it('rejects non-integer, non-positive, and out-of-range values', () => {
    for (const raw of ['abc', '0', '-1', '1.5', '2147483648']) {
      expect(() => resolveLlmHeadersTimeoutMs({ [LLM_HEADERS_TIMEOUT_ENV]: raw })).toThrow(
        LLM_HEADERS_TIMEOUT_ENV,
      );
    }
  });
});

describe('getLlmHeadersTimeoutDispatcher', () => {
  it('builds a plain dispatcher without a proxy', () => {
    expect(getLlmHeadersTimeoutDispatcher(45_000, {})).toBeDefined();
  });

  it('keeps the SDK default for SOCKS-only proxy configurations', () => {
    expect(
      getLlmHeadersTimeoutDispatcher(45_000, { ALL_PROXY: 'socks5://127.0.0.1:1080' }),
    ).toBeUndefined();
  });

  it('builds a proxy dispatcher for an HTTP proxy and falls back on an invalid one', () => {
    expect(
      getLlmHeadersTimeoutDispatcher(45_000, { HTTP_PROXY: 'http://127.0.0.1:3128' }),
    ).toBeDefined();
    expect(getLlmHeadersTimeoutDispatcher(45_000, { HTTP_PROXY: 'not-a-url' })).toBeUndefined();
  });
});

describe('LLM client headers timeout', () => {
  let savedEnv: Record<string, string | undefined>;
  let fetchStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of PROBE_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    fetchStub = vi.fn(async () => new Response(OPENAI_SSE, { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it.each<ProbeProtocol>(['openai', 'openai_responses', 'anthropic'])(
    'passes the configured dispatcher to fetch on the %s protocol',
    async (protocol) => {
      await request(protocol, fetchStub);
      expect(lastFetchOptions(fetchStub)).not.toHaveProperty('dispatcher');

      process.env[LLM_HEADERS_TIMEOUT_ENV] = '45000';
      await request(protocol, fetchStub);

      expect(lastFetchOptions(fetchStub)).toHaveProperty('dispatcher');
    },
  );

  it('fails the provider instead of silently dropping an invalid timeout', () => {
    process.env[LLM_HEADERS_TIMEOUT_ENV] = 'abc';

    expect(() => providerFor('openai')).toThrow(LLM_HEADERS_TIMEOUT_ENV);
    expect(() => providerFor('openai_responses')).toThrow(LLM_HEADERS_TIMEOUT_ENV);
    expect(() => providerFor('anthropic')).toThrow(LLM_HEADERS_TIMEOUT_ENV);
  });

  it('keeps the default headers timeout behind an HTTP proxy and behind an invalid proxy URL', async () => {
    process.env[LLM_HEADERS_TIMEOUT_ENV] = '45000';

    process.env['HTTP_PROXY'] = 'http://127.0.0.1:3128';
    await request('openai', fetchStub);
    expect(lastFetchOptions(fetchStub)).toHaveProperty('dispatcher');

    process.env['HTTP_PROXY'] = 'not-a-url';
    await request('openai', fetchStub);
    expect(lastFetchOptions(fetchStub)).not.toHaveProperty('dispatcher');
  });

  it('keeps the default headers timeout for a SOCKS-only proxy configuration', async () => {
    process.env[LLM_HEADERS_TIMEOUT_ENV] = '45000';
    process.env['ALL_PROXY'] = 'socks5://127.0.0.1:1080';

    await request('openai', fetchStub);

    expect(lastFetchOptions(fetchStub)).not.toHaveProperty('dispatcher');
  });
});
