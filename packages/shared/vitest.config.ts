import { defineConfig } from 'vitest/config';

// Config próprio do pacote: evita que o vitest suba a árvore de diretórios e
// resolva o vitest.config.ts da raiz do monorepo (que depende de
// vite-tsconfig-paths, não instalado neste workspace/pacote).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
