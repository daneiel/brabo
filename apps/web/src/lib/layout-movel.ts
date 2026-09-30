import { useSyncExternalStore } from 'react';

/**
 * O breakpoint do layout MÓVEL pós-login (RN-643, AT-316).
 *
 * Abaixo de 768px a sidebar (264px) e o trilho do projeto (180px) somavam
 * 444px de moldura FIXA — mais que a tela inteira de um telefone de 390px, e o
 * conteúdo ficava com ~0–126px ou estourava para a direita. Nessa faixa a
 * sidebar vira GAVETA (`Shell.tsx`) e o trilho vira BARRA horizontal rolável
 * (`ProjectRail.tsx`).
 *
 * UMA fonte: quem troca de layout lê ESTA consulta por `useLayoutMovel`, e os
 * módulos CSS aplicam o desenho móvel pela CLASSE que o componente põe (nunca
 * por um `@media` próprio) — assim o que o JS decide e o que o CSS desenha não
 * divergem num pixel de fronteira, e o teste de componente (jsdom, sem CSS)
 * prova o mesmo corte que o navegador aplica.
 */
export const CONSULTA_MOVEL = '(max-width: 767px)';

function temMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

function assinar(aoMudar: () => void): () => void {
  if (!temMatchMedia()) return () => {};
  const mql = window.matchMedia(CONSULTA_MOVEL);
  mql.addEventListener('change', aoMudar);
  return () => mql.removeEventListener('change', aoMudar);
}

function ler(): boolean {
  // Sem `matchMedia` (jsdom sem mock, SSR): DESKTOP — é o layout de sempre, e
  // o móvel é o que precisa ser AFIRMADO pela consulta, nunca suposto.
  if (!temMatchMedia()) return false;
  return window.matchMedia(CONSULTA_MOVEL).matches;
}

/** `true` abaixo do breakpoint móvel; re-renderiza quando a janela cruza o corte. */
export function useLayoutMovel(): boolean {
  return useSyncExternalStore(assinar, ler, () => false);
}
