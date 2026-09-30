import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import settingsPtBR from '../../locales/pt-BR/settings.json';
import modelsPtBR from '../../locales/pt-BR/models.json';
import { ToastProvider } from '../../components/ui/ToastProvider';
import type { Model, ModelsByCategory, Project } from '../../lib/api-types';
import { simularLayoutMovel } from '../../test/match-media';
import { ModelsSection } from './ModelsSection';

/**
 * AT-330 (achado N4 da auditoria da Rodada 29): em 390px "Modelos por agente"
 * era inutilizável — cinco colunas em fração espremidas na largura do
 * telefone, o nome do agente numa caixa de 6px e o seletor de modelo numa de
 * 0px. No layout móvel a tabela vira cartões (`Table`, RN-643), e as duas
 * colunas que carregam CONTROLE (o seletor e o "voltar a herdar") ocupam a
 * largura inteira do cartão.
 */

const getProject = vi.fn();
const listModels = vi.fn();
const getAgentModelBinding = vi.fn();
const getAreaModelBinding = vi.fn();
const getProjectModelBinding = vi.fn();
const getWorkspaceModelBinding = vi.fn();
const getProjectAgentCosts = vi.fn();
const setAgentModelBinding = vi.fn();
const clearAgentModelBinding = vi.fn();
const setAreaModelBinding = vi.fn();
const clearAreaModelBinding = vi.fn();
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
    listModels: (...args: unknown[]) => listModels(...args),
    // Nenhum provider com a capability de roteamento (ADR 0166): o estado de
    // produção enquanto o smoke do OpenRouter não rodar.
    listProviderCapabilities: () => Promise.resolve([]),
    getAgentModelBinding: (...args: unknown[]) => getAgentModelBinding(...args),
    setAgentModelBinding: (...args: unknown[]) => setAgentModelBinding(...args),
    clearAgentModelBinding: (...args: unknown[]) =>
      clearAgentModelBinding(...args),
    getAreaModelBinding: (...args: unknown[]) => getAreaModelBinding(...args),
    setAreaModelBinding: (...args: unknown[]) => setAreaModelBinding(...args),
    clearAreaModelBinding: (...args: unknown[]) => clearAreaModelBinding(...args),
    getProjectModelBinding: (...args: unknown[]) =>
      getProjectModelBinding(...args),
    getWorkspaceModelBinding: (...args: unknown[]) =>
      getWorkspaceModelBinding(...args),
    getProjectAgentCosts: (...args: unknown[]) => getProjectAgentCosts(...args),
  };
});

/** O único agente com binding PRÓPRIO: a única linha que tem "voltar a herdar". */
const SLUG = 'qa-automacao';

/** Os nomes exibidos são o que separa um controle do outro nas consultas. */
const DO_AGENTE = 'Modelo do agente';
const OUTRO = 'Outro modelo';

/** As duas regiões — o `<section>` de cada seção tem nome acessível. */
const REGIAO_AGENTES = 'Modelos por agente';

const VOLTAR_INLINE = 'voltar a herdar';

function modelo(over: Partial<Model> = {}): Model {
  return {
    id: 'm-agente',
    provider: 'ollama',
    name: 'agente',
    displayName: DO_AGENTE,
    inputPricePerMillionMicros: 0,
    outputPricePerMillionMicros: 0,
    contextWindow: 8192,
    supportsToolCalling: true,
    supportsStreaming: true,
    supportsReasoning: false,
    generatesImage: false,
    supportsVision: false,
    manualPricing: true,
    availability: 'available',
    lastSeenAt: null,
    ...over,
  };
}

const MODELOS: ModelsByCategory = {
  local: {
    ollama: [
      modelo(),
      modelo({ id: 'm-outro', name: 'outro', displayName: OUTRO }),
      modelo({ id: 'm-area', name: 'area', displayName: 'Modelo da área' }),
    ],
  },
  cloud: {},
} as ModelsByCategory;

function project(): Project {
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
    mirrorPath: null,
    language: 'pt-BR',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  };
}

/**
 * Só `pt-BR`: o que se prova aqui é `disabled` e a chegada (ou não) de uma
 * chamada na api — nenhum dos dois muda com o idioma.
 */
function montar(secao: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    resources: { 'pt-BR': { settings: settingsPtBR, models: modelsPtBR } },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
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

function comPapel(role: string | undefined) {
  useCurrentWorkspaceWithRole.mockReturnValue({
    data: role ? { workspace: { id: 'ws-1' }, role } : undefined,
  });
}

/** Monta a tabela de agentes e espera a linha do `SLUG` chegar. */
async function tabelaDeAgentes() {
  montar(<ModelsSection projectId="proj-1" />);
  const picker = await screen.findByRole('button', { name: DO_AGENTE });
  const voltar = screen.getByRole('button', { name: VOLTAR_INLINE });
  return { picker, voltar };
}

beforeEach(() => {
  vi.clearAllMocks();
  getProject.mockResolvedValue(project());
  listModels.mockResolvedValue(MODELOS);
  getAgentModelBinding.mockImplementation((_p: string, slug: string) =>
    Promise.resolve(
      slug === SLUG ? { modelId: 'm-agente', origin: 'agent', skipped: [] } : null,
    ),
  );
  getAreaModelBinding.mockResolvedValue({
    modelId: 'm-area',
    origin: 'area',
    skipped: [],
  });
  getProjectModelBinding.mockResolvedValue(null);
  getWorkspaceModelBinding.mockResolvedValue(null);
  getProjectAgentCosts.mockResolvedValue([]);
  setAgentModelBinding.mockResolvedValue(undefined);
  clearAgentModelBinding.mockResolvedValue(undefined);
});


describe('Modelos por agente — layout estreito (AT-330)', () => {
  let largura: ReturnType<typeof simularLayoutMovel> | null = null;
  afterEach(() => {
    largura?.restaurar();
    largura = null;
  });

  it('no móvel, cada agente é um cartão, e o seletor e a origem ocupam a largura inteira', async () => {
    largura = simularLayoutMovel(true);
    comPapel('developer');
    const { picker, voltar } = await tabelaDeAgentes();

    const cartao = picker.closest('[data-testid="linha-da-tabela"]') as HTMLElement;
    expect(cartao).not.toBeNull();
    // O nome do agente continua na MESMA linha do seletor dele — o cartão é a
    // linha inteira, não uma célula solta.
    expect(within(cartao).getByText('Agente')).toBeInTheDocument();
    expect(picker.closest('[data-campo]')).toHaveAttribute('data-campo', 'model');
    expect(picker.closest('[data-campo]')).toHaveAttribute('data-largo');
    expect(voltar.closest('[data-campo]')).toHaveAttribute('data-campo', 'origin');
    expect(voltar.closest('[data-campo]')).toHaveAttribute('data-largo');
    // O nome, curto, fica AO LADO do rótulo — não precisa da largura inteira.
    const campoDoAgente = within(cartao).getByText('Agente').closest('[data-campo]');
    expect(campoDoAgente).not.toHaveAttribute('data-largo');
    expect(picker).toBeEnabled();
  });

  it('no desktop, continua a tabela de colunas — nenhum cartão, um cabeçalho só', async () => {
    comPapel('developer');
    const { picker } = await tabelaDeAgentes();

    expect(picker.closest('[data-testid="linha-da-tabela"]')).toBeNull();
    expect(screen.queryAllByTestId('linha-da-tabela')).toHaveLength(0);
    expect(within(screen.getByRole('region', { name: REGIAO_AGENTES })).getAllByText('Agente')).toHaveLength(1);
  });
});
