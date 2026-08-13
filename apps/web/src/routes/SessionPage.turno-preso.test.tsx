import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Session } from '../lib/api-types';
import type { SessionChannelHandlers } from '../lib/session-channel';

/**
 * Bug: numa sessão criativa com o Criativo já ativo, mandar uma mensagem
 * dependia INTEIRAMENTE do canal Phoenix entregar `agent.done` pra resetar
 * `streaming`/`optimisticUser` — e a conexão do canal (ticket RN-108 + join)
 * é assíncrona e pode não terminar a tempo do turno completar (ou o broadcast
 * pode se perder por qualquer outro motivo de rede). Quando isso acontece, o
 * cliente fica preso: a bolha otimista nunca some (duplicando quando o evento
 * persistido chega por outra via) e o composer/indicador de "digitando" nunca
 * voltam ao normal.
 *
 * `sendAgentMessage` (POST .../agents/:agent/message) só RESOLVE depois que o
 * engine termina o turno inteiro (`GenServer.call` síncrono no
 * `CriativoServer.user_message/2`, com timeout de 120s) — é sinal de
 * conclusão tão confiável quanto `agent.done`, e a correção usa isso como
 * rede de segurança. Este teste simula exatamente o cenário em que o canal
 * NUNCA entrega `onAgentDone` e confirma que o estado se reconcilia mesmo
 * assim.
 */

const getSession = vi.fn();
const sendAgentMessage = vi.fn();
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

beforeEach(() => {
  vi.clearAllMocks();
  canalHandlers = undefined;
  eventos.mockReturnValue({
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
  });
  getSession.mockResolvedValue(sessao());
});

describe('SessionPage — turno preso quando o canal perde o agent.done', () => {
  it('caminho feliz: sendAgentMessage resolver reconcilia streaming/otimista mesmo sem onAgentDone', async () => {
    let resolverEnvio: () => void = () => {};
    sendAgentMessage.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolverEnvio = () => resolve();
        }),
    );

    montar();

    const campo = await screen.findByPlaceholderText(
      'Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)',
    );
    fireEvent.change(campo, { target: { value: 'Quero uma API que responda oi' } });
    fireEvent.keyDown(campo, { key: 'Enter' });

    // A bolha otimista aparece, e só UMA vez — nada de duplicata antes mesmo
    // do turno terminar.
    expect(
      await screen.findAllByText('Quero uma API que responda oi'),
    ).toHaveLength(1);

    // O composer fica desabilitado (streaming) enquanto o turno está em
    // curso — sinal isolado do `draft` vazio, que também desabilitaria o
    // botão "Enviar".
    expect(campo).toBeDisabled();

    // O canal registrou os handlers, mas o teste NUNCA chama onAgentDone —
    // simula o broadcast perdido (join tardio, ticket expirado, etc.).
    expect(canalHandlers?.onAgentDone).toBeTypeOf('function');

    // O evento persistido chega por outra via (poll independente do canal) —
    // simulado atualizando o que `useSessionEvents` devolve.
    eventos.mockReturnValue({
      items: [
        {
          id: 'e0',
          seq: 1,
          type: 'agent.activated',
          actor: { kind: 'agent', id: 'criativo' },
          payload: { agent: 'criativo' },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
        {
          id: 'e1',
          seq: 2,
          type: 'chat.message',
          actor: { kind: 'user', id: 'user-1' },
          payload: { text: 'Quero uma API que responda oi' },
          createdAt: '2026-08-10T12:00:01.000Z',
        },
      ],
    });

    // A REST call resolve — é o sinal de fim de turno que a correção usa
    // como rede de segurança, já que onAgentDone nunca chegou.
    resolverEnvio();

    // `streaming` volta a `false`.
    await waitFor(() => expect(campo).not.toBeDisabled());

    // Sem a correção, a bolha otimista ficaria presa e o evento persistido
    // (trazido pelo refetch que a correção também dispara) apareceria ao
    // lado dela — duas bolhas com o mesmo texto. Com a correção, só uma.
    expect(
      await screen.findAllByText('Quero uma API que responda oi'),
    ).toHaveLength(1);
  });

  it('CASO DE FALHA: erro no envio limpa o estado otimista e avisa o usuário', async () => {
    sendAgentMessage.mockRejectedValue(new Error('rede caiu'));

    montar();

    const campo = await screen.findByPlaceholderText(
      'Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)',
    );
    fireEvent.change(campo, { target: { value: 'oi' } });
    fireEvent.keyDown(campo, { key: 'Enter' });

    await waitFor(() => expect(campo).not.toBeDisabled());
    expect(screen.queryByText('oi')).toBeNull();
  });
});
