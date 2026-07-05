import { defineCommandMenuItem } from 'twenty-sdk/define';
import { LEAD_KANBAN_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { OPEN_KANBAN_COMMAND_MENU_ITEM_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export default defineCommandMenuItem({
  universalIdentifier: OPEN_KANBAN_COMMAND_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  label: 'Abrir Funil de Leads',
  shortLabel: 'Funil',
  isPinned: true,
  availabilityType: 'GLOBAL',
  frontComponentUniversalIdentifier: LEAD_KANBAN_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
});
