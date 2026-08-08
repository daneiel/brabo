import { useQueries } from '@tanstack/react-query';
import { listBacklog, listSessionEvents, listSessions } from './api-client';
import { getLastSeenSeq } from './read-state';
import { pollQueParaNoErro } from './query-policy';
import type { Project, Session } from './api-types';

function latestOf(sessions: Session[]): Session | undefined {
  return [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export interface ProjectUnread {
  project: Project;
  latestSession: Session | undefined;
  latestSeq: number;
  unreadCount: number;
}

export function useProjectsUnread(projects: Project[] | undefined): ProjectUnread[] {
  const sessionQueries = useQueries({
    queries: (projects ?? []).map((project) => ({
      queryKey: ['sessions', project.id],
      queryFn: () => listSessions(project.id),
      refetchInterval: pollQueParaNoErro(5000),
    })),
  });

  return (projects ?? []).map((project, index) => {
    const sessions = sessionQueries[index]?.data ?? [];
    const latestSession = latestOf(sessions);
    const latestSeq = latestSession ? latestSession.nextSeq - 1 : 0;
    const seen = getLastSeenSeq(project.id);
    return { project, latestSession, latestSeq, unreadCount: Math.max(0, latestSeq - seen) };
  });
}

/**
 * Quantas histórias esperam a promoção do usuário, por todos os projetos
 * (Fase 12c — RN-048).
 *
 * Deliberadamente SEPARADO de `useProjectsUnread`, e não somado ao
 * `unreadCount` dele: aquele contador é derivado de `seq` e o `onMarkRead` do
 * sino o zera gravando o último `seq` visto. Uma promoção pendente não é uma
 * mensagem não lida — ela continua pendente depois de vista, e some só quando
 * o usuário decide. Misturar as duas faria abrir o sino cancelar a fila de
 * decisões. Somam-se apenas no número exibido.
 */
export function useStoriesAwaitingPromotion(
  projects: Project[] | undefined,
): number {
  const backlogQueries = useQueries({
    queries: (projects ?? []).map((project) => ({
      queryKey: ['backlog', project.id],
      queryFn: () => listBacklog(project.id),
      refetchInterval: pollQueParaNoErro(5000),
    })),
  });

  return backlogQueries.reduce(
    (total, query) =>
      total +
      (query.data ?? []).reduce(
        (n, epic) => n + epic.stories.filter((s) => s.proposedReady).length,
        0,
      ),
    0,
  );
}

export interface NotificationGroupData {
  projectId: string;
  projectName: string;
  events: import('./api-types').SessionEvent[];
}

export function useNotificationGroups(unread: ProjectUnread[]): NotificationGroupData[] {
  const withUnread = unread.filter((u) => u.unreadCount > 0 && u.latestSession);

  const eventQueries = useQueries({
    queries: withUnread.map((u) => ({
      queryKey: ['session-events', u.project.id, u.latestSession!.id, 'unread', getLastSeenSeq(u.project.id)],
      queryFn: () => listSessionEvents(u.project.id, u.latestSession!.id, { afterSeq: getLastSeenSeq(u.project.id) }),
      refetchInterval: pollQueParaNoErro(5000),
    })),
  });

  return withUnread.map((u, index) => ({
    projectId: u.project.id,
    projectName: u.project.name,
    events: eventQueries[index]?.data?.items ?? [],
  }));
}
