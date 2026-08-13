import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { Handoff } from '../lib/api-types';

/**
 * RN-158 — `agent.response` renderizava texto PURO no fio: `#`/`**`/fence de
 * código apareciam literais na bolha. Confere que a bolha do modelo passa
 * pelo `MarkdownMessage` novo, e que `chat.message` (texto DIGITADO pelo
 * usuário) continua literal — markdown é coisa de saída de LLM, não de
 * entrada humana.
 */

const getSession = vi.fn();
const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));

vi.mock('@tanstack/react-router', () => ({
  Link: () => null,
}));

vi.mock('../lib/hooks', () => ({
  useSessionEvents: () => ({ data: eventos() }),
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: { items: [] } }),
  useHandoffs: () => ({ data: [] as Handoff[] }),
  useCurrentWorkspaceWithRole: () => ({ data: undefined }),
  useBacklog: () => ({ data: [] }),
}));

vi.mock('../lib/chat-stream', () => ({ streamChatMessage: vi.fn() }));

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
  sendAgentMessage: vi.fn(),
  setSessionModelBinding: vi.fn(),
  startAgent: vi.fn(),
  transitionSession: vi.fn(),
}));

const { SessionPage } = await import('./SessionPage');
const { ToastProvider } = await import('../components/ui/ToastProvider');

const ID = 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7';

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
  eventos.mockReturnValue({ items: [] });
  getSession.mockResolvedValue({
    id: ID,
    projectId: 'proj-1',
    createdBy: 'user-1',
    status: 'active',
    kind: 'consultiva',
    name: null,
    nextSeq: 1,
    createdAt: '2026-08-10T12:00:00.000Z',
    updatedAt: '2026-08-10T12:00:00.000Z',
    closedAt: null,
  } as never);
});

describe('SessionPage — Markdown em agent.response (RN-158)', () => {
  it('cabeçalho, negrito e fence de código de `agent.response` viram elementos, não texto cru', async () => {
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-1',
          seq: 1,
          type: 'agent.response',
          actor: { kind: 'agent', id: 'po' },
          payload: { content: '## Plano\n\nPrimeiro, **valide** o schema:\n\n```ts\nconst ok = true;\n```' },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
      ],
    });

    montar();

    expect(await screen.findByRole('heading', { level: 2, name: 'Plano' })).toBeInTheDocument();
    const negrito = screen.getByText('valide');
    expect(negrito.tagName).toBe('STRONG');
    // O fence virou bloco de código com realce (token `const` num span
    // próprio) — nunca a string ```ts\nconst ok = true;\n``` literal.
    expect(screen.queryByText(/```/)).not.toBeInTheDocument();
    expect(screen.getByText('const').tagName).toBe('SPAN');
  });

  it('`chat.message` (texto do USUÁRIO) continua literal — markdown não se aplica à entrada humana', async () => {
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-1',
          seq: 1,
          type: 'chat.message',
          actor: { kind: 'user', id: 'user-1' },
          payload: { text: '# não é cabeçalho, é literal' },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
      ],
    });

    montar();

    expect(await screen.findByText('# não é cabeçalho, é literal')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });
});
