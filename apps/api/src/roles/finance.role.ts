import { type Role } from '@twentycrm/app-config';

export const financeRole: Role = {
  universalIdentifier: 'a4b5c6d7-e8f9-0123-def4-567890123457',
  name: 'FINANCE',
  description: 'Financeiro - placeholder para futura implementação de gestão financeira',
  isDefault: false,
  permissions: [
    { object: 'lead', read: true, write: false, destroy: false, export: true },
    { object: 'patient', read: true, write: false, destroy: false, export: true },
    { object: 'conversation', read: false, write: false, destroy: false, export: false },
    { object: 'chatMessage', read: false, write: false, destroy: false, export: false },
    { object: 'service', read: true, write: false, destroy: false, export: true },
    { object: 'professional', read: true, write: false, destroy: false, export: true },
    { object: 'clinicUnit', read: true, write: false, destroy: false, export: true },
    { object: 'task', read: true, write: false, destroy: false, export: true },
    { object: 'pipeline', read: false, write: false, destroy: false, export: false },
    { object: 'pipelineStage', read: false, write: false, destroy: false, export: false },
  ],
};