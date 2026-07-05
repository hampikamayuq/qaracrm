import { defineField, FieldType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';
import { TASK_CATEGORY_FIELD_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: TASK_CATEGORY_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.task.universalIdentifier,
  type: FieldType.SELECT,
  name: 'category',
  label: 'Categoria',
  icon: 'IconCategory',
  options: [
    { id: 'a1b2c3d4-1111-4111-8111-111111111101', value: 'OVERDUE', label: 'Em atraso', position: 0, color: 'red' },
    { id: 'a1b2c3d4-1111-4111-8111-111111111102', value: 'TODAY', label: 'Hoje', position: 1, color: 'orange' },
    { id: 'a1b2c3d4-1111-4111-8111-111111111103', value: 'UPCOMING', label: 'Próximos', position: 2, color: 'blue' },
    { id: 'a1b2c3d4-1111-4111-8111-111111111104', value: 'NO_DATE', label: 'Sem data', position: 3, color: 'gray' },
  ],
});
