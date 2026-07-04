import { readFileSync } from 'fs';
import { join } from 'path';
import { defineSkill } from 'twenty-sdk/define';

export const QARA_KNOWLEDGE_SKILL_UNIVERSAL_IDENTIFIER = '8891cfcd-166b-43d9-b84c-8a12882ddf71';

export default defineSkill({
  universalIdentifier: QARA_KNOWLEDGE_SKILL_UNIVERSAL_IDENTIFIER,
  name: 'qara-knowledge',
  label: 'Qara — Knowledge Base',
  icon: 'IconBook',
  description: 'Dados operacionais da clínica: médicos, valores, unidades, pagamento, regras',
  content: readFileSync(join(__dirname, 'prompts', 'qara-knowledge.md'), 'utf-8'),
});
