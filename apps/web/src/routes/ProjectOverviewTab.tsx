import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useArchitecture,
  useBacklog,
  useHandoffs,
  useHypotheses,
  useLatestSession,
  usePsychologistAnalyses,
  usePendingActions,
  useSessionEvents,
  useSessionTokenUsage,
} from '../lib/hooks';
import {
  activateExecution,
  acceptParallelization,
  acceptHypothesis,
  dismissHypothesis,
  getAgentModelBinding,
  listAgentAutonomy,
  listModels,
  reanalyzeSession,
  rearmDevAgent,
  setAgentAutonomy,
  unblockTask,
} from '../lib/api-client';
import {
  breakerReasonFor,
  deriveAgentRoster,
  groupRosterByArea,
  subagentOutcomeLabel,
} from '../lib/agent-status';
import { AREAS, areaFor } from '../lib/agents';
import { ChevronDownIcon, ChevronRightIcon } from '../components/ui/icons';
import { deriveExecutionProgress, formatMicros } from '../lib/execution';
import { connectSessionHeartbeat } from '../lib/session-channel';
import { AgentCard, type AutonomyMode } from '../components/AgentCard';
import { ActivityFeed } from '../components/ActivityFeed';
import { HypothesisCard } from '../components/HypothesisCard';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/ToastProvider';
import type { ActionType, Architecture, ProposedAction, SessionEvent } from '../lib/api-types';
import styles from './ProjectOverviewTab.module.css';

// actionType representativo de cada agente, pra resumir a autonomia num
// toggle só (auto_approve vira "auto"). TODO agente precisa de uma entrada:
// antes só `infra` e `dev-*` tinham, então criativo/po/arquiteto/qa/secops
// nunca recebiam a prop e o card saía sem o controle que o design pede.
const AUTONOMY_ACTION_TYPE: Record<string, string> = {
  infra: 'open_infra_pr',
  criativo: 'write_file',
  po: 'write_file',
  arquiteto: 'open_adr_pr',
  qa: 'terminal',
  secops: 'terminal',
};
function autonomyActionTypeFor(agentId: string): string {
  return AUTONOMY_ACTION_TYPE[agentId] ?? (agentId.startsWith('dev-') ? 'pr_open' : 'terminal');
}

interface ProjectOverviewTabProps {
  projectId: string;
}

export function ProjectOverviewTab({ projectId }: ProjectOverviewTabProps) {
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
  // Agentes com ação pendente de aprovação entram como `aguardando` — antes
  // esse estado era inalcançável e o contador do header ficava sempre em 0.
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
    const disconnect = connectSessionHeartbeat(sessionId, {
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

  const workingCount = roster.filter((r) => r.status === 'trabalhando').length;
  const waitingCount = roster.filter((r) => r.status === 'aguardando').length;

  // Card do LEAD (ou de um agente solo) — mesma renderização de sempre,
  // com toggle de autonomia (é quem propõe ação/tem policy).
  function renderLeadCard(index: number, badge?: string) {
    const r = roster[index];
    const modelId = bindingQueries[index]?.data?.modelId;
    const model = allModels.find((m) => m.id === modelId);
    const autonomyType = autonomyActionTypeFor(r.id);
    const rule = autonomyRules?.find((a) => a.agentId === r.id && a.actionType === autonomyType);
    const progress = progressByAgent.get(r.id);
    const custo = tokenUsage?.find((u) => u.actorId === r.id)?.costMicros;
    return (
      <AgentCard
        key={r.id}
        agent={r.def}
        status={r.status}
        badge={badge}
        model={model ? { name: model.displayName, provider: model.provider } : undefined}
        // Sem regra gravada o default do domínio é require_approval —
        // "manual". Mostrar o toggle sempre é o que o design pede, e
        // é o que torna a autonomia AJUSTÁVEL daqui.
        autonomy={rule?.mode === 'auto_approve' ? 'auto' : 'manual'}
        onAutonomyChange={(mode) => handleAutonomyChange(r.id, autonomyType, mode)}
        onRearm={r.status === 'travado' ? () => handleRearm(r.id) : undefined}
        activity={
          r.status === 'travado'
            ? { label: breakerReasonFor(events, r.id) ?? 'circuit breaker disparado' }
            : progress?.taskTitle
              ? { label: progress.taskTitle, branch: progress.branch }
              : undefined
        }
        tokensMicros={custo}
      />
    );
  }

  // Card de SUBAGENTE (Fase 8d) — compacto, sem toggle de autonomia (não
  // propõe ação própria, não tem policy) e sem branch/task corrente (não
  // trabalha em cima de uma) — a "atividade" aqui é o desfecho da
  // delegação mais recente.
  function renderMemberCard(index: number) {
    const r = roster[index];
    const modelId = bindingQueries[index]?.data?.modelId;
    const model = allModels.find((m) => m.id === modelId);
    const custo = tokenUsage?.find((u) => u.actorId === r.id)?.costMicros;
    const outcome = subagentOutcomeLabel(events, r.id);
    return (
      <AgentCard
        key={r.id}
        agent={r.def}
        status={r.status}
        compact
        model={model ? { name: model.displayName, provider: model.provider } : undefined}
        activity={outcome ? { label: outcome } : undefined}
        tokensMicros={custo}
      />
    );
  }

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <div className={styles.sectionHeader}>Time de agentes</div>
        <div className={styles.sectionSub}>
          {roster.length} agentes · {workingCount} trabalhando · {waitingCount} aguardando
        </div>
        <div className={styles.grid}>
          {rosterGroups.map((group) => {
            if (group.kind === 'solo') {
              return renderLeadCard(roster.indexOf(group.entry));
            }

            const area = AREAS[group.areaKey];
            const collapsed = collapsedAreas.has(group.areaKey);
            return (
              <div key={group.areaKey} className={styles.areaGroup}>
                {renderLeadCard(roster.indexOf(group.lead), 'Lead')}
                {group.members.length > 0 && (
                  <div className={styles.areaMembers}>
                    <button
                      type="button"
                      className={styles.areaToggle}
                      onClick={() => toggleArea(group.areaKey)}
                    >
                      {collapsed ? <ChevronRightIcon size={13} /> : <ChevronDownIcon size={13} />}
                      {area.label} · {group.members.length} subespecialidade
                      {group.members.length > 1 ? 's' : ''}
                    </button>
                    {!collapsed && (
                      <div className={styles.areaMembersList}>
                        {group.members.map((m) => renderMemberCard(roster.indexOf(m)))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <ExecutionSection
          projectId={projectId}
          sessionId={sessionId}
          hasModuleMap={!!architecture?.moduleMap}
          events={events}
          actions={actions}
        />

        <ArchitectureSection architecture={architecture} />

        <InsightsSection projectId={projectId} />
      </div>

      <aside className={styles.aside}>
        <div className={styles.sectionHeader}>Atividade</div>
        <div className={styles.sectionSub}>{events.length} eventos</div>
        <ActivityFeed
          events={events}
          agentOptions={roster.map((r) => ({ id: r.id, label: r.def.name }))}
        />
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
}: {
  projectId: string;
  sessionId?: string;
  hasModuleMap: boolean;
  events: SessionEvent[];
  actions: ProposedAction[];
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: epics } = useBacklog(projectId);

  const activated = events.some((e) => e.type === 'execution.activated');

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
      await acceptParallelization(projectId, sessionId, module);
      await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
    } catch {
      showToast({ title: 'Erro', message: 'Não foi possível aceitar', tone: 'danger' });
    }
  }

  return (
    <div className={styles.arch}>
      <div className={styles.sectionHeader}>Execução</div>
      {!activated ? (
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

const ADR_TONE: Record<string, BadgeTone> = {
  pending: 'warning',
  approved: 'accent',
  executed: 'success',
  failed: 'danger',
  denied: 'muted',
};

function ArchitectureSection({ architecture }: { architecture?: Architecture }) {
  const moduleMap = architecture?.moduleMap;
  const adrs = architecture?.adrs ?? [];
  const pendencies = architecture?.pendencies ?? [];

  const isEmpty = !moduleMap && adrs.length === 0 && pendencies.length === 0;

  return (
    <div className={styles.arch}>
      <div className={styles.sectionHeader}>Arquitetura</div>
      {isEmpty ? (
        <div className={styles.sectionSub}>
          Sem arquitetura ainda — o Arquiteto gera o module_map e os ADRs.
        </div>
      ) : (
        <>
          <div className={styles.archLabel}>
            Módulos {moduleMap ? `· v${moduleMap.version}` : ''}
          </div>
          {!moduleMap || moduleMap.modules.length === 0 ? (
            <div className={styles.sectionSub}>Nenhum módulo ainda.</div>
          ) : (
            <div className={styles.moduleGrid}>
              {moduleMap.modules.map((m) => (
                <div key={m.name} className={styles.moduleCard}>
                  <div className={styles.moduleName}>{m.name}</div>
                  <div className={styles.moduleStack}>{m.stack}</div>
                  <div className={styles.moduleResp}>{m.responsibility}</div>
                  {m.dependsOn.length > 0 && (
                    <div className={styles.deps}>
                      {m.dependsOn.map((d) => (
                        <span key={d} className={styles.depChip}>
                          {d}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className={styles.archLabel}>ADRs</div>
          {adrs.length === 0 ? (
            <div className={styles.sectionSub}>Nenhum ADR proposto ainda.</div>
          ) : (
            <ul className={styles.adrList}>
              {adrs.map((adr) => (
                <li key={adr.actionId} className={styles.adrItem}>
                  <Badge tone={ADR_TONE[adr.status] ?? 'muted'}>{adr.status}</Badge>
                  {adr.pullRequestUrl ? (
                    <a
                      href={adr.pullRequestUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.adrLink}
                    >
                      {adr.title}
                    </a>
                  ) : (
                    <span>{adr.title}</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {pendencies.length > 0 && (
            <>
              <div className={styles.archLabel}>
                Pendências de validação cruzada
                <Badge tone="danger">{pendencies.length}</Badge>
              </div>
              <ul className={styles.pendList}>
                {pendencies.map((p) => (
                  <li key={p.storyId} className={styles.pendItem}>
                    <span className={styles.pendTitle}>{p.title}</span>
                    <span className={styles.pendReason}>
                      {p.reason === 'no_module'
                        ? 'sem módulo vinculado'
                        : `módulo inexistente: ${p.missing.join(', ')}`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Seção Insights (Fase 4b) — hipóteses do Psicólogo agrupadas por agente
 * alvo, com confiança, evidências navegáveis e ações aceitar/descartar.
 * Escopo de PROJETO (não da sessão aberta): hipóteses acumulam a cada
 * sessão encerrada, e a navegação de evidência leva à sessão ANALISADA.
 */
function InsightsSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: hypotheses } = useHypotheses(projectId);
  const { data: analyses } = usePsychologistAnalyses(projectId);

  const all = hypotheses ?? [];
  const pending = all.filter((h) => h.status === 'proposed');
  const runs = analyses ?? [];

  // Agrupa por ÁREA quando o alvo é um subagente conhecido (Fase 8d, ADR
  // 0038) — hipóteses de `qa-automacao` e `qa-performance-seguranca` caem
  // no MESMO grupo "QA", em vez de duas seções soltas que escondem que são
  // a mesma área. Alvo sem área (dev-api, po, ...) continua agrupado pelo
  // próprio nome, como sempre. Preserva a ordem de chegada dos grupos.
  const byAgent = new Map<string, typeof all>();
  for (const h of all) {
    const chave = areaFor(h.agenteAlvo)?.label ?? h.agenteAlvo;
    byAgent.set(chave, [...(byAgent.get(chave) ?? []), h]);
  }

  async function decide(
    hypothesisId: string,
    action: 'accept' | 'dismiss',
  ) {
    try {
      if (action === 'accept') {
        await acceptHypothesis(projectId, hypothesisId);
      } else {
        await dismissHypothesis(projectId, hypothesisId);
      }
      await queryClient.invalidateQueries({ queryKey: ['hypotheses', projectId] });
    } catch {
      showToast({
        title: 'Erro',
        message: `Não foi possível ${action === 'accept' ? 'aceitar' : 'descartar'} a hipótese`,
        tone: 'danger',
      });
    }
  }

  // Reprocessamento explícito: substitui a análise anterior (que fica
  // `superseded`, nunca apagada). Gasta orçamento de verdade, daí o aviso
  // no título e o papel `maintainer` exigido pela api.
  async function reanalyze(sessionId: string) {
    try {
      await reanalyzeSession(projectId, sessionId);
      showToast({
        title: 'Reanálise enfileirada',
        message: 'O Psicólogo vai analisar esta sessão de novo.',
      });
    } catch {
      showToast({
        title: 'Erro',
        message: 'Não foi possível enfileirar a reanálise',
        tone: 'danger',
      });
    }
  }

  return (
    <div className={styles.arch}>
      <div className={styles.sectionHeader}>Insights</div>
      {all.length === 0 ? (
        <div className={styles.sectionSub}>
          Sem hipóteses ainda — o Psicólogo analisa cada sessão encerrada.
        </div>
      ) : (
        <>
          <div className={styles.sectionSub}>
            {all.length} hipótese(s) · {pending.length} aguardando decisão
          </div>

          {/* Faixa de análises: é aqui que o custo distinto entre triagem
              leve e pesada fica visível — some do metering por sessão. */}
          {runs.length > 0 && (
            <div className={styles.analysisStrip}>
              {runs.map((run) => (
                <div key={run.id} className={styles.analysisRow}>
                  <Badge tone={run.tier === 'pesada' ? 'accent' : 'muted'}>
                    triagem {run.tier}
                  </Badge>
                  <Link
                    to="/projects/$projectId/sessions/$sessionId"
                    params={{ projectId, sessionId: run.sessionId }}
                    className={styles.analysisSession}
                  >
                    sessão {run.sessionId.slice(0, 8)}
                  </Link>
                  <span className={styles.analysisMeta}>
                    {run.eventCountAtAnalysis} evento(s) · {run.hypothesisCount}{' '}
                    hipótese(s)
                  </span>
                  <span className={styles.analysisCost}>
                    {formatMicros(run.costMicros)}
                  </span>
                  <button
                    type="button"
                    className={styles.analysisReanalyze}
                    onClick={() => reanalyze(run.sessionId)}
                    title="Roda a análise de novo e gasta orçamento; a anterior fica no histórico"
                  >
                    Reanalisar
                  </button>
                </div>
              ))}
            </div>
          )}

          {[...byAgent.entries()].map(([agenteAlvo, group]) => (
            <div key={agenteAlvo}>
              <div className={styles.archLabel}>
                {agenteAlvo}
                <Badge tone="muted">{group.length}</Badge>
              </div>
              <div className={styles.moduleGrid}>
                {group.map((hypothesis) => (
                  <HypothesisCard
                    key={hypothesis.id}
                    hypothesis={hypothesis}
                    projectId={projectId}
                    onAccept={() => decide(hypothesis.id, 'accept')}
                    onDismiss={() => decide(hypothesis.id, 'dismiss')}
                  />
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
