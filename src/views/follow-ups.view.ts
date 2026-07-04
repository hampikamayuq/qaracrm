import { defineView, ViewType, ViewFilterOperand, ViewSortDirection } from 'twenty-sdk/define';
import {
  FOLLOWUPS_VIEW_UNIVERSAL_IDENTIFIER,
  TASK_CATEGORY_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineView({
  universalIdentifier: FOLLOWUPS_VIEW_UNIVERSAL_IDENTIFIER,
  name: 'Follow-ups Pendentes',
  objectUniversalIdentifier: '20202020-1ba1-48ba-bc83-ef7e5990ed10', // standard task object
  type: ViewType.KANBAN,
  icon: 'IconCalendarCheck',
  position: 0,
  mainGroupByFieldMetadataUniversalIdentifier: TASK_CATEGORY_FIELD_UNIVERSAL_IDENTIFIER,
  filters: [
    {
      universalIdentifier: '9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c11',
      fieldMetadataUniversalIdentifier: '20202020-70bc-48f9-89c5-6aa730b151e0', // status
      operand: ViewFilterOperand.IS,
      value: 'TODO',
    },
  ],
  sorts: [
    {
      universalIdentifier: '9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c12',
      fieldMetadataUniversalIdentifier: '20202020-fd99-40da-951b-4cb9a352fce3', // dueAt
      direction: ViewSortDirection.ASC,
    },
  ],
  fields: [
    {
      universalIdentifier: '9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c20',
      fieldMetadataUniversalIdentifier: '20202020-b386-4cb7-aa5a-08d4a4d92680', // title
      position: 0,
      isVisible: true,
      size: 240,
    },
    {
      universalIdentifier: '9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c21',
      fieldMetadataUniversalIdentifier: TASK_CATEGORY_FIELD_UNIVERSAL_IDENTIFIER, // category
      position: 1,
      isVisible: true,
      size: 140,
    },
    {
      universalIdentifier: '9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c22',
      fieldMetadataUniversalIdentifier: '20202020-065a-4f42-a906-e20422c1753f', // assignee
      position: 2,
      isVisible: true,
      size: 180,
    },
    {
      universalIdentifier: '9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c23',
      fieldMetadataUniversalIdentifier: '20202020-fd99-40da-951b-4cb9a352fce3', // dueAt
      position: 3,
      isVisible: true,
      size: 160,
    },
    {
      universalIdentifier: '9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c24',
      fieldMetadataUniversalIdentifier: '4d7c2b1e-8a3f-4e6d-b5c4-2f1e0d9c8b05', // lead (custom)
      position: 4,
      isVisible: true,
      size: 180,
    },
  ],
});
