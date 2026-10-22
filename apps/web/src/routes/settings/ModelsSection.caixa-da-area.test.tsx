import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import settingsPtBR from '../../locales/pt-BR/settings.json';
import settingsEn from '../../locales/en/settings.json';
import modelsPtBR from '../../locales/pt-BR/models.json';
import modelsEn from '../../locales/en/models.json';
import { ToastProvider } from '../../components/ui/ToastProvider';
import type { Project } from '../../lib/api-types';
import { ModelsSection } from './ModelsSection';
import { loteSobreLeiturasPorChave } from '../../test/lote-de-bindings';

/**
 * AT-601: a caixa "Valer para a área" diz em TEXTO por que está inerte quando o
 * lead não tem modelo vigente. O motivo de `maintainer` já está no subtítulo
 * (`needsMaintainerArea`) e não se repete na caixa.
 */

const getProject = vi.fn();
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
    listAgentAreas: vi.fn(() => Promise.resolve([])),
    listModels: (...args: unknown[]) => listModels(...args),
    listProviderCapabilities: () => Promise.resolve([]),
    getAgentModelBinding: (...args: unknown[]) => getAgentModelBinding(...args),
    getResolvedModelBindings: (p: string, a: readonly string[], ar: readonly string[]) =>
      loteSobreLeiturasPorChave(getAgentModelBinding, getAreaModelBinding)(p, a, ar),
    setAgentModelBinding: vi.fn(),
    clearAgentModelBinding: vi.fn(),
    getAreaModelBinding: (...args: unknown[]) => getAreaModelBinding(...args),
    setAreaModelBinding: vi.fn(),
    clearAreaModelBinding: vi.fn(),
    getProjectModelBinding: (...args: unknown[]) => getProjectModelBinding(...args),
    getWorkspaceModelBinding: (...args: unknown[]) => getWorkspaceModelBinding(...args),
    getProjectAgentCosts: (...args: unknown[]) => getProjectAgentCosts(...args),
  };
});

const TEXTO_SEM_MODELO = 'Escolha um modelo para o lead antes';

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
    mirrorPath: null,
    language: 'pt-BR',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...over,
  };
}

function montar(secao: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    resources: {
      'pt-BR': { settings: settingsPtBR, models: modelsPtBR },
      en: { settings: settingsEn, models: modelsEn },
    },
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

beforeEach(() => {
  vi.clearAllMocks();
  getProject.mockResolvedValue(project());
  listModels.mockResolvedValue({ local: {}, cloud: {} });
  getAgentModelBinding.mockResolvedValue(null);
  getAreaModelBinding.mockResolvedValue(null);
  getProjectModelBinding.mockResolvedValue(null);
  getWorkspaceModelBinding.mockResolvedValue(null);
  getProjectAgentCosts.mockResolvedValue([]);
  useCurrentWorkspaceWithRole.mockReturnValue({ data: { role: 'maintainer' } });
});

describe('caixa da área diz por que está inerte (AT-601)', () => {
  it('lead sem modelo vigente: o motivo aparece em texto e a caixa fica inerte', async () => {
    // Nenhum binding em nenhum nível: o lead não tem modelo vigente.
    montar(<ModelsSection projectId="proj-1" />);

    const caixas = await screen.findAllByRole('checkbox', { name: /Valer para a área/ });
    expect(caixas.length).toBeGreaterThan(0);
    for (const caixa of caixas) expect(caixa).toBeDisabled();
    expect(screen.getAllByText(new RegExp(TEXTO_SEM_MODELO)).length).toBeGreaterThan(0);
  });

  it('lead com modelo vigente: o texto não aparece e a caixa está habilitada', async () => {
    getAgentModelBinding.mockImplementation((_p: string, slug: string) =>
      Promise.resolve(
        ['dev-lead', 'qa', 'infra'].includes(slug)
          ? { modelId: 'm-area', origin: 'project', skipped: [] }
          : null,
      ),
    );
    montar(<ModelsSection projectId="proj-1" />);

    const caixas = await screen.findAllByRole('checkbox', { name: /Valer para a área/ });
    await waitFor(() => {
      for (const caixa of caixas) expect(caixa).toBeEnabled();
    });
    expect(screen.queryByText(new RegExp(TEXTO_SEM_MODELO))).toBeNull();
  });
});
