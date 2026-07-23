import { AGENT_LIST } from '../lib/agents';
import { useLatestSession, useSessionEvents } from '../lib/hooks';
import { AgentCard, type AgentStatus } from '../components/AgentCard';
import { ActivityFeed } from '../components/ActivityFeed';
import styles from './ProjectOverviewTab.module.css';

interface ProjectOverviewTabProps {
  projectId: string;
}

export function ProjectOverviewTab({ projectId }: ProjectOverviewTabProps) {
  const { latest: latestSession } = useLatestSession(projectId);
  const eventsQuery = useSessionEvents(projectId, latestSession?.id);
  const events = eventsQuery.data?.items ?? [];

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
      </div>

      <aside className={styles.aside}>
        <div className={styles.sectionHeader}>Atividade</div>
        <div className={styles.sectionSub}>{events.length} eventos</div>
        <ActivityFeed events={events} />
      </aside>
    </div>
  );
}
