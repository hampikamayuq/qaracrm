import { describe, it, expect } from 'vitest';
import { groupTasksByCategory, BUCKETS } from './grouping';

const noon = (iso: string): Date => new Date(`${iso}T12:00:00Z`);

describe('groupTasksByCategory', () => {
  const now = noon('2026-07-04');

  it('returns the four canonical buckets in fixed order', () => {
    expect(BUCKETS.map((b) => b.category)).toEqual([
      'OVERDUE', 'TODAY', 'UPCOMING', 'NO_DATE',
    ]);
  });

  it('excludes non-pending tasks', () => {
    const groups = groupTasksByCategory([
      { id: '1', status: 'DONE', dueAt: '2026-07-04T00:00:00Z' },
      { id: '2', status: 'IN_PROGRESS', dueAt: '2026-07-04T00:00:00Z' },
    ], now);
    expect(groups.OVERDUE).toHaveLength(0);
    expect(groups.TODAY).toHaveLength(0);
    expect(groups.UPCOMING).toHaveLength(0);
    expect(groups.NO_DATE).toHaveLength(0);
  });

  it('routes a due-yesterday task to OVERDUE', () => {
    const groups = groupTasksByCategory(
      [{ id: '1', status: 'TODO', dueAt: '2026-07-03T08:00:00Z' }],
      now,
    );
    expect(groups.OVERDUE.map((t) => t.id)).toEqual(['1']);
  });

  it('routes a due-tomorrow task to UPCOMING', () => {
    const groups = groupTasksByCategory(
      [{ id: '1', status: 'TODO', dueAt: '2026-07-05T08:00:00Z' }],
      now,
    );
    expect(groups.UPCOMING.map((t) => t.id)).toEqual(['1']);
  });

  it('routes a missing or unparseable dueAt to NO_DATE', () => {
    const groups = groupTasksByCategory([
      { id: '1', status: 'TODO' },
      { id: '2', status: 'TODO', dueAt: 'nope' },
    ], now);
    expect(groups.NO_DATE.map((t) => t.id)).toEqual(['1', '2']);
  });
});
