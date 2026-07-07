import { definePageLayout, PageLayoutTabLayoutMode } from 'twenty-sdk/define';

import {
  PIPELINE_PAGE_LAYOUT_TAB_UNIVERSAL_IDENTIFIER,
  PIPELINE_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  PIPELINE_PAGE_LAYOUT_WIDGET_UNIVERSAL_IDENTIFIER,
  PIPELINE_KANBAN_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default definePageLayout({
  universalIdentifier: PIPELINE_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  name: 'Pipeline Clínico',
  type: 'STANDALONE_PAGE',
  tabs: [
    {
      universalIdentifier: PIPELINE_PAGE_LAYOUT_TAB_UNIVERSAL_IDENTIFIER,
      title: 'Pipeline',
      position: 0,
      icon: 'IconRoute',
      layoutMode: PageLayoutTabLayoutMode.CANVAS,
      widgets: [
        {
          universalIdentifier: PIPELINE_PAGE_LAYOUT_WIDGET_UNIVERSAL_IDENTIFIER,
          title: ' ',
          type: 'FRONT_COMPONENT',
          gridPosition: { row: 0, column: 0, rowSpan: 12, columnSpan: 12 },
          configuration: {
            configurationType: 'FRONT_COMPONENT',
            frontComponentUniversalIdentifier: PIPELINE_KANBAN_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
          },
        },
      ],
    },
  ],
});