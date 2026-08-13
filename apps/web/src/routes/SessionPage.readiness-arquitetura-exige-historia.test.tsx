import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Epic, Session } from '../lib/api-types';

/**
 * RN-160 — mirror de `SessionPage.readiness-exige-regra.test.tsx`, agora para
 * o botão "Confirmar arquitetura pronta" (handoff Arquiteto→Dev Lead): não
 * basta ter regra de negócio capturada, precisa existir pelo menos 1 história
 * já PROMOVIDA (`status !== 'draft'` — RN-048, `PromoteStoriesUseCase` move
 * `draft` para `ready` via `TransitionStoryUseCase`). A fonte é a MESMA que a
 * aba Backlog já usa (`useBacklog`, `ProjectBacklogTab.tsx`), sem round-trip
 * novo.
 */

const getSession = vi.fn();
const confirmArchitectureReadiness = vi.fn();

const ARQUITETO_ATIVO = {
  id: 'ev-arq-ativo',
  seq: 1,
  type: 'agent.activated',
  actor: { kind: 'agent', id: 'arquiteto' },
  payload: { agent: 'arquiteto' },
  createdAt: '2026-08-11T12:00:00.000Z',
};

const eventos = vi.fn<() => { items: unknown[] }>(() => ({
  items: [ARQUITETO_ATIVO],
}));
const backlogMock = vi.fn<() => Epic[] | undefined>(() => []);

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../lib/hooks', () => ({
  useSessionEvents: () => ({ data: eventos(), isPending: false }),
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: { items: [] } }),
  useHandoffs: () => ({ data: [] }),
  useCurrentWorkspaceWithRole: () => ({ data: undefined }),
  useBacklog: () => ({ data: backlogMock() }),
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
    confirmArchitectureReadiness: (...args: unknown[]) =>
      confirmArchitectureReadiness(...args),
    confirmReadiness: vi.fn(),
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
    createdAt: '2026-08-11T12:00:00.000Z',
    updatedAt: '2026-08-11T12:00:00.000Z',
    closedAt: null,
    ...over,
  } as Session;
}

function epico(status: 'draft' | 'ready' | 'in_progress' | 'done'): Epic {
  return {
    id: 'epic-1',
    projectId: 'proj-1',
    title: 'Épico único',
    createdAt: '2026-08-11T12:00:00.000Z',
    stories: [
      {
        id: 'story-1',
        epicId: 'epic-1',
        title: 'História única',
        description: null,
        status,
        proposedReady: false,
        returnedReason: null,
        rf: [],
        rnf: [],
        dor: [],
        dod: [],
        businessRuleIds: [],
        tasks: [],
        createdAt: '2026-08-11T12:00:00.000Z',
      },
    ],
  } as unknown as Epic;
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
  eventos.mockReturnValue({ items: [ARQUITETO_ATIVO] });
  backlogMock.mockReturnValue([]);
  getSession.mockResolvedValue(sessao());
});

describe('SessionPage — "Confirmar arquitetura pronta" exige história promovida (RN-160)', () => {
  it('sem nenhuma história promovida, o botão nasce desabilitado com a dica', async () => {
    backlogMock.mockReturnValue([epico('draft')]);
    montar();

    const botao = await screen.findByRole('button', {
      name: 'Confirmar arquitetura pronta',
    });

    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute(
      'title',
      'Promova pelo menos uma história no Backlog antes de confirmar a arquitetura',
    );
  });

  it('backlog vazio (nenhum épico ainda) também desabilita', async () => {
    backlogMock.mockReturnValue([]);
    montar();

    const botao = await screen.findByRole('button', {
      name: 'Confirmar arquitetura pronta',
    });

    expect(botao).toBeDisabled();
  });

  it('com pelo menos 1 história promovida (ready), o botão libera', async () => {
    backlogMock.mockReturnValue([epico('ready')]);
    montar();

    const botao = await screen.findByRole('button', {
      name: 'Confirmar arquitetura pronta',
    });

    expect(botao).not.toBeDisabled();
    expect(botao).not.toHaveAttribute('title');
  });

  it('história em progresso ou concluída também conta como promovida', async () => {
    backlogMock.mockReturnValue([epico('in_progress')]);
    montar();

    const botao = await screen.findByRole('button', {
      name: 'Confirmar arquitetura pronta',
    });
    expect(botao).not.toBeDisabled();
  });
});
