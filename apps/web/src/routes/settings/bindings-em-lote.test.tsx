import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import settingsPtBR from '../../locales/pt-BR/settings.json';
import modelsPtBR from '../../locales/pt-BR/models.json';
import { ToastProvider } from '../../components/ui/ToastProvider';
import { AGENT_LIST, AREAS } from '../../lib/agents';
import type { BindingsResolvidosEmLote, Project } from '../../lib/api-types';
import { AreaModelsSection } from './AreaModelsSection';
import { ModelsSection } from './ModelsSection';

/**
 * AT-334 (RN-654) — as seções de modelo leem os bindings RESOLVIDOS de todos
 * os agentes e áreas numa requisição só.
 *
 * O que se prova: (1) as duas seções renderizam a partir do lote, com UMA
 * chamada entre as duas e nenhuma rota por chave; (2) a falha do lote é dita,
 * com a frase da api e a ação de reler, e NÃO é desenhada como "sem modelo em
 * nenhum nível" — que é o que a api afirma quando responde `null`, e não o que
 * a tela sabe quando a leitura falhou (RN-470); (3) enquanto não há resposta,
 * a linha diz que está lendo, e não que não há modelo.
 */

const getProject = vi.fn();
const listModels = vi.fn();
const getResolvedModelBindings = vi.fn();
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
    listModels: (...args: unknown[]) => listModels(...args),
    listProviderCapabilities: () => Promise.resolve([]),
    getResolvedModelBindings: (...args: unknown[]) =>
      getResolvedModelBindings(...args),
    // As rotas por chave continuam existindo na api; as seções não as leem
    // mais, e este dublê existe para o teste PROVAR isso.
    getAgentModelBinding: (...args: unknown[]) => getAgentModelBinding(...args),
    getAreaModelBinding: (...args: unknown[]) => getAreaModelBinding(...args),
    setAgentModelBinding: vi.fn(),
    clearAgentModelBinding: vi.fn(),
    setAreaModelBinding: vi.fn(),
    clearAreaModelBinding: vi.fn(),
    getProjectModelBinding: (...args: unknown[]) =>
      getProjectModelBinding(...args),
    getWorkspaceModelBinding: (...args: unknown[]) =>
      getWorkspaceModelBinding(...args),
    getProjectAgentCosts: (...args: unknown[]) => getProjectAgentCosts(...args),
  };
});

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

function montar(secoes: ReactNode) {
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
        <ToastProvider>{secoes}</ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

/** Lote em que só o Arquiteto e a área de QA têm binding próprio. */
function lote(): BindingsResolvidosEmLote {
  return {
    agents: AGENT_LIST.map((a) => ({
      key: a.key,
      binding:
        a.key === 'arquiteto'
          ? { modelId: 'm-arq', origin: 'agent', routingPreference: null, skipped: [] }
          : null,
    })),
    areas: Object.keys(AREAS).map((key) => ({
      key,
      binding:
        key === 'qa'
          ? { modelId: 'm-qa', origin: 'area', routingPreference: null, skipped: [] }
          : null,
    })),
  };
}

const SEM_MODELO_AGENTE = settingsPtBR.modelsSection.originChainNoModel;
const SEM_PADRAO_AREA = settingsPtBR.areaModels.originChainNoModel;
const NAO_LIDO = settingsPtBR.resolvedBindings.cellUnread;
const LENDO = settingsPtBR.resolvedBindings.cellLoading;

beforeEach(() => {
  vi.clearAllMocks();
  getProject.mockResolvedValue(project());
  listModels.mockResolvedValue({ local: {}, cloud: {} });
  getProjectModelBinding.mockResolvedValue(null);
  getWorkspaceModelBinding.mockResolvedValue(null);
  getProjectAgentCosts.mockResolvedValue([]);
  useCurrentWorkspaceWithRole.mockReturnValue({
    data: { role: 'maintainer', workspace: { id: 'ws-1' } },
  });
});

describe('bindings resolvidos em lote nas seções de modelo (AT-334, RN-654)', () => {
  it('caminho feliz: as duas seções renderizam a partir de UMA leitura em lote, sem rota por chave', async () => {
    getResolvedModelBindings.mockResolvedValue(lote());

    montar(
      <>
        <ModelsSection projectId="proj-1" />
        <AreaModelsSection projectId="proj-1" />
      </>,
    );

    // Só a linha do Arquiteto divergiu — e só a área de QA tem padrão próprio.
    // Cada seção tem o seu "voltar a herdar": um na tabela, um no card de QA.
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /voltar a herdar/i })).toHaveLength(2),
    );
    // Os demais 16 agentes e as outras 2 áreas: a afirmação da api, `null`.
    expect(screen.getAllByText(SEM_MODELO_AGENTE)).toHaveLength(AGENT_LIST.length - 1);
    expect(screen.getAllByText(SEM_PADRAO_AREA)).toHaveLength(Object.keys(AREAS).length - 1);

    expect(getResolvedModelBindings).toHaveBeenCalledTimes(1);
    expect(getResolvedModelBindings).toHaveBeenCalledWith(
      'proj-1',
      AGENT_LIST.map((a) => a.key),
      Object.keys(AREAS),
    );
    expect(getAgentModelBinding).not.toHaveBeenCalled();
    expect(getAreaModelBinding).not.toHaveBeenCalled();
    expect(screen.queryByText(NAO_LIDO)).toBeNull();
    expect(screen.queryByText(LENDO)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('CASO DE FALHA: o lote que falha é dito com a frase da api, e nenhuma linha vira "sem modelo"', async () => {
    const { ApiError } = await import('../../lib/api-client');
    getResolvedModelBindings.mockRejectedValue(
      new ApiError(503, { message: 'Banco indisponível agora' }),
    );

    montar(
      <>
        <ModelsSection projectId="proj-1" />
        <AreaModelsSection projectId="proj-1" />
      </>,
    );

    // Uma frase por seção, com o motivo da api.
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    const avisos = screen.getAllByRole('alert');
    for (const aviso of avisos) expect(aviso.textContent).toContain('Banco indisponível agora');

    // Todas as 17 linhas e os 3 cards dizem "não lido" — e NENHUMA diz "sem
    // modelo", que seria afirmar o que não se leu.
    expect(screen.getAllByText(NAO_LIDO)).toHaveLength(
      AGENT_LIST.length + Object.keys(AREAS).length,
    );
    expect(screen.queryByText(SEM_MODELO_AGENTE)).toBeNull();
    expect(screen.queryByText(SEM_PADRAO_AREA)).toBeNull();
    expect(screen.queryByRole('button', { name: /voltar a herdar/i })).toBeNull();

    // Reler resolve: a MESMA chave serve as duas seções.
    getResolvedModelBindings.mockResolvedValue(lote());
    fireEvent.click(screen.getAllByRole('button', { name: /tentar de novo/i })[0]);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getAllByText(SEM_MODELO_AGENTE)).toHaveLength(AGENT_LIST.length - 1);
    expect(screen.queryByText(NAO_LIDO)).toBeNull();
  });

  it('enquanto o lote não responde, a linha diz que está lendo — não que não há modelo', async () => {
    getResolvedModelBindings.mockReturnValue(new Promise(() => {}));

    montar(<ModelsSection projectId="proj-1" />);

    expect(await screen.findAllByText(LENDO)).toHaveLength(AGENT_LIST.length);
    expect(screen.queryByText(SEM_MODELO_AGENTE)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
