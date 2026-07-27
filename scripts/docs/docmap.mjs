// Leitura e validação do docs/.docmap.yml — o mapa "mudança de código →
// documentação que precisa ser revisada". Compartilhado pelo validador de
// globs e pelo drift check.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import picomatch from 'picomatch';
import { parse } from 'yaml';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const CAMINHO_DOCMAP = join(RAIZ, 'docs/.docmap.yml');

export function lerDocmap() {
  const bruto = parse(readFileSync(CAMINHO_DOCMAP, 'utf8'));
  if (!Array.isArray(bruto?.rules)) {
    throw new Error('docs/.docmap.yml: campo `rules` ausente ou não é lista');
  }
  return bruto;
}

/** Todos os arquivos versionados, que é o universo que os globs descrevem. */
export function arquivosVersionados() {
  return execFileSync('git', ['ls-files'], { cwd: RAIZ, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

/**
 * Um glob que não casa com NADA é regra morta: nunca dispara, e passa a
 * impressão de cobertura que não existe. Este é o erro mais silencioso que um
 * docmap pode ter, então ele é verificado no CI.
 */
export function validar(docmap, arquivos) {
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
    if (!regra.requires_adr && (regra.docs ?? []).length === 0) {
      problemas.push({ tipo: 'sem-docs', regra: regra.id });
    }

    for (const doc of regra.docs ?? []) {
      if (!existsSync(join(RAIZ, doc))) {
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const docmap = lerDocmap();
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
