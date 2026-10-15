#!/usr/bin/env node
/**
 * Guarda da faixa de tradução (AT-550, ADR 0216 item 6), no molde de
 * `api-render-check.mjs`: afirma sobre o HTML ESTÁTICO do build.
 *
 *   node scripts/docs/faixa-de-traducao-check.mjs [<dir-do-build>]
 *
 *   - uma página SEM tradução em `en` (servida do fallback pt-BR) tem a faixa;
 *   - uma página traduzida para `en` que não está defasada NÃO tem a faixa;
 *   - a mesma página em pt-BR (raiz) nunca tem a faixa.
 *
 * As páginas são escolhidas pelo `website/src/data/traducao.json` e pela
 * árvore de tradução, não fixadas: o lote que traduzir a página-exemplo não
 * quebra a guarda. ESCOPO: não abre navegador.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR_BUILD = resolve(RAIZ, process.argv[2] ?? 'website/build');
const MARCA = 'data-faixa-de-traducao';
const DADOS = JSON.parse(readFileSync(join(RAIZ, 'website/src/data/traducao.json'), 'utf8'));
const TRADUZIDAS_EN = join(RAIZ, 'website/i18n/en/docusaurus-plugin-content-docs/current');

/** Rota simples: sem `id`/`slug` no frontmatter, a rota é o caminho sem extensão. */
function rotaSimples(arquivo) {
  if (!existsSync(arquivo)) return false;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(arquivo, 'utf8'));
  // `id` igual ao nome do arquivo não muda a rota; só `slug` ou `id` diferente mudam.
  const id = fm && /^id:\s*(\S+)/m.exec(fm[1])?.[1];
  return !(fm && (/^slug:/m.test(fm[1]) || (id && id !== arquivo.replace(/^.*\//, '').replace(/\.md$/, ''))));
}

function html(rota) {
  for (const c of [`${rota}.html`, `${rota}/index.html`]) {
    const p = join(DIR_BUILD, c);
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  return null;
}

const docs = (dir, base = '') =>
  readdirSync(join(dir, base), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? docs(dir, join(base, e.name)) : e.name.endsWith('.md') ? [join(base, e.name)] : [],
  );

const fonte = join(RAIZ, 'docs');
const naoTraduzida = docs(fonte).find(
  (rel) => rel.startsWith('explanation/') && !existsSync(join(TRADUZIDAS_EN, rel)) && rotaSimples(join(fonte, rel)),
);
const traduzida = Object.entries(DADOS.en ?? {}).find(
  ([rel, e]) => !e.defasada && rel.startsWith('explanation/') && rotaSimples(join(TRADUZIDAS_EN, rel)) && rotaSimples(join(fonte, rel)),
)?.[0];

let falhas = 0;
function conferir(rotulo, rota, querFaixa) {
  if (!rota) {
    console.error(`[faixa] não achei página para "${rotulo}".`);
    falhas++;
    return;
  }
  const h = html(rota);
  if (h === null) {
    console.error(`[faixa] ${rota}: página não existe no build.`);
    falhas++;
    return;
  }
  const tem = h.includes(MARCA);
  if (tem !== querFaixa) {
    console.error(`[faixa] ${rota}: faixa ${tem ? 'PRESENTE' : 'AUSENTE'}, esperado ${querFaixa ? 'presente' : 'ausente'} (${rotulo}).`);
    falhas++;
  } else console.log(`  ok        ${rota} (${rotulo})`);
}

const sem = (rel) => rel?.replace(/\.md$/, '');
conferir('fallback pt-BR em /en/', naoTraduzida && `en/${sem(naoTraduzida)}`, true);
conferir('pt-BR na raiz', naoTraduzida && sem(naoTraduzida), false);
conferir('tradução en não defasada', traduzida && `en/${sem(traduzida)}`, false);
process.exit(falhas ? 1 : 0);
