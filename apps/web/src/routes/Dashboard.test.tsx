import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Dashboard } from './Dashboard';
import { ApiError } from '../lib/api-client';
import type { Project, WorkspaceSummary } from '../lib/api-types';

const PROJECT: Project = {
  id: 'project-1',
  workspaceId: 'ws-1',
  name: 'Core API',
  slug: 'core-api',
  createdBy: 'user-1',
  maxConsecutiveBlocked: null,
  storyPromotion: 'manual',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const SUMMARY: WorkspaceSummary = { activeProjects: 1, agentCount: 2, spentMicros: 5_000_000 };

const useProjectsMock = vi.fn();
const useWorkspaceSummaryMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../lib/hooks', () => ({
  useCurrentWorkspace: () => ({ data: { id: 'ws-1', name: 'Acme', slug: 'acme' } }),
  useProjects: () => useProjectsMock(),
  useWorkspaceSummary: () => useWorkspaceSummaryMock(),
  useProjectLastActivity: () => 'sem atividade ainda',
  useLatestSession: () => ({ latest: undefined }),
  useSessionEvents: () => ({ data: undefined }),
  useArchitecture: () => ({ data: undefined }),
  useHandoffs: () => ({ data: undefined }),
  usePendingActions: () => ({ data: undefined }),
}));

vi.mock('../lib/notifications', () => ({
  useProjectsUnread: (projects: Project[] | undefined) =>
    (projects ?? []).map((project) => ({
      project,
      latestSession: undefined,
      latestSeq: 0,
      unreadCount: 0,
    })),
  useNotificationGroups: () => [],
  useStoriesAwaitingPromotion: () => 0,
}));

vi.mock('../lib/api-client', async () => {
  // `ApiError`/`mensagemDaApi` reais: é a frase da api que precisa chegar à
  // tela no caminho de erro.
  const real =
    await vi.importActual<typeof import('../lib/api-client')>('../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getRepository: () => Promise.resolve(null),
    getProjectBudget: () => Promise.resolve(null),
    getBootstrapStatus: () => Promise.resolve(null),
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

beforeEach(() => {
  useProjectsMock.mockReset();
  useWorkspaceSummaryMock.mockReset();
  useWorkspaceSummaryMock.mockReturnValue({ data: SUMMARY, isError: false });
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
