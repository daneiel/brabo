import type React from 'react';
import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ContainersPage } from './ContainersPage';
import { ToastProvider } from '../components/ui/ToastProvider';
import type { ContainerOverviewItem, ProposedAction, Session } from '../lib/api-types';
import i18n from '../lib/i18n';

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});
afterAll(() => {
  void i18n.changeLanguage('en');
});

const getContainerState = vi.fn();
const proposeAction = vi.fn();
const approveAction = vi.fn();
const denyAction = vi.fn();
const approveAlwaysAction = vi.fn();

vi.mock('../lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api-client')>();
  return {
    ...original,
    getContainerState: (...args: unknown[]) => getContainerState(...args),
    proposeAction: (...args: unknown[]) => proposeAction(...args),
    approveAction: (...args: unknown[]) => approveAction(...args),
    denyAction: (...args: unknown[]) => denyAction(...args),
    approveAlwaysAction: (...args: unknown[]) => approveAlwaysAction(...args),
  };
});

const useContainersOverview = vi.fn();
const useCurrentWorkspace = vi.fn();
const useLatestSession = vi.fn();

vi.mock('../lib/hooks', () => ({
  useContainersOverview: (...args: unknown[]) => useContainersOverview(...args),
  useCurrentWorkspace: (...args: unknown[]) => useCurrentWorkspace(...args),
  useLatestSession: (...args: unknown[]) => useLatestSession(...args),
}));

vi.mock('../lib/auth', () => ({
  userIdDaSessao: () => 'user-1',
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, ...rest }: { children: React.ReactNode; to: string; params?: unknown } & Record<string, unknown>) => (
    <a href={params ? `${to}-${JSON.stringify(params)}` : to} {...rest}>
      {children}
    </a>
  ),
}));

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ContainersPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function sessaoRecente(id = 'sess-1'): Session {
  return {
    id,
    projectId: 'proj-1',
    createdBy: 'user-1',
    status: 'active',
    kind: 'criativa',
    name: null,
    nextSeq: 5,
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
    closedAt: null,
  };
}

function item(overrides: Partial<ContainerOverviewItem> = {}): ContainerOverviewItem {
  return {
    projectId: 'proj-1',
    projectName: 'core',
    projectSlug: 'core',
    status: 'running',
    imageVersion: 2,
    imagem: 'node:22-bookworm-slim',
    resources: { cpus: 2, memoryMb: 4096, pidsLimit: 512 },
    failureReason: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    statusChangedAt: '2026-08-01T10:05:00.000Z',
    observado: null,
    naoObservado: null,
    detalheDaObservacao: null,
    naoVerificado: null,
    acaoPendente: null,
    ...overrides,
  };
}

function acaoPendente(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'pa-1',
    projectId: 'proj-1',
    sessionId: 'sess-original',
    seq: 3,
    actionType: 'container_stop',
    payload: {},
    status: 'pending',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'user', id: 'user-1' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useCurrentWorkspace.mockReturnValue({ data: { id: 'ws-1', name: 'Acme', slug: 'acme' } });
  useLatestSession.mockReturnValue({ latest: sessaoRecente() });
});

describe('ContainersPage', () => {
  it('carregando: mostra o estado de loading, não a tabela nem erro', () => {
    useContainersOverview.mockReturnValue({ isPending: true, isError: false, data: undefined, refetch: vi.fn() });

    montar();

    expect(screen.getByText('Carregando…')).toBeInTheDocument();
  });

  it('erro: mostra ErroDeCarregamento com botão de tentar de novo', () => {
    useContainersOverview.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error('falhou'),
      data: undefined,
      refetch: vi.fn(),
    });

    montar();

    expect(screen.getByText('Não foi possível carregar os containers.')).toBeInTheDocument();
  });

  it('vazio: mostra a mensagem de vazio da tabela', () => {
    useContainersOverview.mockReturnValue({ isPending: false, isError: false, data: [], refetch: vi.fn() });

    montar();

    expect(
      screen.getByText('Nenhum projeto deste workspace provisionou um container ainda.'),
    ).toBeInTheDocument();
  });

  it('renderiza imagem+versão, estado registrado e recursos de uma linha', () => {
    useContainersOverview.mockReturnValue({ isPending: false, isError: false, data: [item()], refetch: vi.fn() });

    montar();

    expect(screen.getByText('core')).toBeInTheDocument();
    expect(screen.getByText('node:22-bookworm-slim')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getByText('rodando')).toBeInTheDocument();
  });

  it('naoVerificado (teto atingido) NUNCA é confundido com naoObservado — texto próprio', () => {
    useContainersOverview.mockReturnValue({
      isPending: false,
      isError: false,
      data: [item({ naoVerificado: 'teto_de_verificacoes_atingido' })],
      refetch: vi.fn(),
    });

    montar();

    expect(
      screen.getByText('não verificado — teto de verificações da carga foi atingido'),
    ).toBeInTheDocument();
  });

  it('naoObservado (broker sem resposta) tem texto distinto de naoVerificado', () => {
    useContainersOverview.mockReturnValue({
      isPending: false,
      isError: false,
      data: [item({ naoObservado: 'broker-sem-resposta', detalheDaObservacao: 'timeout' })],
      refetch: vi.fn(),
    });

    montar();

    expect(screen.getByText('broker não respondeu')).toBeInTheDocument();
  });

  it('clique em "Parar" propõe container_stop na sessão mais recente do PROJETO', async () => {
    useContainersOverview.mockReturnValue({ isPending: false, isError: false, data: [item()], refetch: vi.fn() });
    proposeAction.mockResolvedValue(acaoPendente());

    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Parar' }));

    await waitFor(() => {
      expect(proposeAction).toHaveBeenCalledWith('proj-1', 'sess-1', {
        actionType: 'container_stop',
        actor: { kind: 'user', id: 'user-1' },
        payload: {},
      });
    });
  });

  it('clique em "Remover" propõe container_remove', async () => {
    useContainersOverview.mockReturnValue({ isPending: false, isError: false, data: [item()], refetch: vi.fn() });
    proposeAction.mockResolvedValue(acaoPendente({ actionType: 'container_remove' }));

    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Remover' }));

    await waitFor(() => {
      expect(proposeAction).toHaveBeenCalledWith(
        'proj-1',
        'sess-1',
        expect.objectContaining({ actionType: 'container_remove' }),
      );
    });
  });

  it('"Subir de novo" busca a decisão vigente e propõe container_start com ela — nunca inventa payload', async () => {
    useContainersOverview.mockReturnValue({
      isPending: false,
      isError: false,
      data: [item({ status: 'stopped' })],
      refetch: vi.fn(),
    });
    getContainerState.mockResolvedValue({
      status: 'decidido',
      decisao: {
        image: 'node:22-bookworm-slim',
        rationale: 'stack combina',
        network: 'none',
        resources: { cpus: 2, memoryMb: 4096, pidsLimit: 512 },
      },
      version: 3,
      eventId: 'evt-1',
      decidedAt: '2026-08-01T10:00:00.000Z',
    });
    proposeAction.mockResolvedValue(acaoPendente({ actionType: 'container_start' }));

    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Subir de novo' }));

    await waitFor(() => {
      expect(getContainerState).toHaveBeenCalledWith('proj-1');
      expect(proposeAction).toHaveBeenCalledWith('proj-1', 'sess-1', {
        actionType: 'container_start',
        actor: { kind: 'user', id: 'user-1' },
        payload: {
          imagem: 'node:22-bookworm-slim',
          network: 'none',
          resources: { cpus: 2, memoryMb: 4096, pidsLimit: 512 },
          rationale: 'Reprovisiona com a decisão de imagem vigente do projeto.',
        },
      });
    });
  });

  it('sem decisão vigente: "Subir de novo" falha com toast, sem propor nada', async () => {
    useContainersOverview.mockReturnValue({
      isPending: false,
      isError: false,
      data: [item({ status: 'stopped' })],
      refetch: vi.fn(),
    });
    getContainerState.mockResolvedValue({
      status: 'sem_decisao',
      decisao: null,
      version: 0,
      eventId: null,
      decidedAt: null,
    });

    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Subir de novo' }));

    await waitFor(() => {
      expect(screen.getByText('Sem decisão de imagem para este projeto')).toBeInTheDocument();
    });
    expect(proposeAction).not.toHaveBeenCalled();
  });

  it('sem sessão no projeto: os três botões ficam desabilitados', () => {
    useLatestSession.mockReturnValue({ latest: undefined });
    useContainersOverview.mockReturnValue({ isPending: false, isError: false, data: [item()], refetch: vi.fn() });

    montar();

    expect(screen.getByRole('button', { name: 'Parar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remover' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Subir de novo' })).toBeDisabled();
  });

  it('com ação pendente: mostra o card de decisão em vez dos três botões', () => {
    useContainersOverview.mockReturnValue({
      isPending: false,
      isError: false,
      data: [item({ acaoPendente: acaoPendente() })],
      refetch: vi.fn(),
    });

    montar();

    expect(screen.queryByRole('button', { name: 'Parar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aprovar' })).toBeInTheDocument();
  });

  it('aprovar a ação pendente usa o sessionId da PRÓPRIA ação, não a sessão mais recente', async () => {
    useContainersOverview.mockReturnValue({
      isPending: false,
      isError: false,
      data: [item({ acaoPendente: acaoPendente({ sessionId: 'sess-original' }) })],
      refetch: vi.fn(),
    });
    approveAction.mockResolvedValue(acaoPendente({ status: 'approved' }));

    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }));

    await waitFor(() => {
      expect(approveAction).toHaveBeenCalledWith('proj-1', 'sess-original', 'pa-1');
    });
  });

  it('container_remove pendente: o card NÃO oferece "sempre permitir" (teto absoluto)', () => {
    useContainersOverview.mockReturnValue({
      isPending: false,
      isError: false,
      data: [item({ acaoPendente: acaoPendente({ actionType: 'container_remove' }) })],
      refetch: vi.fn(),
    });

    montar();

    expect(screen.getByRole('button', { name: 'Aprovar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sempre permitir' })).not.toBeInTheDocument();
  });
});
