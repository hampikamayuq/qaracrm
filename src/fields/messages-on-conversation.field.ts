import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
import {
  CONVERSATION_MESSAGES_FIELD_UNIVERSAL_IDENTIFIER,
  CONVERSATION_OBJECT_UNIVERSAL_IDENTIFIER,
  MESSAGE_CONVERSATION_FIELD_UNIVERSAL_IDENTIFIER,
  MESSAGE_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: CONVERSATION_MESSAGES_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: CONVERSATION_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'messages',
  label: 'Mensagens',
  icon: 'IconMessage',
  relationTargetObjectMetadataUniversalIdentifier: MESSAGE_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier: MESSAGE_CONVERSATION_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
