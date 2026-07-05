import { prisma } from '../deps';
import { hashPassword } from '../auth';

async function main() {
  console.log('Seeding database...');

  // Default admin user
  const adminPassword = await hashPassword(process.env.ADMIN_PASSWORD ?? 'admin123');
  await prisma.user.upsert({
    where: { email: 'admin@qara.local' },
    update: {},
    create: {
      name: 'Admin QARA',
      email: 'admin@qara.local',
      password: adminPassword,
      role: 'admin',
    },
  });

  // Default professionals
  const professionals = [
    { name: 'Dra. Ana Silva', specialty: 'Dermatologia' },
    { name: 'Dr. Carlos Oliveira', specialty: 'Cirurgia Plástica' },
    { name: 'Dra. Maria Santos', specialty: 'Estética Facial' },
  ];
  for (const p of professionals) {
    await prisma.professional.upsert({
      where: { id: `seed-${p.name.toLowerCase().replace(/\s+/g, '-')}` },
      update: {},
      create: { id: `seed-${p.name.toLowerCase().replace(/\s+/g, '-')}`, ...p },
    });
  }

  // Default services
  const services = [
    { name: 'Consulta Inicial', description: 'Avaliação dermatológica completa', priceCents: 35000 },
    { name: 'Limpeza de Pele', description: 'Limpeza de pele profunda', priceCents: 25000 },
    { name: 'Botox', description: 'Aplicação de toxina botulínica', priceCents: 120000 },
    { name: 'Preenchimento Facial', description: 'Preenchimento com ácido hialurônico', priceCents: 180000 },
    { name: 'Peeling Químico', description: 'Peeling químico superficial a médio', priceCents: 45000 },
  ];
  for (const s of services) {
    await prisma.service.create({ data: s });
  }

  // Default pipeline
  const pipeline = await prisma.pipeline.upsert({
    where: { id: 'seed-default-pipeline' },
    update: {},
    create: {
      id: 'seed-default-pipeline',
      name: 'Pipeline Padrão',
      order: 0,
    },
  });

  const stages = [
    { name: 'Novo Lead', order: 0 },
    { name: 'Primeiro Contato', order: 1 },
    { name: 'Agendamento', order: 2 },
    { name: 'Consulta Realizada', order: 3 },
    { name: 'Pós-Consulta', order: 4 },
    { name: 'Fechado', order: 5 },
    { name: 'Perdido', order: 6 },
  ];
  for (const stage of stages) {
    await prisma.pipelineStage.upsert({
      where: { id: `seed-${stage.name.toLowerCase().replace(/\s+/g, '-')}` },
      update: {},
      create: { id: `seed-${stage.name.toLowerCase().replace(/\s+/g, '-')}`, ...stage, pipelineId: pipeline.id },
    });
  }

  console.log('Seed complete.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());