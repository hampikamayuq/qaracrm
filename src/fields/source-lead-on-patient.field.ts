import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
import {
  LEAD_CONVERTED_PATIENT_FIELD_UNIVERSAL_IDENTIFIER,
  LEAD_OBJECT_UNIVERSAL_IDENTIFIER,
  PATIENT_OBJECT_UNIVERSAL_IDENTIFIER,
  PATIENT_SOURCE_LEAD_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: PATIENT_SOURCE_LEAD_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: PATIENT_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'sourceLead',
  label: 'Lead de Origem',
  icon: 'IconTargetArrow',
  relationTargetObjectMetadataUniversalIdentifier: LEAD_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier: LEAD_CONVERTED_PATIENT_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    joinColumnName: 'sourceLeadId',
  },
});
