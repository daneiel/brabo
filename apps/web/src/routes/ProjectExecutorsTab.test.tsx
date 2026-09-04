import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { ProjectExecutorsTab } from './ProjectExecutorsTab';
import { ToastProvider } from '../components/ui/ToastProvider';
import { ApiError } from '../lib/api-client';
// A instância REAL do app (não uma isolada como `AccountPage.test.tsx`
// usa): `agent-status.ts` (não-React) resolve `breakerReasonFor`/
// `subagentOutcomeLabel` chamando `i18n.t(...)` direto no singleton
// global de `lib/i18n.ts` — uma instância isolada só neste teste não
// alcançaria essas duas chamadas, que ficariam sempre no idioma default
// real do app. `changeLanguage('pt-BR')` cobre os dois caminhos (hook e
// chamada direta) de uma vez, porque são a MESMA instância.
import i18n from '../lib/i18n';
import type {
  Architecture,
  Handoff,
  ProjectCardSummary,
  Session,
  SessionEvent,
} from '../lib/api-types';

// `Link` sem router de verdade — mesmo padrão de `ProjectInsightsTab.test.tsx`:
// os testes aqui não navegam, só conferem que o rótulo da sessão aparece.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

const getActiveExecutionSession = vi.fn();
const listSessionEvents = vi.fn();
const listHandoffs = vi.fn();
const listActions = vi.fn();
const getArchitecture = vi.fn();
const getSessionTokenUsage = vi.fn();
const listModels = vi.fn();
const getAgentModelBinding = vi.fn();
const listAgentAutonomy = vi.fn();
const listWorkspaces = vi.fn();
const getProjectsSummary = vi.fn();

vi.mock('../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../lib/api-client')>('../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getActiveExecutionSession: (...args: unknown[]) => getActiveExecutionSession(...args),
    listSessionEvents: (...args: unknown[]) => listSessionEvents(...args),
    listHandoffs: (...args: unknown[]) => listHandoffs(...args),
    listActions: (...args: unknown[]) => listActions(...args),
    getArchitecture: (...args: unknown[]) => getArchitecture(...args),
    getSessionTokenUsage: (...args: unknown[]) => getSessionTokenUsage(...args),
    listModels: (...args: unknown[]) => listModels(...args),
    getAgentModelBinding: (...args: unknown[]) => getAgentModelBinding(...args),
    listAgentAutonomy: (...args: unknown[]) => listAgentAutonomy(...args),
    listWorkspaces: (...args: unknown[]) => listWorkspaces(...args),
    getProjectsSummary: (...args: unknown[]) => getProjectsSummary(...args),
    rearmDevAgent: vi.fn(),
    setAgentAutonomy: vi.fn(),
  };
});

const SESSAO: Session = {
  id: 'sess-1',
  projectId: 'proj-1',
  createdBy: 'user-1',
  // `created`, não `active`: mantém o heartbeat do socket desligado neste
  // teste (a conexão real com o engine não existe aqui).
  status: 'created',
  kind: 'criativa',
  name: null,
  nextSeq: 10,
  createdAt: '2026-08-10T10:00:00.000Z',
  updatedAt: '2026-08-10T10:00:00.000Z',
  closedAt: null,
};

const ARQUITETURA: Architecture = {
  moduleMap: {
    id: 'mm-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    version: 1,
    modules: [{ name: 'Backend', stack: 'NestJS', responsibility: 'API', dependsOn: [] }],
    createdAt: '2026-08-10T10:00:00.000Z',
  },
  adrs: [],
  pendencies: [],
  c4Diagram: { status: 'sem_diagrama', diagrama: null, version: 0, eventId: null, createdAt: null },
};

const HANDOFF_INFRA: Handoff = {
  id: 'h-1',
  sessionId: 'sess-1',
  projectId: 'proj-1',
  fromAgent: 'arquiteto',
  toAgent: 'infra',
  artifactId: null,
  status: 'accepted',
  createdAt: '2026-08-10T10:00:00.000Z',
  updatedAt: '2026-08-10T10:00:00.000Z',
};

function evento(over: Partial<SessionEvent>): SessionEvent {
  return {
    id: 'evt',
    sessionId: 'sess-1',
    seq: 1,
    type: 'agent.status',
    actor: { kind: 'agent', id: 'criativo' },
    payload: {},
    createdAt: '2026-08-10T10:00:00.000Z',
    ...over,
  };
}

// Roster mista: Criativo (conversacional, sem área), Infra (handoff aceito,
// sem área ligada a executor), dev-backend (módulo ativado) e QA + o membro
// qa-automacao (delegação registrada). É exatamente a mistura que a Visão
// geral mostrava antes da FASE 27 — dev/QA de um lado, o resto do outro.
const EVENTOS: SessionEvent[] = [
  evento({ id: 'e1', seq: 1, type: 'agent.status', actor: { kind: 'agent', id: 'criativo' }, payload: { status: 'working' } }),
  evento({ id: 'e2', seq: 2, type: 'execution.activated', actor: { kind: 'system', id: 'system' }, payload: {} }),
  evento({
    id: 'e3',
    seq: 3,
    type: 'dev.started',
    actor: { kind: 'agent', id: 'dev-backend' },
    payload: { agentId: 'dev-backend', module: 'Backend' },
  }),
  evento({
    id: 'e4',
    seq: 4,
    type: 'pr.gate_changed',
    actor: { kind: 'system', id: 'system' },
    payload: { gateStatus: 'awaiting_qa' },
  }),
  evento({
    id: 'e5',
    seq: 5,
    type: 'delegation.completed',
    actor: { kind: 'agent', id: 'qa' },
    payload: {
      delegationId: 'd-1',
      taskId: null,
      area: 'qa',
      subagent: 'qa-automacao',
      parecerArtifactId: null,
      failureOrigin: null,
      failureReason: null,
      justification: null,
    },
  }),
];

// `roster.executionActivated` do resumo agregado (RN-090) — a fonte que a
// aba passou a usar em vez de `events.some(...)`. `true` por padrão para
// bater com o `execution.activated` que já vivia na fixture EVENTOS.
function resumo(over: Partial<ProjectCardSummary['roster']> = {}): ProjectCardSummary {
  return {
    projectId: 'proj-1',
    provider: 'github',
    provisioningStatus: 'provisioned',
    budget: null,
    latestSessionId: 'sess-1',
    latestSeq: 10,
    lastEvent: null,
    storiesAwaitingPromotion: 0,
    pendingApprovalsCount: 0,
    onlineAgentCount: 0,
    roster: {
      executionActivated: true,
      moduleNames: ['Backend'],
      gatesEverOpened: true,
      delegatedSubagents: [],
      infraActive: false,
      uxDesignerActive: false,
      staffActive: false,
      ...over,
    },
  };
}

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ProjectExecutorsTab projectId="proj-1" />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('pt-BR');
  getActiveExecutionSession.mockResolvedValue(SESSAO);
  listSessionEvents.mockResolvedValue({ items: EVENTOS, nextCursor: null });
  listHandoffs.mockResolvedValue([HANDOFF_INFRA]);
  listActions.mockResolvedValue({ items: [], nextCursor: null });
  getArchitecture.mockResolvedValue(ARQUITETURA);
  getSessionTokenUsage.mockResolvedValue([]);
  listModels.mockResolvedValue({ local: {}, cloud: {} });
  getAgentModelBinding.mockResolvedValue(null);
  listAgentAutonomy.mockResolvedValue([]);
  listWorkspaces.mockResolvedValue([
    {
      workspace: {
        id: 'ws-1',
        name: 'Workspace',
        slug: 'workspace',
        createdBy: 'user-1',
        createdAt: '2026-08-10T10:00:00.000Z',
        updatedAt: '2026-08-10T10:00:00.000Z',
      },
      role: 'owner',
    },
  ]);
  getProjectsSummary.mockResolvedValue([resumo()]);
});

// Restaura o default do app depois deste arquivo — a instância é o
// singleton REAL (`../lib/i18n`), então deixar em `pt-BR` vazaria para
// qualquer teste seguinte que compartilhe o mesmo registro de módulos.
afterAll(() => {
  void i18n.changeLanguage('en');
});

describe('ProjectExecutorsTab (FASE 27 — RN-121)', () => {
  it('mostra só dev agent e QA (lead + subespecialidade), nunca o resto do time', async () => {
    montar();

    expect(await screen.findByText('dev-backend')).toBeInTheDocument();
    // "QA" aparece duas vezes de propósito (o card do lead E o ramo da
    // árvore, que reusa o mesmo rótulo) — `getAllByText` prova que o lead
    // está lá sem fixar QUANTAS vezes o nome se repete na tela.
    expect(screen.getAllByText('QA').length).toBeGreaterThan(0);
    expect(screen.getByText('QA de Automação')).toBeInTheDocument();

    // Criativo, SecOps (o `pr.gate_changed` da fixture traz os dois, QA e
    // SecOps, juntos — Fase 4a) e Infra estão na sessão, mas não são
    // executores — não podem aparecer aqui.
    expect(screen.queryByText('Criativo')).not.toBeInTheDocument();
    expect(screen.queryByText('SecOps')).not.toBeInTheDocument();
    expect(screen.queryByText('Infra')).not.toBeInTheDocument();
  });

  it('a contagem do cabeçalho conta só os executores', async () => {
    montar();

    await screen.findByText('dev-backend');
    // dev-backend + qa (lead) + qa-automacao (membro) = 3 agentes.
    expect(screen.getByText(/3 agentes/)).toBeInTheDocument();
  });

  it('sem dev/QA na sessão, mostra o estado vazio em vez de grid em branco', async () => {
    listSessionEvents.mockResolvedValue({
      items: [EVENTOS[0]], // só o agent.status do Criativo
      nextCursor: null,
    });
    // Sem o resumo dizendo `executionActivated`/`gatesEverOpened`, o
    // dev-backend (via moduleMap) e QA (via gate) não entrariam na roster.
    getProjectsSummary.mockResolvedValue([
      resumo({ executionActivated: false, gatesEverOpened: false }),
    ]);

    montar();

    expect(
      await screen.findByText(/Nenhum dev agent ou QA entrou em ação nesta sessão ainda/),
    ).toBeInTheDocument();
  });
});

describe('ProjectExecutorsTab — sessão de execução (RN-139)', () => {
  it('mostra a sessão de execução vigente, mesmo com sessão mais recente existindo no projeto', async () => {
    // A aba não lista as sessões do projeto NEM escolhe a mais recente — ela
    // só confia no que `getActiveExecutionSession` devolve (o mesmo critério
    // que `ActivateExecutionUseCase` usa no backend: `active` com
    // `execution.activated` gravado). Uma sessão mais nova, consultiva ou
    // criativa sem execução, nunca entra na jogada — não há sequer uma
    // chamada a `listSessions` para ela poder vencer por `createdAt`.
    montar();

    expect(await screen.findByText('dev-backend')).toBeInTheDocument();
    expect(listSessionEvents).toHaveBeenCalledWith(
      'proj-1',
      'sess-1',
      expect.anything(),
    );
    // O indicador mostra a hashtag da sessão de execução — sem nome nesta
    // fixture, degrada para ela sozinha (RN-098).
    expect(screen.getByText('#sess-1')).toBeInTheDocument();
  });

  it('sem execução ativa, diz isso explicitamente — nunca um grid em branco', async () => {
    getActiveExecutionSession.mockResolvedValue(null);

    montar();

    expect(
      await screen.findByText('Nenhuma execução ativa neste projeto no momento.'),
    ).toBeInTheDocument();
    // Sem sessão, a aba não deve nem tentar buscar eventos/roster: o estado
    // vazio da RN-088 é "não pergunte a pergunta seguinte", não "pergunte e
    // finja que a resposta não importa".
    await waitFor(() => expect(listSessionEvents).not.toHaveBeenCalled());
    expect(screen.queryByText('dev-backend')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Nenhum dev agent ou QA entrou em ação nesta sessão ainda/),
    ).not.toBeInTheDocument();
  });

  it('erro de rede ao descobrir a sessão vira alerta com a frase da api, nunca tela em branco', async () => {
    getActiveExecutionSession.mockRejectedValue(
      new ApiError(429, { message: 'Limite de requisições excedido.' }, 'trace-exec-1'),
    );

    montar();

    expect(
      await screen.findByText('Não foi possível descobrir a sessão de execução deste projeto.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Limite de requisições excedido.')).toBeInTheDocument();
    expect(screen.getByText(/trace-exec-1/)).toBeInTheDocument();
    // Nem o estado vazio nem o grid aparecem por cima do erro — o `if
    // (!dado) return null` que a RN-088 proíbe colapsaria os três num só.
    expect(
      screen.queryByText('Nenhuma execução ativa neste projeto no momento.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('dev-backend')).not.toBeInTheDocument();
  });
});

describe('ProjectExecutorsTab — executionActivated vem do resumo, não da janela de 200 eventos', () => {
  it('sessão com mais de 200 eventos: `execution.activated` já saiu da janela, mas o resumo agregado ainda mostra o roster de dev agents', async () => {
    // Simula o que `useSessionEvents` devolve numa sessão de execução real:
    // só a CAUDA (`latest: true`), sem o `execution.activated` original — ele
    // é um dos primeiros eventos e já saiu da janela de 200.
    listSessionEvents.mockResolvedValue({
      items: [EVENTOS[0], EVENTOS[2], EVENTOS[3], EVENTOS[4]], // sem e2 (execution.activated)
      nextCursor: null,
    });
    // O resumo do workspace agrega TODOS os eventos no backend — ele sabe
    // que a execução foi ativada mesmo com a janela tendo esquecido.
    getProjectsSummary.mockResolvedValue([resumo({ executionActivated: true })]);

    montar();

    expect(await screen.findByText('dev-backend')).toBeInTheDocument();
    expect(
      screen.queryByText(/Nenhum dev agent ou QA entrou em ação nesta sessão ainda/),
    ).not.toBeInTheDocument();
  });

  it('resumo com `executionActivated: false` continua mostrando o estado vazio, mesmo com dev.started na janela', async () => {
    // Regressão: `dev.started` sozinho não bota dev-backend na roster — quem
    // decide é `executionActivated` (agora do resumo) cruzado com o
    // module_map. Sem `pr.gate_changed`/`infra.gate_changed` na janela
    // (`gatesEverOpened` continua window-derived, ver limitação documentada
    // em ProjectExecutorsTab.tsx), o grupo de executores fica vazio de
    // verdade.
    listSessionEvents.mockResolvedValue({
      items: [EVENTOS[0], EVENTOS[2]], // agent.status + dev.started, sem gate
      nextCursor: null,
    });
    getProjectsSummary.mockResolvedValue([resumo({ executionActivated: false })]);

    montar();

    expect(
      await screen.findByText(/Nenhum dev agent ou QA entrou em ação nesta sessão ainda/),
    ).toBeInTheDocument();
    expect(screen.queryByText('dev-backend')).not.toBeInTheDocument();
  });
});
