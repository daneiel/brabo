/** AT-680 (RN-975): quantos itens cada fila do painel de pendências desenha por página. */
export const ITENS_POR_PAGINA_DA_FILA = 3;

export interface PaginaDaFila<T> {
  itens: T[];
  /** Zero-based, já ajustada ao tamanho atual da lista. */
  pagina: number;
  totalDePaginas: number;
  /** 1-based, para o texto "inicio–fim de total". */
  inicio: number;
  fim: number;
  total: number;
}

/** Fatia a lista; a página pedida é ajustada em render, sem efeito (decidir o último item volta a página). */
export function paginar<T>(
  lista: readonly T[],
  paginaPedida: number,
  porPagina = ITENS_POR_PAGINA_DA_FILA,
): PaginaDaFila<T> {
  const total = lista.length;
  const totalDePaginas = Math.max(1, Math.ceil(total / porPagina));
  const pagina = Math.min(Math.max(0, paginaPedida), totalDePaginas - 1);
  const itens = lista.slice(pagina * porPagina, (pagina + 1) * porPagina);
  return {
    itens,
    pagina,
    totalDePaginas,
    inicio: total === 0 ? 0 : pagina * porPagina + 1,
    fim: pagina * porPagina + itens.length,
    total,
  };
}
