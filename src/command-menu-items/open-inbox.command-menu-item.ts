import { defineCommandMenuItem } from 'twenty-sdk/define';
import { WHATSAPP_INBOX_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { OPEN_INBOX_COMMAND_MENU_ITEM_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export default defineCommandMenuItem({
  universalIdentifier: OPEN_INBOX_COMMAND_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  label: 'Abrir Inbox WhatsApp',
  shortLabel: 'Inbox',
  isPinned: true,
  availabilityType: 'GLOBAL',
  frontComponentUniversalIdentifier: WHATSAPP_INBOX_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
});
