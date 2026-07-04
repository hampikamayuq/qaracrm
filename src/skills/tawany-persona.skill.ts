import { readFileSync } from 'fs';
import { join } from 'path';
import { defineSkill } from 'twenty-sdk/define';

export const TAWANY_PERSONA_SKILL_UNIVERSAL_IDENTIFIER = '41ae59e8-db47-481b-9886-79cdeed2c953';

export default defineSkill({
  universalIdentifier: TAWANY_PERSONA_SKILL_UNIVERSAL_IDENTIFIER,
  name: 'tawany-persona',
  label: 'Tawany — Persona',
  icon: 'IconRobot',
  description: 'Persona, tom, segurança médica e contrato de execução da Tawany',
  content: readFileSync(join(__dirname, 'prompts', 'tawany-persona.md'), 'utf-8'),
});
