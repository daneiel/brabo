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
  offeredHandoff: Handoff | undefined;
  handoffDaInfraOferecido: Handoff | undefined;
  prontidaoJaDeclarada: boolean;
  arquiteturaJaDeclarada: boolean;
  necessidadeJaValidada: boolean;
}

export function derivarHandoffsDaSessao(
  events: SessionEvent[],
  handoffs: Handoff[],
  ativadosNaSessaoInteira: readonly string[] = [],
): DerivacoesDeHandoff {
  // Um agente está ativo se houve um agent.activated pra ele nesta sessão.
  // Isto é EXISTÊNCIA histórica ("já entrou alguma vez"), não "é ele quem
  // fala AGORA". Cópia local de uma linha da mesma checagem que o hook usa
  // internamente pra `criativoActive`/`arquitetoActive` (`session-
  // readiness.ts`) — o único consumidor que sobra aqui é `offeredHandoff`,
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
  const offeredHandoff = handoffs.find(
    (h) =>
      h.status === 'offered' &&
      !activeFor(h.toAgent) &&
      h.toAgent !== 'infra' &&
      (AGENTES_DE_CHAT as readonly string[]).includes(h.toAgent),
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
    (h) => h.status === 'offered' && h.toAgent === 'infra' && !activeFor('infra'),
  );

  // A prontidão já foi declarada? (achado L) O handoff que sai do Criativo é a
  // consequência dela — existindo, o botão não tem mais o que oferecer.
  const prontidaoJaDeclarada = handoffs.some((h) => h.fromAgent === 'criativo');
  // Espelho de `prontidaoJaDeclarada`, para o Arquiteto (problema 1):
  // `OfferInfraHandoffUseCase` oferece o handoff ao Infra (e ao Dev Lead) na
  // MESMA confirmação — a existência de QUALQUER handoff saindo do Arquiteto
  // já prova que a confirmação aconteceu.
  const arquiteturaJaDeclarada = handoffs.some((h) => h.fromAgent === 'arquiteto');

  // A necessidade já foi validada? (RN-406) Diferente dos dois gates acima,
  // esta confirmação NÃO produz handoff — é só o registro
  // `necessity.validated` no event log, então a fonte é o próprio `events`.
  const necessidadeJaValidada = events.some((e) => e.type === 'necessity.validated');

  return {
    activeFor,
    offeredHandoff,
    handoffDaInfraOferecido,
    prontidaoJaDeclarada,
    arquiteturaJaDeclarada,
    necessidadeJaValidada,
  };
}
