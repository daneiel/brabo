/**
 * Markdown -> HTML do site (AT-662, ADR 0253).
 *
 *   const render = await criarRenderizador({ paginas })       // paginas = descobrirPaginas(...)
 *   const { html, toc, texto } = render(pagina)
 *
 *   toc   = [{ nivel: 2|3, id, texto }]   -- o sumário "Nesta página" (A2)
 *   texto = texto corrido, sem marcação   -- insumo do índice de busca (A4)
 *   html  = corpo; `temMermaid` / `temH1` ao lado dizem o que o layout precisa saber
 *
 * Regras além do CommonMark (as mesmas que o Docusaurus aplicava):
 *  - `{#id}` ao fim do título vira o `id` (CONTRATO das RNs, `ancoras-de-rn.mjs`);
 *    sem ele, o id é o slug do texto (github-slugger, como o Docusaurus);
 *  - admonições `:::note|tip|info|warning|caution|danger [título]` ... `:::`;
 *  - ```mermaid -> `<pre class="mermaid" data-mermaid>`; demais cercas passam pelo shiki com
 *    tema de variáveis CSS (`--shiki-*`, definidas pelo CSS do site);
 *  - tabela embrulhada em `div.tabela-rolavel`;
 *  - link relativo `x.md#a` vira href relativo à URL da página no locale;
 *    `/rota/` vira `rota.html`; o resto (http, mailto, âncora, anexos) fica.
 */
import MarkdownIt from 'markdown-it';
import { createCssVariablesTheme, createHighlighter } from 'shiki';
import path from 'node:path';
import { urlRelativa } from './paginas.mjs';

const LINGUAGENS = ['bash', 'json', 'sql', 'elixir', 'yaml', 'typescript', 'tsx', 'javascript', 'diff', 'dockerfile', 'markdown', 'html', 'css', 'toml', 'ini'];
const ADMONICOES = new Set(['note', 'tip', 'info', 'warning', 'caution', 'danger']);
const TITULO_DA_ADMONICAO = { note: 'Nota', tip: 'Dica', info: 'Info', warning: 'Atenção', caution: 'Cuidado', danger: 'Perigo' };

/** github-slugger: o que o Docusaurus usava para o id de título sem `{#id}`. */
export function slugDeTitulo(texto) {
  return texto.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const esc = (s) => s.replace(/[&<>"]/g, (c) => ESC[c]);

function regraDeAdmonicao(state, inicio, fim, silencioso) {
  const pos = state.bMarks[inicio] + state.tShift[inicio];
  const linha = state.src.slice(pos, state.eMarks[inicio]);
  const m = /^:::(\w+)(?:\[([^\]]*)\]|\s+(.*))?\s*$/.exec(linha);
  if (!m || !ADMONICOES.has(m[1])) return false;
  let prox = inicio + 1;
  let fechou = false;
  for (; prox < fim; prox++) {
    const l = state.src.slice(state.bMarks[prox] + state.tShift[prox], state.eMarks[prox]).trim();
    if (l === ':::') { fechou = true; break; }
  }
  if (!fechou) return false;
  if (silencioso) return true;
  const abre = state.push('admonicao_open', 'div', 1);
  abre.meta = { tipo: m[1], titulo: (m[2] ?? m[3] ?? '').trim() || TITULO_DA_ADMONICAO[m[1]] };
  abre.map = [inicio, prox];
  const antigoMax = state.lineMax;
  const antigoPai = state.parentType;
  state.parentType = 'admonicao';
  state.lineMax = prox;
  state.md.block.tokenize(state, inicio + 1, prox);
  state.lineMax = antigoMax;
  state.parentType = antigoPai;
  state.push('admonicao_close', 'div', -1);
  state.line = prox + 1;
  return true;
}

/** Um título `Texto {#id}` perde o sufixo e ganha o `id`; ids repetidos ganham `-1`, `-2`. */
function regraDeTitulos(state) {
  const usados = new Map();
  const toc = [];
  state.env.toc = toc;
  const toks = state.tokens;
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].type !== 'heading_open') continue;
    const inline = toks[i + 1];
    const m = /\s*\{#([^}\s]+)\}\s*$/.exec(inline.content);
    let id;
    if (m) {
      id = m[1];
      inline.content = inline.content.slice(0, m.index);
      const ultimo = inline.children?.[inline.children.length - 1];
      if (ultimo?.type === 'text') ultimo.content = ultimo.content.replace(/\s*\{#[^}\s]+\}\s*$/, '');
    } else {
      const base = slugDeTitulo(inline.children.map((c) => (c.type === 'text' || c.type === 'code_inline' ? c.content : '')).join('').trim()) || 'secao';
      const n = usados.get(base) ?? 0;
      usados.set(base, n + 1);
      id = n ? `${base}-${n}` : base;
    }
    toks[i].attrSet('id', id);
    const nivel = Number(toks[i].tag.slice(1));
    if (nivel === 1) state.env.temH1 = true;
    const texto = inline.children.map((c) => (c.type === 'text' || c.type === 'code_inline' ? c.content : '')).join('').trim();
    if (nivel === 2 || nivel === 3) toc.push({ nivel, id, texto });
  }
}

function resolverLink(href, pagina, porRelativo) {
  if (!href || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) return href;
  const [alvo, frag = ''] = href.split('#');
  const ancora = frag ? `#${frag}` : '';
  if (alvo.startsWith('/')) {
    const rota = alvo.replace(/^\/+|\/+$/g, '');
    return urlRelativa(pagina.url, `${pagina.locale === 'pt-BR' ? '' : `${pagina.locale}/`}${rota || 'index'}.html`) + ancora;
  }
  if (!alvo.endsWith('.md')) return href;
  const rel = path.posix.normalize(path.posix.join(path.posix.dirname(pagina.relativo), alvo));
  const destino = porRelativo.get(rel);
  return destino ? urlRelativa(pagina.url, destino.url) + ancora : href; // quebrado: o checador (A5) reprova
}

export async function criarRenderizador({ paginas }) {
  const porRelativo = new Map(paginas.map((p) => [p.relativo, p]));
  const realce = await createHighlighter({ themes: [createCssVariablesTheme({ name: 'brabo', variablePrefix: '--shiki-' })], langs: LINGUAGENS });
  const md = new MarkdownIt({ html: true, linkify: false });
  md.block.ruler.before('fence', 'admonicao', regraDeAdmonicao, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  md.core.ruler.push('titulos_brabo', regraDeTitulos);
  md.renderer.rules.admonicao_open = (t, i) => `<div class="admonicao admonicao-${t[i].meta.tipo}" data-admonicao="${t[i].meta.tipo}"><p class="admonicao-titulo">${esc(t[i].meta.titulo)}</p>\n`;
  md.renderer.rules.admonicao_close = () => '</div>\n';
  md.renderer.rules.table_open = () => '<div class="tabela-rolavel"><table>\n';
  md.renderer.rules.table_close = () => '</table></div>\n';
  md.renderer.rules.fence = (t, i, _o, env) => {
    const tk = t[i];
    const lang = tk.info.trim().split(/\s+/)[0];
    if (lang === 'mermaid') { env.temMermaid = true; return `<pre class="mermaid" data-mermaid>${esc(tk.content)}</pre>\n`; }
    if (LINGUAGENS.includes(lang)) return `${realce.codeToHtml(tk.content, { lang, theme: 'brabo' })}\n`;
    return `<pre class="codigo"><code${lang ? ` class="language-${esc(lang)}"` : ''}>${esc(tk.content)}</code></pre>\n`;
  };
  const linkAberto = md.renderer.rules.link_open ?? ((t, i, o, _e, s) => s.renderToken(t, i, o));
  md.renderer.rules.link_open = (t, i, o, env, self) => {
    const h = t[i].attrGet('href');
    if (h != null) t[i].attrSet('href', resolverLink(h, env.pagina, porRelativo));
    return linkAberto(t, i, o, env, self);
  };

  return (pagina) => {
    const env = { pagina };
    const tokens = md.parse(pagina.corpo, env);
    const html = md.renderer.render(tokens, md.options, env);
    const texto = tokens.filter((t) => t.type === 'inline').map((t) => t.content).join('\n')
      .replace(/\s*\{#[^}\s]+\}/g, '').replace(/[`*_>#|]|\[([^\]]*)\]\([^)]*\)/g, (m, a) => a ?? '').replace(/\s+/g, ' ').trim();
    return { html, toc: env.toc ?? [], texto, temMermaid: !!env.temMermaid, temH1: !!env.temH1 };
  };
}
