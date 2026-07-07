import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';

import {
  PIPELINE_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  PIPELINE_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: PIPELINE_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  name: 'Pipeline Clínico',
  icon: 'IconRoute',
  position: 2,
  type: NavigationMenuItemType.PAGE_LAYOUT,
  pageLayoutUniversalIdentifier: PIPELINE_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
});