// Follow-up categorization logic (pure, testable). The engine + view both
// call categorizeTask(); keep this file the single source of truth for the
// "what bucket does this pending task belong to" rule.

export type TaskCategory = 'OVERDUE' | 'TODAY' | 'UPCOMING' | 'NO_DATE';

// Limite único de "lead sem ação": usado pelo followup-engine (criar task de
// follow-up) e pelo pipeline (badge "Parado há Xd"). Um lugar só.
export const FOLLOWUP_THRESHOLD_DAYS = 3;

export type CategorizableTask = {
  status?: string | null;
  dueAt?: string | null;
};

const startOfDay = (d: Date): Date => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d: Date): Date => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
const addDays = (d: Date, n: number): Date => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// ponytail: returns null for non-pending tasks. The engine treats null as
// "leave the row alone" — we never want to flip a closed task's category.
// ponytail: categorize is called per row inside a batch; an unparseable dueAt
// becomes NO_DATE rather than throwing, so one bad row can't abort the run.
export const categorizeTask = (task: CategorizableTask, now: Date): TaskCategory | null => {
  if (task.status !== 'pending' && task.status !== 'TODO') return null;
  const due = task.dueAt ? new Date(task.dueAt) : null;
  if (!due || isNaN(due.valueOf())) return 'NO_DATE';

  const sod = startOfDay(now);
  const eod = endOfDay(now);
  if (due < sod) return 'OVERDUE';
  if (due <= eod) return 'TODAY';
  if (due < addDays(eod, 7)) return 'UPCOMING'; // tomorrow morning → 7 days from end of today
  return 'NO_DATE';
};

export const daysSince = (iso: string | null | undefined, now: Date): number | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.valueOf())) return null;
  return Math.floor((now.valueOf() - d.valueOf()) / 86_400_000);
};
