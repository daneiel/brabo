import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Epic, Session } from '../lib/api-types';
import { historicoFalso } from '../test/historico-de-eventos';
// Instância REAL do app (mesmo padrão de SessionPage.arquiteto-modelo-icone.test.tsx):
// as asserções abaixo esperam texto em pt-BR, e `en` é o idioma DEFAULT.
import i18n from '../lib/i18n';

/**
 * RN-824 (AT-491) — com o mapa de módulos gravado, o composer DIZ em texto
 * visível que o próximo passo é "Confirmar arquitetura pronta". Base copiada
 * de `SessionPage.readiness-arquitetura-exige-historia.test.tsx`.
 *
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
const handoffsMock = vi.fn<() => unknown[]>(() => []);
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
  useSessionEventHistory: () => historicoFalso(eventos().items),
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: { items: [] } }),
  useHandoffs: () => ({ data: handoffsMock() }),
  useCurrentWorkspaceWithRole: () => ({ data: undefined }),
  useBacklog: () => ({ data: backlogMock() }),
}));

vi.mock('../lib/chat-stream', () => ({ streamChatMessage: vi.fn() }));
vi.mock('../lib/session-channel', () => ({
  connectSessionHeartbeat: () => () => undefined,
}));
vi.mock('../lib/auth', () => ({
  emailDaSessao: () => 'eu@brabo.dev',
  userIdDaSessao: () => 'eu',
}));

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

const { SessionComposer } = await import('./SessionComposer');
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

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('pt-BR');
  eventos.mockReturnValue({ items: [ARQUITETO_ATIVO] });
  backlogMock.mockReturnValue([]);
  handoffsMock.mockReturnValue([]);
  getSession.mockResolvedValue(sessao());
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

const MAPA = {
  id: 'ev-mapa',
  seq: 2,
  type: 'artifact.module_map',
  actor: { kind: 'agent', id: 'arquiteto' },
  payload: { modules: [] },
  createdAt: '2026-08-11T12:01:00.000Z',
};

const PROXIMO =
  'A arquitetura está pronta? Confirme para o sistema oferecer a Infra, que sobe o container do projeto.';
const MOTIVO =
  'Promova pelo menos uma história na aba Histórias antes de confirmar a arquitetura';

describe('SessionPage — próximo passo depois do mapa de módulos (RN-824)', () => {
  it('mapa gravado + história promovida + Arquiteto parado: o texto aparece', async () => {
    eventos.mockReturnValue({ items: [ARQUITETO_ATIVO, MAPA] });
    backlogMock.mockReturnValue([epico('ready')]);
    montar();
    const aviso = await screen.findByTestId('proximo-passo-arquitetura');
    expect(aviso).toHaveTextContent(PROXIMO);
  });

  it('sem história promovida, o motivo vem em texto visível', async () => {
    eventos.mockReturnValue({ items: [ARQUITETO_ATIVO, MAPA] });
    backlogMock.mockReturnValue([epico('draft')]);
    montar();
    const aviso = await screen.findByTestId('proximo-passo-arquitetura');
    expect(aviso).toHaveTextContent(MOTIVO);
  });

  it('sem mapa de módulos, nada é dito', async () => {
    backlogMock.mockReturnValue([epico('ready')]);
    montar();
    await screen.findByRole('button', { name: 'Confirmar arquitetura pronta' });
    expect(screen.queryByTestId('proximo-passo-arquitetura')).toBeNull();
  });

  it('com o handoff do Arquiteto já oferecido, o texto some', async () => {
    eventos.mockReturnValue({ items: [ARQUITETO_ATIVO, MAPA] });
    backlogMock.mockReturnValue([epico('ready')]);
    handoffsMock.mockReturnValue([
      {
        id: 'h-1',
        sessionId: ID,
        fromAgent: 'arquiteto',
        toAgent: 'infra',
        status: 'offered',
        offerEventId: 'ev-offer',
        createdAt: '2026-08-11T12:02:00.000Z',
      },
    ]);
    montar();
    await screen.findAllByRole('textbox');
    expect(screen.queryByTestId('proximo-passo-arquitetura')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirmar arquitetura pronta' })).toBeNull();
  });

  it('com turno em curso (streaming), o texto não aparece', () => {
    const noop = async () => undefined;
    render(
      // RN-861: o composer lê a fila de perguntas em aberto (react-query).
      <QueryClientProvider client={new QueryClient()}>
      <SessionComposer
        {...({
          isActive: true,
          opcoesDeDestinatario: [],
          destinatario: 'arquiteto',
          precisaEscolherDestinatario: false,
          escolherDestinatario: () => undefined,
          manualHandoffTarget: '',
          setManualHandoffTarget: () => undefined,
          enviandoHandoffManual: false,
          activeFor: () => true,
          handleRequestManualHandoff: noop,
          session: sessao(),
          draft: '',
          setDraft: () => undefined,
          handleComposerKeyDown: () => undefined,
          streaming: true,
          podeEnfileirar: true,
          handleSend: noop,
          handleCancel: noop,
          criativoActive: false,
          prontidaoJaDeclarada: false,
          handleReadiness: noop,
          hasBusinessRule: true,
          arquitetoActive: true,
          arquiteturaJaDeclarada: false,
          handleArchitectureReadiness: noop,
          hasPromotedStory: true,
          hasModuleMap: true,
          handleActivate: noop,
          handoffDaInfraOferecido: undefined,
          handleAcceptHandoff: noop,
        } as unknown as Parameters<typeof SessionComposer>[0])}
      />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId('proximo-passo-arquitetura')).toBeNull();
  });
});
