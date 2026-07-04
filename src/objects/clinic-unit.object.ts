import { defineObject, FieldType } from 'twenty-sdk/define';
import { CLINIC_UNIT_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export const CLINICUNIT_LABEL_FIELD_UNIVERSAL_IDENTIFIER = '5ec0a9b9-98fd-4312-b9f1-62154261cf59';

export default defineObject({
  universalIdentifier: CLINIC_UNIT_OBJECT_UNIVERSAL_IDENTIFIER,
  nameSingular: 'clinicUnit',
  namePlural: 'clinicUnits',
  labelSingular: 'Clinic Unit',
  labelPlural: 'Clinic Units',
  description: 'Unidades físicas da clínica (ex: Copacabana)',
  icon: 'IconBuildingHospital',
  labelIdentifierFieldMetadataUniversalIdentifier: CLINICUNIT_LABEL_FIELD_UNIVERSAL_IDENTIFIER,
  fields: [
    {
      universalIdentifier: '5ec0a9b9-98fd-4312-b9f1-62154261cf59',
      type: FieldType.TEXT,
      name: 'name',
      label: 'Nome',
      icon: 'IconAbc',
    },
    {
      universalIdentifier: '7d6a3ace-6809-4266-876c-47b5007d5d1c',
      type: FieldType.ADDRESS,
      name: 'unitAddress',
      label: 'Endereço',
      icon: 'IconMap',
    },
    {
      universalIdentifier: 'df45f251-6b7b-440e-bc02-6faf162f4943',
      type: FieldType.PHONES,
      name: 'phone',
      label: 'Telefone',
      icon: 'IconPhone',
    },
    {
      universalIdentifier: '26521feb-dca0-41c5-867d-d861782c856f',
      type: FieldType.BOOLEAN,
      name: 'active',
      label: 'Ativa',
      icon: 'IconCheck',
      defaultValue: true,
    }
  ],
});
