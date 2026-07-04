import { defineObject, FieldType } from 'twenty-sdk/define';
import { LEAD_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export const LEAD_LABEL_FIELD_UNIVERSAL_IDENTIFIER = '30c003fc-c4a1-47a5-844a-a2b8dc23c211';

export default defineObject({
  universalIdentifier: LEAD_OBJECT_UNIVERSAL_IDENTIFIER,
  nameSingular: 'lead',
  namePlural: 'leads',
  labelSingular: 'Lead',
  labelPlural: 'Leads',
  description: 'Leads novos e em funil',
  icon: 'IconTargetArrow',
  labelIdentifierFieldMetadataUniversalIdentifier: LEAD_LABEL_FIELD_UNIVERSAL_IDENTIFIER,
  fields: [
    {
      universalIdentifier: '30c003fc-c4a1-47a5-844a-a2b8dc23c211',
      type: FieldType.FULL_NAME,
      name: 'name',
      label: 'Nome',
      icon: 'IconUser',
    },
    {
      universalIdentifier: '79cdcd74-5c2b-4c1f-bd10-bc41f6e28963',
      type: FieldType.PHONES,
      name: 'whatsapp',
      label: 'WhatsApp',
      icon: 'IconBrandWhatsapp',
    },
    {
      universalIdentifier: '348410b7-9c12-427b-8b48-27a64b45671f',
      type: FieldType.EMAILS,
      name: 'email',
      label: 'Email',
      icon: 'IconMail',
    },
    {
      universalIdentifier: 'ac1c10a3-d2c6-450f-bd19-755ab96f3adb',
      type: FieldType.SELECT,
      name: 'source',
      label: 'Origem',
      icon: 'IconWorld',
      defaultValue: "'OUTRO'",
      options: [
        { id: '6bbe2265-f0ff-4981-913e-0c0f5277a3b7', value: 'SITE', label: 'Site', position: 0, color: 'blue' },
        { id: '006194ad-b7aa-4a82-8142-f594c38189d0', value: 'INSTAGRAM', label: 'Instagram', position: 1, color: 'pink' },
        { id: 'c19e86d8-9122-4953-b55a-8e08a1a6eb4d', value: 'INDICACAO', label: 'Indicação', position: 2, color: 'green' },
        { id: 'da55356f-d850-420e-98fb-d91cfbc7f9e2', value: 'GOOGLE', label: 'Google', position: 3, color: 'yellow' },
        { id: '83107265-9bdc-4614-9406-281e3cc88cb1', value: 'META_ADS', label: 'Meta Ads', position: 4, color: 'purple' },
        { id: 'f76579c7-a837-4590-b4d8-71bb101cc467', value: 'OUTRO', label: 'Outro', position: 5, color: 'gray' }
      ],
    },
    {
      universalIdentifier: 'fca35f8d-9d86-4e56-b91c-5ad7753e19d4',
      type: FieldType.SELECT,
      name: 'intent',
      label: 'Intenção',
      icon: 'IconCategory',
      options: [
        { id: '79258031-077a-4aa1-b3b3-57c9facb6831', value: 'CIRURGIA', label: 'Cirurgia', position: 0, color: 'red' },
        { id: '51c70e38-ffe7-42a8-8af2-ff3e7b976aa0', value: 'UNHAS', label: 'Unhas', position: 1, color: 'pink' },
        { id: '3813b138-a37d-43c3-b9f6-e174f3c58574', value: 'TRICOLOGIA', label: 'Tricologia', position: 2, color: 'purple' },
        { id: 'c79c4a83-75c2-46a3-b690-445d0819c785', value: 'AUTOIMUNE', label: 'Autoimune', position: 3, color: 'orange' },
        { id: 'b510a3de-5b12-4037-8045-631796e17fbf', value: 'DERMATOPEDIATRIA', label: 'Dermatopediatria', position: 4, color: 'sky' },
        { id: 'f7dedf0f-9dd7-4df2-be36-906f1b9a3935', value: 'OUTRO', label: 'Outro', position: 5, color: 'gray' }
      ],
    },
    {
      universalIdentifier: '612118cb-d499-4cdc-bde7-954cf3bc7ffd',
      type: FieldType.SELECT,
      name: 'stage',
      label: 'Etapa',
      icon: 'IconProgress',
      defaultValue: "'NOVO'",
      options: [
        { id: '904aafa1-2b59-4e64-a5b3-d56519c7bacd', value: 'NOVO', label: 'Novo', position: 0, color: 'turquoise' },
        { id: '704082fc-da33-4335-acd0-c5c519bcbb36', value: 'QUALIFICADO', label: 'Qualificado', position: 1, color: 'blue' },
        { id: '10fe1fe0-16ea-4cf0-8916-660c95444bfd', value: 'AGENDADO', label: 'Agendado', position: 2, color: 'purple' },
        { id: 'd816356a-6606-48e4-8b34-a5a8e4e2c455', value: 'COMPARECEU', label: 'Compareceu', position: 3, color: 'green' },
        { id: '01f5d26c-3d3c-44e1-a98c-31b6c1e8ecec', value: 'PERDIDO', label: 'Perdido', position: 4, color: 'red' },
        { id: '8be17a3f-f504-45d3-9481-a0fba3a4ab5c', value: 'CONVERTIDO', label: 'Convertido', position: 5, color: 'yellow' }
      ],
    },
    {
      universalIdentifier: 'a1a67bfa-8577-43de-a73f-4b1ebc1113fa',
      type: FieldType.NUMBER,
      name: 'score',
      label: 'Score',
      icon: 'IconNumber',
      defaultValue: 50,
    },
    {
      universalIdentifier: '090030f0-36ad-485d-8be9-578341ec855f',
      type: FieldType.RAW_JSON,
      name: 'scoreReasons',
      label: 'Razões do Score',
      icon: 'IconBraces',
    },
    {
      universalIdentifier: '869dfe8e-aaff-43ea-a10a-fbbc28ff68eb',
      type: FieldType.MULTI_SELECT,
      name: 'tags',
      label: 'Tags',
      icon: 'IconTags',
      options: [
        { id: '553e5ee6-c149-4088-9dbd-46ece36fe43b', value: 'LEAD_QUENTE', label: 'lead-quente', position: 0, color: 'orange' },
        { id: 'b25f8581-66a9-424c-947c-e0fb65965a90', value: 'LEAD_FRIO', label: 'lead-frio', position: 1, color: 'blue' },
        { id: 'cf54995d-3160-4d0a-b9fc-2ba583217381', value: 'NOVO', label: 'novo', position: 2, color: 'turquoise' },
        { id: 'd6817d05-59c7-469b-9cd1-ef34aeadecdb', value: 'AGENDAR', label: 'agendar', position: 3, color: 'purple' },
        { id: '63736483-1d80-4d61-82c9-a7db42855625', value: 'FOLLOW_UP', label: 'follow-up', position: 4, color: 'yellow' },
        { id: '353415c9-278b-4673-a2f5-f3368e23d9f7', value: 'NO_SHOW', label: 'no-show', position: 5, color: 'red' },
        { id: '8f3b78ae-8e8a-460e-8452-13bc758cbfe2', value: 'VIP', label: 'vip', position: 6, color: 'pink' },
        { id: '2ce98adb-3779-4902-92c3-ae1fe3d1ae91', value: 'HUMANO', label: 'humano', position: 7, color: 'green' }
      ],
    },
    {
      universalIdentifier: '99a5bf10-fd61-45e1-b92a-5daae61ee7c0',
      type: FieldType.DATE_TIME,
      name: 'convertedAt',
      label: 'Convertido em',
      icon: 'IconCalendarCheck',
    }
  ],
});
