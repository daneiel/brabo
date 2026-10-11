import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ProposedAction } from '../lib/api-types';
import i18n from '../lib/i18n';
import { acaoEstaNoBloco } from '../lib/acoes-no-bloco';

const getProjectPendingActions = vi.fn();
const approveAction = vi.fn();
const denyAction = vi.fn();
const approveAlwaysAction = vi.fn();
const listSessionEvents = vi.fn();
const getCodePullRequests = vi.fn();
const listBacklog = vi.fn();
const proposeAction = vi.fn();
const unblockTask = vi.fn();

vi.mock('../lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api-client')>();
  return {
    ...original,
    getProjectPendingActions: (...a: unknown[]) => getProjectPendingActions(...a),
    approveAction: (...a: unknown[]) => approveAction(...a),
    denyAction: (...a: unknown[]) => denyAction(...a),
    approveAlwaysAction: (...a: unknown[]) => approveAlwaysAction(...a),
    listSessionEvents: (...a: unknown[]) => listSessionEvents(...a),
    getCodePullRequests: (...a: unknown[]) => getCodePullRequests(...a),
    listBacklog: (...a: unknown[]) => listBacklog(...a),
    proposeAction: (...a: unknown[]) => proposeAction(...a),
    unblockTask: (...a: unknown[]) => unblockTask(...a),
  };
});

const { PendenciasDeOutrasSessoes } = await import('./PendenciasDeOutrasSessoes');
const { ApiError } = await import('../lib/api-client');

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});
afterAll(() => {
  void i18n.changeLanguage('en');
});

const AQUI = '11111111-aaaa-4aaa-8aaa-111111111111';
const EXECUCAO = 'd7e9d7e9-bbbb-4bbb-8bbb-222222222222';

function acao(id: string, over: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id,
    projectId: 'proj-1',
    sessionId: EXECUCAO,
    seq: 1,
    actionType: 'terminal',
    payload: { command: `npm test ${id}` },
    status: 'pending',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'dev-api' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: null,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

function montar(
  podeDecidir = true,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return render(
    <QueryClientProvider client={client}>
      <PendenciasDeOutrasSessoes projectId="proj-1" sessionId={AQUI} podeDecidir={podeDecidir} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // O motivo da política de cada card é lido pela ação (AT-340); por padrão
  // o log responde sem o evento.
  listSessionEvents.mockResolvedValue({ items: [], nextCursor: null });
  getCodePullRequests.mockResolvedValue({ items: [] });
  listBacklog.mockResolvedValue([]);
});

describe('PendenciasDeOutrasSessoes (AT-265)', () => {
  it('mostra as pendências da outra sessão, com filas separadas e decide pelo endpoint com o sessionId DA AÇÃO', async () => {
    getProjectPendingActions.mockResolvedValue([
      acao('a1'),
      acao('a2'),
      acao('m1', {
        actionType: 'git_merge',
        payload: { pullRequestId: '7', sourceBranch: 'feature/x', targetBranch: 'dev' },
      }),
      // A da sessão atual o fio já desenha: não repete aqui.
      acao('propria', { sessionId: AQUI }),
    ]);
    approveAction.mockResolvedValue({});

    montar();

    const aprovacoes = await screen.findByRole('region', { name: 'Aprovações' });
    const merges = screen.getByRole('region', { name: 'Merges de PR' });
    // Contagens por fila, nunca somadas.
    expect(within(aprovacoes).getByText('2')).toBeInTheDocument();
    expect(within(merges).getByText('1')).toBeInTheDocument();
    expect(screen.queryByText(/npm test propria/)).toBeNull();
    // De onde vem é dito UMA vez por sessão (AT-318): as duas aprovações são
    // da mesma sessão, e o rótulo não se repete entre um card e outro.
    expect(within(aprovacoes).getAllByText(/propostas na sessão #/)).toHaveLength(1);
    expect(within(merges).getAllByText(/Proposta na sessão #/)).toHaveLength(1);

    fireEvent.click(within(aprovacoes).getAllByRole('button', { name: 'Aprovar' })[0]!);
    await waitFor(() => expect(approveAction).toHaveBeenCalledWith('proj-1', EXECUCAO, 'a1'));
  });

  it('CASO DE FALHA: papel abaixo de developer VÊ a pendência, com os controles inertes e o motivo em texto', async () => {
    getProjectPendingActions.mockResolvedValue([acao('a1')]);

    montar(false);

    expect((await screen.findAllByText(/npm test a1/)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Aprovar' })).toBeDisabled();
    expect(screen.getByTestId('bloqueio-da-decisao')).toHaveTextContent('papel developer');
  });

  it('a recusa 409 da api aparece no card, sem toast genérico', async () => {
    getProjectPendingActions.mockResolvedValue([acao('a1')]);
    approveAction.mockRejectedValue(new ApiError(409, { message: 'A ação já foi decidida.' }));

    montar();

    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));
    expect(await screen.findByTestId('recusa-da-decisao')).toHaveTextContent('A ação já foi decidida.');
  });

  it('sem pendência de outra sessão, não desenha nada', async () => {
    getProjectPendingActions.mockResolvedValue([acao('propria', { sessionId: AQUI })]);
    const { container } = montar();
    await waitFor(() => expect(getProjectPendingActions).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="pendencias-de-outras-sessoes"]')).toBeNull();
  });

  it('acima do teto de cards, diz que é recorte', async () => {
    getProjectPendingActions.mockResolvedValue(
      Array.from({ length: 23 }, (_, i) => acao(`t${i}`)),
    );
    montar();
    expect(await screen.findByText(/Mostrando 20 de 23/)).toBeInTheDocument();
  });
});

describe('PendenciasDeOutrasSessoes — cabe na coluna e mostra todos (AT-318)', () => {
  it('três cards da mesma sessão: os três à vista, com o detalhe FECHADO, e a presença por fila no cabeçalho', async () => {
    getProjectPendingActions.mockResolvedValue([
      acao('c1', { actionType: 'container_start', payload: { imagem: 'node:22' } }),
      acao('c2'),
      acao('c3'),
      acao('m1', {
        actionType: 'git_merge',
        payload: { pullRequestId: '7', sourceBranch: 'feature/x', targetBranch: 'dev' },
      }),
    ]);

    montar();

    const aprovacoes = await screen.findByRole('region', { name: 'Aprovações' });
    expect(within(aprovacoes).getAllByRole('button', { name: 'Aprovar' })).toHaveLength(3);
    // Nenhum detalhe nasce aberto: empilhados, eles empurravam os outros cards.
    expect(within(aprovacoes).queryAllByRole('button', { expanded: true })).toHaveLength(0);
    expect(within(aprovacoes).getAllByRole('button', { expanded: false }).length).toBeGreaterThanOrEqual(3);
    // Presença por fila, cada uma com o próprio número — nunca "4".
    const topo = screen.getByRole('button', { name: /Pendências de outras sessões/ });
    expect(topo).toHaveTextContent('Aprovações 3 · Merges de PR 1');
    expect(topo).not.toHaveTextContent(/\b4\b/);
  });

  it('recolhido, o bloco some do fio mas a presença continua no cabeçalho', async () => {
    getProjectPendingActions.mockResolvedValue([acao('a1')]);
    montar();

    const topo = await screen.findByRole('button', { name: /Pendências de outras sessões/ });
    fireEvent.click(topo);

    expect(topo).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Aprovar' })).toBeNull();
    expect(topo).toHaveTextContent('Aprovações 1');
  });
});

/**
 * AT-340 (RN-656) — cada card das pendências de outras sessões mostra o motivo
 * da política, lido pela ação na sessão que a propôs, com o MESMO cache da aba
 * Aprovações.
 */
describe('PendenciasDeOutrasSessoes — motivo da política (AT-340)', () => {
  const criada = (actionId: string) => ({
    id: `evt-${actionId}`,
    sessionId: EXECUCAO,
    seq: 3,
    type: 'proposed_action.created',
    actor: { kind: 'agent', id: 'dev-api' },
    payload: {
      actionId,
      actionType: 'terminal',
      status: 'pending',
      reason: 'comando fora da allowlist',
      scopeRoot: { ancora: 'workspace', segmento: 'proj-1' },
    },
    createdAt: new Date().toISOString(),
  });

  it('lê o motivo pela ação, na sessão DELA, uma vez só enquanto o cache viver', async () => {
    getProjectPendingActions.mockResolvedValue([acao('a1')]);
    listSessionEvents.mockResolvedValue({ items: [criada('a1')], nextCursor: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { unmount } = montar(true, client);
    const motivo = await screen.findByTestId('motivo-da-politica');
    expect(motivo).toHaveTextContent('comando fora da allowlist');
    expect(listSessionEvents).toHaveBeenCalledWith('proj-1', EXECUCAO, {
      actionId: 'a1',
      limit: 200,
    });

    // Remontar (voltar ao chat, abrir outra sessão) não relê: evento é
    // imutável, `staleTime: Infinity` — a mesma chave da aba Aprovações.
    unmount();
    montar(true, client);
    expect(await screen.findByTestId('motivo-da-politica')).toHaveTextContent(
      'comando fora da allowlist',
    );
    expect(listSessionEvents).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('motivo-nao-lido')).toBeNull();
  });

  it('CASO DE FALHA: a leitura que falha deixa o card calado e diz a lacuna UMA vez', async () => {
    getProjectPendingActions.mockResolvedValue([acao('a1'), acao('a2')]);
    listSessionEvents.mockImplementation(
      async (_p: string, _s: string, o: { actionId: string }) => {
        if (o.actionId === 'a2') throw new ApiError(500, 'falhou');
        return { items: [criada('a1')], nextCursor: null };
      },
    );

    montar();

    const nota = await screen.findByTestId('motivo-nao-lido');
    expect(nota).toHaveTextContent('1 dos 2 cards');
    // Só o card lido fala; o da leitura falha não inventa motivo nem diz
    // "não registrado", que é o que a api afirma quando responde sem evento.
    expect(screen.getAllByTestId('motivo-da-politica')).toHaveLength(1);
  });
});

function pr(id: string, sourceBranch: string) {
  return {
    id,
    number: Number(id),
    title: `PR ${id}`,
    url: '',
    author: null,
    state: 'open',
    sourceBranch,
    targetBranch: 'dev',
    updatedAt: null,
  };
}

function backlog(tarefas: Record<string, unknown>[]) {
  return [
    {
      id: 'e1',
      projectId: 'proj-1',
      sessionId: EXECUCAO,
      title: 'Épico',
      description: '',
      createdAt: '',
      updatedAt: '',
      stories: [
        {
          id: 's1',
          tasks: tarefas.map((t) => ({
            storyId: 's1',
            description: '',
            status: 'in_review',
            assignedTo: null,
            blocked: false,
            blockedReason: null,
            gateStatus: null,
            gateCorrectionCount: 0,
            createdAt: '',
            updatedAt: '',
            ...t,
          })),
        },
      ],
    },
  ];
}

describe('PendenciasDeOutrasSessoes — PRs prontas e tarefas bloqueadas (AT-497, RN-825/826)', () => {
  it('a PR com os gates aprovados aparece, a com gate pendente não, e Mergear mostra o cartão ali', async () => {
    getProjectPendingActions.mockResolvedValue([]);
    getCodePullRequests.mockResolvedValue({
      items: [pr('1', 'feature/task-aaaaaaaa'), pr('2', 'feature/task-bbbbbbbb'), pr('3', 'docs/adr-0300')],
    });
    listBacklog.mockResolvedValue(
      backlog([
        { id: 'aaaaaaaa-1', title: 'Pronta', gateStatus: 'awaiting_user' },
        { id: 'bbbbbbbb-1', title: 'Em QA', gateStatus: 'awaiting_qa' },
      ]),
    );
    proposeAction.mockResolvedValue(
      acao('m-novo', {
        sessionId: AQUI,
        actionType: 'git_merge',
        actor: { kind: 'user', id: 'u' },
        payload: { pullRequestId: '1', sourceBranch: 'feature/task-aaaaaaaa', targetBranch: 'dev' },
      }),
    );

    montar();

    const fila = await screen.findByTestId('fila-prs-prontas');
    expect(within(fila).getByText(/PR 1/)).toBeInTheDocument();
    // PR de ADR (sem tarefa) também é pronta; a de gate pendente, não.
    expect(within(fila).getByText(/PR 3/)).toBeInTheDocument();
    expect(within(fila).queryByText(/PR 2/)).toBeNull();

    fireEvent.click(within(fila).getAllByRole('button', { name: 'Mergear' })[0]!);
    await waitFor(() =>
      expect(proposeAction).toHaveBeenCalledWith(
        'proj-1',
        AQUI,
        expect.objectContaining({ actionType: 'git_merge' }),
      ),
    );
    expect(await within(fila).findByRole('button', { name: 'Aprovar' })).toBeInTheDocument();
    // RN-843: a ação desenhada aqui fica registrada para o fio recolher a dele.
    expect(acaoEstaNoBloco('m-novo')).toBe(true);
  });

  it('RN-841: a tarefa que entra em awaiting_user relê as PRs, e a PR nova aparece sem remontar', async () => {
    getProjectPendingActions.mockResolvedValue([]);
    getCodePullRequests.mockResolvedValueOnce({ items: [] });
    listBacklog.mockResolvedValueOnce(
      backlog([{ id: 'aaaaaaaa-1', title: 'Pronta', gateStatus: 'awaiting_qa' }]),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    montar(true, client);
    await waitFor(() => expect(getCodePullRequests).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listBacklog).toHaveBeenCalledTimes(1));

    getCodePullRequests.mockResolvedValue({ items: [pr('1', 'feature/task-aaaaaaaa')] });
    listBacklog.mockResolvedValue(
      backlog([{ id: 'aaaaaaaa-1', title: 'Pronta', gateStatus: 'awaiting_user' }]),
    );
    // A leitura de 15 s do backlog, simulada.
    await client.invalidateQueries({ queryKey: ['backlog'] });

    const fila = await screen.findByTestId('fila-prs-prontas');
    expect(within(fila).getByText(/PR 1/)).toBeInTheDocument();
    expect(getCodePullRequests).toHaveBeenCalledTimes(2);
  });

  it('CASO DE FALHA RN-841: backlog relido sem mudança não relê as PRs', async () => {
    getProjectPendingActions.mockResolvedValue([]);
    listBacklog.mockResolvedValue(
      backlog([{ id: 'aaaaaaaa-1', title: 'Pronta', gateStatus: 'awaiting_qa' }]),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    montar(true, client);
    await waitFor(() => expect(listBacklog).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getCodePullRequests).toHaveBeenCalledTimes(1));
    await client.invalidateQueries({ queryKey: ['backlog'] });
    await waitFor(() => expect(listBacklog).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(getCodePullRequests).toHaveBeenCalledTimes(1);
  });

  it('CASO DE FALHA: desbloquear com erro diz o erro da api na linha da tarefa', async () => {
    getProjectPendingActions.mockResolvedValue([]);
    listBacklog.mockResolvedValue(
      backlog([{ id: 't8', title: 'Tarefa 8', blocked: true, blockedReason: 'ciclo de correção esgotado' }]),
    );
    unblockTask.mockRejectedValue(new ApiError(409, { message: 'a tarefa não está bloqueada' }));

    montar();

    const fila = await screen.findByTestId('fila-tarefas-bloqueadas');
    expect(within(fila).getByText('ciclo de correção esgotado')).toBeInTheDocument();
    fireEvent.click(within(fila).getByRole('button', { name: 'Desbloquear' }));
    await waitFor(() => expect(unblockTask).toHaveBeenCalledWith('proj-1', AQUI, 't8'));
    expect(await within(fila).findByTestId('retorno-desbloqueio')).toHaveTextContent(
      'a tarefa não está bloqueada',
    );
  });
});
