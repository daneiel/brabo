import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Session } from '../lib/api-types';
import type { SessionChannelHandlers } from '../lib/session-channel';
import { historicoFalso } from '../test/historico-de-eventos';
// Instância REAL do app (mesmo padrão de SessionPage.arquiteto-modelo-icone.test.tsx):
// as asserções abaixo esperam texto em pt-BR, e `en` é o idioma DEFAULT.
import i18n from '../lib/i18n';

/**
 * AT-268 — reabrir a sessão com um turno em curso. O estado do turno da tela é
 * `useState` local e se perdia ao sair e voltar: a faixa não voltava, o composer
 * ficava habilitado e a próxima mensagem levava o 409. Agora o primeiro quadro
 * de eventos decide, pelo `agent.status` persistido mais recente (RN-460/578),
 * e a rede de segurança do log (a mesma do turno aceito) fecha o turno.
 */

const getSession = vi.fn();
const sendAgentMessage = vi.fn();
/** A cauda do log que a rede de segurança lê (ADR 0163). */
const cauda = vi.fn();
/** Handlers que `connectSessionHeartbeat` recebeu — o teste nunca chama
 *  `onAgentDone` a partir daqui, simulando o broadcast perdido. */
let canalHandlers: SessionChannelHandlers | undefined;

const eventos = vi.fn<() => { items: unknown[] }>(() => ({
  items: [
    {
      id: 'e0',
      seq: 1,
      type: 'agent.activated',
      actor: { kind: 'agent', id: 'criativo' },
      payload: { agent: 'criativo' },
      createdAt: '2026-08-10T12:00:00.000Z',
    },
  ],
}));

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
  useCurrentWorkspaceWithRole: () => ({ data: undefined }),
  useBacklog: () => ({ data: [] }),
}));

vi.mock('../lib/chat-stream', () => ({ streamChatMessage: vi.fn() }));

vi.mock('../lib/session-channel', () => ({
  connectSessionHeartbeat: (
    _projectId: string,
    _sessionId: string,
    handlers: SessionChannelHandlers,
  ) => {
    canalHandlers = handlers;
    return () => {
      canalHandlers = undefined;
    };
  },
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
  sendAgentMessage: (...args: unknown[]) => sendAgentMessage(...args),
  listSessionEvents: (...args: unknown[]) => cauda(...args),
  setSessionModelBinding: vi.fn(),
  startAgent: vi.fn(),
  transitionSession: vi.fn(),
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
    createdAt: '2026-08-10T12:00:00.000Z',
    updatedAt: '2026-08-10T12:00:00.000Z',
    closedAt: null,
    ...over,
  } as Session;
}

function montar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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
  canalHandlers = undefined;
  getSession.mockResolvedValue(sessao());
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

const ATIVADO = {
  id: 'e0',
  seq: 1,
  type: 'agent.activated',
  actor: { kind: 'agent', id: 'criativo' },
  payload: { agent: 'criativo' },
  createdAt: '2026-08-10T12:00:00.000Z',
};
const STATUS = (seq: number, status: string) => ({
  id: `st-${seq}`,
  seq,
  type: 'agent.status',
  actor: { kind: 'agent', id: 'criativo' },
  payload: { status },
  createdAt: '2026-08-10T12:00:02.000Z',
});
const PLACEHOLDER = 'Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)';

describe('SessionPage — retomar o turno em curso a partir do log (AT-268)', () => {
  it('caminho feliz: último agent.status working trava o composer e o log destrava no idle', async () => {
    eventos.mockReturnValue({ items: [ATIVADO, STATUS(3, 'working')] });
    // A rede de segurança lê a cauda: ainda working.
    cauda.mockResolvedValue({ items: [STATUS(3, 'working')], nextCursor: null });

    montar();

    const campo = await screen.findByPlaceholderText(PLACEHOLDER);
    await waitFor(() => expect(campo).toBeDisabled());
    await waitFor(() => expect(cauda).toHaveBeenCalled());
    expect(sendAgentMessage).not.toHaveBeenCalled();

    // O turno fecha no log: o composer volta.
    cauda.mockResolvedValue({
      items: [STATUS(3, 'working'), STATUS(5, 'idle')],
      nextCursor: null,
    });
    await act(async () => {
      canalHandlers?.onEvent?.({ type: 'agent.status', actorId: 'criativo' });
    });
    await waitFor(() => expect(campo).not.toBeDisabled());
  });

  it('CASO DE FALHA: idle mais recente (ou nenhum status) não inventa turno — composer livre, sem leitura da cauda', async () => {
    eventos.mockReturnValue({
      items: [ATIVADO, STATUS(3, 'working'), STATUS(5, 'idle')],
    });

    montar();

    const campo = await screen.findByPlaceholderText(PLACEHOLDER);
    expect(campo).not.toBeDisabled();
    expect(cauda).not.toHaveBeenCalled();
  });
});
