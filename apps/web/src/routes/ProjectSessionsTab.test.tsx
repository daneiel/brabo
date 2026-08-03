import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { ProjectSessionsTab } from './ProjectSessionsTab';
import type { ProposedAction, Session } from '../lib/api-types';

const listSessions = vi.fn();
const listActions = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../lib/api-client', () => ({
  listSessions: (...args: unknown[]) => listSessions(...args),
  listActions: (...args: unknown[]) => listActions(...args),
  createSession: vi.fn(),
  transitionSession: vi.fn(),
}));

function sessao(id: string, createdAt: string): Session {
  return {
    id,
    projectId: 'proj-1',
    createdBy: 'user-1',
    status: 'closed',
    nextSeq: 1,
    createdAt,
    updatedAt: createdAt,
    closedAt: null,
  } as Session;
}

function acao(over: Partial<ProposedAction>): ProposedAction {
  return {
    id: 'act',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    seq: 1,
    actionType: 'git_commit',
    payload: {},
    status: 'pending',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'dev-api' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: null,
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...over,
  } as ProposedAction;
}

function montar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProjectSessionsTab projectId="proj-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Achado #16 do primeiro dogfooding: nenhuma tela somava aprovações por
 * sessão. `usePendingActions` exige um `sessionId`, e os três chamadores
 * passavam o da sessão MAIS RECENTE — uma decisão esquecida numa sessão
 * anterior ficava invisível para sempre.
 */
describe('ProjectSessionsTab — aprovações por sessão', () => {
  it('soma cada sessão, não só a última', async () => {
    listSessions.mockResolvedValue([
      sessao('11111111-aaaa', '2026-08-01T00:00:00.000Z'),
      sessao('22222222-bbbb', '2026-08-02T00:00:00.000Z'),
    ]);
    listActions.mockImplementation((_p: string, sessionId: string) =>
      Promise.resolve({
        items:
          sessionId === '11111111-aaaa'
            ? [acao({ id: 'a', status: 'pending' })]
            : [acao({ id: 'b', status: 'executed', decidedBy: 'user-1' })],
        nextCursor: null,
      }),
    );

    montar();

    // A sessão ANTIGA tem uma pendência — e ela aparece, que é o ponto.
    expect(
      await screen.findByText('1 aguardando · 0 decidida(s) por você'),
    ).toBeTruthy();
    // E a mais recente mostra a decisão que já foi tomada, na mesma lista.
    expect(
      await screen.findByText('1 decidida(s) por você · 0 auto'),
    ).toBeTruthy();
  });

  it('o total do projeto separa clique humano de política', async () => {
    listSessions.mockResolvedValue([
      sessao('11111111-aaaa', '2026-08-01T00:00:00.000Z'),
    ]);
    listActions.mockResolvedValue({
      items: [
        acao({ id: 'a', status: 'executed', decidedBy: 'user-1' }),
        acao({ id: 'b', status: 'executed', resolvedPolicy: 'auto_approve' }),
        acao({ id: 'c', status: 'pending' }),
      ],
      nextCursor: null,
    });

    montar();

    expect(
      await screen.findByText(
        /3 ação\(ões\) proposta\(s\) no projeto · 1 decidida\(s\) por você · 1 auto-aprovada\(s\) pela política · 1 aguardando/,
      ),
    ).toBeTruthy();
  });

  it('sessão sem ação nenhuma não ganha resumo', async () => {
    listSessions.mockResolvedValue([
      sessao('11111111-aaaa', '2026-08-01T00:00:00.000Z'),
    ]);
    listActions.mockResolvedValue({ items: [], nextCursor: null });

    montar();

    expect(await screen.findByText('#11111111')).toBeTruthy();
    expect(screen.queryByText(/decidida\(s\) por você/)).toBeNull();
  });
});
