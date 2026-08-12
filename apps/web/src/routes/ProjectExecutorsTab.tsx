import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useActiveExecutionSession,
  useArchitecture,
  useHandoffs,
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
import { rotuloDaSessao } from '../lib/session-label';
import type { AutonomyMode } from '../components/AgentCard';
import { AgentTeamGrid } from '../components/AgentTeamGrid';
import { AgentTimelineTree } from '../components/AgentTimelineTree';
import { Badge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Skeleton';
import { ErroDeCarregamento } from '../components/ErroDeCarregamento';
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
 *
 * A SESSÃO que a aba lê é a de execução VIGENTE (RN-139,
 * `useActiveExecutionSession`) — `active` com `execution.activated` gravado —
 * e NUNCA a mais recente do projeto. Era `useLatestSession` antes: funcionava
 * só por coincidência (a sessão de execução costuma ser a mais nova) e
 * silenciosamente passava a olhar qualquer sessão nova criada depois (uma
 * ideação, um chat), vazia de eventos de dev/QA, sem pista nenhuma na tela. O
 * indicador logo abaixo do título mostra sempre QUAL sessão está sendo
 * exibida, nos três estados da RN-088.
 */
export function ProjectExecutorsTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const executionSessionQuery = useActiveExecutionSession(projectId);
  const executionSession = executionSessionQuery.session;
  const sessionId = executionSession?.id;
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
    if (!sessionId || executionSession?.status !== 'active') return;
    const disconnect = connectSessionHeartbeat(projectId, sessionId, {
      onEvent: () => {
        queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      },
      onAgentStatus: () => {
        queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      },
    });
    return disconnect;
  }, [sessionId, executionSession?.status, projectId, queryClient]);

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
        {sessionId && (
          <span className={styles.sectionCount}>
            {executorRoster.length} agentes · {workingCount} trabalhando · {waitingCount} aguardando
          </span>
        )}
      </div>
      <div className={styles.sectionSub}>
        Dev agent e QA — quem implementa e quem verifica. O resto do time está
        na Visão geral.
      </div>

      {/* Indicador de QUAL sessão a aba está olhando (RN-139) — os três
          estados da RN-088, erro antes de vazio: sem isto a troca silenciosa
          de sessão (achado desta investigação) volta a acontecer, só que
          desta vez escondida atrás de um indicador que mentiria "tudo bem". */}
      {executionSessionQuery.isError ? (
        <ErroDeCarregamento
          titulo="Não foi possível descobrir a sessão de execução deste projeto."
          erro={executionSessionQuery.error}
          onTentarDeNovo={() => void executionSessionQuery.refetch()}
        />
      ) : executionSessionQuery.isPending ? (
        <div className={styles.sectionSub} aria-busy="true">
          <Skeleton width={220} height={18} />
        </div>
      ) : !executionSession ? (
        <div className={styles.sectionSub}>
          Nenhuma execução ativa neste projeto no momento.
        </div>
      ) : (
        <div className={styles.sectionSub}>
          Mostrando{' '}
          <Link
            to="/projects/$projectId/sessions/$sessionId"
            params={{ projectId, sessionId: executionSession.id }}
          >
            {rotuloDaSessao(executionSession.id, executionSession.name)}
          </Link>{' '}
          <Badge tone="success" dot>
            {executionSession.status}
          </Badge>
        </div>
      )}

      {sessionId && (
        <>
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
        </>
      )}
    </div>
  );
}
