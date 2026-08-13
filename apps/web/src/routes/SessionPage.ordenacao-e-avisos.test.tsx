import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Handoff, ProposedAction, Session } from '../lib/api-types';
import type { SessionChannelHandlers } from '../lib/session-channel';

/**
 * Três problemas confirmados por investigação de código + observação ao vivo,
 * TODOS em `SessionPage.tsx`:
 *
 * 1. **Ordenação da timeline (RN-155, o mais crítico)** — `timeline` misturava
 *    `event.seq` (gapless, POR SESSÃO) com `action.seq` (bigserial ÚNICO e
 *    GLOBAL da tabela `proposed_actions` inteira, contraste DELIBERADO com
 *    `session_events.seq` — ver `apps/api/src/db/schema.ts`) no mesmo
 *    `.sort((a, b) => a.seq - b.seq)`. `ordemDaAcaoNaTimeline` resolve pelo
 *    vínculo real: toda ação criada por `ProposeActionUseCase` grava, na
 *    MESMA transação, um evento `proposed_action.created` com
 *    `payload.actionId` apontando pra ela — o `seq` DESSE evento é o eixo
 *    certo, não o `action.seq` cru.
 * 2. **Texto do indicador de 5s (RN-156)** — "{Agente} está escrevendo…"
 *    virou "Reunindo informações...", frase fixa sem o nome do agente.
 * 3. **Aviso compacto do PO ao criar épico/história (RN-157)** —
 *    `backlog.epic_created`/`backlog.story_created` deixam de virar bolha
 *    completa (`.message`/`.bubble`, avatar 32px) e passam a usar o mesmo
 *    formato de `.handoffDivider`/`.handoffPill` da passagem de bastão,
 *    mantendo o link "Ver no Backlog".
 */

const getSession = vi.fn();
const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));
const acoes = vi.fn<() => ProposedAction[]>(() => []);
const handoffsMock = vi.fn<() => Handoff[]>(() => []);
const acceptHandoff = vi.fn();
let canalHandlers: SessionChannelHandlers | undefined;

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
    className,
  }: {
    to: string;
    params?: Record<string, string>;
    search?: Record<string, unknown>;
    children: ReactNode;
    className?: string;
  }) => {
    const projectId = params?.projectId ?? '';
    const tab = (search as { tab?: string } | undefined)?.tab ?? '';
    const destino = to.replace('$projectId', projectId);
    return (
      <a href={`${destino}?tab=${tab}`} className={className}>
        {children}
      </a>
    );
  },
}));

vi.mock('../lib/hooks', () => ({
  useSessionEvents: () => ({ data: eventos(), isPending: false }),
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: { items: acoes() } }),
  useHandoffs: () => ({ data: handoffsMock() }),
  useCurrentWorkspaceWithRole: () => ({ data: undefined }),
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
  acceptHandoff: (...args: unknown[]) => acceptHandoff(...args),
  approveAction: vi.fn(),
  approveAlwaysAction: vi.fn(),
  denyAction: vi.fn(),
  confirmReadiness: vi.fn(),
  sendAgentMessage: vi.fn(),
  setSessionModelBinding: vi.fn(),
  startAgent: vi.fn(),
  transitionSession: vi.fn(),
}));

const { SessionPage, ordemDaAcaoNaTimeline } = await import('./SessionPage');
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

function acao(over: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'acao-1',
    projectId: 'proj-1',
    sessionId: ID,
    // Global, GRANDE de propósito — é exatamente o valor que o código antigo
    // usava direto pra ordenar, e que a comparação viciava.
    seq: 999_999,
    actionType: 'git_commit',
    payload: {},
    status: 'pending',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'po' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: null,
    createdAt: '2026-08-10T12:00:02.000Z',
    updatedAt: '2026-08-10T12:00:02.000Z',
    ...over,
  } as ProposedAction;
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
  eventos.mockReturnValue({ items: [] });
  acoes.mockReturnValue([]);
  handoffsMock.mockReturnValue([]);
  getSession.mockResolvedValue(sessao());
});

describe('RN-155 — ordemDaAcaoNaTimeline (unidade)', () => {
  const EVENTOS = [
    {
      id: 'ev-1',
      sessionId: ID,
      seq: 1,
      type: 'agent.response',
      actor: { kind: 'agent' as const, id: 'po' },
      payload: { content: 'A' },
      createdAt: '2026-08-10T12:00:00.000Z',
    },
    {
      id: 'ev-2',
      sessionId: ID,
      seq: 2,
      type: 'proposed_action.created',
      actor: { kind: 'agent' as const, id: 'po' },
      payload: { actionId: 'acao-vinculada', actionType: 'git_commit', status: 'pending', resolvedPolicy: 'require_approval' },
      createdAt: '2026-08-10T12:00:01.000Z',
    },
    {
      id: 'ev-3',
      sessionId: ID,
      seq: 3,
      type: 'agent.response',
      actor: { kind: 'agent' as const, id: 'po' },
      payload: { content: 'B' },
      createdAt: '2026-08-10T12:00:02.000Z',
    },
  ];

  it('com vínculo (proposed_action.created com o MESMO actionId): usa o seq DESSE evento, não action.seq', () => {
    const a = acao({ id: 'acao-vinculada', seq: 555_555, createdAt: '2026-08-10T12:00:01.500Z' });
    expect(ordemDaAcaoNaTimeline(a, EVENTOS)).toBe(2);
  });

  it('sem vínculo: degrada pra createdAt, ancorando no último evento anterior', () => {
    const a = acao({ id: 'acao-solta', seq: 1, createdAt: '2026-08-10T12:00:01.500Z' });
    // Entre ev-2 (seq 2, 12:00:01) e ev-3 (seq 3, 12:00:02) — ancora em 2.
    expect(ordemDaAcaoNaTimeline(a, EVENTOS)).toBe(2.5);
  });

  it('sem vínculo e criada ANTES de qualquer evento: ancora em zero', () => {
    const a = acao({ id: 'acao-antes-de-tudo', seq: 1, createdAt: '2026-08-10T11:00:00.000Z' });
    expect(ordemDaAcaoNaTimeline(a, EVENTOS)).toBe(0.5);
  });
});

describe('RN-155 — a timeline inteira, renderizada', () => {
  it('ação PENDENTE proposta NO MEIO do turno aparece na posição certa, mesmo com action.seq global gigante', async () => {
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-1',
          seq: 1,
          type: 'agent.response',
          actor: { kind: 'agent', id: 'po' },
          payload: { content: 'Resposta A' },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
        {
          id: 'ev-2',
          seq: 2,
          type: 'proposed_action.created',
          actor: { kind: 'agent', id: 'po' },
          payload: {
            actionId: 'acao-1',
            actionType: 'git_commit',
            status: 'pending',
            resolvedPolicy: 'require_approval',
          },
          createdAt: '2026-08-10T12:00:01.000Z',
        },
        {
          id: 'ev-3',
          seq: 3,
          type: 'agent.response',
          actor: { kind: 'agent', id: 'po' },
          payload: { content: 'Resposta B' },
          createdAt: '2026-08-10T12:00:02.000Z',
        },
      ],
    });
    // `action.seq` GLOBAL enorme (a tabela inteira do sistema, não desta
    // sessão) — sob a ordenação antiga (`action.seq` cru) o card cairia
    // DEPOIS de "Resposta B". Vinculado a ev-2 via `actionId`, tem que cair
    // ENTRE "Resposta A" e "Resposta B".
    acoes.mockReturnValue([acao({ id: 'acao-1', seq: 999_999 })]);

    const { container } = montar();

    await screen.findByText('Resposta A');
    await screen.findByText('propõe alteração');
    await screen.findByText('Resposta B');

    const texto = container.textContent ?? '';
    const posA = texto.indexOf('Resposta A');
    const posCard = texto.indexOf('propõe alteração');
    const posB = texto.indexOf('Resposta B');

    expect(posA).toBeGreaterThanOrEqual(0);
    expect(posCard).toBeGreaterThan(posA);
    expect(posB).toBeGreaterThan(posCard);
  });

  it('a bolha de streaming/"pensando" continua SEMPRE por último, mesmo com uma ação pendente no meio do turno', async () => {
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-1',
          seq: 1,
          type: 'proposed_action.created',
          actor: { kind: 'agent', id: 'po' },
          payload: {
            actionId: 'acao-1',
            actionType: 'git_commit',
            status: 'pending',
            resolvedPolicy: 'require_approval',
          },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
      ],
    });
    acoes.mockReturnValue([acao({ id: 'acao-1', seq: 42 })]);

    const { container } = montar();

    await waitFor(() => expect(canalHandlers?.onAgentDelta).toBeTypeOf('function'));
    act(() => canalHandlers!.onAgentDelta!('texto chegando ao vivo', 'po'));

    await screen.findByText('propõe alteração');
    await screen.findByText('texto chegando ao vivo');

    const texto = container.textContent ?? '';
    const posCard = texto.indexOf('propõe alteração');
    const posStreaming = texto.indexOf('texto chegando ao vivo');
    expect(posStreaming).toBeGreaterThan(posCard);
  });
});

describe('RN-156 — indicador de 5s', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('depois de 5s sem texto, mostra "Reunindo informações...", sem o nome do agente', async () => {
    // Mesmo gatilho de `SessionPage.pista-e-status.test.tsx` (achado B): o
    // `agent.status` "working" chega pelo canal ANTES de qualquer delta
    // quando o turno nasce de um handoff aceito — é o caminho real que arma
    // o indicador de 5s.
    handoffsMock.mockReturnValue([
      {
        id: 'handoff-1',
        sessionId: ID,
        projectId: 'proj-1',
        fromAgent: 'criativo',
        toAgent: 'po',
        artifactId: 'brief-1',
        status: 'offered',
        createdAt: '2026-08-10T12:00:00.000Z',
        updatedAt: '2026-08-10T12:00:00.000Z',
      },
    ]);
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-1',
          seq: 1,
          type: 'handoff.offered',
          actor: { kind: 'agent', id: 'criativo' },
          payload: { toAgent: 'po' },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
      ],
    });
    let resolverAceite: () => void = () => {};
    acceptHandoff.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolverAceite = () => resolve();
        }),
    );

    montar();

    const botaoAceitar = await screen.findByRole('button', {
      name: 'Aceitar handoff e iniciar po',
    });
    act(() => {
      botaoAceitar.click();
    });

    await waitFor(() => expect(canalHandlers?.onAgentStatus).toBeTypeOf('function'));
    act(() => canalHandlers!.onAgentStatus!({ status: 'working' }));

    expect(screen.queryByText('Reunindo informações...')).not.toBeInTheDocument();
    expect(screen.queryByText(/está escrevendo/)).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.getByText('Reunindo informações...')).toBeInTheDocument();

    resolverAceite();
  });
});

describe('RN-157 — aviso compacto do PO ao criar épico/história', () => {
  it('backlog.epic_created NÃO usa mais bolha/avatar grande, e mantém o link pro Backlog', async () => {
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-epic',
          seq: 1,
          type: 'backlog.epic_created',
          actor: { kind: 'agent', id: 'po' },
          payload: { epicId: 'epic-1', title: 'Autenticação de usuários' },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
      ],
    });

    montar();

    const pill = await screen.findByText('criou o épico "Autenticação de usuários"');
    expect(pill).toBeInTheDocument();

    // O nome do agente continua visível, só que dentro da pílula compacta —
    // não mais num avatar de 32px com cabeçalho próprio.
    expect(screen.getByText('PO')).toBeInTheDocument();

    const link = screen.getByRole('link', { name: /Ver no Backlog/ });
    expect(link).toHaveAttribute('href', '/projects/proj-1?tab=backlog');
  });

  it('backlog.story_created usa o mesmo formato compacto', async () => {
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-story',
          seq: 1,
          type: 'backlog.story_created',
          actor: { kind: 'agent', id: 'po' },
          payload: {
            storyId: 'story-1',
            epicId: 'epic-1',
            title: 'Login com e-mail e senha',
            status: 'draft',
            businessRuleIds: [],
          },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
      ],
    });

    montar();

    expect(
      await screen.findByText('criou a história "Login com e-mail e senha"'),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Ver no Backlog/ });
    expect(link).toHaveAttribute('href', '/projects/proj-1?tab=backlog');
  });
});
