import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Session } from '../lib/api-types';
import { historicoFalso } from '../test/historico-de-eventos';
// Instância REAL do app (mesmo padrão de SessionPage.arquiteto-modelo-icone.test.tsx):
// as asserções abaixo esperam texto em pt-BR, e `en` é o idioma DEFAULT.
import i18n from '../lib/i18n';

/**
 * RN-406 — mirror de `SessionPage.readiness-arquitetura-exige-historia.test.tsx`,
 * agora para o botão "Confirmar necessidade validada" (gate
 * `necessidade-validada`, Criativo → PO): só habilita depois que o
 * `product_brief` já existe (consolidado por `confirm_readiness`) e some
 * assim que a necessidade já foi validada.
 */

const getSession = vi.fn();
const validateNecessity = vi.fn();

const CRIATIVO_ATIVO = {
  id: 'ev-criativo-ativo',
  seq: 1,
  type: 'agent.activated',
  actor: { kind: 'agent', id: 'criativo' },
  payload: { agent: 'criativo' },
  createdAt: '2026-08-17T12:00:00.000Z',
};

const PRODUCT_BRIEF = {
  id: 'ev-product-brief',
  seq: 2,
  type: 'artifact.product_brief',
  actor: { kind: 'agent', id: 'criativo' },
  payload: { title: 'Product Brief', summary: 'resumo', rules: [] },
  createdAt: '2026-08-17T12:01:00.000Z',
};

const NECESSIDADE_VALIDADA = {
  id: 'ev-necessidade-validada',
  seq: 3,
  type: 'necessity.validated',
  actor: { kind: 'user', id: 'user-1' },
  payload: { productBriefId: 'ev-product-brief' },
  createdAt: '2026-08-17T12:02:00.000Z',
};

const eventos = vi.fn<() => { items: unknown[] }>(() => ({
  items: [CRIATIVO_ATIVO],
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../lib/hooks', () => ({
  useSessionEvents: () => ({ data: eventos(), isPending: false }),
  useSessionEventHistory: () => historicoFalso(eventos().items),
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: { items: [] } }),
  useHandoffs: () => ({ data: [] }),
  useCurrentWorkspaceWithRole: () => ({ data: undefined }),
  useBacklog: () => ({ data: [] }),
}));

vi.mock('../lib/chat-stream', () => ({ streamChatMessage: vi.fn() }));
vi.mock('../lib/session-channel', () => ({
  connectSessionHeartbeat: () => () => undefined,
}));
vi.mock('../lib/auth', () => ({ emailDaSessao: () => 'eu@brabo.dev' }));

vi.mock('../lib/api-client', async () => {
  const real =
    await vi.importActual<typeof import('../lib/api-client')>('../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getProject: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'core' }),
    getSession: (...args: unknown[]) => getSession(...args),
    getSessionBudget: vi.fn().mockResolvedValue(null),
    getSessionModelBinding: vi.fn().mockResolvedValue(null),
    listModels: vi.fn().mockResolvedValue(null),
    renameSession: vi.fn(),
    activateExecution: vi.fn(),
    cancelAgentTurn: vi.fn(),
    acceptHandoff: vi.fn(),
    approveAction: vi.fn(),
    approveAlwaysAction: vi.fn(),
    confirmArchitectureReadiness: vi.fn(),
    confirmReadiness: vi.fn(),
    validateNecessity: (...args: unknown[]) => validateNecessity(...args),
    denyAction: vi.fn(),
    promoteStories: vi.fn(),
    returnStory: vi.fn(),
    sendAgentMessage: vi.fn(),
    setSessionModelBinding: vi.fn(),
    startAgent: vi.fn(),
    transitionSession: vi.fn(),
  };
});

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
    createdAt: '2026-08-17T12:00:00.000Z',
    updatedAt: '2026-08-17T12:00:00.000Z',
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
  eventos.mockReturnValue({ items: [CRIATIVO_ATIVO] });
  getSession.mockResolvedValue(sessao());
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

describe('SessionPage — "Confirmar necessidade validada" (RN-406)', () => {
  it('sem product_brief ainda, o botão nasce desabilitado com a dica', async () => {
    eventos.mockReturnValue({ items: [CRIATIVO_ATIVO] });
    montar();

    const botao = await screen.findByRole('button', {
      name: 'Confirmar necessidade validada',
    });

    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute(
      'title',
      'Confirme "Estou pronto para produzir" com o Criativo antes de validar a necessidade',
    );
  });

  it('com o product_brief consolidado, o botão libera', async () => {
    eventos.mockReturnValue({ items: [CRIATIVO_ATIVO, PRODUCT_BRIEF] });
    montar();

    const botao = await screen.findByRole('button', {
      name: 'Confirmar necessidade validada',
    });

    expect(botao).not.toBeDisabled();
    expect(botao).not.toHaveAttribute('title');
  });

  it('já validada, o botão some da tela', async () => {
    eventos.mockReturnValue({
      items: [CRIATIVO_ATIVO, PRODUCT_BRIEF, NECESSIDADE_VALIDADA],
    });
    montar();

    // Espera a tela assentar (algum outro elemento do composer) antes de
    // afirmar ausência — senão o "não encontrado" pode só ser "ainda não
    // renderizou".
    await screen.findByRole('button', { name: 'Enviar' });

    expect(
      screen.queryByRole('button', { name: 'Confirmar necessidade validada' }),
    ).not.toBeInTheDocument();
  });
});
