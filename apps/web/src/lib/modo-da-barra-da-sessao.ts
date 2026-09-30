import { useEffect, useState, type RefObject } from 'react';

/**
 * Como a barra do topo da Sessão se arruma na largura que TEM (AT-317).
 *
 * Medido nas capturas da Rodada 29: com o menu aberto, a 1440px a barra tem
 * ~1176px, e o conteúdo dela em linha — título, tipo, modelo, idioma com a
 * origem, orçamento, a pista do Criativo com "Iniciar ideação", "Encerrar" e o
 * botão do painel — pede ~1740px. O que sobrava era espremido: o chip do
 * modelo cobria "Respostas:", o seletor cortava no meio do nome, o botão
 * quebrava em duas linhas e o título, que é o único item que diz QUAL sessão é
 * esta, era o primeiro a sumir ("S" a 1024px).
 *
 * A régua é a largura da BARRA, nunca a da janela: o menu lateral recolhido ou
 * o painel de contexto mudam o espaço sem mudar a viewport.
 *
 * - `completa`: tudo em linha, como antes.
 * - `compacta`: modelo, idioma e orçamento viram UM controle que abre um painel
 *   com os três inteiros — o idioma com a ORIGEM (RN-620) e a pergunta da
 *   detecção (RN-624) inclusive; a pista do Criativo sai da linha e fica no
 *   `title` do botão, que já dizia a mesma coisa.
 * - `minima`: o controle perde o texto (fica o ícone, com `aria-label`) e
 *   "Encerrar" vira ícone com nome acessível.
 *
 * Largura DESCONHECIDA (sem `ResizeObserver`, ou antes da primeira medição) é
 * `completa`: é o comportamento de antes, e "não medi" não vira "é estreita".
 */
export type ModoDaBarra = 'completa' | 'compacta' | 'minima';

/** A partir daqui cabe tudo em linha (medido: ~1740px com orçamento). */
export const LARGURA_DA_BARRA_COMPLETA = 1720;
/** A partir daqui o controle agrupado ainda mostra modelo e idioma em texto. */
export const LARGURA_DA_BARRA_COMPACTA = 920;

export function modoDaBarra(largura: number | null): ModoDaBarra {
  if (largura === null) return 'completa';
  if (largura >= LARGURA_DA_BARRA_COMPLETA) return 'completa';
  if (largura >= LARGURA_DA_BARRA_COMPACTA) return 'compacta';
  return 'minima';
}

/**
 * A largura do elemento, acompanhada por `ResizeObserver`. `null` enquanto não
 * houver medição — inclusive em jsdom, que não implementa o observador.
 */
export function useLarguraObservada(ref: RefObject<HTMLElement | null>): number | null {
  const [largura, setLargura] = useState<number | null>(null);
  useEffect(() => {
    const alvo = ref.current;
    if (!alvo || typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver((entradas) => {
      const entrada = entradas[entradas.length - 1];
      if (entrada) setLargura(Math.round(entrada.contentRect.width));
    });
    observador.observe(alvo);
    return () => observador.disconnect();
  }, [ref]);
  return largura;
}
