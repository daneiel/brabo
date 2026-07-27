import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { emailDaSessao, sair } from '../lib/auth';
import { useCurrentWorkspace, useProjects } from '../lib/hooks';
import { useProjectsUnread } from '../lib/notifications';
import { Badge } from '../components/ui/Badge';
import { BrandIcon } from '../components/ui/icons';
import styles from './Shell.module.css';

export function Shell() {
  const navigate = useNavigate();
  const { data: workspace } = useCurrentWorkspace();
  const { data: projects } = useProjects(workspace?.id);
  const unread = useProjectsUnread(projects);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

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
          {unread.map(({ project, unreadCount }) => (
            <Link
              key={project.id}
              to="/projects/$projectId"
              params={{ projectId: project.id }}
              className={[styles.navItem, pathname.startsWith(`/projects/${project.id}`) && styles.active]
                .filter(Boolean)
                .join(' ')}
            >
              <span className={styles.navDot} />
              <span className={styles.navName}>{project.name}</span>
              {unreadCount > 0 && (
                <Badge tone="accent" square>
                  {unreadCount}
                </Badge>
              )}
            </Link>
          ))}
        </nav>

        <div className={styles.footer}>
          <span className={styles.userName}>{emailDaSessao() ?? 'conta'}</span>
          <button type="button" className={styles.logout} onClick={() => void sair().then(() => navigate({ to: '/login' }))}>
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
