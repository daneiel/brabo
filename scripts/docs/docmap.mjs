// Leitura e validação dos `.docmap.yml` — o mapa "mudança de código →
// documentação que precisa ser revisada". Compartilhado pelo validador de
// globs e pelo drift check. Desde a AT-693 há UM por raiz de doc
// (`docs/.docmap.yml` do agregador e `<raiz>/docs/.docmap.yml`), lidos juntos;
// o id de regra é único na UNIÃO. Este módulo NÃO importa `raizes-de-doc` (que
// importa `fontes`, que importa este: ciclo) — as raízes chegam por parâmetro.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import picomatch from 'picomatch';
import { parse } from 'yaml';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const CAMINHO_DOCMAP = join(RAIZ, 'docs/.docmap.yml');

const ARQUIVO_DE_DOCMAP = /(^|\/)docs\/\.docmap\.yml$/;

/**
 * Lê e UNE os docmaps. `arquivos`: o universo versionado (padrão `git ls-files`
 * em `base`); `raizes`: `[{ nome, raiz }]`, só necessário com `raiz` (a regra
 * daquela raiz apenas, `--raiz <nome>`).
 */
export function lerDocmap({ base = RAIZ, arquivos = arquivosVersionados(base), raiz, raizes } = {}) {
  let mapas = arquivos.filter((a) => ARQUIVO_DE_DOCMAP.test(a)).sort((x, y) => (x === 'docs/.docmap.yml' ? -1 : y === 'docs/.docmap.yml' ? 1 : x.localeCompare(y)));
  if (raiz !== undefined) {
    const alvo = raizes?.find((r) => r.nome === raiz);
    if (!alvo) throw new Error(`raiz de doc desconhecida: "${raiz}"`);
    mapas = mapas.filter((m) => m === `${alvo.raiz}/.docmap.yml`);
  }
  if (!mapas.length) throw new Error('nenhum .docmap.yml encontrado');
  const rules = [];
  for (const m of mapas) {
    const bruto = parse(readFileSync(join(base, m), 'utf8'));
    if (!Array.isArray(bruto?.rules)) throw new Error(`${m}: campo \`rules\` ausente ou não é lista`);
    rules.push(...bruto.rules);
  }
  return { rules };
}

/** Todos os arquivos versionados, que é o universo que os globs descrevem. */
export function arquivosVersionados(base = RAIZ) {
  return execFileSync('git', ['ls-files'], { cwd: base, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

/**
 * Um glob que não casa com NADA é regra morta: nunca dispara, e passa a
 * impressão de cobertura que não existe. Este é o erro mais silencioso que um
 * docmap pode ter, então ele é verificado no CI.
 */
export function validar(docmap, arquivos, base = RAIZ) {
  const problemas = [];
  const ids = new Set();

  for (const regra of docmap.rules) {
    if (!regra.id) problemas.push({ tipo: 'sem-id', regra: JSON.stringify(regra) });
    if (ids.has(regra.id)) problemas.push({ tipo: 'id-duplicado', regra: regra.id });
    ids.add(regra.id);

    for (const glob of regra.watch ?? []) {
      const casa = picomatch(glob, { dot: true });
      if (!arquivos.some((a) => casa(a))) {
        problemas.push({ tipo: 'glob-morto', regra: regra.id, glob });
      }
    }

    // `requires_adr` não aponta para documento específico; as demais precisam.
    // `docs_alternativos` conta como cobertura: uma regra que exige QUALQUER
    // um de N documentos não está sem docs (ver a disjunção em drift.mjs).
    const documentos = [...(regra.docs ?? []), ...(regra.docs_alternativos ?? [])];

    if (!regra.requires_adr && documentos.length === 0) {
      problemas.push({ tipo: 'sem-docs', regra: regra.id });
    }

    // Vale para as DUAS listas: caminho que não existe é o mesmo erro
    // silencioso do glob morto, e uma alternativa com typo nunca poderia
    // satisfazer a regra — ela ficaria impossível de cumprir sem ninguém ver.
    for (const doc of documentos) {
      if (!existsSync(join(base, doc))) {
        problemas.push({ tipo: 'doc-inexistente', regra: regra.id, doc });
      }
    }

    if (regra.severity && !['block', 'warn'].includes(regra.severity)) {
      problemas.push({ tipo: 'severity-invalida', regra: regra.id, valor: regra.severity });
    }
  }

  return problemas;
}

/** Regras acionadas por uma lista de arquivos alterados. */
export function regrasAcionadas(docmap, alterados) {
  return docmap.rules.filter((regra) =>
    (regra.watch ?? []).some((glob) => {
      const casa = picomatch(glob, { dot: true });
      return alterados.some((a) => casa(a));
    }),
  );
}

async function principal() {
  const i = process.argv.indexOf('--raiz');
  const raiz = i > 0 ? process.argv[i + 1] : undefined;
  const raizes = raiz ? (await import('./raizes-de-doc.mjs')).lerRaizesDeDoc() : undefined;
  const docmap = lerDocmap({ raiz, raizes });
  const problemas = validar(docmap, arquivosVersionados());

  if (problemas.length === 0) {
    console.log(`[docmap] ok — ${docmap.rules.length} regras, todos os globs vivos`);
    process.exit(0);
  }

  console.error(`[docmap] ${problemas.length} problema(s):\n`);
  for (const p of problemas) {
    if (p.tipo === 'glob-morto') {
      console.error(`  REGRA MORTA  ${p.regra}: o glob "${p.glob}" não casa com nenhum arquivo`);
    } else if (p.tipo === 'doc-inexistente') {
      console.error(`  DOC AUSENTE  ${p.regra}: "${p.doc}" não existe`);
    } else {
      console.error(`  ${p.tipo.toUpperCase()}  ${p.regra ?? ''} ${p.glob ?? p.doc ?? p.valor ?? ''}`);
    }
  }
  console.error('\nGlob que não casa com nada nunca dispara — a regra existe no papel e não no CI.');
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) principal();
