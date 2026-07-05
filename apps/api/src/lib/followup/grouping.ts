// Pure grouping for the follow-ups dashboard. The board re-derives each
// task's bucket from dueAt + now, never trusting the stored `category`,
// so the engine and the UI stay consistent.

import { categorizeTask, type TaskCategory } from './categorize';

export type TaskBucket = {
  category: TaskCategory;
  label: string;
  accent: string;
  // ponytail: tones read as the same hues Twenty renders for the category
  // SELECT options, but a touch lighter so cards stay legible on a light
  // dashboard. Don't map 1:1 to the Twenty swatches — those are too dark.
  softBg: string;
};

export const BUCKETS: readonly TaskBucket[] = [
  { category: 'OVERDUE',  label: 'Em atraso', accent: '#c53030', softBg: '#fdecec' },
  { category: 'TODAY',    label: 'Hoje',      accent: '#d97706', softBg: '#fdf3e3' },
  { category: 'UPCOMING', label: 'Próximos',  accent: '#2563eb', softBg: '#eaf0fd' },
  { category: 'NO_DATE',  label: 'Sem data',  accent: '#6b7280', softBg: '#f1f2f4' },
] as const;

export type GroupableTask = {
  id: string;
  status?: string | null;
  dueAt?: string | null;
};

export type GroupedTasks = Record<TaskCategory, GroupableTask[]>;

const emptyGroups = (): GroupedTasks => ({
  OVERDUE: [], TODAY: [], UPCOMING: [], NO_DATE: [],
});

export const groupTasksByCategory = (
  tasks: readonly GroupableTask[],
  now: Date,
): GroupedTasks => {
  const groups = emptyGroups();
  for (const t of tasks) {
    const cat = categorizeTask(t, now);
    if (!cat) continue; // non-pending tasks are not shown on the dashboard
    groups[cat].push(t);
  }
  return groups;
};
