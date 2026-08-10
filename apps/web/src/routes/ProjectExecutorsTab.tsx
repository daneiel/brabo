import { useEffect, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useArchitecture,
  useHandoffs,
  useLatestSession,
  usePendingActions,
  useSessionEvents,
  useSessionTokenUsage,
} from '../lib/hooks';
import {
  getAgentModelBinding,
  listAgentAutonomy,
  listModels,
  rearmDevAgent,
  setAgentAutonomy,
} from '../lib/api-client';
import { deriveAgentRoster, groupRosterByArea, isExecutorAgentId, isExecutorGroup } from '../lib/agent-status';
import { deriveExecutionProgress } from '../lib/execution';
import { connectSessionHeartbeat } from '../lib/session-channel';
import type { AutonomyMode } from '../components/AgentCard';
import { AgentTeamGrid } from '../components/AgentTeamGrid';
import { AgentTimelineTree } from '../components/AgentTimelineTree';
import { useToast } from '../components/ui/ToastProvider';
import type { ActionType } from '../lib/api-types';
import styles from './ProjectOverviewTab.module.css';

/**
 * A aba Executores (FASE 27, RN-121) — dev agent e QA num lugar próprio, fora
 * do "Time de agentes" da Visão geral.
 *
 * O que forçou a separação: dev-<módulo> e QA (lead + subespecialidades) são
 * quem IMPLEMENTA e VERIFICA — a pergunta que quem acompanha execução faz é
 * diferente de "como está o time inteiro", e no grid misturado com
 * Criativo/PO/Arquiteto/Infra a resposta ficava perdida no meio de agentes
 * que não mudam de estado a cada poll.
 *
 * A tela reusa a MESMA renderização da Visão geral (`AgentTeamGrid`,
 * `AgentTimelineTree`) — nada foi reinventado aqui, só filtrado: quem decide
 * "é executor?" é `isExecutorGroup`/`isExecutorAgentId`
 * (`lib/agent-status.ts`), a mesma função que a Visão geral usa para EXCLUIR
 * os mesmos agentes. Uma decisão errada nos dois lugares apareceria como
 * duplicação ou sumiço, nunca como divergência silenciosa.
 *
 * A busca de dados é INDEPENDENTE da Visão geral — são duas rotas de aba
 * montadas uma de cada vez, e cada componente de rota resolve os próprios
 * hooks; o react-query dedup pela `queryKey` evita a requisição em dobro
 * quando as duas já rodaram na mesma sessão.
 */
export function ProjectExecutorsTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { latest: latestSession } = useLatestSession(projectId);
  const sessionId = latestSession?.id;
  const eventsQuery = useSessionEvents(projectId, sessionId);
  const events = eventsQuery.data?.items ?? [];
  const actionsQuery = usePendingActions(projectId, sessionId);
  const actions = actionsQuery.data?.items ?? [];
  const { data: architecture } = useArchitecture(projectId);
  const handoffsQuery = useHandoffs(projectId, sessionId);
  const handoffs = handoffsQuery.data ?? [];

  const executionActivated = events.some((e) => e.type === 'execution.activated');
  const pendingActionAgentIds = new Set(
    actions.filter((a) => a.status === 'pending').map((a) => a.actor.id),
  );
  const roster = deriveAgentRoster(
    events,
    architecture?.moduleMap,
    executionActivated,
    handoffs,
    pendingActionAgentIds,
  );
  const progressByAgent = deriveExecutionProgress(events);
  const { data: tokenUsage } = useSessionTokenUsage(projectId, sessionId);

  const { data: modelsByCategory } = useQuery({
    queryKey: ['models', projectId],
    queryFn: () => listModels(projectId),
  });
  const allModels = modelsByCategory
    ? [...Object.values(modelsByCategory.local).flat(), ...Object.values(modelsByCategory.cloud).flat()]
    : [];
  const bindingQueries = useQueries({
    queries: roster.map((r) => ({
      queryKey: ['agent-binding', projectId, r.id],
      queryFn: () => getAgentModelBinding(projectId, r.id),
    })),
  });
  const { data: autonomyRules } = useQuery({
    queryKey: ['agent-autonomy', projectId],
    queryFn: () => listAgentAutonomy(projectId),
  });

  const [collapsedAreas, setCollapsedAreas] = useState<Set<string>>(new Set());
  function toggleArea(areaKey: string) {
    setCollapsedAreas((current) => {
      const next = new Set(current);
      if (next.has(areaKey)) next.delete(areaKey);
      else next.add(areaKey);
      return next;
    });
  }

  const rosterGroups = groupRosterByArea(roster);
  const executorGroups = rosterGroups.filter(isExecutorGroup);
  const executorRosterIds = new Set(
    executorGroups.flatMap((group) =>
      group.kind === 'solo' ? [group.entry.id] : [group.lead.id, ...group.members.map((m) => m.id)],
    ),
  );
  const executorRoster = roster.filter((r) => executorRosterIds.has(r.id));
  const executorEvents = events.filter(
    (e) => e.actor.kind === 'agent' && isExecutorAgentId(e.actor.id),
  );
  const workingCount = executorRoster.filter((r) => r.status === 'trabalhando').length;
  const waitingCount = executorRoster.filter((r) => r.status === 'aguardando').length;

  useEffect(() => {
    if (!sessionId || latestSession?.status !== 'active') return;
    const disconnect = connectSessionHeartbeat(projectId, sessionId, {
      onEvent: () => {
        queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      },
      onAgentStatus: () => {
        queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      },
    });
    return disconnect;
  }, [sessionId, latestSession?.status, projectId, queryClient]);

  async function handleAutonomyChange(agentId: string, actionType: string, mode: AutonomyMode) {
    try {
      await setAgentAutonomy(projectId, {
        agentId,
        actionType: actionType as ActionType,
        mode: mode === 'auto' ? 'auto_approve' : 'require_approval',
      });
      await queryClient.invalidateQueries({ queryKey: ['agent-autonomy', projectId] });
    } catch {
      showToast({
        title: 'Não foi possível mudar a autonomia',
        message: `${agentId} · ${actionType}`,
        tone: 'danger',
      });
    }
  }

  async function handleRearm(agentId: string) {
    if (!sessionId) return;
    try {
      await rearmDevAgent(projectId, sessionId, agentId);
      await queryClient.invalidateQueries({
        queryKey: ['session-events', projectId, sessionId],
      });
      showToast({ title: 'Agente rearmado', tone: 'success' });
    } catch {
      showToast({ title: 'Não foi possível rearmar o agente', message: agentId, tone: 'danger' });
    }
  }

  // Sem `semRespiro` no registro: a moldura do `ProjectPage` já dá os 24px de
  // respiro e a rolagem própria (`.body`, `ProjectPage.module.css`) — reusar
  // `styles.main` aqui (que tem os MESMOS dois ajustes, pensados para dentro
  // do `.layout` de duas colunas da Visão geral) duplicaria padding e criaria
  // uma segunda área de scroll aninhada.
  return (
    <div>
      <div className={styles.sectionRow}>
        <h2 className={styles.sectionHeader}>Executores</h2>
        <span className={styles.sectionCount}>
          {executorRoster.length} agentes · {workingCount} trabalhando · {waitingCount} aguardando
        </span>
      </div>
      <div className={styles.sectionSub}>
        Dev agent e QA — quem implementa e quem verifica. O resto do time está
        na Visão geral.
      </div>

      {executorGroups.length === 0 ? (
        <div className={styles.sectionSub}>
          Nenhum dev agent ou QA entrou em ação nesta sessão ainda.
        </div>
      ) : (
        <AgentTeamGrid
          roster={roster}
          groups={executorGroups}
          events={events}
          bindingQueries={bindingQueries}
          allModels={allModels}
          tokenUsage={tokenUsage}
          autonomyRules={autonomyRules}
          progressByAgent={progressByAgent}
          collapsedAreas={collapsedAreas}
          onToggleArea={toggleArea}
          onAutonomyChange={handleAutonomyChange}
          onRearm={handleRearm}
        />
      )}

      <div className={styles.arch}>
        <h2 className={styles.sectionHeader}>Linha do tempo</h2>
      </div>
      <div className={styles.sectionSub}>
        Os ramos de dev agent e QA, do primeiro marco ao que estão fazendo
        agora.
      </div>
      <AgentTimelineTree events={executorEvents} projectId={projectId} />
    </div>
  );
}
