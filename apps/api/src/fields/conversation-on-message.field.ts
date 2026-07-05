import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
import {
  CONVERSATION_MESSAGES_FIELD_UNIVERSAL_IDENTIFIER,
  CONVERSATION_OBJECT_UNIVERSAL_IDENTIFIER,
  MESSAGE_CONVERSATION_FIELD_UNIVERSAL_IDENTIFIER,
  MESSAGE_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: MESSAGE_CONVERSATION_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: MESSAGE_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'conversation',
  label: 'Conversa',
  icon: 'IconMessages',
  relationTargetObjectMetadataUniversalIdentifier: CONVERSATION_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier: CONVERSATION_MESSAGES_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    joinColumnName: 'conversationId',
  },
});
