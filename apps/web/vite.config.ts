/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        /*
         * Vendors grandes em chunks próprios (AT-300). É o `manualChunks` do
         * Rollup com o nome que o Vite 8 usa: sob o Rolldown, `manualChunks`
         * está DEPRECADO e vira exatamente isto por baixo (ver a doc de
         * `output.manualChunks` no rolldown).
         *
         * O ganho não é o primeiro acesso — o bundle inicial carrega os três
         * de qualquer jeito — e sim o SEGUNDO: estes pacotes mudam quando uma
         * dependência sobe, não a cada PR, então o hash deles sobrevive a um
         * deploy de código da app e o navegador não os baixa de novo.
         *
         * A lista é de PERMITIDOS e fecha só o que TODA tela usa. Um grupo
         * genérico `node_modules` puxaria `mermaid`, `@xterm/*`, `katex` e
         * `cytoscape` — que hoje só chegam por `import()` dinâmico — para
         * dentro de um chunk importado pela entrada, desfazendo o isolamento
         * dos ADRs 0068/0103.
         */
        codeSplitting: {
          groups: [
            {
              name: 'vendor-react',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
            {
              name: 'vendor-tanstack',
              test: /[\\/]node_modules[\\/]@tanstack[\\/]/,
            },
            {
              name: 'vendor-i18n',
              test: /[\\/]node_modules[\\/](i18next|react-i18next)[\\/]/,
            },
          ],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    /*
     * `strictPort` porque a porta faz parte do CONTRATO de CORS (ADR 0037).
     *
     * Sem ele o Vite, ao encontrar 5173 ocupada, sobe em 5174 e só avisa numa
     * linha do log de boot. A api aceita exatamente `http://localhost:5173`
     * (`WEB_ORIGIN`), então a app abre normalmente e **toda** chamada é barrada
     * pelo navegador — inclusive o `/auth/refresh`, o que faz a tela parecer
     * deslogada. O erro no console fala de CORS e não de porta, então o tempo vai
     * todo para o lugar errado: mexer no CORS da api conserta o sintoma para 5174
     * e quebra 5173.
     *
     * Com `strictPort`, o Vite recusa subir e diz que a porta está em uso — o que
     * é a informação verdadeira. Reproduzido: 5173 ocupada, app em 5174, três
     * chamadas bloqueadas (`/health` da api, `/health` do engine, `/auth/refresh`).
     */
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      // Piso (ratchet), não meta: o valor medido em 2026-08-27 foi statements
      // 84,39% / branches 79,27% / functions 74,4% / lines 85,9%, com a suite
      // inteira passando (1504 testes). Os números abaixo são esse valor
      // arredondado ~2 pontos PARA BAIXO — margem de segurança contra
      // variação normal de ambiente, nunca uma meta aspiracional. Ver
      // CHANGELOG e a PR que introduziu este piso para os números exatos.
      thresholds: {
        statements: 82,
        branches: 77,
        functions: 72,
        lines: 83,
      },
    },
  },
})
