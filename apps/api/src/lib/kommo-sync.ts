import type { DataApi } from './data';
import { isKommoConfigured, kommoBreaker, listKommoLeadsUpdatedSince } from './kommo-client';
import { applyKommoStage, findLeadByKommoId } from '../logic-functions/kommo-webhook';

// Reconciliação Kommo → QARA para webhooks perdidos (deploy no meio, Kommo
// desativou o webhook após falhas etc.): pagina leads alterados desde o último
// sync e re-aplica o mapeamento de estágio nos leads JÁ VINCULADOS
// (kommoLeadId). Não cria lead — criação é papel do webhook, que traz o
// contexto da mensagem. Best-effort, gated por ENABLE_KOMMO_SYNC.

const KOMMO_RECONCILE_INTERVAL_MS = 5 * 60_000;
const FIRST_RUN_LOOKBACK_S = 3600;
const PAGE_LIMIT = 50;
const MAX_PAGES = 4;

let nextReconcileAt = 0;
let lastSyncUnix = 0;

export const resetKommoReconcileClock = (): void => {
  nextReconcileAt = 0;
  lastSyncUnix = 0;
};

const kommoSyncEnabled = (): boolean => process.env.ENABLE_KOMMO_SYNC === 'true';

export const runKommoReconcileJob = async (
  data: DataApi,
  now = new Date(),
): Promise<{ checked: number; updated: number }> => {
  if (!kommoSyncEnabled() || !isKommoConfigured()) return { checked: 0, updated: 0 };
  if (now.getTime() < nextReconcileAt) return { checked: 0, updated: 0 };
  nextReconcileAt = now.getTime() + KOMMO_RECONCILE_INTERVAL_MS;

  const nowUnix = Math.floor(now.getTime() / 1000);
  // Janela com 60s de sobreposição — replay é idempotente (applyKommoStage só
  // move quando o estágio muda).
  const since = (lastSyncUnix || nowUnix - FIRST_RUN_LOOKBACK_S) - 60;

  let checked = 0;
  let updated = 0;
  let maxUpdatedAt = lastSyncUnix;
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const leads = await kommoBreaker.execute(() =>
        listKommoLeadsUpdatedSince(since, page, PAGE_LIMIT),
      );
      for (const remote of leads) {
        checked++;
        if (remote.updatedAt > maxUpdatedAt) maxUpdatedAt = remote.updatedAt;
        const lead = await findLeadByKommoId(remote.id, data);
        if (!lead) continue;
        const moved = await applyKommoStage(data, lead, remote.statusId, remote.pipelineId);
        if (moved) updated++;
      }
      if (leads.length < PAGE_LIMIT) break;
    }
    lastSyncUnix = maxUpdatedAt || nowUnix;
  } catch (err) {
    // API fora/breaker aberto: tenta de novo no próximo intervalo, sem
    // avançar o cursor.
    console.error('[scheduler] kommo reconcile falhou (non-fatal):', (err as Error).message);
  }

  console.log(JSON.stringify({ event: 'scheduler_kommo_reconcile', checked, updated }));
  return { checked, updated };
};
