import { useCallback, useEffect, useRef } from 'react';
import type { ProposedAction, SessionEvent } from './api-types';
import type { StoreDoStreaming } from './streaming-do-turno';

/**
 * `scrollIntoView` com guarda de existência (achado 10) — jsdom (ambiente de
 * teste) não implementa o método; chamá-lo direto quebra qualquer teste que
 * monte a tela com eventos na lista. Nos navegadores de verdade o método
 * sempre existe, então a guarda nunca muda o comportamento visível.
 */
function rolarParaOFim(el: HTMLElement | null) {
  el?.scrollIntoView?.({ block: 'end' });
}

/**
 * A identidade do que há no fio (RN-951): o `seq` do último evento e os ids
 * das ações. Muda quando chega conteúdo novo mesmo que o TAMANHO das listas
 * não mude (teto de 200 eventos, ação decidida e outra chegando).
 */
export function identidadeDoFio(
  events: readonly SessionEvent[],
  actions: readonly ProposedAction[],
): string {
  const ultimo = events.reduce((m, e) => (e.seq > m ? e.seq : m), 0);
  return `${events.length === 0 ? 'vazio' : ultimo}|${actions.map((a) => a.id).join(',')}`;
}

/**
 * A rolagem do fio da tela de Sessão (RN-951, AT-635): o fio acompanha SEMPRE
 * a última mensagem — a cada evento/ação nova, a cada mudança de altura do
 * conteúdo ou do container, mesmo que a pessoa tenha rolado para cima (revoga
 * a guarda dos 120px da RN-173 e o item 4 da RN-751). Instantâneo
 * (`block: 'end'`) e sem mexer no foco. Com `?highlightEvent` a abertura vai
 * ao evento citado (Fase 4b); o acompanhamento começa na primeira mudança.
 */
export function useRolagemDoFio({
  highlightEvent,
  logOpen,
  events,
  actions,
  streamingStore,
}: {
  highlightEvent: string | undefined;
  logOpen: boolean;
  events: SessionEvent[];
  actions: ProposedAction[];
  /** O texto em curso vem como STORE (AT-301): não é dependência de efeito. */
  streamingStore: StoreDoStreaming;
}) {
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesInnerRef = useRef<HTMLDivElement | null>(null);
  // Só acompanha depois de a abertura acontecer (no fim, ou no evento citado
  // e então na primeira mudança).
  const seguindoRef = useRef(false);
  const vistoRef = useRef<string | null>(null);

  // Navegação de evidência (Fase 4b): rola até o evento assim que ele existir.
  useEffect(() => {
    if (!highlightEvent || !logOpen) return;
    document
      .getElementById(`event-${highlightEvent}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlightEvent, logOpen, events.length]);

  const acompanharOFim = useCallback(() => {
    if (seguindoRef.current) rolarParaOFim(messagesEndRef.current);
  }, []);

  // Por IDENTIDADE, não por `length`: a primeira leva abre no fim (achado 10;
  // com `highlightEvent` fica no evento citado); toda mudança depois vai ao fim.
  const identidade = identidadeDoFio(events, actions);
  useEffect(() => {
    if (events.length === 0 && actions.length === 0) return;
    const primeira = vistoRef.current === null;
    vistoRef.current = identidade;
    if (primeira && highlightEvent) return;
    seguindoRef.current = true;
    rolarParaOFim(messagesEndRef.current);
  }, [identidade]); // eslint-disable-line react-hooks/exhaustive-deps

  // O texto do streaming (AT-301): assinatura direta do store; o aviso chega
  // ANTES de a bolha pintar, então a rolagem vai à volta seguinte.
  useEffect(() => {
    let textoAnterior = streamingStore.ler().texto;
    let pendente: ReturnType<typeof setTimeout> | null = null;
    const cancelar = streamingStore.subscribe(() => {
      const texto = streamingStore.ler().texto;
      if (texto === textoAnterior) return;
      textoAnterior = texto;
      if (pendente === null) {
        pendente = setTimeout(() => {
          pendente = null;
          acompanharOFim();
        }, 0);
      }
    });
    return () => {
      cancelar();
      if (pendente !== null) clearTimeout(pendente);
    };
  }, [streamingStore, acompanharOFim]);

  // Altura que muda sem estado novo: o CONTEÚDO (Disclosure, Markdown,
  // Mermaid) e o CONTAINER (faixa de atividade, composer, pendências acima).
  // Guarda de existência: jsdom não tem `ResizeObserver`.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver(() => acompanharOFim());
    if (messagesInnerRef.current) observador.observe(messagesInnerRef.current);
    if (scrollContainerRef.current) observador.observe(scrollContainerRef.current);
    return () => observador.disconnect();
  }, [acompanharOFim]);

  return { messagesEndRef, scrollContainerRef, messagesInnerRef };
}
