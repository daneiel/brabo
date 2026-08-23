/**
 * Resolve o módulo `node-pty` de verdade, para os DOIS modelos de execução
 * do runner (ADR 0106 / ADR 0109):
 *
 * - `dist/index.cjs` via `node` (o caminho de sempre, `npm install -g
 *   @brabo/runner`): `import('node-pty')` simples, resolvido do
 *   `node_modules` de quem instalou o pacote — ZERO mudança de
 *   comportamento em relação a antes desta mudança, que fazia
 *   `import * as nodePty from 'node-pty'` estático em `pty.ts`.
 * - binário standalone do `bun build --compile` (ADR 0109): `node-pty` não
 *   está instalado do lado de quem baixou o binário — não há
 *   `node_modules` nenhum. Os arquivos de `node-pty` (o `lib/*.js` real do
 *   pacote e o(s) `.node` nativo(s) da plataforma) foram embutidos no
 *   binário em tempo de build (`scripts/build-bin.mjs`, que reescreve
 *   `native-pty-embed.generated.ts` com imports estáticos
 *   `with { type: 'file' }` — a única forma de embutir arquivo no
 *   `bun build --compile`, e ela EXIGE especificador estático). Em tempo de
 *   execução, extraímos esses arquivos para um diretório temporário REAL
 *   (`fs.mkdtempSync`), reconstruindo a MESMA estrutura relativa que o
 *   pacote original tem em disco, e importamos o `lib/index.js` de lá por
 *   CAMINHO ABSOLUTO.
 *
 * Por que caminho absoluto, e não `require('node-pty')` apontando pro
 * diretório extraído: `node-pty` resolve o `.node` nativo sozinho, dentro
 * de `lib/utils.js` (`loadNativeModule`), por um `require(dir + '/' + name
 * + '.node')` com CAMINHO COMPUTADO em runtime — não um literal. O
 * `bun build --compile` só embute (`with { type: 'file' }`) o que consegue
 * enxergar ESTATICAMENTE; um `require()` com string computada nunca é
 * embutido sozinho (testado: o binário compila sem erro, mas falha ao
 * rodar com "Cannot find module"). A saída, provada empiricamente antes
 * desta implementação: reconstruir a árvore de arquivos REAL do pacote
 * (todos reais, em disco, no `mkdtemp`) e deixar o `require()` relativo
 * interno do `node-pty` resolver sozinho — exatamente como resolveria se o
 * pacote estivesse instalado normalmente. O `.node` nativo em si TAMBÉM
 * pode ser carregado direto via `with { type: 'file' }` + `require()` (o
 * Bun extrai/mapeia sozinho o addon nativo mesmo com o caminho reportado
 * sendo virtual, `/$bunfs/...`) — mas isso não ajuda aqui, porque quem
 * precisa localizar o arquivo certo é o PRÓPRIO `node-pty`, com sua lógica
 * de nomes por plataforma (`pty.node`/`conpty.node`/
 * `conpty_console_list.node`), não este módulo.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { NodePtyModule } from './pty.ts';

/**
 * `true` só dentro de um binário compilado pelo `bun build --compile` — o
 * `import.meta.url` de TODO módulo embutido no bundle vira
 * `file:///$bunfs/root/...`, provado empiricamente (nunca acontece sob
 * `node dist/index.cjs` nem sob `bun run src/index.ts` em dev, onde
 * `import.meta.url` é sempre um `file://` real).
 */
function rodandoComoBinarioCompilado(): boolean {
  return import.meta.url.includes('/$bunfs/');
}

/**
 * Escreve os arquivos embutidos (ver `native-pty-embed.generated.ts`) num
 * diretório real, preservando o caminho RELATIVO original de cada um —
 * é essa preservação que faz os `require()` relativos internos do
 * `node-pty` (`./utils`, `../build/Release/pty.node`, etc.) resolverem
 * sozinhos, sem precisar reescrever nada dentro do pacote.
 */
function extrairParaDiretorioReal(
  arquivos: ReadonlyArray<{ relPath: string; embeddedPath: string }>,
): string {
  const raiz = mkdtempSync(join(tmpdir(), 'brabo-runner-native-pty-'));
  for (const { relPath, embeddedPath } of arquivos) {
    const destino = join(raiz, relPath);
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, readFileSync(embeddedPath));
  }
  return raiz;
}

/**
 * Resolve `node-pty`. Lança se, dentro do binário compilado, o manifesto
 * gerado estiver vazio — sinal de que `scripts/build-bin.mjs` não rodou
 * antes do `bun build --compile` (build malformado, nunca silencioso).
 */
export async function carregarNodePty(): Promise<NodePtyModule> {
  if (!rodandoComoBinarioCompilado()) {
    // Caminho de sempre — idêntico ao `import * as nodePty from 'node-pty'`
    // estático que existia antes, só que dinâmico (permite este `if`).
    return (await import('node-pty')) as unknown as NodePtyModule;
  }

  // Import ESTÁTICO por especificador literal — o Bun descobre e inclui
  // este módulo (e os `with { type: 'file' }` dentro dele) no grafo do
  // bundle na hora do `bun build --compile`, mesmo a chamada em si sendo
  // `await import(...)`. Fora de um build de binário, este arquivo existe
  // sempre (placeholder rastreado no git, `NATIVE_PTY_FILES: []`) — nunca
  // falha o `tsc --noEmit`/`vitest` do caminho normal.
  const { NATIVE_PTY_FILES } = await import('./native-pty-embed.generated.ts');
  if (NATIVE_PTY_FILES.length === 0) {
    throw new Error(
      'binário compilado sem node-pty embutido — native-pty-embed.generated.ts ' +
        'está com o placeholder vazio. Rode via `pnpm --filter runner build:bin`, ' +
        'nunca `bun build --compile` direto.',
    );
  }

  const diretorio = extrairParaDiretorioReal(NATIVE_PTY_FILES);
  const entrada = pathToFileURL(join(diretorio, 'lib', 'index.js')).href;
  return (await import(entrada)) as unknown as NodePtyModule;
}
