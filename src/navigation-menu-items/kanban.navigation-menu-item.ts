import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';

import {
  KANBAN_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  KANBAN_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: KANBAN_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  name: 'Funil de Leads',
  icon: 'IconLayoutKanban',
  position: 1,
  type: NavigationMenuItemType.PAGE_LAYOUT,
  pageLayoutUniversalIdentifier: KANBAN_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
});
