import { describe, expect, it } from 'vitest';
import { truncateToContextWindow } from './context-window';

describe('truncateToContextWindow', () => {
  const system = { role: 'system' as const, content: 'You are Tawany.' };
  const user = (index: number) => ({ role: 'user' as const, content: `msg ${index}` });

  it('returns the same array when it fits the limits', () => {
    const messages = [system, user(1), user(2), user(3)];
    const result = truncateToContextWindow(messages, { maxMessages: 20, maxTotalChars: 1000 });
    expect(result).toEqual({ messages, truncated: false, droppedCount: 0 });
  });

  it('keeps the system message plus the last N non-system messages', () => {
    const messages = [system, ...Array.from({ length: 30 }, (_, index) => user(index + 1))];
    const result = truncateToContextWindow(messages, { maxMessages: 10, maxTotalChars: 100_000 });
    expect(result.truncated).toBe(true);
    expect(result.droppedCount).toBe(20);
    expect(result.messages).toHaveLength(11);
    expect(result.messages[0]).toEqual(system);
    expect(result.messages.at(-1)?.content).toBe('msg 30');
  });

  it('drops older middle messages when the recent window still exceeds char budget', () => {
    const long = { role: 'assistant' as const, content: 'x'.repeat(7000) };
    const result = truncateToContextWindow([system, user(1), long, user(3)], {
      maxMessages: 20,
      maxTotalChars: 1000,
    });
    expect(result.truncated).toBe(true);
    expect(result.messages[0]).toEqual(system);
    expect(result.messages.at(-1)?.content).toBe('msg 3');
    expect(result.messages.some((message) => message.content?.includes('x'.repeat(100)))).toBe(false);
    expect(result.messages.reduce((acc, message) => acc + (message.content?.length ?? 0), 0)).toBeLessThanOrEqual(1000);
  });
});
