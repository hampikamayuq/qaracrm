import { definePageLayout, PageLayoutTabLayoutMode } from 'twenty-sdk/define';

import {
  KANBAN_PAGE_LAYOUT_TAB_UNIVERSAL_IDENTIFIER,
  KANBAN_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  KANBAN_PAGE_LAYOUT_WIDGET_UNIVERSAL_IDENTIFIER,
  LEAD_KANBAN_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default definePageLayout({
  universalIdentifier: KANBAN_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  name: 'Funil de Leads',
  type: 'STANDALONE_PAGE',
  tabs: [
    {
      universalIdentifier: KANBAN_PAGE_LAYOUT_TAB_UNIVERSAL_IDENTIFIER,
      title: 'Funil',
      position: 0,
      icon: 'IconLayoutKanban',
      layoutMode: PageLayoutTabLayoutMode.CANVAS,
      widgets: [
        {
          universalIdentifier: KANBAN_PAGE_LAYOUT_WIDGET_UNIVERSAL_IDENTIFIER,
          title: ' ',
          type: 'FRONT_COMPONENT',
          gridPosition: { row: 0, column: 0, rowSpan: 12, columnSpan: 12 },
          configuration: {
            configurationType: 'FRONT_COMPONENT',
            frontComponentUniversalIdentifier: LEAD_KANBAN_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
          },
        },
      ],
    },
  ],
});
