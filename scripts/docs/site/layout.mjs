/*
 * Moldura do site de docs (AT-662, lane A2). Sem Docusaurus, sem CDN, sem
 * fonte do Google: tudo que a página carrega sai de `assets/` do próprio site.
 *
 * CONTRATO (A1 e A3 encaixam aqui):
 *   layout(p) -> string HTML completo.
 *   p = {
 *     locale     'pt-BR' | 'en' | 'ru' | 'zh-Hans'
 *     slug       caminho da página DENTRO do locale, sem barra inicial ('guides/x.html')
 *     titulo     texto puro
 *     conteudo   HTML já renderizado (vai dentro de <article class="doc">)
 *     toc        [{ id, texto, nivel }]  (nivel 2 ou 3; vazio = sem sumário)
 *     nav        [{ rotulo, itens: [{ rotulo, href, itens? }] }]  href = slug do locale (sem prefixo; http(s) fica como está)
 *     textos     { buscar, menu, tema, idioma, degrau, nestaPagina, editar, atualizado }  (catálogo do locale; faltou = vazio)
 *     faixaTraducao  string|null   texto da faixa "página ainda não traduzida"
 *     editarUrl  string|null
 *     atualizadoEm string|null     "12 out 2026 por Fulano", já formatado
 *     degrau     'dev' | 'prd' | 'local'
 *     degraus    ['dev','prd']      (seletor; some se vazio)
 *     temMermaid boolean              (carrega assets/mermaid.min.js, copiado pela A1)
 *     extraHead / extraScripts  string HTML opcional (A3: o <div> do Redoc e seus scripts)
 *   }
 * Classes: .site-nav (topo) .site-side (barra lateral) .doc (artigo) .site-toc
 * (sumário) .site-foot. Hooks de JS: [data-tema-alternar] [data-menu-alternar]
 * [data-seletor] [data-busca] [data-busca-lista] [data-mermaid]. `data-locale`
 * e `data-degrau` ficam no <html>. noindex em todo degrau que não é `prd`.
 * A A1 marca o bloco Mermaid como <pre class="mermaid" data-mermaid>.
 * `copiarAssets(destino)` copia tokens.css, fonts.css (reescrito para caminho
 * relativo), fontes woff2 e site.css/tema.js/site.js para `<destino>/assets/`.
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '../../..');
export const LOCALES = ['pt-BR', 'en', 'ru', 'zh-Hans'];

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function lista(itens, atual, pre) {
  return `<ul>${itens
    .map((i) => {
      const filhos = i.itens?.length ? lista(i.itens, atual, pre) : '';
      const ativo = i.href === atual ? ' aria-current="page"' : '';
      return `<li>${i.href ? `<a href="${/^https?:/.test(i.href) ? '' : pre}${esc(i.href)}"${ativo}>${esc(i.rotulo)}</a>` : `<span>${esc(i.rotulo)}</span>`}${filhos}</li>`;
    })
    .join('')}</ul>`;
}

export function layout(p) {
  const t = p.textos ?? {};
  const prof = p.slug.split('/').length - 1;
  const pre = '../'.repeat(prof); // raiz do locale
  const raiz = pre + (p.locale === 'pt-BR' ? '' : '../'); // raiz do degrau
  const lp = (l) => raiz + (l === 'pt-BR' ? '' : `${l}/`) + p.slug;
  const idiomas = LOCALES.map(
    (l) => `<option value="${esc(lp(l))}"${l === p.locale ? ' selected' : ''}>${esc(l)}</option>`,
  ).join('');
  const degraus = (p.degraus ?? [])
    .map(
      (d) =>
        `<option value="${esc(`${raiz}../${d}/${p.locale === 'pt-BR' ? '' : `${p.locale}/`}${p.slug}`)}"${d === p.degrau ? ' selected' : ''}>${esc(d)}</option>`,
    )
    .join('');
  const side = (p.nav ?? [])
    .map((g) => `<section><h2>${esc(g.rotulo)}</h2>${lista(g.itens, p.slug, pre)}</section>`)
    .join('');
  const toc = (p.toc ?? []).length
    ? `<aside class="site-toc"><h2>${esc(t.nestaPagina)}</h2><ul>${p.toc
        .map((h) => `<li class="n${h.nivel}"><a href="#${esc(h.id)}">${esc(h.texto)}</a></li>`)
        .join('')}</ul></aside>`
    : '';
  const meta = [
    p.editarUrl ? `<a href="${esc(p.editarUrl)}">${esc(t.editar)}</a>` : '',
    p.atualizadoEm ? `<span>${esc(t.atualizado)} ${esc(p.atualizadoEm)}</span>` : '',
  ].join('');
  return `<!doctype html>
<html lang="${esc(p.locale)}" data-locale="${esc(p.locale)}" data-degrau="${esc(p.degrau ?? 'local')}" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.titulo)} | Brabo</title>
${p.degrau && p.degrau !== 'prd' ? '<meta name="robots" content="noindex, nofollow">\n' : ''}<script src="${raiz}assets/tema.js"></script>
<link rel="stylesheet" href="${raiz}assets/tokens.css">
<link rel="stylesheet" href="${raiz}assets/fonts.css">
<link rel="stylesheet" href="${raiz}assets/site.css">
${p.extraHead ?? ''}</head>
<body>
<header class="site-nav">
<button type="button" data-menu-alternar aria-label="${esc(t.menu)}">&#9776;</button>
<a class="marca" href="${pre}index.html">Brabo</a>
<input type="search" data-busca placeholder="${esc(t.buscar)}" aria-label="${esc(t.buscar)}" autocomplete="off">
<ul data-busca-lista hidden></ul>
<select data-seletor aria-label="${esc(t.idioma)}">${idiomas}</select>
${degraus ? `<select data-seletor aria-label="${esc(t.degrau)}">${degraus}</select>` : ''}
<button type="button" data-tema-alternar aria-label="${esc(t.tema)}">&#9680;</button>
</header>
<div class="site-corpo">
<nav class="site-side" aria-label="docs">${side}</nav>
<main>
${p.faixaTraducao ? `<div class="site-faixa" role="note">${esc(p.faixaTraducao)}</div>` : ''}
<article class="doc">
${p.conteudo}
</article>
<footer class="site-foot">${meta}</footer>
</main>
${toc}
</div>
${p.temMermaid ? `<script src="${raiz}assets/mermaid.min.js"></script>\n` : ''}<script src="${raiz}assets/site.js"></script>
${p.extraScripts ?? ''}</body>
</html>
`;
}

// Copia o que a moldura serve. `destino` é a raiz do degrau (o build novo).
export function copiarAssets(destino) {
  const out = join(destino, 'assets');
  const fontes = join(out, 'fonts');
  mkdirSync(fontes, { recursive: true });
  copyFileSync(join(RAIZ, 'apps/web/node_modules/mermaid/dist/mermaid.min.js'), join(out, 'mermaid.min.js'));
  for (const f of ['site.css', 'tema.js', 'site.js'])
    copyFileSync(join(AQUI, 'assets', f), join(out, f));
  copyFileSync(join(RAIZ, 'design/tokens.css'), join(out, 'tokens.css'));
  const web = join(RAIZ, 'apps/web/public/fonts');
  for (const f of readdirSync(web).filter((n) => n.endsWith('.woff2') || n === 'LICENSE.txt'))
    copyFileSync(join(web, f), join(fontes, f));
  // O fonts.css do web usa `/fonts/…` (absoluto); o site é relativo (serve em /brabo/<degrau>/).
  writeFileSync(
    join(out, 'fonts.css'),
    readFileSync(join(RAIZ, 'apps/web/src/fonts.css'), 'utf8').replaceAll("url('/fonts/", "url('fonts/"),
  );
}

const TEXTOS = {
  'pt-BR': { buscar: 'Buscar', menu: 'Menu', tema: 'Alternar tema', idioma: 'Idioma', degrau: 'Ambiente', nestaPagina: 'Nesta página', editar: 'Editar esta página', atualizado: 'Atualizado em', faixa: 'Esta página ainda não foi traduzida; mostrando o original em português.' },
  en: { buscar: 'Search', menu: 'Menu', tema: 'Toggle theme', idioma: 'Language', degrau: 'Environment', nestaPagina: 'On this page', editar: 'Edit this page', atualizado: 'Updated', faixa: 'This page is not translated yet; showing the original in Portuguese.' },
  ru: { buscar: 'Поиск', menu: 'Меню', tema: 'Сменить тему', idioma: 'Язык', degrau: 'Среда', nestaPagina: 'На этой странице', editar: 'Редактировать страницу', atualizado: 'Обновлено', faixa: 'Эта страница ещё не переведена; показан оригинал на португальском.' },
  'zh-Hans': { buscar: '搜索', menu: '菜单', tema: '切换主题', idioma: '语言', degrau: '环境', nestaPagina: '本页内容', editar: '编辑此页', atualizado: '更新于', faixa: '此页尚未翻译；显示葡萄牙语原文。' },
};

// Traduz o ctx do núcleo (build.mjs) para o layout(p) acima. `extraScripts` leva a busca.
export function renderizarPagina(ctx) {
  const { locale, pagina, corpo, degrau, edicao } = ctx;
  const t = TEXTOS[locale];
  const slug = locale === 'pt-BR' ? pagina.url : pagina.url.slice(locale.length + 1);
  const hrefDe = (sl) => ctx.urlDe(sl);
  const item = (i) => ({
    rotulo: i.rotulo ?? ctx.rotuloDe(i.slug) ?? i.slug,
    href: i.tipo === 'link' ? i.href : i.slug != null ? hrefDe(i.slug) : null,
    itens: i.itens?.map(item),
  });
  const grupos = ctx.navegacao.map((i) => (i.tipo === 'categoria' ? item(i) : { rotulo: '', itens: [item(i)] }));
  const conteudo =
    (corpo.temH1 ? '' : `<h1>${esc(pagina.titulo)}</h1>`) +
    corpo.html +
    `<nav class="site-pager">${[ctx.anterior, ctx.proximo].map((v) => (v ? `<a href="${'../'.repeat(slug.split('/').length - 1)}${esc(hrefDe(v.slug))}">${esc(v.rotulo)}</a>` : '')).join('')}</nav>`;
  return layout({
    locale, slug, titulo: pagina.titulo, conteudo, toc: corpo.toc, nav: grupos, textos: t,
    faixaTraducao: pagina.traduzida ? null : t.faixa,
    editarUrl: edicao.url, atualizadoEm: edicao.atualizadoEm ? `${edicao.atualizadoEm}${edicao.autor ? ` · ${edicao.autor}` : ''}` : null,
    degrau, degraus: ['dev', 'prd'], temMermaid: corpo.temMermaid, extraScripts: ctx.extraScripts,
  });
}
