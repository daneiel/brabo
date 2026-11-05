import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — `docmap.mjs` é JS puro, sem tipos.
import { lerDocmap, regrasAcionadas, validar } from './docmap.mjs';
import { adrExisteNoRepositorio, paginaExisteNaFonte } from './links-do-locale.mjs';
// @ts-expect-error — JS puro, sem tipos.
import { medirDoRepositorio } from './paridade-de-traducao.mjs';

/**
 * AT-693: as peças que leem a doc leem a UNIÃO das raízes. A fixture tem duas:
 * o agregador (`docs/`) e a raiz `api` (`apps/api/docs/`), com o MESMO `rel`.
 */
const RAIZES = [
  { nome: 'produto', raiz: 'docs' },
  { nome: 'api', raiz: 'apps/api/docs' },
];

function fixture(docmapApi: string) {
  const dir = mkdtempSync(join(tmpdir(), 'docs-por-raiz-'));
  const escrever = (rel: string, texto: string) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), texto);
  };
  escrever('docs/.docmap.yml', 'rules:\n  - id: geral\n    watch: ["scripts/**"]\n    docs: ["docs/a.md"]\n');
  escrever('apps/api/docs/.docmap.yml', docmapApi);
  escrever('docs/a.md', '# A\n');
  escrever('apps/api/docs/b.md', '# B\n');
  escrever('apps/api/src/x.ts', 'export {};\n');
  escrever('scripts/y.ts', 'export {};\n');
  return { dir, escrever };
}

const REGRA_API = 'rules:\n  - id: api\n    watch: ["apps/api/src/**"]\n    docs: ["apps/api/docs/b.md"]\n';
const ARQUIVOS = ['docs/.docmap.yml', 'apps/api/docs/.docmap.yml', 'docs/a.md', 'apps/api/docs/b.md', 'apps/api/src/x.ts', 'scripts/y.ts'];

describe('docmap por raiz', () => {
  it('a regra do .docmap.yml da raiz aciona pelo watch, e o glob é validado', () => {
    const { dir } = fixture(REGRA_API);
    const docmap = lerDocmap({ base: dir, arquivos: ARQUIVOS });
    expect(docmap.rules.map((r: { id: string }) => r.id)).toEqual(['geral', 'api']);
    expect(regrasAcionadas(docmap, ['apps/api/src/x.ts']).map((r: { id: string }) => r.id)).toEqual(['api']);
    expect(validar(docmap, ARQUIVOS, dir)).toEqual([]);
  });

  it('mutação: glob morto numa raiz reprova, e id duplicado entre arquivos também', () => {
    const { dir } = fixture(REGRA_API.replace('apps/api/src/**', 'apps/api/nada/**').replace('id: api', 'id: geral'));
    const tipos = validar(lerDocmap({ base: dir, arquivos: ARQUIVOS }), ARQUIVOS, dir).map((p: { tipo: string }) => p.tipo);
    expect(tipos).toContain('glob-morto');
    expect(tipos).toContain('id-duplicado');
  });

  it('--raiz restringe às regras daquela raiz; nome desconhecido lança', () => {
    const { dir } = fixture(REGRA_API);
    const so = lerDocmap({ base: dir, arquivos: ARQUIVOS, raiz: 'api', raizes: RAIZES });
    expect(so.rules.map((r: { id: string }) => r.id)).toEqual(['api']);
    expect(() => lerDocmap({ base: dir, arquivos: ARQUIVOS, raiz: 'nao-existe', raizes: RAIZES })).toThrow(/desconhecida/);
  });
});

describe('links-do-locale na união', () => {
  it('acha a página (e o ADR) na raiz que não é o agregador', () => {
    const { dir, escrever } = fixture(REGRA_API);
    escrever('apps/api/docs/adr/0001-x.md', '# x\n');
    const dirs = [join(dir, 'docs'), join(dir, 'apps/api/docs')];
    expect(paginaExisteNaFonte('b.md', dirs)).toBe(true);
    expect(paginaExisteNaFonte('c.md', dirs)).toBe(false);
    expect(adrExisteNoRepositorio('0001-x.md', dirs)).toBe(true);
    expect(adrExisteNoRepositorio('0002-x.md', dirs)).toBe(false);
  });
});

describe('paridade de tradução na união', () => {
  it('lê fonte e tradução de cada raiz, e a mesma página em duas raízes reprova', () => {
    const { dir, escrever } = fixture(REGRA_API);
    escrever('docs/reference/openapi.json', '{"openapi":"3.0.0","paths":{}}');
    escrever('apps/api/docs/i18n/en/b.md', '---\ntitle: B\n---\n# B\n');
    const run = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
    run('init', '-q');
    run('add', '-A');
    run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x');
    const { docs } = medirDoRepositorio(dir, ['docs', 'apps/api/docs']);
    expect(docs.en.traduzidas).toBe(1);
    expect(docs.en.sem_procedencia ?? docs.en.semProcedencia).toEqual(['b.md']);
    expect(docs.en.ausentes).toContain('a.md');
    escrever('docs/b.md', '# duplicada\n');
    expect(() => medirDoRepositorio(dir, ['docs', 'apps/api/docs'])).toThrow(/duas raízes/);
  });
});
