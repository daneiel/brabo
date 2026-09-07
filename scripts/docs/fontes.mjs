/**
 * Leitura do REPOSITÓRIO como fonte — os poucos primitivos com que
 * `scripts/docs/generate.mjs` varre o código para gerar inventário, e com que
 * `scripts/ci/*.spec.ts` compara duas listas que deveriam concordar.
 *
 * Existe porque a varredura de tipos de evento passou a ter DOIS consumidores:
 * o bloco gerado de `docs/reference/events.md` (que documenta) e o teste
 * cruzado de vocabulário `dev.*` (que reprova). Um segundo extrator com o
 * mesmo regex e globs diferentes é o defeito que este arquivo evita — a
 * pergunta "o que o engine emite?" tem que ter UMA resposta.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ } from './docmap.mjs';

/** Um arquivo do repositório, pelo caminho relativo à raiz. */
export function ler(rel) {
  return readFileSync(join(RAIZ, rel), 'utf8');
}

function git(...args) {
  return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8' });
}

/** Os arquivos VERSIONADOS que casam com o glob — nunca o que está fora do git. */
export function arquivos(glob) {
  return git('ls-files', glob).split('\n').filter(Boolean);
}

/** Map<valor capturado, Set(arquivos onde aparece)>. */
export function grepTodos(padrao, caminhos) {
  const achados = new Map(); // valor -> Set(arquivos)
  for (const caminho of caminhos) {
    let texto;
    try {
      texto = ler(caminho);
    } catch {
      continue;
    }
    for (const m of texto.matchAll(padrao)) {
      const valor = m[1];
      if (!achados.has(valor)) achados.set(valor, new Set());
      achados.get(valor).add(caminho);
    }
  }
  return achados;
}

/**
 * Onde um tipo de evento é EMITIDO, por app. Um `padrao` por linguagem, porque
 * a forma de escrever o literal difere: no engine é uma string solta (e por
 * isso o inventário gerado filtra por prefixo conhecido), na api é sempre um
 * campo `type:`/`eventType:`.
 */
export const FONTES_DE_EVENTO = {
  api: {
    glob: 'apps/api/src/**/*.ts',
    ignorar: (f) => f.includes('.spec.'),
    padrao: /(?:type|eventType):\s*'([a-z_]+\.[a-z_]+)'/g,
  },
  engine: {
    glob: 'apps/engine/lib/**/*.ex',
    ignorar: () => false,
    padrao: /"([a-z_]+\.[a-z_]+)"/g,
  },
};

/** Map<tipo de evento, Set(arquivos)> emitido por UM app. */
export function eventosEmitidosPor(app) {
  const fonte = FONTES_DE_EVENTO[app];
  if (!fonte) throw new Error(`fonte de evento desconhecida: ${app}`);
  return grepTodos(
    fonte.padrao,
    arquivos(fonte.glob).filter((f) => !fonte.ignorar(f)),
  );
}

/**
 * Os tipos `<prefixo>.*` emitidos por um app, ordenados.
 *
 * É a pergunta que o teste cruzado faz — "qual é o vocabulário REAL do
 * engine?" — e a única resposta autoritativa é o código dele.
 */
export function tiposEmitidosPor(app, prefixo) {
  return [...eventosEmitidosPor(app).keys()]
    .filter((t) => t.startsWith(`${prefixo}.`))
    .sort();
}
