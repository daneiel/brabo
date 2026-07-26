import { useQuery } from '@tanstack/react-query';
import { getArchitecture, getCoverage, listActions, listBacklog, listHandoffs, listHypotheses, listInfraArtifacts, listProficiency, listProjects, listSessionEvents, listSessions, listWorkspaces, getSessionTokenUsage } from './api-client';
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
    // `latest`: os ÚLTIMOS 200, não os primeiros. Todo consumidor deste hook
    // (painel do time, seção de execução, feed, tab de Aprovações) deriva
    // estado ATUAL — com os primeiros 200 tudo congelava no começo da sessão
    // assim que ela passava desse tamanho, o que uma execução real faz fácil
    // (ver ADR 0021).
    queryFn: () =>
      listSessionEvents(projectId!, sessionId!, { limit: 200, latest: true }),
    enabled: !!projectId && !!sessionId,
    refetchInterval: intervalMs,
  });
}

// Custo por agente na sessão — alimenta os tokens de cada AgentCard no painel
// do time. Cadência mais lenta que os eventos: é número de exibição, não
// gatilho de decisão.
export function useSessionTokenUsage(
  projectId: string | undefined,
  sessionId: string | undefined,
) {
  return useQuery({
    queryKey: ['session-token-usage', projectId, sessionId],
    queryFn: () => getSessionTokenUsage(projectId!, sessionId!),
    enabled: !!projectId && !!sessionId,
    refetchInterval: 5000,
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

// Backlog do projeto (árvore épico→história→tarefa) — poll pra refletir o PO
// gerando em tempo real.
export function useBacklog(projectId: string | undefined, intervalMs = 4000) {
  return useQuery({
    queryKey: ['backlog', projectId],
    queryFn: () => listBacklog(projectId!),
    enabled: !!projectId,
    refetchInterval: intervalMs,
  });
}

// Rastreabilidade regra→stories do projeto.
export function useCoverage(projectId: string | undefined, intervalMs = 4000) {
  return useQuery({
    queryKey: ['coverage', projectId],
    queryFn: () => getCoverage(projectId!),
    enabled: !!projectId,
    refetchInterval: intervalMs,
  });
}

// Arquitetura do projeto (module_map + ADRs + pendências de validação cruzada).
export function useArchitecture(projectId: string | undefined, intervalMs = 4000) {
  return useQuery({
    queryKey: ['architecture', projectId],
    queryFn: () => getArchitecture(projectId!),
    enabled: !!projectId,
    refetchInterval: intervalMs,
  });
}

// Artefatos de infra do projeto (Fase 4a — InfraAgent) — PRs de infra
// passando pelos mesmos gates de QA/SecOps do dev.
export function useInfraArtifacts(projectId: string | undefined, intervalMs = 3000) {
  return useQuery({
    queryKey: ['infra-artifacts', projectId],
    queryFn: () => listInfraArtifacts(projectId!),
    enabled: !!projectId,
    refetchInterval: intervalMs,
  });
}

// Perfil de proficiência do projeto (Fase 4b — Anamnese). Muda devagar
// (só quando uma rodada periódica conclui), daí o poll lento.
export function useProficiency(projectId: string | undefined, intervalMs = 15000) {
  return useQuery({
    queryKey: ['proficiency', projectId],
    queryFn: () => listProficiency(projectId!),
    enabled: !!projectId,
    refetchInterval: intervalMs,
  });
}

// Hipóteses do Psicólogo (Fase 4b) — escopo de PROJETO, não de sessão:
// acumulam a cada sessão encerrada. Poll mais lento que os demais, já que
// só mudam quando uma sessão fecha ou o usuário aceita/descarta.
export function useHypotheses(projectId: string | undefined, intervalMs = 8000) {
  return useQuery({
    queryKey: ['hypotheses', projectId],
    queryFn: () => listHypotheses(projectId!),
    enabled: !!projectId,
    refetchInterval: intervalMs,
  });
}
