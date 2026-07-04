import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
import { LEAD_OBJECT_UNIVERSAL_IDENTIFIER, LEAD_TASKS_FIELD_UNIVERSAL_IDENTIFIER, TASK_LEAD_FIELD_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: TASK_LEAD_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: '20202020-1ba1-48ba-bc83-ef7e5990ed10', // standard task object
  type: FieldType.RELATION,
  name: 'lead',
  label: 'Lead',
  icon: 'IconTargetArrow',
  relationTargetObjectMetadataUniversalIdentifier: LEAD_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier: LEAD_TASKS_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: { relationType: RelationType.MANY_TO_ONE, joinColumnName: 'leadId' },
});
