import { defineSkill } from 'twenty-sdk/define';
import { QARA_KNOWLEDGE_PROMPT } from 'src/lib/prompts';
import { QARA_KNOWLEDGE_SKILL_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export default defineSkill({
  universalIdentifier: QARA_KNOWLEDGE_SKILL_UNIVERSAL_IDENTIFIER,
  name: 'qara-knowledge',
  label: 'Qara — Knowledge Base',
  icon: 'IconBook',
  description: 'Dados operacionais da clínica: médicos, valores, unidades, pagamento, regras',
  content: QARA_KNOWLEDGE_PROMPT,
});
