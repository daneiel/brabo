import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import overviewPtBR from '../locales/pt-BR/overview.json';
import executorsPtBR from '../locales/pt-BR/executors.json';
import { ProjectOverviewTab } from './ProjectOverviewTab';
import { ApiError } from '../lib/api-client';
import { ToastProvider } from '../components/ui/ToastProvider';

// Instância isolada de i18next em pt-BR (mesmo padrão de
// `AccountPage.test.tsx`): as asserções abaixo já existiam em pt-BR antes da
// extração pra `useTranslation('overview')`.
function novaInstanciaI18n() {
  const instancia = i18next.createInstance();
  void instancia.use(initReactI18next).init({
    resources: { 'pt-BR': { overview: overviewPtBR, executors: executorsPtBR } },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'overview',
    ns: ['overview'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instancia;
}

// `ArchitectureSummary` (Onda 3) usa `Link` de verdade — este arquivo não é
// sobre navegação (isso é `ProjectOverviewTab.resumo-arquitetura.test.tsx`),
// então o dublê é o mais simples possível, mesmo idioma de
// `ProjectInsightsTab.test.tsx`.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));
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
const unblockTaskMock = vi.fn();
const getArchitecture = vi.fn();
const getSessionTokenUsage = vi.fn();
const listModels = vi.fn();
const getAgentModelBinding = vi.fn();
const getResolvedModelBindings = vi.fn();
const listAgentAutonomy = vi.fn();
const listWorkspaces = vi.fn();
const getProjectsSummary = vi.fn();
const activateExecutionMock = vi.fn();
const getRepository = vi.fn();
const listCredentials = vi.fn();
const getActiveExecutionSession = vi.fn();

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
    // A rota por agente segue na api; a aba não a lê mais (RN-654, AT-339), e
    // o dublê existe para o teste PROVAR isso.
    getAgentModelBinding: (...args: unknown[]) => getAgentModelBinding(...args),
    getResolvedModelBindings: (...args: unknown[]) => getResolvedModelBindings(...args),
    listAgentAutonomy: (...args: unknown[]) => listAgentAutonomy(...args),
    listWorkspaces: (...args: unknown[]) => listWorkspaces(...args),
    getProjectsSummary: (...args: unknown[]) => getProjectsSummary(...args),
    activateExecution: (...args: unknown[]) => activateExecutionMock(...args),
    getRepository: (...args: unknown[]) => getRepository(...args),
    listCredentials: (...args: unknown[]) => listCredentials(...args),
    getActiveExecutionSession: (...args: unknown[]) => getActiveExecutionSession(...args),
    requestParallelization: vi.fn(),
    rearmDevAgent: vi.fn(),
    setAgentAutonomy: vi.fn(),
    unblockTask: (...args: unknown[]) => unblockTaskMock(...args),
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
      activatedAgents: [],
      infraActive: false,
      uxDesignerActive: false,
      staffActive: false,
      ...over,
    },
  };
}

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const i18n = novaInstanciaI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ProjectOverviewTab projectId="proj-1" />
        </ToastProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listSessions.mockResolvedValue([SESSAO]);
  getActiveExecutionSession.mockResolvedValue(null);
  listCredentials.mockResolvedValue([{ id: 'c-1', provider: 'openrouter', createdAt: '', updatedAt: '' }]);
  listSessionEvents.mockResolvedValue({ items: EVENTOS, nextCursor: null });
  listHandoffs.mockResolvedValue([HANDOFF_INFRA]);
  listActions.mockResolvedValue({ items: [], nextCursor: null });
  listBacklog.mockResolvedValue([]);
  getArchitecture.mockResolvedValue(ARQUITETURA);
  getSessionTokenUsage.mockResolvedValue([]);
  listModels.mockResolvedValue({ local: {}, cloud: {} });
  getAgentModelBinding.mockResolvedValue(null);
  getResolvedModelBindings.mockResolvedValue({ agents: [], areas: [] });
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
  activateExecutionMock.mockResolvedValue({ sessionId: 'sess-1', modules: [] });
  // O estado normal de um projeto que chega à seção de Execução: repositório
  // provisionado no aceite ao Arquiteto (RN-582). Os casos sem ele sobrescrevem.
  getRepository.mockResolvedValue({ id: 'repo-1', projectId: 'proj-1', provider: 'local' });
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

describe('ProjectOverviewTab — presença de SecOps vem do resumo, não da janela de 200 eventos (RN-568)', () => {
  // A cauda de uma sessão longa: o `pr.gate_changed` já saiu dos últimos 200.
  const CAUDA = [EVENTOS[0], EVENTOS[1], EVENTOS[2]];

  it('gate fora da janela: o resumo agregado ainda traz SecOps para o time', async () => {
    listSessionEvents.mockResolvedValue({ items: CAUDA, nextCursor: null });
    getProjectsSummary.mockResolvedValue([resumo({ gatesEverOpened: true })]);

    montar();

    const grid = within(await screen.findByTestId('agent-team-grid'));
    expect(await grid.findByText('SecOps')).toBeInTheDocument();
  });

  it('resumo sem gate e janela sem gate: SecOps continua fora do time', async () => {
    listSessionEvents.mockResolvedValue({ items: CAUDA, nextCursor: null });
    getProjectsSummary.mockResolvedValue([resumo({ gatesEverOpened: false })]);

    montar();

    await screen.findAllByText('Infra');
    const grid = within(await screen.findByTestId('agent-team-grid'));
    expect(grid.queryByText('SecOps')).not.toBeInTheDocument();
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

/**
 * RN-478 — o mesmo botão tinha DOIS diagnósticos: o chat da sessão
 * (`SessionPage.tsx`) já mostrava a causa por `mensagemDaApi`, e a Visão
 * geral imprimia a constante `activateError`. O 400 que ensina ("o Arquiteto
 * precisa definir os módulos", "a pasta do projeto está incoerente") morria
 * aqui, e quem clicava ficava com "Não foi possível ativar a execução".
 */
describe('ProjectOverviewTab — a causa da recusa de ativar chega à tela', () => {
  it('mostra a mensagem da api, e não a constante genérica', async () => {
    getProjectsSummary.mockResolvedValue([
      resumo({ executionActivated: false, gatesEverOpened: false }),
    ]);
    activateExecutionMock.mockRejectedValue(
      new ApiError(400, {
        message:
          'workspacePath inválido para projeto no modo runner: "/home/voce/../../etc".',
      }),
    );

    montar();

    await userEvent.click(await screen.findByText('Ativar execução'));

    expect(
      await screen.findByText(/workspacePath inválido para projeto no modo runner/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Não foi possível ativar a execução'),
    ).not.toBeInTheDocument();
  });

  it('erro sem corpo da api cai no texto padrão — o fallback continua existindo', async () => {
    getProjectsSummary.mockResolvedValue([
      resumo({ executionActivated: false, gatesEverOpened: false }),
    ]);
    activateExecutionMock.mockRejectedValue({ nao: 'e um Error' });

    montar();

    await userEvent.click(await screen.findByText('Ativar execução'));

    expect(
      await screen.findByText('Não foi possível ativar a execução'),
    ).toBeInTheDocument();
  });
});

/**
 * RN-582 (ADR 0165) — `execution/activate` sem repositório é 409. A tela tira
 * o CONTROLE e diz o motivo uma vez, em texto (RN-102/ADR 0064), e nunca
 * transforma "não sei" em "não tem".
 */
describe('ProjectOverviewTab — sem repositório, não se oferece ativar (RN-582)', () => {
  it('repositório ausente CONFIRMADO: botão inerte, motivo em texto e o caminho para provisionar', async () => {
    getProjectsSummary.mockResolvedValue([
      resumo({ executionActivated: false, gatesEverOpened: false }),
    ]);
    getRepository.mockResolvedValue(null);

    montar();

    expect(
      await screen.findByText(/O projeto ainda não tem repositório/),
    ).toBeInTheDocument();
    expect(screen.getByText('Provisionar o repositório agora')).toBeInTheDocument();
    const botao = screen.getByRole('button', { name: 'Ativar execução' });
    expect(botao).toBeDisabled();
    await userEvent.click(botao);
    expect(activateExecutionMock).not.toHaveBeenCalled();
  });

  it('repositório ainda carregando: o botão fica como estava — "não sei" não vira "não tem"', async () => {
    getProjectsSummary.mockResolvedValue([
      resumo({ executionActivated: false, gatesEverOpened: false }),
    ]);
    getRepository.mockReturnValue(new Promise(() => {}));

    montar();

    const botao = await screen.findByRole('button', { name: 'Ativar execução' });
    expect(botao).toBeEnabled();
    expect(screen.queryByText(/O projeto ainda não tem repositório/)).not.toBeInTheDocument();
  });

  it('consulta do repositório FALHOU: o botão fica como estava, e o backend decide', async () => {
    getProjectsSummary.mockResolvedValue([
      resumo({ executionActivated: false, gatesEverOpened: false }),
    ]);
    getRepository.mockRejectedValue(new ApiError(500, { message: 'fora' }));

    montar();

    const botao = await screen.findByRole('button', { name: 'Ativar execução' });
    expect(botao).toBeEnabled();
    expect(screen.queryByText(/O projeto ainda não tem repositório/)).not.toBeInTheDocument();
  });
});

/**
 * AT-339 (RN-654) — a Visão geral lê os bindings do roster no LOTE, e não
 * numa rota por agente.
 */
describe('ProjectOverviewTab — bindings em lote (AT-339)', () => {
  const MODELO = {
    id: 'm-1',
    provider: 'openrouter',
    name: 'modelo-um',
    displayName: 'Modelo Um',
  };

  it('mostra o modelo do agente a partir de UMA leitura em lote, sem rota por agente', async () => {
    listModels.mockResolvedValue({ local: {}, cloud: { geral: [MODELO] } });
    getResolvedModelBindings.mockResolvedValue({
      agents: [
        {
          key: 'criativo',
          binding: { modelId: 'm-1', origin: 'agent', routingPreference: null, skipped: [] },
        },
      ],
      areas: [],
    });
    montar();

    const grid = within(await screen.findByTestId('agent-team-grid'));
    expect(await grid.findByText(/Modelo Um/)).toBeInTheDocument();
    // O roster desta fixture é todo do catálogo (dev-backend inclusive), então
    // uma chamada basta e nenhuma leitura de "extras" nasce.
    expect(getResolvedModelBindings).toHaveBeenCalledTimes(1);
    expect(getAgentModelBinding).not.toHaveBeenCalled();
  });

  it('CASO DE FALHA: o lote recusado não vira modelo inventado nem uma rota por agente', async () => {
    listModels.mockResolvedValue({ local: {}, cloud: { geral: [MODELO] } });
    getResolvedModelBindings.mockRejectedValue(new ApiError(500, 'falhou'));
    montar();

    const grid = within(await screen.findByTestId('agent-team-grid'));
    expect(await grid.findByText('Criativo')).toBeInTheDocument();
    await vi.waitFor(() => expect(getResolvedModelBindings).toHaveBeenCalled());
    expect(grid.queryByText(/Modelo Um/)).not.toBeInTheDocument();
    expect(getAgentModelBinding).not.toHaveBeenCalled();
  });
});

describe('primeiros passos (RN-708, AT-372)', () => {
  it('projeto novo: os três passos pendentes, com o link de cada um', async () => {
    listSessions.mockResolvedValue([]);
    listCredentials.mockResolvedValue([]);
    getResolvedModelBindings.mockResolvedValue({ agents: [{ key: 'criativo', binding: null }], areas: [] });
    montar();

    const cartao = await screen.findByTestId('primeiros-passos');
    expect(within(cartao).getByText('0 de 3 feitos')).toBeInTheDocument();
    expect(within(cartao).getByText('Cadastrar a chave →')).toBeInTheDocument();
    expect(within(cartao).getByText('Abrir o catálogo →')).toBeInTheDocument();
    expect(within(cartao).getByText('Abrir o Criativo →')).toBeInTheDocument();
    // Sem sessão, a coluna de atividade é um vazio de verdade, não um esqueleto parado.
    expect(
      await screen.findByText('Nenhuma atividade ainda: ela começa com a primeira sessão do projeto.'),
    ).toBeInTheDocument();
  });

  it('tudo feito: o cartão não aparece', async () => {
    getResolvedModelBindings.mockResolvedValue({
      agents: [
        {
          key: 'criativo',
          binding: { modelId: 'm-1', origin: 'project', routingPreference: null, skipped: [] },
        },
      ],
      areas: [],
    });
    montar();

    await screen.findAllByText(/Execução/);
    expect(screen.queryByTestId('primeiros-passos')).toBeNull();
  });

  it('leitura de credenciais que falhou não vira "pendente": o cartão espera', async () => {
    listSessions.mockResolvedValue([]);
    listCredentials.mockRejectedValue(new Error('rede'));
    montar();

    await screen.findAllByText(/Execução/);
    expect(screen.queryByTestId('primeiros-passos')).toBeNull();
  });
});

describe('linha do tempo do time lê a sessão de execução (AT-463)', () => {
  it('com execução ativa noutra sessão, a árvore lê a de execução e diz isso', async () => {
    getActiveExecutionSession.mockResolvedValue({ ...SESSAO, id: 'sess-exec' });
    montar();

    expect(await screen.findByText(/Lendo a sessão de execução, não a mais recente\./)).toBeInTheDocument();
    expect(listSessionEvents.mock.calls.some((c) => c[1] === 'sess-exec')).toBe(true);
  });

  it('CASO DE FALHA evitado: sem execução, lê a mais recente e não anuncia outra', async () => {
    montar();

    expect(await screen.findByText('Criativo')).toBeInTheDocument();
    expect(screen.queryByText(/Lendo a sessão de execução/)).not.toBeInTheDocument();
    expect(listSessionEvents.mock.calls.every((c) => c[1] === 'sess-1')).toBe(true);
  });
});

// RN-794 (AT-469): execução já ativada antes, nenhuma vigente agora, tarefa
// bloqueada no backlog — a seção diz quantas pendem, oferece religar e o
// "Desbloquear" avisa que nada volta a rodar até religar.
describe('religar a execução encerrada (RN-794)', () => {
  const backlog = [
    {
      id: 'ep-1',
      projectId: 'proj-1',
      sessionId: 'sess-1',
      title: 'E',
      description: '',
      createdAt: '',
      updatedAt: '',
      stories: [
        {
          id: 'st-1',
          title: 'H',
          tasks: [
            {
              id: 't1',
              storyId: 'st-1',
              title: 'Tarefa travada',
              description: '',
              status: 'todo',
              assignedTo: null,
              blocked: true,
              blockedReason: 'motivo',
              gateStatus: null,
              gateCorrectionCount: 0,
              createdAt: '',
              updatedAt: '',
            },
          ],
        },
      ],
    },
  ];

  it('oferece religar pelo execution/activate e o desbloqueio avisa', async () => {
    getProjectsSummary.mockResolvedValue([resumo({ executionActivated: true })]);
    listBacklog.mockResolvedValue(backlog);
    unblockTaskMock.mockResolvedValue(undefined);
    activateExecutionMock.mockResolvedValue({ sessionId: 'sess-2' });

    montar();

    expect(await screen.findByText(/1 tarefa segue pendente/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Desbloquear' }));
    expect(await screen.findByText(/a tarefa só roda quando você religar/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Religar execução' }));
    expect(activateExecutionMock).toHaveBeenCalledWith('proj-1');
  });

  it('a recusa (409) de religar mostra a frase da api', async () => {
    getProjectsSummary.mockResolvedValue([resumo({ executionActivated: true })]);
    listBacklog.mockResolvedValue(backlog);
    activateExecutionMock.mockRejectedValue(
      new ApiError(409, { message: 'A sessão é consultiva.' }),
    );

    montar();

    await userEvent.click(await screen.findByRole('button', { name: 'Religar execução' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A sessão é consultiva.');
  });
});
