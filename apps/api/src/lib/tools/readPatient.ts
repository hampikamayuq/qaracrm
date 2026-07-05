import { z } from 'zod';
import type { DataApi } from 'src/lib/data';

const PATIENT_SELECT = { id: true, name: true, whatsapp: true, email: true, birthDate: true, tags: true };

export const readPatient = {
  name: 'readPatient',
  description: 'Busca dados completos de um paciente por ID.',
  parameters: z.object({
    patientId: z.string().uuid().describe('UUID do paciente'),
  }),
  execute: async (args: { patientId: string }, ctx: DataApi): Promise<string> => {
    const result = await ctx.get('patient', args.patientId, PATIENT_SELECT);
    return JSON.stringify(result ?? null);
  },
};
