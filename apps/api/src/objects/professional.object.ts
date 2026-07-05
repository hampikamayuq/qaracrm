import { defineObject, FieldType } from 'twenty-sdk/define';
import { PROFESSIONAL_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export const PROFESSIONAL_LABEL_FIELD_UNIVERSAL_IDENTIFIER = '1594e790-fdca-4c29-9dd3-d79d6a0ad71f';

export default defineObject({
  universalIdentifier: PROFESSIONAL_OBJECT_UNIVERSAL_IDENTIFIER,
  nameSingular: 'professional',
  namePlural: 'professionals',
  labelSingular: 'Professional',
  labelPlural: 'Professionals',
  description: 'Médicos e profissionais da clínica',
  icon: 'IconStethoscope',
  labelIdentifierFieldMetadataUniversalIdentifier: PROFESSIONAL_LABEL_FIELD_UNIVERSAL_IDENTIFIER,
  fields: [
    {
      universalIdentifier: '1594e790-fdca-4c29-9dd3-d79d6a0ad71f',
      type: FieldType.FULL_NAME,
      name: 'name',
      label: 'Nome',
      icon: 'IconUser',
    },
    {
      universalIdentifier: '92953cb6-3a82-41d1-9ab2-916f2cebce10',
      type: FieldType.SELECT,
      name: 'specialty',
      label: 'Especialidade',
      icon: 'IconCategory',
      options: [
        { id: 'c424bed8-3d92-477c-a1c1-bfbeefbedc30', value: 'CIRURGIA', label: 'Cirurgia', position: 0, color: 'red' },
        { id: '34a40a7a-c2bd-413a-a1f9-b0e67f537c16', value: 'UNHAS', label: 'Unhas', position: 1, color: 'pink' },
        { id: 'f4eca9d1-07e7-4a66-ac0d-154fde2fc242', value: 'TRICOLOGIA', label: 'Tricologia', position: 2, color: 'purple' },
        { id: 'cad3b119-1715-468c-a7bb-7caf053b75df', value: 'AUTOIMUNE', label: 'Autoimune', position: 3, color: 'orange' },
        { id: '72d03a80-f8ff-44fa-a9bd-a671a280d5f0', value: 'DERMATOPEDIATRIA', label: 'Dermatopediatria', position: 4, color: 'sky' }
      ],
    },
    {
      universalIdentifier: '13ccff48-90cd-49fe-b91e-08aa00f3acff',
      type: FieldType.SELECT,
      name: 'modality',
      label: 'Modalidade',
      icon: 'IconDeviceLaptop',
      defaultValue: "'PRESENCIAL'",
      options: [
        { id: '53a07e52-62cd-4c22-97e3-06e862c44141', value: 'PRESENCIAL', label: 'Presencial', position: 0, color: 'blue' },
        { id: 'e57ecf4a-89a1-4bb5-8f69-784e8c29a2fd', value: 'TELECONSULTA', label: 'Teleconsulta', position: 1, color: 'purple' },
        { id: '947f6b70-54f0-44c1-a7d5-0a63e942ffe0', value: 'AMBOS', label: 'Ambos', position: 2, color: 'green' }
      ],
    },
    {
      universalIdentifier: 'ac060a1b-496e-4f30-8538-5ad5a6cf428f',
      type: FieldType.NUMBER,
      name: 'defaultPriceCents',
      label: 'Preço Padrão (centavos)',
      icon: 'IconCurrencyReal',
    },
    {
      universalIdentifier: '39974145-89c8-42b5-89ac-38c766f4d8d8',
      type: FieldType.NUMBER,
      name: 'rjPriceCents',
      label: 'Preço RJ (centavos)',
      icon: 'IconCurrencyReal',
    },
    {
      universalIdentifier: 'e67fca96-0d2f-435f-875e-c8ddb94830a5',
      type: FieldType.NUMBER,
      name: 'spPriceCents',
      label: 'Preço SP (centavos)',
      icon: 'IconCurrencyReal',
    },
    {
      universalIdentifier: 'fd5df141-74a7-44f4-84a9-c028de295ffb',
      type: FieldType.NUMBER,
      name: 'telePriceCents',
      label: 'Preço Tele (centavos)',
      icon: 'IconCurrencyReal',
    },
    {
      universalIdentifier: 'a34f76bd-53c7-43b4-ad61-339b388b5fcb',
      type: FieldType.BOOLEAN,
      name: 'active',
      label: 'Ativo',
      icon: 'IconCheck',
      defaultValue: true,
    }
  ],
});
