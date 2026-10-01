import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import picomatch from 'picomatch';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — `docmap.mjs` é JS puro, sem tipos.
import { lerDocmap, RAIZ, regrasAcionadas } from './docmap.mjs';

// AT-206: a regra `politica-de-branches` do docmap vigia uma LISTA DE
// PERMITIDOS em `scripts/ci/` — os scripts que são a política —, e não mais
// "tudo menos onze". O que a lista perderia sozinha é o "falha fechado"
// (script de política novo passaria calado); este spec o devolve derivando o
// conjunto do repositório: todo arquivo de `scripts/ci/` que cita
// `branching-policy.md` no DOCBLOCK de abertura, mais o `.spec.ts` dele.

type Regra = { id: string; watch?: string[] };

const ID = 'politica-de-branches';
const docmap = lerDocmap() as { rules: Regra[] };
const regra = docmap.rules.find((r) => r.id === ID);
const dirCi = join(RAIZ, 'scripts/ci');
const arquivosDoCi = readdirSync(dirCi)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => `scripts/ci/${f}`);

const casa = (arquivo: string) =>
  (regra?.watch ?? []).some((g) => picomatch(g, { dot: true })(arquivo));

// O docblock de abertura: as linhas até o primeiro `*/`. É ali que os catorze
// scripts de política dizem "Fonte da política: docs/explanation/branching-policy.md";
// uma MENSAGEM que cita o documento mais abaixo (o `A esteira inteira: …` que
// alguns imprimem) não faz de um script parte da política.
function declaraAPolitica(arquivo: string): boolean {
  const texto = readFileSync(join(RAIZ, arquivo), 'utf8');
  const fim = texto.indexOf('*/');
  if (!texto.trimStart().startsWith('/**') || fim < 0) return false;
  return texto.slice(0, fim).includes('docs/explanation/branching-policy.md');
}

const fontes = arquivosDoCi.filter((a) => !a.endsWith('.spec.ts') && declaraAPolitica(a));
const esperado = new Set([
  ...fontes,
  ...fontes.map((f) => f.replace(/\.ts$/, '.spec.ts')).filter((s) => arquivosDoCi.includes(s)),
]);

describe('docmap — a regra politica-de-branches vigia só a política (AT-206)', () => {
  it('a regra existe e a derivação não é cega', () => {
    expect(regra).toBeDefined();
    // Se o critério parasse de achar os scripts (docblock reescrito, pasta
    // movida), a igualdade abaixo passaria com dois conjuntos vazios.
    expect(fontes).toEqual(expect.arrayContaining(['scripts/ci/pr-police.ts', 'scripts/ci/version.ts']));
    expect(fontes.length).toBeGreaterThanOrEqual(10);
  });

  it('em scripts/ci/, a regra casa EXATAMENTE com os scripts que declaram a política e os specs deles', () => {
    const casados = new Set(arquivosDoCi.filter(casa));
    expect([...casados].sort()).toEqual([...esperado].sort());
  });

  it('mudança real na política ainda dispara a regra — script, spec e workflow', () => {
    for (const alterado of [
      'scripts/ci/pr-police.ts',
      'scripts/ci/archive-branch.ts',
      'scripts/ci/version.spec.ts',
      'scripts/ci/gate.ts',
      '.github/workflows/pr-police.yml',
    ]) {
      const ids = (regrasAcionadas(docmap, [alterado]) as Regra[]).map((r) => r.id);
      expect(ids, alterado).toContain(ID);
    }
  });

  it('spec novo qualquer de scripts/ci/, e os onze que eram excluídos à mão, não disparam', () => {
    for (const alterado of [
      'scripts/ci/um-spec-que-ainda-nao-existe.spec.ts',
      'scripts/ci/coverage-floor.ts',
      'scripts/ci/actions-pinadas.ts',
      'scripts/ci/imagens-pinadas.ts',
      'scripts/ci/auditoria-de-dependencias.ts',
      'scripts/ci/vocabulario-de-eventos-dev.spec.ts',
      'scripts/ci/flags-do-engine-no-compose.spec.ts',
      'scripts/ci/oferta-de-fonte-na-imagem.spec.ts',
      'scripts/ci/marca-de-credencial-do-runner.spec.ts',
      'scripts/ci/checksums-nao-espera-a-matriz.spec.ts',
      'scripts/ci/assets-do-instalador.ts',
      'scripts/ci/teto-ocioso-nos-composes.spec.ts',
    ]) {
      const ids = (regrasAcionadas(docmap, [alterado]) as Regra[]).map((r) => r.id);
      expect(ids, alterado).not.toContain(ID);
    }
  });
});
