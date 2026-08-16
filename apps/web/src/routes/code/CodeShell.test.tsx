import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CodeShell } from './CodeShell';

const getRepository = vi.fn();
const getCodeBranches = vi.fn();

vi.mock('../../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../../lib/api-client')>('../../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getRepository: (...args: unknown[]) => getRepository(...args),
    getCodeBranches: (...args: unknown[]) => getCodeBranches(...args),
  };
});

vi.mock('../../lib/hooks', () => ({
  useLatestSession: () => ({ latest: undefined }),
  useSessionEvents: () => ({ data: undefined }),
  useArchitecture: () => ({ data: undefined }),
  useHandoffs: () => ({ data: undefined }),
  usePendingActions: () => ({ data: undefined }),
}));

vi.mock('./CodeExplorer', () => ({
  CodeExplorer: () => <div>painel explorador</div>,
}));
vi.mock('./CodeSearchPanel', () => ({
  CodeSearchPanel: () => <div>painel busca</div>,
}));
vi.mock('./CodeEditor', () => ({
  CodeEditor: () => <div>painel editor</div>,
}));
vi.mock('./CodeBottomPanel', () => ({
  CodeBottomPanel: () => <div>painel inferior</div>,
}));
vi.mock('./CodeBranchPicker', () => ({
  CodeBranchPicker: ({ currentRef }: { currentRef: string }) => <div>branch: {currentRef}</div>,
}));

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CodeShell projectId="p-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getRepository.mockResolvedValue({
    id: 'r-1', projectId: 'p-1', provider: 'github', externalId: 'x',
    url: 'https://github.com/x/y', defaultBranch: 'dev', visibility: 'private',
    origin: 'created', provisionedBy: 'u-1', createdAt: '', updatedAt: '',
  });
  getCodeBranches.mockResolvedValue({
    items: [
      { name: 'dev', commitSha: 'a1', protected: true, ahead: 3, behind: 1, pullRequest: null, producedBy: null },
    ],
    truncated: false,
  });
});

describe('CodeShell', () => {
  it('abre no explorador por padrão, com a ref default do repositório', async () => {
    montar();
    expect(await screen.findByText('painel explorador')).toBeInTheDocument();
    expect(screen.queryByText('painel busca')).not.toBeInTheDocument();
    expect(await screen.findAllByText(/dev/)).not.toHaveLength(0);
  });

  it('o rail troca para Buscar, e some o explorador', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByText('painel explorador');

    await user.click(screen.getByTitle('Buscar'));

    expect(await screen.findByText('painel busca')).toBeInTheDocument();
    expect(screen.queryByText('painel explorador')).not.toBeInTheDocument();
  });

  it('itens do rail sem dado real vêm desabilitados, com o motivo no tooltip', async () => {
    montar();
    const agentes = await screen.findByLabelText('Agentes (indisponível)');
    expect(agentes).toBeDisabled();
    expect(agentes.getAttribute('title')).toMatch(/Visão geral/);
  });

  it('o painel inferior nasce fechado, e o botão abre/fecha', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByText('painel explorador');

    expect(screen.queryByText('painel inferior')).not.toBeInTheDocument();
    await user.click(screen.getByText('Painel inferior'));
    expect(await screen.findByText('painel inferior')).toBeInTheDocument();
    await user.click(screen.getByText('Fechar painel inferior'));
    expect(screen.queryByText('painel inferior')).not.toBeInTheDocument();
  });

  it('sem sessão/eventos ainda, mostra 0 agentes ativos — dado real, não inventado', async () => {
    montar();
    expect(await screen.findByText(/0 agentes ativos/)).toBeInTheDocument();
  });

  it('a status bar mostra ↑/↓ real da branch atual (getCodeBranches, não inventado)', async () => {
    montar();
    expect(await screen.findByText('↑3 ↓1')).toBeInTheDocument();
  });

  it('sem ahead/behind (branch em dia), a status bar não mostra o par vazio', async () => {
    getCodeBranches.mockResolvedValue({
      items: [
        { name: 'dev', commitSha: 'a1', protected: true, ahead: 0, behind: 0, pullRequest: null, producedBy: null },
      ],
      truncated: false,
    });
    montar();
    await screen.findByText('painel explorador');
    expect(screen.queryByText(/↑|↓/)).not.toBeInTheDocument();
  });
});
