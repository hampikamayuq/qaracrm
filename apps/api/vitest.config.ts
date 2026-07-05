import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['src/**/*.test.ts'],
    exclude: [
      'src/**/*.integration.test.ts',
      'src/__tests__/**',
      'src/objects/**/*.test.ts',
      'src/logic-functions/meta-webhook-verify.test.ts',
      'src/lib/data.test.ts',
      '**/node_modules/**',
      '**/dist/**',
    ],
  },
});
