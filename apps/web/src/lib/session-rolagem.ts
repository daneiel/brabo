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
 * A rolagem do fio da tela de Sessão: os refs da sentinela, do container que
 * rola e do conteúdo que cresce, a navegação até o evento citado pelo
 * Psicólogo (Fase 4b), a abertura no fim (achado 10) e o "acompanha o fim"
 * com a guarda dos 120px (RN-173) — pelas dependências de estado E pelo
 * `ResizeObserver` do conteúdo.
 *
 * Morou em `SessionPage.tsx` até o PR 7 do programa do ADR 0176, que moveu os
 * refs e os quatro efeitos sem mudar uma linha: as listas de dependências são
 * as mesmas, e o hook é chamado no MESMO ponto do componente em que os
 * efeitos estavam, então a ordem em que o React os roda também não muda.
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
  /**
   * O texto em curso vem como STORE desde a AT-301 — a página não re-renderiza
   * por token, então ele não pode mais ser dependência de efeito aqui.
   */
  streamingStore: StoreDoStreaming;
}) {
  // Achado 10: sentinela no fim da lista de mensagens — a sessão abre nela,
  // em vez de abrir no TOPO (mais antigas primeiro), que era o comportamento
  // sem NENHUM scroll automático.
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  // O CONTEÚDO do fio (RN-173) — o que muda de altura. O container rola, mas
  // não é ele que cresce; observar o container não veria nada.
  const messagesInnerRef = useRef<HTMLDivElement | null>(null);
  const abriuNoFimRef = useRef(false);

  // Navegação de evidência (Fase 4b): rola até o evento assim que ele
  // existir no DOM — depende do log estar aberto E dos eventos já terem
  // chegado pelo poll, daí a dependência em `events.length`.
  useEffect(() => {
    if (!highlightEvent || !logOpen) return;
    document
      .getElementById(`event-${highlightEvent}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlightEvent, logOpen, events.length]);

  // Achado 10: a sessão abre sempre na ÚLTIMA mensagem. Roda uma vez, assim
  // que a primeira leva de eventos chega — a navegação de evidência do
  // Psicólogo (efeito acima) tem prioridade quando existe `highlightEvent`,
  // e por isso este nem tenta rolar nesse caso.
  useEffect(() => {
    if (highlightEvent || abriuNoFimRef.current || events.length === 0) return;
    rolarParaOFim(messagesEndRef.current);
    abriuNoFimRef.current = true;
  }, [highlightEvent, events.length]);

  // Conteúdo novo acompanha o fim SE o usuário já estava lá — não arranca o
  // scroll de quem subiu pra reler o histórico. A guarda dos 120px é
  // DELIBERADA e continua intacta: ela é a diferença entre "o chat me segue"
  // e "o chat me arrasta".
  const acompanharOFim = useCallback(() => {
    if (!abriuNoFimRef.current) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const pertoDoFim =
      container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    if (pertoDoFim) rolarParaOFim(messagesEndRef.current);
  }, []);

  // RN-173: as dependências eram só `[events.length, streamingText]`, e por
  // isso TUDO que cresce o fio sem um evento novo passava despercebido — um
  // `ApprovalCard` chegando pelo poll de `usePendingActions` (que é uma query
  // SEPARADA) empurrava a conversa para fora da tela sem rolar nada. `actions`
  // entra aqui pelo mesmo motivo que `events`: é uma das duas fontes da
  // timeline.
  useEffect(() => {
    acompanharOFim();
  }, [events.length, actions.length, acompanharOFim]);

  // O texto do streaming (AT-301): em vez de dependência de efeito — que
  // exigiria a página re-renderizar a cada token —, uma assinatura direta do
  // store. O aviso chega ANTES de a bolha pintar o texto novo, então o
  // acompanhamento vai para a volta seguinte do laço de eventos, depois do
  // commit; só o TEXTO dispara (a faixa de atividade mora fora da área que
  // rola), como a dependência antiga.
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

  // A outra metade do mesmo problema, e a que NENHUMA lista de dependências
  // resolve: altura que muda sem estado novo no `SessionPage` — abrir/fechar
  // um `Disclosure` (o colapso por agente da RN-138, os "Detalhes" do próprio
  // card de aprovação), o Markdown reflowando, um diagrama renderizando
  // depois. Quem sabe disso é o LAYOUT, não o React, então quem pergunta é um
  // `ResizeObserver` — sobre o CONTEÚDO, com a MESMA guarda dos 120px.
  //
  // A guarda de existência é a mesma razão de `rolarParaOFim`: jsdom não
  // implementa `ResizeObserver`, e num navegador de verdade ele sempre existe
  // — a guarda nunca muda o comportamento visível.
  useEffect(() => {
    const alvo = messagesInnerRef.current;
    if (!alvo || typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver(() => acompanharOFim());
    observador.observe(alvo);
    return () => observador.disconnect();
  }, [acompanharOFim]);

  return { messagesEndRef, scrollContainerRef, messagesInnerRef };
}
