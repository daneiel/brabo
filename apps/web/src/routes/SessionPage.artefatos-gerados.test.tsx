import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { Handoff, ProposedAction, Session } from '../lib/api-types';

/**
 * RN-159 — o painel "Artefatos gerados" (`ContextAside`) hoje só lia
 * `pr_open`, numa lista PLANA, sem dizer quem abriu cada PR e sem
 * épico/história do PO. Este arquivo cobre a amplitude nova: PR de dev + PR
 * de ADR + épico/história, agrupados por AGENTE num `Disclosure` (mesmo
 * padrão de RN-138), com o clique navegando pro destino certo de cada um.
 */

const getSession = vi.fn();
const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));
const actionsMock = vi.fn<() => { items: ProposedAction[] }>(() => ({ items: [] }));
const handoffsMock = vi.fn<() => Handoff[]>(() => []);

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
  useSessionEvents: () => ({ data: eventos() }),
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: actionsMock() }),
  useHandoffs: () => ({ data: handoffsMock() }),
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
    createdAt: '2026-08-10T12:00:00.000Z',
    updatedAt: '2026-08-10T12:00:00.000Z',
    closedAt: null,
    ...over,
  } as Session;
}

function acaoPr(over: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'action-1',
    projectId: 'proj-1',
    sessionId: ID,
    seq: 1,
    actionType: 'pr_open',
    payload: { title: 'feat: rota nova' },
    status: 'executed',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'dev-backend' },
    decidedBy: 'user-1',
    decidedAt: '2026-08-10T12:00:00.000Z',
    rejectionReason: null,
    executionResult: { pullRequestUrl: 'https://github.com/org/repo/pull/9' } as never,
    createdAt: '2026-08-10T12:00:00.000Z',
    updatedAt: '2026-08-10T12:00:00.000Z',
    ...over,
  } as ProposedAction;
}

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

/**
 * A REGIÃO do `Disclosure` "Artefatos gerados" — ele nasce ABERTO
 * (`padraoAberto`, mesmo padrão de "Regras de negócio"), então não há botão
 * pra clicar aqui; só escopar a busca, porque "Nada ainda." e nomes de
 * agente também aparecem nas OUTRAS seções do painel (Regras de negócio,
 * Arquivos tocados) e um `screen.getByText` sem escopo bate em mais de um.
 */
async function regiaoDeArtefatos() {
  const botao = await screen.findByRole('button', { name: /Artefatos gerados/ });
  const id = botao.getAttribute('aria-controls');
  return within(document.getElementById(id!)!);
}

/** Abre o grupo do agente DENTRO da região de artefatos — os grupos, ao
 *  contrário da seção que os contém, nascem FECHADOS (mesmo padrão de
 *  RN-138: um clique extra pra ver o título de cada artefato). */
async function abrirGrupo(nomeDoGrupo: string) {
  const user = userEvent.setup();
  const regiao = await regiaoDeArtefatos();
  await user.click(await regiao.findByRole('button', { name: new RegExp(nomeDoGrupo) }));
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  eventos.mockReturnValue({ items: [] });
  actionsMock.mockReturnValue({ items: [] });
  handoffsMock.mockReturnValue([]);
  getSession.mockResolvedValue(sessao());
});

describe('SessionPage — ContextAside: artefatos gerados agrupados por agente (RN-159)', () => {
  it('sem nenhum artefato: painel some pra "Nada ainda", com contagem zero', async () => {
    montar();
    const regiao = await regiaoDeArtefatos();
    expect(regiao.getByText('Nada ainda.')).toBeInTheDocument();
    expect((await screen.findByRole('button', { name: /Artefatos gerados/ }))).toHaveTextContent('0');
  });

  it('PR de dev (pr_open) aparece sob o AGENTE que a abriu, com link pra PR', async () => {
    actionsMock.mockReturnValue({ items: [acaoPr()] });

    montar();
    await abrirGrupo('Dev Backend');

    const link = screen.getByRole('link', { name: /feat: rota nova/ });
    expect(link).toHaveAttribute('href', 'https://github.com/org/repo/pull/9');
  });

  it('PR de ADR (open_adr_pr) do Arquiteto entra no MESMO painel, em grupo próprio', async () => {
    actionsMock.mockReturnValue({
      items: [
        acaoPr({
          id: 'action-adr',
          actionType: 'open_adr_pr',
          actor: { kind: 'agent', id: 'arquiteto' },
          payload: { title: 'ADR 0070: fila de retry' },
          executionResult: { pullRequestUrl: 'https://github.com/org/repo/pull/70' } as never,
        }),
      ],
    });

    montar();
    await abrirGrupo('Arquiteto');

    const link = screen.getByRole('link', { name: /ADR 0070: fila de retry/ });
    expect(link).toHaveAttribute('href', 'https://github.com/org/repo/pull/70');
  });

  it('épico/história do PO entram no painel, com link pro Backlog (não pra PR)', async () => {
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-epic',
          seq: 1,
          type: 'backlog.epic_created',
          actor: { kind: 'agent', id: 'po' },
          payload: { epicId: 'epic-1', title: 'Autenticação' },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
        {
          id: 'ev-story',
          seq: 2,
          type: 'backlog.story_created',
          actor: { kind: 'agent', id: 'po' },
          payload: { storyId: 'story-1', epicId: 'epic-1', title: 'Login com e-mail' },
          createdAt: '2026-08-10T12:00:01.000Z',
        },
      ],
    });

    montar();
    await abrirGrupo('PO');

    const linkEpic = screen.getByRole('link', { name: /Autenticação/ });
    expect(linkEpic).toHaveAttribute('href', '/projects/proj-1?tab=backlog');
    const linkStory = screen.getByRole('link', { name: /Login com e-mail/ });
    expect(linkStory).toHaveAttribute('href', '/projects/proj-1?tab=backlog');
  });

  it('dois artefatos do MESMO agente ficam sob UM grupo só, com a contagem certa', async () => {
    actionsMock.mockReturnValue({
      items: [
        acaoPr({ id: 'action-1', payload: { title: 'feat: um' } }),
        acaoPr({ id: 'action-2', payload: { title: 'feat: dois' } }),
      ],
    });

    montar();
    const regiao = await regiaoDeArtefatos();
    const botaoGrupo = await regiao.findByRole('button', { name: /Dev Backend/ });
    expect(within(botaoGrupo).getByText('2')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(botaoGrupo);
    expect(regiao.getByRole('link', { name: /feat: um/ })).toBeInTheDocument();
    expect(regiao.getByRole('link', { name: /feat: dois/ })).toBeInTheDocument();
  });

  it('agentes DIFERENTES viram grupos SEPARADOS', async () => {
    actionsMock.mockReturnValue({
      items: [
        acaoPr({ id: 'action-1', actor: { kind: 'agent', id: 'dev-backend' }, payload: { title: 'feat: back' } }),
        acaoPr({ id: 'action-2', actor: { kind: 'agent', id: 'dev-frontend' }, payload: { title: 'feat: front' } }),
      ],
    });

    montar();
    const regiao = await regiaoDeArtefatos();

    expect(await regiao.findByRole('button', { name: /Dev Backend/ })).toBeInTheDocument();
    expect(regiao.getByRole('button', { name: /Dev Frontend/ })).toBeInTheDocument();
  });

  it('PR sem `pullRequestUrl` ainda (execução pendente) aparece sem virar link', async () => {
    actionsMock.mockReturnValue({
      items: [acaoPr({ status: 'pending', executionResult: null })],
    });

    montar();
    await abrirGrupo('Dev Backend');
    const regiao = await regiaoDeArtefatos();

    expect(regiao.getByText('feat: rota nova')).toBeInTheDocument();
    expect(regiao.queryByRole('link', { name: /feat: rota nova/ })).not.toBeInTheDocument();
  });
});
