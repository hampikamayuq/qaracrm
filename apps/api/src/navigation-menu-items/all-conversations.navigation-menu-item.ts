import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';
import { CONVERSATION_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: 'd5fa4776-e9ac-409c-a15b-245ea750dc33',
  position: 3,
  type: NavigationMenuItemType.OBJECT,
  targetObjectUniversalIdentifier: CONVERSATION_OBJECT_UNIVERSAL_IDENTIFIER,
});
