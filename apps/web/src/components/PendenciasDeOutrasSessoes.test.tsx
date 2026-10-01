import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ProposedAction } from '../lib/api-types';
import i18n from '../lib/i18n';

const getProjectPendingActions = vi.fn();
const approveAction = vi.fn();
const denyAction = vi.fn();
const approveAlwaysAction = vi.fn();
const listSessionEvents = vi.fn();

vi.mock('../lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api-client')>();
  return {
    ...original,
    getProjectPendingActions: (...a: unknown[]) => getProjectPendingActions(...a),
    approveAction: (...a: unknown[]) => approveAction(...a),
    denyAction: (...a: unknown[]) => denyAction(...a),
    approveAlwaysAction: (...a: unknown[]) => approveAlwaysAction(...a),
    listSessionEvents: (...a: unknown[]) => listSessionEvents(...a),
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
