import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
import {
  CONVERSATION_OBJECT_UNIVERSAL_IDENTIFIER,
  CONVERSATION_PATIENT_FIELD_UNIVERSAL_IDENTIFIER,
  PATIENT_CONVERSATIONS_FIELD_UNIVERSAL_IDENTIFIER,
  PATIENT_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: PATIENT_CONVERSATIONS_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: PATIENT_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'conversations',
  label: 'Conversas',
  icon: 'IconMessages',
  relationTargetObjectMetadataUniversalIdentifier: CONVERSATION_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier: CONVERSATION_PATIENT_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
