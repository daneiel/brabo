import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Session } from '../lib/api-types';
import type { SessionChannelHandlers } from '../lib/session-channel';
import { historicoFalso } from '../test/historico-de-eventos';
// Instância REAL do app (mesmo padrão de SessionPage.arquiteto-modelo-icone.test.tsx):
// as asserções abaixo esperam texto em pt-BR, e `en` é o idioma DEFAULT.
import i18n from '../lib/i18n';

/**
 * RN-131 — mesmo bug do `SessionPage.turno-preso.test.tsx` (rede de
 * segurança contra o canal perder `agent.done`), desta vez em
 * `handleReadiness`. `confirmReadiness` também é um `GenServer.call`
 * síncrono no engine (até 120s) — `handleSend` já ganhou a rede de
 * segurança (chamar `finalizarTurnoDoAgente()` assim que a chamada síncrona
 * resolve, independente do canal ter entregue `agent.done`), mas
 * `handleReadiness` tinha ficado de fora: sem ela, clicar em "Estou pronto
 * para produzir" e o canal nunca entregar `onAgentDone` deixava a bolha do
 * agente presa vazia (`streaming: true`, sem texto) pra sempre.
 */

const getSession = vi.fn();
const confirmReadiness = vi.fn();
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

describe('SessionPage — handleReadiness ganha a mesma rede de segurança de handleSend (RN-131)', () => {
  it('caminho feliz: confirmReadiness resolver reconcilia o estado mesmo sem onAgentDone', async () => {
    let resolverConfirmacao: () => void = () => {};
    confirmReadiness.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolverConfirmacao = () => resolve();
        }),
    );

    montar();

    const botao = await screen.findByRole('button', {
      name: 'Estou pronto para produzir',
    });
    fireEvent.click(botao);

    // `streaming` liga na hora — a bolha do agente aparece.
    const campo = await screen.findByPlaceholderText(
      'Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)',
    );
    await waitFor(() => expect(campo).toBeDisabled());

    // O canal registrou os handlers, mas o teste NUNCA chama onAgentDone —
    // simula o broadcast perdido (join tardio, ticket expirado, etc.), o
    // mesmo cenário do bug em `handleSend`.
    expect(canalHandlers?.onAgentDone).toBeTypeOf('function');

    // A REST call (o `GenServer.call` síncrono) resolve — é o sinal de fim
    // de turno que a correção usa como rede de segurança.
    resolverConfirmacao();

    // Sem a correção, `streaming` ficaria travado em `true` pra sempre: só
    // `onAgentDone` resetava, e ele nunca chega neste teste.
    await waitFor(() => expect(campo).not.toBeDisabled());
  });

  it('CASO DE FALHA: erro ao confirmar prontidão limpa o streaming e avisa o usuário', async () => {
    confirmReadiness.mockRejectedValue(new Error('engine fora do ar'));

    montar();

    const botao = await screen.findByRole('button', {
      name: 'Estou pronto para produzir',
    });
    fireEvent.click(botao);

    const campo = await screen.findByPlaceholderText(
      'Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)',
    );
    await waitFor(() => expect(campo).not.toBeDisabled());
    expect(await screen.findByText('Erro')).toBeInTheDocument();
  });
});
