import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Session } from '../lib/api-types';
import { historicoFalso } from '../test/historico-de-eventos';
// Instância REAL do app: as asserções esperam pt-BR, e `en` é o default.
import i18n from '../lib/i18n';

/**
 * ADR 0183 (RN-650, AT-071): a sessão encerrada ganha "Reabrir sessão". O
 * botão só é acionável para quem alcança `maintainer` (`roleAtLeast`); abaixo
 * disso fica inerte e o motivo é dito em TEXTO.
 */

const getSession = vi.fn();
const sendAgentMessage = vi.fn();
const confirmReadiness = vi.fn();
const transitionSession = vi.fn();
const getProjectPendingActions = vi.fn();
const reopenSession = vi.fn();
const papel = vi.fn<() => string | undefined>(() => 'maintainer');

const EVENTOS_CRIATIVO_ATIVO = [
  {
    id: 'e0',
    seq: 1,
    type: 'agent.activated',
    actor: { kind: 'agent', id: 'criativo' },
    payload: { agent: 'criativo' },
    createdAt: '2026-08-11T12:00:00.000Z',
  },
  {
    id: 'e1',
    seq: 2,
    type: 'artifact.business_rule',
    actor: { kind: 'agent', id: 'criativo' },
    payload: { title: 'Só maiores de 18', description: 'Idade >= 18', origin: [1] },
    createdAt: '2026-08-11T12:00:30.000Z',
  },
];

const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: EVENTOS_CRIATIVO_ATIVO }));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../lib/hooks', () => ({
  useSessionEvents: () => ({ data: eventos() }),
  useSessionEventHistory: () => historicoFalso(eventos().items),
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: { items: [] } }),
  useHandoffs: () => ({ data: [] }),
  useCurrentWorkspaceWithRole: () => ({ data: papel() ? { workspace: { id: 'ws-1' }, role: papel() } : undefined }),
  useBacklog: () => ({ data: [] }),
}));

vi.mock('../lib/chat-stream', () => ({ streamChatMessage: vi.fn() }));
vi.mock('../lib/session-channel', () => ({
  connectSessionHeartbeat: () => () => undefined,
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
  confirmReadiness: (...args: unknown[]) => confirmReadiness(...args),
  listSessionEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  denyAction: vi.fn(),
  sendAgentMessage: (...args: unknown[]) => sendAgentMessage(...args),
  setSessionModelBinding: vi.fn(),
  startAgent: vi.fn(),
  transitionSession: (...args: unknown[]) => transitionSession(...args),
  reopenSession: (...args: unknown[]) => reopenSession(...args),
  mensagemDaApi: (erro: { body?: { message?: string } }, padrao: string) =>
    erro?.body?.message ?? padrao,
  getProjectPendingActions: (...args: unknown[]) => getProjectPendingActions(...args),
}));

const { SessionPage } = await import('./SessionPage');
const { ToastProvider } = await import('../components/ui/ToastProvider');

const ID = 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7';

function sessao(over: Partial<Session> = {}): Session {
  return {
    id: ID,
    projectId: 'proj-1',
    createdBy: 'user-1',
    status: 'active',
    kind: 'criativa',
    name: null,
    nextSeq: 1,
    createdAt: '2026-08-11T12:00:00.000Z',
    updatedAt: '2026-08-11T12:00:00.000Z',
    closedAt: null,
    ...over,
  } as Session;
}

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

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('pt-BR');
  eventos.mockReturnValue({ items: EVENTOS_CRIATIVO_ATIVO });
  getSession.mockResolvedValue(sessao({ status: 'closed', closedAt: '2026-08-11T13:00:00.000Z' }));
  getProjectPendingActions.mockResolvedValue([]);
  papel.mockReturnValue('maintainer');
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

const EXIGE = 'Reabrir a sessão exige o papel maintainer neste workspace.';

describe('SessionPage — reabrir sessão encerrada (RN-650)', () => {
  it.each(['closed', 'closed_abnormally'] as const)(
    '%s com maintainer: o botão reabre pela rota própria e relê a sessão',
    async (status) => {
      getSession.mockResolvedValue(sessao({ status, closedAt: '2026-08-11T13:00:00.000Z' }));
      reopenSession.mockResolvedValue(sessao({ status: 'active' }));

      montar();
      const botao = await screen.findByRole('button', { name: 'Reabrir sessão' });
      await waitFor(() => expect(botao).toBeEnabled());
      expect(screen.queryByText(EXIGE)).not.toBeInTheDocument();

      getSession.mockResolvedValue(sessao({ status: 'active' }));
      fireEvent.click(botao);

      await waitFor(() => expect(reopenSession).toHaveBeenCalledWith('proj-1', ID));
      // Nunca pela transição genérica.
      expect(transitionSession).not.toHaveBeenCalled();
      // Relida a sessão, o composer volta e o botão some.
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Reabrir sessão' })).not.toBeInTheDocument(),
      );
    },
  );

  it('owner também alcança o mínimo (roleAtLeast, não lista à mão)', async () => {
    papel.mockReturnValue('owner');
    montar();
    const botao = await screen.findByRole('button', { name: 'Reabrir sessão' });
    await waitFor(() => expect(botao).toBeEnabled());
  });

  it.each(['developer', 'viewer', undefined])(
    'papel %s: botão inerte, e o motivo dito em texto',
    async (role) => {
      papel.mockReturnValue(role);
      montar();
      const botao = await screen.findByRole('button', { name: 'Reabrir sessão' });
      expect(botao).toBeDisabled();
      expect(screen.getByText(EXIGE)).toBeInTheDocument();
      fireEvent.click(botao);
      expect(reopenSession).not.toHaveBeenCalled();
    },
  );

  it('recusa da api (sessão com execução): toast com a frase dela, e a sessão segue encerrada', async () => {
    reopenSession.mockRejectedValue(
      Object.assign(new Error('409'), {
        status: 409,
        body: {
          message: 'Esta sessão ativou a execução e não pode ser reaberta.',
          reason: 'sessao_com_execucao',
        },
      }),
    );

    montar();
    const botao = await screen.findByRole('button', { name: 'Reabrir sessão' });
    await waitFor(() => expect(botao).toBeEnabled());
    fireEvent.click(botao);

    expect(
      await screen.findByText('Esta sessão ativou a execução e não pode ser reaberta.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reabrir sessão' })).toBeInTheDocument();
  });

  it('CASO DE CONTRASTE: sessão ativa não oferece reabrir', async () => {
    getSession.mockResolvedValue(sessao({ status: 'active' }));
    montar();
    await screen.findByRole('button', { name: 'Encerrar' });
    expect(screen.queryByRole('button', { name: 'Reabrir sessão' })).not.toBeInTheDocument();
  });
});
