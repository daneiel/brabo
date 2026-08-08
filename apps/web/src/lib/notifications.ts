import { useQueries } from '@tanstack/react-query';
import { listSessionEvents } from './api-client';
import { getLastSeenSeq } from './read-state';
import { pollQueParaNoErro } from './query-policy';
import type { Project, ProjectCardSummary } from './api-types';

export interface ProjectUnread {
  project: Project;
  latestSessionId: string | null;
  latestSeq: number;
  unreadCount: number;
}

/**
 * Quantos eventos cada projeto tem além do último que o usuário viu.
 *
 * PURO — nenhuma consulta. `latestSeq` chega pronto no resumo do workspace
 * (RN-090); antes este hook baixava TODAS as sessões de CADA projeto a cada
 * 5s só para ordenar por data e ficar com a mais recente. Como o Shell é
 * montado em toda rota, aquilo pollava o workspace inteiro até em telas que
 * não mostram card nenhum.
 */
export function useProjectsUnread(
  projects: Project[] | undefined,
  summaries: ProjectCardSummary[] | undefined,
): ProjectUnread[] {
  const porProjeto = new Map(
    (summaries ?? []).map((s) => [s.projectId, s] as const),
  );

  return (projects ?? []).map((project) => {
    const summary = porProjeto.get(project.id);
    const latestSeq = summary?.latestSeq ?? 0;
    const seen = getLastSeenSeq(project.id);
    return {
      project,
      latestSessionId: summary?.latestSessionId ?? null,
      latestSeq,
      unreadCount: Math.max(0, latestSeq - seen),
    };
  });
}

/**
 * Quantas histórias esperam a promoção do usuário, somando todos os projetos
 * (Fase 12c — RN-048).
 *
 * Deliberadamente SEPARADO da contagem de não lidos, e não somado ao
 * `unreadCount`: aquele contador é derivado de `seq` e o `onMarkRead` do sino
 * o zera gravando o último `seq` visto. Uma promoção pendente não é uma
 * mensagem não lida — ela continua pendente depois de vista, e some só quando
 * o usuário decide. Misturar as duas faria abrir o sino cancelar a fila de
 * decisões. Somam-se apenas no número exibido.
 *
 * Virou função pura pelo mesmo motivo do hook acima: a contagem vem do resumo
 * do workspace, e não de um `listBacklog` por projeto — que baixava a árvore
 * inteira de épicos, histórias e tarefas para contar uma flag.
 */
export function storiesAwaitingPromotion(
  summaries: ProjectCardSummary[] | undefined,
): number {
  return (summaries ?? []).reduce(
    (total, s) => total + s.storiesAwaitingPromotion,
    0,
  );
}

export interface NotificationGroupData {
  projectId: string;
  projectName: string;
  events: import('./api-types').SessionEvent[];
}

/**
 * O conteúdo da gaveta do sino: os eventos não lidos, por projeto.
 *
 * É a única leitura do dashboard que continua sendo POR PROJETO, e é
 * irredutível: o corte de onde começar a ler é o `seq` que cada navegador
 * guarda em `read-state`, que o servidor não conhece.
 *
 * `aberto` resolve o resto. A gaveta só é RENDERIZADA quando aberta, então
 * buscar antes disso era pagar N requisições por uma lista que ninguém está
 * vendo — agora elas saem no clique. O badge não depende daqui: o número vem
 * de `latestSeq`, que já está no resumo.
 */
export function useNotificationGroups(
  unread: ProjectUnread[],
  aberto: boolean,
): NotificationGroupData[] {
  const withUnread = unread.filter(
    (u) => u.unreadCount > 0 && u.latestSessionId,
  );

  const eventQueries = useQueries({
    queries: withUnread.map((u) => ({
      queryKey: [
        'session-events',
        u.project.id,
        u.latestSessionId!,
        'unread',
        getLastSeenSeq(u.project.id),
      ],
      queryFn: () =>
        listSessionEvents(u.project.id, u.latestSessionId!, {
          afterSeq: getLastSeenSeq(u.project.id),
        }),
      enabled: aberto,
      refetchInterval: pollQueParaNoErro(5000),
    })),
  });

  return withUnread.map((u, index) => ({
    projectId: u.project.id,
    projectName: u.project.name,
    events: eventQueries[index]?.data?.items ?? [],
  }));
}
