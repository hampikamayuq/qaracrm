import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';

import {
  INBOX_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  INBOX_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: INBOX_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  name: 'Inbox WhatsApp',
  icon: 'IconMessage',
  position: 0,
  type: NavigationMenuItemType.PAGE_LAYOUT,
  pageLayoutUniversalIdentifier: INBOX_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
});
