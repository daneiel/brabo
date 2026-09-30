/**
 * AT-114 — o `spawn-helper` do `node-pty` chega SEM bit de execução no macOS
 * quando o runner roda sob NODE (pelo fonte, `pnpm install`; ou pelo pacote,
 * `npm install -g @brabo/runner`).
 *
 * O que foi medido: o tarball do `node-pty@1.1.0` traz
 * `prebuilds/darwin-{x64,arm64}/spawn-helper` com modo `0644`, e nem o
 * `install` (`scripts/prebuild.js`, que só confere se a pasta existe) nem o
 * `postinstall` (`scripts/post-install.js`, que só mexe em `build/Release` e
 * no Windows) o marcam executável. `lib/unixTerminal.js` monta
 * `native.dir + '/spawn-helper'` e o C++ o EXECUTA a cada `spawn`; sem o bit,
 * o erro é `posix_spawnp failed` — o mesmo de arquivo ausente. Na AT-065 o
 * run `34770476634` (`macos-15-intel`) só passou sob Node com um `chmod +x`
 * à mão.
 *
 * NÃO é o bug do Bun (oven-sh/bun#25822) e NÃO toca o binário compilado: lá
 * o `spawn-helper` é embutido pelo `scripts/build-bin.mjs` (que lê o
 * CONTEÚDO, nunca o modo) e extraído com `chmod 0o755` por
 * `native-pty-loader.ts`. Este módulo só serve o caminho sob Node.
 *
 * A correção mora no STARTUP (chamada por `carregarNodePty`, antes de o
 * primeiro PTY abrir) e não num `postinstall` do `apps/runner`: o pacote
 * publicado só leva `dist/`, e um `postinstall` do monorepo não alcançaria
 * quem instala por `npm install -g`, que tem o MESMO tarball do `node-pty`.
 *
 * Regras: roda SÓ em darwin; é idempotente (já executável não é tocado); e
 * falha ALTO e NOMEADA — `spawn-helper` ausente onde o `.node` foi achado,
 * `.node` não achado em lugar nenhum, ou `chmod` recusado (instalação global
 * de outro dono) viram erro com o caminho e o conserto, nunca silêncio.
 *
 * Nota: sob `pnpm`, o arquivo em `node_modules` é HARDLINK do store, então o
 * `chmod` vale também para o store — exatamente o que o `chmod +x` à mão da
 * AT-065 fazia.
 */

import { chmodSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Operações de disco usadas — injetáveis para o teste simular permissões. */
export interface DiscoDoSpawnHelper {
  existe(caminho: string): boolean;
  modo(caminho: string): number;
  chmod(caminho: string, modo: number): void;
}

const DISCO_REAL: DiscoDoSpawnHelper = {
  existe: (caminho) => existsSync(caminho),
  modo: (caminho) => statSync(caminho).mode,
  chmod: (caminho, modo) => chmodSync(caminho, modo),
};

export type DesfechoDoSpawnHelper =
  | { tipo: 'nao-se-aplica'; plataforma: string }
  | { tipo: 'ja-executavel'; caminho: string }
  | { tipo: 'corrigido'; caminho: string };

export interface OpcoesDoSpawnHelper {
  /** Raiz do pacote `node-pty` instalado (a pasta do `package.json` dele). */
  raizDoNodePty: string;
  plataforma?: NodeJS.Platform;
  arch?: string;
  disco?: DiscoDoSpawnHelper;
}

/** Bits de execução de dono, grupo e outros — o que `chmod +x` acrescenta. */
const BITS_DE_EXECUCAO = 0o111;

/**
 * As pastas onde o `node-pty` procura o `.node`, na MESMA ordem de
 * `lib/utils.js#loadNativeModule` (relativas à raiz do pacote). A primeira
 * que tem `pty.node` é a que ele carrega, e é ao lado DELA que o
 * `spawn-helper` é procurado (`native.dir`).
 */
export function pastasNativasDoNodePty(plataforma: string, arch: string): string[] {
  return [join('build', 'Release'), join('build', 'Debug'), join('prebuilds', `${plataforma}-${arch}`)];
}

/**
 * Garante que o `spawn-helper` que o `node-pty` vai executar tem bit de
 * execução. Só em darwin; fora dele devolve `nao-se-aplica` sem tocar o disco.
 */
export function garantirSpawnHelperExecutavel(opcoes: OpcoesDoSpawnHelper): DesfechoDoSpawnHelper {
  const plataforma = opcoes.plataforma ?? process.platform;
  const arch = opcoes.arch ?? process.arch;
  const disco = opcoes.disco ?? DISCO_REAL;
  if (plataforma !== 'darwin') return { tipo: 'nao-se-aplica', plataforma };

  const pastas = pastasNativasDoNodePty(plataforma, arch).map((rel) => join(opcoes.raizDoNodePty, rel));
  const pasta = pastas.find((p) => disco.existe(join(p, 'pty.node')));
  if (pasta === undefined) {
    throw new Error(
      `spawn-helper: nenhum pty.node do node-pty para ${plataforma}-${arch} — procurado em ` +
        `${pastas.join(', ')}. A instalação do node-pty está incompleta: reinstale ` +
        '(`pnpm install` no monorepo, ou `npm install -g @brabo/runner`).',
    );
  }

  const caminho = join(pasta, 'spawn-helper');
  if (!disco.existe(caminho)) {
    throw new Error(
      `spawn-helper: ${caminho} não existe, ao lado do pty.node que o node-pty carrega. ` +
        'Sem ele nenhum terminal abre (`posix_spawnp failed`). Reinstale o node-pty ' +
        '(`pnpm install` no monorepo, ou `npm install -g @brabo/runner`).',
    );
  }

  const modo = disco.modo(caminho);
  if ((modo & BITS_DE_EXECUCAO) === BITS_DE_EXECUCAO) return { tipo: 'ja-executavel', caminho };

  try {
    disco.chmod(caminho, (modo & 0o7777) | BITS_DE_EXECUCAO);
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    throw new Error(
      `spawn-helper: ${caminho} está sem bit de execução e o runner não conseguiu ` +
        `corrigi-lo (${motivo}). Sem ele nenhum terminal abre (\`posix_spawnp failed\`). ` +
        `Rode, com o dono do arquivo: chmod +x "${caminho}"`,
    );
  }
  return { tipo: 'corrigido', caminho };
}
