import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
import {
  CLINIC_UNIT_OBJECT_UNIVERSAL_IDENTIFIER,
  CLINIC_UNIT_PATIENTS_FIELD_UNIVERSAL_IDENTIFIER,
  PATIENT_CLINIC_UNIT_FIELD_UNIVERSAL_IDENTIFIER,
  PATIENT_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: CLINIC_UNIT_PATIENTS_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: CLINIC_UNIT_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'patients',
  label: 'Patients',
  icon: 'IconHeartbeat',
  relationTargetObjectMetadataUniversalIdentifier: PATIENT_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier: PATIENT_CLINIC_UNIT_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
