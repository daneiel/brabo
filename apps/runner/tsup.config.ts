import { defineConfig } from 'tsup';

/**
 * Empacota o CLI num único `dist/index.cjs` (ADR 0106) — hoje o `bin` aponta
 * pra um `.ts` cru, só alcançável clonando o monorepo inteiro e confiando no
 * type-stripping nativo do Node 24 usado em dev.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  platform: 'node',
  // O RUNTIME prometido por `engines.node` em package.json — eixo diferente
  // do `target: "ES2023"` do tsconfig, que só serve o `tsc --noEmit` de dev.
  target: 'node18',
  outDir: 'dist',
  clean: true,
  // Reescreve `import.meta.url` (usado pela guarda de auto-run em
  // `index.ts`) pra uma forma baseada em `__filename`, que cjs entende.
  shims: true,
  // Bin-only: não há superfície de tipos pra um consumidor importar.
  dts: false,
  sourcemap: false,
  // `node-pty` é binding NATIVO (compila via node-gyp no postinstall do
  // consumidor) — não pode ser embutido num arquivo JS. Continua
  // `require('node-pty')` em runtime, resolvido pelo node_modules de quem
  // instalou o pacote. `phoenix` (puro JS) entra embutido no bundle — não
  // precisa de diretiva nenhuma pra isso, é o default de tudo que não está
  // em `external`.
  external: ['node-pty'],
});
