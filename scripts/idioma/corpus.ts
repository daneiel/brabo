/**
 * Leitura e escrita dos corpora de idioma (AT-160).
 *
 * Dois corpora, com regras OPOSTAS sobre onde moram:
 *   - o SINTÉTICO é versionado (`corpus-sintetico.jsonl`, ao lado deste
 *     arquivo): toda linha foi escrita à mão para o instrumento, nenhuma veio
 *     de uma sessão, e cada uma carrega `origem: "sintetico"`;
 *   - o REAL (mensagens do event log LOCAL do dono) mora FORA do git, em
 *     `$XDG_CACHE_HOME/brabo/corpus-idioma/` (senão `~/.cache/...`), e
 *     `escreverCorpus` RECUSA gravar dentro deste checkout. Mensagem real não
 *     entra no git, em fixture, em log de CI nem em corpo de PR.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ItemDoCorpus {
  id: string;
  /**
   * Rótulo: código BCP-47 (a lista é ABERTA, AT-168 resposta 2), ou `und`
   * (não há idioma a decidir: "ok", só código, só log) ou `mul` (misto sem
   * língua dominante). `null` = ainda não rotulado (só no corpus real).
   */
  idioma: string | null;
  texto: string;
  caso?: string;
  origem: 'sintetico' | 'real';
  /** Corpus real: quem escreveu (o `actor_id`), para a avaliação em sequência. */
  grupo?: string;
  /** Corpus real: instante da mensagem, para ordenar a sequência. */
  em?: string;
}

export const AQUI = dirname(fileURLToPath(import.meta.url));
export const RAIZ_DO_REPOSITORIO = resolve(AQUI, '..', '..');
export const CORPUS_SINTETICO = join(AQUI, 'corpus-sintetico.jsonl');
export const SEQUENCIAS_SINTETICAS = join(AQUI, 'sequencias-sinteticas.json');

export function pastaDoCorpusReal(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CACHE_HOME && isAbsolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : join(homedir(), '.cache');
  return join(base, 'brabo', 'corpus-idioma');
}

export function corpusRealPadrao(env: NodeJS.ProcessEnv = process.env): string {
  return join(pastaDoCorpusReal(env), 'mensagens.jsonl');
}

/** O caminho cai dentro deste checkout (onde um `git add -A` o levaria)? */
export function dentroDoRepositorio(caminho: string, raiz = RAIZ_DO_REPOSITORIO): boolean {
  const rel = relative(raiz, resolve(caminho));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Rótulo reduzido à língua (`pt-BR` → `pt`); `und`/`mul` ficam como estão. */
export function linguaDoRotulo(rotulo: string): string {
  return rotulo.trim().split(/[-_]/)[0]!.toLowerCase();
}

export function lerCorpus(caminho: string): ItemDoCorpus[] {
  const itens: ItemDoCorpus[] = [];
  readFileSync(caminho, 'utf8')
    .split('\n')
    .forEach((linha, i) => {
      if (linha.trim() === '') return;
      let item: ItemDoCorpus;
      try {
        item = JSON.parse(linha) as ItemDoCorpus;
      } catch (erro) {
        throw new Error(`${caminho}:${i + 1}: JSON inválido (${(erro as Error).message})`);
      }
      if (typeof item.id !== 'string' || typeof item.texto !== 'string') {
        throw new Error(`${caminho}:${i + 1}: item sem \`id\` ou \`texto\``);
      }
      itens.push(item);
    });
  return itens;
}

/**
 * Grava o corpus REAL, atomicamente (temporário + rename), com a pasta em 700 e
 * o arquivo em 600. Recusa qualquer destino dentro do checkout.
 */
export function escreverCorpus(caminho: string, itens: readonly ItemDoCorpus[]): void {
  if (dentroDoRepositorio(caminho)) {
    throw new Error(
      `recusado: ${caminho} fica dentro do repositório. O corpus real é mensagem de usuário e mora FORA do git ` +
        `(padrão: ${corpusRealPadrao()}).`,
    );
  }
  mkdirSync(dirname(caminho), { recursive: true, mode: 0o700 });
  const temporario = `${caminho}.${process.pid}.tmp`;
  writeFileSync(temporario, itens.map((i) => JSON.stringify(i)).join('\n') + (itens.length ? '\n' : ''), {
    mode: 0o600,
  });
  renameSync(temporario, caminho);
}
