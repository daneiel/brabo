import type { Handoff, SessionEvent } from './api-types';
import { AGENTES_DE_CHAT } from './session-readiness';

/**
 * As derivações de HANDOFF da tela de Sessão — quem já entrou (`activeFor`),
 * a oferta que vira card acionável no fio (RN-136), o handoff da Infra que
 * ganha card próprio (RN-499) e os três "já foi declarado" que escondem os
 * botões de prontidão (achado L, problema 1, RN-406).
 *
 * Moraram em `SessionPage.tsx` até o PR 6 do programa do ADR 0176, que as
 * moveu sem mudar uma linha: são puras (lidas de `events` e `handoffs`, sem
 * estado nem efeito), e o componente continua calculando-as a cada render,
 * como calculava. Os comentários vieram junto, com as referências a "aqui" e
 * "logo abaixo" falando do lugar onde as linhas moravam.
 */
export interface DerivacoesDeHandoff {
  activeFor: (agent: string) => boolean;
  ofertasAcionaveis: Handoff[];
  /**
   * As ofertas de `ofertasAcionaveis` cujo `handoff.offered` já saiu da
   * janela de 200 eventos (RN-631): sem o evento no fio não há card onde o
   * botão more, e elas ganham a faixa fixa acima do composer.
   */
  ofertasForaDaJanela: Handoff[];
  handoffDaInfraOferecido: Handoff | undefined;
  prontidaoJaDeclarada: boolean;
  arquiteturaJaDeclarada: boolean;
}

/**
 * De onde o handoff saiu (RN-633, AT-293): `manual` quando o
 * `handoff.offered` dele foi gravado por uma PESSOA (o handoff manual, ADR
 * 0109/RN-440 — `request-manual-handoff.use-case.ts` grava o ator humano e,
 * como `fromAgent`, o ÚLTIMO agente ativado, não quem passou a bola);
 * `agente` quando foi um agente; `desconhecida` quando o evento está fora da
 * janela de 200 — o `Handoff` da api não carrega o ator.
 */
export type OrigemDoHandoff = 'manual' | 'agente' | 'desconhecida';

export function origemDoHandoff(h: Handoff, events: readonly SessionEvent[]): OrigemDoHandoff {
  const evento = events.find(
    (e) =>
      e.type === 'handoff.offered' &&
      (e.payload as { handoffId?: string } | null)?.handoffId === h.id,
  );
  if (!evento) return 'desconhecida';
  return evento.actor.kind === 'user' ? 'manual' : 'agente';
}

export function derivarHandoffsDaSessao(
  events: SessionEvent[],
  handoffs: Handoff[],
  ativadosNaSessaoInteira: readonly string[] = [],
  ativosNoProjeto: readonly string[] = [],
): DerivacoesDeHandoff {
  // Um agente está ativo se houve um agent.activated pra ele nesta sessão.
  // Isto é EXISTÊNCIA histórica ("já entrou alguma vez"), não "é ele quem
  // fala AGORA". Cópia local de uma linha da mesma checagem que o hook usa
  // internamente pra `criativoActive`/`arquitetoActive` (`session-
  // readiness.ts`) — o único consumidor que sobra aqui é `ofertasAcionaveis`,
  // logo abaixo, que não faz parte da extração do hook.
  //
  // Desde a RN-631 a janela é SOMADA a `roster.activatedAgents` do resumo
  // (RN-630, sessão inteira): sem isso, numa sessão longa a ativação do agente
  // saía dos 200 eventos e a oferta endereçada a ele voltava a parecer
  // aceitável. Ativação é monótona, então somar só corrige falso negativo.
  const activeFor = (agent: string) =>
    ativadosNaSessaoInteira.includes(agent) ||
    events.some(
      (e) =>
        e.type === 'agent.activated' &&
        (e.payload as { agent?: string })?.agent === agent,
    );

  // Handoff oferecido ainda não aceito → botão de aceitar, restrito a quem
  // CONVERSA nesta tela (RN-136). `handoffs` vem ordenado por `createdAt`
  // ASC (mais antigo primeiro — ver `DrizzleHandoffRepository#findBySession`),
  // e `OfferInfraHandoffUseCase` oferece o handoff pro Infra ANTES do Dev
  // Lead, na MESMA confirmação (FASE 14d) — um `.find()` sem este filtro
  // resolvia sempre pro mais antigo ainda pendente, e como Infra nunca é
  // aceito por AQUI (ele não é conversacional, nem está em
  // `AGENTES_DE_CHAT`), o card do Dev Lead só virava acionável DEPOIS de
  // alguém aceitar o de Infra num lugar que esta tela não mostra — na
  // prática, nunca. O handoff pro Infra continua NARRADO no fio (o
  // `handoff.offered` dele vira divisor mudo, já que nunca é "a oferta
  // atual"); só o card ACIONÁVEL é que fica restrito a quem sabe responder
  // aqui.
  //
  // Desde a RN-617 o Infra Lead CONVERSA e está em `AGENTES_DE_CHAT`, mas o
  // handoff dele segue fora DESTE card por NOME: o aceite dele tem o card
  // PRÓPRIO logo abaixo (RN-499), e deixá-lo cair aqui o ofereceria duas
  // vezes — e, por ser o mais antigo, voltaria a esconder o do Dev Lead.
  //
  // Desde a RN-631 (AT-253) são TODAS as ofertas pendentes, não a primeira:
  // o `.find()` elegia uma oferta só, e a mais antiga pendente escondia as
  // seguintes. O caso real foi o handoff MANUAL (ADR 0109/RN-440) ao PO,
  // que nunca ganhava botão (o casamento pelo ator não batia) e, sendo o
  // mais antigo, deixava sem botão toda oferta que viesse depois. Cada
  // oferta é o card do evento dela (casado pelo `handoffId`); duas pendentes
  // para o MESMO agente não viram dois botões iguais — vale a mais recente, e
  // aceitá-la ativa o agente, o que tira a outra daqui pelo `activeFor`.
  // Desde a RN-633 (AT-294) "já ativo" para a OFERTA é do PROJETO, não da
  // sessão: oferta a agente que já roda noutra sessão (o Dev Lead na sessão
  // de execução, por exemplo) não é acionável aqui — aceitá-la ativaria um
  // segundo. `activeFor` continua sendo DESTA sessão, porque é ele que o
  // seletor do handoff manual usa.
  const jaAtivo = (agent: string) => activeFor(agent) || ativosNoProjeto.includes(agent);
  const porDestino = new Map<string, Handoff>();
  for (const h of handoffs) {
    if (
      h.status === 'offered' &&
      !jaAtivo(h.toAgent) &&
      h.toAgent !== 'infra' &&
      (AGENTES_DE_CHAT as readonly string[]).includes(h.toAgent)
    ) {
      porDestino.set(h.toAgent, h);
    }
  }
  const ofertasAcionaveis = [...porDestino.values()];

  // A oferta cujo EVENTO saiu da janela (RN-631, revisão do PR #759). O card
  // acionável pertence ao `handoff.offered` (casado pelo `handoffId`), e a
  // lista de handoffs não tem janela: numa sessão longa a oferta continuava
  // `offered` e sem botão em lugar nenhum. O critério é o do corte, não o da
  // ausência — a oferta é MAIS ANTIGA que o evento mais antigo da janela.
  // Ausência só não basta: a lista de handoffs e a de eventos pollam
  // separadas, e uma oferta recém-criada cujo evento ainda não chegou
  // piscaria na faixa antes de ir para o fio. Janela vazia (carregando, ou
  // sessão sem evento) não afirma corte nenhum.
  const idsNaJanela = new Set<string>();
  let inicioDaJanela: number | null = null;
  for (const e of events) {
    const instante = Date.parse(e.createdAt);
    if (!Number.isNaN(instante) && (inicioDaJanela === null || instante < inicioDaJanela)) {
      inicioDaJanela = instante;
    }
    if (e.type !== 'handoff.offered') continue;
    const id = (e.payload as { handoffId?: string } | null)?.handoffId;
    if (id) idsNaJanela.add(id);
  }
  const ofertasForaDaJanela =
    inicioDaJanela === null
      ? []
      : ofertasAcionaveis.filter(
          (h) => !idsNaJanela.has(h.id) && Date.parse(h.createdAt) < inicioDaJanela!,
        );

  // O handoff da INFRA, que o filtro logo acima deixa de fora — e de
  // propósito. Até a RN-617 o motivo era o Infra Lead não conversar; desde
  // ela ele conversa, e o motivo que sobra é o do card próprio: ele mora na
  // faixa que não rola, e aceitar a Infra ativa um agente que PROPÕE.
  //
  // O que o comentário da RN-136 acima descreve como consequência aceita —
  // "Infra nunca é aceito por AQUI … na prática, nunca" — não era aceitável:
  // `acceptHandoff` tinha UM consumidor só (o card do fio, atrás daquele
  // filtro), então o handoff oferecido por `OfferInfraHandoffUseCase` ficava
  // `offered` para sempre, o Infra Lead nunca era ativado, e com ele nunca
  // vinha `propose_container_start` — a cadeia inteira "Infra aceita → propõe
  // `container_start` → aprovado → container `running`" era INALCANÇÁVEL por
  // tela nenhuma (RN-499).
  //
  // A correção foi um card PRÓPRIO, fora do fio, que chama o MESMO
  // `handleAcceptHandoff`. `activeFor` é o mesmo
  // predicado da linha acima — handoff já aceito (ou Infra já ativa nesta
  // sessão por qualquer outro caminho) não reabre convite nenhum.
  const handoffDaInfraOferecido = handoffs.find(
    (h) => h.status === 'offered' && h.toAgent === 'infra' && !jaAtivo('infra'),
  );

  // A prontidão já foi declarada? (achado L) O handoff que sai do Criativo é a
  // consequência dela — existindo, o botão não tem mais o que oferecer.
  //
  // Desde a RN-633 (AT-293) o handoff MANUAL não conta: ele grava como
  // `fromAgent` o último agente ativado, e um manual pedido com o Criativo
  // ativo escondia "Estou pronto" sem prontidão nenhuma declarada. O manual
  // se reconhece pelo ator humano do evento; fora da janela o ator é
  // desconhecido, e aí vale o `artifactId` — o handoff da prontidão leva o
  // `product_brief` (`criativo_server.ex`), o manual nunca leva artefato.
  const prontidaoJaDeclarada = handoffs.some((h) => {
    if (h.fromAgent !== 'criativo') return false;
    const origem = origemDoHandoff(h, events);
    return origem === 'agente' || (origem === 'desconhecida' && h.artifactId !== null);
  });
  // Espelho de `prontidaoJaDeclarada`, para o Arquiteto (problema 1):
  // `OfferInfraHandoffUseCase` oferece o handoff ao Infra (e ao Dev Lead) na
  // MESMA confirmação — a existência de QUALQUER handoff saindo do Arquiteto
  // já prova que a confirmação aconteceu. Salvo o MANUAL (RN-633): os dois
  // automáticos não levam artefato, então aqui não há marca de reserva, e o
  // de origem desconhecida (fora da janela) segue contando, como antes.
  const arquiteturaJaDeclarada = handoffs.some(
    (h) => h.fromAgent === 'arquiteto' && origemDoHandoff(h, events) !== 'manual',
  );

  return {
    activeFor,
    ofertasAcionaveis,
    ofertasForaDaJanela,
    handoffDaInfraOferecido,
    prontidaoJaDeclarada,
    arquiteturaJaDeclarada,
  };
}
