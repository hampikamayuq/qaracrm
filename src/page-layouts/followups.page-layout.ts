import { definePageLayout, PageLayoutTabLayoutMode } from 'twenty-sdk/define';
import {
  FOLLOWUPS_DASHBOARD_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  FOLLOWUPS_PAGE_LAYOUT_TAB_UNIVERSAL_IDENTIFIER,
  FOLLOWUPS_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  FOLLOWUPS_PAGE_LAYOUT_WIDGET_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default definePageLayout({
  universalIdentifier: FOLLOWUPS_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  name: 'Follow-ups',
  type: 'STANDALONE_PAGE',
  tabs: [
    {
      universalIdentifier: FOLLOWUPS_PAGE_LAYOUT_TAB_UNIVERSAL_IDENTIFIER,
      title: 'Board',
      position: 0,
      icon: 'IconCalendarCheck',
      layoutMode: PageLayoutTabLayoutMode.CANVAS,
      widgets: [
        {
          universalIdentifier: FOLLOWUPS_PAGE_LAYOUT_WIDGET_UNIVERSAL_IDENTIFIER,
          title: ' ',
          type: 'FRONT_COMPONENT',
          gridPosition: { row: 0, column: 0, rowSpan: 12, columnSpan: 12 },
          configuration: {
            configurationType: 'FRONT_COMPONENT',
            frontComponentUniversalIdentifier: FOLLOWUPS_DASHBOARD_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
          },
        },
      ],
    },
  ],
});
