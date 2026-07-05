import { describe, expect, it } from 'vitest';

describe('API integration harness', () => {
  it('loads the Express app with health and mounted API routers', async () => {
    const { default: app } = await import('./app');
    const stack = app.router.stack as Array<{ name?: string; route?: { path?: string } }>;

    expect(stack.some((layer) => layer.route?.path === '/api/health')).toBe(true);
    expect(stack.filter((layer) => layer.name === 'router').length).toBeGreaterThanOrEqual(7);
  });
});
