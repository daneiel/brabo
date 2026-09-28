import { describe, expect, it, vi, beforeEach, afterAll, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Session } from '../lib/api-types';
import type { SessionChannelHandlers } from '../lib/session-channel';
import { historicoFalso } from '../test/historico-de-eventos';
// Instância REAL do app (mesmo padrão de SessionPage.arquiteto-modelo-icone.test.tsx):
// as asserções abaixo esperam texto em pt-BR, e `en` é o idioma DEFAULT.
import i18n from '../lib/i18n';

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
 * Desde o ADR 0163 (RN-578) `sendAgentMessage` resolve no ACEITE — o turno
 * segue no engine —, então "a chamada resolveu" deixou de ser sinal de fim
 * de turno (era a rede de segurança até aqui). A rede passou a ser a leitura
 * da cauda do log: o `agent.status` persistido mais recente do agente. Este
 * teste simula o canal que NUNCA entrega `onAgentDone` e prova as duas
 * metades: resolver NÃO libera a tela enquanto o log diz `working`, e o log
 * dizendo `idle` libera.
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

afterAll(() => {
  void i18n.changeLanguage('en');
});

const STATUS = (seq: number, status: string) => ({
  id: `st-${seq}`,
  seq,
  type: 'agent.status',
  actor: { kind: 'agent', id: 'criativo' },
  payload: { status },
  createdAt: '2026-08-10T12:00:02.000Z',
});

describe('SessionPage — turno preso quando o canal perde o agent.done', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('caminho feliz: aceito, a tela segue o log — working segura, idle libera, sem onAgentDone', async () => {
    // ADR 0163: o aceite volta na hora.
    sendAgentMessage.mockResolvedValue({ ok: true });
    // O `working` do turno novo já está gravado quando o aceite volta.
    cauda.mockResolvedValue({ items: [STATUS(3, 'working')], nextCursor: null });

    montar();

    const campo = await screen.findByPlaceholderText(
      'Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)',
    );
    fireEvent.change(campo, { target: { value: 'Quero uma API que responda oi' } });
    fireEvent.keyDown(campo, { key: 'Enter' });

    // A bolha otimista aparece, e só UMA vez.
    expect(
      await screen.findAllByText('Quero uma API que responda oi'),
    ).toHaveLength(1);
    await waitFor(() => expect(cauda).toHaveBeenCalled());

    // A chamada JÁ resolveu, e o composer continua desabilitado: resolver é
    // o aceite, não o fim do turno. Até o ADR 0163 esta era a linha que
    // liberava a tela.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(campo).toBeDisabled();

    // O canal registrou os handlers, mas o teste NUNCA chama onAgentDone —
    // simula o broadcast perdido (join tardio, ticket expirado, etc.).
    expect(canalHandlers?.onAgentDone).toBeTypeOf('function');

    // O turno termina: o log ganha o `idle` e o evento persistido.
    cauda.mockResolvedValue({
      items: [STATUS(3, 'working'), STATUS(5, 'idle')],
      nextCursor: null,
    });
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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    // `streaming` volta a `false` pela leitura do log.
    await waitFor(() => expect(campo).not.toBeDisabled());

    // Sem duplicata: a bolha otimista saiu quando o persistido chegou.
    expect(
      await screen.findAllByText('Quero uma API que responda oi'),
    ).toHaveLength(1);
  });

  it('CASO DE FALHA: 409 com o agente ainda em turno mostra a frase do engine', async () => {
    sendAgentMessage.mockRejectedValue(
      Object.assign(new Error('409'), {
        status: 409,
        body: {
          message:
            'O agente ainda está no meio de um turno — a mensagem ficou registrada, mas não foi lida.',
        },
      }),
    );

    montar();

    const campo = await screen.findByPlaceholderText(
      'Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)',
    );
    fireEvent.change(campo, { target: { value: 'Continue' } });
    fireEvent.keyDown(campo, { key: 'Enter' });

    expect(await screen.findByText(/mas não foi lida/)).toBeInTheDocument();
    await waitFor(() => expect(campo).not.toBeDisabled());
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
