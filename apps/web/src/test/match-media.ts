import { vi } from 'vitest';

/**
 * `window.matchMedia` de mentira para os testes do layout móvel (RN-643) — o
 * jsdom não o implementa, e sem ele `useLayoutMovel` responde DESKTOP. O valor
 * é o mesmo para qualquer consulta (a única que o produto faz é
 * `CONSULTA_MOVEL`), e `mudar` simula a janela cruzando o corte, disparando o
 * `change` como o navegador faz.
 */
export function simularLayoutMovel(movel: boolean) {
  const ouvintes = new Set<() => void>();
  let atual = movel;
  const original = window.matchMedia;
  window.matchMedia = vi.fn((consulta: string) => ({
    get matches() {
      return atual;
    },
    media: consulta,
    onchange: null,
    addEventListener: (_tipo: string, ouvinte: () => void) => ouvintes.add(ouvinte),
    removeEventListener: (_tipo: string, ouvinte: () => void) => ouvintes.delete(ouvinte),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
  return {
    mudar(proximo: boolean) {
      atual = proximo;
      ouvintes.forEach((ouvinte) => ouvinte());
    },
    restaurar() {
      window.matchMedia = original;
    },
  };
}
