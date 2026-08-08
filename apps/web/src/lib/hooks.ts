import { useQuery } from '@tanstack/react-query';
import { getArchitecture, getCoverage, getProjectsStatus, getProjectsSummary, getSessionEvent, getWorkspaceSummary, listActions, listBacklog, listHandoffs, listHypotheses, listInfraArtifacts, listProficiency, listProjects, listPsychologistAnalyses, listSessionEvents, listSessions, listWorkspaces, getSessionTokenUsage } from './api-client';
// Todo poll deste arquivo passa por aqui: um `refetchInterval` numérico não
// sabe parar, e a api limita 300 req/min por usuário (ver `query-policy.ts`).
import { pollQueParaNoErro } from './query-policy';

// App opera sobre o primeiro workspace do usuário — sem UI de troca de
// workspace ainda (nunca especificado nos mockups, ver design/COMPONENTS.md).
export function useCurrentWorkspace() {
  return useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
    select: (list) => list[0]?.workspace,
  });
}

// Irmão de `useCurrentWorkspace()`: aquele descarta `role` no `select`
// (call sites atuais só querem o `Workspace`) — este devolve o par
// completo, pro rodapé da sidebar mostrar o papel RBAC de quem chamou.
// MESMA queryKey ['workspaces']: o React Query deduplica com o hook acima
// quando os dois estão montados juntos, sem round-trip extra.
export function useCurrentWorkspaceWithRole() {
  return useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
    select: (list) => list[0],
  });
}

export function useProjects(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => listProjects(workspaceId!),
    enabled: !!workspaceId,
  });
}

// Resumo do topo do dashboard: N projetos · M agentes · gasto do mês. Sem
// refetchInterval — não é um número que precisa de frescor de segundos, e um
// erro aqui não pode derrubar a grade de cards (que vem de queries à parte).
export function useWorkspaceSummary(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['workspace-summary', workspaceId],
    queryFn: () => getWorkspaceSummary(workspaceId!),
    enabled: !!workspaceId,
  });
}

// Contagem de tasks bloqueadas por projeto, pro dot de status da sidebar —
// UMA chamada pro workspace inteiro (não uma por projeto). Sem
// refetchInterval de propósito: o Shell é montado em TODA rota, e o dot é
// leitura periférica, não painel ao vivo — mount + refetch no foco (mesma
// cadência do `budget`) já é atualização suficiente.
export function useProjectsStatus(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['projects-status', workspaceId],
    queryFn: () => getProjectsStatus(workspaceId!),
    enabled: !!workspaceId,
  });
}

/**
 * A GRADE INTEIRA de cards do dashboard numa requisição (RN-090).
 *
 * Substitui sete consultas em POLL por card — repositório, orçamento,
 * bootstrap, sessões, último evento, arquitetura, handoffs, ações pendentes e
 * backlog. Com 23 projetos aquilo dava 3.824 req/min contra um limite de 300,
 * e a tela inteira voltava 429 (a PR #193 fez a app PARAR de sangrar; esta
 * reduz o pedido).
 *
 * 5s, a cadência mais lenta entre as que ele substitui: o card é leitura
 * periférica — quem quer o segundo a segundo abre o projeto, e lá as queries
 * por sessão continuam exatamente como eram.
 */
export function useProjectsSummary(
  workspaceId: string | undefined,
  intervalMs = 5000,
) {
  return useQuery({
    queryKey: ['projects-summary', workspaceId],
    queryFn: () => getProjectsSummary(workspaceId!),
    enabled: !!workspaceId,
    refetchInterval: pollQueParaNoErro(intervalMs),
  });
}

export function useProjectSessions(projectId: string | undefined) {
  return useQuery({
    queryKey: ['sessions', projectId],
    queryFn: () => listSessions(projectId!),
    enabled: !!projectId,
    refetchInterval: pollQueParaNoErro(5000),
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
    refetchInterval: pollQueParaNoErro(intervalMs),
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
    refetchInterval: pollQueParaNoErro(5000),
  });
}

// `useProjectLastActivity` e `useProjectHasRecentActivity` viviam aqui e
// foram REMOVIDOS com o resumo do workspace (RN-090): os dois buscavam o
// último evento da sessão mais recente de UM projeto, e o card e o dot da
// sidebar — os únicos consumidores — leem isso de `lastEvent`, que já vem na
// linha do projeto. Não voltem: reintroduzi-los é reintroduzir o N+1.

export function usePendingActions(projectId: string | undefined, sessionId: string | undefined, intervalMs = 3000) {
  return useQuery({
    queryKey: ['session-actions', projectId, sessionId],
    queryFn: () => listActions(projectId!, sessionId!, { limit: 200 }),
    enabled: !!projectId && !!sessionId,
    refetchInterval: pollQueParaNoErro(intervalMs),
  });
}

// Handoffs entre agentes da sessão (Fase 3b) — poll de 3s, como os eventos.
export function useHandoffs(projectId: string | undefined, sessionId: string | undefined, intervalMs = 3000) {
  return useQuery({
    queryKey: ['session-handoffs', projectId, sessionId],
    queryFn: () => listHandoffs(projectId!, sessionId!),
    enabled: !!projectId && !!sessionId,
    refetchInterval: pollQueParaNoErro(intervalMs),
  });
}

// Backlog do projeto (árvore épico→história→tarefa) — poll pra refletir o PO
// gerando em tempo real.
export function useBacklog(projectId: string | undefined, intervalMs = 4000) {
  return useQuery({
    queryKey: ['backlog', projectId],
    queryFn: () => listBacklog(projectId!),
    enabled: !!projectId,
    refetchInterval: pollQueParaNoErro(intervalMs),
  });
}

// Rastreabilidade regra→stories do projeto.
export function useCoverage(projectId: string | undefined, intervalMs = 4000) {
  return useQuery({
    queryKey: ['coverage', projectId],
    queryFn: () => getCoverage(projectId!),
    enabled: !!projectId,
    refetchInterval: pollQueParaNoErro(intervalMs),
  });
}

// Arquitetura do projeto (module_map + ADRs + pendências de validação cruzada).
export function useArchitecture(projectId: string | undefined, intervalMs = 4000) {
  return useQuery({
    queryKey: ['architecture', projectId],
    queryFn: () => getArchitecture(projectId!),
    enabled: !!projectId,
    refetchInterval: pollQueParaNoErro(intervalMs),
  });
}

// Artefatos de infra do projeto (Fase 4a — InfraAgent) — PRs de infra
// passando pelos mesmos gates de QA/SecOps do dev.
export function useInfraArtifacts(projectId: string | undefined, intervalMs = 3000) {
  return useQuery({
    queryKey: ['infra-artifacts', projectId],
    queryFn: () => listInfraArtifacts(projectId!),
    enabled: !!projectId,
    refetchInterval: pollQueParaNoErro(intervalMs),
  });
}

// Perfil de proficiência do projeto (Fase 4b — Anamnese). Muda devagar
// (só quando uma rodada periódica conclui), daí o poll lento.
export function useProficiency(projectId: string | undefined, intervalMs = 15000) {
  return useQuery({
    queryKey: ['proficiency', projectId],
    queryFn: () => listProficiency(projectId!),
    enabled: !!projectId,
    refetchInterval: pollQueParaNoErro(intervalMs),
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
    refetchInterval: pollQueParaNoErro(intervalMs),
  });
}

// Análises current do Psicólogo com tier e custo — mesma cadência das
// hipóteses (mudam juntas: uma análise nova traz hipóteses novas).
export function usePsychologistAnalyses(
  projectId: string | undefined,
  intervalMs = 8000,
) {
  return useQuery({
    queryKey: ['psychologist-analyses', projectId],
    queryFn: () => listPsychologistAnalyses(projectId!),
    enabled: !!projectId,
    refetchInterval: pollQueParaNoErro(intervalMs),
  });
}

// UM evento pelo id. Existe pro chip de evidência de uma hipótese chegar no
// evento citado mesmo quando ele está fora da janela dos últimos 200 OU é
// um tipo que o feed esconde como ruído de máquina (`agent.response`,
// `tool.call`, `tool.result` — justamente o que o Psicólogo mais cita).
// Sem refetchInterval: evento é imutável, não tem por que repolar.
export function useSessionEvent(
  projectId: string | undefined,
  sessionId: string | undefined,
  eventId: string | undefined,
) {
  return useQuery({
    queryKey: ['session-event', projectId, sessionId, eventId],
    queryFn: () => getSessionEvent(projectId!, sessionId!, eventId!),
    enabled: !!projectId && !!sessionId && !!eventId,
    staleTime: Infinity,
    retry: false,
  });
}
