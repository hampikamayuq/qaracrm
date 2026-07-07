// Seed idempotente do knowledge vivo da Tawany (KnowledgeSection).
// Divide o QARA_KNOWLEDGE_PROMPT hardcoded em seções editáveis e as insere
// SOMENTE se a tabela estiver vazia — rodar de novo é no-op.
//
// Uso (deploy, após prisma migrate deploy):
//   cd apps/api && npx tsx src/scripts/seed-knowledge.ts
import { PrismaClient } from '@prisma/client';
import { buildSeedSections } from '../lib/tawany/knowledge';

const main = async (): Promise<void> => {
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.knowledgeSection.count();
    if (existing > 0) {
      console.log(`[seed-knowledge] tabela já tem ${existing} seções — nada a fazer.`);
      return;
    }
    const sections = buildSeedSections();
    await prisma.knowledgeSection.createMany({ data: sections });
    console.log(`[seed-knowledge] ${sections.length} seções criadas: ${sections.map((s) => s.slug).join(', ')}`);
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((error) => {
  console.error('[seed-knowledge] failed:', error);
  process.exitCode = 1;
});
