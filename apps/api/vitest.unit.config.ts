import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    tsconfigPaths({
      projects: ['tsconfig.spec.json'],
      ignoreConfigErrors: true,
    }),
  ],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: [
      'src/**/*.integration.test.ts',
      'src/__tests__/**',
      'src/objects/**/*.test.ts',
      'src/logic-functions/meta-webhook-verify.test.ts',
      'src/lib/data.test.ts',
      '**/node_modules/**',
      '**/dist/**',
    ],
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
});
