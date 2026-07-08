import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebounce } from './debounce';

describe('createDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('returns process on first message', () => {
    const debounce = createDebounce(20_000);

    expect(debounce.check('conv-1', 'msg-1', 'oi')).toEqual({ status: 'process' });
  });

  it('returns skip when a second message arrives inside the window', () => {
    const debounce = createDebounce(20_000);
    debounce.check('conv-1', 'msg-1', 'oi');

    expect(debounce.check('conv-1', 'msg-2', 'mais uma')).toEqual({ status: 'skip' });
  });

  it('flushes after the timer fires', () => {
    const debounce = createDebounce(20_000);
    debounce.check('conv-1', 'msg-1', 'oi');

    vi.advanceTimersByTime(20_000);

    expect(debounce.check('conv-1', 'msg-3', 'voltei')).toEqual({ status: 'process' });
  });

  it('is independent per conversation', () => {
    const debounce = createDebounce(20_000);

    expect(debounce.check('conv-1', 'msg-1', 'oi')).toEqual({ status: 'process' });
    expect(debounce.check('conv-2', 'msg-2', 'oi')).toEqual({ status: 'process' });
  });

  it('returns optout for unsubscribe commands before setting the timer', () => {
    const debounce = createDebounce(20_000);

    expect(debounce.check('conv-1', 'msg-1', 'parar')).toEqual({ status: 'optout' });
    expect(debounce.check('conv-1', 'msg-2', 'PARE')).toEqual({ status: 'optout' });
    expect(debounce.check('conv-1', 'msg-3', 'nao quero')).toEqual({ status: 'optout' });
  });

  it('does not flag normal messages as opt-out', () => {
    const debounce = createDebounce(20_000);

    expect(debounce.isOptOut('Quanto custa a consulta?')).toBe(false);
    expect(debounce.isOptOut('Bom dia')).toBe(false);
    expect(debounce.isOptOut('Quero agendar um horario')).toBe(false);
    expect(debounce.isOptOut('Pará de Minas')).toBe(false);
  });

  it('trailing mode flushes only the last message after the quiet window', async () => {
    const onFlush = vi.fn();
    const debounce = createDebounce(20_000);

    expect(debounce.check('conv-1', 'msg-1', 'oi', onFlush)).toEqual({ status: 'defer' });
    expect(debounce.check('conv-1', 'msg-2', 'quero agendar', onFlush)).toEqual({ status: 'defer' });

    await vi.advanceTimersByTimeAsync(19_999);
    expect(onFlush).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith({ conversationId: 'conv-1', messageId: 'msg-2', text: 'quero agendar' });
  });
});
