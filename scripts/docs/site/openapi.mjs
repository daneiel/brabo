/**
 * Referência da API do site novo (AT-662 A3, ADR 0253): Redoc 3 com SSR, UMA
 * PÁGINA POR TAG, traduzida por locale e SEM telemetria.
 *
 *   import { construirReferenciaDaApi } from './openapi.mjs';
 *   await construirReferenciaDaApi({ saida, locales });   // locales: ['pt-BR','en','ru','zh-Hans']
 *
 * Por locale (pt-BR na raiz, os outros sob `<locale>/`), em `<saida>/`:
 *   reference/api.html              índice das tags (a URL antiga leva a algum lugar)
 *   reference/api/<tag>.html        as operações da tag, renderizadas no servidor
 *   reference/openapi.json          o spec TRADUZIDO daquele locale (`aplicar`, ADR 0220)
 *
 * FORMA DE URL. O Redoc 3 é um site por rotas (`/<tag>`, `/<tag>/<operationId>`).
 * Cada rota de tag vira `<tag>.html`; a rota de operação vira `<tag>.html#<operationId>`
 * (o `id` é posto na seção, que o Redoc só marca com `data-section-id`). Os links são
 * RELATIVOS, então a página vale sob qualquer prefixo (`/brabo/dev/`). Uma operação com
 * mais de uma tag aparece em cada página dela. A âncora antiga `#tag/…/operation/…` não existe.
 *
 * MOLDURA: `moldura(locale, { slug, titulo, conteudo, extraHead })` (opcional) devolve o documento
 * HTML; o `build.mjs` passa a do `layout.mjs`. O CSS do Redoc é UM arquivo por locale
 * (`reference/api/redoc.css`), união das regras de topo de todas as páginas.
 *
 * PERDA DECLARADA, sem hidratação: as páginas são HTML+CSS estáticos (expandir, recolher e
 * alternar exemplos não funcionam). Medido em redoc@3.0.1: `redoc.d.ts` não exporta `hydrate`
 * e o único cliente é `redoc.standalone.js`, que embute `otel.cloud.redocly.com` (telemetria). Nada vem de CDN; `disableTelemetry: true` sempre, e o teste
 * prova que nenhum HTML contém `otel.cloud.redocly.com`.
 *
 * As dependências do Redoc moram na árvore isolada de `website/` (lockfile próprio).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROTULOS_DO_REDOC, aplicar, caminhoDaApi, lerCatalogo } from '../openapi-por-locale.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const METODOS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function carregarRedoc() {
  const req = createRequire(path.join(RAIZ, 'website/package.json'));
  const nm = path.join(RAIZ, 'website/node_modules');
  const [{ default: React }, { renderToString }, { StaticRouter }, redoc] = await Promise.all([
    import(pathToFileURL(req.resolve('react')).href),
    import(pathToFileURL(req.resolve('react-dom/server')).href),
    import(pathToFileURL(req.resolve('react-router')).href),
    import(pathToFileURL(path.join(nm, 'redoc/bundles/redoc.js')).href),
  ]);
  return { React, renderToString, StaticRouter, ...redoc };
}

export const operacoesDoSpec = (spec) =>
  Object.values(spec.paths).reduce((n, item) => n + Object.keys(item).filter((m) => METODOS.has(m)).length, 0);

/**
 * Todo `href` que o Redoc gera sob `base` vira relativo e existente: `/<base>/<tag>` -> `<tag>.html`;
 * `/<base>/<tag>/<op>[...]` (inclusive `#<op>/request`, `?t=...`) -> `<tag>.html#<op>`; `/<base>` e
 * `/<base>/section/...` -> `../api.html`. O `id` entra na seção de operação.
 */
export function relativizar(html, base) {
  const b = base.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return html
    .replace(new RegExp(`href="${b}(?:/([^/"#?]+))?(?:/([^/"#?]+))?[^"]*"`, 'g'), (_m, tag, op) =>
      !tag || tag === 'section' ? 'href="../api.html"' : `href="${tag}.html${op ? `#${op}` : ''}"`)
    .replace(new RegExp(`data-section-id="${b}/[^/"]+/([^"]+)"`, 'g'), (m, op) => `${m} id="${op}"`);
}

// shortcut: separa só regras de topo (profundidade de chaves 0) e dedupe por texto; a ordem é a da primeira página que a trouxe.
export function regrasDeTopo(css) {
  const out = [];
  let d = 0, ini = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') d++;
    else if (css[i] === '}' && --d === 0) { out.push(css.slice(ini, i + 1).trim()); ini = i + 1; }
  }
  return out;
}

const pagina = (lang, titulo, estilos, corpo) =>
  `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title>${estilos}</head><body>${corpo}</body></html>`;

export async function construirReferenciaDaApi({ saida, locales = ['pt-BR', 'en', 'ru', 'zh-Hans'], raiz = RAIZ, moldura = null }) {
  const R = await carregarRedoc();
  const fonte = JSON.parse(readFileSync(caminhoDaApi(raiz, 'reference/openapi.json'), 'utf8'));
  const resultado = {};
  for (const locale of locales) {
    const { spec } = aplicar(fonte, lerCatalogo(raiz, locale));
    const dirLocale = path.join(saida, locale === 'pt-BR' ? '' : locale);
    const dirRef = path.join(dirLocale, 'reference');
    mkdirSync(path.join(dirRef, 'api'), { recursive: true });
    writeFileSync(path.join(dirRef, 'openapi.json'), JSON.stringify(spec));

    const base = `/reference/api`;
    const labels = ROTULOS_DO_REDOC[locale] ?? ROTULOS_DO_REDOC['pt-BR'];
    const preparado = await R.prepareApiDocs({ spec, basePath: base, options: { disableTelemetry: true, labels } });
    const tags = preparado.items.filter((i) => i.type === 'group');
    const secoes = new Set();
    const regras = new Set();
    const paginas = [];
    for (const t of tags) {
      const sheet = new R.ServerStyleSheet();
      const router = R.React.createElement(
        R.StaticRouter,
        { location: t.link },
        R.React.createElement(R.RedoclyApiDocsStandalone, { items: preparado.items, store: preparado.store, basePath: base, options: preparado.options }),
      );
      const corpo = relativizar(R.renderToString(sheet.collectStyles(router)), base);
      for (const m of corpo.matchAll(/data-section-id="[^"]*" id="([^"]+)"/g)) secoes.add(m[1]);
      for (const css of sheet.getStyleTags().matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) for (const r of regrasDeTopo(css[1])) regras.add(r);
      sheet.seal();
      paginas.push({ nome: t.link.split('/').pop(), titulo: `${t.label} — ${spec.info.title}`, corpo });
    }
    writeFileSync(path.join(dirRef, 'api', 'redoc.css'), [...regras].join('\n'));
    const envolver = moldura ?? ((_l, { titulo, conteudo, extraHead }) => pagina(locale, titulo, extraHead, conteudo));
    for (const p of paginas) {
      const voltar = `<p><a href="../api.html">${esc(spec.info.title)}</a></p>`;
      writeFileSync(path.join(dirRef, 'api', `${p.nome}.html`), envolver(locale, { slug: `reference/api/${p.nome}.html`, titulo: p.titulo, conteudo: voltar + p.corpo, extraHead: '<link rel="stylesheet" href="redoc.css">' }));
    }
    const lista = tags.map((t) => `<li><a href="api/${esc(t.link.split('/').pop())}.html">${esc(t.label)}</a> (${t.items.length})</li>`).join('');
    const indice = `<h1>${esc(spec.info.title)}</h1><ul>${lista}</ul>`;
    writeFileSync(path.join(dirRef, 'api.html'), envolver(locale, { slug: 'reference/api.html', titulo: spec.info.title, conteudo: indice, extraHead: '' }));
    resultado[locale] = { tags: tags.length, operacoes: secoes.size, esperadas: operacoesDoSpec(spec) };
  }
  return resultado;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const r = await construirReferenciaDaApi({ saida: path.resolve(process.argv[2] ?? 'build/docs-site') });
  console.log(JSON.stringify(r));
}
