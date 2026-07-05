import { describe, expect, it } from 'vitest';

describe('api app assembly', () => {
  it('exports an Express app with health and mounted API routers', async () => {
    const { default: app } = await import('./app');
    const stack = app.router.stack as Array<{ name?: string; route?: { path?: string } }>;

    expect(stack.some((layer) => layer.route?.path === '/api/health')).toBe(true);
    expect(stack.filter((layer) => layer.name === 'router')).toHaveLength(5);
  });
});
