/**
 * PLACEHOLDER rastreado no git — `NATIVE_PTY_FILES` vazio.
 *
 * `scripts/build-bin.mjs` SOBRESCREVE este arquivo com imports estáticos
 * `with { type: 'file' }` reais (um por arquivo de `node-pty` que a
 * plataforma atual precisa — `lib/*.js` + o(s) `.node` nativo(s)) logo
 * antes de rodar `bun build --compile`, e RESTAURA este placeholder no
 * `finally` — nunca fica commitado com conteúdo gerado.
 *
 * Existe rastreado (não gitignored) para `pnpm --filter runner typecheck`/
 * `test`/`build` (o caminho `tsup`/`npm`, ADR 0106) sempre encontrarem um
 * módulo real aqui — o import em `native-pty-loader.ts` é ESTÁTICO por
 * especificador literal (`await import('./native-pty-embed.generated.ts')`),
 * e um arquivo ausente quebraria esses três comandos fora de um
 * `build:bin` em andamento.
 *
 * A forma (`Array<{ relPath: string; embeddedPath: string }>`) é o
 * contrato que `native-pty-loader.ts` consome — não mude sem revisar os
 * dois lados.
 */
export const NATIVE_PTY_FILES: ReadonlyArray<{ relPath: string; embeddedPath: string }> = [];
