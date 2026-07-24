import { useQueries } from '@tanstack/react-query';
import { listSessionEvents, listSessions } from './api-client';
import { getLastSeenSeq } from './read-state';
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
      refetchInterval: 5000,
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
      refetchInterval: 5000,
    })),
  });

  return withUnread.map((u, index) => ({
    projectId: u.project.id,
    projectName: u.project.name,
    events: eventQueries[index]?.data?.items ?? [],
  }));
}
