import { describe, expect, it } from 'vitest';
import { fontesDoInventarioDeEnv } from './fontes-de-env.mjs';
import { arquivos } from './fontes.mjs';

/**
 * AT-124: o inventário de `configuration.md` só reprova uma variável nova se
 * a FONTE dela estiver na varredura. A medição por mutação (2026-09-25) achou
 * `e2e/**` coberto em arquivo direto na raiz e aninhado — e um buraco: o
 * filtro de `.spec.` tirava da varredura justamente os testes do Playwright,
 * que é onde uma variável nova de `e2e/` mais provavelmente nasce.
 */

type Fonte = [string, string[], RegExp, 'produto' | 'ferramenta'];

const fonte = (lista: Fonte[], nome: string) => {
  const achada = lista.find(([app]) => app === nome);
  if (!achada) throw new Error(`fonte ${nome} sumiu do inventário`);
  return achada;
};

// Emula `git ls-files <glob>` sobre uma árvore fixa: sem `:(glob)`, o `*` do
// pathspec atravessa `/`, e `**/` exige pelo menos um nível de diretório.
const arvoreFalsa = (caminhos: string[]) => (glob: string) => {
  const i = glob.indexOf('*');
  const prefixo = glob.slice(0, i);
  const resto = glob.slice(i);
  const exigeNivel = resto.startsWith('**/');
  const sufixo = resto.replace(/^\*\*\/\*|^\*/, '');
  return caminhos.filter((c) => {
    if (!c.startsWith(prefixo)) return false;
    const depois = c.slice(prefixo.length);
    if (exigeNivel && !depois.includes('/')) return false;
    return sufixo.endsWith('*') ? depois.includes(sufixo.slice(0, -1)) : depois.endsWith(sufixo);
  });
};

describe('fontesDoInventarioDeEnv — a mutação que reprovava (AT-124)', () => {
  const arvore = arvoreFalsa([
    'e2e/playwright.config.ts',
    'e2e/suporte/api.ts',
    'e2e/testes/novo.spec.ts',
    'apps/api/scripts/seed-golden-set-qa.ts',
    'apps/api/scripts/sub/aninhado.ts',
    'apps/api/scripts/algo.spec.ts',
  ]);
  const lista = fontesDoInventarioDeEnv(arvore) as Fonte[];

  it('um teste do Playwright em e2e/testes/*.spec.ts entra na varredura', () => {
    expect(fonte(lista, 'e2e')[1]).toContain('e2e/testes/novo.spec.ts');
  });

  it('e2e cobre o arquivo direto na raiz e o aninhado', () => {
    const [, caminhos] = fonte(lista, 'e2e');
    expect(caminhos).toContain('e2e/playwright.config.ts');
    expect(caminhos).toContain('e2e/suporte/api.ts');
  });

  it('api/scripts cobre raiz e aninhado, e deixa de fora o spec de unidade', () => {
    const [, caminhos, , escopo] = fonte(lista, 'api/scripts');
    expect(caminhos).toContain('apps/api/scripts/seed-golden-set-qa.ts');
    expect(caminhos).toContain('apps/api/scripts/sub/aninhado.ts');
    expect(caminhos).not.toContain('apps/api/scripts/algo.spec.ts');
    expect(escopo).toBe('ferramenta');
  });

  it('o padrão das duas fontes captura o nome da variável', () => {
    for (const nome of ['e2e', 'api/scripts']) {
      const [, , padrao] = fonte(lista, nome);
      const achados = [...'const x = process.env.E2E_NOVA_URL;'.matchAll(padrao)].map((m) => m[1]);
      expect(achados).toEqual(['E2E_NOVA_URL']);
    }
  });
});

describe('fontesDoInventarioDeEnv — contra o repositório de verdade', () => {
  const lista = fontesDoInventarioDeEnv(arquivos) as Fonte[];

  it('todo .ts versionado em e2e/ é varrido, specs inclusive', () => {
    const versionados = arquivos('e2e').filter((f: string) => f.endsWith('.ts'));
    expect(versionados.length).toBeGreaterThan(0);
    expect(versionados.some((f: string) => f.includes('.spec.'))).toBe(true);
    const varridos = new Set(fonte(lista, 'e2e')[1]);
    expect(versionados.filter((f: string) => !varridos.has(f))).toEqual([]);
  });

  it('todo .ts versionado de apps/api/scripts/ que não é spec é varrido', () => {
    const versionados = arquivos('apps/api/scripts').filter(
      (f: string) => f.endsWith('.ts') && !f.includes('.spec.'),
    );
    expect(versionados.length).toBeGreaterThan(0);
    const varridos = new Set(fonte(lista, 'api/scripts')[1]);
    expect(versionados.filter((f: string) => !varridos.has(f))).toEqual([]);
  });
});
