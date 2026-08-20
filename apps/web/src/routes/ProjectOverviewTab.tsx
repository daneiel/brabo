import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useArchitecture,
  useBacklog,
  useCurrentWorkspace,
  useHandoffs,
  useLatestSession,
  usePendingActions,
  useProjectsSummary,
  useSessionEventHistory,
  useSessionEvents,
  useSessionTokenUsage,
} from '../lib/hooks';
import {
  activateExecution,
  requestParallelization,
  getAgentModelBinding,
  listAgentAutonomy,
  listModels,
  rearmDevAgent,
  setAgentAutonomy,
  unblockTask,
} from '../lib/api-client';
import {
  deriveAgentRoster,
  groupRosterByArea,
  isExecutorGroup,
} from '../lib/agent-status';
import { deriveExecutionProgress, formatMicros } from '../lib/execution';
import { connectSessionHeartbeat } from '../lib/session-channel';
import type { AutonomyMode } from '../components/AgentCard';
import { AgentTeamGrid } from '../components/AgentTeamGrid';
import { AgentTimelineTree } from '../components/AgentTimelineTree';
import { ActivityFeed } from '../components/ActivityFeed';
import { ErroDeCarregamento } from '../components/ErroDeCarregamento';
import { Skeleton } from '../components/ui/Skeleton';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/ToastProvider';
import type { AgentAutonomyActionType, Architecture, ProposedAction, SessionEvent } from '../lib/api-types';
import styles from './ProjectOverviewTab.module.css';

interface ProjectOverviewTabProps {
  projectId: string;
}

export function ProjectOverviewTab({ projectId }: ProjectOverviewTabProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { latest: latestSession } = useLatestSession(projectId);
  const sessionId = latestSession?.id;
  // ESTADO ATUAL — a cauda em poll, que alimenta a roster, a árvore e a
  // seção de execução. Continua `latest` de propósito: as três perguntam
  // "como está agora", e nenhuma delas pagina.
  const eventsQuery = useSessionEvents(projectId, sessionId);
  const events = eventsQuery.data?.items ?? [];
  // HISTÓRICO — o que a coluna de Atividade mostra, em páginas (RN-099).
  // Mesma `queryKey` da cauda por dentro: nenhuma requisição a mais por ciclo.
  const historico = useSessionEventHistory(projectId, sessionId);
  const actionsQuery = usePendingActions(projectId, sessionId);
  const actions = actionsQuery.data?.items ?? [];
  const { data: architecture } = useArchitecture(projectId);
  const handoffsQuery = useHandoffs(projectId, sessionId);
  const handoffs = handoffsQuery.data ?? [];

  // `execution.activated` é dos PRIMEIROS eventos de uma sessão de execução —
  // `useSessionEvents` só traz os ÚLTIMOS 200 (`latest: true`), então numa
  // sessão real ele sai da janela e `events.some(...)` volta a mentir "nunca
  // ativou" (roster de dev agents some, e a seção Execução volta a oferecer
  // "Ativar execução" para uma execução que já está rodando). O resumo do
  // workspace (RN-090) agrega TODOS os eventos no backend
  // (`projects-summary.repository.ts`), então é ele — não a janela — quem
  // decide.
  const { data: workspace } = useCurrentWorkspace();
  const summaryQuery = useProjectsSummary(workspace?.id);
  const projectSummary = summaryQuery.data?.find((s) => s.projectId === projectId);
  const executionActivated = projectSummary?.roster.executionActivated ?? false;
  // Agentes com ação pendente de aprovação entram como `aguardando` — antes
  // esse estado era inalcançável e o contador do header ficava sempre em 0.
  const pendingActionAgentIds = new Set(
    actions.filter((a) => a.status === 'pending').map((a) => a.actor.id),
  );
  // LIMITAÇÃO CONHECIDA, não corrigida aqui: `deriveAgentRoster` também
  // decide QA/SecOps por `gatesEverOpened`, calculado por dentro de
  // `rosterFactsFromEvents` direto sobre a MESMA janela de 200 eventos —
  // sofre da classe de defeito acima. O resumo já carrega o valor agregado
  // certo (`ProjectCardSummary.roster.gatesEverOpened`), mas corrigi-lo aqui
  // exigiria mudar a ASSINATURA de `deriveAgentRoster`/`rosterFactsFromEvents`
  // (aceitar um override, como já existe para `executionActivated`) — fora
  // do escopo desta correção, que não deve tocar `lib/agent-status.ts`.
  const roster = deriveAgentRoster(
    events,
    architecture?.moduleMap,
    executionActivated,
    handoffs,
    pendingActionAgentIds,
  );
  // A task/branch corrente por agente já era derivada aqui perto, mas só
  // alimentava a ExecutionSection — o mesmo dev aparecia duas vezes na tela,
  // uma com o dado e outra sem.
  const progressByAgent = deriveExecutionProgress(events);
  const { data: tokenUsage } = useSessionTokenUsage(projectId, sessionId);

  const { data: modelsByCategory } = useQuery({
    // A chave carrega o projeto porque a lista é do WORKSPACE dele (ADR 0049):
    // um cache global devolveria a curadoria de outro workspace.
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

  // Áreas recolhidas no painel (Fase 8d) — vazio por padrão: a hierarquia
  // fica visível de cara, o usuário recolhe se quiser menos ruído.
  const [collapsedAreas, setCollapsedAreas] = useState<Set<string>>(new Set());
  function toggleArea(areaKey: string) {
    setCollapsedAreas((current) => {
      const next = new Set(current);
      if (next.has(areaKey)) next.delete(areaKey);
      else next.add(areaKey);
      return next;
    });
  }

  // Agrupamento por área vem de `groupRosterByArea` (lib/agent-status.ts,
  // compartilhado com o card do dashboard) — devolve ENTRADAS, não índices;
  // `bindingQueries`/`tokenUsage` seguem indexados pela roster inteira, daí
  // o `roster.indexOf(...)` na hora de renderizar (roster é sempre pequena).
  const rosterGroups = groupRosterByArea(roster);

  // Fase 4a — painel do time ao vivo: qualquer evento persistido (Dev/QA/
  // SecOps/Infra) ou `agent.status` (Criativo/PO/Arquiteto/Infra) antecipa
  // o refetch do polling — mesmo princípio de SessionPage.tsx.
  useEffect(() => {
    if (!sessionId || latestSession?.status !== 'active') return;
    const disconnect = connectSessionHeartbeat(projectId, sessionId, {
      onEvent: () => {
        queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
        // O backlog também: tasks bloqueadas vêm dele, não do event log —
        // sem isto o destaque de blocked só aparece no poll de 4s.
        queryClient.invalidateQueries({ queryKey: ['backlog', projectId] });
      },
      onAgentStatus: () => {
        queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      },
    });
    return disconnect;
  }, [sessionId, latestSession?.status, projectId, queryClient]);

  // `setAgentAutonomy` existia no api-client desde a Fase 4a e nunca tinha
  // sido chamado de lugar nenhum — o toggle do design nunca renderizou.
  async function handleAutonomyChange(
    agentId: string,
    actionType: string,
    mode: AutonomyMode,
  ) {
    try {
      await setAgentAutonomy(projectId, {
        agentId,
        actionType: actionType as AgentAutonomyActionType,
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

  // Única saída de idle_tripped (Fase 12b — RN-047): sem sessionId (sessão
  // não carregou ainda) o botão nem aparece — deriveAgentRoster depende de
  // eventos da sessão, então os dois chegam juntos na prática.
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

  // FASE 27 — dev/QA saem daqui para a aba Executores (RN-121); o resto do
  // time (Criativo/PO/Arquiteto/Infra) continua na Visão geral. Contagem do
  // cabeçalho e a árvore abaixo passam a refletir só o que a Visão geral
  // ainda desenha — mostrar "10 agentes" com 6 cards na tela contaria dado
  // que sumiu do grid.
  const overviewGroups = rosterGroups.filter((group) => !isExecutorGroup(group));
  const overviewRosterIds = new Set(
    overviewGroups.flatMap((group) =>
      group.kind === 'solo' ? [group.entry.id] : [group.lead.id, ...group.members.map((m) => m.id)],
    ),
  );
  const overviewRoster = roster.filter((r) => overviewRosterIds.has(r.id));
  const overviewEvents = events.filter(
    (e) => e.actor.kind !== 'agent' || overviewRosterIds.has(e.actor.id),
  );
  const workingCount = overviewRoster.filter((r) => r.status === 'trabalhando').length;
  const waitingCount = overviewRoster.filter((r) => r.status === 'aguardando').length;

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <div className={styles.sectionRow}>
          <h2 className={styles.sectionHeader}>Time de agentes</h2>
          <span className={styles.sectionCount}>
            {overviewRoster.length} agentes · {workingCount} trabalhando · {waitingCount} aguardando
          </span>
        </div>
        <AgentTeamGrid
          roster={roster}
          groups={overviewGroups}
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

        {/* A árvore vem LOGO ABAIXO dos cards do time, e não na coluna de
            atividade: os cards dizem quem existe e em que estado está; a
            árvore diz o que cada um fez e está fazendo. São a mesma pergunta
            em duas profundidades, e separá-las em colunas diferentes obrigava
            a olhar duas vezes.
            Os eventos vão FILTRADOS (sem dev/QA — RN-121): a aba Executores
            tem a própria árvore, e mostrar os mesmos ramos nas duas telas
            era duplicar a mesma pergunta sem ganhar nada. */}
        <h2 className={styles.sectionHeader}>Linha do tempo do time</h2>
        <div className={styles.sectionSub}>
          Um ramo por agente, do primeiro marco ao que ele está fazendo agora.
          Quem está ativo, ou entre os 5 mais recentes, abre sozinho — o resto
          fica a um clique, com a contagem de marcos novos no cabeçalho.
        </div>
        <AgentTimelineTree events={overviewEvents} projectId={projectId} />

        <ExecutionSection
          projectId={projectId}
          sessionId={sessionId}
          hasModuleMap={!!architecture?.moduleMap}
          events={events}
          actions={actions}
          executionActivated={executionActivated}
          executionActivatedPending={summaryQuery.isPending}
          executionActivatedError={summaryQuery.isError ? summaryQuery.error : null}
          onRetryExecutionActivated={() => void summaryQuery.refetch()}
        />

        <ArchitectureSummary projectId={projectId} architecture={architecture} />
      </div>

      <aside className={styles.aside}>
        <div className={styles.sectionRow}>
          <h2 className={styles.sectionHeader}>Atividade</h2>
          <span className={styles.sectionCount}>
            {historico.carregados} eventos
          </span>
        </div>
        {/* Os três estados, e o ERRO antes do vazio (RN-088): `!dados` é
            verdadeiro nos três, e colapsá-los era o que fazia a coluna dizer
            "nenhuma atividade" quando na verdade a api tinha recusado. */}
        {historico.isError ? (
          <ErroDeCarregamento
            titulo="Não foi possível carregar a atividade."
            erro={historico.error}
            onTentarDeNovo={historico.refetch}
          />
        ) : historico.isPending ? (
          <Skeleton height={180} />
        ) : (
          <ActivityFeed
            events={historico.events}
            agentOptions={roster.map((r) => ({ id: r.id, label: r.def.name }))}
            onLoadOlder={historico.carregarMaisAntigos}
            hasOlder={historico.temMaisAntigos}
            loadingOlder={historico.carregandoMaisAntigos}
          />
        )}
      </aside>
    </div>
  );
}

function ExecutionSection({
  projectId,
  sessionId,
  hasModuleMap,
  events,
  actions,
  executionActivated,
  executionActivatedPending,
  executionActivatedError,
  onRetryExecutionActivated,
}: {
  projectId: string;
  sessionId?: string;
  hasModuleMap: boolean;
  events: SessionEvent[];
  actions: ProposedAction[];
  /** Agregado do resumo do workspace — ver comentário no componente pai. */
  executionActivated: boolean;
  executionActivatedPending: boolean;
  executionActivatedError: unknown;
  onRetryExecutionActivated: () => void;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: epics } = useBacklog(projectId);

  const activated = executionActivated;

  // Dev agents a partir do event log: módulo/branch/task (dev.started/
  // dev.working) + iteração/custo ao vivo do ÚLTIMO agent.response do agente
  // (emitido pelo ToolLoop a cada turno de LLM). A redução é pura e vive em
  // lib/execution.ts, testada lá.
  const agents = deriveExecutionProgress(events);

  const blockedTasks = (epics ?? []).flatMap((epic) =>
    epic.stories.flatMap((story) =>
      story.tasks
        .filter((t) => t.blocked)
        .map((t) => ({ id: t.id, title: t.title, storyTitle: story.title, blockedReason: t.blockedReason })),
    ),
  );

  // Sugestões de paralelização ainda não aceitas.
  const acceptedModules = new Set(
    events
      .filter((e) => e.type === 'execution.parallelization_accepted')
      .map((e) => (e.payload as { module?: string }).module),
  );
  const suggestions = events
    .filter((e) => e.type === 'execution.parallelization_suggested')
    .map((e) => (e.payload as { module?: string }).module)
    .filter((m): m is string => !!m && !acceptedModules.has(m));

  const prs = actions
    .filter((a) => a.actionType === 'pr_open')
    .map((a) => ({
      id: a.id,
      status: a.status,
      url:
        (a.executionResult as { pullRequestUrl?: string } | null)?.pullRequestUrl ?? null,
    }));

  async function handleActivate() {
    try {
      await activateExecution(projectId);
      await queryClient.invalidateQueries({ queryKey: ['sessions', projectId] });
    } catch {
      showToast({ title: 'Erro', message: 'Não foi possível ativar a execução', tone: 'danger' });
    }
  }

  async function handleUnblock(taskId: string) {
    if (!sessionId) return;
    try {
      await unblockTask(projectId, sessionId, taskId);
      await queryClient.invalidateQueries({ queryKey: ['backlog', projectId] });
    } catch {
      showToast({
        title: 'Erro',
        message: 'Não foi possível desbloquear a task',
        tone: 'danger',
      });
    }
  }

  async function handleAccept(module: string) {
    if (!sessionId) return;
    try {
      const r = await requestParallelization(projectId, sessionId, module);
      await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });

      // Acima do teto NADA subiu (RN-083). Sem esta distinção a tela diria que
      // o agente entrou, e o usuário só descobriria que não pelo trabalho que
      // não anda — que é exatamente o modo de falha que o pipeline de
      // aprovação existe para tornar visível.
      if (r.estado === 'aguardando_autorizacao') {
        showToast({
          title: 'Precisa da sua autorização',
          message: `A sessão já tem ${r.ativosNaSessao} agente(s), o teto do lead é ${r.maxParallel}. O pedido está em Aprovações.`,
          tone: 'warning',
        });
      } else if (r.estado === 'recusado') {
        showToast({ title: 'Pedido recusado', message: r.motivo, tone: 'danger' });
      }
    } catch {
      showToast({ title: 'Erro', message: 'Não foi possível pedir', tone: 'danger' });
    }
  }

  return (
    <div className={styles.arch}>
      <div className={styles.sectionHeader}>Execução</div>
      {/* Os três estados da RN-088: sem eles, "resumo ainda não chegou"
          (`executionActivatedPending`) ficava indistinguível de "nunca
          ativou" e oferecia "Ativar execução" de novo para uma execução que
          já está rodando. */}
      {executionActivatedError ? (
        <ErroDeCarregamento
          titulo="Não foi possível saber se a execução já foi ativada."
          erro={executionActivatedError}
          onTentarDeNovo={onRetryExecutionActivated}
        />
      ) : executionActivatedPending ? (
        <div className={styles.sectionSub} aria-busy="true">
          <Skeleton width={220} height={18} />
        </div>
      ) : !activated ? (
        <div className={styles.execIntro}>
          <div className={styles.sectionSub}>
            {hasModuleMap
              ? 'Ative a execução para os dev agents implementarem o backlog em paralelo.'
              : 'Defina o module_map (Arquiteto) antes de ativar a execução.'}
          </div>
          <Button variant="primary" onClick={handleActivate} disabled={!hasModuleMap}>
            Ativar execução
          </Button>
        </div>
      ) : (
        <>
          <div className={styles.archLabel}>Dev agents</div>
          {agents.size === 0 ? (
            <div className={styles.sectionSub}>Subindo os agentes…</div>
          ) : (
            <div className={styles.moduleGrid}>
              {[...agents.entries()].map(([agentId, a]) => (
                <div key={agentId} className={styles.moduleCard}>
                  <div className={styles.moduleName}>{agentId}</div>
                  <div className={styles.moduleStack}>módulo: {a.module}</div>
                  {a.taskTitle && (
                    <div className={styles.moduleResp}>task: {a.taskTitle}</div>
                  )}
                  {a.branch && <div className={styles.depChip}>{a.branch}</div>}
                  {a.iteration !== undefined && (
                    <div className={styles.moduleResp}>
                      iteração {a.iteration} · custo {formatMicros(a.tokensSpentMicros ?? 0)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {blockedTasks.length > 0 && (
            <>
              <div className={styles.archLabel}>
                Tasks bloqueadas
                <Badge tone="danger">{blockedTasks.length}</Badge>
              </div>
              <ul className={styles.pendList}>
                {blockedTasks.map((t) => (
                  <li key={t.id} className={styles.pendItem}>
                    <span className={styles.pendTitle}>
                      {t.title} <span className={styles.moduleStack}>({t.storyTitle})</span>
                    </span>
                    <span className={styles.pendReason}>
                      {t.blockedReason ?? 'sem diagnóstico'}
                    </span>
                    <Button variant="secondary" onClick={() => handleUnblock(t.id)}>
                      Desbloquear
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {suggestions.map((module) => (
            <div key={module} className={styles.suggestion}>
              <span>
                Há tarefas independentes em <strong>{module}</strong> — subir um dev extra?
              </span>
              <Button variant="secondary" onClick={() => handleAccept(module)}>
                Aceitar
              </Button>
            </div>
          ))}

          <div className={styles.archLabel}>Pull requests</div>
          {prs.length === 0 ? (
            <div className={styles.sectionSub}>Nenhuma PR aberta ainda.</div>
          ) : (
            <ul className={styles.adrList}>
              {prs.map((pr) => (
                <li key={pr.id} className={styles.adrItem}>
                  <Badge tone={pr.status === 'executed' ? 'success' : 'warning'}>{pr.status}</Badge>
                  {pr.url ? (
                    <a href={pr.url} target="_blank" rel="noreferrer" className={styles.adrLink}>
                      {pr.url}
                    </a>
                  ) : (
                    <span>PR</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Resumo condensado (PROGRAMA de abas agrupadas — Onda 3): a seção INTEIRA
 * (módulos, diagrama, ADRs, pendências) virou aba própria
 * (`ProjectArchitectureTab.tsx`, extraída 1:1 daqui) — repeti-la aqui seria
 * duplicar o corpo inteiro, o mesmo erro que a Onda 1 já evitou para PRs.
 * O que fica é o suficiente para decidir se vale abrir a aba: quantos
 * módulos existem e se o diagrama já foi gerado.
 */
function ArchitectureSummary({
  projectId,
  architecture,
}: {
  projectId: string;
  architecture?: Architecture;
}) {
  const moduleCount = architecture?.moduleMap?.modules.length ?? 0;
  const diagramaGerado = architecture?.c4Diagram.status === 'gerado';

  return (
    <div className={styles.arch}>
      <div className={styles.sectionHeader}>Arquitetura</div>
      <div className={styles.sectionSub}>
        {moduleCount > 0
          ? `${moduleCount} módulo${moduleCount === 1 ? '' : 's'} mapeado${moduleCount === 1 ? '' : 's'}, diagrama C4 ${diagramaGerado ? 'gerado' : 'pendente'}.`
          : 'Sem arquitetura ainda — o Arquiteto gera o module_map e os ADRs.'}{' '}
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          search={{ tab: 'arquitetura' }}
          className={styles.adrLink}
        >
          Ver arquitetura completa →
        </Link>
      </div>
    </div>
  );
}
