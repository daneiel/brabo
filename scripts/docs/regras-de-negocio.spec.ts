import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { arquivosDeRn as arquivosDeRnDaAncora } from './ancoras-de-rn.mjs';
import { arquivos, ler } from './fontes.mjs';
import { aferir } from './refs-com-simbolo.mjs';
import {
  arquivosDeRn,
  contarRegras,
  gerarIndiceDeRn,
  maiorRn,
  numerosDuplicados,
  paginaNaUniao,
} from './regras-de-negocio.mjs';

const raizes = [{ raiz: 'docs' }, { raiz: 'apps/api/docs' }];
const textos: Record<string, string> = {
  'docs/business-rules.md': '# índice\n',
  'apps/api/docs/business-rules/api.md': '### RN-001 — a {#rn-001}\n### RN-005 — b {#rn-005}\n',
  'apps/web/docs/business-rules/web.md': '### RN-005 — c {#rn-005}\n',
};
const lerF = (f: string) => textos[f];

describe('arquivos de RN de todas as raízes', () => {
  it('pede o glob de cada raiz e de cada locale', () => {
    const pedidos: string[] = [];
    arquivosDeRn((g: string) => (pedidos.push(g), []), raizes);
    expect(pedidos).toContain('apps/api/docs/business-rules/*.md');
    expect(pedidos).toContain('apps/api/docs/i18n/en/business-rules/*.md');
  });

  it('número duplicado entre duas raízes reprova nomeando os dois', () => {
    const d = numerosDuplicados(['apps/api/docs/business-rules/api.md', 'apps/web/docs/business-rules/web.md'], lerF);
    expect(d).toEqual([
      { numero: 5, arquivos: ['apps/api/docs/business-rules/api.md', 'apps/web/docs/business-rules/web.md'] },
    ]);
  });

  it('sem duplicata, conta e maior número; índice sem cabeçalho não conta', () => {
    const f = ['docs/business-rules.md', 'apps/api/docs/business-rules/api.md'];
    expect(numerosDuplicados(f, lerF)).toEqual([]);
    expect(contarRegras(f, lerF)).toBe(2);
    expect(maiorRn(f, lerF)).toBe(5);
  });

  it('o índice gerado tem uma âncora por RN, no link da página hospedeira', () => {
    const rns = [
      { numero: 123, titulo: 'x', pagina: paginaNaUniao('apps/api/docs/business-rules/api.md', raizes) },
      { numero: 4, titulo: 'y', pagina: 'business-rules/web.md' },
    ];
    const bloco = gerarIndiceDeRn(rns);
    expect(bloco.match(/<a id="rn-\d+"><\/a>/g)).toHaveLength(2);
    expect(bloco).toContain('(business-rules/api.md#rn-123)');
  });

  it('a árvore real: 821 RNs, sem duplicata, e a ancoras-de-rn reexporta a mesma função', () => {
    const lista = arquivosDeRn(arquivos) as string[];
    expect(arquivosDeRnDaAncora).toBe(arquivosDeRn);
    expect(contarRegras(lista, ler)).toBe(821);
    expect(numerosDuplicados(lista, ler)).toEqual([]);
  });
});

describe('refs-com-simbolo --raiz', () => {
  it('ref fora da fonte da raiz é externa: listada, não reprova', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rn-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    mkdirSync(join(dir, 'apps/api'), { recursive: true });
    writeFileSync(join(dir, 'docs/rn.md'), '### RN-001\n`apps/api/x.ts:99` (`nada`)\n');
    writeFileSync(join(dir, 'apps/api/x.ts'), 'linha\n');
    const todos = aferir(dir, ['apps/api/x.ts'], ['docs/rn.md']);
    expect(todos.naoBatem).toHaveLength(1);
    const web = aferir(dir, ['apps/api/x.ts'], ['docs/rn.md'], undefined, 'web');
    expect(web.naoBatem).toHaveLength(0);
    expect(web.externas).toHaveLength(1);
  });
});
