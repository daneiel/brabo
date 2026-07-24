import { useQuery } from '@tanstack/react-query';
import { listActions, listHandoffs, listProjects, listSessionEvents, listSessions, listWorkspaces } from './api-client';
import { classifyEvent } from './activity';
import { formatRelativeTime } from './time';

// App opera sobre o primeiro workspace do usuário — sem UI de troca de
// workspace ainda (nunca especificado nos mockups, ver design/COMPONENTS.md).
export function useCurrentWorkspace() {
  return useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
    select: (list) => list[0]?.workspace,
  });
}

export function useProjects(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => listProjects(workspaceId!),
    enabled: !!workspaceId,
  });
}

export function useProjectSessions(projectId: string | undefined) {
  return useQuery({
    queryKey: ['sessions', projectId],
    queryFn: () => listSessions(projectId!),
    enabled: !!projectId,
    refetchInterval: 5000,
  });
}

// Sessão mais recente do projeto — usada pra alimentar o feed de
// atividade da Visão geral e o sino de notificações via polling (decisão:
// "polling no frontend, sem mudar o backend" — o canal Phoenix continua
// só heartbeat).
export function useLatestSession(projectId: string | undefined) {
  const sessionsQuery = useProjectSessions(projectId);
  const latest = sessionsQuery.data
    ? [...sessionsQuery.data].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    : undefined;
  return { ...sessionsQuery, latest };
}

export function useSessionEvents(projectId: string | undefined, sessionId: string | undefined, intervalMs = 3000) {
  return useQuery({
    queryKey: ['session-events', projectId, sessionId],
    queryFn: () => listSessionEvents(projectId!, sessionId!, { limit: 200 }),
    enabled: !!projectId && !!sessionId,
    refetchInterval: intervalMs,
  });
}

// Texto de "última atividade" pro ProjectCard — busca só o último evento
// da sessão mais recente (afterSeq = latestSeq-1, limit 1), evitando
// paginar o log inteiro só pra exibir uma linha.
export function useProjectLastActivity(projectId: string): string {
  const { latest: session } = useLatestSession(projectId);
  const latestSeq = session ? session.nextSeq - 1 : 0;

  const eventsQuery = useQuery({
    queryKey: ['last-event', projectId, session?.id, latestSeq],
    queryFn: () => listSessionEvents(projectId, session!.id, { afterSeq: Math.max(0, latestSeq - 1), limit: 1 }),
    enabled: !!session && latestSeq > 0,
    refetchInterval: 5000,
  });

  const event = eventsQuery.data?.items[0];
  if (!event) return 'Sem atividade ainda';
  return `${classifyEvent(event).text} · ${formatRelativeTime(event.createdAt)}`;
}

export function usePendingActions(projectId: string | undefined, sessionId: string | undefined, intervalMs = 3000) {
  return useQuery({
    queryKey: ['session-actions', projectId, sessionId],
    queryFn: () => listActions(projectId!, sessionId!, { limit: 200 }),
    enabled: !!projectId && !!sessionId,
    refetchInterval: intervalMs,
  });
}

// Handoffs entre agentes da sessão (Fase 3b) — poll de 3s, como os eventos.
export function useHandoffs(projectId: string | undefined, sessionId: string | undefined, intervalMs = 3000) {
  return useQuery({
    queryKey: ['session-handoffs', projectId, sessionId],
    queryFn: () => listHandoffs(projectId!, sessionId!),
    enabled: !!projectId && !!sessionId,
    refetchInterval: intervalMs,
  });
}
