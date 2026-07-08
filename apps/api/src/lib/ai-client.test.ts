import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { createAiClient, DEFAULT_AI_TIMEOUT_MS } from './ai-client';

describe('ai-client', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
  });

  afterEach(() => {
    delete process.env.AI_TIMEOUT_MS;
    global.fetch = originalFetch;
  });

  it('returns parsed content from OpenRouter', async () => {
    const mockResponse = {
      choices: [
        {
          message: { role: 'assistant', content: 'hello' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    }) as unknown as typeof fetch;

    const client = createAiClient();
    const result = await client.chat({
      model: 'minimax/minimax-m3',
      system: 'You are Tawany.',
      messages: [{ role: 'user', content: 'oi' }],
    });

    expect(result.content).toBe('hello');
    expect(result.finishReason).toBe('stop');
    expect(result.usage.totalTokens).toBe(15);
    global.fetch = originalFetch;
  });

  it('throws on non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    }) as unknown as typeof fetch;

    const client = createAiClient();
    await expect(
      client.chat({
        model: 'minimax/minimax-m3',
        system: 'sys',
        messages: [{ role: 'user', content: 'oi' }],
      }),
    ).rejects.toThrow(/401/);
    global.fetch = originalFetch;
  });

  it('tries fallback models in order and reports the model used', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'model unavailable',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'fallback ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createAiClient();
    const result = await client.chat({
      model: ['minimax/minimax-m3', 'z-ai/glm-5.2'],
      system: 'sys',
      messages: [{ role: 'user', content: 'oi' }],
    });

    expect(result.content).toBe('fallback ok');
    expect(result.modelUsed).toBe('z-ai/glm-5.2');
    expect(result.fallbackUsed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('minimax/minimax-m3');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe('z-ai/glm-5.2');
    global.fetch = originalFetch;
  });

  it('throws the last OpenRouter error when every model fails', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'primary down',
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'fallback exhausted',
      }) as unknown as typeof fetch;

    const client = createAiClient();
    await expect(
      client.chat({
        model: ['minimax/minimax-m3', 'z-ai/glm-5.2'],
        system: 'sys',
        messages: [{ role: 'user', content: 'oi' }],
      }),
    ).rejects.toThrow(/429: fallback exhausted/);
    global.fetch = originalFetch;
  });

  it('passes auth and body correctly', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createAiClient();
    await client.chat({
      model: 'deepseek/deepseek-chat',
      system: 'sys',
      messages: [{ role: 'user', content: 'q' }],
      tools: [{ type: 'function', function: { name: 'foo', parameters: {} } }],
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(init.headers['Authorization']).toBe('Bearer test-key');
    expect(body.model).toBe('deepseek/deepseek-chat');
    expect(body.tools).toHaveLength(1);
    global.fetch = originalFetch;
  });

  it('extracts tool_calls from response', async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_123',
                type: 'function',
                function: { name: 'readLead', arguments: '{"leadId":"abc"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    }) as unknown as typeof fetch;

    const client = createAiClient();
    const result = await client.chat({
      model: 'minimax/minimax-m3',
      system: 'sys',
      messages: [{ role: 'user', content: 'buscar lead' }],
      tools: [{ type: 'function', function: { name: 'readLead', parameters: {} } }],
    });

    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('readLead');
    expect(JSON.parse(result.toolCalls[0].arguments)).toEqual({ leadId: 'abc' });
    global.fetch = originalFetch;
  });

  it('serializes assistant tool_calls in OpenAI wire format', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createAiClient();
    await client.chat({
      model: 'minimax/minimax-m3',
      system: 'sys',
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'tc1', name: 'readLead', arguments: '{}' }] },
        { role: 'tool', tool_call_id: 'tc1', content: '{}' },
      ],
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    const assistant = body.messages.find((m: { role: string }) => m.role === 'assistant');
    expect(assistant.tool_calls[0]).toEqual({ id: 'tc1', type: 'function', function: { name: 'readLead', arguments: '{}' } });
    global.fetch = originalFetch;
  });

  it('passes response_format when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createAiClient();
    await client.chat({
      model: 'minimax/minimax-m3',
      system: 'sys',
      messages: [{ role: 'user', content: 'q' }],
      responseFormat: { type: 'json_object' },
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.response_format).toEqual({ type: 'json_object' });
    global.fetch = originalFetch;
  });

  it('passes max_tokens from env to OpenRouter request', async () => {
    process.env.AI_MAX_OUTPUT_TOKENS = '250';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    try {
      const client = createAiClient();
      await client.chat({
        model: 'minimax/minimax-m3',
        system: 'sys',
        messages: [{ role: 'user', content: 'q' }],
      });

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body).max_tokens).toBe(250);
    } finally {
      delete process.env.AI_MAX_OUTPUT_TOKENS;
      global.fetch = originalFetch;
    }
  });

  it('uses default max_tokens when env is unset', async () => {
    delete process.env.AI_MAX_OUTPUT_TOKENS;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    try {
      const client = createAiClient();
      await client.chat({
        model: 'minimax/minimax-m3',
        system: 'sys',
        messages: [{ role: 'user', content: 'q' }],
      });

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body).max_tokens).toBe(600);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('truncates long input before sending to OpenRouter', async () => {
    process.env.AI_MAX_INPUT_CHARS = '20';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    try {
      const client = createAiClient();
      await client.chat({
        model: 'minimax/minimax-m3',
        system: 'sys',
        messages: [{ role: 'user', content: 'x'.repeat(200) }],
      });

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body);
      const content = body.messages[1].content;
      expect(content).toContain('truncated');
      expect(content.startsWith('x'.repeat(20))).toBe(true);
      expect(content.length).toBeLessThan(80);
    } finally {
      delete process.env.AI_MAX_INPUT_CHARS;
      global.fetch = originalFetch;
    }
  });

  it('uses a default timeout when AI_TIMEOUT_MS is unset or invalid', async () => {
    for (const raw of [undefined, '', 'abc', '-1']) {
      if (raw === undefined) delete process.env.AI_TIMEOUT_MS;
      else process.env.AI_TIMEOUT_MS = raw;
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const client = createAiClient();
      await client.chat({
        model: 'minimax/minimax-m3',
        system: 'sys',
        messages: [{ role: 'user', content: 'q' }],
      });

      const [, init] = fetchMock.mock.calls[0];
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(DEFAULT_AI_TIMEOUT_MS).toBe(30_000);
  });
});
