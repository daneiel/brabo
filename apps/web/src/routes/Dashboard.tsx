import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { getBootstrapStatus, getProjectBudget, getRepository } from '../lib/api-client';
import { useCurrentWorkspace, useProjectLastActivity, useProjects } from '../lib/hooks';
import { useProjectsUnread, useNotificationGroups } from '../lib/notifications';
import { setLastSeenSeq } from '../lib/read-state';
import { AGENT_LIST } from '../lib/agents';
import type { Project } from '../lib/api-types';
import { ProjectCard } from '../components/ProjectCard';
import { NotificationBell } from '../components/NotificationBell';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { PlusIcon, SearchIcon } from '../components/ui/icons';
import { NewProjectWizard } from './NewProjectWizard';
import styles from './Dashboard.module.css';

function ProjectCardContainer({ project }: { project: Project }) {
  const navigate = useNavigate();
  const { data: repository } = useQuery({
    queryKey: ['repository', project.id],
    queryFn: () => getRepository(project.id),
  });
  const { data: budget } = useQuery({
    queryKey: ['budget', project.id],
    queryFn: () => getProjectBudget(project.id),
  });
  const { data: bootstrap } = useQuery({
    queryKey: ['bootstrap', project.id],
    queryFn: () => getBootstrapStatus(project.id),
    // Segue pollando enquanto provisiona pra o badge do card atualizar
    // sozinho; para quando converge ou falha.
    refetchInterval: (query) =>
      query.state.data?.status === 'provisioning' ? 3000 : false,
  });
  const provisioningStatus = bootstrap?.status ?? null;
  const provider = repository?.provider ?? 'local';
  const lastActivityText = useProjectLastActivity(project.id);

  return (
    <ProjectCard
      name={project.name}
      provider={provider}
      provisioningStatus={provisioningStatus}
      agents={AGENT_LIST}
      tokensUsed={budget ? budget.spentMicros / 1_000_000 : 0}
      tokensLimit={budget ? budget.limitMicros / 1_000_000 : 0}
      costBRL={0}
      costUSD={budget ? budget.spentMicros / 1_000_000 : 0}
      lastActivityText={lastActivityText}
      onClick={() =>
        provisioningStatus === 'provision_failed'
          ? navigate({
              to: '/projects/$projectId/provisioning',
              params: { projectId: project.id },
              search: { provider },
            })
          : navigate({ to: '/projects/$projectId', params: { projectId: project.id } })
      }
    />
  );
}

export function Dashboard() {
  const { data: workspace } = useCurrentWorkspace();
  const { data: projects } = useProjects(workspace?.id);
  const [search, setSearch] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);

  const unread = useProjectsUnread(projects);
  const notificationGroups = useNotificationGroups(unread);
  const totalUnread = unread.reduce((sum, u) => sum + u.unreadCount, 0);

  const filtered = (projects ?? []).filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <div className={styles.topbar}>
        <span className={styles.title}>Projetos</span>
        <div className={styles.search}>
          <Input placeholder="Buscar projetos…" icon={<SearchIcon size={14} />} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className={styles.spacer} />
        <NotificationBell
          groups={notificationGroups}
          unreadCount={totalUnread}
          onMarkRead={() => {
            for (const u of unread) {
              if (u.latestSeq > 0) setLastSeenSeq(u.project.id, u.latestSeq);
            }
          }}
        />
        <Button onClick={() => setWizardOpen(true)}>
          <PlusIcon size={14} /> Novo projeto
        </Button>
      </div>

      <div className={styles.content}>
        <div className={styles.summary}>{projects?.length ?? 0} projetos ativos</div>

        {filtered.length === 0 ? (
          <div className={styles.empty}>Nenhum projeto por aqui ainda. Crie o primeiro para começar.</div>
        ) : (
          <div className={styles.grid}>
            {filtered.map((project) => (
              <ProjectCardContainer key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>

      {wizardOpen && workspace && <NewProjectWizard workspaceId={workspace.id} onClose={() => setWizardOpen(false)} />}
    </>
  );
}
