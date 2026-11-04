/**
 * Descoberta das páginas do site (AT-662, ADR 0253).
 *
 * CONTRATO com as outras lanes (A2 layout, A3 API, A4 busca, A5 links):
 *
 *   descobrirPaginas({ raiz, locale }) -> Pagina[]   (conjunto INTEIRO do locale)
 *
 *   Pagina = {
 *     slug,        // 'adr/0004-x', 'adr' (de adr/index.md), '' (a intro)
 *     url,         // relativa à RAIZ do site: 'adr/0004-x.html', 'en/adr.html', 'index.html'
 *     arquivo,     // caminho absoluto do .md servido (tradução ou fonte)
 *     relativo,    // caminho relativo a docs/ da FONTE ('adr/index.md'), p/ "editar esta página"
 *     locale,
 *     traduzida,   // true = veio da tradução; false = fallback na fonte pt-BR (ou o próprio pt-BR)
 *     titulo, descricao, rotulo (sidebar_label ?? título), dados (frontmatter inteiro), corpo
 *   }
 *
 *   urlRelativa(deUrl, paraUrl) -> href relativo entre duas urls do site (sem '/' inicial).
 *
 * As URLs são as MESMAS do Docusaurus (`trailingSlash: false`): `x.md` -> `x.html`,
 * `pasta/index.md` -> `pasta.html`, `intro.md` (slug `/`) -> `index.html`, e os
 * três outros idiomas sob `/<locale>/`. O prefixo numérico do ADR é mantido.
 *
 * O caminho das traduções é UMA constante (`CAMINHO_DAS_TRADUCOES`): a Rodada B
 * o troca para `docs/i18n/<locale>/` (decisão do dono de 04/11) e só ela muda.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const LOCALE_FONTE = 'pt-BR';
export const LOCALES = ['pt-BR', 'en', 'ru', 'zh-Hans'];

/** Onde moram as traduções de um locale, relativo à raiz do repositório. */
export const CAMINHO_DAS_TRADUCOES = (locale) =>
  `website/i18n/${locale}/docusaurus-plugin-content-docs/current`;

/** Não são páginas do site: a missão de documentação e os parciais `_*.md`. */
const excluida = (rel) => rel.startsWith('missions/') || path.posix.basename(rel).startsWith('_');

/** Separa o frontmatter (YAML) do corpo. Sem frontmatter, `dados` é `{}`. */
export function lerFrontmatter(texto) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(texto);
  if (!m) return { dados: {}, corpo: texto };
  let dados = {};
  try {
    dados = YAML.parse(m[1]) ?? {};
  } catch (e) {
    throw new Error(`frontmatter inválido: ${e.message}`);
  }
  return { dados, corpo: texto.slice(m[0].length) };
}

/** `adr/index.md` -> `adr`; `intro.md` com `slug: /` -> ``; `a/b.md` -> `a/b`. */
export function slugDe(relativo, dados = {}) {
  if (dados.slug === '/') return '';
  const s = relativo.replace(/\.md$/, '');
  return s === 'index' ? '' : s.replace(/\/index$/, '');
}

export function urlDe(slug, locale) {
  const prefixo = locale === LOCALE_FONTE ? '' : `${locale}/`;
  return `${prefixo}${slug === '' ? 'index' : slug}.html`;
}

function listarMd(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return listarMd(p, base);
    return e.name.endsWith('.md') ? [path.relative(base, p).split(path.sep).join('/')] : [];
  });
}

/** href relativo de uma url do site a outra (ambas relativas à raiz do site). */
export function urlRelativa(deUrl, paraUrl) {
  const rel = path.posix.relative(path.posix.dirname(deUrl), paraUrl);
  return rel === '' ? path.posix.basename(paraUrl) : rel;
}

export function descobrirPaginas({ raiz, locale = LOCALE_FONTE }) {
  const docs = path.join(raiz, 'docs');
  const traducoes = path.join(raiz, CAMINHO_DAS_TRADUCOES(locale));
  const fonte = listarMd(docs).filter((r) => !excluida(r));
  const traduzidas = new Set(locale === LOCALE_FONTE ? [] : listarMd(traducoes).filter((r) => !excluida(r)));
  const todos = new Set([...fonte, ...traduzidas]);
  const vistos = new Map();
  const paginas = [...todos].sort().map((relativo) => {
    const veioDaTraducao = traduzidas.has(relativo);
    const arquivo = veioDaTraducao ? path.join(traducoes, relativo) : path.join(docs, relativo);
    const { dados, corpo } = lerFrontmatter(readFileSync(arquivo, 'utf8'));
    const slug = slugDe(relativo, dados);
    if (vistos.has(slug)) throw new Error(`URL duplicada "${slug}": ${vistos.get(slug)} e ${relativo}`);
    vistos.set(slug, relativo);
    const h1 = /^#\s+(.+?)(?:\s+\{#[^}]+\})?\s*$/m.exec(corpo)?.[1];
    const titulo = dados.title ?? h1 ?? slug;
    return {
      slug, url: urlDe(slug, locale), arquivo, relativo, locale,
      traduzida: locale === LOCALE_FONTE || veioDaTraducao, titulo, descricao: dados.description ?? '',
      rotulo: dados.sidebar_label ?? titulo, dados, corpo,
    };
  });
  return paginas;
}

/**
 * "Última atualização": data e autor do último commit de cada arquivo de docs/,
 * numa passada só (`git log --name-only`). Fora de um checkout devolve mapa vazio.
 */
export function historicoDoGit(raiz) {
  const mapa = new Map();
  let saida;
  try {
    saida = execFileSync('git', ['log', '--name-only', '--format=%x00%aI%x01%an', '--', 'docs'], {
      cwd: raiz, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    });
  } catch {
    return mapa;
  }
  for (const bloco of saida.split('\0').slice(1)) {
    const [cab, ...arquivos] = bloco.split('\n');
    const [data, autor] = cab.split('\u0001');
    for (const f of arquivos.filter(Boolean)) if (!mapa.has(f)) mapa.set(f, { data, autor });
  }
  return mapa;
}
