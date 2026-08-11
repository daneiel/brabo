import { describe, expect, it } from 'vitest';
import {
  KINDS_DE_SESSAO,
  KIND_PRE_SELECIONADO,
  TIPOS_DE_SESSAO,
} from './session-kind';
import type { SessionKind } from './api-types';

/**
 * O catálogo de copy do tipo de sessão (FASE 20, RN-097).
 *
 * O que estes testes travam não é o texto — é que TODO tipo tenha texto. A
 * fase nasceu de um pedido de clareza, e um tipo novo que chegasse sem
 * explicação apareceria na tela como o slug cru do banco, que é exatamente o
 * problema de origem com outro nome.
 */
const TIPOS: SessionKind[] = ['consultiva', 'criativa'];

describe('catálogo de tipos de sessão', () => {
  it('todo tipo tem rótulo e explicação próprios', () => {
    for (const tipo of TIPOS) {
      const entrada = TIPOS_DE_SESSAO[tipo];
      expect(entrada, tipo).toBeTruthy();
      expect(entrada.rotulo.trim(), tipo).not.toBe('');
      // Uma explicação de meia dúzia de caracteres seria rótulo repetido.
      expect(entrada.explicacao.length, tipo).toBeGreaterThan(40);
    }
  });

  it('nenhum tipo empresta o texto do outro', () => {
    const rotulos = TIPOS.map((t) => TIPOS_DE_SESSAO[t].rotulo);
    const explicacoes = TIPOS.map((t) => TIPOS_DE_SESSAO[t].explicacao);
    expect(new Set(rotulos).size).toBe(TIPOS.length);
    expect(new Set(explicacoes).size).toBe(TIPOS.length);
  });

  it('a lista percorrida pela tela cobre o catálogo inteiro', () => {
    // A tela itera `KINDS_DE_SESSAO`. Divergindo do catálogo, um tipo real
    // ficaria inescolhível — e ninguém veria falha nenhuma.
    expect([...KINDS_DE_SESSAO].sort()).toEqual([...TIPOS].sort());
  });

  it('o tipo pré-selecionado existe no catálogo', () => {
    expect(KINDS_DE_SESSAO).toContain(KIND_PRE_SELECIONADO);
  });
});
