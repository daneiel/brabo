import { defineConfig } from 'vitest/config';

// Mesmo desenho de scripts/vitest.config.ts: lógica local (sem banco, sem
// rede real — o canal Phoenix é testado contra um mock da lib, nunca contra
// um engine de verdade). Podem rodar em paralelo à vontade.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
  },
});
