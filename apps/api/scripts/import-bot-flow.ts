// Importa um fluxo ManyChat/Kommo (JSON) como Bot no banco apontado por DATABASE_URL.
// Uso: DATABASE_URL=... npx tsx scripts/import-bot-flow.ts "/caminho/Leads novos.json"
import { readFileSync } from 'fs';
import { basename } from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
import { parseBotFlow } from '../src/lib/bots/engine';

const filePath = process.argv[2];
if (!filePath) throw new Error('Uso: import-bot-flow.ts <caminho-do-json>');

const prisma = new PrismaClient();

async function main() {
  const raw = JSON.parse(readFileSync(filePath, 'utf8'));
  const { name, flow } = parseBotFlow(raw, basename(filePath));
  const steps = flow as unknown as Prisma.InputJsonValue;

  const existing = await prisma.bot.findFirst({ where: { name }, select: { id: true } });
  const bot = existing
    ? await prisma.bot.update({ where: { id: existing.id }, data: { steps, trigger: 'inbound-message' } })
    : await prisma.bot.create({ data: { name, trigger: 'inbound-message', active: true, steps } });

  console.log(JSON.stringify({
    id: bot.id, name: bot.name, active: bot.active, rules: flow.rules.length, replaced: Boolean(existing),
  }, null, 2));
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
