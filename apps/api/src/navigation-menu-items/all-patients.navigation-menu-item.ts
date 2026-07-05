import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';
import { PATIENT_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: '1805731a-def7-402f-9427-0d1b30ed56ba',
  position: 2,
  type: NavigationMenuItemType.OBJECT,
  targetObjectUniversalIdentifier: PATIENT_OBJECT_UNIVERSAL_IDENTIFIER,
});
