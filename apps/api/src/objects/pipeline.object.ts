import { defineObject, FieldType } from 'twenty-sdk/define';
import { PIPELINE_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

const CLINICAL_PIPELINES = [
  'unhas',
  'cirurgia',
  'tricologia',
  'inflamatorias',
  'dermatopediatria',
  'dermatologia-clinica',
  'podologia',
  'administrativo',
  'reativacao',
] as const;

export default defineObject({
  universalIdentifier: PIPELINE_OBJECT_UNIVERSAL_IDENTIFIER,
  nameSingular: 'pipeline',
  namePlural: 'pipelines',
  labelSingular: 'Pipeline Clínico',
  labelPlural: 'Pipelines Clínicos',
  description: 'Pipelines de especialidades dermatológicas',
  icon: 'IconRoute',
  fields: [
    {
      universalIdentifier: '5e6f7a8b-9c0d-1234-ef56-789012345678',
      type: FieldType.TEXT,
      name: 'name',
      label: 'Nome',
      icon: 'IconText',
    },
    {
      universalIdentifier: '6f7a8b9c-0d1e-2345-f678-901234567890',
      type: FieldType.SELECT,
      name: 'slug',
      label: 'Identificador',
      icon: 'IconHash',
      options: CLINICAL_PIPELINES.map((p, i) => ({
        id: `slug-${p}`,
        value: p,
        label: p.charAt(0).toUpperCase() + p.slice(1).replace('-', ' '),
        position: i,
        color: 'blue',
      })),
    },
    {
      universalIdentifier: '7a8b9c0d-1e2f-3456-7890-123456789012',
      type: FieldType.NUMBER,
      name: 'order',
      label: 'Ordem',
      icon: 'IconNumber',
    },
    {
      universalIdentifier: '8b9c0d1e-2f3a-4567-8901-234567890123',
      type: FieldType.TEXT,
      name: 'color',
      label: 'Cor',
      icon: 'IconPalette',
    },
  ],
});