import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectApprovalsTab } from './ProjectApprovalsTab';
import { ToastProvider } from '../components/ui/ToastProvider';
import type { PermissionsFile, ProposedAction, Session } from '../lib/api-types';
// Instância REAL do app (mesmo motivo de `AgentCard.test.tsx`): sem
// `I18nextProvider` no teste, o hook `useTranslation` cai no singleton
// global de `lib/i18n.ts` — as asserções abaixo checam o texto ATUAL em
// português.
import i18n from '../lib/i18n';

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

const listSessions = vi.fn();
const listActions = vi.fn();
const listSessionEvents = vi.fn();
const listBacklog = vi.fn();
const listInfraArtifacts = vi.fn();
const getProjectPermissions = vi.fn();
const setProjectPermissions = vi.fn();
const getRegistroDeGates = vi.fn();
const getProjectPendingActions = vi.fn();
const getActiveExecutionSession = vi.fn();
const approveAction = vi.fn();

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
    getProjectPendingActions: (...args: unknown[]) => getProjectPendingActions(...args),
    getActiveExecutionSession: (...args: unknown[]) => getActiveExecutionSession(...args),
    approveAction: (...args: unknown[]) => approveAction(...args),
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
  getProjectPendingActions.mockResolvedValue([]);
  getActiveExecutionSession.mockResolvedValue(null);
  approveAction.mockResolvedValue(acao());
});

describe('ProjectApprovalsTab — os três estados da RN-088', () => {
  it('fila que FALHOU diz que falhou, e nunca que está vazia', async () => {
    getProjectPendingActions.mockRejectedValue(new Error('limite de requisições excedido'));
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
    getProjectPendingActions.mockResolvedValue([acao()]);
    montar();

    const caixa = await screen.findByRole('checkbox');
    expect(screen.queryByRole('button', { name: 'Limpar' })).not.toBeInTheDocument();

    fireEvent.click(caixa);

    await waitFor(() =>
      expect(screen.getByText('1 selecionada')).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /Aprovar selecionados/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Limpar' }));
    await waitFor(() =>
      expect(screen.queryByText('1 selecionada')).not.toBeInTheDocument(),
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

describe('ProjectApprovalsTab — a fila é a do PROJETO, não a da sessão mais recente (AT-297)', () => {
  it('a pendente da sessão de execução aparece com uma ideação mais nova aberta, e decide pela sessão DELA', async () => {
    // A ideação nasceu DEPOIS da execução: é ela a "mais recente".
    listSessions.mockResolvedValue([
      { ...sessao(), id: 'exec', createdAt: '2026-08-01T00:00:00.000Z' },
      { ...sessao(), id: 'ideacao', createdAt: '2026-08-03T00:00:00.000Z' },
    ]);
    getProjectPendingActions.mockResolvedValue([
      acao({ id: 'do-dev', sessionId: 'exec', actor: { kind: 'agent', id: 'dev-api' } }),
    ]);
    montar();

    fireEvent.click(await screen.findByRole('button', { name: /^Aprovar/ }));

    await waitFor(() => expect(approveAction).toHaveBeenCalledWith('proj-1', 'exec', 'do-dev'));
    // Nada da fila vem da listagem por sessão.
    expect(listActions).not.toHaveBeenCalledWith('proj-1', 'ideacao', expect.objectContaining({ status: 'pending' }));
  });

  it('CASO DE CONTRASTE: ação já decidida que a leitura devolva não entra na fila', async () => {
    getProjectPendingActions.mockResolvedValue([acao({ status: 'approved' })]);
    montar();

    expect(
      await screen.findByText('Nenhuma aprovação pendente. O time está fluindo.'),
    ).toBeInTheDocument();
  });
});

describe('ProjectApprovalsTab — cada card mostra o PRÓPRIO motivo da política (AT-336, RN-614)', () => {
  function eventoCriado(actionId: string, seq: number, reason: string) {
    return {
      id: `ev-${seq}`,
      sessionId: 'sess-1',
      seq,
      type: 'proposed_action.created',
      actor: { kind: 'agent', id: 'qa' },
      payload: { actionId, actionType: 'git_commit', reason },
      createdAt: '2026-08-02T00:00:00.000Z',
    };
  }

  /** A leitura do log da sessão de trabalho e a leitura POR AÇÃO, separadas. */
  function eventosPorPedido(
    doLog: unknown[],
    porAcao: Record<string, unknown[] | Error>,
  ) {
    listSessionEvents.mockImplementation(
      (_p: string, _s: string, opts?: { actionId?: string }) => {
        if (!opts?.actionId) return Promise.resolve({ items: doLog, nextCursor: null });
        const r = porAcao[opts.actionId];
        if (r instanceof Error) return Promise.reject(r);
        return Promise.resolve({ items: r ?? [], nextCursor: null });
      },
    );
  }

  it('ação de OUTRA sessão: o card lê o motivo pela ação, na sessão dela, e nota nenhuma aparece', async () => {
    getProjectPendingActions.mockResolvedValue([
      acao({ id: 'a1' }),
      acao({ id: 'a2', sessionId: 'sess-outra', seq: 2 }),
    ]);
    eventosPorPedido([eventoCriado('a1', 5, 'regra do log carregado')], {
      a2: [eventoCriado('a2', 9, 'regra lida pela ação')],
    });
    montar();

    await waitFor(() => expect(screen.getAllByTestId('motivo-da-politica')).toHaveLength(2));
    const frases = screen.getAllByTestId('motivo-da-politica').map((e) => e.textContent);
    expect(frases.some((f) => f?.includes('regra do log carregado'))).toBe(true);
    expect(frases.some((f) => f?.includes('regra lida pela ação'))).toBe(true);
    // Só a ação que o log não cobre virou leitura própria, na sessão DELA.
    expect(listSessionEvents).toHaveBeenCalledWith('proj-1', 'sess-outra', {
      actionId: 'a2',
      limit: 200,
    });
    expect(listSessionEvents).not.toHaveBeenCalledWith(
      'proj-1',
      expect.anything(),
      expect.objectContaining({ actionId: 'a1' }),
    );
    expect(screen.queryByTestId('motivo-nao-lido')).toBeNull();
  });

  it('a leitura responde sem o evento: o card diz "não registrado", nunca cala', async () => {
    getProjectPendingActions.mockResolvedValue([acao({ id: 'a2', sessionId: 'sess-outra' })]);
    eventosPorPedido([], { a2: [] });
    montar();

    const linha = await screen.findByTestId('motivo-da-politica');
    expect(linha.textContent).toMatch(/não registrad/);
    expect(screen.queryByTestId('motivo-nao-lido')).toBeNull();
  });

  it('falha: a leitura por ação que falha cala o card e é dita UMA vez, contando só ela', async () => {
    getProjectPendingActions.mockResolvedValue([
      acao({ id: 'a1' }),
      acao({ id: 'a2', sessionId: 'sess-outra', seq: 2 }),
    ]);
    eventosPorPedido([eventoCriado('a1', 5, 'regra do log carregado')], {
      a2: new Error('500'),
    });
    montar();

    const nota = await screen.findByTestId('motivo-nao-lido');
    expect(nota.textContent).toContain('de 1 das 2 ações abaixo');
    expect(screen.getAllByTestId('motivo-nao-lido')).toHaveLength(1);
    expect(screen.getAllByTestId('motivo-da-politica')).toHaveLength(1);
    expect(screen.queryByText(/fora dos eventos carregados nesta tela/)).toBeNull();
  });
});
