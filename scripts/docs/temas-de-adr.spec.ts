import { describe, expect, it } from 'vitest';
import { conferirTemas, INDICE, TEMAS } from './temas-de-adr.mjs';
import { arquivos, ler } from './fontes.mjs';

/**
 * AT-137 (ADR 0202): o tema de cada ADR mora em `docs/adr/temas.yml`, e o
 * índice é agrupado por ele. Cada caso de reprovação abaixo é uma MUTAÇÃO de
 * uma entrada certa — a mutação reprova, a forma certa passa. Os ADRs e o
 * índice são de mentira, para que cada mutação mude UMA coisa.
 */

type Problema = { regra: string; motivo: string };

const TEMAS_CERTOS = `
temas:
  - id: git
    titulo: Git and branches
    descricao: The git side.
  - id: web
    titulo: Web UI
    descricao: The screens.
adrs:
  "0001": git
  "0002": web
  "0003": git
`;

const ARQUIVOS = ['0001-a.md', '0002-b.md', '0003-c.md'];

const SECAO_GIT = ['## Git and branches {#tema-git}', '', 'The git side.', '', '| # | decision |', '|---|---|'];
const SECAO_WEB = ['## Web UI {#tema-web}', '', 'The screens.', '', '| # | decision |', '|---|---|'];
const L1 = '| [0001](0001-a.md) | one |';
const L2 = '| [0002](0002-b.md) | two |';
const L3 = '| [0003](0003-c.md) | three |';

function indice(corpo: string[] = [...SECAO_GIT, L1, L3, '', ...SECAO_WEB, L2, '']): string {
  return ['---', 'id: adr-index', '---', '# Architectural decisions', '', 'Intro.', '', ...corpo, '## The convention', '', '- the next one is **0004**.', ''].join('\n');
}

function conferir(over: { temasYml?: string; arquivosAdr?: string[]; indice?: string } = {}) {
  return conferirTemas({
    temasYml: over.temasYml ?? TEMAS_CERTOS,
    arquivosAdr: over.arquivosAdr ?? ARQUIVOS,
    indice: over.indice ?? indice(),
  });
}

const regras = (r: { problemas: Problema[] }) => r.problemas.map((p) => p.regra);

describe('conferirTemas — a forma certa', () => {
  it('passa, e conta ADRs e temas', () => {
    const r = conferir();
    expect(r.cego).toBeNull();
    expect(r.problemas).toEqual([]);
    expect(r).toMatchObject({ adrs: 3, temas: 2 });
  });
});

describe('conferirTemas — o mapa', () => {
  it('reprova ADR sem tema (SEM-TEMA)', () => {
    const r = conferir({ arquivosAdr: [...ARQUIVOS, '0004-d.md'] });
    expect(regras(r)).toEqual(['SEM-TEMA']);
    expect(r.problemas[0].motivo).toContain('0004');
  });

  it('reprova tema que não está na lista (TEMA)', () => {
    const r = conferir({ temasYml: TEMAS_CERTOS.replace('"0003": git', '"0003": seguranca') });
    expect(regras(r)).toContain('TEMA');
    expect(r.problemas.find((p) => p.regra === 'TEMA')?.motivo).toContain('seguranca');
  });

  it('reprova tema para ADR que não existe (FANTASMA)', () => {
    const r = conferir({ arquivosAdr: ['0001-a.md', '0002-b.md'], indice: indice([...SECAO_GIT, L1, '', ...SECAO_WEB, L2, '']) });
    expect(regras(r)).toEqual(['FANTASMA']);
  });

  it('reprova tema da lista sem ADR (VAZIO)', () => {
    const yml = TEMAS_CERTOS.replace('"0002": web', '"0002": git');
    const r = conferir({ temasYml: yml, indice: indice([...SECAO_GIT, L1, L2, L3, '', ...SECAO_WEB, '']) });
    expect(regras(r)).toEqual(['VAZIO']);
  });

  it('reprova id repetido e id fora de kebab-case (LISTA)', () => {
    const repetido = TEMAS_CERTOS.replace('- id: web\n    titulo: Web UI', '- id: git\n    titulo: Web UI');
    expect(regras(conferir({ temasYml: repetido }))).toContain('LISTA');
    const invalido = TEMAS_CERTOS.replace('- id: web', '- id: Web_UI');
    expect(regras(conferir({ temasYml: invalido }))).toContain('LISTA');
  });

  it('reprova título repetido (LISTA)', () => {
    const r = conferir({ temasYml: TEMAS_CERTOS.replace('titulo: Web UI', 'titulo: Git and branches') });
    expect(regras(r)).toContain('LISTA');
  });
});

describe('conferirTemas — o índice', () => {
  it('reprova linha sob a seção de outro tema (LINHA)', () => {
    const r = conferir({ indice: indice([...SECAO_GIT, L1, L2, L3, '', ...SECAO_WEB, '']) });
    expect(regras(r)).toEqual(['LINHA']);
    expect(r.problemas[0].motivo).toContain('0002');
  });

  it('reprova linha fora de qualquer seção de tema (LINHA)', () => {
    const r = conferir({ indice: indice(['## Phase 12', '', L2, '', ...SECAO_GIT, L1, L3, '', ...SECAO_WEB, '']) });
    expect(regras(r)).toEqual(['LINHA']);
    expect(r.problemas[0].motivo).toContain('fora de qualquer seção');
  });

  it('reprova linha repetida (LINHA)', () => {
    const r = conferir({ indice: indice([...SECAO_GIT, L1, L3, '', ...SECAO_WEB, L2, L2, '']) });
    expect(regras(r)).toEqual(['LINHA']);
  });

  it('reprova linha fora da ordem numérica dentro da seção (LINHA)', () => {
    const r = conferir({ indice: indice([...SECAO_GIT, L3, L1, '', ...SECAO_WEB, L2, '']) });
    expect(regras(r)).toEqual(['LINHA']);
    expect(r.problemas[0].motivo).toContain('ordem numérica');
  });

  it('reprova seção de tema ausente (SECAO)', () => {
    const yml = TEMAS_CERTOS.replace('  - id: web\n    titulo: Web UI\n    descricao: The screens.\n', '').replace('"0002": web', '"0002": git');
    // a lista certa sem `web`, e o índice ainda com a seção `web`: tema inexistente
    const r1 = conferir({ temasYml: yml, indice: indice([...SECAO_GIT, L1, L3, '', ...SECAO_WEB, L2, '']) });
    expect(regras(r1)).toContain('SECAO');
    // o índice sem a seção `web`
    const r2 = conferir({ indice: indice([...SECAO_GIT, L1, L3, '', '## Other', '', L2, '']) });
    expect(regras(r2)).toEqual(expect.arrayContaining(['SECAO', 'LINHA']));
  });

  it('reprova seção com título diferente do da lista (SECAO)', () => {
    const outra = ['## Web screens {#tema-web}', ...SECAO_WEB.slice(1)];
    const r = conferir({ indice: indice([...SECAO_GIT, L1, L3, '', ...outra, L2, '']) });
    expect(regras(r)).toEqual(['SECAO']);
  });

  it('reprova seções fora da ordem da lista (SECAO)', () => {
    const r = conferir({ indice: indice([...SECAO_WEB, L2, '', ...SECAO_GIT, L1, L3, '']) });
    expect(regras(r)).toEqual(['SECAO']);
    expect(r.problemas[0].motivo).toContain('fora da ordem');
  });
});

describe('conferirTemas — o check cego', () => {
  it('YAML ilegível é CEGO', () => {
    expect(conferir({ temasYml: 'temas: [\n' }).cego).toContain('YAML');
  });

  it('lista vazia é CEGO', () => {
    expect(conferir({ temasYml: 'temas: []\nadrs:\n  "0001": git\n' }).cego).toContain('temas');
  });

  it('mapa vazio é CEGO', () => {
    expect(conferir({ temasYml: TEMAS_CERTOS.replace(/adrs:[\s\S]*$/, 'adrs: {}\n') }).cego).toContain('adrs');
  });

  it('índice sem nenhuma seção de tema é CEGO — o índice por fase de antes', () => {
    const r = conferir({ indice: indice(['## Phase 2 — Git', '', L1, L3, '', '## Phase 12', '', L2, '']) });
    expect(r.cego).toContain('seção');
  });
});

describe('o repositório de verdade', () => {
  it('docs/adr/temas.yml cobre todo ADR, e o índice está agrupado por ele', () => {
    const r = conferirTemas({
      temasYml: ler(TEMAS),
      arquivosAdr: arquivos('docs/adr/[0-9]*.md').map((f: string) => f.replace('docs/adr/', '')),
      indice: ler(INDICE),
    });
    expect(r.cego).toBeNull();
    expect(r.problemas).toEqual([]);
    // a decisão do dono: 10 a 15 temas (ADR 0202)
    expect(r.temas).toBeGreaterThanOrEqual(10);
    expect(r.temas).toBeLessThanOrEqual(15);
  });
});
