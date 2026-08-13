import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectApprovalsTab } from './ProjectApprovalsTab';
import { ToastProvider } from '../components/ui/ToastProvider';
import type { PermissionsFile, ProposedAction, Session } from '../lib/api-types';

const listSessions = vi.fn();
const listActions = vi.fn();
const listSessionEvents = vi.fn();
const listBacklog = vi.fn();
const listInfraArtifacts = vi.fn();
const getProjectPermissions = vi.fn();
const setProjectPermissions = vi.fn();
const getRegistroDeGates = vi.fn();

// `importOriginal` porque `ApiError`/`mensagemDaApi` continuam valendo: é deles
// que `ErroDeCarregamento` tira a frase da api e o `trace_id`.
vi.mock('../lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api-client')>();
  return {
    ...original,
    listSessions: (...args: unknown[]) => listSessions(...args),
    listActions: (...args: unknown[]) => listActions(...args),
    listSessionEvents: (...args: unknown[]) => listSessionEvents(...args),
    listBacklog: (...args: unknown[]) => listBacklog(...args),
    listInfraArtifacts: (...args: unknown[]) => listInfraArtifacts(...args),
    getProjectPermissions: (...args: unknown[]) => getProjectPermissions(...args),
    setProjectPermissions: (...args: unknown[]) => setProjectPermissions(...args),
    getRegistroDeGates: (...args: unknown[]) => getRegistroDeGates(...args),
    approveAction: vi.fn(),
    approveAlwaysAction: vi.fn(),
    denyAction: vi.fn(),
  };
});

function sessao(): Session {
  return {
    id: 'sess-1',
    projectId: 'proj-1',
    status: 'active',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  } as Session;
}

function acao(over: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'action-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    seq: 1,
    actionType: 'terminal',
    payload: { command: 'pnpm test' },
    status: 'pending',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'qa' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: null,
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...over,
  };
}

const PERMISSOES: PermissionsFile = {
  allow: ['pnpm test'],
  deny: ['rm -rf *'],
  ask: [],
} as PermissionsFile;

function montar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ProjectApprovalsTab projectId="proj-1" />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listSessions.mockResolvedValue([sessao()]);
  listActions.mockResolvedValue({ items: [], nextCursor: null });
  listSessionEvents.mockResolvedValue({ items: [], nextCursor: null });
  listBacklog.mockResolvedValue([]);
  listInfraArtifacts.mockResolvedValue([]);
  getProjectPermissions.mockResolvedValue(PERMISSOES);
  getRegistroDeGates.mockResolvedValue({ gates: [] });
});

describe('ProjectApprovalsTab — os três estados da RN-088', () => {
  it('fila que FALHOU diz que falhou, e nunca que está vazia', async () => {
    listActions.mockRejectedValue(new Error('limite de requisições excedido'));
    montar();

    expect(
      await screen.findByText('Não foi possível carregar a fila de aprovações.'),
    ).toBeInTheDocument();
    // O vazio afirmaria que não há nada a aprovar — a mentira mais cara que
    // esta tela pode contar.
    expect(
      screen.queryByText(/Nenhuma aprovação pendente/),
    ).not.toBeInTheDocument();
  });

  it('permissões que FALHARAM não viram "nenhuma regra configurada"', async () => {
    getProjectPermissions.mockRejectedValue(new Error('sem acesso ao projeto'));
    montar();

    expect(
      await screen.findByText('Não foi possível carregar as permissões do projeto.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Nenhuma regra configurada ainda.'),
    ).not.toBeInTheDocument();
  });

  it('projeto sem sessão explica de onde as aprovações viriam', async () => {
    listSessions.mockResolvedValue([]);
    montar();

    expect(
      await screen.findByText(/as aprovações nascem do que os agentes propõem/),
    ).toBeInTheDocument();
  });

  it('fila vazia mostra o estado vazio do desenho', async () => {
    montar();

    expect(
      await screen.findByText('Nenhuma aprovação pendente. O time está fluindo.'),
    ).toBeInTheDocument();
  });
});

describe('ProjectApprovalsTab — fila e permissões', () => {
  it('lista as pendentes e oferece o lote com "Limpar"', async () => {
    listActions.mockResolvedValue({ items: [acao()], nextCursor: null });
    montar();

    const caixa = await screen.findByRole('checkbox');
    expect(screen.queryByRole('button', { name: 'Limpar' })).not.toBeInTheDocument();

    fireEvent.click(caixa);

    await waitFor(() =>
      expect(screen.getByText('1 selecionadas')).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /Aprovar selecionados/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Limpar' }));
    await waitFor(() =>
      expect(screen.queryByText('1 selecionadas')).not.toBeInTheDocument(),
    );
  });

  it('cada regra tem um revogar que diz o que revoga', async () => {
    setProjectPermissions.mockResolvedValue(PERMISSOES);
    montar();

    const botao = await screen.findByRole('button', { name: 'Revogar rm -rf *' });
    fireEvent.click(botao);

    await waitFor(() => expect(setProjectPermissions).toHaveBeenCalledTimes(1));
    expect(setProjectPermissions.mock.calls[0][1].deny).toEqual([]);
  });

  it('a busca que não acha nada diz isso, e não "nenhuma regra configurada"', async () => {
    montar();
    await screen.findByText('rm -rf *');

    fireEvent.change(screen.getByPlaceholderText('Buscar regra ou padrão…'), {
      target: { value: 'nao-existe' },
    });

    expect(
      await screen.findByText('Nenhuma regra corresponde à busca.'),
    ).toBeInTheDocument();
  });
});
