import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
import {
  LEAD_CONVERTED_PATIENT_FIELD_UNIVERSAL_IDENTIFIER,
  LEAD_OBJECT_UNIVERSAL_IDENTIFIER,
  PATIENT_OBJECT_UNIVERSAL_IDENTIFIER,
  PATIENT_SOURCE_LEAD_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: LEAD_CONVERTED_PATIENT_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: LEAD_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'convertedPatients',
  label: 'Paciente (conversão)',
  icon: 'IconHeartbeat',
  relationTargetObjectMetadataUniversalIdentifier: PATIENT_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier: PATIENT_SOURCE_LEAD_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
