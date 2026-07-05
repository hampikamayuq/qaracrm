import { describe, expect, it, vi } from 'vitest';
import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  it('returns result when call succeeds', async () => {
    const breaker = new CircuitBreaker('test', { threshold: 3, cooldownMs: 1000 });
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(breaker.execute(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
    expect(breaker.state).toBe('closed');
  });

  it('opens after N consecutive failures', async () => {
    const breaker = new CircuitBreaker('test', { threshold: 3, cooldownMs: 1000 });
    const fn = vi.fn().mockRejectedValue(new Error('meta down'));

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fn)).rejects.toThrow('meta down');
    }
    expect(breaker.state).toBe('open');

    const fn2 = vi.fn().mockResolvedValue('ok');
    await expect(breaker.execute(fn2)).rejects.toThrow(/circuit_open:test/);
    expect(fn2).not.toHaveBeenCalled();
  });

  it('resets after cooldown through a half-open success', async () => {
    const breaker = new CircuitBreaker('test', { threshold: 1, cooldownMs: 10 });
    await expect(breaker.execute(vi.fn().mockRejectedValue(new Error('x')))).rejects.toThrow('x');
    expect(breaker.state).toBe('open');

    await new Promise((resolve) => setTimeout(resolve, 15));
    const ok = vi.fn().mockResolvedValue('ok');
    await expect(breaker.execute(ok)).resolves.toBe('ok');
    expect(ok).toHaveBeenCalledOnce();
    expect(breaker.state).toBe('closed');
  });

  it('can be reset manually between tests or process lifecycle events', async () => {
    const breaker = new CircuitBreaker('test', { threshold: 1, cooldownMs: 1000 });
    await expect(breaker.execute(vi.fn().mockRejectedValue(new Error('x')))).rejects.toThrow('x');
    breaker.reset();
    expect(breaker.state).toBe('closed');
  });
});
