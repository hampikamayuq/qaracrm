import { describe, it, expect } from 'vitest';
import { categorizeTask, daysSince } from './categorize';

const noon = (iso: string): Date => new Date(`${iso}T12:00:00Z`);

describe('categorizeTask', () => {
  it('returns null for non-pending tasks', () => {
    expect(categorizeTask({ status: 'DONE', dueAt: '2026-07-04T00:00:00Z' }, noon('2026-07-04'))).toBeNull();
    expect(categorizeTask({ status: 'IN_PROGRESS', dueAt: '2026-07-04T00:00:00Z' }, noon('2026-07-04'))).toBeNull();
  });

  it('returns NO_DATE for pending tasks without a dueAt', () => {
    expect(categorizeTask({ status: 'TODO' }, noon('2026-07-04'))).toBe('NO_DATE');
  });

  it('returns NO_DATE for unparseable dueAt (does not throw)', () => {
    expect(categorizeTask({ status: 'TODO', dueAt: 'not-a-date' }, noon('2026-07-04'))).toBe('NO_DATE');
  });

  it('returns OVERDUE for pending tasks due before today', () => {
    expect(categorizeTask({ status: 'TODO', dueAt: '2026-07-03T12:00:00Z' }, noon('2026-07-04'))).toBe('OVERDUE');
  });

  it('returns TODAY for pending tasks due within today', () => {
    expect(categorizeTask({ status: 'TODO', dueAt: '2026-07-04T08:00:00Z' }, noon('2026-07-04'))).toBe('TODAY');
  });

  it('returns UPCOMING for pending tasks due tomorrow through 7 days from end of today', () => {
    expect(categorizeTask({ status: 'TODO', dueAt: '2026-07-05T08:00:00Z' }, noon('2026-07-04'))).toBe('UPCOMING');
    expect(categorizeTask({ status: 'TODO', dueAt: '2026-07-11T20:00:00Z' }, noon('2026-07-04'))).toBe('UPCOMING');
  });

  it('returns NO_DATE for pending tasks due beyond 7 days (out of the upcoming window)', () => {
    expect(categorizeTask({ status: 'TODO', dueAt: '2026-07-12T08:00:00Z' }, noon('2026-07-04'))).toBe('NO_DATE');
  });

  it('accepts "pending" as well as "TODO"', () => {
    expect(categorizeTask({ status: 'pending', dueAt: '2026-07-04T08:00:00Z' }, noon('2026-07-04'))).toBe('TODAY');
  });

  it('accepts "OPEN" (default das tasks criadas via Prisma)', () => {
    expect(categorizeTask({ status: 'OPEN', dueAt: '2026-07-03T08:00:00Z' }, noon('2026-07-04'))).toBe('OVERDUE');
  });
});

describe('daysSince', () => {
  it('returns 0 for the same day', () => {
    expect(daysSince('2026-07-04T08:00:00Z', noon('2026-07-04'))).toBe(0);
  });
  it('returns N for N full days elapsed', () => {
    expect(daysSince('2026-07-01T12:00:00Z', noon('2026-07-04'))).toBe(3);
  });
  it('returns null for null/undefined/invalid', () => {
    expect(daysSince(null, noon('2026-07-04'))).toBeNull();
    expect(daysSince(undefined, noon('2026-07-04'))).toBeNull();
    expect(daysSince('nope', noon('2026-07-04'))).toBeNull();
  });
});
