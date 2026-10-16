/**
 * Paridade de tradução (AT-550, ADR 0216 itens 5–7).
 *
 * Mede, por locale (`en`, `ru`, `zh-Hans`), quanto da fonte pt-BR (`docs/`,
 * inclusive `docs/reference/**` desde o ADR 0219, menos o próprio relatório e
 * o `openapi.json` — `ehFonteTraduzivel`) tem tradução em
 * `website/i18n/<locale>/docusaurus-plugin-content-docs/current/`, e se cada
 * tradução está EM DIA ou DEFASADA. A procedência é o `traducao_de:` do
 * frontmatter (o commit da fonte que foi traduzido). Defasada = a fonte tem
 * commit MAIS NOVO (pela data de commit, nunca pelo relógio) que o
 * `traducao_de`, ou a fonte tem mudança não commitada, ou o SHA não existe.
 * Assim o `--check` é determinístico: antes do commit a fonte alterada já
 * conta como mudada, e depois dele também.
 *
 * Na interface, compara as chaves de cada namespace de
 * `apps/web/src/locales/<l>/` contra o pt-BR, e cobra as formas de plural de
 * `Intl.PluralRules` de cada locale para toda chave que é plural no pt-BR.
 *
 * O núcleo é PURO (recebe leituras injetadas) para ser provado por mutação no
 * spec ao lado; `medirDoRepositorio` é a única função que toca disco e git.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const LOCALES = ['en', 'ru', 'zh-Hans'];
export const LOCALE_FONTE = 'pt-BR';
const SUFIXOS_DE_PLURAL = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** Lê `traducao_de:` do frontmatter; `null` sem frontmatter ou sem o campo. */
export function traducaoDe(texto) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(texto);
  if (!m) return null;
  const c = /^traducao_de:\s*["']?([0-9a-f]{7,40})["']?\s*$/m.exec(m[1]);
  return c ? c[1] : null;
}

/**
 * Classifica UMA página traduzida. `fonte` = { data: ISO | null, suja: bool }
 * (data do último commit da fonte; `suja` = mudança não commitada).
 * `commitDe(sha)` devolve a data ISO do commit, ou `null` se não existe.
 */
export function classificar(textoTraduzido, fonte, commitDe) {
  const sha = traducaoDe(textoTraduzido);
  if (sha === null) return { estado: 'sem-procedencia', sha: null, data: null };
  const data = commitDe(sha);
  if (data === null) return { estado: 'defasada', sha, data: null };
  if (fonte.suja || (fonte.data !== null && Date.parse(fonte.data) > Date.parse(data))) {
    return { estado: 'defasada', sha, data };
  }
  return { estado: 'em-dia', sha, data };
}

/**
 * Mede a documentação. `fontes`: Map rel → { chars, data, suja };
 * `traducoes`: { [locale]: Map rel → texto }.
 */
export function medirDocs(fontes, traducoes, commitDe) {
  const totalChars = [...fontes.values()].reduce((n, f) => n + f.chars, 0);
  const porLocale = {};
  for (const locale of LOCALES) {
    const mapa = traducoes[locale] ?? new Map();
    const r = {
      paginas: fontes.size,
      traduzidas: 0,
      chars: totalChars,
      charsTraduzidos: 0,
      emDia: [],
      defasadas: [],
      semProcedencia: [],
      ausentes: [],
      orfas: [],
      paginasDetalhe: {},
    };
    for (const [rel, fonte] of [...fontes].sort(([a], [b]) => a.localeCompare(b))) {
      const texto = mapa.get(rel);
      if (texto === undefined) {
        r.ausentes.push(rel);
        continue;
      }
      r.traduzidas++;
      r.charsTraduzidos += fonte.chars;
      const c = classificar(texto, fonte, commitDe);
      if (c.estado === 'em-dia') r.emDia.push(rel);
      else if (c.estado === 'defasada') r.defasadas.push(rel);
      else r.semProcedencia.push(rel);
      r.paginasDetalhe[rel] = {
        estado: c.estado,
        traducaoDe: c.sha,
        data: c.data ? c.data.slice(0, 10) : null,
      };
    }
    for (const rel of [...mapa.keys()].sort()) if (!fontes.has(rel)) r.orfas.push(rel);
    porLocale[locale] = r;
  }
  return porLocale;
}

/** Achata um JSON de namespace em chaves `a.b.c`. */
export function achatar(obj, prefixo = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const chave = prefixo ? `${prefixo}.${k}` : k;
    if (v !== null && typeof v === 'object') out.push(...achatar(v, chave));
    else out.push(chave);
  }
  return out;
}

/** Bases plurais do pt-BR: chave `x_one` → base `x`. */
function basesPlurais(chaves) {
  const bases = new Set();
  for (const k of chaves) {
    const m = new RegExp(`^(.*)_(${SUFIXOS_DE_PLURAL.join('|')})$`).exec(k);
    if (m) bases.add(m[1]);
  }
  return bases;
}

/**
 * Mede a interface. `namespaces`: { [locale]: { [ns]: objeto } | undefined }.
 * Chave plural não conta como chave simples: a paridade de plural é cobrada
 * pelas categorias de `Intl.PluralRules` do locale, que diferem do pt-BR.
 */
export function medirInterface(namespaces) {
  const fonte = namespaces[LOCALE_FONTE] ?? {};
  const out = {};
  for (const locale of LOCALES) {
    const categorias = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    const doLocale = namespaces[locale];
    const r = { existe: doLocale !== undefined, categorias, namespaces: {}, chaves: 0, presentes: 0, pluraisIncompletos: [] };
    for (const ns of Object.keys(fonte).sort()) {
      const chavesFonte = achatar(fonte[ns]);
      const bases = basesPlurais(chavesFonte);
      const simples = chavesFonte.filter((k) => ![...bases].some((b) => k.startsWith(`${b}_`) && SUFIXOS_DE_PLURAL.includes(k.slice(b.length + 1))));
      const alvo = new Set(doLocale?.[ns] ? achatar(doLocale[ns]) : []);
      const esperadas = [...simples, ...[...bases].flatMap((b) => categorias.map((c) => `${b}_${c}`))];
      const presentes = esperadas.filter((k) => alvo.has(k)).length;
      for (const b of bases) {
        const faltam = categorias.filter((c) => !alvo.has(`${b}_${c}`));
        if (alvo.size > 0 && faltam.length > 0) r.pluraisIncompletos.push(`${ns}:${b} (${faltam.join(', ')})`);
      }
      r.namespaces[ns] = { esperadas: esperadas.length, presentes };
      r.chaves += esperadas.length;
      r.presentes += presentes;
    }
    out[locale] = r;
  }
  return out;
}

const pct = (a, b) => (b === 0 ? '—' : `${((100 * a) / b).toFixed(1)}%`);

/** O relatório Markdown (determinístico: só depende das medições). */
export function relatorio(docs, ui, aviso) {
  const l = [];
  l.push('---', 'id: paridade-de-traducao', 'title: Paridade de tradução', '---', '', aviso, '');
  l.push('# Paridade de tradução', '');
  l.push(
    'A fonte é o pt-BR em `docs/` (ADR 0216), inclusive `docs/reference/**` (ADR 0219); só esta página fica fora. ' +
      'Uma tradução está **em dia** quando o `traducao_de:` do frontmatter é um commit tão ou mais novo ' +
      'que o último commit da fonte, e **defasada** quando a fonte mudou depois. Sem o campo, ela conta ' +
      'como **sem procedência**. As regras estão em [Localização](../explanation/localizacao.md).',
    '',
  );
  l.push('## Documentação', '');
  l.push('| locale | páginas traduzidas | caracteres traduzidos | em dia | defasadas | sem procedência | ausentes | órfãs |');
  l.push('|---|---|---|---|---|---|---|---|');
  for (const loc of LOCALES) {
    const r = docs[loc];
    l.push(
      `| \`${loc}\` | ${r.traduzidas} de ${r.paginas} (${pct(r.traduzidas, r.paginas)}) | ` +
        `${pct(r.charsTraduzidos, r.chars)} de ${r.chars.toLocaleString('pt-BR')} | ${r.emDia.length} | ${r.defasadas.length} | ` +
        `${r.semProcedencia.length} | ${r.ausentes.length} | ${r.orfas.length} |`,
    );
  }
  l.push('');
  l.push('> **TODO(humano):** revisão nativa por idioma — quem revisou e quando. Ainda não há revisão nativa registrada.', '');
  for (const loc of LOCALES) {
    const r = docs[loc];
    if (r.defasadas.length === 0) continue;
    l.push(`### Defasadas em \`${loc}\``, '');
    for (const rel of r.defasadas) l.push(`- \`${rel}\` (tradução de ${r.paginasDetalhe[rel].data ?? 'commit inexistente'})`);
    l.push('');
  }
  l.push('## Interface', '');
  l.push('Chaves de `apps/web/src/locales/<locale>/` contra o pt-BR. Chave plural conta uma vez por forma de `Intl.PluralRules` do locale.', '');
  l.push('| locale | formas de plural | chaves presentes | plurais incompletos |');
  l.push('|---|---|---|---|');
  for (const loc of LOCALES) {
    const r = ui[loc];
    l.push(
      `| \`${loc}\` | ${r.categorias.join(', ')} | ${r.existe ? `${r.presentes} de ${r.chaves} (${pct(r.presentes, r.chaves)})` : `catálogo ausente (0 de ${r.chaves})`} | ${r.pluraisIncompletos.length} |`,
    );
  }
  l.push('');
  for (const loc of LOCALES) {
    const r = ui[loc];
    if (!r.existe) continue;
    const faltando = Object.entries(r.namespaces).filter(([, n]) => n.presentes < n.esperadas);
    if (faltando.length === 0) continue;
    l.push(`### Namespaces incompletos em \`${loc}\``, '');
    for (const [ns, n] of faltando) l.push(`- \`${ns}\`: ${n.presentes} de ${n.esperadas}`);
    l.push('');
  }
  return l.join('\n');
}

/** O JSON que a faixa do site lê: só o que ela precisa, por locale e página. */
export function dadosDaFaixa(docs) {
  const out = {};
  for (const loc of LOCALES) {
    out[loc] = {};
    for (const [rel, d] of Object.entries(docs[loc].paginasDetalhe)) {
      out[loc][rel] = { defasada: d.estado === 'defasada', data: d.data };
    }
  }
  return JSON.stringify(out, null, 2) + '\n';
}

// ------------------------------------------------------------ leitura real

function listar(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return listar(p, base);
    return /\.mdx?$/.test(n) ? [relative(base, p)] : [];
  });
}

/** ADR 0219: `reference/` entra; o relatório (D4) e o spec OpenAPI não. */
export const ehFonteTraduzivel = (rel) => !/^reference\/(paridade-de-traducao\.mdx?|openapi\.json)$/.test(rel);

export function medirDoRepositorio(raiz) {
  const git = (...a) => execFileSync('git', a, { cwd: raiz, encoding: 'utf8' }).trim();
  const sujas = new Set(
    git('status', '--porcelain', '--', 'docs')
      .split('\n')
      .filter(Boolean)
      .map((l) => relative('docs', l.slice(3))),
  );
  const fontes = new Map();
  for (const rel of listar(join(raiz, 'docs'))) {
    if (!ehFonteTraduzivel(rel)) continue;
    const data = git('log', '-1', '--format=%cI', '--', `docs/${rel}`) || null;
    fontes.set(rel, { chars: readFileSync(join(raiz, 'docs', rel), 'utf8').length, data, suja: sujas.has(rel) });
  }
  const traducoes = {};
  for (const loc of LOCALES) {
    const dir = join(raiz, 'website/i18n', loc, 'docusaurus-plugin-content-docs/current');
    traducoes[loc] = new Map(listar(dir).map((rel) => [rel, readFileSync(join(dir, rel), 'utf8')]));
  }
  const cache = new Map();
  const commitDe = (sha) => {
    if (!cache.has(sha)) {
      try {
        cache.set(sha, git('show', '-s', '--format=%cI', `${sha}^{commit}`) || null);
      } catch {
        cache.set(sha, null);
      }
    }
    return cache.get(sha);
  };
  const namespaces = {};
  for (const loc of [LOCALE_FONTE, ...LOCALES]) {
    const dir = join(raiz, 'apps/web/src/locales', loc);
    if (!existsSync(dir)) continue;
    namespaces[loc] = Object.fromEntries(
      readdirSync(dir)
        .filter((n) => n.endsWith('.json'))
        .map((n) => [n.slice(0, -5), JSON.parse(readFileSync(join(dir, n), 'utf8'))]),
    );
  }
  return { docs: medirDocs(fontes, traducoes, commitDe), ui: medirInterface(namespaces) };
}
