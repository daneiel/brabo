import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getProjectsSummary, getSessionTokenUsage } from './api-client';
import type { AgentTokenUsage, Handoff, SessionEvent } from './api-types';
import { intervaloDaSessao, useCanalDaSessaoVivo } from './canal-vivo';
import { pollQueParaNoErro } from './query-policy';
import { AGENTES_DE_CHAT } from './session-readiness';
import { addressableAgents } from './agents';

/**
 * O DESTINATÁRIO da mensagem do composer (RN-631, AT-251).
 *
 * Até aqui ele era DERIVADO: "o `agent.activated` mais recente dentro da
 * janela de 200 eventos". Isso era um destinatário padrão do lado da TELA —
 * a mesma classe de defeito que a RN-584 fechou no engine —, e ainda
 * invisível: o composer não dizia a quem a mensagem ia. Medido no uso real de
 * 29/09: `handoff.accepted` para a Infra, depois para o Arquiteto, e o "oi"
 * do usuário foi respondido pelo Arquiteto sem que nada na tela avisasse.
 *
 * A regra agora:
 * - As OPÇÕES são os agentes que conversam (`AGENTES_DE_CHAT`) e que JÁ
 *   ESTÃO nesta sessão — um `agent.activated` na janela, um `agent.activated`
 *   da sessão INTEIRA pelo resumo do projeto (`roster.activatedAgents`,
 *   RN-630), ou um handoff ACEITO para ele (a lista de handoffs não tem
 *   janela). Os dois últimos termos existem pela RN-180: numa sessão longa a
 *   ativação sai dos 200 eventos, e o agente não pode sumir do seletor por
 *   isso. Na sessão CRIATIVA o Criativo é opção mesmo antes de ativado,
 *   porque a primeira mensagem o ativa (achado 3).
 * - O destinatário é o que a PESSOA escolheu — no seletor do composer, ou
 *   aceitando um handoff nesta tela (o gesto de chamar aquele agente).
 *   Nada do log escolhe por ela: um handoff aceito em OUTRA aba, ou por
 *   outro caminho, só acrescenta uma opção.
 * - Com UMA opção só, ela é o destinatário: não há alternativa a que a
 *   mensagem pudesse ir, e o composer a NOMEIA antes do envio. Isso não é um
 *   padrão no sentido da RN-584 (que é entregar a alguém a mensagem que não
 *   foi endereçada a ele).
 * - Com DUAS ou mais e nenhuma escolha válida, NÃO há destinatário: o envio
 *   fica travado e a tela diz, em texto, que é preciso escolher.
 *
 * A escolha é lembrada POR SESSÃO no `localStorage` do navegador — conforto de
 * quem vê, nunca estado do produto: sem ela (aba anônima, armazenamento
 * bloqueado) a tela só volta a pedir a escolha.
 */

/**
 * O agente que a sessão CRIATIVA oferece antes de qualquer ativação: a
 * primeira mensagem o ativa. `scripts/ci/destinos-do-composer.spec.ts` lê
 * este literal (RN-584): todo destino do composer tem cláusula própria no
 * engine.
 */
export const DESTINATARIO_DA_SESSAO_CRIATIVA = 'criativo';

const CHAVE = (sessionId: string) => `brabo.destinatario.${sessionId}`;

function lerEscolha(sessionId: string): string | null {
  try {
    return window.localStorage.getItem(CHAVE(sessionId));
  } catch {
    return null;
  }
}

/** RN-712: a escolha feita no SELETOR do composer é manual e nunca é
 *  sobrescrita; a que veio de um gesto (aceite, "Estou pronto") segue o
 *  último handoff aceito. */
const CHAVE_MANUAL = (sessionId: string) => `brabo.destinatario.${sessionId}.manual`;

function lerManual(sessionId: string): boolean {
  try {
    return window.localStorage.getItem(CHAVE_MANUAL(sessionId)) === '1';
  } catch {
    return false;
  }
}

function gravarEscolha(sessionId: string, agente: string, manual = false): void {
  try {
    window.localStorage.setItem(CHAVE(sessionId), agente);
    if (manual) window.localStorage.setItem(CHAVE_MANUAL(sessionId), '1');
    else window.localStorage.removeItem(CHAVE_MANUAL(sessionId));
  } catch {
    // Sem armazenamento a escolha vale só enquanto a tela está aberta.
  }
}

/**
 * Quem já foi ativado na sessão PEDIDA, lido de fontes SEM a janela de 200
 * eventos (RN-630, RN-631) — a soma de três, todas escopadas a `sessionId`:
 *
 * 1. `roster.activatedAgents` do resumo do projeto, que é a sessão INTEIRA —
 *    mas só da sessão MAIS RECENTE do projeto. Vale só quando
 *    `latestSessionId === sessionId` (o molde da RN-568). Não basta sozinho:
 *    ativar a execução CRIA uma sessão nova, que vira a mais recente, e a
 *    sessão do chat de onde ela saiu perdia esta fonte inteira, voltando a
 *    depender da janela — o defeito que a revisão do PR #759 mediu.
 * 2. Os handoffs DESTA sessão (`useHandoffs`, sem janela): quem RECEBEU um
 *    handoff aceito entrou na sessão, e quem OFERECEU um estava nela (o
 *    `fromAgent` do handoff automático é o agente que chamou a ferramenta; o
 *    do manual é o último ativado, `request-manual-handoff.use-case.ts`).
 * 3. O gasto por agente DESTA sessão (`GET .../token-usage`, agregado sem
 *    janela): agente com linha ali rodou turno na sessão, e agente só roda
 *    turno depois de ativado. É prova de PRESENÇA e nunca de ausência — o
 *    Staff ativado que ainda não falou não gasta nada, e quem tem papel
 *    abaixo de `developer` (o mínimo da rota) recebe 403 e fica sem esta
 *    fonte. Por isso é SOMA: cada fonte só corrige falso negativo.
 *
 * O que continua sem fonte não janelada: agente ativado por `start` direto,
 * sem handoff, que nunca rodou turno, numa sessão que já não é a mais
 * recente. Fechar isso pede o agregado POR SESSÃO na api (`activatedAgents`
 * de uma sessão pedida), declarado na RN-631 e não feito aqui.
 *
 * Lê a MESMA `queryKey` de `useProjectsSummary` (o `Shell` a mantém viva a
 * 5s) e a de `useSessionTokenUsage`; não passa por `lib/hooks` só porque as
 * suítes da tela de Sessão substituem `lib/hooks` inteiro.
 */
export function useAtivadosNaSessaoInteira(
  workspaceId: string | undefined,
  projectId: string,
  sessionId: string,
  handoffs: readonly Handoff[] = [],
): string[] {
  const { data: resumo } = useQuery({
    queryKey: ['projects-summary', workspaceId],
    queryFn: () => getProjectsSummary(workspaceId!),
    enabled: !!workspaceId,
  });
  const canalVivo = useCanalDaSessaoVivo(sessionId);
  const { data: gasto } = useQuery({
    queryKey: ['session-token-usage', projectId, sessionId],
    queryFn: () => getSessionTokenUsage(projectId, sessionId),
    // Ativação é monótona e as outras duas fontes acompanham o recente:
    // esta cobre o antigo, e por isso a cadência é longa.
    refetchInterval: pollQueParaNoErro(
      intervaloDaSessao(INTERVALO_DO_GASTO_COMO_PRESENCA_MS, canalVivo),
    ),
  });
  const card = resumo?.find((c) => c.projectId === projectId);
  const doResumo =
    card && card.latestSessionId === sessionId ? card.roster.activatedAgents : undefined;
  return useMemo(
    () => ativadosSemJanela({ doResumo, handoffs, gasto }),
    [doResumo, handoffs, gasto],
  );
}

/**
 * Quem já foi ativado no PROJETO além desta sessão (RN-633, AT-294): o
 * `roster.activatedAgents` do resumo, que é a sessão MAIS RECENTE do projeto
 * — depois de "Ativar execução", a sessão de execução. Serve só para a
 * oferta de handoff não ser acionável a quem já roda noutra sessão.
 *
 * Lacuna declarada: sessões que não são nem esta nem a mais recente não são
 * vistas. Fechar pede um agregado de ativação POR PROJETO na api (todas as
 * sessões), que não existe hoje.
 */
export function useAtivosNoProjeto(
  workspaceId: string | undefined,
  projectId: string,
): string[] | undefined {
  const { data: resumo } = useQuery({
    queryKey: ['projects-summary', workspaceId],
    queryFn: () => getProjectsSummary(workspaceId!),
    enabled: !!workspaceId,
  });
  return resumo?.find((c) => c.projectId === projectId)?.roster.activatedAgents;
}

/** A cadência da terceira fonte de `useAtivadosNaSessaoInteira`. */
export const INTERVALO_DO_GASTO_COMO_PRESENCA_MS = 60_000;

/** A soma pura das três fontes de `useAtivadosNaSessaoInteira`. */
export function ativadosSemJanela({
  doResumo,
  handoffs,
  gasto,
}: {
  doResumo?: readonly string[];
  handoffs: readonly Handoff[];
  gasto?: readonly AgentTokenUsage[];
}): string[] {
  const presentes = new Set<string>(doResumo ?? []);
  for (const h of handoffs) {
    if (h.status === 'accepted') presentes.add(h.toAgent);
    presentes.add(h.fromAgent);
  }
  for (const linha of gasto ?? []) presentes.add(linha.actorId);
  return [...presentes].sort();
}

/** Os agentes a quem o composer pode endereçar, na ordem de `AGENTES_DE_CHAT`. */
export function agentesEmConversa(
  events: SessionEvent[],
  handoffs: Handoff[],
  kind: string | undefined,
  ativadosNaSessaoInteira: readonly string[] = [],
): string[] {
  const presentes = new Set<string>(ativadosNaSessaoInteira);
  for (const e of events) {
    if (e.type !== 'agent.activated') continue;
    const agente = (e.payload as { agent?: string } | null)?.agent;
    if (agente) presentes.add(agente);
  }
  for (const h of handoffs) {
    if (h.status === 'accepted') presentes.add(h.toAgent);
  }
  if (kind === 'criativa') presentes.add(DESTINATARIO_DA_SESSAO_CRIATIVA);
  return AGENTES_DE_CHAT.filter((agente) => presentes.has(agente));
}

/**
 * A escolha vale se ainda for uma opção; senão, só a opção ÚNICA vira
 * destinatário. Duas ou mais sem escolha é `null` — nunca "a mais recente".
 */
export function resolverDestinatario(
  opcoes: readonly string[],
  escolhido: string | null,
  seguir?: { manual: boolean; handoffs: readonly Handoff[] },
): string | null {
  // RN-712: escolha que NÃO veio do seletor segue o agente do último handoff
  // aceito (o PO que passou ao Arquiteto deixa de ser o "Para").
  if (seguir && !seguir.manual && escolhido) {
    const ultimo = ultimoHandoffAceito(seguir.handoffs);
    if (ultimo && opcoes.includes(ultimo)) return ultimo;
  }
  if (escolhido && opcoes.includes(escolhido)) return escolhido;
  if (opcoes.length === 1) return opcoes[0]!;
  return null;
}

/** O destino do handoff aceito mais recente (por `updatedAt`). */
export function ultimoHandoffAceito(handoffs: readonly Handoff[]): string | null {
  let ultimo: Handoff | null = null;
  for (const h of handoffs) {
    if (h.status !== 'accepted') continue;
    if (!ultimo || h.updatedAt > ultimo.updatedAt) ultimo = h;
  }
  return ultimo?.toAgent ?? null;
}

export interface DestinatarioDoChat {
  opcoes: string[];
  destinatario: string | null;
  /** Há mais de uma opção e ninguém foi escolhido: o envio fica travado. */
  precisaEscolher: boolean;
  /** `manual` = escolhido no seletor do composer (RN-712). */
  escolher: (agente: string, manual?: boolean) => void;
}

export function useDestinatarioDoChat({
  sessionId,
  events,
  handoffs,
  kind,
  ativadosNaSessaoInteira,
}: {
  sessionId: string;
  events: SessionEvent[];
  handoffs: Handoff[];
  kind: string | undefined;
  ativadosNaSessaoInteira?: readonly string[];
}): DestinatarioDoChat {
  const opcoes = useMemo(
    () => agentesEmConversa(events, handoffs, kind, ativadosNaSessaoInteira),
    [events, handoffs, kind, ativadosNaSessaoInteira],
  );
  // Guardado junto com a sessão a que pertence: trocar de sessão sem
  // desmontar a tela não pode herdar a escolha da anterior.
  const [escolha, setEscolha] = useState<{
    sessionId: string;
    agente: string | null;
    manual: boolean;
  }>(() => ({ sessionId, agente: lerEscolha(sessionId), manual: lerManual(sessionId) }));
  const escolhido =
    escolha.sessionId === sessionId ? escolha.agente : lerEscolha(sessionId);
  const manual = escolha.sessionId === sessionId ? escolha.manual : lerManual(sessionId);

  const escolher = useCallback(
    (agente: string, manualmente = false) => {
      setEscolha({ sessionId, agente, manual: manualmente });
      gravarEscolha(sessionId, agente, manualmente);
    },
    [sessionId],
  );

  const destinatario = resolverDestinatario(opcoes, escolhido, { manual, handoffs });
  return {
    opcoes,
    destinatario,
    precisaEscolher: destinatario === null && opcoes.length > 1,
    escolher,
  };
}

/**
 * Quem a consultiva sem agente pode CHAMAR para conversar (RN-682): os
 * agentes que conversam (`AGENTES_DE_CHAT`, a lista que o engine casa com
 * cláusula própria — RN-584) e que o handoff manual alcança
 * (`addressableAgents`), menos quem já entrou na sessão. Um agente que não
 * conversa (os leads de área sem cláusula de chat) seria chamado para receber
 * uma mensagem que o engine recusa.
 *
 * Sem o Criativo: só a consultiva fica sem opção de destinatário (na criativa
 * ele é opção desde antes de ativado), e a consultiva promete, no convite, que
 * o Criativo não entra — abrir a ideação é o que a criativa FAZ (RN-097).
 */
export function agentesParaChamar(activeFor: (agent: string) => boolean): string[] {
  const enderecaveis = new Set<string>(addressableAgents());
  return AGENTES_DE_CHAT.filter(
    (agente) =>
      agente !== DESTINATARIO_DA_SESSAO_CRIATIVA &&
      enderecaveis.has(agente) &&
      !activeFor(agente),
  );
}
