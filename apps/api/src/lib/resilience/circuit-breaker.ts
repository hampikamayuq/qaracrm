export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

export type CircuitBreakerOptions = {
  threshold: number;
  cooldownMs: number;
};

export class CircuitBreaker {
  private currentState: CircuitBreakerState = 'closed';
  private failureCount = 0;
  private lastFailureAt = 0;

  constructor(
    public readonly name: string,
    private readonly options: CircuitBreakerOptions,
  ) {}

  get state(): CircuitBreakerState {
    if (
      this.currentState === 'open' &&
      Date.now() - this.lastFailureAt >= this.options.cooldownMs
    ) {
      this.currentState = 'half-open';
    }
    return this.currentState;
  }

  reset(): void {
    this.currentState = 'closed';
    this.failureCount = 0;
    this.lastFailureAt = 0;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      throw new Error(`circuit_open:${this.name}`);
    }

    try {
      const result = await fn();
      this.reset();
      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureAt = Date.now();
      if (this.currentState === 'half-open' || this.failureCount >= this.options.threshold) {
        this.currentState = 'open';
      }
      throw error;
    }
  }
}
