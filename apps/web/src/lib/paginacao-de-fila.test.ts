import { describe, expect, it } from 'vitest';
import { paginar } from './paginacao-de-fila';

const lista = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('paginar (AT-680)', () => {
  it('lista vazia: uma página sem itens', () => {
    expect(paginar([], 0)).toMatchObject({ itens: [], pagina: 0, totalDePaginas: 1, inicio: 0, fim: 0, total: 0 });
  });
  it('divisão exata e última página parcial', () => {
    expect(paginar(lista(6), 1)).toMatchObject({ itens: [4, 5, 6], totalDePaginas: 2, inicio: 4, fim: 6 });
    expect(paginar(lista(7), 2)).toMatchObject({ itens: [7], totalDePaginas: 3, inicio: 7, fim: 7 });
  });
  it('a página pedida acima do fim volta (decidiu o último item)', () => {
    expect(paginar(lista(6), 2)).toMatchObject({ pagina: 1, inicio: 4, fim: 6 });
    expect(paginar(lista(6), -1).pagina).toBe(0);
  });
});
