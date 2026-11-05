/**
 * Migração única para as raízes de doc (AT-693, EP-033): move os arquivos que
 * mudam de raiz, reparte as RNs por hospedeiro (a raiz do PRIMEIRO `caminho:N`),
 * congela `custo.md`/`autenticacao.md` em stubs, parte o docmap e reescreve só
 * os links ligados a RN. Links entre páginas comuns ficam como estão: valem na
 * árvore de UNIÃO (o caminho do site), não no disco.
 *
 *   node scripts/docs/migrar-para-raizes.mjs [--lista f.json]   # migra (idempotente)
 *   node scripts/docs/migrar-para-raizes.mjs --carimbar <sha> [--lista f.json]
 *
 * Roda uma vez, pelo condutor, depois que as outras lanes entrarem.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { medirDoRepositorio } from './paridade-de-traducao.mjs';
import { RAIZES_DE_DOC } from './raizes-de-doc.mjs';

const LOCALES = ['pt-BR', 'en', 'ru', 'zh-Hans'];
const ARQUIVOS_DE_RN = ['business-rules.md', 'business-rules/custo.md', 'business-rules/autenticacao.md'];
const STUBS = ['business-rules/custo.md', 'business-rules/autenticacao.md'];

// ------------------------------------------------------------------ mapa
const POR_RAIZ = {
  api: [
    'security-surface.md',
    'reference/permissions.md',
    'reference/git-providers.md',
    'reference/llm-providers.md',
    'reference/artifacts.md',
    'reference/openapi.json',
    'explanation/aceite-providers.md',
  ],
  web: ['explanation/tanstack-ai.md'],
  infra: ['runbook.md', 'explanation/observability.md'],
  ci: ['explanation/branching-policy.md', 'explanation/cadeia-de-suprimentos-do-ci.md', 'reference/rulesets.md'],
};

/** velho→novo, caminhos do repositório. Tradução: `docs/i18n/<l>/<rel>`. */
export const MAPA = (() => {
  const m = {};
  for (const [raiz, rels] of Object.entries(POR_RAIZ)) {
    for (const rel of rels) {
      m[`docs/${rel}`] = `${RAIZES_DE_DOC[raiz]}/${rel}`;
      if (rel.endsWith('.md')) {
        for (const l of LOCALES) m[`docs/i18n/${l}/${rel}`] = `${RAIZES_DE_DOC[raiz]}/i18n/${l}/${rel}`;
      }
    }
  }
  for (const l of LOCALES) m[`docs/i18n/${l}/openapi-textos.json`] = `${RAIZES_DE_DOC.api}/i18n/${l}/openapi-textos.json`;
  return m;
})();

// ------------------------------------------------------------ hospedeiro
const PREFIXOS = [
  [/^apps\/api\//, 'api'],
  [/^apps\/engine\//, 'engine'],
  [/^(apps\/web|design|\.design-sync)\//, 'web'],
  [/^apps\/runner\//, 'runner'],
  [/^apps\/broker\//, 'broker'],
  [/^packages\//, 'contracts'],
  [/^(deploy|docker|k8s|scripts\/dev|\.release)\//, 'infra'],
  [/^(Makefile|docker-bake\.hcl|\.env\.example)$/, 'infra'],
  [/^(scripts\/ci|\.github)\//, 'ci'],
];

/** Raiz de doc do repositório a que um caminho pertence (padrão `produto`). */
export function raizDoCaminho(caminho) {
  for (const [re, raiz] of PREFIXOS) if (re.test(caminho)) return raiz;
  return 'produto';
}

const REF_COM_LINHA = /`([\w./@-]*\/[\w./@-]+|install\.sh|Makefile):\d+/;
const CAMINHO_CITADO = /`((?:apps|packages|deploy|docker|k8s|scripts|\.github|docs)\/[\w./@-]+|install\.sh|Makefile)[`:]/;

/** Raiz do PRIMEIRO `caminho:N`; sem ele, do primeiro caminho citado; senão `produto`. */
export function hospedeiroDaRn(corpo) {
  const m = REF_COM_LINHA.exec(corpo) ?? CAMINHO_CITADO.exec(corpo);
  return m ? raizDoCaminho(m[1]) : 'produto';
}

// ---------------------------------------------------------------- partição
const CAB_RN = /^###\s+RN-(\d+)\b/;
const CAB_ALTO = /^#{1,3}\s/;
const CAB_SECAO = /^##\s/;

/** Texto antes da primeira seção `##` ou RN (o que o índice/stub conserva), sem o frontmatter. */
export function preambulo(texto) {
  const corpo = texto.replace(/^---\n[\s\S]*?\n---\n/, '');
  const linhas = corpo.split('\n');
  const i = linhas.findIndex((l) => CAB_SECAO.test(l) || CAB_RN.test(l));
  return linhas.slice(0, i < 0 ? linhas.length : i).join('\n').trim();
}

/**
 * Quebra um arquivo de RN em blocos `{n, texto, secao, prefixo}`: `texto` vai do
 * `### RN-` ao próximo `##`/`###`; `secao` é o último `## ` visto; `prefixo` é a
 * prosa solta entre o bloco anterior e este (sem a linha de `secao`).
 */
export function blocosDeRn(texto) {
  const linhas = texto.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
  const iniPre = linhas.findIndex((l) => CAB_SECAO.test(l) || CAB_RN.test(l));
  const blocos = [];
  let atual = null;
  let secao = null;
  let usada = false;
  let solto = [];
  for (const l of iniPre < 0 ? [] : linhas.slice(iniPre)) {
    const m = CAB_RN.exec(l);
    if (m) {
      atual = { n: Number(m[1]), linhas: [l], secao, prefixo: solto.join('\n').trim() };
      blocos.push(atual);
      usada = true;
      solto = [];
    } else if (CAB_ALTO.test(l)) {
      atual = null;
      if (CAB_SECAO.test(l)) {
        if (secao && !usada) solto.push(secao); // seção sem RN: o título fica na prosa
        secao = l;
        usada = false;
      } else solto.push(l);
    } else if (atual) atual.linhas.push(l);
    else solto.push(l);
  }
  return blocos.map((b) => ({ n: b.n, texto: b.linhas.join('\n').replace(/\s+$/, ''), secao: b.secao, prefixo: b.prefixo }));
}

/**
 * @param {{caminho:string, texto:string}[]} arquivos os arquivos de RN de UM locale
 * @param {Map<number,string>} [mapa] número→raiz já decidido (a fonte pt-BR); RN fora dele cai no hospedeiro
 * @returns {{porRaiz: Record<string,{n:number,texto:string,de:string}[]>, mapa: Map<number,string>}}
 */
export function particionarRns(arquivos, mapa = new Map()) {
  const decidido = new Map(mapa);
  const porRaiz = {};
  for (const a of arquivos) {
    for (const b of blocosDeRn(a.texto)) {
      if (!decidido.has(b.n)) decidido.set(b.n, hospedeiroDaRn(b.texto));
      (porRaiz[decidido.get(b.n)] ??= []).push({ ...b, de: a.caminho });
    }
  }
  for (const l of Object.values(porRaiz)) l.sort((x, y) => x.n - y.n);
  return { porRaiz, mapa: decidido };
}

// ------------------------------------------------------------------ links
const LINK = /(?<!!)\[([^\]]*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g;
const EXTERNO = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i;

/**
 * Reescreve UM href. `de`/`para` são caminhos da árvore de união (relativos a
 * `docs/`, sem locale) do arquivo que tem o link ANTES e DEPOIS; `hospedeiroDe(n)`
 * dá a raiz da RN. Só muda o que é ligado a RN ou o que a profundidade do
 * arquivo que contém o link obriga.
 */
export function reescreverLink(link, de, para, hospedeiroDe) {
  if (EXTERNO.test(link)) return link;
  const i = link.indexOf('#');
  const caminho = i < 0 ? link : link.slice(0, i);
  const frag = i < 0 ? undefined : link.slice(i + 1);
  const rn = /^rn-(\d+)$/.exec(frag ?? '');
  let alvo = caminho ? posix.normalize(posix.join(posix.dirname(de), caminho)) : de;
  if (caminho && !caminho.endsWith('.md')) return link; // imagem/json/etc.: não muda
  if (rn) {
    const pagina = ARQUIVOS_DE_RN.includes(alvo) || alvo.startsWith('business-rules/');
    if (pagina || !caminho) {
      const host = hospedeiroDe(Number(rn[1]));
      if (host) alvo = `business-rules/${host}.md`;
    }
  }
  if (!rn && (de === para || !caminho)) return link;
  if (!caminho && alvo === para) return link;
  const rel = alvo === para ? '' : posix.relative(posix.dirname(para), alvo);
  return `${rel}${frag !== undefined ? `#${frag}` : ''}`;
}

/** Aplica `reescreverLink` a todo link `[t](href)` de um texto (imagens ficam). */
export function reescreverLinks(texto, de, para, hospedeiroDe) {
  let trocados = 0;
  const saida = texto.replace(LINK, (todo, t, href, titulo) => {
    const novo = reescreverLink(href, de, para, hospedeiroDe);
    if (novo === href) return todo;
    trocados++;
    return `[${t}](${novo}${titulo})`;
  });
  return { texto: saida, trocados };
}

/** Literais `docs/<rel>` de caminhos que mudaram, em arquivo fora de docs/ — só LISTA. */
export function reescreverLiteral(texto, mapa = MAPA) {
  const achados = [];
  texto.split('\n').forEach((linha, i) => {
    for (const velho of Object.keys(mapa)) {
      if (linha.includes(velho)) achados.push({ linha: i + 1, de: velho, para: mapa[velho] });
    }
  });
  return achados;
}

/**
 * Corpo de uma página hospedeira: as RNs em ordem, com o `## seção` de origem
 * repetido só quando muda e a prosa solta que as precedia; links reescritos.
 */
export function montarCorpo(rns, raiz, hospedeiroDe) {
  let trocados = 0;
  let anterior = null;
  const partes = rns.map((r) => {
    const pedacos = [];
    if (r.secao && r.secao !== anterior) pedacos.push(r.secao);
    if (r.prefixo) pedacos.push(r.prefixo);
    pedacos.push(r.texto);
    anterior = r.secao ?? anterior;
    const de = r.de.replace(/^(docs\/)(i18n\/[^/]+\/)?/, '');
    const x = reescreverLinks(pedacos.join('\n\n'), de, `business-rules/${raiz}.md`, hospedeiroDe);
    trocados += x.trocados;
    return x.texto;
  });
  return { texto: partes.join('\n\n'), trocados };
}

// ------------------------------------------------------------------ stubs
const NOME = { api: 'API', engine: 'Engine', web: 'Web', runner: 'Runner', broker: 'Broker', contracts: 'Contratos', infra: 'Infra', ci: 'CI', produto: 'Produto' };

/** Corpo do stub congelado: uma linha por RN que morava no arquivo, com a âncora preservada. */
export function gerarStubs(rns, mapa) {
  const linhas = rns
    .slice()
    .sort((a, b) => a - b)
    .map((n) => {
      const id = String(n).padStart(3, '0');
      return `- <a id="rn-${id}"></a>[RN-${id}](./${mapa.get(n) ?? 'produto'}.md#rn-${id})`;
    });
  return `Estas RNs agora moram por área, na página da raiz que as hospeda (\`business-rules/<raiz>.md\`). Esta página está congelada: só preserva as âncoras antigas.\n\n${linhas.join('\n')}\n`;
}

// ----------------------------------------------------------------- docmap
const RAIZ_DE_DOC_DO_CAMINHO = (c) => {
  for (const [nome, dir] of Object.entries(RAIZES_DE_DOC)) if (nome !== 'produto' && c.startsWith(`${dir}/`)) return nome;
  return 'produto';
};

/**
 * Parte o docmap: regra com `watch` e `docs` na mesma raiz (e sem
 * `docs_alternativos`) vai para `<raiz>/docs/.docmap.yml`; o resto fica.
 * Os `docs:` movidos pelo MAPA já saem com o caminho novo.
 */
export function partirDocmap(texto, mapa = MAPA) {
  const novo = texto.replace(/(?<![\w/.])docs\/[\w./-]+/g, (c) => mapa[c] ?? c);
  const linhas = novo.split('\n');
  const ini = linhas.findIndex((l) => /^rules:/.test(l));
  const corpo = linhas.slice(ini + 1);
  // cada regra começa em `  - id:` e leva os comentários colados logo acima
  const marcas = [];
  corpo.forEach((l, i) => {
    if (/^ {2}- id:/.test(l)) {
      let j = i;
      while (j > 0 && /^ {2}#/.test(corpo[j - 1])) j--;
      marcas.push(j);
    }
  });
  const cabeca = [...linhas.slice(0, ini + 1), ...corpo.slice(0, marcas[0] ?? corpo.length)];
  const blocos = marcas.map((m, k) => corpo.slice(m, marcas[k + 1] ?? corpo.length).join('\n').replace(/\s+$/, ''));
  const porRaiz = {};
  const ficam = [];
  for (const b of blocos) {
    const r = parse(b)?.[0] ?? {};
    const rw = new Set((r.watch ?? []).map(raizDoCaminho));
    const rd = new Set((r.docs ?? []).map(RAIZ_DE_DOC_DO_CAMINHO));
    const [w] = rw;
    if (rw.size === 1 && rd.size === 1 && rd.has(w) && w !== 'produto' && !r.docs_alternativos) (porRaiz[w] ??= []).push(b);
    else ficam.push(b);
  }
  const cru = `${cabeca.join('\n').replace(/\s+$/, '')}\n\n${ficam.join('\n\n')}\n`;
  const saida = {};
  for (const [raiz, bs] of Object.entries(porRaiz)) saida[raiz] = `version: 1\n\nrules:\n${bs.join('\n\n')}\n`;
  return { cruzadas: cru, porRaiz: saida };
}

// ------------------------------------------------------------------- main
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 });
const ler = (c) => readFileSync(c, 'utf8');

function frontmatter(texto) {
  const m = /^---\n[\s\S]*?\n---\n/.exec(texto);
  return m ? m[0] : '';
}
function gravar(c, t) {
  mkdirSync(posix.dirname(c), { recursive: true });
  writeFileSync(c, t);
}
/** `<raiz>/docs/[i18n/<l>/]<rel>` → `{raiz, locale, rel}` ou null. */
function decompor(c) {
  for (const [nome, dir] of Object.entries(RAIZES_DE_DOC)) {
    const pre = `${dir}/`;
    const base = nome === 'produto' ? 'docs/' : pre;
    if (!c.startsWith(base)) continue;
    const resto = c.slice(base.length);
    const m = /^i18n\/([^/]+)\/(.*)$/.exec(resto);
    return m && LOCALES.includes(m[1]) ? { raiz: nome, locale: m[1], rel: m[2] } : { raiz: nome, locale: null, rel: resto };
  }
  return null;
}
const dirDeDocs = (raiz) => RAIZES_DE_DOC[raiz];
const caminhoLocale = (raiz, locale, rel) => `${dirDeDocs(raiz)}/${locale && locale !== 'pt-BR' ? `i18n/${locale}/` : ''}${rel}`;
const arqRn = (locale, rel) => caminhoLocale('produto', locale, rel);

export function main(argv = process.argv.slice(2)) {
  const iLista = argv.indexOf('--lista');
  const lista = iLista >= 0 ? argv[iLista + 1] : 'migracao-emdia.json';
  const iCar = argv.indexOf('--carimbar');
  if (iCar >= 0) {
    const sha = argv[iCar + 1];
    const novos = JSON.parse(ler(lista));
    for (const c of novos) {
      const t = ler(c);
      if (/^traducao_de:/m.test(t)) writeFileSync(c, t.replace(/^traducao_de:.*$/m, `traducao_de: ${sha}`));
    }
    console.log(`carimbadas: ${novos.length}`);
    return;
  }

  const relatorio = { movidos: 0, rnPorRaiz: {}, links: 0, literais: [], semBlocos: false };
  const emDia = [];

  // 1. RNs: partição e "em dia" (classificação do relatório de paridade, ANTES dos mv)
  const medido = medirDoRepositorio('.').docs;
  const emDiaRel = Object.fromEntries(LOCALES.filter((l) => l !== 'pt-BR').map((l) => [l, new Set(medido[l].emDia)]));
  const porLocale = {};
  for (const l of LOCALES) {
    porLocale[l] = ARQUIVOS_DE_RN.filter((r) => existsSync(arqRn(l, r))).map((r) => ({ caminho: arqRn(l, r), texto: ler(arqRn(l, r)) }));
  }
  const fonte = particionarRns(porLocale['pt-BR']);
  if (!Object.keys(fonte.porRaiz).length) relatorio.semBlocos = true;
  const rnEmDia = (l) => l !== 'pt-BR' && ARQUIVOS_DE_RN.filter((r) => existsSync(arqRn(l, r))).every((r) => emDiaRel[l].has(r));
  const jaEmDia = Object.fromEntries(LOCALES.map((l) => [l, rnEmDia(l)]));

  // 2. mv dos arquivos de não-RN
  for (const [velho, novo] of Object.entries(MAPA)) {
    if (!existsSync(velho) || existsSync(novo)) continue;
    const m = /^docs\/i18n\/([^/]+)\/(.+\.md)$/.exec(velho);
    if (m && emDiaRel[m[1]]?.has(m[2])) emDia.push(novo);
    mkdirSync(posix.dirname(novo), { recursive: true });
    git('mv', velho, novo);
    relatorio.movidos++;
  }
  const hospedeiroDe = (n) => fonte.mapa.get(n);

  if (!relatorio.semBlocos) {
    for (const l of LOCALES) {
      const { porRaiz } = particionarRns(porLocale[l], fonte.mapa);
      const fm = frontmatter(ler(arqRn(l, 'business-rules/custo.md'))) || frontmatter(ler(arqRn(l, 'business-rules.md')));
      const traducao = (/^traducao_de:.*\n/m.exec(fm) ?? [''])[0];
      for (const [raiz, rns] of Object.entries(porRaiz)) {
        const { texto, trocados } = montarCorpo(rns, raiz, hospedeiroDe);
        relatorio.links += trocados;
        const cab = `---\n${traducao}id: rn-${raiz}\ntitle: 'Regras de negócio — ${NOME[raiz]}'\nsidebar_label: ${NOME[raiz]}\ndescription: 'As RNs hospedadas na raiz ${raiz}.'\nkeywords: [regras de negócio, ${raiz}]\n---\n\n# ${NOME[raiz]}\n\n`;
        const dest = caminhoLocale(raiz, l, `business-rules/${raiz}.md`);
        gravar(dest, `${cab}${texto}\n`);
        if (jaEmDia[l]) emDia.push(dest);
        if (l === 'pt-BR') relatorio.rnPorRaiz[raiz] = rns.length;
      }
      // stubs + índice: a prosa de abertura fica, antes do que é gerado/congelado
      const reescrito = (c, rel) => reescreverLinks(preambulo(ler(c)), rel, rel, hospedeiroDe).texto;
      for (const s of STUBS) {
        const c = arqRn(l, s);
        if (!existsSync(c)) continue;
        const rns = blocosDeRn(ler(c)).map((b) => b.n);
        gravar(c, `${frontmatter(ler(c))}\n${reescrito(c, s)}\n\n${gerarStubs(rns, fonte.mapa)}`);
        if (jaEmDia[l]) emDia.push(c);
      }
      const idx = arqRn(l, 'business-rules.md');
      gravar(idx, `${frontmatter(ler(idx))}\n${reescrito(idx, 'business-rules.md')}\n\n<!-- BEGIN:GENERATED:indice-de-rn -->\n<!-- END:GENERATED:indice-de-rn -->\n`);
      if (jaEmDia[l]) emDia.push(idx);
    }
  }

  // 3. docmap
  if (existsSync('docs/.docmap.yml')) {
    const d = partirDocmap(ler('docs/.docmap.yml'));
    for (const [raiz, t] of Object.entries(d.porRaiz)) gravar(`${dirDeDocs(raiz)}/.docmap.yml`, t);
    writeFileSync('docs/.docmap.yml', d.cruzadas);
  }

  // 4. links (RN) em todo .md de toda raiz/locale; idempotente
  for (const c of git('ls-files', '*.md').split('\n').filter(Boolean)) {
    const p = decompor(c);
    if (!p || !existsSync(c) || p.rel === 'business-rules.md' || p.rel.startsWith('business-rules/')) continue; // páginas de RN já saem reescritas
    const r = reescreverLinks(ler(c), p.rel, p.rel, hospedeiroDe);
    if (r.trocados) {
      writeFileSync(c, r.texto);
      relatorio.links += r.trocados;
    }
  }

  // 5. literais fora de docs/ (só relatório)
  for (const c of git('ls-files').split('\n').filter((f) => f && !f.startsWith('docs/') && !/\.(png|jpe?g|gif|ico|woff2?|lock|zip|gz)$/.test(f))) {
    let t;
    try {
      t = ler(c);
    } catch {
      continue;
    }
    for (const a of reescreverLiteral(t)) relatorio.literais.push({ arquivo: c, ...a });
  }

  writeFileSync(lista, JSON.stringify(emDia, null, 2));
  console.log(JSON.stringify({ ...relatorio, literais: relatorio.literais.length, emDia: emDia.length }, null, 2));
  writeFileSync(`${lista}.literais.json`, JSON.stringify(relatorio.literais, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
