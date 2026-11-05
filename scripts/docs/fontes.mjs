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
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { RAIZ } from './docmap.mjs';

export const CAMINHO_FONTES = join(RAIZ, 'scripts/docs/fontes.yml');

/** Lê um `fontes.yml`; valida que é mapa nome -> raiz (string). */
export function lerMapaDeFontes(arquivo) {
  const mapa = parse(readFileSync(arquivo, 'utf8'));
  if (!mapa || typeof mapa !== 'object' || Array.isArray(mapa)) {
    throw new Error(`${arquivo}: fontes.yml deve ser um mapa nome -> raiz`);
  }
  for (const [nome, raiz] of Object.entries(mapa)) {
    if (typeof raiz !== 'string' || !raiz) throw new Error(`${arquivo}: fonte "${nome}" sem raiz`);
  }
  return mapa;
}

// O mapa canônico (identidade) diz o que os caminhos escritos no código e nas
// RNs significam; o ATIVO (BRABO_FONTES) diz onde cada nome mora de verdade.
const canonico = () => lerMapaDeFontes(CAMINHO_FONTES);
const ativo = () => (process.env.BRABO_FONTES ? lerMapaDeFontes(resolve(process.env.BRABO_FONTES)) : canonico());

/** A fonte de um caminho canônico: o prefixo mais longo vence; `.` é o resto. */
export function fonteDe(rel) {
  const mapa = canonico();
  let melhor = null;
  for (const [nome, raiz] of Object.entries(mapa)) {
    if (!(raiz === '.' || rel === raiz || rel.startsWith(`${raiz}/`))) continue;
    if (melhor === null || raiz.length > mapa[melhor].length) melhor = nome;
  }
  if (melhor === null) throw new Error(`nenhuma fonte de fontes.yml cobre "${rel}"`);
  const raiz = mapa[melhor];
  const alvo = ativo()[melhor];
  if (!alvo) throw new Error(`fonte "${melhor}" ausente do fontes.yml ativo (${process.env.BRABO_FONTES})`);
  const sub = raiz === '.' ? rel : rel === raiz ? '' : rel.slice(raiz.length + 1);
  return { nome: melhor, raiz, base: resolve(RAIZ, alvo), sub };
}

/** Caminho absoluto REAL de um caminho canônico do monorepo. */
export function caminhoReal(rel) {
  const { base, sub } = fonteDe(rel);
  return join(base, sub);
}

/** Um arquivo do repositório, pelo caminho canônico relativo à raiz. */
export function ler(rel) {
  const { nome, base, sub } = fonteDe(rel);
  try {
    return readFileSync(join(base, sub), 'utf8');
  } catch (e) {
    throw new Error(`fonte "${nome}" (${base}): não leu "${sub}": ${e.message}`);
  }
}

function lsFiles(nome, base, pathspec) {
  if (!existsSync(base)) throw new Error(`fonte "${nome}": raiz inexistente ${base}`);
  return execFileSync('git', ['ls-files', '--', ...pathspec], { cwd: base, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

/** Os arquivos VERSIONADOS que casam com o glob — nunca o que está fora do git. */
export function arquivos(glob) {
  const literal = glob.split(/[*?[{]/)[0];
  const dir = literal.includes('/') ? literal.slice(0, literal.lastIndexOf('/')) : '.';
  const { nome, raiz, base } = fonteDe(dir);
  const rel = raiz === '.' ? glob : glob.slice(raiz.length + 1);
  return lsFiles(nome, base, [rel]).map((f) => (raiz === '.' ? f : `${raiz}/${f}`));
}

/** Todos os versionados de todas as fontes, em caminhos canônicos. */
export function versionados() {
  const mapa = canonico();
  const ativos = ativo();
  const todos = new Set();
  for (const [nome, raiz] of Object.entries(mapa)) {
    if (!ativos[nome]) throw new Error(`fonte "${nome}" ausente do fontes.yml ativo (${process.env.BRABO_FONTES})`);
    for (const f of lsFiles(nome, resolve(RAIZ, ativos[nome]), [])) todos.add(raiz === '.' ? f : `${raiz}/${f}`);
  }
  return [...todos];
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
