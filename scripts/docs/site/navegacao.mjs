/**
 * Barra lateral do site (AT-662, ADR 0253): porte de `website/sidebars.ts`.
 *
 *   construirNavegacao({ raiz, repo, rotulos }) -> Item[]
 *   listaPlana(itens) -> [{ slug, rotulo }]    -- ordem de leitura (anterior/próximo)
 *
 *   Item = { tipo: 'categoria', rotulo, colapsada, slug?, itens }   -- `slug` = página que a categoria abre
 *        | { tipo: 'pagina',    slug, rotulo? }                      -- sem `rotulo`, vale o da página
 *        | { tipo: 'rota',      slug, rotulo }                       -- página gerada fora do Markdown (a da API, A3)
 *        | { tipo: 'link',      rotulo, href }                       -- URL externa
 *
 * `slug` é o de `paginas.mjs` (`adr/index.md` -> `adr`). Os rótulos estão em
 * pt-BR; `rotulos` (mapa pt-BR -> texto do locale, de `lerRotulosDaBarra`) é
 * aplicado aqui, e o layout (A2) nunca traduz de novo.
 * Os ADRs agrupados por tema são DERIVADOS de `docs/adr/temas.yml`; parse que se
 * perdeu LANÇA, como o `sidebars.ts` fazia.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CAMINHO_DAS_TRADUCOES, raizesExistentes } from './paginas.mjs';

export function adrsPorTema(raiz) {
  const dir = path.join(raiz, 'docs/adr');
  const yml = readFileSync(path.join(dir, 'temas.yml'), 'utf8');
  const temas = [...yml.matchAll(/^\s+- id: (\S+)\n\s+titulo: (.+)$/gm)].map((m) => ({ id: m[1], titulo: m[2].trim() }));
  const temaDe = new Map([...yml.matchAll(/^\s+"(\d{4})": (\S+)\s*$/gm)].map((m) => [m[1], m[2]]));
  const grupos = new Map([...temas.map((t) => [t.id, []]), ['', []]]);
  for (const arq of readdirSync(dir).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort()) {
    (grupos.get(temaDe.get(arq.slice(0, 4)) ?? '') ?? grupos.get('')).push(`adr/${arq.slice(0, -3)}`);
  }
  const semTema = grupos.get('');
  if (!temas.length || !temaDe.size || semTema.length) {
    throw new Error(`navegacao: o parse de docs/adr/temas.yml se perdeu (${temas.length} temas, ${temaDe.size} ADRs mapeados, sem tema: ${semTema.join(', ') || 'nenhum'}).`);
  }
  return temas.map((t) => ({ rotulo: t.titulo, itens: grupos.get(t.id) })).filter((c) => c.itens.length);
}

/** Rótulos da barra traduzidos (`current.json` do locale), como mapa pt-BR -> texto. */
export function lerRotulosDaBarra(raiz, locale) {
  const arq = path.join(raiz, CAMINHO_DAS_TRADUCOES(locale), 'current.json');
  const mapa = {};
  try {
    for (const [k, v] of Object.entries(JSON.parse(readFileSync(arq, 'utf8')))) {
      const m = /^sidebar\.docs\.(?:category|link)\.(.+)$/.exec(k);
      if (m) mapa[m[1]] = v.message;
    }
  } catch { /* locale sem catálogo: cai nos rótulos pt-BR */ }
  return mapa;
}

/** Índice `business-rules` + uma página por `business-rules/<x>.md` de cada raiz; custo e autenticação primeiro (ordem histórica), o resto alfabético. */
export function slugsDeRegras(raiz, raizesDeDoc) {
  const nomes = new Set();
  for (const rd of raizesExistentes(raiz, raizesDeDoc)) {
    try {
      for (const f of readdirSync(path.join(raiz, rd, 'business-rules'))) if (f.endsWith('.md')) nomes.add(f.slice(0, -3));
    } catch { /* raiz sem regras */ }
  }
  const fixos = ['custo', 'autenticacao'];
  const resto = [...nomes].filter((n) => !fixos.includes(n)).sort();
  return ['business-rules', ...[...fixos.filter((n) => nomes.has(n)), ...resto].map((n) => `business-rules/${n}`)];
}

export function construirNavegacao({ raiz, repo, rotulos = {}, raizesDeDoc }) {
  const t = (r) => rotulos[r] ?? r;
  const cat = (rotulo, itens, extra = {}) => ({ tipo: 'categoria', rotulo: t(rotulo), colapsada: false, itens, ...extra });
  const pg = (slug, rotulo) => (rotulo ? { tipo: 'pagina', slug, rotulo: t(rotulo) } : { tipo: 'pagina', slug });
  const pgs = (...slugs) => slugs.map((s) => pg(s));
  const link = (rotulo, arq) => ({ tipo: 'link', rotulo: t(rotulo), href: `https://github.com/${repo}/blob/dev/${arq}` });
  return [
    cat('🚀 Comece aqui', pgs('', 'getting-started', 'tutorials/from-zero-to-deliverable', 'tutorials/interface-antes-e-depois-shadcn')),
    cat('🏗️ Arquitetura', [
      pg('architecture'),
      cat('Decisões (ADR)', adrsPorTema(raiz).map((c) => ({ tipo: 'categoria', rotulo: c.rotulo, colapsada: true, itens: c.itens.map((s) => pg(s)) })), { slug: 'adr' }),
    ]),
    cat('📐 Regras', pgs(...slugsDeRegras(raiz, raizesDeDoc))),
    cat('📖 Referência', [
      pg('reference/configuration', 'Configuração'), pg('reference/events', 'Eventos'), pg('reference/permissions', 'Permissões'),
      pg('reference/artifacts', 'Artefatos'), pg('reference/git-providers', 'Provedores de git'), pg('reference/internal-api', 'API interna'),
      pg('reference/scripts', 'Scripts e comandos'), pg('reference/rulesets', 'Rulesets do repositório'),
      pg('reference/paridade-de-traducao', 'Paridade de tradução'), pg('reference/brb', 'Registro BRB'),
      pg('security-surface'),
      { tipo: 'rota', slug: 'reference/api', rotulo: t('Referência da API') },
    ]),
    cat('💡 Explicação', [
      cat('Processo e esteira', pgs('explanation/documentation-workflow', 'explanation/branching-policy', 'explanation/cadeia-de-suprimentos-do-ci', 'explanation/gates', 'explanation/observability', 'explanation/modelo-de-time')),
      cat('Validações e medições', pgs('explanation/primeiro-dogfooding', 'explanation/execucao-real-hello-world', 'explanation/achados-execucao-real', 'explanation/validacao-fase-12', 'explanation/validacao-real', 'explanation/aceite-providers', 'explanation/medicao-do-idioma', 'explanation/medicao-do-jev', 'explanation/auditoria-fluxo-vs-codigo', 'explanation/auditoria-visual-rodada-29'), { colapsada: true }),
      cat('História das fases', pgs('explanation/historico-de-fases', 'explanation/fase-28-pasta-do-usuario', 'explanation/fase-29-instalacao-de-uma-linha', 'explanation/fase-30-runner-por-maquina', 'explanation/backlog'), { colapsada: true }),
      cat('Localização', pgs('explanation/localizacao', 'explanation/localizacao-en', 'explanation/localizacao-ru', 'explanation/localizacao-zh-hans'), { colapsada: true }),
      cat('Notas técnicas', pgs('explanation/tanstack-ai'), { colapsada: true }),
    ]),
    cat('🛠️ Operação', pgs('runbook')),
    cat('📚 Vocabulário', pgs('glossary')),
    cat('🤝 Contribuir', [link('Como contribuir', 'CONTRIBUTING.md'), link('Onde pedir ajuda', 'SUPPORT.md'), link('Reportar vulnerabilidade', 'SECURITY.md')]),
  ];
}

export function listaPlana(itens) {
  return itens.flatMap((i) => {
    if (i.tipo === 'categoria') return [...(i.slug != null ? [{ slug: i.slug, rotulo: i.rotulo }] : []), ...listaPlana(i.itens)];
    return i.tipo === 'pagina' || i.tipo === 'rota' ? [{ slug: i.slug, rotulo: i.rotulo }] : [];
  });
}
