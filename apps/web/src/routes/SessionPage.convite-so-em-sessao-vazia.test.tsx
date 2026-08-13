import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Session } from '../lib/api-types';

/**
 * RN-131 — dois bugs confirmados por investigação AO VIVO no Chrome, os dois
 * em `conviteVisivel`/`conversaComecou`.
 *
 * A) `conversaComecou` olhava só `chat.message`/`agent.response` — critério
 *    pensado pra não confundir os cards do bootstrap do git com conversa
 *    (achado G). Na prática ele tinha o efeito CONTRÁRIO: uma sessão criada
 *    pelo `git-bootstrap` (ações de commit/branch já aprovadas, zero
 *    `chat.message`) mostrava o convite por cima delas, e o mesmo acontecia
 *    — de forma bem mais grave — na sessão que a ativação de execução usa,
 *    com dezenas de eventos reais (`tool.call`, `tool.result`, eventos de
 *    task) e nenhum `chat.message`/`agent.response`: o convite cobria o
 *    histórico de execução INTEIRO. A pergunta certa é "esta sessão tem
 *    QUALQUER evento" — só a sessão realmente nova não tem nenhum.
 *
 * B) `conviteVisivel` não esperava `useSessionEvents` terminar de carregar.
 *    Em cache frio (reload de página), `session` podia já ter chegado
 *    enquanto `events` ainda era `[]` (o default de `data?.items`) —
 *    indistinguível de "sessão vazia" até o primeiro fetch resolver. Isso
 *    fazia o convite PISCAR por cima de sessões com histórico grande.
 */

const getSession = vi.fn();
/** Controla o retorno de `useSessionEvents`: `data` e `isPending`. */
const useSessionEventsMock = vi.fn<() => { data: { items: unknown[] } | undefined; isPending: boolean }>(
  () => ({ data: { items: [] }, isPending: false }),
);

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../lib/hooks', () => ({
  useSessionEvents: () => useSessionEventsMock(),
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: { items: [] } }),
  useHandoffs: () => ({ data: [] }),
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

beforeEach(() => {
  vi.clearAllMocks();
  useSessionEventsMock.mockReturnValue({ data: { items: [] }, isPending: false });
  getSession.mockResolvedValue(sessao());
});

describe('SessionPage — achado A (RN-131): "existe evento", não "existe mensagem"', () => {
  it('caminho feliz: sessão realmente vazia mostra o convite', async () => {
    montar();
    expect(await screen.findByText('A vez é sua')).toBeInTheDocument();
  });

  it('sessão do git-bootstrap (só eventos de git, zero chat.message) esconde o convite', async () => {
    useSessionEventsMock.mockReturnValue({
      data: {
        items: [
          {
            id: 'e1',
            seq: 1,
            type: 'git.branch_created',
            actor: { kind: 'agent', id: 'infra' },
            payload: { branch: 'dev' },
            createdAt: '2026-08-11T12:00:01.000Z',
          },
          {
            id: 'e2',
            seq: 2,
            type: 'git.commit_created',
            actor: { kind: 'agent', id: 'infra' },
            payload: { sha: 'abc123' },
            createdAt: '2026-08-11T12:00:02.000Z',
          },
        ],
      },
      isPending: false,
    });

    montar();

    await waitFor(() =>
      expect(screen.queryByText('A vez é sua')).not.toBeInTheDocument(),
    );
  });

  it('CASO DE FALHA (o achado mais grave): sessão de execução com dezenas de tool.call/tool.result esconde o convite', async () => {
    const eventosDeExecucao = Array.from({ length: 35 }, (_, i) => ({
      id: `e${i}`,
      seq: i + 1,
      type: i % 2 === 0 ? 'tool.call' : 'tool.result',
      actor: { kind: 'agent', id: 'dev-web' },
      payload: {},
      createdAt: '2026-08-11T12:00:00.000Z',
    }));
    useSessionEventsMock.mockReturnValue({
      data: { items: eventosDeExecucao },
      isPending: false,
    });

    montar();

    // Sem a correção, o convite cobria o histórico de execução inteiro —
    // exatamente o caso mais grave relatado.
    await waitFor(() =>
      expect(screen.queryByText('A vez é sua')).not.toBeInTheDocument(),
    );
  });
});

describe('SessionPage — achado B (RN-131): o convite espera `useSessionEvents` carregar', () => {
  it('caminho feliz: eventsQuery ainda pendente (cache frio) NÃO mostra o convite, mesmo com `events` default vazio', async () => {
    useSessionEventsMock.mockReturnValue({ data: undefined, isPending: true });

    montar();

    // A sessão já chegou (o título aparece), mas o convite não pisca por
    // cima enquanto os eventos ainda não resolveram.
    await screen.findByText('Sessão #a1b2c3d4');
    expect(screen.queryByText('A vez é sua')).not.toBeInTheDocument();
  });

  it('quando a query de eventos resolve vazia de verdade, o convite aparece', async () => {
    useSessionEventsMock.mockReturnValue({ data: undefined, isPending: true });
    const { rerender } = montar();
    await screen.findByText('Sessão #a1b2c3d4');
    expect(screen.queryByText('A vez é sua')).not.toBeInTheDocument();

    useSessionEventsMock.mockReturnValue({ data: { items: [] }, isPending: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <SessionPage projectId="proj-1" sessionId={ID} />
        </ToastProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('A vez é sua')).toBeInTheDocument();
  });
});
