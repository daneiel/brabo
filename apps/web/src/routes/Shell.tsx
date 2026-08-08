import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { emailDaSessao, sair } from '../lib/auth';
import { getProjectBudget, mensagemDaApi } from '../lib/api-client';
import {
  useCurrentWorkspace,
  useCurrentWorkspaceWithRole,
  useProjectHasRecentActivity,
  useProjects,
  useProjectsStatus,
} from '../lib/hooks';
import { useProjectsUnread } from '../lib/notifications';
import {
  deriveProjectStatus,
  PROJECT_STATUS_COLOR,
  PROJECT_STATUS_LABEL,
} from '../lib/project-status';
import { ROLE_LABEL } from '../lib/roles';
import { desempateDoProjeto, nomesRepetidos } from '../lib/project-label';
import type { Project } from '../lib/api-types';
import { Badge } from '../components/ui/Badge';
import { BrandIcon, ChatIcon, SettingsIcon } from '../components/ui/icons';
import styles from './Shell.module.css';

// Iniciais do e-mail (não há campo de nome no JWT nem endpoint de perfil —
// "nomes fictícios" é a divergência já aceita contra o mock, ver ADR do
// dashboard). "fulano.silva@..." -> "FS"; sem separador, as duas primeiras
// letras do local-part.
function iniciaisDoEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const partes = local.split(/[._-]+/).filter(Boolean);
  const letras =
    partes.length >= 2 ? [partes[0]?.[0], partes[1]?.[0]] : [local[0], local[1]];
  return letras.filter((c): c is string => !!c).join('').toUpperCase();
}

/**
 * Dot de status por projeto (RN-039) — busca o próprio orçamento (MESMA
 * queryKey do card do Dashboard, dedup de graça quando os dois estão
 * montados) e a atividade recente; a contagem de bloqueio vem de fora (uma
 * query só pro workspace inteiro, ver `useProjectsStatus`).
 */
function NavStatusDot({
  project,
  blockedTaskCount,
}: {
  project: Project;
  blockedTaskCount: number;
}) {
  const { data: budget } = useQuery({
    queryKey: ['budget', project.id],
    queryFn: () => getProjectBudget(project.id),
  });
  const hasRecentActivity = useProjectHasRecentActivity(project.id);
  const budgetPct =
    budget && budget.limitMicros > 0
      ? (budget.spentMicros / budget.limitMicros) * 100
      : 0;
  const status = deriveProjectStatus({ budgetPct, blockedTaskCount, hasRecentActivity });

  return (
    <span
      className={styles.navDot}
      style={{ ['--dot-color' as string]: PROJECT_STATUS_COLOR[status] } as CSSProperties}
      title={PROJECT_STATUS_LABEL[status]}
    />
  );
}

export function Shell() {
  const navigate = useNavigate();
  const { data: workspace } = useCurrentWorkspace();
  const { data: workspaceWithRole } = useCurrentWorkspaceWithRole();
  const projectsQuery = useProjects(workspace?.id);
  const projects = projectsQuery.data;
  const unread = useProjectsUnread(projects);
  const { data: projectsStatus } = useProjectsStatus(workspace?.id);
  const repetidos = nomesRepetidos(projects);
  const blockedByProject = new Map(
    (projectsStatus ?? []).map((p) => [p.projectId, p.blockedTaskCount]),
  );
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const email = emailDaSessao();

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandIcon}>
            <BrandIcon size={20} />
          </span>
          <span className={styles.brandName}>Brabo</span>
        </div>

        <div className={styles.navLabel}>Projetos</div>
        <nav className={styles.nav}>
          {/* A lista falhou: a sidebar DIZ, em vez de ficar vazia como se o
              workspace não tivesse projeto nenhum (RN-088). Aqui não cabe o
              `ErroDeCarregamento` inteiro — são 248px —, mas cabe o essencial:
              o que houve e como tentar de novo. */}
          {projectsQuery.isError && (
            <div className={styles.navErro} role="alert">
              <span>{mensagemDaApi(projectsQuery.error, 'Não foi possível carregar os projetos.')}</span>
              <button
                type="button"
                className={styles.navErroBotao}
                onClick={() => void projectsQuery.refetch()}
              >
                tentar de novo
              </button>
            </div>
          )}
          {unread.map(({ project, unreadCount }) => (
            <Link
              key={project.id}
              to="/projects/$projectId"
              params={{ projectId: project.id }}
              className={[styles.navItem, pathname.startsWith(`/projects/${project.id}`) && styles.active]
                .filter(Boolean)
                .join(' ')}
            >
              <NavStatusDot
                project={project}
                blockedTaskCount={blockedByProject.get(project.id) ?? 0}
              />
              <span className={styles.navText}>
                <span className={styles.navName}>{project.name}</span>
                {/* Só quando o nome se repete — ver `project-label.ts`. */}
                {repetidos.has(project.name) && (
                  <span className={styles.navDesempate}>
                    {desempateDoProjeto(project)}
                  </span>
                )}
              </span>
              {unreadCount > 0 && (
                <Badge tone="accent" square>
                  {unreadCount}
                </Badge>
              )}
            </Link>
          ))}
        </nav>

        {/* Sem rota real — não existe `/chat` nem `/settings` de workspace
            hoje. Presença visual pra fidelidade com o mock, nunca um `<Link>`
            morto que o router devolveria 404. */}
        <div className={styles.globalNav}>
          <span className={styles.inertNavItem} title="em breve">
            <ChatIcon size={14} />
            Chat global
          </span>
          <span className={styles.inertNavItem} title="em breve">
            <SettingsIcon size={14} />
            Configurações
          </span>
        </div>

        <div className={styles.footer}>
          <div className={styles.userCard}>
            <span className={styles.avatar}>{email ? iniciaisDoEmail(email) : '?'}</span>
            <div className={styles.userInfo}>
              <span className={styles.userName}>{email ?? 'conta'}</span>
              {workspaceWithRole && (
                <span className={styles.userRole}>{ROLE_LABEL[workspaceWithRole.role]}</span>
              )}
            </div>
          </div>
          <button
            type="button"
            className={styles.logout}
            onClick={() => void sair().then(() => navigate({ to: '/login' }))}
          >
            sair
          </button>
        </div>
      </aside>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
