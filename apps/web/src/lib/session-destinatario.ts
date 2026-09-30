import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getProjectsSummary } from './api-client';
import type { Handoff, SessionEvent } from './api-types';
import { AGENTES_DE_CHAT } from './session-readiness';

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

function gravarEscolha(sessionId: string, agente: string): void {
  try {
    window.localStorage.setItem(CHAVE(sessionId), agente);
  } catch {
    // Sem armazenamento a escolha vale só enquanto a tela está aberta.
  }
}

/**
 * `roster.activatedAgents` do resumo do projeto (RN-630): quem já foi
 * ativado na sessão INTEIRA. Só vale com o resumo da MESMA sessão
 * (`latestSessionId === sessionId`), no molde da RN-568 — resumo de outra
 * sessão, ou nenhum, é `undefined`, e a janela decide sozinha.
 *
 * Lê a MESMA `queryKey` de `useProjectsSummary` (o `Shell` a mantém viva a
 * 5s): nenhum poll novo. Não passa por `useProjectsSummary` só porque as
 * suítes da tela de Sessão substituem `lib/hooks` inteiro.
 */
export function useAtivadosNaSessaoInteira(
  workspaceId: string | undefined,
  projectId: string,
  sessionId: string,
): string[] | undefined {
  const { data } = useQuery({
    queryKey: ['projects-summary', workspaceId],
    queryFn: () => getProjectsSummary(workspaceId!),
    enabled: !!workspaceId,
  });
  const card = data?.find((c) => c.projectId === projectId);
  if (!card || card.latestSessionId !== sessionId) return undefined;
  return card.roster.activatedAgents;
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
): string | null {
  if (escolhido && opcoes.includes(escolhido)) return escolhido;
  if (opcoes.length === 1) return opcoes[0]!;
  return null;
}

export interface DestinatarioDoChat {
  opcoes: string[];
  destinatario: string | null;
  /** Há mais de uma opção e ninguém foi escolhido: o envio fica travado. */
  precisaEscolher: boolean;
  escolher: (agente: string) => void;
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
  const [escolha, setEscolha] = useState<{ sessionId: string; agente: string | null }>(
    () => ({ sessionId, agente: lerEscolha(sessionId) }),
  );
  const escolhido =
    escolha.sessionId === sessionId ? escolha.agente : lerEscolha(sessionId);

  const escolher = useCallback(
    (agente: string) => {
      setEscolha({ sessionId, agente });
      gravarEscolha(sessionId, agente);
    },
    [sessionId],
  );

  const destinatario = resolverDestinatario(opcoes, escolhido);
  return {
    opcoes,
    destinatario,
    precisaEscolher: destinatario === null && opcoes.length > 1,
    escolher,
  };
}
