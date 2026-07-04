import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
import { LEAD_OBJECT_UNIVERSAL_IDENTIFIER, LEAD_TASKS_FIELD_UNIVERSAL_IDENTIFIER, TASK_LEAD_FIELD_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: LEAD_TASKS_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: LEAD_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'tasks',
  label: 'Follow-ups',
  icon: 'IconClipboardList',
  relationTargetObjectMetadataUniversalIdentifier: '20202020-1ba1-48ba-bc83-ef7e5990ed10', // standard task object
  relationTargetFieldMetadataUniversalIdentifier: TASK_LEAD_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: { relationType: RelationType.ONE_TO_MANY },
});
