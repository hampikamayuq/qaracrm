import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
import {
  CLINIC_UNIT_LEADS_FIELD_UNIVERSAL_IDENTIFIER,
  CLINIC_UNIT_OBJECT_UNIVERSAL_IDENTIFIER,
  LEAD_CLINIC_UNIT_FIELD_UNIVERSAL_IDENTIFIER,
  LEAD_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: CLINIC_UNIT_LEADS_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: CLINIC_UNIT_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'leads',
  label: 'Leads',
  icon: 'IconTargetArrow',
  relationTargetObjectMetadataUniversalIdentifier: LEAD_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier: LEAD_CLINIC_UNIT_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
