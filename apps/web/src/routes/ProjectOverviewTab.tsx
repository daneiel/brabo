import { useQueryClient } from '@tanstack/react-query';
import { AGENT_LIST } from '../lib/agents';
import { useArchitecture, useLatestSession, usePendingActions, useSessionEvents } from '../lib/hooks';
import { activateExecution, acceptParallelization } from '../lib/api-client';
import { AgentCard, type AgentStatus } from '../components/AgentCard';
import { ActivityFeed } from '../components/ActivityFeed';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/ToastProvider';
import type { Architecture, ProposedAction, SessionEvent } from '../lib/api-types';
import styles from './ProjectOverviewTab.module.css';

interface ProjectOverviewTabProps {
  projectId: string;
}

export function ProjectOverviewTab({ projectId }: ProjectOverviewTabProps) {
  const { latest: latestSession } = useLatestSession(projectId);
  const eventsQuery = useSessionEvents(projectId, latestSession?.id);
  const events = eventsQuery.data?.items ?? [];
  const actionsQuery = usePendingActions(projectId, latestSession?.id);
  const actions = actionsQuery.data?.items ?? [];
  const { data: architecture } = useArchitecture(projectId);

  const status: AgentStatus = latestSession?.status === 'active' ? 'trabalhando' : 'ocioso';
  const workingCount = status === 'trabalhando' ? AGENT_LIST.length : 0;

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <div className={styles.sectionHeader}>Time de agentes</div>
        <div className={styles.sectionSub}>
          {AGENT_LIST.length} agentes · {workingCount} trabalhando · 0 aguardando
        </div>
        <div className={styles.grid}>
          {AGENT_LIST.map((agent) => (
            <AgentCard key={agent.key} agent={agent} status={status} />
          ))}
        </div>

        <ExecutionSection
          projectId={projectId}
          sessionId={latestSession?.id}
          hasModuleMap={!!architecture?.moduleMap}
          events={events}
          actions={actions}
        />

        <ArchitectureSection architecture={architecture} />
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

  const activated = events.some((e) => e.type === 'execution.activated');

  // Dev agents a partir do event log (dev.started/dev.working).
  const agents = new Map<string, { module: string; branch?: string; taskId?: string }>();
  for (const e of events) {
    const p = e.payload as { agentId?: string; module?: string; branch?: string; taskId?: string };
    if (e.type === 'dev.started' && p.agentId) {
      agents.set(p.agentId, { module: p.module ?? '', ...agents.get(p.agentId) });
    }
    if (e.type === 'dev.working' && p.agentId) {
      agents.set(p.agentId, {
        module: agents.get(p.agentId)?.module ?? '',
        branch: p.branch,
        taskId: p.taskId,
      });
    }
  }

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
                </div>
              ))}
            </div>
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
