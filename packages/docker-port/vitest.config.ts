import { defineConfig } from 'vitest/config';

// Mesmo desenho de `apps/runner/vitest.config.ts`: lógica local, sem banco e
// sem daemon — o `RodarDocker` é substituído por uma função de teste em TODOS
// os casos, e nenhum container sobe em `pnpm test`.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
  },
});
