import { defineObject, FieldType } from 'twenty-sdk/define';
import { PIPELINE_STAGE_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

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
  universalIdentifier: PIPELINE_STAGE_OBJECT_UNIVERSAL_IDENTIFIER,
  nameSingular: 'pipelineStage',
  namePlural: 'pipelineStages',
  labelSingular: 'Etapa do Pipeline',
  labelPlural: 'Etapas do Pipeline',
  description: 'Etapas do funil clínico por especialidade dermatológica',
  icon: 'IconLayoutKanban',
  fields: [
    {
      universalIdentifier: '1a2b3c4d-5e6f-7890-abcd-ef1234567890',
      type: FieldType.TEXT,
      name: 'name',
      label: 'Nome',
      icon: 'IconText',
    },
    {
      universalIdentifier: '2b3c4d5e-6f7a-8901-bcde-f23456789012',
      type: FieldType.NUMBER,
      name: 'order',
      label: 'Ordem',
      icon: 'IconNumber',
    },
    {
      universalIdentifier: '3c4d5e6f-7a8b-9012-cdef-345678901234',
      type: FieldType.SELECT,
      name: 'pipeline',
      label: 'Pipeline Clínico',
      icon: 'IconRoute',
      options: CLINICAL_PIPELINES.map((p, i) => ({
        id: `pipeline-${p}`,
        value: p,
        label: p.charAt(0).toUpperCase() + p.slice(1).replace('-', ' '),
        position: i,
        color: 'blue',
      })),
    },
    {
      universalIdentifier: '4d5e6f7a-8b9c-0123-def4-567890123456',
      type: FieldType.TEXT,
      name: 'color',
      label: 'Cor',
      icon: 'IconPalette',
    },
  ],
});