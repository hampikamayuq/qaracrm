import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';

import { FOLLOWUPS_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER, FOLLOWUPS_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: FOLLOWUPS_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  name: 'Follow-ups',
  icon: 'IconCalendarCheck',
  position: 2,
  type: NavigationMenuItemType.PAGE_LAYOUT,
  pageLayoutUniversalIdentifier: FOLLOWUPS_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
});
