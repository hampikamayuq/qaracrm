import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
import {
  CONVERSATION_OBJECT_UNIVERSAL_IDENTIFIER,
  CONVERSATION_PATIENT_FIELD_UNIVERSAL_IDENTIFIER,
  PATIENT_CONVERSATIONS_FIELD_UNIVERSAL_IDENTIFIER,
  PATIENT_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: CONVERSATION_PATIENT_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: CONVERSATION_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'patient',
  label: 'Paciente',
  icon: 'IconHeartbeat',
  relationTargetObjectMetadataUniversalIdentifier: PATIENT_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier: PATIENT_CONVERSATIONS_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    joinColumnName: 'patientId',
  },
});
