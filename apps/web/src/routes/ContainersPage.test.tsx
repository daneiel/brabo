import type React from 'react';
import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ContainersPage } from './ContainersPage';
import { ToastProvider } from '../components/ui/ToastProvider';
import type {
  ContainerOverviewItem,
  ProposedAction,
  RegistroDeContainer,
  Role,
  Session,
} from '../lib/api-types';
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
const useCurrentWorkspaceWithRole = vi.fn();
const useLatestSession = vi.fn();

vi.mock('../lib/hooks', () => ({
  useContainersOverview: (...args: unknown[]) => useContainersOverview(...args),
  useCurrentWorkspaceWithRole: (...args: unknown[]) =>
    useCurrentWorkspaceWithRole(...args),
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

function comPapel(role: Role) {
  useCurrentWorkspaceWithRole.mockReturnValue({
    data: { workspace: { id: 'ws-1', name: 'Acme', slug: 'acme' }, role },
  });
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

function registro(
  overrides: Partial<RegistroDeContainer> = {},
): RegistroDeContainer {
  return {
    status: 'running',
    imageVersion: 2,
    imagem: 'node:22-bookworm-slim',
    resources: { cpus: 2, memoryMb: 4096, pidsLimit: 512 },
    failureReason: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    statusChangedAt: '2026-08-01T10:05:00.000Z',
    ...overrides,
  };
}

function item(overrides: Partial<ContainerOverviewItem> = {}): ContainerOverviewItem {
  return {
    projectId: 'proj-1',
    projectName: 'core',
    projectSlug: 'core',
    executionMode: 'container',
    registrado: registro(),
    temImagemDecidida: true,
    workspaceVerifiedAt: null,
    observado: null,
    naoObservado: null,
    detalheDaObservacao: null,
    naoVerificado: null,
    acaoPendente: null,
    ...overrides,
  };
}

/** O cenário real do `exp004`: projeto `runner`, sem linha em
 *  `project_containers`, imagem decidida e agente local já tendo confirmado a
 *  pasta um dia. */
function itemRunnerSemContainer(
  overrides: Partial<ContainerOverviewItem> = {},
): ContainerOverviewItem {
  return item({
    executionMode: 'runner',
    registrado: null,
    temImagemDecidida: true,
    workspaceVerifiedAt: '2026-09-01T10:00:00.000Z',
    naoVerificado: 'sem_container_registrado',
    ...overrides,
  });
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
  comPapel('maintainer');
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
      screen.getByText('Este workspace ainda não tem projeto nenhum.'),
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
      data: [item({ registrado: registro({ status: 'stopped' }) })],
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
          rationale: 'Subida pedida por um humano na página de containers.',
        },
      });
    });
  });

  it('decisão sumiu entre a carga e o clique: "Subir de novo" falha com toast, sem propor nada', async () => {
    useContainersOverview.mockReturnValue({
      isPending: false,
      isError: false,
      data: [item({ registrado: registro({ status: 'stopped' }) })],
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

  it('sem sessão no projeto: os três botões ficam desabilitados, com o motivo em texto', () => {
    useLatestSession.mockReturnValue({ latest: undefined });
    useContainersOverview.mockReturnValue({
      isPending: false,
      isError: false,
      data: [item({ registrado: registro({ status: 'stopped' }) })],
      refetch: vi.fn(),
    });

    montar();

    expect(screen.getByRole('button', { name: 'Parar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remover' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Subir de novo' })).toBeDisabled();
    expect(
      screen.getByText(
        'Este projeto ainda não tem sessão — a ação precisa de uma para ser proposta.',
      ),
    ).toBeInTheDocument();
  });

  it('com ação pendente: mostra o card de decisão em vez dos botões', () => {
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

  // --- RN-521: o terceiro estado e a subida ramificada por modo ---

  it('projeto que NUNCA provisionou aparece na lista, com texto próprio — nunca "parado"', () => {
    useContainersOverview.mockReturnValue({
      isPending: false,
      isError: false,
      data: [itemRunnerSemContainer()],
      refetch: vi.fn(),
    });

    montar();

    expect(screen.getByText('nunca provisionado')).toBeInTheDocument();
    expect(screen.queryByText('parado')).not.toBeInTheDocument();
    expect(screen.getByText('não há container para observar')).toBeInTheDocument();
  });

  it('CENÁRIO REAL (exp004): projeto runner, sem container, imagem decidida, pasta confirmada → propõe container_start_via_runner com payload SÓ de rationale', async () => {
    useContainersOverview.mockReturnValue({
      isPending: false,
      isError: false,
      data: [itemRunnerSemContainer()],
      refetch: vi.fn(),
    });
    proposeAction.mockResolvedValue(
      acaoPendente({ actionType: 'container_start_via_runner' }),
    );

    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Subir container' }));

    await waitFor(() => {
      expect(proposeAction).toHaveBeenCalledWith('proj-1', 'sess-1', {
        actionType: 'container_start_via_runner',
        actor: { kind: 'user', id: 'user-1' },
        payload: { rationale: 'Subida pedida por um humano na página de containers.' },
      });
    });
    // O payload de `container_start` NUNCA é copiado: ela elege imagem, esta
    // sobe a já decidida (RN-508).
    expect(getContainerState).not.toHaveBeenCalled();
  });

  it('projeto runner: a tela DIZ que confirmação de pasta não é presença de agente', () => {
    useContainersOverview.mockReturnValue({
      isPending: false,
      isError: false,
      data: [itemRunnerSemContainer()],
      refetch: vi.fn(),
    });

    montar();

    expect(
      screen.getByText(/se ele não estiver rodando agora, a ação falha ao ser aprovada/),
    ).toBeInTheDocument();
  });

  it('projeto mounted sem container: propõe container_start (broker), não a variante do runner', async () => {
    useContainersOverview.mockReturnValue({
      isPending: false,
      isError: false,
      data: [
        itemRunnerSemContainer({ executionMode: 'mounted', workspaceVerifiedAt: null }),
      ],
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
      version: 1,
      eventId: 'evt-1',
      decidedAt: '2026-08-01T10:00:00.000Z',
    });
    proposeAction.mockResolvedValue(acaoPendente({ actionType: 'container_start' }));

    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Subir container' }));

    await waitFor(() => {
      expect(proposeAction).toHaveBeenCalledWith(
        'proj-1',
        'sess-1',
        expect.objectContaining({ actionType: 'container_start' }),
      );
    });
  });

  it('sem imagem decidida: não propõe às cegas — botão inerte e o motivo dito em TEXTO', () => {
    useContainersOverview.mockReturnValue({
      isPending: false,
      isError: false,
      data: [itemRunnerSemContainer({ temImagemDecidida: false })],
      refetch: vi.fn(),
    });

    montar();

    expect(screen.getByRole('button', { name: 'Subir container' })).toBeDisabled();
    expect(
      screen.getByText(
        'Sem imagem decidida: o Arquiteto (ou a Infra) precisa decidir uma antes de qualquer container subir.',
      ),
    ).toBeInTheDocument();
    expect(proposeAction).not.toHaveBeenCalled();
  });

  it('runner que nunca confirmou pasta: botão inerte, motivo próprio — nunca confundido com "sem imagem"', () => {
    useContainersOverview.mockReturnValue({
      isPending: false,
      isError: false,
      data: [itemRunnerSemContainer({ workspaceVerifiedAt: null })],
      refetch: vi.fn(),
    });

    montar();

    expect(screen.getByRole('button', { name: 'Subir container' })).toBeDisabled();
    expect(
      screen.getByText(
        'Nenhum agente local jamais confirmou a pasta deste projeto — rode o `brabo-runner` na máquina dele antes de subir.',
      ),
    ).toBeInTheDocument();
  });

  it('developer NÃO decide ciclo de vida (o mínimo do endpoint é maintainer), mas CONTINUA vendo o estado', () => {
    comPapel('developer');
    useContainersOverview.mockReturnValue({
      isPending: false,
      isError: false,
      data: [item({ registrado: registro({ status: 'stopped' }) })],
      refetch: vi.fn(),
    });

    montar();

    expect(screen.getByRole('button', { name: 'Subir de novo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remover' })).toBeDisabled();
    expect(
      screen.getByText('Subir container exige o papel maintainer neste workspace.'),
    ).toBeInTheDocument();
    // O que se tira é o CONTROLE, nunca a INFORMAÇÃO (ADR 0064).
    expect(screen.getByText('parado')).toBeInTheDocument();
    expect(screen.getByText('node:22-bookworm-slim')).toBeInTheDocument();
  });

  it('owner alcança o mínimo — a comparação é por hierarquia, nunca por igualdade de papel', () => {
    comPapel('owner');
    useContainersOverview.mockReturnValue({
      isPending: false,
      isError: false,
      data: [item({ registrado: registro({ status: 'stopped' }) })],
      refetch: vi.fn(),
    });

    montar();

    expect(screen.getByRole('button', { name: 'Subir de novo' })).toBeEnabled();
  });
});
