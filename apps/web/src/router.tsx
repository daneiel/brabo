import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router';
import type { JSX } from 'react';
import type { GitProviderName } from './lib/api-types';
import { Shell } from './routes/Shell';
import { resolverChaveDeAba, type ChaveDeAba } from './routes/project-tabs';
import { resolverChaveDeSecao, type ChaveDeSecao } from './routes/settings/sumario';
import { CarregandoRota } from './components/CarregandoRota';
import {
  definirSenha,
  entrar,
  pedirRedefinicao,
  registrar,
  temSessao,
  verificarEmail,
} from './lib/auth';

/**
 * Code-splitting por rota (AT-300).
 *
 * Até aqui as catorze telas eram importadas ESTATICAMENTE, e o bundle inicial
 * carregava todas elas — inclusive a Sessão inteira para quem só abriu o login.
 * Cada tela agora é um chunk próprio, por `lazyRouteComponent` (do TanStack, e
 * não `React.lazy`) por dois motivos medidos no código do router:
 *
 * 1. o router chama o `.preload()` do componente DURANTE o carregamento da
 *    rota, então a navegação espera o chunk antes de trocar de tela — o
 *    `pendingComponent` só aparece se o chunk demorar, nunca como flash;
 * 2. chunk que sumiu (deploy novo com o navegador ainda na versão velha)
 *    recarrega a página UMA vez em vez de quebrar a tela.
 *
 * O `Shell` continua estático: é a moldura de toda tela autenticada, e
 * dividi-lo só trocaria um request por outro no primeiro paint.
 */
const DashboardLazy = lazyRouteComponent(() => import('./routes/Dashboard'), 'Dashboard');
const ProjectPageLazy = lazyRouteComponent(() => import('./routes/ProjectPage'), 'ProjectPage');
const SessionPageLazy = lazyRouteComponent(() => import('./routes/SessionPage'), 'SessionPage');
const ProvisioningPageLazy = lazyRouteComponent(
  () => import('./routes/ProvisioningPage'),
  'ProvisioningPage',
);
const AdoptionPlanPageLazy = lazyRouteComponent(
  () => import('./routes/AdoptionPlanPage'),
  'AdoptionPlanPage',
);
const GitErrorPageLazy = lazyRouteComponent(() => import('./routes/GitErrorPage'), 'GitErrorPage');
const StatusPageLazy = lazyRouteComponent(() => import('./routes/StatusPage'), 'StatusPage');
const LoginPageLazy = lazyRouteComponent(() => import('./routes/LoginPage'), 'LoginPage');
const RegisterPageLazy = lazyRouteComponent(() => import('./routes/RegisterPage'), 'RegisterPage');
const ForgotPasswordPageLazy = lazyRouteComponent(
  () => import('./routes/ForgotPasswordPage'),
  'ForgotPasswordPage',
);
const SetPasswordPageLazy = lazyRouteComponent(
  () => import('./routes/SetPasswordPage'),
  'SetPasswordPage',
);
const VerifyEmailPageLazy = lazyRouteComponent(
  () => import('./routes/VerifyEmailPage'),
  'VerifyEmailPage',
);
const AccountPageLazy = lazyRouteComponent(() => import('./routes/AccountPage'), 'AccountPage');
const ContainersPageLazy = lazyRouteComponent(
  () => import('./routes/ContainersPage'),
  'ContainersPage',
);

/**
 * As rotas que leem params/search montam a tela dentro de um closure — e um
 * closure não tem `.preload`, então o router não saberia que há chunk a
 * esperar e a tela suspenderia no render (fallback visível a cada navegação).
 * `comCarga` pendura no closure o `.preload` da tela que ele renderiza.
 */
function comCarga(
  tela: { preload?: () => Promise<void> },
  render: () => JSX.Element,
): (() => JSX.Element) & { preload?: () => Promise<void> } {
  return Object.assign(render, { preload: tela.preload });
}

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

/**
 * Rotas públicas que não são de auth (ADR 0036).
 *
 * Hoje só `/status`, e ela precisa ser pública por uma razão concreta: o rodapé
 * das telas de auth aponta para lá. Atrás do guard de sessão, clicar em "Status"
 * na tela de login redirecionava de volta para a tela de login — o único destino
 * que ela não pode ter.
 *
 * É seguro: a `StatusPage` só consulta os `/health` da api e do engine, que já
 * são públicos (é o que o Kubernetes usa em probe, antes de qualquer token
 * existir). Nada de projeto, sessão ou usuário passa por ela.
 *
 * Sem `Shell` porque nenhuma navegação da app leva a `/status` — ela é alcançada
 * por URL e pelo rodapé de auth, e a página traz o próprio `<main>` e `<h1>`.
 */
const publicLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'public',
  component: Outlet,
});

const irPara = (rota: string) => {
  void router.navigate({ to: rota });
};

/**
 * `oauthError` vem de `?oauth_error=1` — o callback de login social (ADR
 * 0084) redireciona para cá em QUALQUER falha, sem detalhar o motivo na URL
 * (RN-283). A comparação por STRING `'1'` é de propósito: query param é
 * sempre string, e `Boolean('0')` seria `true`.
 *
 * `proxima` já existia (o `beforeLoad` do `appLayout` a escreve ao redirecionar
 * pro login) e continua sem consumidor — `validateSearch` precisa conhecer a
 * chave só para o `redirect({ search: { proxima } })` daquele `beforeLoad`
 * continuar tipando; usá-la de verdade (voltar pra rota de origem depois do
 * login) é fora do escopo desta mudança.
 */
interface LoginSearch {
  oauthError?: boolean;
  proxima?: string;
}

const loginRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    oauthError: search.oauth_error === '1',
    proxima: typeof search.proxima === 'string' ? search.proxima : undefined,
  }),
  component: comCarga(LoginPageLazy, () => {
    const { oauthError } = loginRoute.useSearch();
    return (
      <LoginPageLazy onEntrar={entrar} irPara={irPara} erroOAuth={oauthError} />
    );
  }),
});

const registerRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/registrar',
  component: comCarga(RegisterPageLazy, () => (
    <RegisterPageLazy onRegistrar={registrar} irPara={irPara} />
  )),
});

const forgotRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/esqueci-senha',
  component: comCarga(ForgotPasswordPageLazy, () => (
    <ForgotPasswordPageLazy onPedir={pedirRedefinicao} irPara={irPara} />
  )),
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
  component: comCarga(SetPasswordPageLazy, () => {
    const { token } = setPasswordRoute.useSearch();
    return (
      <SetPasswordPageLazy token={token} onDefinir={definirSenha} irPara={irPara} />
    );
  }),
});

interface VerifyEmailSearch {
  token?: string;
}

/**
 * Confirmação de e-mail a partir do link do `email_verification` (backlog
 * "SMTP real no MailSender" — ver ADR 0096). Mesmo padrão de
 * `setPasswordRoute`: token só na query string, sem estado de rota.
 */
const verifyEmailRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/verificar-email',
  validateSearch: (search: Record<string, unknown>): VerifyEmailSearch => ({
    token: typeof search.token === 'string' ? search.token : undefined,
  }),
  component: comCarga(VerifyEmailPageLazy, () => {
    const { token } = verifyEmailRoute.useSearch();
    return (
      <VerifyEmailPageLazy token={token} onVerificar={verificarEmail} irPara={irPara} />
    );
  }),
});

const indexRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/',
  component: DashboardLazy,
});

// Fora do escopo de projeto de propósito (fundação de i18n, Onda 6a):
// idioma é preferência do USUÁRIO, não de um projeto — ver AccountPage.
const accountRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/account',
  component: AccountPageLazy,
});

// A página global de containers (ADR 0136, RN-495) — mesmo nível hierárquico
// de `/account`: cross-projeto, não uma aba dentro de um projeto.
const containersRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/containers',
  component: ContainersPageLazy,
});

// A lista de abas mora em `routes/project-tabs.ts` — aqui só se pergunta se a
// chave existe. Enquanto a lista era copiada neste arquivo, aceitar `?tab=x`
// e ter painel para `x` eram duas decisões independentes.
interface ProjectSearch {
  tab?: ChaveDeAba;
  /**
   * A SEÇÃO da aba Configurações a que o link aponta — mesma ideia de `tab`,
   * um degrau abaixo. A lista mora em `routes/settings/sumario.ts` e é a mesma
   * que o sumário ancorado renderiza, pelo motivo que o comentário de `tab`
   * já registra: aceitar uma chave na URL e ter destino para ela não podem ser
   * duas decisões independentes.
   */
  section?: ChaveDeSecao;
}

const projectRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/projects/$projectId',
  // `tab` só existe pra deep-link (ex.: CTA "Definir orçamento" do card do
  // dashboard indo direto pra Configurações) — a navegação normal entre
  // abas continua em estado local, sem escrever na URL a cada clique.
  //
  // `resolverChaveDeAba` (não `ehChaveDeAba` sozinho) porque também aceita
  // os aliases aposentados pela fusão Chat/RAG (`?tab=sessions`,
  // `?tab=rag`) e os resolve pra `chat` — sem isso, um link antigo caía
  // silencioso na Visão geral.
  validateSearch: (search: Record<string, unknown>): ProjectSearch => ({
    tab: resolverChaveDeAba(search.tab),
    section: resolverChaveDeSecao(search.section),
  }),
  component: comCarga(ProjectPageLazy, () => {
    const { projectId } = projectRoute.useParams();
    const { tab, section } = projectRoute.useSearch();
    // `?section=` sozinho ABRE Configurações. A alternativa era abrir a Visão
    // geral e não rolar para lugar nenhum — a mesma falha silenciosa que o
    // registro de abas existe para não repetir: um link que a URL aceita e a
    // tela ignora.
    return (
      <ProjectPageLazy
        projectId={projectId}
        initialTab={tab ?? (section ? 'settings' : undefined)}
        initialSection={section}
      />
    );
  }),
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
  component: comCarga(SessionPageLazy, () => {
    const { projectId, sessionId } = sessionRoute.useParams();
    const { highlightEvent } = sessionRoute.useSearch();
    const navigate = sessionRoute.useNavigate();
    return (
      <SessionPageLazy
        projectId={projectId}
        sessionId={sessionId}
        highlightEvent={highlightEvent}
        // RN-634: depois de "Ativar execução", a sessão que a api criou.
        irParaSessao={(destino) =>
          navigate({
            to: '/projects/$projectId/sessions/$sessionId',
            params: { projectId, sessionId: destino },
          })
        }
      />
    );
  }),
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
  component: comCarga(ProvisioningPageLazy, () => {
    const { projectId } = provisioningRoute.useParams();
    const { provider } = provisioningRoute.useSearch();
    return <ProvisioningPageLazy projectId={projectId} provider={provider} />;
  }),
});

interface AdoptionSearch {
  provider: GitProviderName;
  externalId: string;
}

const adoptionRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/projects/$projectId/adoption',
  validateSearch: (search: Record<string, unknown>): AdoptionSearch => ({
    provider: GIT_PROVIDERS.includes(search.provider as GitProviderName)
      ? (search.provider as GitProviderName)
      : 'local',
    externalId: typeof search.externalId === 'string' ? search.externalId : '',
  }),
  component: comCarga(AdoptionPlanPageLazy, () => {
    const { projectId } = adoptionRoute.useParams();
    const { provider, externalId } = adoptionRoute.useSearch();
    return (
      <AdoptionPlanPageLazy
        projectId={projectId}
        provider={provider}
        externalId={externalId}
      />
    );
  }),
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
  component: comCarga(GitErrorPageLazy, () => {
    const { provider } = gitErrorRoute.useSearch();
    return <GitErrorPageLazy provider={provider} />;
  }),
});

const statusRoute = createRoute({
  getParentRoute: () => publicLayout,
  path: '/status',
  component: comCarga(StatusPageLazy, () => (
    <StatusPageLazy irPara={irPara} voltarPara={temSessao() ? '/' : '/login'} />
  )),
});

const routeTree = rootRoute.addChildren([
  appLayout.addChildren([
    indexRoute,
    accountRoute,
    containersRoute,
    projectRoute,
    sessionRoute,
    provisioningRoute,
    // Fase 12a: a rota era CRIADA e nunca entrava na árvore. Consequência
    // dupla — o `navigate` do wizard para `/adoption` não existia nos tipos
    // (quebrando `tsc -b`, e com ele a imagem de produção da web), e em
    // runtime a tela do plano de adoção era inalcançável por URL.
    adoptionRoute,
    gitErrorRoute,
  ]),
  authLayout.addChildren([
    loginRoute,
    registerRoute,
    forgotRoute,
    setPasswordRoute,
    verifyEmailRoute,
  ]),
  publicLayout.addChildren([statusRoute]),
]);

export const router = createRouter({
  routeTree,
  // O fallback de TODA rota cujo chunk ainda não chegou (AT-300). É por
  // existir um `defaultPendingComponent` que o router envolve cada rota num
  // `Suspense` PRÓPRIO — então o que some enquanto a tela carrega é só o
  // miolo, e o `Shell` (trilho, sidebar) fica de pé.
  defaultPendingComponent: CarregandoRota,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
