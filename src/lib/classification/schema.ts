// QARA Classifier — structured-output contract.
// Spec: docs/superpowers/2026-07-03-qara-twenty-design.md §6.1
// The LLM is prompted (see QARA_CLASSIFICATION_PROMPT in src/lib/prompts.ts)
// to emit JSON-only matching this schema. Every consumer — Tawany, the
// Lead Scorer, future bots — reads from `ClassificationResult`.

import { z } from 'zod';

// ponytail: enum strings are the canonical values used across the CRM
// (lead.intent, conversation.tags, the 9-pipeline taxonomy in
// QARA_KNOWLEDGE_PROMPT §4, the 8-canonical-tag set, the P1-P4 priority
// bands). They are NOT invented here; this file is the contract surface
// that documents them.

export const INTENCAO_PRINCIPAL = [
  'agendar',
  'informacao',
  'reclamacao',
  'orcamento',
  'outro',
] as const;

export const TEMPERATURA = ['COLD', 'WARM', 'HOT'] as const;

export const PRIORIDADE = ['P1', 'P2', 'P3', 'P4'] as const;

export const PIPELINE_FUNIL = [
  'unhas',
  'cirurgia',
  'tricologia',
  'inflamatorias',
  'dermatopediatria',
  'dermatologia-clinica',
  'podologia',
  'administrativo',
  'reativacao',
] as const;

export const ClassificationResult = z.object({
  // What the lead is trying to do in this turn.
  intencao_principal: z.enum(INTENCAO_PRINCIPAL),

  // Hot / warm / cold band. Drives LEAD_QUENTE vs LEAD_FRIO tagging
  // (see QARA_KNOWLEDGE_PROMPT §7) and the lead-score base (HOT=80,
  // WARM=55, COLD=25 — see src/lib/lead-score/heuristic.ts).
  temperatura: z.enum(TEMPERATURA),

  // P1 = human handoff now; P2 = high; P3 = routine; P4 = low.
  // See QARA_KNOWLEDGE_PROMPT §6 for criteria.
  prioridade: z.enum(PRIORIDADE),

  // The 9-pipeline taxonomy. Drives doctor routing (QARA_KNOWLEDGE_PROMPT
  // §2) and the kanban's vertical column.
  pipeline_funil: z.enum(PIPELINE_FUNIL),

  // Doctor name (e.g. "Dr. Diego Galvez") or null when not applicable
  // (administrativo, reativacao, ambiguous).
  medico_indicado: z.string().nullable(),

  // Clinic unit ("Copacabana" | "Barra da Tijuca" | "Itaim Bibi" |
  // "Teleconsulta") or null when not yet known.
  unidade: z.string().nullable(),

  // LLM's self-reported confidence in [0, 1]. Caller may use < 0.5 to
  // fall back to a default P3/WARM classification.
  confianca: z.number().min(0).max(1),

  // Suggested tags from the canonical 8 (LEAD_QUENTE, LEAD_FRIO, NOVO,
  // AGENDAR, FOLLOW_UP, NO_SHOW, VIP, HUMANO) plus contextual ones
  // (alerta:*, pipeline:*, etc.). Caller decides which to apply.
  tags_sugeridas: z.array(z.string()),

  // One-line description of the next concrete action to take
  // (e.g. "enviar horários disponíveis para Dr. Miguel em Copacabana").
  proxima_acao: z.string(),

  // Reasons the LLM used to derive the classification. The first one is
  // what the lead-scorer will keep in `scoreReasons`.
  razoes: z.array(z.string()),
});

export type ClassificationResult = z.infer<typeof ClassificationResult>;
