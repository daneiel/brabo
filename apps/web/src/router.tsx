import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { Shell } from './routes/Shell';
import { Dashboard } from './routes/Dashboard';
import { ProjectPage } from './routes/ProjectPage';
import { SessionPage } from './routes/SessionPage';
import { GitErrorPage } from './routes/GitErrorPage';
import { StatusPage } from './routes/StatusPage';

const rootRoute = createRootRoute({ component: Shell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Dashboard,
});

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId',
  component: () => {
    const { projectId } = projectRoute.useParams();
    return <ProjectPage projectId={projectId} />;
  },
});

const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId/sessions/$sessionId',
  component: () => {
    const { projectId, sessionId } = sessionRoute.useParams();
    return <SessionPage projectId={projectId} sessionId={sessionId} />;
  },
});

interface GitErrorSearch {
  projectId?: string;
  provider?: string;
}

const gitErrorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/git-error',
  validateSearch: (search: Record<string, unknown>): GitErrorSearch => ({
    projectId: typeof search.projectId === 'string' ? search.projectId : undefined,
    provider: typeof search.provider === 'string' ? search.provider : undefined,
  }),
  component: () => {
    const { provider } = gitErrorRoute.useSearch();
    return <GitErrorPage provider={provider} />;
  },
});

const statusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/status',
  component: StatusPage,
});

const routeTree = rootRoute.addChildren([indexRoute, projectRoute, sessionRoute, gitErrorRoute, statusRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
