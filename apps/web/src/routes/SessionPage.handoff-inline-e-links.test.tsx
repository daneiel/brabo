import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Handoff, Session } from '../lib/api-types';
import { historicoFalso } from '../test/historico-de-eventos';

/**
 * Última frente da onda de feedback sobre `SessionPage.tsx` (timeline de
 * mensagens + card de handoff), TRÊS itens que colidiriam se fossem agentes
 * separados:
 *
 * 1. **Aceite de handoff INLINE no fio** (RN-125) — o divisor
 *    "X passou o bastão ao Y" vira CARD acionável quando representa a oferta
 *    PENDENTE atual, com o botão embutido. O botão da TOPBAR saiu: os dois
 *    visíveis ao mesmo tempo duplicariam o mesmo texto na tela.
 * 2. **Link do PO pras histórias criadas** (RN-124) — `backlog.epic_created`/
 *    `backlog.story_created` ganham chip no fio, com link pra aba Backlog.
 * 3. **CTA de handoff pro Dev Lead** (RN-125) — o MESMO card do item 1 ganha
 *    um link extra pra aba Executores quando `toAgent === 'dev-lead'`.
 */

const getSession = vi.fn();
const acceptHandoff = vi.fn();

const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));
const handoffsMock = vi.fn<() => Handoff[]>(() => []);

// `Link` captura `to`/`params`/`search` explicitamente (em vez de espalhar
// tudo num `<a>`, que geraria warning de prop desconhecida) — o `href`
// codifica os três, o suficiente para os testes afirmarem o DESTINO.
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
  useSessionEventHistory: () => historicoFalso(eventos().items),
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: { items: [] } }),
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
  acceptHandoff: (...args: unknown[]) => acceptHandoff(...args),
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
  eventos.mockReturnValue({ items: [] });
  handoffsMock.mockReturnValue([]);
  getSession.mockResolvedValue(sessao());
});

describe('SessionPage — item 1: aceite de handoff inline no fio', () => {
  const HANDOFF_PO: Handoff = {
    id: 'handoff-po',
    sessionId: ID,
    projectId: 'proj-1',
    fromAgent: 'criativo',
    toAgent: 'po',
    artifactId: 'brief-1',
    status: 'offered',
    createdAt: '2026-08-10T12:00:00.000Z',
    updatedAt: '2026-08-10T12:00:00.000Z',
  };

  it('o divisor de handoff vira card com o botão embutido, e a topbar não duplica o botão', async () => {
    handoffsMock.mockReturnValue([HANDOFF_PO]);
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

    montar();

    // A frase de passagem de bastão continua no fio...
    expect(await screen.findByText('passou o bastão ao')).toBeInTheDocument();

    // ...e o botão de aceitar existe UMA VEZ SÓ (não duplicado com a topbar).
    const botoes = await screen.findAllByRole('button', {
      name: 'Aceitar handoff e iniciar po',
    });
    expect(botoes).toHaveLength(1);

    fireEvent.click(botoes[0]);
    expect(acceptHandoff).toHaveBeenCalledWith('proj-1', ID, 'handoff-po');
  });

  it('um handoff.offered ANTIGO (já resolvido) continua como divisor mudo, sem botão', async () => {
    // Duas ofertas pro MESMO par fromAgent/toAgent: a atual é a de seq maior.
    handoffsMock.mockReturnValue([HANDOFF_PO]);
    eventos.mockReturnValue({
      items: [
        {
          id: 'ev-antigo',
          seq: 1,
          type: 'handoff.offered',
          actor: { kind: 'agent', id: 'criativo' },
          payload: { toAgent: 'po' },
          createdAt: '2026-08-10T11:00:00.000Z',
        },
        {
          id: 'ev-atual',
          seq: 2,
          type: 'handoff.offered',
          actor: { kind: 'agent', id: 'criativo' },
          payload: { toAgent: 'po' },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
      ],
    });

    montar();

    const divisores = await screen.findAllByText('passou o bastão ao');
    expect(divisores).toHaveLength(2);

    // Só UM botão — o da oferta mais recente.
    const botoes = await screen.findAllByRole('button', {
      name: 'Aceitar handoff e iniciar po',
    });
    expect(botoes).toHaveLength(1);
  });

  it('sem oferta pendente (handoff já aceito), nenhum botão aparece', async () => {
    handoffsMock.mockReturnValue([{ ...HANDOFF_PO, status: 'accepted' }]);
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
        {
          id: 'ev-2',
          seq: 2,
          type: 'agent.activated',
          actor: { kind: 'agent', id: 'po' },
          payload: { agent: 'po' },
          createdAt: '2026-08-10T12:00:01.000Z',
        },
      ],
    });

    montar();

    await screen.findByText('passou o bastão ao');
    expect(
      screen.queryByRole('button', { name: /Aceitar handoff/ }),
    ).not.toBeInTheDocument();
  });
});

describe('SessionPage — item 3: CTA de handoff pro Dev Lead aponta pra Executores', () => {
  it('handoff pro dev-lead ganha o link "Acompanhe a execução em Executores" dentro do MESMO card', async () => {
    handoffsMock.mockReturnValue([
      {
        id: 'handoff-devlead',
        sessionId: ID,
        projectId: 'proj-1',
        fromAgent: 'arquiteto',
        toAgent: 'dev-lead',
        artifactId: null,
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
          actor: { kind: 'agent', id: 'arquiteto' },
          payload: { toAgent: 'dev-lead' },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
      ],
    });

    montar();

    expect(
      await screen.findByRole('button', { name: 'Aceitar handoff e iniciar dev-lead' }),
    ).toBeInTheDocument();

    const link = screen.getByRole('link', {
      name: /Acompanhe a execução em Executores/,
    });
    expect(link).toHaveAttribute('href', '/projects/proj-1?tab=executores');
  });

  it('handoff pra outro agente (ex.: po) NÃO ganha o link de Executores', async () => {
    handoffsMock.mockReturnValue([
      {
        id: 'handoff-po',
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

    montar();

    await screen.findByRole('button', { name: 'Aceitar handoff e iniciar po' });
    expect(
      screen.queryByRole('link', { name: /Acompanhe a execução em Executores/ }),
    ).not.toBeInTheDocument();
  });
});

describe('SessionPage — item 2: link do PO pras histórias criadas, direto pro Backlog', () => {
  it('backlog.epic_created mostra o título e um link pro Backlog', async () => {
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

    // RN-157: aviso COMPACTO (pill), não bolha grande — o verbo e o título
    // vivem na mesma frase.
    expect(
      await screen.findByText('criou o épico "Autenticação de usuários"'),
    ).toBeInTheDocument();

    const link = screen.getByRole('link', { name: /Ver no Backlog/ });
    expect(link).toHaveAttribute('href', '/projects/proj-1?tab=backlog');
  });

  it('backlog.story_created mostra o título e um link pro Backlog', async () => {
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

    // RN-157: mesmo formato compacto do épico, com o verbo próprio de história.
    expect(
      await screen.findByText('criou a história "Login com e-mail e senha"'),
    ).toBeInTheDocument();

    const link = screen.getByRole('link', { name: /Ver no Backlog/ });
    expect(link).toHaveAttribute('href', '/projects/proj-1?tab=backlog');
  });
});
