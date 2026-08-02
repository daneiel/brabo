import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getProject, getProjectBudget, getRepository } from '../lib/api-client';
import { useBacklog, useLatestSession, usePendingActions } from '../lib/hooks';
import { setLastSeenSeq } from '../lib/read-state';
import { TokenMeter } from '../components/TokenMeter';
import { Tabs } from '../components/ui/Tabs';
import { GitHubIcon, GitLabIcon, LocalRepoIcon } from '../components/ui/icons';
import { ProjectOverviewTab } from './ProjectOverviewTab';
import { ProjectSessionsTab } from './ProjectSessionsTab';
import { ProjectApprovalsTab } from './ProjectApprovalsTab';
import { ProjectBacklogTab, aguardandoPromocao } from './ProjectBacklogTab';
import { ProjectSettingsTab } from './ProjectSettingsTab';
import styles from './ProjectPage.module.css';

const PROVIDER_ICON = { github: GitHubIcon, gitlab: GitLabIcon, local: LocalRepoIcon } as const;

type TabKey = 'overview' | 'sessions' | 'backlog' | 'approvals' | 'settings';

interface ProjectPageProps {
  projectId: string;
  initialTab?: TabKey;
}

export function ProjectPage({ projectId, initialTab }: ProjectPageProps) {
  const [tab, setTab] = useState<TabKey>(initialTab ?? 'overview');

  const { data: project } = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) });
  const { data: repository } = useQuery({ queryKey: ['repository', projectId], queryFn: () => getRepository(projectId) });
  const { data: budget } = useQuery({ queryKey: ['budget', projectId], queryFn: () => getProjectBudget(projectId) });

  const { latest: latestSession } = useLatestSession(projectId);
  const pendingActionsQuery = usePendingActions(projectId, latestSession?.id);
  const pendingCount = pendingActionsQuery.data?.items.filter((a) => a.status === 'pending').length ?? 0;

  // Histórias esperando promoção do usuário (Fase 12c — RN-048). Contador
  // próprio, ao lado do de aprovações: são duas filas de decisão diferentes,
  // e somá-las esconderia qual delas está pedindo atenção.
  const backlogQuery = useBacklog(projectId);
  const promocoesPendentes = aguardandoPromocao(backlogQuery.data).length;

  useEffect(() => {
    if (tab === 'overview' && latestSession) {
      setLastSeenSeq(projectId, latestSession.nextSeq - 1);
    }
  }, [tab, latestSession, projectId]);

  if (!project) return null;

  const ProviderIcon = PROVIDER_ICON[repository?.provider ?? 'local'];

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.providerIcon}>
            <ProviderIcon size={18} />
          </span>
          <div>
            <div className={styles.titleRow}>
              <span className={styles.name}>{project.name}</span>
            </div>
            <div className={styles.meta}>
              {repository
                ? [
                    repository.provider,
                    repository.visibility,
                    repository.defaultBranch,
                    // Fase 12a: adotado é fato permanente do projeto, e
                    // saber que o repo veio de fora muda como se lê tudo
                    // o mais (a política de branches é dele, não nossa).
                    repository.origin === 'adopted' ? 'adotado' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : 'repositório não provisionado'}
            </div>
          </div>
        </div>

        {budget && (
          <TokenMeter
            variant="compact"
            unitLabel="USD"
            used={budget.spentMicros / 1_000_000}
            limit={budget.limitMicros / 1_000_000}
            costBRL={0}
            costUSD={budget.spentMicros / 1_000_000}
          />
        )}
      </div>

      <div className={styles.tabsRow}>
        <Tabs
          active={tab}
          onChange={(key) => setTab(key as TabKey)}
          items={[
            { key: 'overview', label: 'Visão geral' },
            { key: 'sessions', label: 'Sessões' },
            { key: 'backlog', label: 'Backlog', count: promocoesPendentes || undefined },
            { key: 'approvals', label: 'Aprovações', count: pendingCount || undefined },
            { key: 'settings', label: 'Configurações' },
          ]}
        />
      </div>

      <div className={styles.body}>
        {tab === 'overview' && <ProjectOverviewTab projectId={projectId} />}
        {tab === 'sessions' && <ProjectSessionsTab projectId={projectId} />}
        {tab === 'backlog' && <ProjectBacklogTab projectId={projectId} />}
        {tab === 'approvals' && <ProjectApprovalsTab projectId={projectId} />}
        {tab === 'settings' && <ProjectSettingsTab projectId={projectId} />}
      </div>
    </div>
  );
}
