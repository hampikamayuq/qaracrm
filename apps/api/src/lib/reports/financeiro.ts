import { prisma } from '../deps';
// Regra de saldo e rótulos de status vivem no budget-routes (fonte única) —
// reusadas aqui sem duplicar.
import { BUDGET_STATUSES, STATUS_LABELS_PT, settledAmount } from '../../routes/budget-routes';

// Agregação financeira (orçamentos + pagamentos + NPS) extraída de
// report-routes para um módulo compartilhado: report-routes (relatório
// completo) e dashboard-routes (bloco enxuto do painel) importam daqui,
// sem recalcular o Decimal do Prisma em dois lugares.

// Janela mínima que a agregação usa — [start, end) atual e [prevStart, start)
// como comparativo. Estruturalmente compatível com a ReportWindow das rotas
// (que carrega `days` a mais, ignorado aqui).
export type FinanceiroWindow = { start: Date; end: Date; prevStart: Date };

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round1 = (n: number): number => Math.round(n * 10) / 10;

// Razão em % com 1 casa — null quando o denominador é zero (sem divisão por 0).
const pct1 = (num: number, den: number): number | null =>
  den > 0 ? Math.round((num / den) * 1000) / 10 : null;

// Estados finais de um orçamento — base da taxa de aceitação (SENT/DRAFT
// seguem em aberto e não entram no denominador).
const RESOLVED_BUDGET_STATUSES = new Set<string>(['ACCEPTED', 'REJECTED', 'EXPIRED']);

type BudgetWindowRow = {
  amount: unknown;
  status: (typeof BUDGET_STATUSES)[number];
  createdAt: Date;
  sentAt: Date | null;
  respondedAt: Date | null;
};

// Agregado de orçamentos: contagem/valor por status, taxa de aceitação sobre
// os já resolvidos, tempo médio sentAt→respondedAt e valor médio.
const orcamentosStats = (rows: BudgetWindowRow[]) => {
  const porStatusMap = new Map(BUDGET_STATUSES.map((s) => [s, { count: 0, valor: 0 }]));
  let valorTotal = 0;
  for (const b of rows) {
    const entry = porStatusMap.get(b.status) as { count: number; valor: number };
    const amount = Number(b.amount);
    entry.count += 1;
    entry.valor += amount;
    valorTotal += amount;
  }

  let resolvedCount = 0;
  let acceptedCount = 0;
  const responseDiffsHoras: number[] = [];
  for (const b of rows) {
    if (RESOLVED_BUDGET_STATUSES.has(b.status)) {
      resolvedCount += 1;
      if (b.status === 'ACCEPTED') acceptedCount += 1;
    }
    if (b.sentAt && b.respondedAt) {
      responseDiffsHoras.push((b.respondedAt.getTime() - b.sentAt.getTime()) / 3_600_000);
    }
  }

  return {
    total: rows.length,
    porStatus: BUDGET_STATUSES.map((status) => {
      const entry = porStatusMap.get(status) as { count: number; valor: number };
      return { status, label: STATUS_LABELS_PT[status], count: entry.count, valor: round2(entry.valor) };
    }),
    taxaAceitacaoPct: pct1(acceptedCount, resolvedCount),
    tempoMedioRespostaHoras: responseDiffsHoras.length > 0
      ? round1(responseDiffsHoras.reduce((a, b) => a + b, 0) / responseDiffsHoras.length)
      : null,
    valorMedio: rows.length > 0 ? round2(valorTotal / rows.length) : null,
  };
};

type PaymentWindowRow = { amount: unknown; method: string; paidAt: Date | null };

// Recebido no período (PAID/PARTIALLY_PAID por paidAt) e quebra por método —
// só os métodos observados aparecem, mesmo padrão de perdas/bloqueios.
const pagamentosStats = (rows: PaymentWindowRow[]) => {
  const porMetodoMap = new Map<string, number>();
  let total = 0;
  for (const p of rows) {
    const amount = Number(p.amount);
    total += amount;
    porMetodoMap.set(p.method, (porMetodoMap.get(p.method) ?? 0) + amount);
  }
  return {
    totalRecebido: round2(total),
    porMetodo: Array.from(porMetodoMap, ([method, valor]) => ({ method, valor: round2(valor) }))
      .sort((a, b) => b.valor - a.valor),
  };
};

type NpsWindowRow = { npsSentAt: Date | null; npsScore: number | null; npsRespondedAt: Date | null };

// Enviados/respondidos (Appointment.npsSentAt/npsRespondedAt), nota média,
// distribuição detratores(0-6)/neutros(7-8)/promotores(9-10) e o NPS clássico
// (%promotores − %detratores sobre quem respondeu).
const npsStats = (rows: NpsWindowRow[]) => {
  let respondidos = 0;
  let scoreSum = 0;
  let detratores = 0;
  let neutros = 0;
  let promotores = 0;
  for (const r of rows) {
    if (r.npsRespondedAt === null || r.npsScore === null) continue;
    respondidos += 1;
    scoreSum += r.npsScore;
    if (r.npsScore <= 6) detratores += 1;
    else if (r.npsScore <= 8) neutros += 1;
    else promotores += 1;
  }
  return {
    enviados: rows.length,
    respondidos,
    taxaRespostaPct: pct1(respondidos, rows.length),
    notaMedia: respondidos > 0 ? round1(scoreSum / respondidos) : null,
    distribuicao: { detratores, neutros, promotores },
    npsClassico: respondidos > 0 ? round1(((promotores - detratores) / respondidos) * 100) : null,
  };
};

export const buildFinanceiro = async (w: FinanceiroWindow) => {
  const [budgetRows, paymentRows, acceptedBudgets, apptRows] = await Promise.all([
    prisma.budget.findMany({
      where: { createdAt: { gte: w.prevStart, lt: w.end } },
      select: { amount: true, status: true, createdAt: true, sentAt: true, respondedAt: true },
    }),
    prisma.payment.findMany({
      where: { status: { in: ['PAID', 'PARTIALLY_PAID'] }, paidAt: { gte: w.prevStart, lt: w.end } },
      select: { amount: true, method: true, paidAt: true },
    }),
    // "A receber" é um retrato do momento (orçamentos aceitos com saldo em
    // aberto), não um recorte de período — mesma regra de saldo do
    // budget-routes (amount − pagamentos PAID/PARTIALLY_PAID).
    prisma.budget.findMany({
      where: { status: 'ACCEPTED' },
      select: { amount: true, payments: { select: { amount: true, status: true } } },
    }),
    prisma.appointment.findMany({
      where: { npsSentAt: { gte: w.prevStart, lt: w.end } },
      select: { npsSentAt: true, npsScore: true, npsRespondedAt: true },
    }),
  ]);

  const currentBudgets = budgetRows.filter((b) => b.createdAt >= w.start);
  const previousBudgets = budgetRows.filter((b) => b.createdAt < w.start);
  const currentPayments = paymentRows.filter((p) => p.paidAt !== null && p.paidAt >= w.start);
  const previousPayments = paymentRows.filter((p) => p.paidAt !== null && p.paidAt < w.start);
  const currentAppts = apptRows.filter((a) => a.npsSentAt !== null && a.npsSentAt >= w.start);
  const previousAppts = apptRows.filter((a) => a.npsSentAt !== null && a.npsSentAt < w.start);

  const pendente = round2(
    acceptedBudgets.reduce((sum, b) => sum + Math.max(Number(b.amount) - settledAmount(b.payments), 0), 0),
  );

  const orcamentosCur = orcamentosStats(currentBudgets);
  const orcamentosPrev = orcamentosStats(previousBudgets);
  const pagamentosCur = pagamentosStats(currentPayments);
  const pagamentosPrev = pagamentosStats(previousPayments);
  const npsCur = npsStats(currentAppts);
  const npsPrev = npsStats(previousAppts);

  return {
    orcamentos: {
      ...orcamentosCur,
      comparativo: {
        total: orcamentosPrev.total,
        taxaAceitacaoPct: orcamentosPrev.taxaAceitacaoPct,
        valorMedio: orcamentosPrev.valorMedio,
      },
    },
    pagamentos: {
      ...pagamentosCur,
      pendente,
      comparativo: { totalRecebido: pagamentosPrev.totalRecebido },
    },
    nps: {
      ...npsCur,
      comparativo: {
        enviados: npsPrev.enviados,
        respondidos: npsPrev.respondidos,
        taxaRespostaPct: npsPrev.taxaRespostaPct,
        notaMedia: npsPrev.notaMedia,
        npsClassico: npsPrev.npsClassico,
      },
    },
  };
};
