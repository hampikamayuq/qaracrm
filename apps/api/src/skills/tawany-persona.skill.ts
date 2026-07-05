import { defineSkill } from 'twenty-sdk/define';
import { TAWANY_PERSONA_PROMPT } from 'src/lib/prompts';
import { TAWANY_PERSONA_SKILL_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export default defineSkill({
  universalIdentifier: TAWANY_PERSONA_SKILL_UNIVERSAL_IDENTIFIER,
  name: 'tawany-persona',
  label: 'Tawany — Persona',
  icon: 'IconRobot',
  description: 'Persona, tom, segurança médica e contrato de execução da Tawany',
  content: TAWANY_PERSONA_PROMPT,
});
