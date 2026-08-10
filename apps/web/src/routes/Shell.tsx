import { useState, type CSSProperties } from 'react';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { emailDaSessao, sair } from '../lib/auth';
import { mensagemDaApi } from '../lib/api-client';
import {
  useCurrentWorkspace,
  useCurrentWorkspaceWithRole,
  useProjects,
  useProjectsStatus,
  useProjectsSummary,
} from '../lib/hooks';
import { useProjectsUnread } from '../lib/notifications';
import {
  ATIVIDADE_RECENTE_JANELA_MS,
  deriveProjectStatus,
  PROJECT_STATUS_COLOR,
  PROJECT_STATUS_LABEL,
} from '../lib/project-status';
import { ROLE_LABEL } from '../lib/roles';
import { desempateDoProjeto, nomesRepetidos } from '../lib/project-label';
import type { ProjectCardSummary } from '../lib/api-types';
import { Badge } from '../components/ui/Badge';
import { ChatIcon, LogoMark, PlusIcon, SettingsIcon } from '../components/ui/icons';
import { NewProjectWizard } from './NewProjectWizard';
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
 * Dot de status por projeto (RN-039) — SEM consulta própria: orçamento e
 * última atividade vêm da linha do projeto no resumo do workspace (RN-090), e
 * a contagem de bloqueio de `useProjectsStatus`. Todas são leituras do
 * workspace inteiro.
 *
 * Antes o dot custava duas queries POR PROJETO, e o Shell é montado em TODA
 * rota: a sidebar sozinha pollava o workspace inteiro mesmo numa tela de
 * configurações. Era metade do tráfego que estourava o rate limit.
 */
function NavStatusDot({
  summary,
  blockedTaskCount,
}: {
  summary: ProjectCardSummary | undefined;
  blockedTaskCount: number;
}) {
  const budget = summary?.budget ?? null;
  const budgetPct =
    budget && budget.limitMicros > 0
      ? (budget.spentMicros / budget.limitMicros) * 100
      : 0;
  const hasRecentActivity = summary?.lastEvent
    ? Date.now() - new Date(summary.lastEvent.createdAt).getTime() <
      ATIVIDADE_RECENTE_JANELA_MS
    : false;
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
  // Só a sidebar: dentro de um projeto não havia NENHUM jeito de criar outro
  // sem voltar ao dashboard primeiro. O Dashboard mantém o próprio botão —
  // dois "Novo projeto" na mesma tela (topbar + sidebar) é aceitável porque
  // moram em regiões visuais distintas, e esconder o daqui só quando
  // `pathname === '/'` trocaria uma redundância pequena por um botão que
  // muda de lugar conforme a rota.
  const [wizardOpen, setWizardOpen] = useState(false);
  const projectsQuery = useProjects(workspace?.id);
  const projects = projectsQuery.data;
  // MESMA queryKey do Dashboard: montados juntos, o React Query deduplica e o
  // resumo é buscado uma vez só (RN-090).
  const { data: cards } = useProjectsSummary(workspace?.id);
  const unread = useProjectsUnread(projects, cards);
  const { data: projectsStatus } = useProjectsStatus(workspace?.id);
  const repetidos = nomesRepetidos(projects);
  const blockedByProject = new Map(
    (projectsStatus ?? []).map((p) => [p.projectId, p.blockedTaskCount]),
  );
  const cardPorProjeto = new Map((cards ?? []).map((c) => [c.projectId, c]));
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const email = emailDaSessao();

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        {/* O monograma B no ladrilho terracota — a MESMA marca das telas de
            auth, e a única que o handoff reconhece. Até a FASE 17a aqui morava
            o `BrandIcon`, um cubo isométrico sem parentesco nenhum com ela: o
            app tinha duas marcas, e quem entrava pelo login via a segunda
            trocar pela primeira. */}
        <div className={styles.brand}>
          <span className={styles.brandTile} aria-hidden="true">
            <LogoMark size={18} />
          </span>
          <span className={styles.brandName}>Brabo</span>
        </div>

        <div className={styles.navLabelRow}>
          <span className={styles.navLabel}>Projetos</span>
          <button
            type="button"
            className={styles.newProjectButton}
            onClick={() => setWizardOpen(true)}
            title="Novo projeto"
            aria-label="Novo projeto"
          >
            <PlusIcon size={12} />
          </button>
        </div>
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
                summary={cardPorProjeto.get(project.id)}
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

      {wizardOpen && workspace && (
        <NewProjectWizard workspaceId={workspace.id} onClose={() => setWizardOpen(false)} />
      )}
    </div>
  );
}
