import { type Role } from '@twentycrm/app-config';

export const doctorRole: Role = {
  universalIdentifier: 'f3a4b5c6-d7e8-9012-cdef-345678901235',
  name: 'DOCTOR',
  description: 'Médico - acesso a pacientes, conversas e agenda própria',
  isDefault: false,
  permissions: [
    { object: 'lead', read: true, write: false, destroy: false, export: false },
    { object: 'patient', read: true, write: false, destroy: false, export: true },
    { object: 'conversation', read: true, write: false, destroy: false, export: false },
    { object: 'chatMessage', read: true, write: false, destroy: false, export: false },
    { object: 'service', read: true, write: false, destroy: false, export: true },
    { object: 'professional', read: true, write: false, destroy: false, export: true },
    { object: 'clinicUnit', read: true, write: false, destroy: false, export: true },
    { object: 'task', read: true, write: true, destroy: false, export: true },
    { object: 'pipeline', read: true, write: false, destroy: false, export: false },
    { object: 'pipelineStage', read: true, write: false, destroy: false, export: false },
  ],
};