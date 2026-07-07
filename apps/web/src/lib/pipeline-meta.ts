// Vocabulário compartilhado do funil (labels pt-BR) — usado pelo Pipeline e
// pelo Dashboard. Extraído de pipeline/page.tsx para não duplicar.

// Motivos canônicos de perda (família status:perdido-* da KB §15, estendida).
export const LOSS_REASONS = [
  { value: 'preco', label: 'Preço' },
  { value: 'plano', label: 'Plano de saúde' },
  { value: 'horario', label: 'Horário' },
  { value: 'sem-resposta', label: 'Sem resposta' },
  { value: 'concorrente', label: 'Concorrente' },
  { value: 'fora-de-perfil', label: 'Fora de perfil' },
  { value: 'outro', label: 'Outro' },
] as const;

export const lossLabel = (value: string | null): string =>
  LOSS_REASONS.find((r) => r.value === value)?.label ?? value ?? '—';
