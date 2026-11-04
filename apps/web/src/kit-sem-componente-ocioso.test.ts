import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ADR 0232 / AT-655 V10: componente do kit (`components/shadcn/*.tsx`) que ninguém
 * importa é código morto que o Tailwind ainda varre. Vale o uso FORA do kit, ou o
 * de OUTRO componente do kit (`label` em `field`, `separator` em `item`); teste
 * do próprio kit não conta, senão o fumaça mantém vivo o que não tem tela.
 */
const RAIZ = __dirname;
const KIT = 'components/shadcn';

function arquivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? arquivos(p) : [p];
  });
}

/** Nomes dos componentes que não aparecem em nenhum `from '…/<nome>'` dos `fontes`. */
function ociosos(nomes: string[], fontes: Record<string, string>): string[] {
  return nomes.filter((n) => {
    const re = new RegExp(`from ['"][^'"]*/${n}['"]`);
    return !Object.entries(fontes).some(([arq, texto]) => !arq.endsWith(`/${n}.tsx`) && re.test(texto));
  });
}

describe('componentes ociosos do kit (ADR 0232)', () => {
  it('prova por mutação: pega o sem import, o só-do-teste ficou fora das fontes, e o importado passa', () => {
    const fontes = {
      'a/tela.tsx': "import { X } from '@/components/shadcn/usado';",
      'components/shadcn/field.tsx': "import { L } from './interno';",
    };
    expect(ociosos(['usado', 'interno', 'morto'], fontes)).toEqual(['morto']);
    expect(ociosos(['usado'], {})).toEqual(['usado']);
  });

  it('todo componente de components/shadcn é importado por tela ou por outro componente do kit', () => {
    const todos = arquivos(RAIZ).map((f) => relative(RAIZ, f).split(sep).join('/'));
    const fontes = Object.fromEntries(
      todos
        .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
        .map((f) => [f, readFileSync(join(RAIZ, f), 'utf8')]),
    );
    const nomes = todos
      .filter((f) => f.startsWith(`${KIT}/`) && /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => f.slice(KIT.length + 1).replace(/\.tsx?$/, ''));
    expect(ociosos(nomes, fontes)).toEqual([]);
  });
});
