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
 * RN-579 composta com o ADR 0163 (RN-578). Um turno ACEITO é acompanhado pela
 * cauda do log a cada 4s (a rede contra o `agent.done` perdido). Desde a
 * RN-579 o engine avisa no canal todo evento persistido — inclusive o
 * `agent.status` que fecha o turno —, e esse aviso do agente ACOMPANHADO
 * antecipa a leitura: o turno fecha sem esperar o tique. O tique continua,
 * porque o aviso também pode se perder. Aviso de OUTRO agente, ou sem turno
 * acompanhado, não lê nada a mais.
 */

const getSession = vi.fn();
const confirmReadiness = vi.fn();
const cauda = vi.fn();
let canalHandlers: SessionChannelHandlers | undefined;

const EVENTOS_CRIATIVO_ATIVO = [
  {
    id: 'e0',
    seq: 1,
    type: 'agent.activated',
    actor: { kind: 'agent', id: 'criativo' },
    payload: { agent: 'criativo' },
    createdAt: '2026-08-11T12:00:00.000Z',
  },
  // O botão desabilita sem regra de negócio nenhuma (guardrail do engine em
  // `CriativoServer` + a UX complementar em `SessionPage.tsx`) — o assunto
  // deste arquivo é a rede de segurança do PRÓPRIO `handleReadiness`, então a
  // fixture precisa do botão HABILITADO pra não confundir os dois.
  {
    id: 'e1',
    seq: 2,
    type: 'artifact.business_rule',
    actor: { kind: 'agent', id: 'criativo' },
    payload: { title: 'Só maiores de 18', description: 'Idade >= 18', origin: [1] },
    createdAt: '2026-08-11T12:00:30.000Z',
  },
];

const eventos = vi.fn<() => { items: unknown[] }>(() => ({
  items: EVENTOS_CRIATIVO_ATIVO,
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
  confirmReadiness: (...args: unknown[]) => confirmReadiness(...args),
  listSessionEvents: (...args: unknown[]) => cauda(...args),
  denyAction: vi.fn(),
  sendAgentMessage: vi.fn(),
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
    createdAt: '2026-08-11T12:00:00.000Z',
    updatedAt: '2026-08-11T12:00:00.000Z',
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
  eventos.mockReturnValue({ items: EVENTOS_CRIATIVO_ATIVO });
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

const { avisoPedeVerificacaoDoTurno } = await import('../lib/session-turno');

describe('avisoPedeVerificacaoDoTurno (RN-579 × ADR 0163)', () => {
  it('só o agent.status do agente acompanhado pede a leitura', () => {
    expect(avisoPedeVerificacaoDoTurno('agent.status', 'criativo', 'criativo')).toBe(true);
    expect(avisoPedeVerificacaoDoTurno('agent.status', 'po', 'criativo')).toBe(false);
    expect(avisoPedeVerificacaoDoTurno('tool.result', 'criativo', 'criativo')).toBe(false);
    expect(avisoPedeVerificacaoDoTurno('agent.status', 'criativo', null)).toBe(false);
  });
});

describe('SessionPage — o aviso do canal compõe com o acompanhamento pelo log', () => {
  beforeEach(() => {
    // O relógio falso anda com o real (as buscas do Testing Library dependem
    // disso), mas o teste inteiro leva bem menos que os 4s do tique: a leitura
    // além da inicial, antes de avançar 4000ms à mão, só pode vir do aviso.
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function aceitarTurnoDoCriativo() {
    confirmReadiness.mockResolvedValue({ ok: true });
    cauda.mockResolvedValue({ items: [STATUS(4, 'working')], nextCursor: null });
    montar();
    const botao = await screen.findByRole('button', { name: 'Estou pronto para produzir' });
    fireEvent.click(botao);
    const campo = await screen.findByPlaceholderText(
      'Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)',
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => expect(cauda).toHaveBeenCalledTimes(1));
    expect(campo).toBeDisabled();
    return campo;
  }

  it('caminho feliz: o agent.status do acompanhado no canal fecha o turno SEM esperar o tique', async () => {
    const campo = await aceitarTurnoDoCriativo();

    // O turno fechou no log; o `agent.done` do canal se perdeu, mas o aviso do
    // `agent.status` persistido chegou.
    cauda.mockResolvedValue({
      items: [STATUS(4, 'working'), STATUS(9, 'idle')],
      nextCursor: null,
    });
    await act(async () => {
      canalHandlers?.onEvent?.({ type: 'agent.status', actorId: 'criativo' });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(cauda).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(campo).not.toBeDisabled());
  });

  it('CASO DE FALHA coberto: aviso de OUTRO agente não lê a cauda, e o tique de 4s continua sendo a rede', async () => {
    const campo = await aceitarTurnoDoCriativo();

    cauda.mockResolvedValue({
      items: [STATUS(4, 'working'), STATUS(9, 'idle')],
      nextCursor: null,
    });
    await act(async () => {
      canalHandlers?.onEvent?.({ type: 'agent.status', actorId: 'po' });
      canalHandlers?.onEvent?.({ type: 'tool.result', actorId: 'criativo' });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(cauda).toHaveBeenCalledTimes(1);
    expect(campo).toBeDisabled();

    // Nenhum aviso útil chegou: o tique fecha o turno, como antes da RN-579.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(cauda).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(campo).not.toBeDisabled());
  });

  it('turno fechado: o aviso deixa de ler a cauda, e o tique para', async () => {
    const campo = await aceitarTurnoDoCriativo();
    cauda.mockResolvedValue({
      items: [STATUS(4, 'working'), STATUS(9, 'idle')],
      nextCursor: null,
    });
    await act(async () => {
      canalHandlers?.onAgentDone?.();
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => expect(campo).not.toBeDisabled());
    const leituras = cauda.mock.calls.length;

    await act(async () => {
      canalHandlers?.onEvent?.({ type: 'agent.status', actorId: 'criativo' });
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(cauda).toHaveBeenCalledTimes(leituras);
  });
});
