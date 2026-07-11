// Modo global da Tawany (SHADOW_MODE). Extraído de lib/shadow.ts para quebrar
// o import circular shadow ↔ tawany-handler: o handler só precisa saber o modo,
// não do orquestrador de mensagens processadas.
export type ShadowMode = 'shadow' | 'human_approval' | 'autopilot';

const VALID_MODES = new Set<ShadowMode>(['shadow', 'human_approval', 'autopilot']);

export const getShadowMode = (): ShadowMode => {
  const mode = process.env.SHADOW_MODE ?? 'shadow';
  if (!VALID_MODES.has(mode as ShadowMode)) throw new Error(`Invalid SHADOW_MODE: ${mode}`);
  return mode as ShadowMode;
};

export const isShadowMode = (): boolean => getShadowMode() === 'shadow';
export const isHumanApprovalMode = (): boolean => getShadowMode() === 'human_approval';
export const isAutopilotMode = (): boolean => getShadowMode() === 'autopilot';
