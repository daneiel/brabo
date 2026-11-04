#!/usr/bin/env node
/**
 * Orquestra o gerador do site (AT-662, ADR 0253):  `pnpm docs:site [saida]`.
 *
 * Para cada locale: páginas (paginas.mjs) -> HTML (render.mjs) -> navegação
 * (navegacao.mjs) -> moldura (layout.mjs, da lane A2) -> `build/docs-site/`.
 * Copia `docs/assets/` (imagens citadas pelas páginas) para a raiz do site.
 *
 * CONTRATO com a moldura (A2): `layout.mjs` exporta
 *
 *   renderizarPagina(ctx) -> string (documento HTML completo)
 *
 *   ctx = { locale, locales, pagina, corpo (render.mjs), navegacao, anterior, proximo,
 *           degrau, noindex, repo, edicao: { url, atualizadoEm, autor } }
 *
 * Enquanto o `layout.mjs` não existir, entra uma moldura MÍNIMA (só o suficiente
 * para o site ser navegável e checável); quando A2 chegar, ela passa a valer
 * sozinha. Busca (A4), API (A3) e checador de links (A5) plugam em `construir`,
 * que devolve `{ saida, locales: { <locale>: { paginas, navegacao } } }`.
 *
 * Variáveis: `DOCS_BRANCH` (degrau; `main` indexa, o resto sai `noindex`),
 * `GITHUB_REPOSITORY` (padrão `daneiel/brabo`).
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { construirNavegacao, lerRotulosDaBarra, listaPlana } from './navegacao.mjs';
import { LOCALES, descobrirPaginas, historicoDoGit, urlRelativa } from './paginas.mjs';
import { criarRenderizador, esc } from './render.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

async function carregarLayout() {
  const arq = path.join(path.dirname(fileURLToPath(import.meta.url)), 'layout.mjs');
  return existsSync(arq) ? (await import(pathToFileURL(arq).href)).renderizarPagina : molduraMinima;
}

function molduraMinima({ pagina, corpo, locale, noindex }) {
  const raiz = urlRelativa(pagina.url, 'index.html').replace(/index\.html$/, '');
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${noindex ? '<meta name="robots" content="noindex">' : ''}<title>${esc(pagina.titulo)}</title></head><body><nav><a href="${raiz}index.html">Brabo</a></nav><main>${corpo.temH1 ? '' : `<h1>${esc(pagina.titulo)}</h1>`}${corpo.html}</main></body></html>`;
}

export async function construir({ raiz = RAIZ, saida = path.join(raiz, 'build/docs-site'), degrau = process.env.DOCS_BRANCH ?? 'dev', repo = process.env.GITHUB_REPOSITORY ?? 'daneiel/brabo', git = true } = {}) {
  const layout = await carregarLayout();
  const historico = git ? historicoDoGit(raiz) : new Map();
  rmSync(saida, { recursive: true, force: true });
  const resultado = { saida, locales: {} };
  for (const locale of LOCALES) {
    const paginas = descobrirPaginas({ raiz, locale });
    const render = await criarRenderizador({ paginas });
    const navegacao = construirNavegacao({ raiz, repo, rotulos: lerRotulosDaBarra(raiz, locale) });
    const ordem = listaPlana(navegacao);
    const porSlug = new Map(paginas.map((p) => [p.slug, p]));
    for (const pagina of paginas) {
      const i = ordem.findIndex((o) => o.slug === pagina.slug);
      const vizinho = (o) => (o && porSlug.get(o.slug) ? { ...o, url: porSlug.get(o.slug).url } : null);
      const h = historico.get(`docs/${pagina.relativo}`);
      const html = layout({
        locale, locales: LOCALES, pagina, corpo: render(pagina), navegacao,
        anterior: i > 0 ? vizinho(ordem[i - 1]) : null, proximo: i >= 0 ? vizinho(ordem[i + 1]) : null,
        degrau, noindex: degrau !== 'main', repo,
        edicao: { url: `https://github.com/${repo}/blob/dev/docs/${pagina.relativo}`, atualizadoEm: h?.data ?? null, autor: h?.autor ?? null },
      });
      const destino = path.join(saida, pagina.url);
      mkdirSync(path.dirname(destino), { recursive: true });
      writeFileSync(destino, html);
    }
    resultado.locales[locale] = { paginas, navegacao };
  }
  // imagens: o site espelha docs/, então o caminho relativo da fonte vale em cada locale
  for (const l of LOCALES) if (existsSync(path.join(raiz, "docs/assets"))) cpSync(path.join(raiz, "docs/assets"), path.join(saida, l === "pt-BR" ? "" : l, "assets"), { recursive: true });
  writeFileSync(path.join(saida, '.nojekyll'), '');
  return resultado;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const r = await construir({ saida: process.argv[2] ? path.resolve(process.argv[2]) : undefined });
  console.log(`docs:site -> ${r.saida}: ${Object.entries(r.locales).map(([l, v]) => `${l}=${v.paginas.length}`).join(' ')}`);
}
