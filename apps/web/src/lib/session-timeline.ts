import type { ReactNode } from 'react';
import type { OrigemDeEvento } from './activity';
import type { ProposedAction, SessionEvent, SessionStatus } from './api-types';

export interface TimelineEntry {
  seq: number;
  node: ReactNode;
  /**
   * Autor-agente desta entrada (colapso por agente, RN-138) — só populado
   * para entradas que representam FALA/AÇÃO de um agente específico
   * (`agent.response`, `agent.error`, épico/história criados pelo PO, card
   * de aprovação). Ausente em entrada de usuário e em divisores/cards que
   * marcam uma TRANSIÇÃO (handoff, promoção de história): são pontos de
   * corte por natureza, e por isso sempre quebram um agrupamento em vez de
   * participar dele.
   */
  agentId?: string;
  /**
   * Quem PRODUZIU a entrada, no formato `<kind>:<id>` do `Actor` — sempre
   * populado, inclusive para usuário e para as entradas de transição.
   *
   * É DELIBERADAMENTE diferente de `agentId`, e uma não substitui a outra:
   * `agentId` responde "esta entrada participa do colapso por agente?" (e
   * por isso o divisor de handoff o deixa vazio de propósito), enquanto
   * `autor` responde "de quem é o turno em que ela nasceu?" — pergunta que o
   * afundamento de desfecho (RN-172) precisa fazer sobre TODAS elas.
   */
  autor: string;
  /**
   * O TURNO a que a entrada pertence (RN-172): o `seq` da última ABERTURA de
   * turno que não é posterior a ela, ou `0` no prólogo (antes da primeira).
   */
  turno: number;
  /**
   * A entrada é o DESFECHO do turno (RN-172) — handoff oferecido e card de
   * aprovação. Afunda para o fim do próprio turno em vez de ficar onde o
   * `seq` a colocou.
   */
  desfecho?: boolean;
  /**
   * A CAMADA de onde a entrada veio (RN-177) — o mesmo eixo do painel de log,
   * e é ele que dá nome aos grupos do histórico recolhido do fio.
   *
   * Não substitui `agentId` nem `autor`: os três respondem perguntas
   * diferentes ("participa do colapso por agente?", "de quem é o turno?",
   * "de que camada veio?").
   */
  origem: OrigemDeEvento;
  /**
   * A entrada nasceu de um evento `agent.response` — o único marcador que
   * `agruparNarracoesDoTurno` (em `SessionPage.tsx`) lê pra decidir o que
   * agrupar. Não é redundante com `agentId` (que também existe em
   * `agent.error`, épico/história criados pelo PO, o divisor de
   * `delegation.*`…): sem um campo próprio, a função teria que reconhecer o
   * TIPO de evento por fora do `TimelineEntry`, que já não carrega mais essa
   * informação neste ponto.
   */
  agentResponse?: boolean;
}

/**
 * As ABERTURAS de turno de uma sessão (RN-172) — os `seq` dos eventos cujo
 * ator é o USUÁRIO.
 *
 * O critério não é arbitrário: um turno de agente só começa porque alguém de
 * fora o começou, e é sempre o usuário. `SendAgentMessageUseCase` grava
 * `chat.message`, `ActivateAgentUseCase` grava `agent.activated`,
 * devolver/promover história grava
 * `backlog.story_promotion_returned`/`backlog.story_transitioned` — e TODOS
 * gravam `actor: { kind: 'user', … }`. Dentro do turno, ao contrário, tudo
 * que o engine emite (`agent.response`, `handoff.offered`,
 * `proposed_action.created`, `backlog.story_created`…) tem ator AGENTE.
 *
 * Ator `system` NÃO abre turno, de propósito: é ruído de infraestrutura no
 * meio do fio, não uma decisão de quem conversa.
 */
export function aberturasDeTurno(eventos: SessionEvent[]): number[] {
  return eventos
    .filter((e) => e.actor.kind === 'user')
    .map((e) => e.seq)
    .sort((a, b) => a - b);
}

/** O turno de um ponto do eixo: a última abertura que não é posterior a ele. */
export function turnoDoSeq(aberturas: number[], seq: number): number {
  let turno = 0;
  for (const abertura of aberturas) {
    if (abertura > seq) break;
    turno = abertura;
  }
  return turno;
}

/**
 * RN-172 — handoff oferecido e card de aprovação são o DESFECHO do turno, e
 * por isso aparecem DEPOIS da última fala dele.
 *
 * Isto NÃO é conserto de ordenação: a ordem por `seq` continua fiel ao event
 * log e a RN-155 segue valendo inteira. O que o log registra é que
 * `po_server.ex` (`run_turn/2`) emite, na MESMA iteração, o `agent.response`
 * do turno, DEPOIS o `tool.call` de `offer_handoff` (que grava
 * `handoff.offered`) e SÓ ENTÃO recursa para o `agent.response` de
 * fechamento. O `seq` do handoff é, honestamente, menor que o da última fala
 * — e mostrar "passou o bastão" no meio da conversa é leitura errada de um
 * dado certo. O mesmo vale para `proposed_action.created`, que nasce no meio
 * do turno enquanto o agente ainda tem o que dizer.
 *
 * A regra de APRESENTAÇÃO é: um desfecho desce até o fim do trecho logo
 * abaixo dele, parando na primeira entrada que falhe QUALQUER uma das três
 * condições — e são elas que garantem que turnos diferentes nunca se
 * misturam:
 *
 * 1. **mesmo turno** (`turno`): protege o caso em que a fronteira entre dois
 *    turnos não tem entrada VISÍVEL nenhuma — `agent.activated` abre turno e
 *    não vira item do fio. Sem isto, o handoff do turno N desceria para
 *    dentro do turno N+1 do mesmo agente.
 * 2. **mesmo autor** (`autor`): em sessão de EXECUÇÃO vários agentes escrevem
 *    sem que o usuário fale uma única vez, e todos ficam no mesmo turno; o
 *    desfecho de um deles não pode atravessar a fala de outro.
 * 3. **não é desfecho**: dois desfechos seguidos preservam a ordem entre si —
 *    o `handoff.offered` do Infra antes do Dev Lead, na MESMA confirmação
 *    (FASE 14d), continua nessa ordem.
 *
 * A varredura vai do FIM para o começo justamente para que um desfecho já
 * reposicionado seja a parada do desfecho anterior, e nunca o contrário.
 */
export function afundarDesfechos(entradas: TimelineEntry[]): TimelineEntry[] {
  const resultado = [...entradas];
  for (let i = resultado.length - 1; i >= 0; i -= 1) {
    const entrada = resultado[i];
    if (!entrada.desfecho) continue;
    let destino = i;
    while (destino + 1 < resultado.length) {
      const proxima = resultado[destino + 1];
      if (proxima.desfecho) break;
      if (proxima.turno !== entrada.turno) break;
      if (proxima.autor !== entrada.autor) break;
      destino += 1;
    }
    if (destino === i) continue;
    // `splice` de remoção primeiro: quem estava em `destino` desce uma
    // posição, e inserir EM `destino` deixa a entrada logo depois dele.
    resultado.splice(i, 1);
    resultado.splice(destino, 0, entrada);
  }
  return resultado;
}

/**
 * O ponto de estado da barra de topo, derivado da máquina de estados da sessão
 * (`created → active → closing → closed | closed_abnormally`).
 *
 * Uma entrada por estado, sem `default` embutido: estado novo na máquina passa
 * a exigir uma decisão aqui em vez de herdar calado a aparência de "ao vivo".
 */
const PONTO_DA_SESSAO: Record<
  SessionStatus,
  { classe: 'pulsing' | 'statusDotParado' | 'statusDotFalha'; rotuloKey: string }
> = {
  created: { classe: 'statusDotParado', rotuloKey: 'status.created' },
  active: { classe: 'pulsing', rotuloKey: 'status.active' },
  closing: { classe: 'statusDotParado', rotuloKey: 'status.closing' },
  closed: { classe: 'statusDotParado', rotuloKey: 'status.closed' },
  closed_abnormally: { classe: 'statusDotFalha', rotuloKey: 'status.closedAbnormally' },
};

/**
 * `rotuloKey` é a CHAVE de tradução (namespace `sessionPage`), não o texto —
 * quem chama resolve com `t()`. Manter a função pura (sem depender do hook
 * `useTranslation`) é o que permite `session-timeline.test.ts` testá-la sem
 * precisar montar um `I18nextProvider`.
 */
export function pontoDaSessao(status: SessionStatus | undefined) {
  // Sem sessão carregada ainda não é "encerrada": é desconhecido, e o ponto
  // fica apagado até o dado chegar.
  return status ? PONTO_DA_SESSAO[status] : { classe: 'statusDotParado' as const, rotuloKey: 'status.loading' };
}

/**
 * Posição de uma `ProposedAction` na timeline (RN-155) — NUNCA `action.seq`
 * cru. Ele é `bigserial` ÚNICO e GLOBAL da tabela `proposed_actions` inteira
 * (contraste DELIBERADO com `session_events.seq`, documentado no próprio
 * `apps/api/src/db/schema.ts`), compartilhado por TODAS as sessões e
 * projetos do sistema — comparar os dois espaços numéricos direto (o que o
 * código fazia antes) produzia ordem imprevisível toda vez que um
 * `ApprovalCard` entrava na mistura com eventos normais: confirmado ao vivo,
 * card de aprovação aparecendo antes do fim da resposta do agente, e
 * mensagens de handoff/aprovação fora de ordem depois de handoffs.
 *
 * `ProposeActionUseCase` grava, na MESMA transação que cria a ação, um
 * evento `proposed_action.created` no event log com `payload.actionId`
 * apontando pra ela (`apps/api/.../actions/propose-action.use-case.ts`) — o
 * `seq` DESSE evento é o eixo certo: gapless, por SESSÃO, o MESMO espaço
 * numérico que todo o resto da timeline já usa. Empatar com o seq do evento
 * que a originou é intencional: a ordenação de `Array.prototype.sort` é
 * ESTÁVEL (garantida desde ES2019) e o código empurra os eventos pro array
 * ANTES das ações, então o card sempre cai IMEDIATAMENTE DEPOIS do evento
 * que o motivou, nunca antes nem misturado com outro turno.
 *
 * Duas rotas de criação (o bootstrap de Gitflow — `BootstrapRunner` e
 * `ProvisionRepositoryUseCase`, para `git_repo_create`/`git_branch_create`
 * etc.) gravam a ação sem esse evento — só outbox, que é transporte pro
 * engine e não aparece aqui. Pra essas, degrada pra `createdAt`: ancora no
 * último evento cujo `createdAt` não é depois do da ação (o único eixo que
 * os dois lados têm em comum) — `+ 0.5` pra nunca empatar com o seq de um
 * evento de verdade, o que preservaria a garantia de posição estrita só pra
 * quem tem vínculo direto.
 */
export function ordemDaAcaoNaTimeline(
  action: ProposedAction,
  eventos: SessionEvent[],
): number {
  const eventoVinculado = eventos.find(
    (e) =>
      e.type === 'proposed_action.created' &&
      (e.payload as { actionId?: unknown })?.actionId === action.id,
  );
  if (eventoVinculado) return eventoVinculado.seq;

  const alvo = new Date(action.createdAt).getTime();
  let ancoraSeq = 0;
  let ancoraCreatedAt = -Infinity;
  for (const e of eventos) {
    const t = new Date(e.createdAt).getTime();
    if (t <= alvo && t >= ancoraCreatedAt) {
      ancoraCreatedAt = t;
      ancoraSeq = e.seq;
    }
  }
  return ancoraSeq + 0.5;
}
