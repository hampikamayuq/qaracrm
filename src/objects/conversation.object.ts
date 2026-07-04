import { defineObject, FieldType } from 'twenty-sdk/define';
import { CONVERSATION_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export const CONVERSATION_LABEL_FIELD_UNIVERSAL_IDENTIFIER = '849bbc27-69dd-49ec-8a58-8c59f10a8de7';

export default defineObject({
  universalIdentifier: CONVERSATION_OBJECT_UNIVERSAL_IDENTIFIER,
  nameSingular: 'conversation',
  namePlural: 'conversations',
  labelSingular: 'Conversation',
  labelPlural: 'Conversations',
  description: 'Thread WhatsApp/Instagram de um contato',
  icon: 'IconMessages',
  labelIdentifierFieldMetadataUniversalIdentifier: CONVERSATION_LABEL_FIELD_UNIVERSAL_IDENTIFIER,
  fields: [
    {
      universalIdentifier: '849bbc27-69dd-49ec-8a58-8c59f10a8de7',
      type: FieldType.TEXT,
      name: 'externalId',
      label: 'ID Externo',
      icon: 'IconHash',
    },
    {
      universalIdentifier: '2ee2b491-0e77-4839-90a8-3f9940358ea0',
      type: FieldType.SELECT,
      name: 'channel',
      label: 'Canal',
      icon: 'IconBrandWhatsapp',
      defaultValue: "'WHATSAPP'",
      options: [
        { id: '8cd904ca-db3c-4f01-9c6e-e8d6ec94c784', value: 'WHATSAPP', label: 'WhatsApp', position: 0, color: 'green' },
        { id: '4424d09c-aa9e-4512-88ed-4803ed3270a3', value: 'INSTAGRAM', label: 'Instagram', position: 1, color: 'pink' }
      ],
    },
    {
      universalIdentifier: '427a83cd-760f-4248-bf0f-1d912c04b480',
      type: FieldType.SELECT,
      name: 'status',
      label: 'Status',
      icon: 'IconProgress',
      defaultValue: "'OPEN'",
      options: [
        { id: 'f9199ec7-1e7b-4202-ac70-00e403843f31', value: 'OPEN', label: 'Aberta', position: 0, color: 'blue' },
        { id: '64d7b717-9410-4347-84fa-6224614aedfd', value: 'NEEDS_HUMAN', label: 'Precisa Humano', position: 1, color: 'red' },
        { id: 'ba92adb6-2ea9-4cd5-b7dc-f68f4b80060d', value: 'RESOLVED', label: 'Resolvida', position: 2, color: 'green' },
        { id: '8d2d6b3e-afee-4586-b6d9-f6c39a91e652', value: 'ARCHIVED', label: 'Arquivada', position: 3, color: 'gray' }
      ],
    },
    {
      universalIdentifier: '1808ab49-df55-4f94-acdd-7b15332d501e',
      type: FieldType.BOOLEAN,
      name: 'needsHuman',
      label: 'Precisa Humano',
      icon: 'IconAlertCircle',
      defaultValue: false,
    },
    {
      universalIdentifier: 'f1ebacc9-8d91-4b17-8b4c-4f1e9a82f08a',
      type: FieldType.TEXT,
      name: 'handoffReason',
      label: 'Motivo do Handoff',
      icon: 'IconFileText',
    },
    {
      universalIdentifier: 'a83668b0-f6c5-405e-952e-5d62683fedd3',
      type: FieldType.DATE_TIME,
      name: 'lastMessageAt',
      label: 'Última Mensagem',
      icon: 'IconClock',
    },
    {
      universalIdentifier: 'a33fac9c-c048-4268-a18a-6ae862d9e09c',
      type: FieldType.TEXT,
      name: 'summary',
      label: 'Resumo',
      icon: 'IconFileText',
    },
    {
      universalIdentifier: 'd462b392-50cf-4131-a65a-8288d6d27406',
      type: FieldType.DATE_TIME,
      name: 'summaryUpdatedAt',
      label: 'Resumo Atualizado em',
      icon: 'IconClock',
    },
    {
      universalIdentifier: '7aa562e4-ccd4-479f-8d81-9149040af46f',
      type: FieldType.MULTI_SELECT,
      name: 'tags',
      label: 'Tags',
      icon: 'IconTags',
      options: [
        { id: '0d3471c0-0ba7-460d-8126-8045295c70d1', value: 'LEAD_QUENTE', label: 'lead-quente', position: 0, color: 'orange' },
        { id: 'f5ecb638-93df-45ab-b295-ba0d8ea66170', value: 'LEAD_FRIO', label: 'lead-frio', position: 1, color: 'blue' },
        { id: '5fcfc456-42b4-4350-a6ef-9b624d6d9250', value: 'NOVO', label: 'novo', position: 2, color: 'turquoise' },
        { id: 'd34428a5-49a3-4029-9246-3a6d69523439', value: 'AGENDAR', label: 'agendar', position: 3, color: 'purple' },
        { id: '0ef5ac48-be93-4a16-bf7b-e8bb8ec35ddb', value: 'FOLLOW_UP', label: 'follow-up', position: 4, color: 'yellow' },
        { id: '4000c0f3-e5e8-4e9f-933e-25a3385c64d3', value: 'NO_SHOW', label: 'no-show', position: 5, color: 'red' },
        { id: '6ee3cab9-ccc6-4be9-b576-6ac4b373d6c1', value: 'VIP', label: 'vip', position: 6, color: 'pink' },
        { id: '8555127e-e412-4c45-a74e-6d526210c37c', value: 'HUMANO', label: 'humano', position: 7, color: 'green' }
      ],
    }
  ],
});
