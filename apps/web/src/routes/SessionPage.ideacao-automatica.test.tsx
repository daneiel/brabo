import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Session } from '../lib/api-types';
import { historicoFalso } from '../test/historico-de-eventos';

/**
 * Achado 3: sessão criativa deve iniciar ideação sozinha, sem exigir o
 * clique separado em "Iniciar ideação".
 *
 * Antes, com `activeAgent` nulo, `handleSend` caía no caminho de chat SSE
 * genérico (`streamChatMessage`) — sem histórico, sem system prompt do
 * Criativo, sem a tool `emit_artifact`. NÃO era o Criativo de verdade.
 *
 * A correção: numa sessão `kind: 'criativa'` sem agente ativo ainda, a
 * PRIMEIRA mensagem ATIVA o Criativo primeiro (aguardando a ativação real
 * terminar) e só DEPOIS manda a mensagem pelo caminho real
 * (`sendAgentMessage`) — nunca pelo SSE genérico.
 */

const startAgent = vi.fn();
const sendAgentMessage = vi.fn();
const streamChatMessage = vi.fn();
const getSession = vi.fn();

const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));

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

vi.mock('../lib/chat-stream', () => ({
  streamChatMessage: (...args: unknown[]) => streamChatMessage(...args),
}));
vi.mock('../lib/session-channel', () => ({
  connectSessionHeartbeat: () => () => {},
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
  startAgent: (...args: unknown[]) => startAgent(...args),
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

async function mandarMensagem(texto: string) {
  const campo = await screen.findByPlaceholderText(
    'Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)',
  );
  fireEvent.change(campo, { target: { value: texto } });
  fireEvent.keyDown(campo, { key: 'Enter' });
}

beforeEach(() => {
  vi.clearAllMocks();
  eventos.mockReturnValue({ items: [] });
  getSession.mockResolvedValue(sessao());
  startAgent.mockResolvedValue({ agent: 'criativo', status: 'active' });
  sendAgentMessage.mockResolvedValue({ ok: true });
});

describe('SessionPage — a primeira mensagem de uma sessão criativa ativa o Criativo sozinha', () => {
  it('caminho feliz: ativa o Criativo e SÓ DEPOIS manda a mensagem pelo caminho real', async () => {
    montar();
    await mandarMensagem('Quero uma API que responda oi');

    await waitFor(() => expect(sendAgentMessage).toHaveBeenCalled());

    // Ativou ANTES de mandar — não em paralelo, e não depois.
    expect(startAgent).toHaveBeenCalledWith('proj-1', ID, 'criativo');
    expect(sendAgentMessage).toHaveBeenCalledWith(
      'proj-1',
      ID,
      'criativo',
      'Quero uma API que responda oi',
    );
    const ordemAtivar = startAgent.mock.invocationCallOrder[0];
    const ordemMandar = sendAgentMessage.mock.invocationCallOrder[0];
    expect(ordemAtivar).toBeLessThan(ordemMandar);

    // NUNCA pelo caminho SSE genérico — sem histórico, sem tool emit_artifact.
    expect(streamChatMessage).not.toHaveBeenCalled();
  });

  it('CASO DE FALHA: erro ao ativar o Criativo não manda a mensagem e limpa o estado otimista', async () => {
    startAgent.mockRejectedValue(new Error('engine fora do ar'));

    montar();
    await mandarMensagem('oi');

    await waitFor(() => expect(startAgent).toHaveBeenCalled());
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(streamChatMessage).not.toHaveBeenCalled();

    const campo = await screen.findByPlaceholderText(
      'Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)',
    );
    await waitFor(() => expect(campo).not.toBeDisabled());
    expect(screen.queryByText('oi')).toBeNull();
  });

  it('sessão CONSULTIVA continua pelo caminho SSE genérico — a correção é só da criativa', async () => {
    getSession.mockResolvedValue(sessao({ kind: 'consultiva' }));
    streamChatMessage.mockReturnValue(
      (async function* () {
        // sem deltas — só encerra o gerador.
      })(),
    );

    montar();
    await mandarMensagem('uma dúvida qualquer');

    await waitFor(() => expect(streamChatMessage).toHaveBeenCalled());
    expect(startAgent).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });
});
