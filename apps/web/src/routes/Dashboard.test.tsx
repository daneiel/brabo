import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Dashboard } from './Dashboard';
import { ApiError } from '../lib/api-client';
// A instância REAL do app: `Dashboard.tsx` usa `useTranslation('dashboard')`
// sem `I18nextProvider` próprio (mesmo padrão de `ProjectExecutorsTab.test.tsx`)
// — `changeLanguage('pt-BR')` mantém as asserções abaixo no texto de sempre.
import i18n from '../lib/i18n';
import type { Project, ProjectCardSummary, WorkspaceSummary } from '../lib/api-types';

const PROJECT: Project = {
  id: 'project-1',
  workspaceId: 'ws-1',
  name: 'Core API',
  slug: 'core-api',
  createdBy: 'user-1',
  maxConsecutiveBlocked: null,
  storyPromotion: 'manual',
  executionMode: 'container',
  workspacePath: null,
  workspaceVerifiedAt: null,
  mirrorPath: null,
  language: 'pt-BR',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const SUMMARY: WorkspaceSummary = { activeProjects: 1, agentCount: 2, spentMicros: 5_000_000 };

const useProjectsMock = vi.fn();
const useWorkspaceSummaryMock = vi.fn();
const useProjectsSummaryMock = vi.fn();

function cardDoProjeto(over: Partial<ProjectCardSummary> = {}): ProjectCardSummary {
  return {
    projectId: PROJECT.id,
    provider: 'local',
    provisioningStatus: 'provisioned',
    budget: null,
    latestSessionId: 'sess-1',
    latestSeq: 0,
    lastEvent: null,
    storiesAwaitingPromotion: 0,
    pendingApprovalsCount: 0,
    onlineAgentCount: 0,
    roster: {
      executionActivated: false,
      moduleNames: [],
      gatesEverOpened: false,
      delegatedSubagents: [],
      activatedAgents: [],
      infraActive: false,
      uxDesignerActive: false,
      staffActive: false,
    },
    ...over,
  };
}

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../lib/hooks', () => ({
  useCurrentWorkspace: () => ({ data: { id: 'ws-1', name: 'Acme', slug: 'acme' } }),
  useProjects: () => useProjectsMock(),
  useWorkspaceSummary: () => useWorkspaceSummaryMock(),
  useProjectsSummary: () => useProjectsSummaryMock(),
}));

vi.mock('../lib/notifications', () => ({
  useProjectsUnread: (projects: Project[] | undefined) =>
    (projects ?? []).map((project) => ({
      project,
      latestSessionId: null,
      latestSeq: 0,
      unreadCount: 0,
    })),
  useNotificationGroups: () => [],
  storiesAwaitingPromotion: () => 0,
}));

vi.mock('../lib/api-client', async () => {
  // `ApiError`/`mensagemDaApi` reais: é a frase da api que precisa chegar à
  // tela no caminho de erro.
  const real =
    await vi.importActual<typeof import('../lib/api-client')>('../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
  };
});

vi.mock('./NewProjectWizard', () => ({
  NewProjectWizard: () => <div data-testid="wizard-stub" />,
}));

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Dashboard />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
  useProjectsMock.mockReset();
  useWorkspaceSummaryMock.mockReset();
  useWorkspaceSummaryMock.mockReturnValue({ data: SUMMARY, isError: false });
  useProjectsSummaryMock.mockReset();
  useProjectsSummaryMock.mockReturnValue({ data: [], isLoading: false });
});

describe('Dashboard — estados', () => {
  it('carregando: mostra skeletons no lugar da grade', () => {
    useProjectsMock.mockReturnValue({ data: undefined, isLoading: true });

    renderDashboard();

    expect(screen.getAllByTestId('project-card-skeleton').length).toBeGreaterThan(0);
  });

  it('primeiro uso: workspace sem projeto nenhum mostra CTA de criar', () => {
    useProjectsMock.mockReturnValue({ data: [], isLoading: false });

    renderDashboard();

    expect(screen.getByText('Nenhum projeto por aqui ainda.')).toBeInTheDocument();
    const cta = screen.getByRole('button', { name: /Criar projeto/ });
    expect(cta).toBeInTheDocument();

    fireEvent.click(cta);
    expect(screen.getByTestId('wizard-stub')).toBeInTheDocument();
  });

  it('busca sem resultado: copy diferente do primeiro uso, sem CTA de criar', () => {
    useProjectsMock.mockReturnValue({ data: [PROJECT], isLoading: false });

    renderDashboard();

    fireEvent.change(screen.getByPlaceholderText('Buscar projetos…'), {
      target: { value: 'não existe' },
    });

    expect(
      screen.getByText('Nenhum projeto encontrado para "não existe".'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Criar projeto/ })).not.toBeInTheDocument();
  });

  // O caso perigoso não é o branco: é a tela AFIRMANDO o contrário. Com a api
  // limitando, `!projects` era verdadeiro e o dashboard convidava a criar o
  // primeiro projeto de um workspace que podia ter vinte (RN-088).
  it('erro na lista: diz o que a api respondeu, e não "nenhum projeto ainda"', () => {
    useProjectsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(429, {
        message: 'Limite de requisições excedido. Tente novamente em instantes.',
      }),
      refetch: vi.fn(),
    });

    renderDashboard();

    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent('Não foi possível carregar seus projetos.');
    expect(alerta).toHaveTextContent(
      'Limite de requisições excedido. Tente novamente em instantes.',
    );
    expect(screen.queryByText('Nenhum projeto por aqui ainda.')).toBeNull();
  });

  it('erro no resumo do workspace não derruba a grade de cards', () => {
    useProjectsMock.mockReturnValue({ data: [PROJECT], isLoading: false });
    useWorkspaceSummaryMock.mockReturnValue({ data: undefined, isError: true });

    renderDashboard();

    expect(screen.getByText('resumo indisponível')).toBeInTheDocument();
    expect(screen.getByText('Core API')).toBeInTheDocument();
  });
});

/**
 * RN-648 (AT-325) — a linha de atividade do card tinha UM texto ("Sem atividade
 * ainda") para quatro estados, e o levantamento visual o achou num projeto com
 * três sessões e dezesseis eventos: o resumo do workspace tinha FALHADO. A
 * linha lê a sessão mais recente, a mesma da Visão geral e da sidebar.
 */
describe('Dashboard — linha de atividade do card (RN-648)', () => {
  it('o resumo que falhou diz "indisponível", nunca "sem atividade"', () => {
    useProjectsMock.mockReturnValue({ data: [PROJECT], isLoading: false });
    useProjectsSummaryMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });

    renderDashboard();

    expect(screen.getByText('atividade indisponível')).toBeInTheDocument();
    expect(screen.queryByText(/Sem atividade/)).toBeNull();
  });

  it('enquanto o resumo carrega, o card não afirma nada sobre atividade', () => {
    useProjectsMock.mockReturnValue({ data: [PROJECT], isLoading: false });
    useProjectsSummaryMock.mockReturnValue({ data: undefined, isLoading: true });

    renderDashboard();

    expect(screen.getByText('carregando atividade…')).toBeInTheDocument();
    expect(screen.queryByText(/Sem atividade/)).toBeNull();
  });

  it('projeto sem sessão nenhuma e sessão mais recente vazia têm textos diferentes', () => {
    useProjectsMock.mockReturnValue({ data: [PROJECT], isLoading: false });
    useProjectsSummaryMock.mockReturnValue({
      data: [cardDoProjeto({ latestSessionId: null })],
      isLoading: false,
    });
    const { unmount } = renderDashboard();
    expect(screen.getByText('Nenhuma sessão ainda')).toBeInTheDocument();
    unmount();

    useProjectsSummaryMock.mockReturnValue({
      data: [cardDoProjeto({ latestSessionId: 'sess-1', lastEvent: null })],
      isLoading: false,
    });
    renderDashboard();
    expect(screen.getByText('Sem atividade na sessão mais recente ainda')).toBeInTheDocument();
  });

  it('com evento na sessão mais recente, mostra o evento e não o vazio', () => {
    useProjectsMock.mockReturnValue({ data: [PROJECT], isLoading: false });
    useProjectsSummaryMock.mockReturnValue({
      data: [
        cardDoProjeto({
          lastEvent: {
            id: 'ev-1',
            sessionId: 'sess-1',
            seq: 3,
            type: 'agent.response',
            actor: { kind: 'agent', id: 'criativo' },
            payload: { content: 'oi' },
            createdAt: new Date().toISOString(),
          } as ProjectCardSummary['lastEvent'],
        }),
      ],
      isLoading: false,
    });

    renderDashboard();

    expect(screen.queryByText(/Sem atividade/)).toBeNull();
    expect(screen.queryByText('Nenhuma sessão ainda')).toBeNull();
  });
});
