#!/usr/bin/env node
/**
 * Os links que o site reescreve por gap de tradução, e a guarda que olha o
 * HTML gerado.
 *
 *   node scripts/docs/links-do-locale.mjs [<dir-do-build>]
 *
 * Sem argumento, usa `website/build`. Roda DEPOIS de `pnpm docs:build`.
 *
 * DUAS PEÇAS NUM ARQUIVO, porque são a mesma afirmação vista dos dois lados:
 *
 *   - `reescreverLinkDeGap` é o corpo do `markdown.hooks.onBrokenMarkdownLinks`
 *     de `website/docusaurus.config.ts`. Mora aqui, e não inline no config,
 *     para ser função PURA testável por `scripts/docs/links-do-locale.spec.ts`.
 *   - `acharLocaleDuplicado` varre o build e reprova `href` com o prefixo do
 *     locale DUPLICADO (`/pt-BR/pt-BR/`).
 *
 * POR QUE A GUARDA EXISTE (AT-221). A reescrita devolvia
 * `pathname:///pt-BR/<slug>`. Mas `pathname://` NÃO é caminho absoluto do
 * domínio: o `<Link>` do Docusaurus passa o alvo por `useBaseUrl`, e no build
 * do locale `pt-BR` o baseUrl JÁ é `/brabo/prd/pt-BR/`. O resultado era
 * `href=/brabo/prd/pt-BR/pt-BR/adr/...` — 290 hrefs distintos em 56 páginas,
 * todos 404, com o build VERDE: `pathname://` é justamente o escape hatch que
 * pula o checador de link quebrado, então nenhum `onBrokenLinks: 'throw'` via.
 * Quem pode ver é só quem olha o HTML, e é o que a guarda faz.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locales que ganham PREFIXO de caminho no site (todos menos o default). É a
 * mesma lista de `i18n.locales` do config menos `defaultLocale`; locale novo
 * entra aqui também, senão a duplicação dele passa calada.
 */
export const LOCALES_COM_PREFIXO = ['pt-BR'];

/**
 * Reescreve um link markdown quebrado por gap CONHECIDO de tradução, ou lança.
 *
 * O gap: compilando o locale `pt-BR`, um link relativo entre um arquivo
 * traduzido e um que só existe no default (ou o inverso) não bate com a árvore
 * de ARQUIVOS do locale, embora a PÁGINA exista nos dois sites — o Docusaurus
 * serve a página não traduzida no site `pt-BR` por FALLBACK, no mesmo slug.
 * Por isso a rota devolvida é `pathname:///<slug>` SEM prefixo de locale: quem
 * põe o locale é o baseUrl do build que está compilando, e pôr de novo aqui
 * era o defeito da AT-221. Isso também torna a reescrita correta em QUALQUER
 * locale, sem a suposição antiga de "não é en, então é pt-BR".
 *
 * @param {{ sourceFilePath: string, url: string }} args
 * @returns {string} a rota `pathname://` que substitui o link
 */
export function reescreverLinkDeGap({ sourceFilePath, url }) {
  // `sourceFilePath` chega relativo ao CWD do processo (`website/`), por isso
  // `../docs/reference/...` — nunca comparar com `startsWith` supondo raiz do
  // repo. Uma fonte em `website/i18n/pt-BR/.../current/adr/x.md` e uma em
  // `docs/adr/x.md` são o MESMO tipo de arquivo, só em locales diferentes.
  const MARCA_I18N = 'docusaurus-plugin-content-docs/current/';
  const origemRelativaARaiz = sourceFilePath.includes(MARCA_I18N)
    ? sourceFilePath.slice(sourceFilePath.indexOf(MARCA_I18N) + MARCA_I18N.length)
    : sourceFilePath.slice(sourceFilePath.indexOf('docs/') + 'docs/'.length);

  // As três zonas de gap conhecidas (ver o comentário no config): `reference/`
  // é gerado e não traduzido; `adr/` atrasa tradução toda semana; `explanation/`
  // ganha arquivo novo sem override. Os dois lados (fonte e alvo) importam.
  const fonteEhReferencia = origemRelativaARaiz.startsWith('reference/');
  const alvoEhReferencia = url.includes('/reference/');
  const fonteEhAdr = origemRelativaARaiz.startsWith('adr/');
  const alvoEhAdr = /(^|\/)\d{4}-[^/]+\.md$/.test(url.split('#')[0]);
  const fonteEhExplicacao = origemRelativaARaiz.startsWith('explanation/');
  if (
    !fonteEhReferencia &&
    !alvoEhReferencia &&
    !fonteEhAdr &&
    !alvoEhAdr &&
    !fonteEhExplicacao
  ) {
    throw new Error(
      `Markdown link quebrado: "${url}" em ${sourceFilePath}. Corrija o link ou aplique o protocolo pathname://.`,
    );
  }

  // Separa fragmento (#rn-004) do caminho — nenhum link local do repositório
  // usa query string, só fragmento.
  const [caminhoRelativo, ...resto] = url.split('#');
  const fragmento = resto.length > 0 ? `#${resto.join('#')}` : '';

  const slug = path.posix
    .join(path.posix.dirname(origemRelativaARaiz.split(path.sep).join('/')), caminhoRelativo)
    .replace(/\.mdx?$/, '');

  return `pathname:///${slug}${fragmento}`;
}

/**
 * Procura, no HTML, `href` com o prefixo de um locale repetido.
 *
 * @param {string} html
 * @returns {string[]} os hrefs ofensores, sem repetição
 */
export function hrefsComLocaleDuplicado(html) {
  const achados = new Set();
  for (const loc of LOCALES_COM_PREFIXO) {
    const esc = loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // O HTML minificado do Docusaurus emite `href=/x` sem aspas; cobre os dois.
    const re = new RegExp(`href=["']?([^"'\\s>]*/${esc}/${esc}/[^"'\\s>]*)`, 'g');
    for (const m of html.matchAll(re)) achados.add(m[1]);
  }
  return [...achados];
}

function* htmlsDe(dir) {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entrada.name);
    if (entrada.isDirectory()) yield* htmlsDe(p);
    else if (entrada.name.endsWith('.html')) yield p;
  }
}

/**
 * Varre um build inteiro.
 *
 * @param {string} dirBuild
 * @returns {{ arquivos: number, ofensores: Map<string, string[]> }}
 */
export function acharLocaleDuplicado(dirBuild) {
  const ofensores = new Map();
  let arquivos = 0;
  for (const arquivo of htmlsDe(dirBuild)) {
    arquivos += 1;
    const hrefs = hrefsComLocaleDuplicado(readFileSync(arquivo, 'utf8'));
    if (hrefs.length > 0) ofensores.set(path.relative(dirBuild, arquivo), hrefs);
  }
  return { arquivos, ofensores };
}

function main() {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const dir = path.resolve(process.argv[2] ?? path.join(raiz, 'website/build'));
  if (!existsSync(dir)) {
    console.error(`links-do-locale: o build não existe em ${dir} — rode \`pnpm docs:build\` antes.`);
    process.exit(2);
  }
  const { arquivos, ofensores } = acharLocaleDuplicado(dir);
  // Zero HTML lido é instrumento cego, não build limpo.
  if (arquivos === 0) {
    console.error(`links-do-locale: CEGO — nenhum .html em ${dir}.`);
    process.exit(2);
  }
  if (ofensores.size > 0) {
    const total = [...ofensores.values()].reduce((n, l) => n + l.length, 0);
    console.error(
      `links-do-locale: ${total} href(s) com o prefixo do locale DUPLICADO em ${ofensores.size} página(s) — 404 no site publicado:`,
    );
    for (const [arquivo, hrefs] of [...ofensores].slice(0, 20)) {
      console.error(`  ${arquivo}: ${hrefs.slice(0, 3).join(', ')}${hrefs.length > 3 ? ', …' : ''}`);
    }
    process.exit(1);
  }
  console.log(`links-do-locale: ${arquivos} páginas, nenhum href com locale duplicado.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
