import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
import {
  CLINIC_UNIT_OBJECT_UNIVERSAL_IDENTIFIER,
  CLINIC_UNIT_PATIENTS_FIELD_UNIVERSAL_IDENTIFIER,
  PATIENT_CLINIC_UNIT_FIELD_UNIVERSAL_IDENTIFIER,
  PATIENT_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: PATIENT_CLINIC_UNIT_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: PATIENT_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'clinicUnit',
  label: 'Unidade',
  icon: 'IconBuildingHospital',
  relationTargetObjectMetadataUniversalIdentifier: CLINIC_UNIT_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier: CLINIC_UNIT_PATIENTS_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    joinColumnName: 'clinicUnitId',
  },
});
