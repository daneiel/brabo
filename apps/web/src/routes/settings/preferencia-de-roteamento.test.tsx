import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import settingsPtBR from '../../locales/pt-BR/settings.json';
import settingsEn from '../../locales/en/settings.json';
import modelsPtBR from '../../locales/pt-BR/models.json';
import modelsEn from '../../locales/en/models.json';
import { ToastProvider } from '../../components/ui/ToastProvider';
import { ApiError } from '../../lib/api-client';
import type {
  Model,
  ModelsByCategory,
  Project,
  ProviderCapabilities,
  ResolvedBinding,
} from '../../lib/api-types';
import { ModelsSection } from './ModelsSection';
import { AreaModelsSection } from './AreaModelsSection';

/**
 * O critério de roteamento na tabela de agentes (ADR 0166, RN-583).
 *
 * Quatro estados que não colapsam: provider SEM a capability (frase, nenhum
 * controle), linha que HERDA o modelo (frase com o nível, nenhum controle),
 * linha com binding PRÓPRIO (o seletor, que regrava o MESMO modelo com o
 * critério) e papel abaixo do endpoint (o seletor inerte, nunca escondido).
 */

const getProject = vi.fn();
const listModels = vi.fn();
const getAgentModelBinding = vi.fn();
const getAreaModelBinding = vi.fn();
const getProjectModelBinding = vi.fn();
const getWorkspaceModelBinding = vi.fn();
const getProjectAgentCosts = vi.fn();
const setAgentModelBinding = vi.fn();
const setAreaModelBinding = vi.fn();
const listProviderCapabilities = vi.fn();
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
    getAgentModelBinding: (...args: unknown[]) => getAgentModelBinding(...args),
    setAgentModelBinding: (...args: unknown[]) => setAgentModelBinding(...args),
    clearAgentModelBinding: vi.fn(),
    setAreaModelBinding: (...args: unknown[]) => setAreaModelBinding(...args),
    clearAreaModelBinding: vi.fn(),
    getAreaModelBinding: (...args: unknown[]) => getAreaModelBinding(...args),
    getProjectModelBinding: (...args: unknown[]) =>
      getProjectModelBinding(...args),
    getWorkspaceModelBinding: (...args: unknown[]) =>
      getWorkspaceModelBinding(...args),
    getProjectAgentCosts: (...args: unknown[]) => getProjectAgentCosts(...args),
    listProviderCapabilities: (...args: unknown[]) =>
      listProviderCapabilities(...args),
  };
});

/** O agente com binding na tabela — os outros não têm modelo vigente. */
const SLUG = 'qa-automacao';

const DO_HUB: Model = {
  id: 'm-hub',
  provider: 'openrouter',
  name: '~deepseek/deepseek-v4-flash-latest',
  displayName: 'DeepSeek V4 Flash',
  inputPricePerMillionMicros: 0,
  outputPricePerMillionMicros: 0,
  contextWindow: 128000,
  supportsToolCalling: true,
  supportsStreaming: true,
  supportsReasoning: false,
  generatesImage: false,
  supportsVision: false,
  manualPricing: false,
  availability: 'available',
  lastSeenAt: null,
};

const MODELOS = {
  local: {},
  cloud: { openrouter: [DO_HUB] },
} as unknown as ModelsByCategory;

function capacidades(hubAceita: boolean): ProviderCapabilities[] {
  const base = {
    streaming: true,
    toolCalling: true,
    listModels: true,
    embeddings: false,
    routingPreference: false,
  };
  return [
    { provider: 'ollama', capabilities: base },
    {
      provider: 'openrouter',
      capabilities: { ...base, routingPreference: hubAceita },
    },
  ];
}

function binding(over: Partial<ResolvedBinding> = {}): ResolvedBinding {
  return {
    modelId: 'm-hub',
    origin: 'agent',
    routingPreference: null,
    skipped: [],
    ...over,
  };
}

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
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  } as Project;
}

function montar(secao: ReactNode, lng: 'pt-BR' | 'en' = 'pt-BR') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    resources: {
      'pt-BR': { settings: settingsPtBR, models: modelsPtBR },
      en: { settings: settingsEn, models: modelsEn },
    },
    lng,
    fallbackLng: lng,
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

const ROTULO = /Preferência de roteamento de QA de Automação/;

beforeEach(() => {
  vi.clearAllMocks();
  getProject.mockResolvedValue(project());
  listModels.mockResolvedValue(MODELOS);
  getAgentModelBinding.mockImplementation((_p: string, slug: string) =>
    Promise.resolve(slug === SLUG ? binding() : null),
  );
  getAreaModelBinding.mockResolvedValue(null);
  getProjectModelBinding.mockResolvedValue(null);
  getWorkspaceModelBinding.mockResolvedValue(null);
  getProjectAgentCosts.mockResolvedValue([]);
  setAgentModelBinding.mockResolvedValue(undefined);
  setAreaModelBinding.mockResolvedValue(undefined);
  listProviderCapabilities.mockResolvedValue(capacidades(true));
  useCurrentWorkspaceWithRole.mockReturnValue({
    data: { workspace: { id: 'ws-1' }, role: 'developer' },
  });
});

describe('critério de roteamento — binding PRÓPRIO com provider que aceita', () => {
  it('caminho feliz: escolher regrava o MESMO modelo com o critério, e relê a linha', async () => {
    montar(<ModelsSection projectId="proj-1" />);
    const seletor = await screen.findByRole('combobox', { name: ROTULO });

    fireEvent.change(seletor, { target: { value: 'throughput' } });

    await waitFor(() =>
      expect(setAgentModelBinding).toHaveBeenCalledWith('proj-1', SLUG, 'm-hub', {
        routingPreference: 'throughput',
      }),
    );
  });

  it('"o hub decide" manda `null` explícito — limpar, nunca omitir', async () => {
    getAgentModelBinding.mockImplementation((_p: string, slug: string) =>
      Promise.resolve(
        slug === SLUG ? binding({ routingPreference: 'latency' }) : null,
      ),
    );
    montar(<ModelsSection projectId="proj-1" />);
    const seletor = await screen.findByRole('combobox', { name: ROTULO });
    expect(seletor).toHaveValue('latency');

    fireEvent.change(seletor, { target: { value: '' } });

    await waitFor(() =>
      expect(setAgentModelBinding).toHaveBeenCalledWith('proj-1', SLUG, 'm-hub', {
        routingPreference: null,
      }),
    );
  });

  it('falha: a recusa da api vai para a tela pela frase dela', async () => {
    const FRASE = 'O provider "openrouter" não declara a capability `routingPreference`';
    setAgentModelBinding.mockRejectedValue(new ApiError(422, { message: FRASE }));
    montar(<ModelsSection projectId="proj-1" />);

    fireEvent.change(await screen.findByRole('combobox', { name: ROTULO }), {
      target: { value: 'price' },
    });

    expect(await screen.findByText(FRASE)).toBeInTheDocument();
  });

  it('abaixo de `developer` o seletor fica INERTE, não some (RN-102)', async () => {
    useCurrentWorkspaceWithRole.mockReturnValue({
      data: { workspace: { id: 'ws-1' }, role: 'viewer' },
    });
    montar(<ModelsSection projectId="proj-1" />);

    expect(await screen.findByRole('combobox', { name: ROTULO })).toBeDisabled();
  });
});

describe('critério de roteamento — quando NÃO há o que escolher', () => {
  it('provider sem a capability: frase do porquê, nenhum seletor', async () => {
    listProviderCapabilities.mockResolvedValue(capacidades(false));
    montar(<ModelsSection projectId="proj-1" />);

    expect(
      await screen.findByText(/o provider openrouter não declara essa capacidade/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: ROTULO })).toBeNull();
  });

  it('a frase existe em `en` também', async () => {
    listProviderCapabilities.mockResolvedValue(capacidades(false));
    montar(<ModelsSection projectId="proj-1" />, 'en');

    expect(
      await screen.findByText(/the openrouter provider does not declare that capability/),
    ).toBeInTheDocument();
  });

  it('linha que HERDA: o critério vigente é dito com o nível de onde veio, sem seletor', async () => {
    getAgentModelBinding.mockImplementation((_p: string, slug: string) =>
      Promise.resolve(
        slug === SLUG
          ? binding({ origin: 'area', routingPreference: 'throughput' })
          : null,
      ),
    );
    montar(<ModelsSection projectId="proj-1" />);

    expect(
      await screen.findByText(/Roteamento: maior vazão — vem com o modelo do nível área/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: ROTULO })).toBeNull();
  });

  it('capabilities ainda desconhecidas: nada — "não sei" não vira "não tem"', async () => {
    listProviderCapabilities.mockReturnValue(new Promise(() => {}));
    montar(<ModelsSection projectId="proj-1" />);
    await screen.findAllByRole('button', { name: /DeepSeek V4 Flash/ });

    expect(screen.queryByText(/não declara essa capacidade/)).toBeNull();
    expect(screen.queryByRole('combobox', { name: ROTULO })).toBeNull();
  });
});

describe('critério de roteamento — padrão da ÁREA', () => {
  const ROTULO_DA_AREA = /Preferência de roteamento de Área Dev/;

  beforeEach(() => {
    getAreaModelBinding.mockImplementation((_p: string, area: string) =>
      Promise.resolve(area === 'dev' ? binding({ origin: 'area' }) : null),
    );
  });

  it('caminho feliz: regrava o padrão da área com o critério', async () => {
    useCurrentWorkspaceWithRole.mockReturnValue({
      data: { workspace: { id: 'ws-1' }, role: 'maintainer' },
    });
    montar(<AreaModelsSection projectId="proj-1" />);

    fireEvent.change(
      await screen.findByRole('combobox', { name: ROTULO_DA_AREA }),
      { target: { value: 'throughput' } },
    );

    await waitFor(() =>
      expect(setAreaModelBinding).toHaveBeenCalledWith('proj-1', 'dev', 'm-hub', {
        routingPreference: 'throughput',
      }),
    );
  });

  it('o mínimo é o do ENDPOINT da área (`maintainer`): `developer` vê o seletor inerte', async () => {
    montar(<AreaModelsSection projectId="proj-1" />);

    expect(
      await screen.findByRole('combobox', { name: ROTULO_DA_AREA }),
    ).toBeDisabled();
  });
});
