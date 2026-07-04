import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';
import { LEAD_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: '8ea30730-19e0-4dff-9bb0-72c8afdca096',
  position: 1,
  type: NavigationMenuItemType.OBJECT,
  targetObjectUniversalIdentifier: LEAD_OBJECT_UNIVERSAL_IDENTIFIER,
});
