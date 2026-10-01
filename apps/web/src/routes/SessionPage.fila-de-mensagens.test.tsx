import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Session } from '../lib/api-types';
import { historicoFalso } from '../test/historico-de-eventos';
// Instância REAL do app (mesmo padrão de SessionPage.arquiteto-modelo-icone.test.tsx):
// as asserções abaixo esperam texto em pt-BR, e `en` é o idioma DEFAULT.
import i18n from '../lib/i18n';

/**
 * RN-673 (ADR 0191): com turno em curso, a mensagem a um agente entra na FILA
 * dele — o composer não trava, a mensagem não arma turno novo na tela, e o fio
 * mostra "na fila" (com cancelar para quem a enviou) ou "cancelada", derivado
 * do log. A fila em si mora no engine; aqui só o contrato do CLIENTE.
 */

const getSession = vi.fn();
const sendAgentMessage = vi.fn();
const cancelAgentTurn = vi.fn();
const cancelQueuedAgentMessage = vi.fn();

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
  useSessionEventHistory: () => historicoFalso(eventos().items),
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: { items: [] } }),
  useHandoffs: () => ({ data: [] }),
  useCurrentWorkspaceWithRole: () => ({ data: undefined }),
  useBacklog: () => ({ data: [] }),
}));

vi.mock('../lib/chat-stream', () => ({ streamChatMessage: vi.fn() }));

// O canal não importa aqui: a fila é dita pelo log, não por aviso do canal.
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
  sendAgentMessage: (...args: unknown[]) => sendAgentMessage(...args),
  cancelAgentTurn: (...args: unknown[]) => cancelAgentTurn(...args),
  cancelQueuedAgentMessage: (...args: unknown[]) => cancelQueuedAgentMessage(...args),
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


beforeEach(async () => {
  vi.clearAllMocks();
  window.localStorage.clear();
  await i18n.changeLanguage('pt-BR');
  eventos.mockReturnValue({ items: eventosIniciais });
  getSession.mockResolvedValue(sessao());
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

const mensagem = (id: string, seq: number, autor: string, text: string) => ({
  id,
  seq,
  type: 'chat.message',
  actor: { kind: 'user', id: autor },
  payload: { text },
  createdAt: '2026-08-10T12:00:01.000Z',
});

const enfileirada = (id: string, seq: number) => ({
  id: `q-${id}`,
  seq,
  type: 'chat.message_queued',
  actor: { kind: 'agent', id: 'criativo' },
  payload: { mensagemId: id, texto: 'x', posicao: 1 },
  createdAt: '2026-08-10T12:00:02.000Z',
});

describe('SessionPage — a fila de mensagens com turno em curso (RN-673)', () => {
  it('com turno em curso, a mensagem vai ao agente sem armar turno novo, e a tela diz que entrou na fila', async () => {
    // O primeiro envio nunca resolve: o turno fica em curso.
    sendAgentMessage.mockImplementationOnce(() => new Promise<void>(() => {}));
    sendAgentMessage.mockResolvedValueOnce({
      ok: true,
      mensagemId: 'evt-2',
      entrega: 'enfileirada',
      posicao: 1,
    });

    montar();
    await enviarMensagem('primeira');
    await screen.findByRole('button', { name: 'Parar' });

    // O campo segue aberto e o botão vira "Pôr na fila".
    const campo = await enviarMensagem('e o prazo?');
    expect(campo).not.toBeDisabled();
    await waitFor(() => expect(sendAgentMessage).toHaveBeenCalledTimes(2));
    expect(sendAgentMessage).toHaveBeenLastCalledWith('proj-1', ID, 'criativo', 'e o prazo?');

    expect(await screen.findByText(/entrou na fila \(posição 1\)/)).toBeInTheDocument();
    expect((campo as HTMLTextAreaElement).value).toBe('');
    // O turno acompanhado continua sendo o primeiro.
    expect(screen.getByRole('button', { name: 'Parar' })).toBeInTheDocument();
  });

  it('fila cheia: a recusa da api é dita e o texto volta ao campo', async () => {
    sendAgentMessage.mockImplementationOnce(() => new Promise<void>(() => {}));
    sendAgentMessage.mockRejectedValueOnce(
      Object.assign(new Error('409'), {
        status: 409,
        body: { message: 'Já há 10 mensagens esperando o fim do turno deste agente.' },
      }),
    );

    montar();
    await enviarMensagem('primeira');
    await screen.findByRole('button', { name: 'Parar' });
    const campo = await enviarMensagem('a décima primeira');

    expect(await screen.findByText(/Já há 10 mensagens/)).toBeInTheDocument();
    await waitFor(() => expect((campo as HTMLTextAreaElement).value).toBe('a décima primeira'));
  });

  it('a mensagem na fila ganha o selo e, para quem a enviou, o botão de cancelar', async () => {
    eventos.mockReturnValue({
      items: [
        ...eventosIniciais,
        mensagem('m1', 2, 'eu', 'minha pendente'),
        enfileirada('m1', 3),
        mensagem('m2', 4, 'outra-pessoa', 'pendente de outra pessoa'),
        enfileirada('m2', 5),
      ],
    });
    cancelQueuedAgentMessage.mockResolvedValue({ ok: true });

    montar();

    const selos = await screen.findAllByText(/na fila de/);
    expect(selos).toHaveLength(2);
    // Só a MINHA tem o botão: a api recusa cancelar a fala de outra pessoa.
    const cancelar = await screen.findAllByRole('button', { name: 'Cancelar' });
    expect(cancelar).toHaveLength(1);

    fireEvent.click(cancelar[0]);
    await waitFor(() =>
      expect(cancelQueuedAgentMessage).toHaveBeenCalledWith('proj-1', ID, 'criativo', 'm1'),
    );
  });

  it('entregue some do selo; cancelada fica riscada, sem botão', async () => {
    eventos.mockReturnValue({
      items: [
        ...eventosIniciais,
        mensagem('m1', 2, 'eu', 'lida no turno seguinte'),
        enfileirada('m1', 3),
        {
          id: 'd1',
          seq: 4,
          type: 'chat.message_delivered',
          actor: { kind: 'agent', id: 'criativo' },
          payload: { mensagemIds: ['m1'] },
          createdAt: '2026-08-10T12:00:03.000Z',
        },
        mensagem('m2', 5, 'eu', 'desisti'),
        enfileirada('m2', 6),
        {
          id: 'c1',
          seq: 7,
          type: 'chat.message_cancelled',
          actor: { kind: 'user', id: 'eu' },
          payload: { mensagemId: 'm2', agente: 'criativo' },
          createdAt: '2026-08-10T12:00:04.000Z',
        },
      ],
    });

    montar();

    expect(await screen.findByText(/cancelada na fila/)).toBeInTheDocument();
    expect(screen.queryByText(/na fila de/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
  });
});
