import { defineSkill } from 'twenty-sdk/define';
import { QARA_CLASSIFICATION_PROMPT } from 'src/lib/prompts';
import { QARA_CLASSIFIER_SKILL_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export default defineSkill({
  universalIdentifier: QARA_CLASSIFIER_SKILL_UNIVERSAL_IDENTIFIER,
  name: 'qara-classifier',
  label: 'Qara — Regras de Classificação',
  icon: 'IconBrain',
  description: 'Regras de qualificação: intent, prioridade, temperatura, handoff',
  content: QARA_CLASSIFICATION_PROMPT,
});
