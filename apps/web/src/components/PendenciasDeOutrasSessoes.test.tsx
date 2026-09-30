import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ProposedAction } from '../lib/api-types';
import i18n from '../lib/i18n';

const getProjectPendingActions = vi.fn();
const approveAction = vi.fn();
const denyAction = vi.fn();
const approveAlwaysAction = vi.fn();

vi.mock('../lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api-client')>();
  return {
    ...original,
    getProjectPendingActions: (...a: unknown[]) => getProjectPendingActions(...a),
    approveAction: (...a: unknown[]) => approveAction(...a),
    denyAction: (...a: unknown[]) => denyAction(...a),
    approveAlwaysAction: (...a: unknown[]) => approveAlwaysAction(...a),
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

function montar(podeDecidir = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PendenciasDeOutrasSessoes projectId="proj-1" sessionId={AQUI} podeDecidir={podeDecidir} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
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
    // Cada linha diz de onde vem.
    expect(within(aprovacoes).getAllByText(/Proposta na sessão #/)).toHaveLength(2);

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
