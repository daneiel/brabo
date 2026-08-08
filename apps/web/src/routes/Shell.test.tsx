import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Shell } from './Shell';
import { ApiError } from '../lib/api-client';
import type { Project, WorkspaceWithRole } from '../lib/api-types';

const navigate = vi.fn();
const sair = vi.fn(() => Promise.resolve());

// Mutável porque a sidebar muda de comportamento com a LISTA (nome repetido
// ganha desempate, nome único não), e os mocks de módulo são hoisted.
const estado = vi.hoisted(() => ({
  projects: [] as unknown[],
  projectsQuery: {} as Record<string, unknown>,
}));

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

const WORKSPACE_WITH_ROLE: WorkspaceWithRole = {
  workspace: {
    id: 'ws-1',
    name: 'Acme',
    slug: 'acme',
    createdBy: 'user-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  role: 'maintainer',
};

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params }: { children: React.ReactNode; to: string; params?: unknown }) => (
    <a href={`${to}-${JSON.stringify(params)}`}>{children}</a>
  ),
  Outlet: () => null,
  useNavigate: () => navigate,
  useRouterState: () => '/',
}));

vi.mock('../lib/auth', () => ({
  emailDaSessao: () => 'dev.senior@brabo.dev',
  sair: () => sair(),
}));

vi.mock('../lib/hooks', () => ({
  useCurrentWorkspace: () => ({ data: WORKSPACE_WITH_ROLE.workspace }),
  useCurrentWorkspaceWithRole: () => ({ data: WORKSPACE_WITH_ROLE }),
  useProjects: () => ({ data: estado.projects, ...estado.projectsQuery }),
  useProjectsStatus: () => ({ data: [] }),
  useProjectsSummary: () => ({ data: [] }),
}));

vi.mock('../lib/notifications', () => ({
  useProjectsUnread: () =>
    estado.projects.map((project) => ({
      project,
      latestSessionId: null,
      latestSeq: 0,
      unreadCount: 0,
    })),
}));

vi.mock('../lib/api-client', async () => {
  // `mensagemDaApi` real: o que o teste do caminho de erro prova é que a FRASE
  // da api chega à sidebar.
  const real =
    await vi.importActual<typeof import('../lib/api-client')>('../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
  };
});

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Shell />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  navigate.mockClear();
  sair.mockClear();
  estado.projects = [PROJECT];
  estado.projectsQuery = {};
});

describe('Shell — rodapé', () => {
  it('mostra o papel RBAC, sem texto de senioridade/proficiência', () => {
    renderShell();

    expect(screen.getByText('dev.senior@brabo.dev')).toBeInTheDocument();
    // Exatamente "maintainer" — nada de "{senioridade} · {papel}" do mock
    // (item 4 pede só o papel RBAC, a proficiência da Anamnese fica de fora).
    expect(screen.getByText('maintainer')).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  it('sair continua funcionando', async () => {
    renderShell();

    screen.getByRole('button', { name: 'sair' }).click();

    await vi.waitFor(() => expect(sair).toHaveBeenCalledOnce());
  });
});

/**
 * Uma execução de validação criou vinte projetos chamados `validacao-real`. Na
 * sidebar eram vinte linhas idênticas — nada dizia qual era qual.
 */
describe('Shell — projetos de mesmo nome na sidebar', () => {
  it('nome repetido ganha id abreviado e data; o nome único não ganha nada', () => {
    estado.projects = [
      { ...PROJECT, id: 'aaaaaaaa-1111-4000-8000-000000000001', name: 'validacao-real' },
      { ...PROJECT, id: 'bbbbbbbb-2222-4000-8000-000000000002', name: 'validacao-real' },
      { ...PROJECT, id: 'cccccccc-3333-4000-8000-000000000003', name: 'Core API' },
    ];

    renderShell();

    expect(screen.getAllByText('validacao-real')).toHaveLength(2);
    expect(screen.getByText(/^#aaaaaaaa · /)).toBeInTheDocument();
    expect(screen.getByText(/^#bbbbbbbb · /)).toBeInTheDocument();
    // O de nome único fica limpo: desempate em toda linha seria ruído no
    // lugar com menos espaço da tela.
    expect(screen.queryByText(/^#cccccccc/)).toBeNull();
  });

  it('lista sem repetição nenhuma não mostra desempate', () => {
    estado.projects = [
      { ...PROJECT, id: 'aaaaaaaa-1111-4000-8000-000000000001', name: 'Core API' },
      { ...PROJECT, id: 'bbbbbbbb-2222-4000-8000-000000000002', name: 'Web' },
    ];

    renderShell();

    expect(screen.queryByText(/^#[0-9a-f]{8} · /)).toBeNull();
  });
});

describe('Shell — lista de projetos que não carrega', () => {
  it('429 na lista vira mensagem na sidebar, não sidebar vazia', () => {
    estado.projects = [];
    estado.projectsQuery = {
      isError: true,
      error: new ApiError(429, {
        message: 'Limite de requisições excedido. Tente novamente em instantes.',
      }),
      refetch: vi.fn(),
    };

    renderShell();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Limite de requisições excedido. Tente novamente em instantes.',
    );
    expect(
      screen.getByRole('button', { name: 'tentar de novo' }),
    ).toBeInTheDocument();
  });

  it('lista carregada não mostra alerta nenhum', () => {
    renderShell();

    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Shell — nav global inerte', () => {
  it('Chat global e Configurações aparecem, mas não navegam ao clicar', () => {
    renderShell();

    const chat = screen.getByText('Chat global');
    const settings = screen.getByText('Configurações');
    expect(chat).toBeInTheDocument();
    expect(settings).toBeInTheDocument();

    // Nem `<a>` nem `<button>` — não é um destino de navegação real.
    expect(chat.closest('a')).toBeNull();
    expect(settings.closest('a')).toBeNull();

    chat.click();
    settings.click();
    expect(navigate).not.toHaveBeenCalled();
  });
});
