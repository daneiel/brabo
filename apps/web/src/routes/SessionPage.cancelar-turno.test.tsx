import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Session } from '../lib/api-types';
import type { SessionChannelHandlers } from '../lib/session-channel';

/**
 * RN-122: o botão "Parar" do composer chama a nova rota de cancelamento
 * (`cancelAgentTurn`) pro agente ativo — só existe enquanto `streaming` é
 * `true`. O cancelamento DE VERDADE acontece no engine (mata a Task que
 * segura o LLM); este teste cobre só o contrato do CLIENTE: o botão aparece
 * na hora certa, chama a rota certa com o agente certo, e reconcilia o
 * estado (`streaming` volta a `false`) depois.
 */

const getSession = vi.fn();
const sendAgentMessage = vi.fn();
const cancelAgentTurn = vi.fn();
let canalHandlers: SessionChannelHandlers | undefined;

const eventosIniciais = [
  {
    id: 'e0',
    seq: 1,
    type: 'agent.activated',
    actor: { kind: 'agent', id: 'criativo' },
    payload: { agent: 'criativo' },
    createdAt: '2026-08-10T12:00:00.000Z',
  },
];

const eventos = vi.fn<() => { items: unknown[] }>(() => ({
  items: eventosIniciais,
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

vi.mock('../lib/auth', () => ({ emailDaSessao: () => 'eu@brabo.dev' }));

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
  cancelAgentTurn: (...args: unknown[]) => cancelAgentTurn(...args),
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

async function enviarMensagem(texto: string) {
  const campo = await screen.findByPlaceholderText(
    'Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)',
  );
  fireEvent.change(campo, { target: { value: texto } });
  fireEvent.keyDown(campo, { key: 'Enter' });
  return campo;
}

beforeEach(() => {
  vi.clearAllMocks();
  canalHandlers = undefined;
  eventos.mockReturnValue({ items: eventosIniciais });
  getSession.mockResolvedValue(sessao());
});

describe('SessionPage — botão "Parar" (RN-122)', () => {
  it('não existe enquanto não há turno em curso', async () => {
    sendAgentMessage.mockResolvedValue(undefined);
    montar();

    await screen.findByPlaceholderText(
      'Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)',
    );
    expect(screen.queryByRole('button', { name: 'Parar' })).toBeNull();
  });

  it('aparece durante o turno, cancela o AGENTE certo, e some quando reconcilia', async () => {
    let resolverEnvio: () => void = () => {};
    sendAgentMessage.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolverEnvio = () => resolve();
        }),
    );
    cancelAgentTurn.mockResolvedValue({ ok: true });

    montar();
    await enviarMensagem('gerando algo caro');

    const botaoParar = await screen.findByRole('button', { name: 'Parar' });
    expect(botaoParar).not.toBeDisabled();

    fireEvent.click(botaoParar);

    // A rota de cancelamento é chamada com o agente ATIVO da sessão — o
    // mesmo que recebeu a mensagem, nunca um valor fixo.
    await waitFor(() =>
      expect(cancelAgentTurn).toHaveBeenCalledWith('proj-1', ID, 'criativo'),
    );

    // Depois que `cancelAgentTurn` resolve, a tela reconcilia sem esperar o
    // round-trip do `sendAgentMessage` original (que ainda está pendente
    // neste teste — nunca chamamos `resolverEnvio`, simulando o pior caso).
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Parar' })).toBeNull(),
    );

    const campo = screen.getByPlaceholderText(
      'Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)',
    );
    expect(campo).not.toBeDisabled();

    // A promessa original também pode resolver depois (o engine responde
    // 202 ao `sendAgentMessage` assim que o `GenServer.call` desbloqueia) —
    // `finalizarTurnoDoAgente` é idempotente, então isso não pode quebrar.
    resolverEnvio();
  });

  it('erro ao cancelar avisa o usuário e MANTÉM o turno em curso', async () => {
    sendAgentMessage.mockImplementation(() => new Promise<void>(() => {}));
    cancelAgentTurn.mockRejectedValue(new Error('engine fora do ar'));

    montar();
    await enviarMensagem('outra mensagem');

    const botaoParar = await screen.findByRole('button', { name: 'Parar' });
    fireEvent.click(botaoParar);

    await waitFor(() => expect(cancelAgentTurn).toHaveBeenCalled());

    // Continua streaming: o botão "Parar" segue disponível — cancelar
    // falhou, o turno real no engine não foi interrompido.
    expect(await screen.findByRole('button', { name: 'Parar' })).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)'),
    ).toBeDisabled();
  });

  it('canal entrega onAgentDone primeiro: some mesmo sem a rota de cancelar', async () => {
    sendAgentMessage.mockImplementation(() => new Promise<void>(() => {}));

    montar();
    await enviarMensagem('mensagem qualquer');

    await screen.findByRole('button', { name: 'Parar' });

    canalHandlers?.onAgentDone?.();

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Parar' })).toBeNull(),
    );
  });
});
