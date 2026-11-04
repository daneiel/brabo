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
 * Sem hidratação: as páginas são HTML+CSS estáticos (o Redoc não publica um cliente de
 * hidratação para este SSR). Nada vem de CDN; `disableTelemetry: true` sempre, e o teste
 * prova que nenhum HTML contém `otel.cloud.redocly.com`.
 *
 * As dependências do Redoc moram na árvore isolada de `website/` (lockfile próprio).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROTULOS_DO_REDOC, aplicar, lerCatalogo } from '../openapi-por-locale.mjs';

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

/** `/<base>/<tag>` -> `<tag>.html`; `/<base>/<tag>/<op>` -> `<tag>.html#<op>`; `id` nas seções de operação. */
export function relativizar(html, base) {
  const b = base.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return html
    .replace(new RegExp(`href="${b}/([^/"#]+)/([^"#]+)"`, 'g'), 'href="$1.html#$2"')
    .replace(new RegExp(`href="${b}/([^/"#]+)"`, 'g'), 'href="$1.html"')
    .replace(new RegExp(`href="${b}"`, 'g'), 'href="../api.html"')
    .replace(new RegExp(`data-section-id="${b}/[^/"]+/([^"]+)"`, 'g'), (m, op) => `${m} id="${op}"`);
}

const pagina = (lang, titulo, estilos, corpo) =>
  `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title>${estilos}</head><body>${corpo}</body></html>`;

export async function construirReferenciaDaApi({ saida, locales = ['pt-BR', 'en', 'ru', 'zh-Hans'], raiz = RAIZ }) {
  const R = await carregarRedoc();
  const fonte = JSON.parse(readFileSync(path.join(raiz, 'docs/reference/openapi.json'), 'utf8'));
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
    for (const t of tags) {
      const sheet = new R.ServerStyleSheet();
      const router = R.React.createElement(
        R.StaticRouter,
        { location: t.link },
        R.React.createElement(R.RedoclyApiDocsStandalone, { items: preparado.items, store: preparado.store, basePath: base, options: preparado.options }),
      );
      const corpo = relativizar(R.renderToString(sheet.collectStyles(router)), base);
      for (const m of corpo.matchAll(/data-section-id="[^"]*" id="([^"]+)"/g)) secoes.add(m[1]);
      const nome = t.link.split('/').pop();
      const voltar = `<p style="margin:12px 16px"><a href="../api.html">${esc(spec.info.title)}</a></p>`;
      writeFileSync(path.join(dirRef, 'api', `${nome}.html`), pagina(locale, `${t.label} — ${spec.info.title}`, sheet.getStyleTags(), voltar + corpo));
      sheet.seal();
    }
    const lista = tags.map((t) => `<li><a href="api/${esc(t.link.split('/').pop())}.html">${esc(t.label)}</a> (${t.items.length})</li>`).join('');
    writeFileSync(path.join(dirRef, 'api.html'), pagina(locale, spec.info.title, '', `<main style="max-width:48rem;margin:2rem auto;padding:0 16px;font-family:sans-serif"><h1>${esc(spec.info.title)}</h1><ul>${lista}</ul></main>`));
    resultado[locale] = { tags: tags.length, operacoes: secoes.size, esperadas: operacoesDoSpec(spec) };
  }
  return resultado;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const r = await construirReferenciaDaApi({ saida: path.resolve(process.argv[2] ?? 'build/docs-site') });
  console.log(JSON.stringify(r));
}
