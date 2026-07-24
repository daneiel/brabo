import { useEffect } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useArchitecture,
  useBacklog,
  useHandoffs,
  useHypotheses,
  useLatestSession,
  usePendingActions,
  useSessionEvents,
} from '../lib/hooks';
import {
  activateExecution,
  acceptParallelization,
  acceptHypothesis,
  dismissHypothesis,
  getAgentModelBinding,
  listAgentAutonomy,
  listModels,
} from '../lib/api-client';
import { deriveAgentRoster } from '../lib/agent-status';
import { connectSessionHeartbeat } from '../lib/session-channel';
import { AgentCard } from '../components/AgentCard';
import { ActivityFeed } from '../components/ActivityFeed';
import { HypothesisCard } from '../components/HypothesisCard';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/ToastProvider';
import type { Architecture, ProposedAction, SessionEvent } from '../lib/api-types';
import styles from './ProjectOverviewTab.module.css';

// actionType representativo pra resumir a autonomia (auto_approve vira "auto"
// no AgentCard) — só os agentes com uma ação central seedável têm isso;
// os demais não mostram o toggle (AgentCard exige model+onChange juntos).
const AUTONOMY_ACTION_TYPE: Record<string, string> = { infra: 'open_infra_pr' };
function autonomyActionTypeFor(agentId: string): string {
  return AUTONOMY_ACTION_TYPE[agentId] ?? (agentId.startsWith('dev-') ? 'pr_open' : '');
}

// tokensSpentMicros é custo em micro-USD (mesma unidade de budgets/token_usage).
function formatMicros(micros: number): string {
  return `US$ ${(micros / 1_000_000).toFixed(4)}`;
}

interface ProjectOverviewTabProps {
  projectId: string;
}

export function ProjectOverviewTab({ projectId }: ProjectOverviewTabProps) {
  const queryClient = useQueryClient();
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
  const roster = deriveAgentRoster(events, architecture?.moduleMap, executionActivated, handoffs);

  const { data: modelsByCategory } = useQuery({ queryKey: ['models'], queryFn: listModels });
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

  // Fase 4a — painel do time ao vivo: qualquer evento persistido (Dev/QA/
  // SecOps/Infra) ou `agent.status` (Criativo/PO/Arquiteto/Infra) antecipa
  // o refetch do polling — mesmo princípio de SessionPage.tsx.
  useEffect(() => {
    if (!sessionId || latestSession?.status !== 'active') return;
    const disconnect = connectSessionHeartbeat(sessionId, {
      onEvent: () => {
        queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      },
      onAgentStatus: () => {
        queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      },
    });
    return disconnect;
  }, [sessionId, latestSession?.status, projectId, queryClient]);

  const workingCount = roster.filter((r) => r.status === 'trabalhando').length;
  const waitingCount = roster.filter((r) => r.status === 'aguardando').length;

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <div className={styles.sectionHeader}>Time de agentes</div>
        <div className={styles.sectionSub}>
          {roster.length} agentes · {workingCount} trabalhando · {waitingCount} aguardando
        </div>
        <div className={styles.grid}>
          {roster.map((r, i) => {
            const modelId = bindingQueries[i]?.data?.modelId;
            const model = allModels.find((m) => m.id === modelId);
            const autonomyType = autonomyActionTypeFor(r.id);
            const rule = autonomyType
              ? autonomyRules?.find((a) => a.agentId === r.id && a.actionType === autonomyType)
              : undefined;
            return (
              <AgentCard
                key={r.id}
                agent={r.def}
                status={r.status}
                model={model ? { name: model.displayName, provider: model.provider } : undefined}
                autonomy={rule ? (rule.mode === 'auto_approve' ? 'auto' : 'manual') : undefined}
              />
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
        <ActivityFeed events={events} />
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
  // (emitido pelo ToolLoop a cada turno de LLM).
  interface AgentProgress {
    module: string;
    branch?: string;
    taskId?: string;
    iteration?: number;
    tokensSpentMicros?: number;
  }
  const agents = new Map<string, AgentProgress>();
  for (const e of events) {
    const p = e.payload as { agentId?: string; module?: string; branch?: string; taskId?: string };
    if (e.type === 'dev.started' && p.agentId) {
      agents.set(p.agentId, { module: p.module ?? '', ...agents.get(p.agentId) });
    }
    if (e.type === 'dev.working' && p.agentId) {
      agents.set(p.agentId, {
        ...agents.get(p.agentId),
        module: agents.get(p.agentId)?.module ?? '',
        branch: p.branch,
        taskId: p.taskId,
      });
    }
    if (e.type === 'agent.response' && agents.has(e.actor.id)) {
      const rp = e.payload as { iteration?: number; tokensSpentMicros?: number };
      agents.set(e.actor.id, {
        ...(agents.get(e.actor.id) as AgentProgress),
        iteration: rp.iteration,
        tokensSpentMicros: rp.tokensSpentMicros,
      });
    }
  }

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
                  {a.branch && <div className={styles.depChip}>{a.branch}</div>}
                  {a.iteration !== undefined && (
                    <div className={styles.moduleResp}>
                      iteração {a.iteration} · {formatMicros(a.tokensSpentMicros ?? 0)}
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

  const all = hypotheses ?? [];
  const pending = all.filter((h) => h.status === 'proposed');

  // Agrupa por agente alvo preservando a ordem de chegada dos grupos.
  const byAgent = new Map<string, typeof all>();
  for (const h of all) {
    byAgent.set(h.agenteAlvo, [...(byAgent.get(h.agenteAlvo) ?? []), h]);
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
