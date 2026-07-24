import { AGENT_LIST } from '../lib/agents';
import { useArchitecture, useLatestSession, useSessionEvents } from '../lib/hooks';
import { AgentCard, type AgentStatus } from '../components/AgentCard';
import { ActivityFeed } from '../components/ActivityFeed';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import type { Architecture } from '../lib/api-types';
import styles from './ProjectOverviewTab.module.css';

interface ProjectOverviewTabProps {
  projectId: string;
}

export function ProjectOverviewTab({ projectId }: ProjectOverviewTabProps) {
  const { latest: latestSession } = useLatestSession(projectId);
  const eventsQuery = useSessionEvents(projectId, latestSession?.id);
  const events = eventsQuery.data?.items ?? [];
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
