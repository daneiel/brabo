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
import type { Project } from '../../lib/api-types';
import { ModelsSection } from './ModelsSection';

/**
 * "Voltar a herdar" na tabela de Modelos por agente — o DESFECHO de cada
 * resposta da api.
 *
 * O que este arquivo protege não é a redação dos toasts, é a distinção entre
 * três desfechos que antes eram um só (nenhum): `handleClearAgentBinding` não
 * tinha `try/catch` e era chamada de um `onClick`, então toda recusa da api
 * virava `unhandled promise rejection` — silêncio na tela e ruído no console.
 *
 * A recusa não é hipotética. O botão aparece em TODA origem `agent` de
 * propósito ([RN-470](docs/business-rules/custo.md)), inclusive nas linhas em
 * que o agente já herda o modelo do Criativo e não há linha em
 * `model_bindings` para apagar — ali a api responde 404, e está certa em
 * responder (`ClearModelBindingUseCase`).
 *
 * E o 404 tem desfecho PRÓPRIO: o estado que quem clicou pediu já é verdade,
 * então a tela não o chama de erro nem repete a frase pt-BR cravada na api
 * para quem está lendo em inglês. Os dois últimos casos abaixo são os que
 * quebram se alguém colapsar o 404 nas outras falhas.
 */

const getProject = vi.fn();
const listModels = vi.fn();
const getAgentModelBinding = vi.fn();
const getAreaModelBinding = vi.fn();
const getProjectModelBinding = vi.fn();
const getWorkspaceModelBinding = vi.fn();
const getProjectAgentCosts = vi.fn();
const clearAgentModelBinding = vi.fn();

// A seção lê o papel de quem está olhando para decidir se o "voltar a herdar" é
// clicável — e o hook real chamaria `listWorkspaces`, que o dublê de
// `api-client` abaixo não exporta. `developer` é o MÍNIMO que
// `DELETE .../agent-bindings/:slug` exige: este arquivo é sobre os desfechos do
// clique, então quem clica tem de poder clicar. Quem NÃO pode é o assunto de
// `papel-na-tabela-de-agentes.test.tsx`.
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
    // `ApiError` e `mensagemDaApi` entram de VERDADE: o que se prova aqui é a
    // leitura do status e a extração da frase do corpo — dublar os dois
    // testaria o dublê.
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getProject: (...args: unknown[]) => getProject(...args),
    listModels: (...args: unknown[]) => listModels(...args),
    getAgentModelBinding: (...args: unknown[]) => getAgentModelBinding(...args),
    setAgentModelBinding: vi.fn(),
    clearAgentModelBinding: (...args: unknown[]) =>
      clearAgentModelBinding(...args),
    getAreaModelBinding: (...args: unknown[]) => getAreaModelBinding(...args),
    getProjectModelBinding: (...args: unknown[]) =>
      getProjectModelBinding(...args),
    getWorkspaceModelBinding: (...args: unknown[]) =>
      getWorkspaceModelBinding(...args),
    getProjectAgentCosts: (...args: unknown[]) => getProjectAgentCosts(...args),
  };
});

/** A frase pt-BR que a api crava no 404 (`ClearModelBindingUseCase`). */
const FRASE_DA_API = 'Não há binding de agent para apagar — este escopo já herda.';

/** O agente que diverge em todos os casos: só a linha dele tem o botão. */
const SLUG = 'qa-automacao';

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

/** Quantas vezes a api foi perguntada pelo binding DESTE agente. */
function leiturasDoAgente() {
  return getAgentModelBinding.mock.calls.filter((c) => c[1] === SLUG).length;
}

async function clicarEmVoltarAHerdar(idioma: 'pt-BR' | 'en' = 'pt-BR') {
  montar(<ModelsSection projectId="proj-1" />, idioma);
  const rotulo = idioma === 'pt-BR' ? 'voltar a herdar' : 'go back to inheriting';
  const botao = await screen.findByRole('button', { name: rotulo });
  const antes = leiturasDoAgente();
  fireEvent.click(botao);
  return antes;
}

beforeEach(() => {
  vi.clearAllMocks();
  getProject.mockResolvedValue(project());
  listModels.mockResolvedValue({ local: {}, cloud: {} });
  // Só o agente do `SLUG` tem binding próprio — o botão nasce numa linha só, e
  // `findByRole` não precisa desempatar entre doze.
  getAgentModelBinding.mockImplementation((_p: string, slug: string) =>
    Promise.resolve(
      slug === SLUG ? { modelId: 'm-agente', origin: 'agent', skipped: [] } : null,
    ),
  );
  getAreaModelBinding.mockResolvedValue(null);
  getProjectModelBinding.mockResolvedValue(null);
  getWorkspaceModelBinding.mockResolvedValue(null);
  getProjectAgentCosts.mockResolvedValue([]);
  clearAgentModelBinding.mockResolvedValue(undefined);
  useCurrentWorkspaceWithRole.mockReturnValue({
    data: { workspace: { id: 'ws-1' }, role: 'developer' },
  });
});

describe('voltar a herdar — caminho feliz', () => {
  it('apaga o binding do agente, avisa e relê a linha', async () => {
    const antes = await clicarEmVoltarAHerdar();

    await waitFor(() =>
      expect(clearAgentModelBinding).toHaveBeenCalledWith('proj-1', SLUG),
    );
    // O nome do agente, não o slug: o toast fala da linha que a pessoa clicou.
    expect(await screen.findByText('QA de Automação voltou a herdar')).toBeInTheDocument();
    // A linha relê: o modelo vigente e a cadeia mudaram no banco.
    await waitFor(() => expect(leiturasDoAgente()).toBeGreaterThan(antes));
  });
});

describe('voltar a herdar — a api recusa', () => {
  /**
   * O caso REAL e alcançável: o agente já herdava (do Criativo, via
   * `herdarModeloDeStart`), não havia linha para apagar, e a api devolve 404.
   * Antes disto o clique virava `unhandled promise rejection`.
   */
  it('404: não é erro — diz que já herdava e relê a linha, que estava velha', async () => {
    clearAgentModelBinding.mockRejectedValue(
      new ApiError(404, { message: FRASE_DA_API }),
    );
    const antes = await clicarEmVoltarAHerdar();

    expect(
      await screen.findByText(
        'QA de Automação já herdava — não havia modelo próprio para apagar',
      ),
    ).toBeInTheDocument();
    // O 404 NÃO passa por `mensagemDaApi`: a frase da api não chega à tela.
    expect(screen.queryByText(FRASE_DA_API)).toBeNull();
    // Se a api diz que não havia linha, quem estava velha era a TELA.
    await waitFor(() => expect(leiturasDoAgente()).toBeGreaterThan(antes));
  });

  /**
   * O motivo 1 do desfecho próprio: a frase do 404 é pt-BR cravada no código
   * da api e o idioma default do web é `en` (`lib/i18n.ts`). Repassá-la faria
   * quem lê em inglês ler português.
   */
  it('404 em `en`: a mensagem é do cliente, no idioma de quem lê', async () => {
    clearAgentModelBinding.mockRejectedValue(
      new ApiError(404, { message: FRASE_DA_API }),
    );
    await clicarEmVoltarAHerdar('en');

    expect(
      await screen.findByText(
        'QA de Automação already inherited — there was no model of its own to delete',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(FRASE_DA_API)).toBeNull();
  });

  /**
   * Qualquer outro status continua sendo falha de verdade, e aí a frase da api
   * é a informação mais útil que existe — mesma gramática de
   * `AreaModelsSection`.
   */
  it('outro status: a frase da api vai para a tela, e a linha NÃO é relida', async () => {
    clearAgentModelBinding.mockRejectedValue(
      new ApiError(403, { message: 'Papel insuficiente para esta ação' }),
    );
    const antes = await clicarEmVoltarAHerdar();

    expect(
      await screen.findByText('Papel insuficiente para esta ação'),
    ).toBeInTheDocument();
    expect(leiturasDoAgente()).toBe(antes);
  });
});
