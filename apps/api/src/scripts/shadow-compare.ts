import { prisma } from '../lib/deps';

const normalize = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();

const safeParse = (body: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const shadowCompare = async (): Promise<void> => {
  const shadowRuns = await prisma.activity.findMany({
    where: { body: { contains: '"type":"shadow_run"' } },
    orderBy: { createdAt: 'asc' },
  });

  let processed = 0;
  let matched = 0;

  for (const run of shadowRuns) {
    const parsed = safeParse(run.body);
    if (!parsed || typeof parsed.messageId !== 'string') continue;
    if (typeof parsed.twentyReply === 'string' && parsed.twentyReply.length > 0) continue;

    processed++;
    const windowEnd = new Date(run.createdAt.getTime() + 5 * 60_000);
    const outMessage = await prisma.chatMessage.findFirst({
      where: {
        conversationId: run.targetId,
        direction: 'OUT',
        sentAt: { gte: run.createdAt, lte: windowEnd },
      },
      orderBy: { sentAt: 'asc' },
    });

    const twentyReply = outMessage?.body ?? '(no reply found)';
    const tawanyReply = typeof parsed.tawanyReply === 'string' ? parsed.tawanyReply : '';
    const match = normalize(tawanyReply) === normalize(twentyReply);

    await prisma.activity.update({
      where: { id: run.id },
      data: {
        body: JSON.stringify({
          ...parsed,
          twentyReply: twentyReply.slice(0, 500),
          match,
        }),
      },
    });
    if (match) matched++;
  }

  const errors = await prisma.aiRunLog.count({
    where: {
      success: false,
      layer: 'tawany',
      createdAt: { gte: new Date(Date.now() - 86_400_000) },
    },
  });

  console.log(`# Shadow Report - ${new Date().toISOString().slice(0, 10)}`);
  console.log(`- Total shadow runs: ${shadowRuns.length}`);
  console.log(`- Processed today: ${processed}`);
  console.log(`- Exact normalized matches: ${matched}/${processed} (${processed > 0 ? Math.round((matched / processed) * 100) : 0}%)`);
  console.log(`- Tawany errors (24h): ${errors}`);
  console.log('- Match rate target: >= 80% after manual review of divergences');
};

shadowCompare()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
