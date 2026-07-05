export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

export type ToolSpec = {
  type: 'function';
  function: { name: string; description?: string; parameters: unknown };
};

export type ChatParams = {
  model: string | string[];
  system: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  responseFormat?: { type: 'json_object' | 'json_schema'; json_schema?: unknown };
};

export type ChatResult = {
  content: string | null;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'unknown';
  toolCalls: ToolCall[];
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  modelUsed?: string;
  fallbackUsed?: boolean;
};

export type AiClient = {
  chat(params: ChatParams): Promise<ChatResult>;
};

export const modelWithFallback = (
  primary: string | undefined,
  fallback: string | undefined,
  defaultModel: string,
): string | string[] => {
  const models = [primary?.trim() || defaultModel, fallback?.trim()].filter((m): m is string =>
    Boolean(m),
  );
  return models.length === 1 ? models[0] : models;
};

type OpenRouterResponse = {
  choices: Array<{
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

export const createAiClient = (overrides?: {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}): AiClient => {
  const apiKey = overrides?.apiKey ?? process.env.OPENROUTER_API_KEY;
  const baseUrl =
    overrides?.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const timeoutMs =
    overrides?.timeoutMs ?? Number.parseInt(process.env.AI_TIMEOUT_MS ?? '', 10);

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is required');
  }

  // Formato wire da OpenAI para tool_calls difere do nosso ToolCall interno
  const toWire = (m: ChatMessage): Record<string, unknown> =>
    m.tool_calls
      ? {
          role: m.role,
          content: m.content,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          })),
        }
    : (m as unknown as Record<string, unknown>);

  return {
    async chat(params: ChatParams): Promise<ChatResult> {
      const models = (Array.isArray(params.model) ? params.model : [params.model]).filter(Boolean);
      let lastError: Error | null = null;

      for (const [index, model] of models.entries()) {
        const body: Record<string, unknown> = {
          model,
          messages: [{ role: 'system', content: params.system }, ...params.messages.map(toWire)],
        };
        if (params.tools) body.tools = params.tools;
        if (params.responseFormat) body.response_format = params.responseFormat;

        const controller = Number.isFinite(timeoutMs) && timeoutMs > 0
          ? new AbortController()
          : null;
        const timeout = controller
          ? setTimeout(() => controller.abort(), timeoutMs)
          : null;

        try {
          const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER ?? '',
              'X-Title': process.env.OPENROUTER_APP_NAME ?? '',
            },
            body: JSON.stringify(body),
            ...(controller ? { signal: controller.signal } : {}),
          });

          if (!response.ok) {
            const text = await response.text();
            throw new Error(`OpenRouter ${response.status}: ${text}`);
          }

          const data = (await response.json()) as OpenRouterResponse;
          const choice = data.choices[0];
          const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          }));

          const finishReason: ChatResult['finishReason'] =
            choice.finish_reason === 'tool_calls'
              ? 'tool_calls'
              : (['stop', 'length', 'content_filter'].includes(choice.finish_reason)
                  ? (choice.finish_reason as ChatResult['finishReason'])
                  : 'unknown');

          return {
            content: choice.message.content,
            finishReason,
            toolCalls,
            usage: {
              promptTokens: data.usage?.prompt_tokens ?? 0,
              completionTokens: data.usage?.completion_tokens ?? 0,
              totalTokens: data.usage?.total_tokens ?? 0,
            },
            modelUsed: model,
            fallbackUsed: index > 0,
          };
        } catch (e) {
          lastError = e as Error;
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      }

      throw lastError ?? new Error('No AI models configured');
    },
  };
};
