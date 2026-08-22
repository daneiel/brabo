import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { ProjectOverviewTab } from './ProjectOverviewTab';
import { ToastProvider } from '../components/ui/ToastProvider';
import type {
  Architecture,
  Handoff,
  ProjectCardSummary,
  Session,
  SessionEvent,
} from '../lib/api-types';

const listSessions = vi.fn();
const listSessionEvents = vi.fn();
const listHandoffs = vi.fn();
const listActions = vi.fn();
const listBacklog = vi.fn();
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
    listSessions: (...args: unknown[]) => listSessions(...args),
    listSessionEvents: (...args: unknown[]) => listSessionEvents(...args),
    listHandoffs: (...args: unknown[]) => listHandoffs(...args),
    listActions: (...args: unknown[]) => listActions(...args),
    listBacklog: (...args: unknown[]) => listBacklog(...args),
    getArchitecture: (...args: unknown[]) => getArchitecture(...args),
    getSessionTokenUsage: (...args: unknown[]) => getSessionTokenUsage(...args),
    listModels: (...args: unknown[]) => listModels(...args),
    getAgentModelBinding: (...args: unknown[]) => getAgentModelBinding(...args),
    listAgentAutonomy: (...args: unknown[]) => listAgentAutonomy(...args),
    listWorkspaces: (...args: unknown[]) => listWorkspaces(...args),
    getProjectsSummary: (...args: unknown[]) => getProjectsSummary(...args),
    activateExecution: vi.fn(),
    requestParallelization: vi.fn(),
    rearmDevAgent: vi.fn(),
    setAgentAutonomy: vi.fn(),
    unblockTask: vi.fn(),
  };
});

const SESSAO: Session = {
  id: 'sess-1',
  projectId: 'proj-1',
  createdBy: 'user-1',
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

// Mesma mistura da FASE 27 (ver ProjectExecutorsTab.test.tsx): Criativo,
// Infra (via handoff aceito), dev-backend e QA (lead + qa-automacao). O
// `pr.gate_changed` que traz QA para a roster (`rosterFactsFromEvents`) traz
// SecOps JUNTO — os dois entram sempre que algum gate já abriu (Fase 4a) —
// e SecOps não é executor: fica na Visão geral, não na aba nova.
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
        <ProjectOverviewTab projectId="proj-1" />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listSessions.mockResolvedValue([SESSAO]);
  listSessionEvents.mockResolvedValue({ items: EVENTOS, nextCursor: null });
  listHandoffs.mockResolvedValue([HANDOFF_INFRA]);
  listActions.mockResolvedValue({ items: [], nextCursor: null });
  listBacklog.mockResolvedValue([]);
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

/**
 * FASE 27 (RN-121) — dev agent e QA saíram do "Time de agentes" para a aba
 * Executores. Este teste prova o lado que fica: o resto do time continua
 * aparecendo, e dev/QA NUNCA mais — a duplicação entre as duas abas era
 * exatamente o que a fase fechou.
 */
describe('ProjectOverviewTab — dev/QA saíram para Executores (FASE 27)', () => {
  it('mostra Criativo, SecOps e Infra, mas não dev-backend nem QA', async () => {
    montar();

    // Criativo/PO/Arquiteto são a roster BASE — aparecem mesmo antes de
    // eventos/handoffs resolverem, então esperar por eles não prova que os
    // dados assíncronos chegaram. SecOps só entra depois que o
    // `pr.gate_changed` (eventos) é processado; `findByText` espera por ele.
    expect(await screen.findByText('Criativo')).toBeInTheDocument();
    // "SecOps" também está no `<option>` do filtro da coluna de Atividade —
    // mesma razão do `findAllByText('Infra')` abaixo.
    await screen.findAllByText('SecOps');
    expect(screen.getAllByText('SecOps').length).toBeGreaterThan(0);
    // "Infra" também está no `<option>` do filtro de agente da coluna de
    // Atividade (`ActivityFeed`) — `getAllByText` prova que o card do lead
    // apareceu sem fixar quantas vezes o nome se repete na tela. Infra só
    // entra depois que `listHandoffs` resolve (busca separada da de
    // eventos), então esperar aqui também é indispensável.
    await screen.findAllByText('Infra');
    expect(screen.getAllByText('Infra').length).toBeGreaterThan(0);

    // O grid do "Time de agentes" é o que a fase muda — a coluna de
    // Atividade continua listando TODOS os agentes no filtro (RN-099/100
    // não mudou: ela responde "o que aconteceu", e o dropdown lista quem já
    // falou, dev/QA inclusive). Por isso a ausência é verificada DENTRO do
    // grid, com `data-testid="agent-team-grid"` (`AgentTeamGrid.tsx`), e não
    // na página inteira.
    const grid = within(await screen.findByTestId('agent-team-grid'));
    expect(grid.queryByText('dev-backend')).not.toBeInTheDocument();
    expect(grid.queryByText('QA de Automação')).not.toBeInTheDocument();
    expect(grid.queryByText('QA')).not.toBeInTheDocument();
  });

  it('a contagem do cabeçalho conta só quem ainda aparece na Visão geral', async () => {
    montar();

    await screen.findAllByText('Infra');
    // Roster completa tem 8 (criativo/po/arquiteto/dev-backend/qa/
    // qa-automacao/secops/infra); sem dev-backend/qa/qa-automacao sobram 5:
    // criativo, po, arquiteto, secops, infra.
    expect(screen.getByText(/5 agentes/)).toBeInTheDocument();
  });
});

describe('ProjectOverviewTab — executionActivated vem do resumo, não da janela de 200 eventos', () => {
  it('sessão com mais de 200 eventos: a seção Execução não volta a oferecer "Ativar execução" para uma execução já em andamento', async () => {
    // A janela (`useSessionEvents`) perdeu o `execution.activated` original —
    // só o resumo agregado (RN-090) ainda sabe que a execução está rodando.
    listSessionEvents.mockResolvedValue({
      items: [EVENTOS[0], EVENTOS[2], EVENTOS[3], EVENTOS[4]], // sem e2 (execution.activated)
      nextCursor: null,
    });
    getProjectsSummary.mockResolvedValue([resumo({ executionActivated: true })]);

    montar();

    await screen.findByText('Execução');
    expect(screen.queryByText('Ativar execução')).not.toBeInTheDocument();
  });

  it('resumo com `executionActivated: false` mantém o convite para ativar a execução', async () => {
    listSessionEvents.mockResolvedValue({ items: EVENTOS, nextCursor: null });
    getProjectsSummary.mockResolvedValue([
      resumo({ executionActivated: false, gatesEverOpened: false }),
    ]);

    montar();

    expect(await screen.findByText('Ativar execução')).toBeInTheDocument();
  });
});
