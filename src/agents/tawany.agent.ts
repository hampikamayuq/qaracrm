import { defineAgent } from 'twenty-sdk/define';
import {
  QARA_CLASSIFIER_SKILL_UNIVERSAL_IDENTIFIER,
  QARA_KNOWLEDGE_SKILL_UNIVERSAL_IDENTIFIER,
  TAWANY_PERSONA_SKILL_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export const TAWANY_AGENT_UNIVERSAL_IDENTIFIER = 'a7225cde-420c-4fce-8237-db9036ae3f81';

// Agent nativo do sidebar AI (uso interno/admin). O atendimento ao paciente
// roda no tawany-handler (loop próprio via OpenRouter), não por este agent.
export default defineAgent({
  universalIdentifier: TAWANY_AGENT_UNIVERSAL_IDENTIFIER,
  name: 'tawany',
  label: 'Tawany — Secretaria Virtual',
  icon: 'IconRobot',
  description: 'Atendimento WhatsApp/IG da Clínica Qara: triagem, direcionamento e agendamento.',
  prompt: [
    'Você é Tawany, secretária virtual da Clínica Qara (uso interno: responda perguntas do time sobre leads, pacientes e conversas).',
    'Use os skills instalados:',
    `- tawany-persona (${TAWANY_PERSONA_SKILL_UNIVERSAL_IDENTIFIER}): persona, tom e limites`,
    `- qara-knowledge (${QARA_KNOWLEDGE_SKILL_UNIVERSAL_IDENTIFIER}): dados operacionais da clínica`,
    `- qara-classifier (${QARA_CLASSIFIER_SKILL_UNIVERSAL_IDENTIFIER}): regras de qualificação`,
  ].join('\n'),
});
