import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import settingsPtBR from '../../locales/pt-BR/settings.json';
import modelsPtBR from '../../locales/pt-BR/models.json';
import { ToastProvider } from '../../components/ui/ToastProvider';
import type { Model, ModelsByCategory, Project } from '../../lib/api-types';
import { ModelsSection } from './ModelsSection';
import { AreaModelsSection } from './AreaModelsSection';

/**
 * O ESTADO INICIAL do filtro "aptos para agentes" nas duas seções que gravam
 * num escopo em que a api exige tool calling.
 *
 * O defeito: `ModelPicker` tinha o prop `filtroDeAgentesPadrao` desde a Fase
 * 9c e NENHUMA tela de produção o passava — só este tipo de teste. O seletor
 * de um agente abria com o filtro desmarcado, oferecendo modelo chat-only cujo
 * clique a api recusa com 422, e a frase da recusa manda a pessoa justamente
 * para o filtro que ninguém ligava ([RN-040](docs/business-rules/custo.md#rn-040)).
 *
 * ## Por que as DUAS seções, e não só a de agente
 *
 * A régua não é a tela, é o escopo: `assertModelFitsBindingScope`
 * (`apps/api/src/domain/llm/model-capabilities.ts`) exige tool calling em
 * `agent` e em `area`, e em mais nenhum. A área entrou nessa régua no ADR 0064
 * porque o único consumidor do modelo de uma área é um agente dela — o mesmo
 * 422 alcança quem escolhe nas duas telas. O seletor de SESSÃO fica de fora
 * pelo mesmo critério, e isso é provado em
 * `SessionPage.filtro-de-aptos.test.tsx`.
 *
 * O que este arquivo NÃO afirma: que o 422 deixou de existir. O filtro cobre
 * uma das três causas — as outras duas ([RN-043](docs/business-rules/custo.md#rn-043):
 * modelo desativado no workspace, modelo sumido do provider) continuam
 * alcançáveis daqui, e é por isso que os toasts de `troca-de-modelo.test.tsx`
 * seguem valendo.
 */

const getProject = vi.fn();
const listModels = vi.fn();
const getAgentModelBinding = vi.fn();
const getAreaModelBinding = vi.fn();
const getProjectModelBinding = vi.fn();
const getWorkspaceModelBinding = vi.fn();
const getProjectAgentCosts = vi.fn();
const useCurrentWorkspaceWithRole = vi.fn();

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

vi.mock('../../lib/hooks', () => ({
  useCurrentWorkspaceWithRole: () => useCurrentWorkspaceWithRole(),
}));

/** O agente que tem binding próprio: a única linha cujo gatilho tem NOME. */
const SLUG = 'qa-automacao';

const COM_FERRAMENTAS = 'Com ferramentas';
const TAGARELA = 'Tagarela';

function modelo(over: Partial<Model> = {}): Model {
  return {
    id: 'm-tools',
    provider: 'ollama',
    name: 'tools',
    displayName: COM_FERRAMENTAS,
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

const CHAT_ONLY = modelo({
  id: 'm-chat',
  name: 'chat',
  displayName: TAGARELA,
  supportsToolCalling: false,
});

const MODELOS: ModelsByCategory = {
  local: { ollama: [modelo(), CHAT_ONLY] },
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
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  };
}

/**
 * Só `pt-BR`: o que se prova aqui é o estado de um checkbox e a presença de um
 * aviso, e nenhum dos dois muda com o idioma.
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

/** Abre o picker da linha do `SLUG` — a que tem modelo vigente com nome. */
async function abrirPickerDoAgente() {
  montar(<ModelsSection projectId="proj-1" />);
  fireEvent.click(
    await screen.findByRole('button', { name: new RegExp(COM_FERRAMENTAS) }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getProject.mockResolvedValue(project());
  listModels.mockResolvedValue(MODELOS);
  getAgentModelBinding.mockImplementation((_p: string, slug: string) =>
    Promise.resolve(
      slug === SLUG ? { modelId: 'm-tools', origin: 'agent', skipped: [] } : null,
    ),
  );
  getAreaModelBinding.mockResolvedValue({
    modelId: 'm-tools',
    origin: 'area',
    skipped: [],
  });
  getProjectModelBinding.mockResolvedValue(null);
  getWorkspaceModelBinding.mockResolvedValue(null);
  getProjectAgentCosts.mockResolvedValue([]);
  useCurrentWorkspaceWithRole.mockReturnValue({
    data: { workspace: { id: 'ws-1' }, role: 'maintainer' },
  });
});

describe('binding de AGENTE — o picker abre com o filtro marcado', () => {
  it('o chat-only não é oferecido, e o apto é', async () => {
    await abrirPickerDoAgente();

    expect((await screen.findByRole('checkbox')) as HTMLInputElement).toBeChecked();
    expect(screen.queryByText(TAGARELA)).toBeNull();
    // Mais de UM: o nome aparece no gatilho E na opção da lista aberta. Só o
    // gatilho não provaria que o apto continua sendo oferecido.
    expect(screen.getAllByText(COM_FERRAMENTAS).length).toBeGreaterThan(1);
  });

  it('desmarcar volta a listar TUDO — é estado inicial, não trava', async () => {
    await abrirPickerDoAgente();

    fireEvent.click(await screen.findByRole('checkbox'));

    expect(screen.getByText(TAGARELA)).toBeInTheDocument();
  });
});

describe('binding de ÁREA — o picker abre com o filtro marcado', () => {
  it('o chat-only não é oferecido em nenhuma área', async () => {
    montar(<AreaModelsSection projectId="proj-1" />);

    const pickers = await screen.findAllByRole('button', {
      name: new RegExp(`${COM_FERRAMENTAS}|Selecionar modelo`),
    });
    fireEvent.click(pickers[0]!);

    expect((await screen.findByRole('checkbox')) as HTMLInputElement).toBeChecked();
    expect(screen.queryByText(TAGARELA)).toBeNull();
  });
});

/**
 * A consequência de ligar o filtro por padrão, e o motivo de ela não ser caso
 * de borda: `GET .../agent-bindings/:slug` chama `ResolveModelBindingUseCase`
 * SEM `exigeToolCalling`, então um padrão chat-only de projeto ou workspace é
 * resolvido normalmente e vira o vigente da linha. O gatilho passa a mostrar
 * um nome que a lista aberta não contém, sem nenhuma opção marcada.
 *
 * A tela DIZ isso, em vez de deixar a lista contradizer o gatilho em silêncio
 * — mesma disciplina da [RN-470](docs/business-rules/custo.md#rn-470): a tela
 * não afirma um estado e o desmente logo abaixo. E pode nomear a causa porque
 * só existe um filtro neste picker: sumir da lista com ele ligado só pode ser
 * falta de tool calling.
 */
describe('o vigente que o filtro esconde', () => {
  beforeEach(() => {
    // O agente herda do PROJETO um modelo chat-only — o que a api resolve e o
    // filtro esconde.
    getAgentModelBinding.mockResolvedValue({
      modelId: 'm-chat',
      origin: 'project',
      skipped: [],
    });
    getProjectModelBinding.mockResolvedValue({
      modelId: 'm-chat',
      origin: 'project',
      skipped: [],
    });
  });

  it('o gatilho mostra o vigente e a lista explica por que ele não está nela', async () => {
    montar(<ModelsSection projectId="proj-1" />);
    fireEvent.click(
      (await screen.findAllByRole('button', { name: new RegExp(TAGARELA) }))[0]!,
    );

    expect(
      await screen.findByText(
        `O modelo vigente (${TAGARELA}) não faz tool calling nativo e está fora desta lista.`,
      ),
    ).toBeInTheDocument();
  });

  it('desmarcado, o aviso some — ele descreve o filtro, não o modelo', async () => {
    montar(<ModelsSection projectId="proj-1" />);
    fireEvent.click(
      (await screen.findAllByRole('button', { name: new RegExp(TAGARELA) }))[0]!,
    );
    fireEvent.click(await screen.findByRole('checkbox'));

    expect(screen.queryByText(/está fora desta lista/)).toBeNull();
  });

  /**
   * O contraste: quando NENHUM modelo passa no filtro, quem fala é o vazio
   * (`noToolCallingModels`), que já manda desmarcar. Dois avisos sobre o mesmo
   * checkbox seriam ruído, e o vazio é a frase mais completa das duas.
   */
  it('com a lista inteira vazia, quem fala é o vazio — não os dois', async () => {
    listModels.mockResolvedValue({
      local: { ollama: [CHAT_ONLY] },
      cloud: {},
    } as ModelsByCategory);

    montar(<ModelsSection projectId="proj-1" />);
    fireEvent.click(
      (await screen.findAllByRole('button', { name: new RegExp(TAGARELA) }))[0]!,
    );

    expect(
      await screen.findByText(/Nenhum modelo faz tool calling nativo/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/está fora desta lista/)).toBeNull();
  });
});
