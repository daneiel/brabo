import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ProjectOverviewTab } from './ProjectOverviewTab';
import { ToastProvider } from '../components/ui/ToastProvider';
import type {
  Architecture,
  ProjectCardSummary,
  Session,
} from '../lib/api-types';

/**
 * PROGRAMA de abas agrupadas — Onda 3: a seção de arquitetura INTEIRA saiu
 * da Visão geral para `ProjectArchitectureTab.tsx` (extração 1:1, coberta
 * em `ProjectArchitectureTab.test.tsx`). O que fica aqui é só o RESUMO
 * condensado — este arquivo prova as duas coisas que ele precisa fazer:
 * dizer quantos módulos existem + se o diagrama já foi gerado, e navegar
 * pra aba `arquitetura` — nunca despejar o corpo inteiro de novo.
 */

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

// Mesmo dublê de `SessionPage.artefatos-gerados.test.tsx`: captura
// `to`/`params`/`search` num `href` legível, pra provar ONDE o link
// aponta sem depender do roteador de verdade.
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
  nextSeq: 1,
  createdAt: '2026-08-10T10:00:00.000Z',
  updatedAt: '2026-08-10T10:00:00.000Z',
  closedAt: null,
};

function resumo(): ProjectCardSummary {
  return {
    projectId: 'proj-1',
    provider: 'github',
    provisioningStatus: 'provisioned',
    budget: null,
    latestSessionId: 'sess-1',
    latestSeq: 1,
    lastEvent: null,
    storiesAwaitingPromotion: 0,
    pendingApprovalsCount: 0,
    onlineAgentCount: 0,
    roster: {
      executionActivated: false,
      moduleNames: [],
      gatesEverOpened: false,
      delegatedSubagents: [],
      infraActive: false,
      uxDesignerActive: false,
      staffActive: false,
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
  listSessionEvents.mockResolvedValue({ items: [], nextCursor: null });
  listHandoffs.mockResolvedValue([]);
  listActions.mockResolvedValue({ items: [], nextCursor: null });
  listBacklog.mockResolvedValue([]);
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

describe('ProjectOverviewTab — resumo condensado de Arquitetura (Onda 3)', () => {
  it('sem module_map, mostra a frase de vazio e o link pra aba completa', async () => {
    const arquiteturaVazia: Architecture = {
      moduleMap: null,
      adrs: [],
      pendencies: [],
      c4Diagram: { status: 'sem_diagrama', diagrama: null, version: 0, eventId: null, createdAt: null },
    };
    getArchitecture.mockResolvedValue(arquiteturaVazia);

    montar();

    expect(
      await screen.findByText('Sem arquitetura ainda — o Arquiteto gera o module_map e os ADRs.'),
    ).toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'Ver arquitetura completa →' });
    expect(link).toHaveAttribute('href', '/projects/proj-1?tab=arquitetura');

    // O resumo condensado nunca duplica o corpo inteiro: nenhum card de
    // módulo, lista de ADR ou pendência aparece na Visão geral.
    expect(screen.queryByText('Nenhum ADR proposto ainda.')).not.toBeInTheDocument();
  });

  it('com módulos e diagrama gerado, o resumo conta certo e não esconde o link', async () => {
    const arquitetura: Architecture = {
      moduleMap: {
        id: 'mm-1',
        projectId: 'proj-1',
        sessionId: 'sess-1',
        version: 3,
        modules: [
          { name: 'Checkout', stack: 'NestJS', responsibility: 'r', dependsOn: [] },
          { name: 'Catalogo', stack: 'NestJS', responsibility: 'r', dependsOn: [] },
        ],
        createdAt: '2026-08-10T10:00:00.000Z',
      },
      adrs: [],
      pendencies: [],
      c4Diagram: {
        status: 'gerado',
        diagrama: {
          systemName: 'Brabo',
          systemDescription: '',
          actors: [],
          contextDiagram: 'C4Context',
          containerDiagram: 'C4Container',
        },
        version: 1,
        eventId: 'evt-1',
        createdAt: '2026-08-10T10:00:00.000Z',
      },
    };
    getArchitecture.mockResolvedValue(arquitetura);

    montar();

    expect(
      await screen.findByText('2 módulos mapeados, diagrama C4 gerado.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Ver arquitetura completa →' }),
    ).toHaveAttribute('href', '/projects/proj-1?tab=arquitetura');
  });

  it('singular certo com 1 módulo só', async () => {
    const arquitetura: Architecture = {
      moduleMap: {
        id: 'mm-1',
        projectId: 'proj-1',
        sessionId: 'sess-1',
        version: 1,
        modules: [{ name: 'Checkout', stack: 'NestJS', responsibility: 'r', dependsOn: [] }],
        createdAt: '2026-08-10T10:00:00.000Z',
      },
      adrs: [],
      pendencies: [],
      c4Diagram: { status: 'sem_diagrama', diagrama: null, version: 0, eventId: null, createdAt: null },
    };
    getArchitecture.mockResolvedValue(arquitetura);

    montar();

    expect(
      await screen.findByText('1 módulo mapeado, diagrama C4 pendente.'),
    ).toBeInTheDocument();
  });
});
