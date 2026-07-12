import type { DataApi } from 'src/lib/data';

// Prices in integer cents. SELECT values are UPPER_SNAKE_CASE (Twenty requirement).
const UNITS = [{ name: 'Copacabana', active: true }];

export const PROFESSIONALS = [
  { name: { firstName: 'Dr.', lastName: 'Diego' }, specialty: 'CIRURGIA', modality: 'PRESENCIAL', rjPriceCents: 45000, active: true },
  { name: { firstName: 'Dr.', lastName: 'Miguel' }, specialty: 'UNHAS', modality: 'AMBOS', rjPriceCents: 65000, spPriceCents: 80000, telePriceCents: 65000, active: true },
  { name: { firstName: 'Dra.', lastName: 'Diana' }, specialty: 'TRICOLOGIA', modality: 'PRESENCIAL', defaultPriceCents: 55000, active: true },
  { name: { firstName: 'Dra.', lastName: 'Manuela' }, specialty: 'AUTOIMUNE', modality: 'PRESENCIAL', defaultPriceCents: 55000, active: true },
  { name: { firstName: 'Dr.', lastName: 'Fabricio' }, specialty: 'DERMATOPEDIATRIA', modality: 'PRESENCIAL', defaultPriceCents: 55000, active: true },
];

export const SERVICES = [
  { name: 'Consulta Cirurgia Dermatológica', durationMin: 30, defaultPriceCents: 45000, modality: 'PRESENCIAL', active: true },
  { name: 'Consulta Unhas', durationMin: 30, defaultPriceCents: 65000, modality: 'AMBOS', active: true },
  { name: 'Consulta Tricologia', durationMin: 45, defaultPriceCents: 55000, modality: 'PRESENCIAL', active: true },
  { name: 'Consulta Autoimune', durationMin: 45, defaultPriceCents: 55000, modality: 'PRESENCIAL', active: true },
  { name: 'Consulta Dermatopediatria', durationMin: 30, defaultPriceCents: 55000, modality: 'PRESENCIAL', active: true },
  // Biópsia + laboratório (QARA_KNOWLEDGE_PROMPT §10.1). Sincroniza o dado real
  // da clínica no seed pra que uma re-semeadura não perca (ver commit fd6bfad) e
  // pra o teste anti-drift de preços cobrir esses valores.
  { name: 'Biópsia de Pele', durationMin: 30, defaultPriceCents: 55000, modality: 'PRESENCIAL', active: true },
  { name: 'Laboratório / Anatomopatológico', durationMin: 0, defaultPriceCents: 16000, modality: 'PRESENCIAL', active: true },
];

const dedupFilter = (item: Record<string, unknown>): Record<string, unknown> => {
  const name = item.name;
  if (typeof name === 'object' && name !== null) {
    const full = name as { firstName: string; lastName: string };
    return { name: { firstName: { eq: full.firstName }, lastName: { eq: full.lastName } } };
  }
  return { name: { eq: name } };
};

export const seed = async (ctx: DataApi): Promise<{ created: number }> => {
  let created = 0;

  const upsert = async (object: string, list: Record<string, unknown>[]): Promise<void> => {
    for (const item of list) {
      const existing = await ctx.list(object, { filter: dedupFilter(item), limit: 1 });
      if (existing.length > 0) continue;
      await ctx.create(object, item);
      created++;
    }
  };

  await upsert('clinicUnit', UNITS);
  await upsert('professional', PROFESSIONALS);
  await upsert('service', SERVICES);

  return { created };
};
