import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Shell } from './Shell';
import type { Project, WorkspaceWithRole } from '../lib/api-types';

const navigate = vi.fn();
const sair = vi.fn(() => Promise.resolve());

const PROJECT: Project = {
  id: 'project-1',
  workspaceId: 'ws-1',
  name: 'Core API',
  slug: 'core-api',
  createdBy: 'user-1',
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
  useProjects: () => ({ data: [PROJECT] }),
  useProjectsStatus: () => ({ data: [] }),
  useProjectHasRecentActivity: () => true,
}));

vi.mock('../lib/notifications', () => ({
  useProjectsUnread: () => [
    { project: PROJECT, latestSession: undefined, latestSeq: 0, unreadCount: 0 },
  ],
}));

vi.mock('../lib/api-client', () => ({
  getProjectBudget: () => Promise.resolve(null),
}));

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
