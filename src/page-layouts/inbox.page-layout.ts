import { definePageLayout, PageLayoutTabLayoutMode } from 'twenty-sdk/define';

import {
  INBOX_PAGE_LAYOUT_TAB_UNIVERSAL_IDENTIFIER,
  INBOX_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  INBOX_PAGE_LAYOUT_WIDGET_UNIVERSAL_IDENTIFIER,
  WHATSAPP_INBOX_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default definePageLayout({
  universalIdentifier: INBOX_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  name: 'Inbox WhatsApp',
  type: 'STANDALONE_PAGE',
  tabs: [
    {
      universalIdentifier: INBOX_PAGE_LAYOUT_TAB_UNIVERSAL_IDENTIFIER,
      title: 'Inbox',
      position: 0,
      icon: 'IconMessage',
      layoutMode: PageLayoutTabLayoutMode.CANVAS,
      widgets: [
        {
          universalIdentifier: INBOX_PAGE_LAYOUT_WIDGET_UNIVERSAL_IDENTIFIER,
          title: ' ',
          type: 'FRONT_COMPONENT',
          gridPosition: { row: 0, column: 0, rowSpan: 12, columnSpan: 12 },
          configuration: {
            configurationType: 'FRONT_COMPONENT',
            frontComponentUniversalIdentifier: WHATSAPP_INBOX_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
          },
        },
      ],
    },
  ],
});
