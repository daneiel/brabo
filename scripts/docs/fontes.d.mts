/**
 * Tipos de `./fontes.mjs`.
 *
 * O módulo é `.mjs` porque `scripts/docs/generate.mjs` — que roda por
 * `node scripts/docs/generate.mjs`, sem type stripping garantido — é o
 * consumidor original. Esta declaração existe para o SEGUNDO consumidor, os
 * `.ts` de `scripts/ci/`, que passam por `tsc --noEmit` no CI.
 */

export declare function ler(rel: string): string;

export declare function arquivos(glob: string): string[];

export declare function grepTodos(
  padrao: RegExp,
  caminhos: string[],
): Map<string, Set<string>>;

export type AppComEventos = 'api' | 'engine';

export declare const FONTES_DE_EVENTO: Record<
  AppComEventos,
  { glob: string; ignorar: (f: string) => boolean; padrao: RegExp }
>;

export declare function eventosEmitidosPor(
  app: AppComEventos,
): Map<string, Set<string>>;

export declare function tiposEmitidosPor(
  app: AppComEventos,
  prefixo: string,
): string[];
