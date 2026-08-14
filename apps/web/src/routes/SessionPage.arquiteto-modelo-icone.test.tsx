import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Handoff, Session } from '../lib/api-types';

/**
 * Três problemas confirmados por investigação, todos em `SessionPage.tsx`:
 *
 * 1. **Faltava o botão de "prontidão da arquitetura"** — `OfferInfraHandoffUseCase`
 *    (`POST .../agents/arquiteto/handoff-infra`) já existia e já criava os
 *    handoffs de Infra E Dev Lead na mesma confirmação (FASE 14d), mas NENHUM
 *    lugar do frontend chamava o endpoint. `handleArchitectureReadiness`/
 *    `confirmArchitectureReadiness` são o mirror de
 *    `handleReadiness`/`confirmReadiness` (o botão do Criativo).
 * 2. **O nome do modelo não aparecia** — `SessionPage.tsx` mostrava a string
 *    FIXA "modelo" ao lado do nome do agente. Agora lê `event.payload.modelName`,
 *    com fallback para o rótulo genérico em evento GRAVADO antes desta mudança
 *    (sem a chave) ou cuja api não resolveu modelo nenhum (`null`).
 * 3. **Faltava o ícone do agente no cabeçalho do grupo colapsado** — o
 *    `Disclosure` de `timelineAgrupada` recebia só a STRING do nome em
 *    `titulo`. `AvatarDoAgente` reusa a mesma caixa `.avatar` das mensagens
 *    expandidas.
 */

const getSession = vi.fn();
const confirmArchitectureReadiness = vi.fn();

const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));
const handoffsMock = vi.fn<() => Handoff[]>(() => []);
const actionsMock = vi.fn<() => unknown[]>(() => []);

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
  usePendingActions: () => ({ data: { items: actionsMock() } }),
  useHandoffs: () => ({ data: handoffsMock() }),
  useCurrentWorkspaceWithRole: () => ({ data: undefined }),
  // RN-160: gate por história promovida — este arquivo não é sobre o gate em
  // si (ver `SessionPage.readiness-arquitetura-exige-historia.test.tsx`),
  // então nasce com 1 história `ready` pra não quebrar os testes de
  // "caminho feliz"/"clique falha" que já existiam.
  useBacklog: () => ({
    data: [
      {
        id: 'epic-1',
        title: 'Épico',
        stories: [{ id: 'story-1', status: 'ready' }],
      },
    ],
  }),
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
    acceptHandoff: vi.fn(),
    activateExecution: vi.fn(),
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

const ARQUITETO_ATIVO = {
  id: 'ev-arq-ativo',
  seq: 1,
  type: 'agent.activated',
  actor: { kind: 'agent', id: 'arquiteto' },
  payload: { agent: 'arquiteto' },
  createdAt: '2026-08-11T12:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  eventos.mockReturnValue({ items: [] });
  handoffsMock.mockReturnValue([]);
  actionsMock.mockReturnValue([]);
  getSession.mockResolvedValue(sessao());
});

describe('SessionPage — problema 1: confirmar arquitetura pronta', () => {
  it('sem o Arquiteto ativo, o botão não aparece', async () => {
    eventos.mockReturnValue({ items: [] });
    montar();

    await screen.findByText(/Sessão/);
    expect(
      screen.queryByRole('button', { name: 'Confirmar arquitetura pronta' }),
    ).not.toBeInTheDocument();
  });

  it('caminho feliz: com o Arquiteto ativo, o clique chama o endpoint dedicado', async () => {
    eventos.mockReturnValue({ items: [ARQUITETO_ATIVO] });
    confirmArchitectureReadiness.mockResolvedValue({ ok: true });
    montar();

    const botao = await screen.findByRole('button', {
      name: 'Confirmar arquitetura pronta',
    });
    fireEvent.click(botao);

    await waitFor(() => {
      expect(confirmArchitectureReadiness).toHaveBeenCalledWith('proj-1', ID);
    });
  });

  it('falha: mostra um toast de erro e não trava a tela', async () => {
    eventos.mockReturnValue({ items: [ARQUITETO_ATIVO] });
    confirmArchitectureReadiness.mockRejectedValue(new Error('falhou'));
    montar();

    const botao = await screen.findByRole('button', {
      name: 'Confirmar arquitetura pronta',
    });
    fireEvent.click(botao);

    expect(
      await screen.findByText('Não foi possível confirmar a arquitetura'),
    ).toBeInTheDocument();
  });

  it('borda: com a arquitetura já declarada (handoff saindo do Arquiteto), o botão some', async () => {
    eventos.mockReturnValue({ items: [ARQUITETO_ATIVO] });
    handoffsMock.mockReturnValue([
      {
        id: 'handoff-infra',
        sessionId: ID,
        projectId: 'proj-1',
        fromAgent: 'arquiteto',
        toAgent: 'infra',
        artifactId: null,
        status: 'offered',
        createdAt: '2026-08-11T12:00:01.000Z',
        updatedAt: '2026-08-11T12:00:01.000Z',
      },
    ]);
    montar();

    await screen.findByText(/Sessão/);
    expect(
      screen.queryByRole('button', { name: 'Confirmar arquitetura pronta' }),
    ).not.toBeInTheDocument();
  });
});

describe('SessionPage — problema 2: nome do modelo ao lado do agente', () => {
  function respostaDoPo(payload: Record<string, unknown>) {
    return {
      id: 'ev-resp',
      seq: 1,
      type: 'agent.response',
      actor: { kind: 'agent', id: 'po' },
      payload,
      createdAt: '2026-08-11T12:00:00.000Z',
    };
  }

  it('caminho feliz: mostra o nome real do modelo que respondeu', async () => {
    eventos.mockReturnValue({
      items: [respostaDoPo({ content: 'Backlog pronto.', modelName: 'llama3.2:3b' })],
    });
    montar();

    await screen.findByText('Backlog pronto.');
    expect(screen.getByText('llama3.2:3b')).toBeInTheDocument();
    expect(screen.queryByText('modelo')).not.toBeInTheDocument();
  });

  // RN-175: o rótulo de desconhecido deixou de ser a palavra solta "modelo",
  // que se lê como se o modelo se CHAMASSE assim — foi o que o uso real
  // relatou. Ele agora diz que o dado não foi registrado, e a tela nunca
  // adivinha o modelo pelo binding atual do agente: atribuir a uma resposta
  // antiga um modelo que talvez nem existisse quando ela foi gerada seria
  // inventar procedência.
  it('borda: evento GRAVADO antes da RN-146 (sem a chave modelName) diz que o modelo não foi registrado', async () => {
    eventos.mockReturnValue({
      items: [respostaDoPo({ content: 'Resposta antiga' })],
    });
    montar();

    await screen.findByText('Resposta antiga');
    expect(screen.getByText('modelo não registrado')).toBeInTheDocument();
  });

  it('borda: modelName null (turno cuja api não resolveu modelo) também degrada', async () => {
    eventos.mockReturnValue({
      items: [respostaDoPo({ content: 'Resposta sem modelo', modelName: null })],
    });
    montar();

    await screen.findByText('Resposta sem modelo');
    expect(screen.getByText('modelo não registrado')).toBeInTheDocument();
  });
});

describe('SessionPage — problema 3: ícone do agente no cabeçalho do grupo colapsado', () => {
  function respostaDoPo(seq: number, id: string, texto: string) {
    return {
      id,
      seq,
      type: 'agent.response',
      actor: { kind: 'agent', id: 'po' },
      payload: { content: texto },
      createdAt: '2026-08-10T12:00:00.000Z',
    };
  }

  it('o cabeçalho colapsado mostra o ÍCONE do agente, não só o nome', async () => {
    handoffsMock.mockReturnValue([
      {
        id: 'handoff-po-arq',
        sessionId: ID,
        projectId: 'proj-1',
        fromAgent: 'po',
        toAgent: 'arquiteto',
        artifactId: null,
        status: 'accepted',
        createdAt: '2026-08-10T12:00:02.000Z',
        updatedAt: '2026-08-10T12:00:02.000Z',
      },
    ]);
    eventos.mockReturnValue({
      items: [respostaDoPo(1, 'ev-1', 'Primeira'), respostaDoPo(2, 'ev-2', 'Segunda')],
    });

    montar();

    const cabecalho = await screen.findByRole('button', { name: /2 mensagens/ });

    // O `UserIcon` é o ícone do PO no roster (`AGENTS.po.icon`) — a presença
    // do PATH dele (e não só de um `svg` qualquer, como o chevron do
    // Disclosure) prova que é o ícone do AGENTE, não um decorativo genérico.
    const pathDoIconeDoPo = cabecalho.querySelector(
      'path[d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z"]',
    );
    expect(pathDoIconeDoPo).not.toBeNull();

    // O cabeçalho tem pelo menos 2 SVGs: o chevron do Disclosure + o avatar.
    expect(cabecalho.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2);
  });
});
