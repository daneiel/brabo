import { describe, expect, it } from 'vitest';

/**
 * Paridade dos dois idiomas (AT-289). `en` é o default e `pt-BR` é mantido
 * (RN-425): chave que existe num e falta no outro não quebra nada visível no
 * `en` — o i18next cai no `fallbackLng` em silêncio —, e em `pt-BR` a pessoa
 * lê uma frase em inglês no meio da tela. Este teste compara o CONJUNTO de
 * chaves (achatadas por ponto) de cada namespace, nos dois sentidos.
 *
 * Sufixo de plural (`_one`, `_other`, `_many`...) é normalizado para a raiz:
 * as regras de plural são do IDIOMA (o CLDR do `pt` tem `many`, o do `en`
 * não), então exigir o mesmo conjunto de sufixos reprovaria o certo.
 */
type Arvore = { [chave: string]: unknown };
type ModuloJson = { default: Arvore };

const modulosEn = import.meta.glob<ModuloJson>('../locales/en/*.json', { eager: true });
const modulosPtBR = import.meta.glob<ModuloJson>('../locales/pt-BR/*.json', { eager: true });

const SUFIXO_DE_PLURAL = /_(zero|one|two|few|many|other)$/;

function nomeDoNamespace(caminho: string): string {
  return (caminho.split('/').pop() ?? '').replace(/\.json$/, '');
}

function porNamespace(modulos: Record<string, ModuloJson>): Map<string, Arvore> {
  return new Map(
    Object.entries(modulos).map(([caminho, modulo]) => [nomeDoNamespace(caminho), modulo.default]),
  );
}

function chavesAchatadas(arvore: Arvore, prefixo = ''): Set<string> {
  const chaves = new Set<string>();
  for (const [chave, valor] of Object.entries(arvore)) {
    const caminho = prefixo ? `${prefixo}.${chave}` : chave;
    if (valor !== null && typeof valor === 'object' && !Array.isArray(valor)) {
      for (const filha of chavesAchatadas(valor as Arvore, caminho)) chaves.add(filha);
    } else {
      chaves.add(caminho.replace(SUFIXO_DE_PLURAL, ''));
    }
  }
  return chaves;
}

function faltando(de: Set<string>, em: Set<string>): string[] {
  return [...de].filter((chave) => !em.has(chave)).sort();
}

const en = porNamespace(modulosEn);
const ptBR = porNamespace(modulosPtBR);

describe('paridade de chaves entre en e pt-BR (AT-289)', () => {
  it('os dois idiomas têm os mesmos namespaces', () => {
    expect([...ptBR.keys()].sort()).toEqual([...en.keys()].sort());
    expect(en.size).toBeGreaterThan(0);
  });

  it.each([...en.keys()].sort())('o namespace "%s" tem as mesmas chaves nos dois idiomas', (ns) => {
    const chavesEn = chavesAchatadas(en.get(ns) ?? {});
    const chavesPt = chavesAchatadas(ptBR.get(ns) ?? {});
    expect({ faltamNoPtBR: faltando(chavesEn, chavesPt), faltamNoEn: faltando(chavesPt, chavesEn) }).toEqual({
      faltamNoPtBR: [],
      faltamNoEn: [],
    });
  });

  it('acusa a chave que falta de um lado (o instrumento mede)', () => {
    const a = chavesAchatadas({ x: { y: 'a', z_one: '1', z_other: 'n' } });
    const b = chavesAchatadas({ x: { y: 'a', z_one: '1', z_many: 'm', z_other: 'n', w: 'só aqui' } });
    expect(faltando(a, b)).toEqual([]);
    expect(faltando(b, a)).toEqual(['x.w']);
  });
});
