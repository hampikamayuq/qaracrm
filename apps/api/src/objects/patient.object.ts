import { defineObject, FieldType } from 'twenty-sdk/define';
import { PATIENT_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export const PATIENT_LABEL_FIELD_UNIVERSAL_IDENTIFIER = '18f2224b-73a9-4dab-a2c7-38b168c6c7db';

export default defineObject({
  universalIdentifier: PATIENT_OBJECT_UNIVERSAL_IDENTIFIER,
  nameSingular: 'patient',
  namePlural: 'patients',
  labelSingular: 'Patient',
  labelPlural: 'Patients',
  description: 'Pacientes ativos da clínica',
  icon: 'IconHeartbeat',
  labelIdentifierFieldMetadataUniversalIdentifier: PATIENT_LABEL_FIELD_UNIVERSAL_IDENTIFIER,
  fields: [
    {
      universalIdentifier: '18f2224b-73a9-4dab-a2c7-38b168c6c7db',
      type: FieldType.FULL_NAME,
      name: 'name',
      label: 'Nome',
      icon: 'IconUser',
    },
    {
      universalIdentifier: 'fa94810c-7aed-4097-ae84-79a4d9e4b71d',
      type: FieldType.PHONES,
      name: 'whatsapp',
      label: 'WhatsApp',
      icon: 'IconBrandWhatsapp',
    },
    {
      universalIdentifier: '8cafd2f5-d178-42c1-b9f4-3724e9fa56da',
      type: FieldType.EMAILS,
      name: 'email',
      label: 'Email',
      icon: 'IconMail',
    },
    {
      universalIdentifier: 'f15eb3e6-882b-405d-9efc-1c6831971f4e',
      type: FieldType.DATE,
      name: 'birthDate',
      label: 'Data de Nascimento',
      icon: 'IconCake',
    },
    {
      universalIdentifier: '5a792586-f2ff-436e-8887-afc0cc741ced',
      type: FieldType.MULTI_SELECT,
      name: 'tags',
      label: 'Tags',
      icon: 'IconTags',
      options: [
        { id: '616459c7-da6f-4018-99ae-9b3302af2b32', value: 'LEAD_QUENTE', label: 'lead-quente', position: 0, color: 'orange' },
        { id: '83d6ca82-58b2-4a9a-ad0d-f16493d31b05', value: 'LEAD_FRIO', label: 'lead-frio', position: 1, color: 'blue' },
        { id: 'd0006b58-e03c-4401-a243-8f9f213d1585', value: 'NOVO', label: 'novo', position: 2, color: 'turquoise' },
        { id: '04f83481-2f4c-4b4d-94c1-821ccd60f4f9', value: 'AGENDAR', label: 'agendar', position: 3, color: 'purple' },
        { id: '05b298db-6579-4d55-bd4b-8a7ec707f3d2', value: 'FOLLOW_UP', label: 'follow-up', position: 4, color: 'yellow' },
        { id: '8f8edd51-629b-4fdb-a8df-b5c0606bb632', value: 'NO_SHOW', label: 'no-show', position: 5, color: 'red' },
        { id: 'd0aabc32-2495-4aa0-aff3-ad77c74a2ee9', value: 'VIP', label: 'vip', position: 6, color: 'pink' },
        { id: '0ca61180-354f-4e05-8980-0b2841fe9956', value: 'HUMANO', label: 'humano', position: 7, color: 'green' }
      ],
    }
  ],
});
