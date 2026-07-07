import { type Role } from '@twentycrm/app-config';

export const receptionRole: Role = {
  universalIdentifier: 'e2f3a4b5-c6d7-8901-bcde-f23456789013',
  name: 'RECEPTION',
  description: 'Recepção - gerencia leads, pacientes, conversas e agendamentos',
  isDefault: true,
  permissions: [
    { object: 'lead', read: true, write: true, destroy: false, export: true },
    { object: 'patient', read: true, write: true, destroy: false, export: true },
    { object: 'conversation', read: true, write: true, destroy: false, export: true },
    { object: 'chatMessage', read: true, write: true, destroy: false, export: true },
    { object: 'service', read: true, write: true, destroy: false, export: true },
    { object: 'professional', read: true, write: false, destroy: false, export: true },
    { object: 'clinicUnit', read: true, write: false, destroy: false, export: true },
    { object: 'task', read: true, write: true, destroy: false, export: true },
    { object: 'pipeline', read: true, write: true, destroy: false, export: true },
    { object: 'pipelineStage', read: true, write: false, destroy: false, export: true },
  ],
};