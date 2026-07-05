import { defineObject, FieldType } from 'twenty-sdk/define';
import { MESSAGE_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export const CHATMESSAGE_LABEL_FIELD_UNIVERSAL_IDENTIFIER = '37913cda-3f1a-4525-8458-a8ef5bc162ec';

export default defineObject({
  universalIdentifier: MESSAGE_OBJECT_UNIVERSAL_IDENTIFIER,
  nameSingular: 'chatMessage',
  namePlural: 'chatMessages',
  labelSingular: 'Chat Message',
  labelPlural: 'Chat Messages',
  description: 'Mensagem individual em uma conversa',
  icon: 'IconMessage',
  labelIdentifierFieldMetadataUniversalIdentifier: CHATMESSAGE_LABEL_FIELD_UNIVERSAL_IDENTIFIER,
  fields: [
    {
      universalIdentifier: '37913cda-3f1a-4525-8458-a8ef5bc162ec',
      type: FieldType.TEXT,
      name: 'body',
      label: 'Conteúdo',
      icon: 'IconFileText',
    },
    {
      universalIdentifier: 'd965335f-84c7-4f21-9baf-d48bb4e4984d',
      type: FieldType.SELECT,
      name: 'direction',
      label: 'Direção',
      icon: 'IconArrowsLeftRight',
      options: [
        { id: 'e0e98a99-6286-4ffa-9f5f-c0b223ea1918', value: 'IN', label: 'Recebida', position: 0, color: 'blue' },
        { id: '04b8a591-f457-4e08-a97a-22a6472ed5f0', value: 'OUT', label: 'Enviada', position: 1, color: 'green' }
      ],
    },
    {
      universalIdentifier: '68f71b53-2c94-41c2-89fc-bc27fb8f9ea3',
      type: FieldType.DATE_TIME,
      name: 'sentAt',
      label: 'Enviada em',
      icon: 'IconClock',
    },
    {
      universalIdentifier: '52c1e450-c727-4b1a-b91b-201346be032f',
      type: FieldType.BOOLEAN,
      name: 'agentHandled',
      label: 'Tawany Processou',
      icon: 'IconRobot',
      defaultValue: false,
    },
    {
      universalIdentifier: '7c2ad5ed-04e8-4f68-8c3b-36f37c296efc',
      type: FieldType.TEXT,
      name: 'externalId',
      label: 'ID Externo (dedup)',
      icon: 'IconHash',
    },
    {
      universalIdentifier: '4a4c3136-87f8-419f-bbbb-099d23ebbbcc',
      type: FieldType.SELECT,
      name: 'messageType',
      label: 'Tipo',
      icon: 'IconCategory',
      defaultValue: "'TEXT'",
      options: [
        { id: '3a52b8cd-db28-46a7-88b1-d8bea8fe3a60', value: 'TEXT', label: 'Texto', position: 0, color: 'gray' },
        { id: '67b2d9af-54db-46b3-9f37-b25d2a9e65b1', value: 'BUTTON', label: 'Botão', position: 1, color: 'blue' },
        { id: '41d9d5c6-b3da-4e0d-a03d-2839d43af301', value: 'LIST', label: 'Lista', position: 2, color: 'purple' },
        { id: '80a45e6e-30f1-4976-9415-447fd2497df4', value: 'TEMPLATE', label: 'Modelo', position: 3, color: 'yellow' },
        { id: 'a285a3d0-5147-42c7-837f-def9bb550bb9', value: 'IMAGE', label: 'Imagem', position: 4, color: 'pink' },
        { id: '37295cd7-baa6-4a46-b57d-4abb741c845e', value: 'DOCUMENT', label: 'Documento', position: 5, color: 'orange' }
      ],
    },
    {
      universalIdentifier: '66242fdb-c862-4b62-a992-396bb5d92b57',
      type: FieldType.SELECT,
      name: 'deliveryStatus',
      label: 'Status de Entrega',
      icon: 'IconProgress',
      defaultValue: "'PENDING'",
      options: [
        { id: '33fe184e-e24e-4cc1-862e-defc55aa3aba', value: 'PENDING', label: 'Pendente', position: 0, color: 'gray' },
        { id: '12292087-6d4b-48c7-a4ba-a17c7275553a', value: 'SENT', label: 'Enviado', position: 1, color: 'blue' },
        { id: '8fac5ec5-e7f7-4a08-821d-2544fcc39c1a', value: 'DELIVERED', label: 'Entregue', position: 2, color: 'turquoise' },
        { id: '927fefb2-222c-41e5-a06b-7b1076931cd3', value: 'READ', label: 'Lido', position: 3, color: 'green' },
        { id: '6ad885ad-b05e-4f81-9e93-0fa2f008dee0', value: 'FAILED', label: 'Falhou', position: 4, color: 'red' }
      ],
    }
  ],
});
