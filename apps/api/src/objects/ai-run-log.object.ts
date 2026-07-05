import { defineObject, FieldType } from 'twenty-sdk/define';
import { AI_RUN_LOG_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export const AI_RUN_LOG_LABEL_FIELD_UNIVERSAL_IDENTIFIER = 'f8138e4f-03a3-4da0-a896-b3564392afae';

export default defineObject({
  universalIdentifier: AI_RUN_LOG_OBJECT_UNIVERSAL_IDENTIFIER,
  nameSingular: 'aiRunLog',
  namePlural: 'aiRunLogs',
  labelSingular: 'AI Run Log',
  labelPlural: 'AI Run Logs',
  description: 'Technical audit log for QARA AI calls',
  icon: 'IconRobot',
  labelIdentifierFieldMetadataUniversalIdentifier: AI_RUN_LOG_LABEL_FIELD_UNIVERSAL_IDENTIFIER,
  fields: [
    {
      universalIdentifier: AI_RUN_LOG_LABEL_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'layer',
      label: 'Layer',
      icon: 'IconStack2',
    },
    {
      universalIdentifier: '69b93334-cdbb-42b5-b706-ad9cdb4d9ab0',
      type: FieldType.TEXT,
      name: 'model',
      label: 'Model',
      icon: 'IconCpu',
    },
    {
      universalIdentifier: '2e7db952-cbcc-44e0-8186-da81ae15cdd7',
      type: FieldType.BOOLEAN,
      name: 'fallbackUsed',
      label: 'Fallback Used',
      icon: 'IconSwitch3',
      defaultValue: false,
    },
    {
      universalIdentifier: 'cd00b10a-d29b-40d1-81ca-55beef3af3b9',
      type: FieldType.NUMBER,
      name: 'latencyMs',
      label: 'Latency (ms)',
      icon: 'IconClock',
    },
    {
      universalIdentifier: '8787a5ba-0545-42f0-8d70-e4465325b23b',
      type: FieldType.BOOLEAN,
      name: 'success',
      label: 'Success',
      icon: 'IconCheck',
      defaultValue: false,
    },
    {
      universalIdentifier: '7d2ed6ce-3e53-4c39-a7dc-d8b67a28f285',
      type: FieldType.BOOLEAN,
      name: 'validationPass',
      label: 'Validation Pass',
      icon: 'IconShieldCheck',
    },
    {
      universalIdentifier: '4c2cd1c7-1f67-4915-9e0f-d5de9907ec18',
      type: FieldType.TEXT,
      name: 'reason',
      label: 'Reason',
      icon: 'IconFileText',
    },
    {
      universalIdentifier: '76cf14c8-7a1f-4093-bcbf-006b1723212e',
      type: FieldType.TEXT,
      name: 'conversationId',
      label: 'Conversation ID',
      icon: 'IconMessages',
    },
    {
      universalIdentifier: '30161e31-6102-428c-90c3-39f80eb8ae59',
      type: FieldType.TEXT,
      name: 'messageId',
      label: 'Message ID',
      icon: 'IconMessage',
    },
    {
      universalIdentifier: 'f03a59ba-13da-4d26-a9ac-37eab01f202b',
      type: FieldType.DATE_TIME,
      name: 'createdAt',
      label: 'Created At',
      icon: 'IconCalendar',
    },
  ],
});
