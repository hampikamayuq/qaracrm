// Transcrição de áudios recebidos (WhatsApp/Instagram) via OpenRouter.
//
// Usa um modelo multimodal por content parts no formato wire da OpenAI:
//   content: [{ type: 'text', ... }, { type: 'input_audio', input_audio: { data, format } }]
// O ai-client existente só aceita content como string, então fazemos o fetch
// próprio aqui, no MESMO padrão (Bearer OPENROUTER_API_KEY, /chat/completions,
// fallback de modelos via modelWithFallback).
//
// Gate global AUDIO_TRANSCRIPTION_ENABLED (default false): desligado, nunca
// chama a rede. NUNCA lança para o pipeline — devolve { ok:false } e o fluxo
// degrada para o placeholder ([áudio]). Registra a chamada em AiRunLog na
// camada 'transcription' (tokens/custo/latência) como as outras camadas.

import { modelWithFallback } from './ai-client';
import { recordAiRun } from './ai-run-log';
import type { DataApi } from './data';

export type TranscriptionResult = { ok: boolean; text: string };

const DEFAULT_MODEL = 'google/gemini-2.5-flash';
const DEFAULT_TIMEOUT_MS = 30_000;

const TRANSCRIPTION_INSTRUCTION =
  'Transcreva fielmente o áudio a seguir em português do Brasil. ' +
  'Responda apenas com a transcrição literal do que foi dito, sem comentários, ' +
  'sem aspas e sem formatação.';

export const isAudioTranscriptionEnabled = (): boolean =>
  process.env.AUDIO_TRANSCRIPTION_ENABLED === 'true';

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value.replaceAll('_', ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// OpenRouter/OpenAI pede o container do áudio em `format` (mp3, ogg, wav...).
// Nota de voz do WhatsApp é audio/ogg (opus); anexo do Instagram costuma ser mp4/m4a.
export const audioFormatFromMime = (mimeType: string): string => {
  const m = mimeType.toLowerCase();
  if (m.includes('ogg') || m.includes('opus')) return 'ogg';
  if (m.includes('wav')) return 'wav';
  if (m.includes('webm')) return 'webm';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  return 'mp3';
};

type OpenRouterResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

export type TranscribeOptions = {
  data?: DataApi;
  conversationId?: string | null;
  messageId?: string | null;
};

// Transcreve um áudio já baixado (base64). Nunca lança.
export const transcribeAudio = async (
  input: { base64: string; mimeType: string },
  opts: TranscribeOptions = {},
): Promise<TranscriptionResult> => {
  if (!isAudioTranscriptionEnabled()) return { ok: false, text: '' };

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || !input.base64) return { ok: false, text: '' };

  const baseUrl = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const timeoutMs = parsePositiveInt(process.env.AI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const models = ([] as string[]).concat(
    modelWithFallback(
      process.env.TRANSCRIPTION_MODEL,
      process.env.TRANSCRIPTION_MODEL_FALLBACK,
      DEFAULT_MODEL,
    ),
  );
  const format = audioFormatFromMime(input.mimeType);
  const startedAt = Date.now();

  for (const [index, model] of models.entries()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER ?? '',
          'X-Title': process.env.OPENROUTER_APP_NAME ?? '',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: TRANSCRIPTION_INSTRUCTION },
                { type: 'input_audio', input_audio: { data: input.base64, format } },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // Não logamos o corpo (pode ecoar dados). Só o status.
        throw new Error(`OpenRouter ${response.status}`);
      }

      const data = (await response.json()) as OpenRouterResponse;
      const text = (data.choices?.[0]?.message?.content ?? '').trim();
      if (!text) throw new Error('empty transcription');

      if (opts.data) {
        await recordAiRun(opts.data, {
          layer: 'transcription',
          model,
          fallbackUsed: index > 0,
          latencyMs: Date.now() - startedAt,
          success: true,
          reason: 'transcribed',
          conversationId: opts.conversationId,
          messageId: opts.messageId,
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
          totalTokens: data.usage?.total_tokens ?? 0,
          estimatedCostCents: 0,
        });
      }
      return { ok: true, text };
    } catch (e) {
      // Última tentativa: registra a falha e degrada limpo.
      if (opts.data && index === models.length - 1) {
        await recordAiRun(opts.data, {
          layer: 'transcription',
          model,
          fallbackUsed: index > 0,
          latencyMs: Date.now() - startedAt,
          success: false,
          reason: `transcription_error: ${(e as Error).message}`.slice(0, 200),
          conversationId: opts.conversationId,
          messageId: opts.messageId,
        });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, text: '' };
};
