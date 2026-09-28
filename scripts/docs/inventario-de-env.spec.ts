import { describe, expect, it } from 'vitest';
import {
  DESTINO,
  ID_DO_BLOCO,
  inventariar,
  mensagemDaLacuna,
  nomesCitados,
  SECAO_POR_FONTE,
} from './inventario-de-env.mjs';
import { fontesDoInventarioDeEnv } from './fontes-de-env.mjs';
import { arquivos, grepTodos, ler } from './fontes.mjs';

/**
 * AT-211: o ⚠️ do inventário de variáveis de ambiente virou PORTÃO, nas duas
 * espécies de fonte. Cada caso é uma MUTAÇÃO de um estado certo: a variável
 * nova sem descrição reprova, a mesma com descrição passa. As fontes e o
 * código são de mentira (um "arquivo" por fonte, lido por um grep em memória),
 * para que cada mutação mude UMA coisa.
 */

type Fonte = [string, string[], RegExp, 'produto' | 'ferramenta'];
type Lacuna = { nome: string; arquivo: string; app: string; escopo: string };

const PADRAO = /process\.env\.([A-Z_0-9]{3,})/g;

// Código de mentira por arquivo, e um grep que devolve o mesmo formato do
// `grepTodos` de verdade: nome → conjunto de arquivos que o leem.
function grepEm(codigo: Record<string, string>) {
  return (padrao: RegExp, caminhos: string[]) => {
    const achados = new Map<string, Set<string>>();
    for (const c of caminhos) {
      for (const m of (codigo[c] ?? '').matchAll(padrao)) {
        if (!achados.has(m[1])) achados.set(m[1], new Set());
        achados.get(m[1])!.add(c);
      }
    }
    return achados;
  };
}

const FONTES: Fonte[] = [
  ['api', ['apps/api/src/main.ts'], PADRAO, 'produto'],
  ['e2e', ['e2e/playwright.config.ts'], PADRAO, 'ferramenta'],
];
const CODIGO_CERTO = {
  'apps/api/src/main.ts': 'process.env.API_PORT',
  'e2e/playwright.config.ts': 'process.env.E2E_BASE_URL',
};
const PROSA_CERTA = [
  '## api',
  '| `API_PORT` | `3000` | the port |',
  '## Tooling variables (not product)',
  '| `E2E_BASE_URL` | — | where the browser points |',
].join('\n');

const lacunasDe = (codigo: Record<string, string>, prosa: string) =>
  inventariar(FONTES, grepEm(codigo), prosa).lacunas as Lacuna[];

describe('inventariar — a mutação reprova, a forma certa passa (AT-211)', () => {
  it('o estado certo não tem lacuna', () => {
    expect(lacunasDe(CODIGO_CERTO, PROSA_CERTA)).toEqual([]);
  });

  it('variável nova de PRODUTO sem descrição reprova, nomeando arquivo e fonte', () => {
    const codigo = { ...CODIGO_CERTO, 'apps/api/src/main.ts': 'process.env.API_PORT; process.env.API_NOVA' };
    expect(lacunasDe(codigo, PROSA_CERTA)).toEqual([
      { nome: 'API_NOVA', arquivo: 'apps/api/src/main.ts', app: 'api', escopo: 'produto' },
    ]);
  });

  it('a mesma variável, descrita na prosa, passa', () => {
    const codigo = { ...CODIGO_CERTO, 'apps/api/src/main.ts': 'process.env.API_PORT; process.env.API_NOVA' };
    const prosa = `${PROSA_CERTA}\n| \`API_NOVA\` | — | what it does |`;
    expect(lacunasDe(codigo, prosa)).toEqual([]);
  });

  it('variável nova de FERRAMENTA sem descrição também reprova', () => {
    const codigo = { ...CODIGO_CERTO, 'e2e/playwright.config.ts': 'process.env.E2E_BASE_URL; process.env.E2E_NOVA' };
    expect(lacunasDe(codigo, PROSA_CERTA)).toEqual([
      { nome: 'E2E_NOVA', arquivo: 'e2e/playwright.config.ts', app: 'e2e', escopo: 'ferramenta' },
    ]);
  });

  it('apagar a descrição de uma variável que existe reprova', () => {
    const prosa = PROSA_CERTA.replace('| `E2E_BASE_URL` | — | where the browser points |', '');
    expect(lacunasDe(CODIGO_CERTO, prosa).map((l) => l.nome)).toEqual(['E2E_BASE_URL']);
  });

  it('TODO(humano) na linha que cita a variável NÃO reprova — é lacuna declarada, e é relatada', () => {
    const codigo = { ...CODIGO_CERTO, 'apps/api/src/main.ts': 'process.env.API_PORT; process.env.API_NOVA' };
    const prosa = `${PROSA_CERTA}\n| \`API_NOVA\` | — | **TODO(humano):** what does it do? |`;
    const r = inventariar(FONTES, grepEm(codigo), prosa);
    expect(r.lacunas).toEqual([]);
    expect(r.comTodo).toEqual(['API_NOVA']);
  });

  it('variável com uma linha de verdade E um TODO ao lado não conta como só-TODO', () => {
    const prosa = `${PROSA_CERTA}\n> **TODO(humano):** should \`API_PORT\` be forwarded?`;
    expect(inventariar(FONTES, grepEm(CODIGO_CERTO), prosa).comTodo).toEqual([]);
  });

  it('a abreviação `PREFIXO_A` / `_B` da tabela conta como citação dos dois nomes', () => {
    const citados = nomesCitados('| `POSTGRES_HOST` / `_USER` | … |');
    expect(citados.has('POSTGRES_HOST')).toBe(true);
    expect(citados.has('POSTGRES_USER')).toBe(true);
  });
});

describe('mensagemDaLacuna — diz o quê, onde é lido e onde escrever', () => {
  it('nomeia a variável, o arquivo, o documento, a seção e o bloco', () => {
    const m = mensagemDaLacuna({
      nome: 'API_NOVA',
      arquivo: 'apps/api/src/main.ts',
      app: 'api',
      escopo: 'produto',
    });
    expect(m).toContain('API_NOVA');
    expect(m).toContain('apps/api/src/main.ts');
    expect(m).toContain(DESTINO);
    expect(m).toContain('"## api"');
    expect(m).toContain(ID_DO_BLOCO);
    expect(m).toContain('TODO(humano)');
  });

  it('fonte sem seção conhecida ainda é nomeada', () => {
    const m = mensagemDaLacuna({ nome: 'X_Y', arquivo: 'a/b.ts', app: 'nova', escopo: 'produto' });
    expect(m).toContain('`nova`');
  });
});

describe('contra o repositório de verdade', () => {
  const fontes = fontesDoInventarioDeEnv(arquivos) as Fonte[];

  it('toda fonte do inventário tem a seção onde a descrição mora', () => {
    const doc = ler(DESTINO);
    for (const [app] of fontes) {
      const secao = SECAO_POR_FONTE[app as keyof typeof SECAO_POR_FONTE];
      expect(secao, `fonte ${app} sem seção em SECAO_POR_FONTE`).toBeDefined();
      expect(doc.split('\n')).toContain(secao);
    }
  });

  it('o inventário de hoje não tem nenhuma variável sem descrição', () => {
    const doc = ler(DESTINO);
    const i = doc.indexOf(`<!-- BEGIN:GENERATED:${ID_DO_BLOCO} -->`);
    const f = doc.indexOf(`<!-- END:GENERATED:${ID_DO_BLOCO} -->`);
    expect(i).toBeGreaterThan(-1);
    const prosa = doc.slice(0, i) + doc.slice(f);
    const r = inventariar(fontes, grepTodos, prosa);
    expect(r.total).toBeGreaterThan(100);
    expect(r.lacunas).toEqual([]);
  });
});
