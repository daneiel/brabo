import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AFERICOES, FONTES, aferirContagens, naForma } from './contagens-do-codigo.mjs';

// Cada fonte é provada por MUTAÇÃO sobre o repositório de verdade: o teste lê
// os arquivos reais e troca UM trecho em memória — nunca escreve no disco. Se
// o número da prosa não mudar quando o artefato muda, o extrator é o check
// verde que não olha, e é isso que este arquivo existe para reprovar.

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lerReal = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');
const listarReal = (glob: string) =>
  execFileSync('git', ['ls-files', glob], { cwd: RAIZ, encoding: 'utf8' }).split('\n').filter(Boolean);

const EXTERNAS = { schemas: 11, providers: 9 };
const FONTES_EXTERNAS = new Set(['schemasDeArtefato', 'providersDeLlm']);

// `imagens-pinadas.ts` é rodado de verdade uma vez só; as mutações trocam a
// SAÍDA dele, porque o que se testa aqui é a leitura do número.
const SAIDA_IMAGENS = execFileSync(process.execPath, ['scripts/ci/imagens-pinadas.ts'], {
  cwd: RAIZ,
  encoding: 'utf8',
});

type Troca = { arquivo: string; de: string | RegExp; para: string };

function contexto(trocas: Troca[] = [], opcoes: { saidaImagens?: string | null } = {}) {
  return {
    ler: (rel: string) => {
      let texto = lerReal(rel);
      for (const t of trocas.filter((x) => x.arquivo === rel)) {
        const antes = texto;
        texto = texto.replace(t.de, t.para);
        if (texto === antes) throw new Error(`a troca não casou em ${rel}: ${String(t.de)}`);
      }
      return texto;
    },
    listar: listarReal,
    rodarNode: () => (opcoes.saidaImagens === undefined ? SAIDA_IMAGENS : opcoes.saidaImagens),
    externas: EXTERNAS,
  };
}

/** Os estados das aferições de UMA fonte. */
function estadosDa(fonte: string, ctx: ReturnType<typeof contexto>) {
  const resultados = aferirContagens(ctx);
  return AFERICOES.map((a, i) => ({ fonte: a.fonte, r: resultados[i]! }))
    .filter((x) => x.fonte === fonte)
    .map((x) => x.r.estado);
}

describe('contagens derivadas do código (AT-123)', () => {
  it('toda fonte da tabela existe, e toda fonte existente é usada', () => {
    const usadas = new Set(AFERICOES.map((a) => a.fonte));
    for (const a of AFERICOES) expect(FONTES, a.fonte).toHaveProperty(a.fonte);
    for (const nome of Object.keys(FONTES)) expect(usadas.has(nome), nome).toBe(true);
  });

  it('no repositório de hoje, toda frase diz o que o código conta', () => {
    const resultados = aferirContagens(contexto());
    const naoOk = resultados
      .map((r, i) => ({ ...r, fonte: AFERICOES[i]!.fonte }))
      .filter((r) => !FONTES_EXTERNAS.has(r.fonte) && r.estado !== 'ok');
    expect(naoOk).toEqual([]);
  });

  // Uma mutação por fonte: o ARTEFATO muda, a prosa não — tem que reprovar.
  const mutacoes: Array<[string, Troca]> = [
    ['overridesRaiz', { arquivo: 'pnpm-workspace.yaml', de: /^overrides:\n/m, para: 'overrides:\n  x@<1: 1.0.0\n' }],
    ['overridesWebsite', { arquivo: 'website/pnpm-workspace.yaml', de: /^overrides:\n/m, para: 'overrides:\n  x@<1: 1.0.0\n' }],
    ['goldenSetRagCasos', { arquivo: 'apps/api/scripts/seed-golden-set-rag.ts', de: 'const CASOS: CasoRag[] = [', para: "const CASOS: CasoRag[] = [\n  { id: 'x', query: 'x',\n    expectedPath: 'x' }," }],
    ['goldenSetRagCorpus', { arquivo: 'apps/api/scripts/seed-golden-set-rag.ts', de: 'const ARQUIVOS_CURADOS = [', para: "const ARQUIVOS_CURADOS = [\n  'docs/x.md'," }],
    ['goldenSetRagPiso', { arquivo: 'apps/engine/test/fixtures/golden_set_rag/floor.json', de: '"passRate": 17', para: '"passRate": 16' }],
    ['imagensPublicadas', { arquivo: 'scripts/ci/images-manifest.ts', de: 'export const ALVOS = [', para: "export const ALVOS = ['x-y', " }],
    ['imagensNonRootNoSmoke', { arquivo: 'docker/smoke.sh', de: /for svc in ([^;]+); do/, para: 'for svc in $1 broker; do' }],
    ['operacoesDoGit', { arquivo: 'packages/shared/src/index.ts', de: 'export interface GitProviderContract {', para: 'export interface GitProviderContract {\n  deleteRepo(input: unknown): Promise<void>;' }],
    ['operacoesDoDocker', { arquivo: 'packages/docker-port/src/docker-port.ts', de: 'export abstract class DockerPort {', para: 'export abstract class DockerPort {\n  abstract logs(x: string): Promise<string>;' }],
    ['abasDoProjeto', { arquivo: 'apps/web/src/routes/project-tabs.ts', de: 'const REGISTRO = [', para: "const REGISTRO = [\n  {\n    key: 'nova',\n  }," }],
    ['servicosDoComposeDeDev', { arquivo: 'docker/docker-compose.yml', de: /^services:\n/m, para: 'services:\n  novo:\n    image: x\n\n' }],
    ['tiposDeAcao', { arquivo: 'apps/api/src/domain/actions/decide.ts', de: /export const ACTION_TYPES: readonly ActionType\[\] = \[/, para: "export const ACTION_TYPES: readonly ActionType[] = [\n  'novo_tipo'," }],
    ['estadosDeAcao', { arquivo: 'apps/api/src/db/schema/actions.ts', de: "pgEnum('action_status', [", para: "pgEnum('action_status', [\n  'novo'," }],
    ['tabelasDoBanco', { arquivo: 'apps/api/src/db/schema/actions.ts', de: /$/, para: "\nexport const nova = pgTable('nova', {});\n" }],
  ];

  it.each(mutacoes)('%s: mudar o artefato sem mudar a prosa reprova como DESATUAL', (fonte, troca) => {
    const estados = estadosDa(fonte, contexto([troca]));
    expect(estados.length).toBeGreaterThan(0);
    expect(new Set(estados)).toEqual(new Set(['DESATUAL']));
  });

  it('imagensDeTerceiro: outro total reprova, e o script falhando é CEGO', () => {
    expect(estadosDa('imagensDeTerceiro', contexto([], { saidaImagens: 'imagens-pinadas: 38 imagens de terceiro em 88 arquivos.' }))).toEqual(['DESATUAL']);
    expect(estadosDa('imagensDeTerceiro', contexto([], { saidaImagens: null }))).toEqual(['CEGO']);
  });

  it('as contagens externas (schemas, providers) comparam contra o número que generate.mjs passa', () => {
    const outro = { ...contexto(), externas: { schemas: 12, providers: 10 } };
    const resultados = aferirContagens(outro);
    const externas = resultados.filter((_, i) => FONTES_EXTERNAS.has(AFERICOES[i]!.fonte));
    expect(new Set(externas.map((r) => r.estado))).toEqual(new Set(['DESATUAL']));
    const semExternas = { ...contexto(), externas: undefined };
    const cegos = aferirContagens(semExternas).filter((_, i) => FONTES_EXTERNAS.has(AFERICOES[i]!.fonte));
    expect(new Set(cegos.map((r) => r.estado))).toEqual(new Set(['CEGO']));
  });

  it('serviço padrão SEM healthcheck reprova mesmo que a contagem bata', () => {
    const ctx = contexto([
      { arquivo: 'docker/docker-compose.yml', de: /^ {2}neo4j:\n/m, para: '  semhc:\n    image: x\n\n  neo4j:\n' },
    ]);
    const r = aferirContagens(ctx).find((_, i) => AFERICOES[i]!.fonte === 'servicosDoComposeDeDev')!;
    expect(r.estado).toBe('DESATUAL');
    expect(r.esperado).toMatch(/sem healthcheck/);
  });

  it('a fonte sumir é CEGO, nunca comparação contra vazio', () => {
    const ctx = contexto([
      { arquivo: 'packages/shared/src/index.ts', de: 'export interface GitProviderContract {', para: 'export interface OutroNome {' },
    ]);
    expect(new Set(estadosDa('operacoesDoGit', ctx))).toEqual(new Set(['CEGO']));
  });

  it('a frase sumir é CEGO', () => {
    const ctx = contexto([
      { arquivo: 'docs/glossary.md', de: 'executes directly.', para: 'runs directly.' },
    ]);
    expect(estadosDa('tiposDeAcao', ctx)).toEqual(['CEGO']);
  });

  it('mudar a PROSA sem mudar o artefato reprova como DESATUAL', () => {
    const ctx = contexto([
      { arquivo: 'CLAUDE.md', de: /já são (\S+) na raiz/, para: 'já são treze na raiz' },
    ]);
    expect(estadosDa('overridesRaiz', ctx)).toEqual(['DESATUAL']);
  });

  it('naForma: extenso em pt (m/f) e en, algarismo fora da tabela', () => {
    expect(naForma(2, 'pt_m')).toBe('dois');
    expect(naForma(2, 'pt_f')).toBe('duas');
    expect(naForma(21, 'en')).toBe('twenty-one');
    expect(naForma(99, 'en')).toBe('99');
    expect(naForma(17, 'digito')).toBe('17');
  });
});
