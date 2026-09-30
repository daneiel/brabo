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
 * AT-301 — um token do turno NÃO re-renderiza a `SessionPage`.
 *
 * Até aqui cada `agent.delta` do canal despachava no reducer da faixa, que
 * morava num `useReducer` do hook chamado pela página: mil tokens, mil renders
 * da página inteira. Agora o texto em curso mora num store externo, e só a
 * faixa (e a bolha do chat consultivo) o assinam.
 *
 * O contador é o próprio corpo da página: `useSessionReadiness` é chamado
 * UMA vez por render da `SessionPage`, então embrulhá-lo num espião conta os
 * renders dela — e só dela (a faixa e a bolha não o chamam).
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

const rendersDaPagina = vi.fn();
vi.mock('../lib/session-readiness', async () => {
  const real = await vi.importActual<typeof import('../lib/session-readiness')>(
    '../lib/session-readiness',
  );
  return {
    ...real,
    useSessionReadiness: (...args: Parameters<typeof real.useSessionReadiness>) => {
      rendersDaPagina();
      return real.useSessionReadiness(...args);
    },
  };
});

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
  cauda.mockResolvedValue({ items: [], nextCursor: null });
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

async function montarComCanal() {
  montar();
  await screen.findByRole('button', { name: 'Estou pronto para produzir' });
  await waitFor(() => expect(canalHandlers?.onAgentDelta).toBeDefined());
  return canalHandlers!;
}

describe('SessionPage — o streaming não re-renderiza a página (AT-301)', () => {
  it('caminho feliz: depois do primeiro delta, vinte tokens re-renderizam só a faixa', async () => {
    const canal = await montarComCanal();

    // O PRIMEIRO delta muda estado da página de verdade (a faixa aparece:
    // `turnoViaCanal`, `streaming`, quem fala, "já há conteúdo").
    act(() => {
      canal.onAgentDelta!('Olá', 'criativo');
    });
    expect(await screen.findByText(/Olá/)).toBeInTheDocument();
    const antes = rendersDaPagina.mock.calls.length;

    act(() => {
      for (let i = 0; i < 20; i++) canal.onAgentDelta!(` t${i}`, 'criativo');
    });

    // A faixa ganhou o texto — o store chegou a quem o desenha…
    expect(await screen.findByText(/t19/)).toBeInTheDocument();
    // …e a página não renderizou NENHUMA vez a mais.
    expect(rendersDaPagina.mock.calls.length).toBe(antes);
  });

  it('uma ferramenta no meio do turno também não re-renderiza a página', async () => {
    const canal = await montarComCanal();
    act(() => {
      canal.onAgentDelta!('Vou registrar a regra', 'criativo');
    });
    await screen.findByText(/Vou registrar a regra/);
    const antes = rendersDaPagina.mock.calls.length;

    act(() => {
      canal.onToolCall!('emit_artifact', 'criativo');
      canal.onAgentDelta!('regra gravada', 'criativo');
    });

    expect(await screen.findByText(/regra gravada/)).toBeInTheDocument();
    expect(rendersDaPagina.mock.calls.length).toBe(antes);
  });

  it('caso de controle: o FIM do turno re-renderiza a página e zera a faixa', async () => {
    const canal = await montarComCanal();
    act(() => {
      canal.onAgentDelta!('texto do turno', 'criativo');
    });
    await screen.findByText(/texto do turno/);
    const antes = rendersDaPagina.mock.calls.length;

    act(() => {
      canal.onAgentDone!();
    });

    // O fim é estado da PÁGINA (a faixa sai, o composer destrava): se o
    // contador não mexesse aqui, a prova acima seria de um espião quebrado.
    await waitFor(() => expect(rendersDaPagina.mock.calls.length).toBeGreaterThan(antes));
    await waitFor(() => expect(screen.queryByText(/texto do turno/)).toBeNull());
  });
});
