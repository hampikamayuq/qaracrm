import { defineObject, FieldType } from 'twenty-sdk/define';
import { SERVICE_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export const SERVICE_LABEL_FIELD_UNIVERSAL_IDENTIFIER = '9f13352c-b8b0-4bd5-b4af-614c0688c194';

export default defineObject({
  universalIdentifier: SERVICE_OBJECT_UNIVERSAL_IDENTIFIER,
  nameSingular: 'service',
  namePlural: 'services',
  labelSingular: 'Service',
  labelPlural: 'Services',
  description: 'Serviços e procedimentos oferecidos',
  icon: 'IconClipboardList',
  labelIdentifierFieldMetadataUniversalIdentifier: SERVICE_LABEL_FIELD_UNIVERSAL_IDENTIFIER,
  fields: [
    {
      universalIdentifier: '9f13352c-b8b0-4bd5-b4af-614c0688c194',
      type: FieldType.TEXT,
      name: 'name',
      label: 'Nome',
      icon: 'IconAbc',
    },
    {
      universalIdentifier: '401c2f6d-c0aa-431b-9fa4-4d491fdf1d4d',
      type: FieldType.TEXT,
      name: 'description',
      label: 'Descrição',
      icon: 'IconFileText',
    },
    {
      universalIdentifier: '46b6002c-d087-41a1-a896-041bb5b47ef9',
      type: FieldType.NUMBER,
      name: 'durationMin',
      label: 'Duração (min)',
      icon: 'IconClock',
    },
    {
      universalIdentifier: 'b64b962a-5345-4375-85bc-c8e7f710a742',
      type: FieldType.NUMBER,
      name: 'defaultPriceCents',
      label: 'Preço (centavos)',
      icon: 'IconCurrencyReal',
    },
    {
      universalIdentifier: 'a8156ad9-4d85-4a43-aac5-856e0cc2d4a4',
      type: FieldType.SELECT,
      name: 'modality',
      label: 'Modalidade',
      icon: 'IconDeviceLaptop',
      defaultValue: "'PRESENCIAL'",
      options: [
        { id: '1598bbe8-88a9-4bd2-980a-24446a4e8366', value: 'PRESENCIAL', label: 'Presencial', position: 0, color: 'blue' },
        { id: '06813cd0-151d-423b-b151-9a0628ec6507', value: 'TELECONSULTA', label: 'Teleconsulta', position: 1, color: 'purple' },
        { id: '3d4c075f-44e8-4bba-90f7-dc08be1ccd85', value: 'AMBOS', label: 'Ambos', position: 2, color: 'green' }
      ],
    },
    {
      universalIdentifier: '1534e073-4ec8-4d82-b756-098e16b7540a',
      type: FieldType.BOOLEAN,
      name: 'active',
      label: 'Ativo',
      icon: 'IconCheck',
      defaultValue: true,
    }
  ],
});
