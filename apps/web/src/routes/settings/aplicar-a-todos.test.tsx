import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import settingsPtBR from '../../locales/pt-BR/settings.json';
import modelsPtBR from '../../locales/pt-BR/models.json';
import { ToastProvider } from '../../components/ui/ToastProvider';
import { ApiError } from '../../lib/api-client';
import { AGENT_LIST } from '../../lib/agents';
import type { Model, ModelsByCategory, Project } from '../../lib/api-types';
import { ModelsSection } from './ModelsSection';

/**
 * Aplicar UM modelo a todos os agentes de uma vez — os TRÊS desfechos.
 *
 * A ação é N chamadas e não uma transação, então o que este arquivo prova não
 * é "gravou": é que a tela nunca afirma o que não obteve
 * ([RN-469](docs/business-rules.md#rn-469)). Os três estados não podem se
 * disfarçar um do outro, e o do meio — ALGUMAS passaram — é o que só existe
 * porque a ação é em lote: ele precisa dizer quantas de quantas e NOMEAR as
 * que ficaram, porque a pessoa não tem outro jeito de descobrir quais linhas
 * continuam com o modelo antigo.
 *
 * Prova também o que a ação NÃO faz: não aborta na primeira recusa. Com 19
 * agentes, abortar deixaria 18 linhas sem tentativa nenhuma, e o relatório não
 * teria como distinguir "recusou" de "nem tentou".
 */

const getProject = vi.fn();
const listModels = vi.fn();
const getAgentModelBinding = vi.fn();
const getAreaModelBinding = vi.fn();
const getProjectModelBinding = vi.fn();
const getWorkspaceModelBinding = vi.fn();
const getProjectAgentCosts = vi.fn();
const setAgentModelBinding = vi.fn();

// `developer` é o mínimo do endpoint que a barra chama
// (`PUT .../agent-bindings/:slug`) — o mesmo dos controles de linha, e NÃO o
// `maintainer` da seção irmã de área (RN-102). Quem não pode é assunto do
// caso "papel abaixo de developer", no fim deste arquivo.
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
    // Entram de VERDADE: o desfecho de "nenhuma passou" é a frase que
    // `mensagemDaApi` extrai do corpo — dublá-la testaria o dublê.
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getProject: (...args: unknown[]) => getProject(...args),
    listModels: (...args: unknown[]) => listModels(...args),
    getAgentModelBinding: (...args: unknown[]) => getAgentModelBinding(...args),
    setAgentModelBinding: (...args: unknown[]) => setAgentModelBinding(...args),
    clearAgentModelBinding: vi.fn(),
    getAreaModelBinding: (...args: unknown[]) => getAreaModelBinding(...args),
    getProjectModelBinding: (...args: unknown[]) =>
      getProjectModelBinding(...args),
    getWorkspaceModelBinding: (...args: unknown[]) =>
      getWorkspaceModelBinding(...args),
    getProjectAgentCosts: (...args: unknown[]) => getProjectAgentCosts(...args),
  };
});

const ESCOLHIDO = 'Modelo do Lote';
/** O agente que vai RECUSAR no caso parcial — é o nome dele que o toast deve nomear. */
const QUE_FALHA = AGENT_LIST[3];

function modelo(over: Partial<Model> = {}): Model {
  return {
    id: 'm-lote',
    provider: 'openrouter',
    name: 'lote',
    displayName: ESCOLHIDO,
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
  local: {},
  cloud: { openrouter: [modelo()] },
} as unknown as ModelsByCategory;

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
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  };
}

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

/**
 * A barra do lote, pelo NOME ACESSÍVEL do grupo. Buscar o picker dela por
 * texto não funcionaria: 18 das 19 linhas não têm binding e os gatilhos delas
 * dizem a mesma frase, "Selecionar modelo".
 */
async function barraDoLote() {
  return within(
    await screen.findByRole('group', { name: /Aplicar um modelo a todos/i }),
  );
}

/** Escolhe o modelo na barra e clica em aplicar. */
async function aplicarATodos() {
  montar(<ModelsSection projectId="proj-1" />);
  const barra = await barraDoLote();
  fireEvent.click(barra.getByRole('button', { name: /Selecionar modelo/i }));
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(ESCOLHIDO) }));
  fireEvent.click((await barraDoLote()).getByRole('button', { name: /Aplicar aos/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  getProject.mockResolvedValue(project());
  listModels.mockResolvedValue(MODELOS);
  getAgentModelBinding.mockResolvedValue(null);
  getAreaModelBinding.mockResolvedValue(null);
  getProjectModelBinding.mockResolvedValue(null);
  getWorkspaceModelBinding.mockResolvedValue(null);
  getProjectAgentCosts.mockResolvedValue([]);
  setAgentModelBinding.mockResolvedValue(undefined);
  useCurrentWorkspaceWithRole.mockReturnValue({
    data: { workspace: { id: 'ws-1' }, role: 'developer' },
  });
});

describe('aplicar a todos — caminho feliz', () => {
  it('grava o mesmo modelo em TODOS os agentes, na ordem da tela', async () => {
    await aplicarATodos();

    await waitFor(() =>
      expect(setAgentModelBinding).toHaveBeenCalledTimes(AGENT_LIST.length),
    );
    // A ordem importa: é a do relatório que a pessoa lê quando algo falha.
    expect(setAgentModelBinding.mock.calls.map((c) => c[1])).toEqual(
      AGENT_LIST.map((a) => a.key),
    );
    // Um único modelo — a promessa inteira da ação.
    expect(
      setAgentModelBinding.mock.calls.every((c) => c[2] === 'm-lote'),
    ).toBe(true);

    expect(
      await screen.findByText(new RegExp(`${ESCOLHIDO} aplicado aos`)),
    ).toBeTruthy();
  });
});

describe('aplicar a todos — NENHUMA passou', () => {
  it('repassa a frase da api e nunca diz quantas salvou', async () => {
    setAgentModelBinding.mockRejectedValue(
      new ApiError(422, { message: 'Modelo não faz tool calling' }),
    );

    await aplicarATodos();

    // Não abortou na primeira recusa: as 19 foram tentadas.
    await waitFor(() =>
      expect(setAgentModelBinding).toHaveBeenCalledTimes(AGENT_LIST.length),
    );
    expect(await screen.findByText(/Modelo não faz tool calling/)).toBeTruthy();
    // "Salvou 0 de 19" seria uma contagem no lugar do motivo — o desfecho de
    // nenhuma é a mensagem da api, e só ela.
    expect(screen.queryByText(/Salvou/)).toBeNull();
  });
});

describe('aplicar a todos — ALGUMAS passaram', () => {
  it('diz quantas de quantas e NOMEIA a que ficou', async () => {
    setAgentModelBinding.mockImplementation((_p: string, slug: string) =>
      slug === QUE_FALHA.key
        ? Promise.reject(new ApiError(422, { message: 'Modelo desativado' }))
        : Promise.resolve(undefined),
    );

    await aplicarATodos();

    await waitFor(() =>
      expect(setAgentModelBinding).toHaveBeenCalledTimes(AGENT_LIST.length),
    );
    expect(
      await screen.findByText(
        new RegExp(`Salvou ${AGENT_LIST.length - 1} de ${AGENT_LIST.length}`),
      ),
    ).toBeTruthy();
    // O NOME do agente, nunca o slug: é o que a pessoa lê na primeira coluna.
    // A busca é pela FRASE do detalhe, e não pelo nome solto — solto ele casa
    // também com a linha do agente na tabela, e o teste passaria sem que o
    // toast nomeasse coisa nenhuma.
    expect(
      await screen.findByText(
        new RegExp(`Não salvou:.*${QUE_FALHA.name}`),
      ),
    ).toBeTruthy();
    // Nem "aplicado a todos" nem a frase de erro seco: as duas seriam mentira.
    expect(screen.queryByText(new RegExp(`${ESCOLHIDO} aplicado aos`))).toBeNull();
  });
});

describe('aplicar a todos — papel abaixo de developer', () => {
  it('deixa o botão inerte, e o motivo continua dito em texto na seção', async () => {
    useCurrentWorkspaceWithRole.mockReturnValue({
      data: { workspace: { id: 'ws-1' }, role: 'viewer' },
    });

    montar(<ModelsSection projectId="proj-1" />);
    const barra = await barraDoLote();

    expect(
      barra.getByRole('button', { name: /Aplicar aos/i }).hasAttribute('disabled'),
    ).toBe(true);
    // O motivo é dito UMA vez, em TEXTO, na legenda — `title` em elemento
    // `disabled` não abre no Chromium (ADR 0064).
    expect(
      await screen.findByText(/aplicar um a todos os agentes/i),
    ).toBeTruthy();
  });
});
