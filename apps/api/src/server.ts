import app from './app.js';
import { prisma } from './lib/deps.js';
import { createPrismaDataApi } from './lib/prisma-data-api.js';
import { runBudgetFollowup, runFollowupEngine } from './logic-functions/followup-engine.js';

const PORT = Number.parseInt(process.env.PORT ?? '4000', 10);

app.listen(PORT, () => {
  console.log(`[api] QARA CRM API running on http://localhost:${PORT}`);
});

// Follow-up engine: setInterval simples no lugar de cron (ponytail: sem lib de
// cron — o engine é idempotente, rodar com folga não duplica tasks).
// FOLLOWUP_INTERVAL_MS: default 15 min; 0 desliga.
const DEFAULT_FOLLOWUP_INTERVAL_MS = 15 * 60_000;
const followupIntervalMs = Number.parseInt(
  process.env.FOLLOWUP_INTERVAL_MS ?? String(DEFAULT_FOLLOWUP_INTERVAL_MS),
  10,
);
if (Number.isFinite(followupIntervalMs) && followupIntervalMs > 0 && process.env.NODE_ENV !== 'test') {
  const data = createPrismaDataApi(prisma);
  const timer = setInterval(() => {
    runFollowupEngine(new Date(), data)
      .then((r) => console.log(JSON.stringify({ event: 'followup_run', ...r })))
      .catch((err) => console.error('[followup] run failed:', (err as Error).message));
    runBudgetFollowup(new Date(), data)
      .then((r) => console.log(JSON.stringify({ event: 'budget_followup_run', ...r })))
      .catch((err) => console.error('[budget-followup] run failed:', (err as Error).message));
  }, followupIntervalMs);
  timer.unref(); // não segura o processo vivo (ex.: shutdown, testes)
  console.log(`[followup] engine scheduled every ${followupIntervalMs}ms`);
}
