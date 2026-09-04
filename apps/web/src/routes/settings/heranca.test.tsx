import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import settingsPtBR from '../../locales/pt-BR/settings.json';
import settingsEn from '../../locales/en/settings.json';
import modelsPtBR from '../../locales/pt-BR/models.json';
import modelsEn from '../../locales/en/models.json';
import { ToastProvider } from '../../components/ui/ToastProvider';
import type { Project } from '../../lib/api-types';
import { AreaModelsSection } from './AreaModelsSection';
import { BudgetSection } from './BudgetSection';
import { ExecutionSection } from './ExecutionSection';
import { ModelsSection } from './ModelsSection';

/**
 * O padrão ÚNICO de valor herdado (`settings/heranca.tsx`), provado nos QUATRO
 * lugares da aba Configurações que diziam a mesma coisa de quatro jeitos.
 *
 * O que este arquivo fixa é o VOCABULÁRIO, não a forma: os dois polos ("Sem
 * valor próprio" / "Valor próprio") e o verbo ("Voltar a herdar") saem de uma
 * fonte só, nos dois idiomas. Que `ModelsSection` use o verbo sem a marca, e
 * que `BudgetSection` mantenha o placeholder, é DECISÃO — está testado aqui
 * como decisão, não como acidente.
 */

const getProject = vi.fn();
const listAgentAreas = vi.fn();
const listModels = vi.fn();
const getAgentModelBinding = vi.fn();
const getAreaModelBinding = vi.fn();
const getProjectModelBinding = vi.fn();
const getWorkspaceModelBinding = vi.fn();
const getProjectAgentCosts = vi.fn();
const useCurrentWorkspaceWithRole = vi.fn();

vi.mock('../../lib/hooks', () => ({
  useCurrentWorkspaceWithRole: (...args: unknown[]) =>
    useCurrentWorkspaceWithRole(...args),
}));

vi.mock('../../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../../lib/api-client')>(
    '../../lib/api-client',
  );
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getProject: (...args: unknown[]) => getProject(...args),
    updateProject: vi.fn(),
    listAgentAreas: (...args: unknown[]) => listAgentAreas(...args),
    setAreaBudget: vi.fn(),
    listModels: (...args: unknown[]) => listModels(...args),
    getAgentModelBinding: (...args: unknown[]) => getAgentModelBinding(...args),
    setAgentModelBinding: vi.fn(),
    clearAgentModelBinding: vi.fn(),
    getAreaModelBinding: (...args: unknown[]) => getAreaModelBinding(...args),
    setAreaModelBinding: vi.fn(),
    clearAreaModelBinding: vi.fn(),
    getProjectModelBinding: (...args: unknown[]) =>
      getProjectModelBinding(...args),
    getWorkspaceModelBinding: (...args: unknown[]) =>
      getWorkspaceModelBinding(...args),
    getProjectAgentCosts: (...args: unknown[]) => getProjectAgentCosts(...args),
  };
});

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    workspaceId: 'ws-1',
    name: 'Checkout',
    slug: 'checkout',
    createdBy: 'user-1',
    maxConsecutiveBlocked: null,
    storyPromotion: 'manual',
    executionMode: 'container',
    workspacePath: null,
    workspaceVerifiedAt: null,
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...over,
  };
}

function area(over: Record<string, unknown> = {}) {
  return {
    id: 'area-1',
    projectId: 'proj-1',
    key: 'dev',
    leadAgentId: 'dev-lead',
    maxParallel: 2,
    budgetMicros: null,
    spentMicros: 0,
    members: ['dev-api', 'dev-web'],
    ...over,
  };
}

function montar(secao: ReactNode, idioma: 'pt-BR' | 'en' = 'pt-BR') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    resources: {
      'pt-BR': { settings: settingsPtBR, models: modelsPtBR },
      en: { settings: settingsEn, models: modelsEn },
    },
    lng: idioma,
    fallbackLng: idioma,
    defaultNS: 'settings',
    ns: ['settings', 'models'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ToastProvider>{secao}</ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getProject.mockResolvedValue(project());
  listAgentAreas.mockResolvedValue([]);
  listModels.mockResolvedValue({ local: {}, cloud: {} });
  getAgentModelBinding.mockResolvedValue(null);
  getAreaModelBinding.mockResolvedValue(null);
  getProjectModelBinding.mockResolvedValue(null);
  getWorkspaceModelBinding.mockResolvedValue(null);
  getProjectAgentCosts.mockResolvedValue([]);
  useCurrentWorkspaceWithRole.mockReturnValue({ data: { role: 'maintainer' } });
});

describe('padrão único de valor herdado — Execução (circuit breaker)', () => {
  it('sem valor próprio: a marca e o detalhe do que vale no lugar', async () => {
    getProject.mockResolvedValue(project({ maxConsecutiveBlocked: null }));
    montar(<ExecutionSection projectId="proj-1" />);

    expect(await screen.findByText('Sem valor próprio')).toBeInTheDocument();
    expect(screen.getByText('usa o default (3)')).toBeInTheDocument();
    expect(screen.queryByText('Valor próprio')).toBeNull();
  });

  it('com valor próprio: o polo POSITIVO da mesma marca', async () => {
    getProject.mockResolvedValue(project({ maxConsecutiveBlocked: 5 }));
    montar(<ExecutionSection projectId="proj-1" />);

    expect(await screen.findByText('Valor próprio')).toBeInTheDocument();
    expect(
      screen.getByText('configurado para este projeto'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Sem valor próprio')).toBeNull();
  });
});

describe('padrão único de valor herdado — Teto de gasto por área', () => {
  it('área sem teto: a MESMA marca da Execução, com o detalhe desta seção', async () => {
    listAgentAreas.mockResolvedValue([area({ budgetMicros: null })]);
    montar(<BudgetSection projectId="proj-1" />);

    expect(await screen.findByText('Sem valor próprio')).toBeInTheDocument();
    expect(screen.getByText('sem teto')).toBeInTheDocument();
  });

  it('área com teto: polo positivo, e o valor NÃO é repetido no detalhe', async () => {
    listAgentAreas.mockResolvedValue([area({ budgetMicros: 20_000_000 })]);
    montar(<BudgetSection projectId="proj-1" />);

    expect(await screen.findByText('Valor próprio')).toBeInTheDocument();
    expect(screen.queryByText('sem teto')).toBeNull();
    // O teto vive no campo ao lado — a marca não o duplica.
    expect(
      screen.getByLabelText('Teto de gasto da área dev, em dólares'),
    ).toHaveValue(20);
  });

  /**
   * O placeholder continua existindo — a DECISÃO desta PR é que ele deixou de
   * ser o único enunciado do estado, não que ele saiu.
   */
  it('o placeholder do campo sobrevive, agora só como texto-fantasma', async () => {
    listAgentAreas.mockResolvedValue([area({ budgetMicros: null })]);
    montar(<BudgetSection projectId="proj-1" />);

    expect(await screen.findByPlaceholderText('Sem teto')).toBeInTheDocument();
  });
});

describe('padrão único de valor herdado — Modelo por área', () => {
  it('área que herda: a marca no polo ausente, sem o botão do verbo', async () => {
    getAreaModelBinding.mockResolvedValue({
      modelId: 'm-projeto',
      origin: 'project',
      skipped: [],
    });
    montar(<AreaModelsSection projectId="proj-1" />);

    expect(await screen.findAllByText('Sem valor próprio')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Voltar a herdar' })).toBeNull();
  });

  it('área com padrão próprio: polo positivo e o verbo compartilhado', async () => {
    getAreaModelBinding.mockResolvedValue({
      modelId: 'm-area',
      origin: 'area',
      skipped: [],
    });
    montar(<AreaModelsSection projectId="proj-1" />);

    expect(await screen.findAllByText('Valor próprio')).toHaveLength(3);
    expect(
      screen.getAllByRole('button', { name: 'Voltar a herdar' }),
    ).toHaveLength(3);
  });
});

describe('padrão único de valor herdado — Modelos por agente', () => {
  /**
   * A tabela consome o VERBO e não a marca: a coluna Origem já é o enunciado
   * de estado da linha. O registro minúsculo é typographic (link de 11px em
   * mono na célula), e sai da mesma chave que o botão da seção de área.
   */
  it('agente que divergiu: o mesmo verbo, no registro da tabela', async () => {
    getAgentModelBinding.mockImplementation((_projectId: string, slug: string) =>
      Promise.resolve(
        slug === 'qa-automacao'
          ? { modelId: 'm-agente', origin: 'agent', skipped: [] }
          : null,
      ),
    );
    montar(<ModelsSection projectId="proj-1" />);

    expect(
      await screen.findByRole('button', { name: 'voltar a herdar' }),
    ).toBeInTheDocument();
    // A marca NÃO entra aqui — a coluna Origem já diz de onde o valor vem.
    expect(screen.queryByText('Sem valor próprio')).toBeNull();
  });
});

describe('padrão único de valor herdado — as duas línguas', () => {
  it('en: os dois polos vêm da mesma fonte que o pt-BR', async () => {
    getProject.mockResolvedValue(project({ maxConsecutiveBlocked: null }));
    montar(<ExecutionSection projectId="proj-1" />, 'en');

    expect(await screen.findByText('No value of its own')).toBeInTheDocument();
    expect(screen.getByText('uses the default (3)')).toBeInTheDocument();
  });

  it('en: o verbo e sua variante minúscula continuam sendo a MESMA chave', async () => {
    getAreaModelBinding.mockResolvedValue({
      modelId: 'm-area',
      origin: 'area',
      skipped: [],
    });
    montar(<AreaModelsSection projectId="proj-1" />, 'en');

    expect(
      await screen.findAllByRole('button', { name: 'Go back to inheriting' }),
    ).toHaveLength(3);
  });

  it('en: a tabela deriva o registro minúsculo do mesmo rótulo', async () => {
    getAgentModelBinding.mockImplementation((_projectId: string, slug: string) =>
      Promise.resolve(
        slug === 'qa-automacao'
          ? { modelId: 'm-agente', origin: 'agent', skipped: [] }
          : null,
      ),
    );
    montar(<ModelsSection projectId="proj-1" />, 'en');

    expect(
      await screen.findByRole('button', { name: 'go back to inheriting' }),
    ).toBeInTheDocument();
  });
});
