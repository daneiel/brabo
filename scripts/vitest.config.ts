import { defineConfig } from 'vitest/config';

// Os scripts de CI são lógica pura — sem banco, sem rede, sem git. Não há
// globalSetup nem serialização de arquivos como na api: podem rodar em
// paralelo à vontade.
export default defineConfig({
  test: {
    include: ['**/*.spec.ts'],
  },
});
