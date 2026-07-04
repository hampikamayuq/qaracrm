import { readFileSync } from 'fs';
import { join } from 'path';
import { defineSkill } from 'twenty-sdk/define';

export const QARA_CLASSIFIER_SKILL_UNIVERSAL_IDENTIFIER = '7e25a6d0-39c9-4e0b-a55b-8a525e086504';

export default defineSkill({
  universalIdentifier: QARA_CLASSIFIER_SKILL_UNIVERSAL_IDENTIFIER,
  name: 'qara-classifier',
  label: 'Qara — Regras de Classificação',
  icon: 'IconBrain',
  description: 'Regras de qualificação: intent, prioridade, temperatura, handoff',
  content: readFileSync(join(__dirname, 'prompts', 'qara-classification.md'), 'utf-8'),
});
