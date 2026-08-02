import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { getBootstrapStatus, getProjectBudget, getRepository } from '../lib/api-client';
import {
  useArchitecture,
  useCurrentWorkspace,
  useHandoffs,
  useLatestSession,
  usePendingActions,
  useProjectLastActivity,
  useProjects,
  useSessionEvents,
  useWorkspaceSummary,
} from '../lib/hooks';
import {
  useProjectsUnread,
  useNotificationGroups,
  useStoriesAwaitingPromotion,
} from '../lib/notifications';
import { setLastSeenSeq } from '../lib/read-state';
import { deriveAgentRoster, groupRosterByArea } from '../lib/agent-status';
import { contagemAgentes, contagemProjetos } from '../lib/pluralize';
import { microsParaUsd, usdFmt } from '../lib/currency';
import type { Project } from '../lib/api-types';
import { ProjectCard, ProjectCardSkeleton } from '../components/ProjectCard';
import { NotificationBell } from '../components/NotificationBell';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { PlusIcon, SearchIcon } from '../components/ui/icons';
import { NewProjectWizard } from './NewProjectWizard';
import styles from './Dashboard.module.css';

function ProjectCardContainer({ project }: { project: Project }) {
  const navigate = useNavigate();
  const { data: repository } = useQuery({
    queryKey: ['repository', project.id],
    queryFn: () => getRepository(project.id),
  });
  const budgetQuery = useQuery({
    queryKey: ['budget', project.id],
    queryFn: () => getProjectBudget(project.id),
  });
  const budget = budgetQuery.data;
  // `getProjectBudget` devolve `null` (não uma linha zerada) quando o
  // projeto nunca teve orçamento definido — distinto de "ainda carregando"
  // (`data === undefined`). Só o segundo é "sem orçamento" de verdade.
  const noBudget = budgetQuery.isSuccess && budget === null;
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

  // Roster do PROJETO pro chip de agentes do card — mesma cadeia que
  // ProjectOverviewTab usa pro painel do time (não existe roster por
  // projeto no backend, só por SESSÃO). ~5 queries a mais por card, mesmo
  // padrão N+1-por-card já estabelecido neste dashboard.
  const { latest: latestSession } = useLatestSession(project.id);
  const sessionId = latestSession?.id;
  const eventsQuery = useSessionEvents(project.id, sessionId);
  const events = eventsQuery.data?.items ?? [];
  const { data: architecture } = useArchitecture(project.id);
  const handoffsQuery = useHandoffs(project.id, sessionId);
  const actionsQuery = usePendingActions(project.id, sessionId);
  const pendingActionAgentIds = new Set(
    (actionsQuery.data?.items ?? [])
      .filter((a) => a.status === 'pending')
      .map((a) => a.actor.id),
  );
  const roster = deriveAgentRoster(
    events,
    architecture?.moduleMap,
    events.some((e) => e.type === 'execution.activated'),
    handoffsQuery.data ?? [],
    pendingActionAgentIds,
  );
  const rosterGroups = groupRosterByArea(roster);

  return (
    <ProjectCard
      name={project.name}
      provider={provider}
      provisioningStatus={provisioningStatus}
      rosterGroups={rosterGroups}
      tokensUsed={budget ? budget.spentMicros / 1_000_000 : 0}
      tokensLimit={budget ? budget.limitMicros / 1_000_000 : 0}
      costBRL={0}
      costUSD={budget ? budget.spentMicros / 1_000_000 : 0}
      noBudget={noBudget}
      onDefineBudget={() =>
        navigate({
          to: '/projects/$projectId',
          params: { projectId: project.id },
          search: { tab: 'settings' },
        })
      }
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
  const projectsQuery = useProjects(workspace?.id);
  const projects = projectsQuery.data;
  const summaryQuery = useWorkspaceSummary(workspace?.id);
  const [search, setSearch] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);

  const unread = useProjectsUnread(projects);
  const notificationGroups = useNotificationGroups(unread);
  // Duas fontes, um número. As promoções pendentes (Fase 12c) NÃO entram em
  // `unreadCount`: aquele é consumido por `seq`, e o `onMarkRead` abaixo o
  // zeraria — abrir o sino cancelaria a fila de decisões do usuário.
  const aguardandoPromocao = useStoriesAwaitingPromotion(projects);
  const totalUnread =
    unread.reduce((sum, u) => sum + u.unreadCount, 0) + aguardandoPromocao;

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
        <div className={styles.summary}>
          {summaryQuery.isError ? (
            <span className={styles.summaryFallback}>resumo indisponível</span>
          ) : summaryQuery.data ? (
            `${contagemProjetos(summaryQuery.data.activeProjects)} · ${contagemAgentes(summaryQuery.data.agentCount)} · ${usdFmt.format(microsParaUsd(summaryQuery.data.spentMicros))} este mês`
          ) : (
            <Skeleton width={220} height={13} />
          )}
        </div>

        {projectsQuery.isLoading ? (
          <div className={styles.grid}>
            {Array.from({ length: 6 }).map((_, i) => (
              <ProjectCardSkeleton key={i} />
            ))}
          </div>
        ) : !projects || projects.length === 0 ? (
          // Primeiro uso de verdade: o workspace não tem NENHUM projeto —
          // distinto do caso abaixo (busca sem resultado), que tem projetos
          // e não precisa de CTA de criar o primeiro.
          <div className={styles.empty}>
            <p>Nenhum projeto por aqui ainda.</p>
            <Button onClick={() => setWizardOpen(true)}>
              <PlusIcon size={14} /> Criar projeto
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>
            Nenhum projeto encontrado para &quot;{search}&quot;.
          </div>
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
