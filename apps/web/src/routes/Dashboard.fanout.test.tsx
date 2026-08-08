import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Dashboard } from './Dashboard';
import type { Project, ProjectCardSummary } from '../lib/api-types';

/**
 * O PEDIDO do dashboard não cresce com o número de projetos (RN-090).
 *
 * Este é o teste da correção, e o que ele fixa é uma PROPRIEDADE, não um
 * número mágico: renderizar 3 projetos e renderizar 30 tem de custar a mesma
 * quantidade de requisições. Um teste que só afirmasse "faz 3 chamadas"
 * passaria de novo com o N+1 de volta e três projetos na fixture.
 *
 * A tela real que originou isto tinha 23 projetos, sete consultas em poll por
 * card, e derrubava a api inteira em 429 — o limite é 300 req/min por usuário.
 */

// `vi.hoisted`: `vi.mock` é içado para o topo do arquivo, e a fábrica dele
// precisa destes valores já inicializados.
const { PER_PROJECT_ENDPOINTS, chamadas, conta, estado } = vi.hoisted(() => {
  const endpoints = [
    'getRepository',
    'getProjectBudget',
    'getBootstrapStatus',
    'listSessions',
    'listSessionEvents',
    'getArchitecture',
    'listHandoffs',
    'listActions',
    'listBacklog',
  ] as const;

  const registro: Record<string, number> = {};

  return {
    PER_PROJECT_ENDPOINTS: endpoints,
    chamadas: registro,
    estado: { projetos: 0 },
    conta<T>(nome: string, valor: T): () => Promise<T> {
      return () => {
        registro[nome] = (registro[nome] ?? 0) + 1;
        return Promise.resolve(valor);
      };
    },
  };
});

function projeto(i: number): Project {
  return {
    id: `project-${i}`,
    workspaceId: 'ws-1',
    name: `Projeto ${i}`,
    slug: `projeto-${i}`,
    createdBy: 'user-1',
    maxConsecutiveBlocked: null,
    storyPromotion: 'manual',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function resumo(i: number): ProjectCardSummary {
  return {
    projectId: `project-${i}`,
    provider: 'github',
    provisioningStatus: 'provisioned',
    budget: { limitMicros: 50_000_000, spentMicros: 1_000_000 },
    latestSessionId: `session-${i}`,
    latestSeq: 10,
    lastEvent: null,
    storiesAwaitingPromotion: 0,
    roster: {
      executionActivated: true,
      moduleNames: ['api', 'web'],
      gatesEverOpened: true,
      delegatedSubagents: ['qa-automacao'],
      infraActive: false,
    },
  };
}

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('./NewProjectWizard', () => ({
  NewProjectWizard: () => <div data-testid="wizard-stub" />,
}));

// Hooks e notifications REAIS: é justamente a cadeia de consultas deles que
// está sendo medida. Só a camada de transporte é substituída, por contadores.
vi.mock('../lib/api-client', async () => {
  const real =
    await vi.importActual<typeof import('../lib/api-client')>('../lib/api-client');

  const porProjeto = Object.fromEntries(
    PER_PROJECT_ENDPOINTS.map((nome) => [nome, conta(nome, null)]),
  );

  return {
    ...porProjeto,
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    listWorkspaces: conta('listWorkspaces', [
      { workspace: { id: 'ws-1', name: 'Acme', slug: 'acme' }, role: 'owner' },
    ]),
    listProjects: () => {
      chamadas.listProjects = (chamadas.listProjects ?? 0) + 1;
      return Promise.resolve(
        Array.from({ length: estado.projetos }, (_, i) => projeto(i)),
      );
    },
    getWorkspaceSummary: () => {
      chamadas.getWorkspaceSummary = (chamadas.getWorkspaceSummary ?? 0) + 1;
      return Promise.resolve({
        activeProjects: estado.projetos,
        agentCount: 3,
        spentMicros: 1_000_000,
      });
    },
    getProjectsSummary: () => {
      chamadas.getProjectsSummary = (chamadas.getProjectsSummary ?? 0) + 1;
      return Promise.resolve(
        Array.from({ length: estado.projetos }, (_, i) => resumo(i)),
      );
    },
  };
});

async function renderComProjetos(n: number): Promise<number> {
  estado.projetos = n;
  for (const k of Object.keys(chamadas)) delete chamadas[k];

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <Dashboard />
    </QueryClientProvider>,
  );

  await waitFor(() => {
    expect(screen.getAllByText(/^Projeto \d+$/)).toHaveLength(n);
  });

  const total = Object.values(chamadas).reduce((s, v) => s + v, 0);
  unmount();
  client.clear();
  return total;
}

describe('Dashboard — fan-out de requisições', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('nenhum endpoint POR PROJETO é chamado na montagem da grade', async () => {
    await renderComProjetos(12);

    for (const nome of PER_PROJECT_ENDPOINTS) {
      expect(chamadas[nome] ?? 0, `${nome} não deveria ser chamado`).toBe(0);
    }
    expect(chamadas.getProjectsSummary).toBe(1);
  });

  it('30 projetos custam o MESMO que 3 — o pedido não cresce com N', async () => {
    const comTres = await renderComProjetos(3);
    const comTrinta = await renderComProjetos(30);

    expect(comTrinta).toBe(comTres);
    // Guarda de sanidade: se as duas medidas fossem 0, a igualdade acima
    // passaria sem provar nada.
    expect(comTres).toBeGreaterThan(0);
  });
});
