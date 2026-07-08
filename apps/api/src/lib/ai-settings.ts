import type { DataApi } from './data';

export const AI_SETTINGS_SLUG = '__ai_settings';

export type AiOperationMode = 'shadow' | 'human_approval' | 'recomendacoes' | 'autopilot' | 'hibrido';

export type AiRuntimeSettings = {
  mode: AiOperationMode;
  autopilotIntents: string[];
};

const shadowModeFromEnv = (): Extract<AiOperationMode, 'shadow' | 'human_approval' | 'autopilot'> => {
  const mode = process.env.SHADOW_MODE;
  return mode === 'human_approval' || mode === 'autopilot' ? mode : 'shadow';
};

export const defaultAiSettings = (): AiRuntimeSettings => ({
  mode: shadowModeFromEnv(),
  autopilotIntents: [],
});

export const DEFAULT_AI_SETTINGS: AiRuntimeSettings = {
  mode: 'shadow',
  autopilotIntents: [],
};

const VALID_MODES = new Set<AiOperationMode>([
  'shadow',
  'human_approval',
  'recomendacoes',
  'autopilot',
  'hibrido',
]);

const normalizeIntent = (intent: unknown): string | null => {
  if (typeof intent !== 'string') return null;
  const normalized = intent.trim().toUpperCase();
  return normalized.length > 0 && normalized.length <= 64 ? normalized : null;
};

export const parseAiSettings = (raw: unknown): AiRuntimeSettings => {
  const fallback = defaultAiSettings();
  if (!raw || typeof raw !== 'object') return fallback;
  const rec = raw as Record<string, unknown>;
  const mode = typeof rec.mode === 'string' && VALID_MODES.has(rec.mode as AiOperationMode)
    ? (rec.mode as AiOperationMode)
    : fallback.mode;
  const autopilotIntents = Array.isArray(rec.autopilotIntents)
    ? [...new Set(rec.autopilotIntents.map(normalizeIntent).filter((v): v is string => Boolean(v)))]
    : [];
  return { mode, autopilotIntents };
};

export const parseAiSettingsContent = (content: unknown): AiRuntimeSettings => {
  if (typeof content !== 'string' || content.trim().length === 0) return defaultAiSettings();
  try {
    return parseAiSettings(JSON.parse(content) as unknown);
  } catch {
    return defaultAiSettings();
  }
};

export const loadAiSettings = async (data: DataApi): Promise<AiRuntimeSettings> => {
  try {
    const rows = await data.list('knowledgeSection', {
      filter: { slug: { eq: AI_SETTINGS_SLUG } },
      limit: 1,
      select: { content: true },
    });
    return parseAiSettingsContent(rows[0]?.content);
  } catch {
    return defaultAiSettings();
  }
};

export const serializeAiSettings = (settings: AiRuntimeSettings): string =>
  JSON.stringify({
    mode: settings.mode,
    autopilotIntents: settings.autopilotIntents,
  });
