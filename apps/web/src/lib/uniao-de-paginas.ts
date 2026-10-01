import { useMemo, useRef } from 'react';
import type { SessionEvent } from './api-types';

/**
 * Deduplicação por `id` + ordenação por `seq` das páginas do histórico da
 * sessão (RN-099) — pura. As páginas podem se sobrepor (lacuna de `seq`) e
 * chegam fora de ordem entre si; a cauda vem por último para que, no mesmo
 * `id`, vença a leitura mais nova.
 */
export function unirPaginasDeEventos(
  paginas: readonly (readonly SessionEvent[] | undefined)[],
): SessionEvent[] {
  const porId = new Map<string, SessionEvent>();
  for (const pagina of paginas) {
    for (const evento of pagina ?? []) porId.set(evento.id, evento);
  }
  return [...porId.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * A mesma união, sob memo (AT-301). `useSessionEventHistory` montava o `Map` e
 * reordenava tudo A CADA RENDER de quem o chama — o painel de contexto da
 * Sessão, que re-renderiza muito mais que o poll muda. O React Query devolve a
 * MESMA referência de `items` enquanto a página não muda (structural sharing),
 * então a lista de páginas é comparada item a item: mesmas referências, mesmo
 * resultado, sem recalcular. O número de páginas varia (cada "carregar mais
 * antigos" acrescenta uma), e por isso a comparação é à mão, não um array de
 * dependências do `useMemo`.
 */
export function useUniaoDePaginasDeEventos(
  paginas: readonly (readonly SessionEvent[] | undefined)[],
): SessionEvent[] {
  const anterior = useRef(paginas);
  const mesmas =
    anterior.current.length === paginas.length &&
    anterior.current.every((pagina, i) => Object.is(pagina, paginas[i]));
  if (!mesmas) anterior.current = paginas;
  const estaveis = anterior.current;
  return useMemo(() => unirPaginasDeEventos(estaveis), [estaveis]);
}
