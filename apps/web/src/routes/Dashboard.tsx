import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import {
  useCurrentWorkspace,
  useProjects,
  useProjectsSummary,
  useWorkspaceSummary,
} from '../lib/hooks';
import {
  useProjectsUnread,
  useNotificationGroups,
  storiesAwaitingPromotion,
} from '../lib/notifications';
import { setLastSeenSeq } from '../lib/read-state';
import { groupRosterByArea, rosterFromFacts } from '../lib/agent-status';
import { classifyEvent } from '../lib/activity';
import { formatRelativeTime } from '../lib/time';
import { contagemAgentes, contagemProjetos } from '../lib/pluralize';
import { microsParaUsd, usdFmt } from '../lib/currency';
import type { Project, ProjectCardSummary } from '../lib/api-types';
import { ProjectCard, ProjectCardSkeleton } from '../components/ProjectCard';
import { ErroDeCarregamento } from '../components/ErroDeCarregamento';
import { NotificationBell } from '../components/NotificationBell';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { PlusIcon, SearchIcon } from '../components/ui/icons';
import { NewProjectWizard } from './NewProjectWizard';
import styles from './Dashboard.module.css';

/**
 * O card não faz consulta nenhuma: tudo que ele desenha vem da linha do
 * projeto no resumo do workspace (RN-090).
 *
 * O padrão N+1-por-card que existia aqui — sete consultas em poll por card,
 * incluindo a cadeia inteira do painel do time só pra tirar quatro chips —
 * estourava o rate limit sozinho a partir de ~5 projetos. `summary` é
 * `undefined` só enquanto a primeira resposta não chegou.
 */
function ProjectCardContainer({
  project,
  summary,
  carregando,
}: {
  project: Project;
  summary: ProjectCardSummary | undefined;
  carregando: boolean;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation('dashboard');

  const provisioningStatus = summary?.provisioningStatus ?? null;
  const provider = summary?.provider ?? 'local';
  const budget = summary?.budget ?? null;
  // `budget` vem `null` (não uma linha zerada) quando o projeto nunca teve
  // orçamento definido — distinto de "ainda carregando". Só o primeiro é
  // "sem orçamento" de verdade, e é o que oferece "Definir orçamento".
  const noBudget = !carregando && !!summary && budget === null;

  // Os chips saem dos MESMOS fatos e da MESMA regra de presença que o painel
  // do time usa (`rosterFromFacts`); o que o card não pede é o status de cada
  // agente, porque não desenha nenhum.
  const rosterGroups = summary
    ? groupRosterByArea(rosterFromFacts(summary.roster, () => 'ocioso'))
    : [];

  const lastActivityText = summary?.lastEvent
    ? `${classifyEvent(summary.lastEvent).text} · ${formatRelativeTime(summary.lastEvent.createdAt)}`
    : t('activity.none');

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
      // Mesma contagem da sidebar (RN-151) — aprovações pendentes do projeto
      // inteiro, não atividade não lida. O prop era um fio nunca ligado
      // (nenhum chamador o passava); agora carrega o número certo em vez de
      // continuar morto.
      pendingApprovalsCount={summary?.pendingApprovalsCount}
      // RN-409 — agentes ONLINE agora (trabalhando/com pendência), nunca
      // tamanho de equipe. Mesmo dado que o painel do time mostraria se o
      // projeto estivesse aberto — a diferença é o MECANISMO (aqui vem
      // agregado do backend; lá, do event log da sessão aberta).
      onlineAgentCount={summary?.onlineAgentCount}
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
  const { t } = useTranslation('dashboard');
  const { data: workspace } = useCurrentWorkspace();
  const projectsQuery = useProjects(workspace?.id);
  const projects = projectsQuery.data;
  const summaryQuery = useWorkspaceSummary(workspace?.id);
  // A grade INTEIRA numa requisição (RN-090). Mesma queryKey que o Shell usa
  // para os dots da sidebar: montados juntos, o React Query deduplica e o
  // dashboard custa um poll, não um por card.
  const cardsQuery = useProjectsSummary(workspace?.id);
  const cards = cardsQuery.data;
  const [search, setSearch] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);
  // O `open` do sino mora aqui porque decide se a consulta da gaveta sai —
  // ver `useNotificationGroups`.
  const [sinoAberto, setSinoAberto] = useState(false);

  const cardPorProjeto = new Map((cards ?? []).map((c) => [c.projectId, c]));

  const unread = useProjectsUnread(projects, cards);
  const notificationGroups = useNotificationGroups(
    unread,
    sinoAberto,
    workspace?.id,
  );
  // Duas fontes, um número. As promoções pendentes (Fase 12c) NÃO entram em
  // `unreadCount`: aquele é consumido por `seq`, e o `onMarkRead` abaixo o
  // zeraria — abrir o sino cancelaria a fila de decisões do usuário.
  const aguardandoPromocao = storiesAwaitingPromotion(cards);
  const totalUnread =
    unread.reduce((sum, u) => sum + u.unreadCount, 0) + aguardandoPromocao;

  const filtered = (projects ?? []).filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <div className={styles.topbar}>
        <h1 className={styles.title}>{t('topbar.title')}</h1>
        <div className={styles.search}>
          <Input placeholder={t('topbar.searchPlaceholder')} icon={<SearchIcon size={14} />} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className={styles.spacer} />
        <NotificationBell
          groups={notificationGroups}
          unreadCount={totalUnread}
          open={sinoAberto}
          onOpenChange={setSinoAberto}
          onMarkRead={() => {
            for (const u of unread) {
              if (u.latestSeq > 0) setLastSeenSeq(u.project.id, u.latestSeq);
            }
          }}
        />
        <Button onClick={() => setWizardOpen(true)}>
          <PlusIcon size={14} /> {t('topbar.newProject')}
        </Button>
      </div>

      <div className={styles.content}>
        <div className={styles.summary}>
          {summaryQuery.isError ? (
            <span className={styles.summaryFallback}>{t('summary.unavailable')}</span>
          ) : summaryQuery.data ? (
            t('summary.line', {
              projects: contagemProjetos(summaryQuery.data.activeProjects),
              agents: contagemAgentes(summaryQuery.data.agentCount),
              spent: usdFmt.format(microsParaUsd(summaryQuery.data.spentMicros)),
            })
          ) : (
            <Skeleton width={220} height={13} />
          )}
        </div>

        {projectsQuery.isError ? (
          // ANTES do teste de lista vazia, e não depois: `!projects` é
          // verdadeiro nos dois casos, então uma api recusando com 429
          // convidava o usuário a "criar o primeiro projeto" de um workspace
          // que pode ter vinte. Errar calado é ruim; errar afirmando o
          // contrário é pior (RN-088).
          <div className={styles.empty}>
            <ErroDeCarregamento
              titulo={t('empty.loadError')}
              erro={projectsQuery.error}
              onTentarDeNovo={() => void projectsQuery.refetch()}
            />
          </div>
        ) : projectsQuery.isLoading ? (
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
            <p>{t('empty.noProjectsYet')}</p>
            <Button onClick={() => setWizardOpen(true)}>
              <PlusIcon size={14} /> {t('empty.createProject')}
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>
            {t('empty.noSearchResults', { search })}
          </div>
        ) : (
          <div className={styles.grid}>
            {filtered.map((project) => (
              <ProjectCardContainer
                key={project.id}
                project={project}
                summary={cardPorProjeto.get(project.id)}
                carregando={cardsQuery.isLoading}
              />
            ))}
          </div>
        )}
      </div>

      {wizardOpen && workspace && <NewProjectWizard workspaceId={workspace.id} onClose={() => setWizardOpen(false)} />}
    </>
  );
}
