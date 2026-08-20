import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { ProjectPage } from './ProjectPage';
import { ApiError } from '../lib/api-client';
import type { Project } from '../lib/api-types';

const getProject = vi.fn();
const getRepository = vi.fn();
const getProjectBudget = vi.fn();

vi.mock('../lib/api-client', async () => {
  // `ApiError` e `mensagemDaApi` reais: o que este teste prova é justamente
  // que a FRASE da api chega à tela, e um dublê de `mensagemDaApi` provaria
  // apenas que o componente chama uma função.
  const real =
    await vi.importActual<typeof import('../lib/api-client')>('../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getProject: (...args: unknown[]) => getProject(...args),
    getRepository: (...args: unknown[]) => getRepository(...args),
    getProjectBudget: (...args: unknown[]) => getProjectBudget(...args),
  };
});

vi.mock('../lib/hooks', () => ({
  useArchitecture: () => ({ data: undefined }),
  useBacklog: () => ({ data: [] }),
  useHypotheses: () => ({ data: [] }),
  useLatestSession: () => ({ latest: undefined }),
  usePendingActions: () => ({ data: undefined }),
  useProjectPendingActions: () => ({ data: undefined }),
}));

// As abas são inteiras demais para montar aqui, e nenhuma delas é o assunto:
// o defeito estava na moldura, antes de qualquer aba renderizar.
vi.mock('./ProjectOverviewTab', () => ({ ProjectOverviewTab: () => <div>aba visão geral</div> }));
vi.mock('./ProjectSessionsTab', () => ({
  ProjectCriativoTab: () => null,
  ProjectChatTab: () => null,
}));
vi.mock('./ProjectApprovalsTab', () => ({ ProjectApprovalsTab: () => null }));
vi.mock('./ProjectBacklogTab', () => ({
  ProjectBacklogTab: () => null,
  aguardandoPromocao: () => [],
}));
vi.mock('./ProjectInsightsTab', () => ({ ProjectInsightsTab: () => null }));
vi.mock('./ProjectSettingsTab', () => ({ ProjectSettingsTab: () => null }));

const PROJETO: Project = {
  id: 'proj-1',
  workspaceId: 'ws-1',
  name: 'Checkout',
  slug: 'checkout',
  createdBy: 'user-1',
  maxConsecutiveBlocked: null,
  storyPromotion: 'manual',
  workspaceMode: 'container',
  workspacePath: null,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
};

function montar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProjectPage projectId="proj-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getRepository.mockResolvedValue(null);
  getProjectBudget.mockResolvedValue(null);
});

/**
 * O defeito: abrir `/projects/:id` com a api limitando devolvia a área
 * principal COMPLETAMENTE em branco — sem mensagem, sem estado de erro, sem
 * esqueleto — porque `if (!project) return null` tratava "a api recusou" e
 * "ainda não chegou" como a mesma coisa. O motivo existia só no console, em
 * 1128 linhas de 429 (RN-088).
 */
describe('ProjectPage — falha de carga não vira tela branca', () => {
  it('429 vira mensagem na tela, com a frase que a api mandou', async () => {
    getProject.mockRejectedValue(
      new ApiError(
        429,
        {
          statusCode: 429,
          message: 'Limite de requisições excedido. Tente novamente em instantes.',
          error: 'Too Many Requests',
        },
        'trace-abc123',
      ),
    );

    montar();

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Não foi possível abrir este projeto.');
    // A frase da API, e não um texto genérico nosso: é ela que diz se adianta
    // esperar.
    expect(alerta).toHaveTextContent(
      'Limite de requisições excedido. Tente novamente em instantes.',
    );
    // O trace_id leva desta tela ao span de servidor (ADR 0035).
    expect(alerta).toHaveTextContent('trace-abc123');
    expect(
      screen.getByRole('button', { name: 'Tentar de novo' }),
    ).toBeInTheDocument();
  });

  it('403 mostra o motivo do 403 — a tela não inventa uma causa só', async () => {
    getProject.mockRejectedValue(
      new ApiError(403, { statusCode: 403, message: 'Acesso negado ao projeto.' }),
    );

    montar();

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Acesso negado ao projeto.');
    expect(alerta).not.toHaveTextContent('Limite de requisições');
  });

  it('carregando não é erro: mostra esqueleto e nenhum alerta', () => {
    getProject.mockReturnValue(new Promise(() => {}));

    montar();

    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('caminho feliz: o projeto abre e as abas aparecem', async () => {
    getProject.mockResolvedValue(PROJETO);

    montar();

    expect(await screen.findByText('Checkout')).toBeInTheDocument();
    expect(screen.getByText('aba visão geral')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
