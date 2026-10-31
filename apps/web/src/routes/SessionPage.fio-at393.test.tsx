import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { Handoff } from '../lib/api-types';
import { historicoFalso } from '../test/historico-de-eventos';

/**
 * AT-393 — o fio diz o próximo gesto depois de `agent.error`, o painel de
 * contexto lista as decisões (`artifact.decision_record`) e nenhum botão da
 * sessão fica sem nome acessível.
 */

const getSession = vi.fn();
const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));

vi.mock('@tanstack/react-router', () => ({
  Link: () => null,
}));

vi.mock('../lib/hooks', () => ({
  useSessionEvents: () => ({ data: eventos() }),
  useSessionEventHistory: () => historicoFalso(eventos().items),
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: { items: [] } }),
  useHandoffs: () => ({ data: [] as Handoff[] }),
  useCurrentWorkspaceWithRole: () => ({ data: undefined }),
  useBacklog: () => ({ data: [] }),
}));

vi.mock('../lib/chat-stream', () => ({ streamChatMessage: vi.fn() }));

vi.mock('../lib/session-channel', () => ({
  connectSessionHeartbeat: () => () => {},
}));

vi.mock('../lib/auth', () => ({
  emailDaSessao: () => 'eu@brabo.dev',
  userIdDaSessao: () => 'eu',
}));

vi.mock('../lib/api-client', () => ({
  getProject: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'core' }),
  getSession: (...args: unknown[]) => getSession(...args),
  getSessionBudget: vi.fn().mockResolvedValue(null),
  getSessionModelBinding: vi.fn().mockResolvedValue(null),
  listModels: vi.fn().mockResolvedValue(null),
  renameSession: vi.fn(),
  acceptHandoff: vi.fn(),
  approveAction: vi.fn(),
  approveAlwaysAction: vi.fn(),
  confirmReadiness: vi.fn(),
  denyAction: vi.fn(),
  sendAgentMessage: vi.fn(),
  setSessionModelBinding: vi.fn(),
  startAgent: vi.fn(),
  transitionSession: vi.fn(),
}));

const { SessionPage } = await import('./SessionPage');
const { ToastProvider } = await import('../components/ui/ToastProvider');

const ID = 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7';

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SessionPage projectId="proj-1" sessionId={ID} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  eventos.mockReturnValue({ items: [] });
  getSession.mockResolvedValue({
    id: ID,
    projectId: 'proj-1',
    createdBy: 'user-1',
    status: 'active',
    kind: 'consultiva',
    name: null,
    nextSeq: 1,
    createdAt: '2026-08-10T12:00:00.000Z',
    updatedAt: '2026-08-10T12:00:00.000Z',
    closedAt: null,
  } as never);
});

describe('SessionPage — AT-393', () => {
  it('`agent.error` diz o próximo gesto com o agente e a origem do evento', async () => {
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-1',
          seq: 1,
          type: 'agent.error',
          actor: { kind: 'agent', id: 'arquiteto' },
          payload: { mensagem: 'quebrou', origem: 'codigo' },
          createdAt: '2026-10-02T12:00:00.000Z',
        },
      ],
    });
    montar();
    const passo = await screen.findByTestId('falha-proximo-passo');
    expect(passo.textContent).toMatch(/codigo/);
  });

  it('o painel de contexto lista a decisão registrada pela escolha', async () => {
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-2',
          seq: 2,
          type: 'artifact.decision_record',
          actor: { kind: 'agent', id: 'arquiteto' },
          payload: { context: 'pagamento', options: ['a', 'b'], choice: 'Pagar na entrega', consequences: 'x' },
          createdAt: '2026-10-02T12:00:00.000Z',
        },
      ],
    });
    montar();
    expect(await screen.findByText('Pagar na entrega')).toBeInTheDocument();
  });

  it('sem `agent.error` não há linha de próximo gesto (caso de falha)', async () => {
    eventos.mockReturnValue({ items: [] });
    montar();
    await screen.findAllByRole('button');
    expect(screen.queryByTestId('falha-proximo-passo')).not.toBeInTheDocument();
  });

  it('todo botão da sessão tem nome acessível', async () => {
    eventos.mockReturnValue({ items: [] });
    montar();
    await screen.findAllByRole('button');
    const semNome = screen
      .getAllByRole('button')
      .filter((b) => !(b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent?.trim()));
    expect(semNome.map((b) => b.outerHTML.slice(0, 200))).toEqual([]);
  });
});
