import { defineConfig } from 'vitest/config';

/**
 * Mesmo desenho de `apps/runner/vitest.config.ts`: lógica local, sem banco,
 * sem rede e — a parte que importa aqui — SEM DAEMON. Nenhum teste deste
 * pacote sobe container: a `DockerPort` é substituída por um duplo em todos
 * eles, e o cliente da api também. Um teste que precisasse de Docker deixaria
 * de rodar no CI exatamente onde ele mais precisa rodar.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
  },
});
