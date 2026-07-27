import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router';
import type { GitProviderName } from './lib/api-types';
import { Shell } from './routes/Shell';
import { Dashboard } from './routes/Dashboard';
import { ProjectPage } from './routes/ProjectPage';
import { SessionPage } from './routes/SessionPage';
import { ProvisioningPage } from './routes/ProvisioningPage';
import { GitErrorPage } from './routes/GitErrorPage';
import { StatusPage } from './routes/StatusPage';
import { LoginPage } from './routes/LoginPage';
import { RegisterPage } from './routes/RegisterPage';
import { ForgotPasswordPage } from './routes/ForgotPasswordPage';
import { SetPasswordPage } from './routes/SetPasswordPage';
import {
  definirSenha,
  entrar,
  pedirRedefinicao,
  registrar,
  temSessao,
} from './lib/auth';

/**
 * Duas camadas sob a raiz (Fase 7a — o corte).
 *
 * Até o corte não existia rota pública: o `main.tsx` bloqueava o render
 * inteiro atrás do `initKeycloak()`, e a raiz JÁ ERA o `Shell`. Com login
 * próprio, as telas de auth precisam renderizar SEM a navegação lateral e sem
 * exigir sessão — daí a raiz virar um `<Outlet/>` puro e a proteção descer
 * para um layout.
 */
const rootRoute = createRootRoute({ component: Outlet });

/** Tudo que exige sessão vive aqui dentro, dentro do Shell. */
const appLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: Shell,
  beforeLoad: ({ location }) => {
    if (!temSessao()) {
      // `redirect` do TanStack interrompe o carregamento — a rota protegida
      // nunca chega a montar, então nenhum componente dispara chamada à api
      // sem token.
      throw redirect({
        to: '/login',
        search: { proxima: location.href },
      });
    }
  },
});

/** As telas de auth: sem Shell, sem sessão. */
const authLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth',
  component: Outlet,
});

const irPara = (rota: string) => {
  void router.navigate({ to: rota });
};

const loginRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/login',
  component: () => <LoginPage onEntrar={entrar} irPara={irPara} />,
});

const registerRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/registrar',
  component: () => <RegisterPage onRegistrar={registrar} irPara={irPara} />,
});

const forgotRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/esqueci-senha',
  component: () => (
    <ForgotPasswordPage onPedir={pedirRedefinicao} irPara={irPara} />
  ),
});

interface SetPasswordSearch {
  token?: string;
}

const setPasswordRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/definir-senha',
  validateSearch: (search: Record<string, unknown>): SetPasswordSearch => ({
    token: typeof search.token === 'string' ? search.token : undefined,
  }),
  component: () => {
    const { token } = setPasswordRoute.useSearch();
    return (
      <SetPasswordPage token={token} onDefinir={definirSenha} irPara={irPara} />
    );
  },
});

const indexRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/',
  component: Dashboard,
});

const projectRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/projects/$projectId',
  component: () => {
    const { projectId } = projectRoute.useParams();
    return <ProjectPage projectId={projectId} />;
  },
});

// Fase 4b — Psicólogo: `highlightEvent` vem dos chips de evidência da
// seção Insights e faz o log de eventos da sessão rolar até o evento e
// destacá-lo.
interface SessionSearch {
  highlightEvent?: string;
}

const sessionRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/projects/$projectId/sessions/$sessionId',
  validateSearch: (search: Record<string, unknown>): SessionSearch => ({
    highlightEvent:
      typeof search.highlightEvent === 'string'
        ? search.highlightEvent
        : undefined,
  }),
  component: () => {
    const { projectId, sessionId } = sessionRoute.useParams();
    const { highlightEvent } = sessionRoute.useSearch();
    return (
      <SessionPage
        projectId={projectId}
        sessionId={sessionId}
        highlightEvent={highlightEvent}
      />
    );
  },
});

const GIT_PROVIDERS: GitProviderName[] = ['local', 'github', 'gitlab'];

interface ProvisioningSearch {
  provider: GitProviderName;
}

const provisioningRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/projects/$projectId/provisioning',
  validateSearch: (search: Record<string, unknown>): ProvisioningSearch => ({
    provider: GIT_PROVIDERS.includes(search.provider as GitProviderName)
      ? (search.provider as GitProviderName)
      : 'local',
  }),
  component: () => {
    const { projectId } = provisioningRoute.useParams();
    const { provider } = provisioningRoute.useSearch();
    return <ProvisioningPage projectId={projectId} provider={provider} />;
  },
});

interface GitErrorSearch {
  projectId?: string;
  provider?: string;
}

const gitErrorRoute = createRoute({
  getParentRoute: () => appLayout,
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
  getParentRoute: () => appLayout,
  path: '/status',
  component: StatusPage,
});

const routeTree = rootRoute.addChildren([
  appLayout.addChildren([
    indexRoute,
    projectRoute,
    sessionRoute,
    provisioningRoute,
    gitErrorRoute,
    statusRoute,
  ]),
  authLayout.addChildren([
    loginRoute,
    registerRoute,
    forgotRoute,
    setPasswordRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
