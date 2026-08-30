import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import settingsPtBR from '../../locales/pt-BR/settings.json';
import modelsPtBR from '../../locales/pt-BR/models.json';
import { ToastProvider } from '../../components/ui/ToastProvider';
import { ApiError } from '../../lib/api-client';
import type { Model, ModelsByCategory, Project } from '../../lib/api-types';
import { ModelsSection } from './ModelsSection';

/**
 * Trocar o modelo de um agente na tabela **Modelos por agente** — o DESFECHO
 * de cada resposta da api.
 *
 * `handleModelChange` não tinha `try/catch` e era chamada do `onSelect` de um
 * `ModelPicker`: toda recusa virava `unhandled promise rejection`. A pessoa
 * escolhia um modelo, a tela não se mexia, e o erro só existia no console —
 * a mesma classe de defeito que `voltar-a-herdar.test.tsx` fixou na função
 * irmã, uma dúzia de linhas abaixo no mesmo arquivo.
 *
 * ## Por que este arquivo, e não mais um `describe` naquele
 *
 * Aquele arquivo é sobre UMA ação e diz isso no nome. O que o 404 significa é
 * o assunto dele inteiro — cabeçalho, três casos e a redação dos toasts —, e
 * aqui o 404 significa o oposto: **não** tem desfecho próprio. Juntar as duas
 * ações num arquivo só exigiria reescrever o cabeçalho de lá para caber a
 * exceção, transformando "o 404 desta ação não é falha" em "às vezes é". O
 * preço é o arranjo de mocks duplicado; o teste que ele evitaria é o teste que
 * mais importa aqui, que é justamente o CONTRASTE entre as duas funções.
 *
 * A recusa não é hipotética, e a alcançável é a de 422: o picker mostra o
 * modelo `unavailable` MARCADO em vez de escondê-lo (senão o binding que
 * aponta para ele ficaria sem explicação), e nada impede clicar nele —
 * `SetModelBindingUseCase` recusa com `ModelNotBindableError`
 * ([RN-043](docs/business-rules/custo.md#rn-043)).
 */

const getProject = vi.fn();
const listModels = vi.fn();
const getAgentModelBinding = vi.fn();
const getAreaModelBinding = vi.fn();
const getProjectModelBinding = vi.fn();
const getWorkspaceModelBinding = vi.fn();
const getProjectAgentCosts = vi.fn();
const setAgentModelBinding = vi.fn();

// A seção lê o papel de quem está olhando para decidir se o `ModelPicker` e o
// "voltar a herdar" são clicáveis — e o hook real chamaria `listWorkspaces`,
// que o dublê de `api-client` abaixo não exporta. `developer` é o MÍNIMO que
// os dois endpoints de agente exigem (`agent-bindings`,
// `model-bindings.controller.ts`): este arquivo é sobre os desfechos do
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

/** O agente que tem binding próprio: a linha em que o vigente tem NOME. */
const SLUG = 'qa-automacao';

const VIGENTE = 'Modelo Atual';
const ESCOLHIDO = 'Modelo Novo';

function modelo(over: Partial<Model> = {}): Model {
  return {
    id: 'm-atual',
    provider: 'ollama',
    name: 'atual',
    displayName: VIGENTE,
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
      // `unavailable` de propósito: é o modelo que a api vai recusar, e ele
      // aparece na lista porque o picker marca o indisponível em vez de
      // escondê-lo. Sem isso o caso de falha seria hipotético.
      modelo({ id: 'm-novo', name: 'novo', displayName: ESCOLHIDO, availability: 'unavailable' }),
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
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  };
}

/**
 * Só `pt-BR`, ao contrário de `voltar-a-herdar.test.tsx`: lá o idioma É o
 * assunto (o 404 vira frase do cliente, e a prova é ela mudar em `en`). Aqui
 * nenhum desfecho é escrito pelo cliente — todos repassam a frase da api, que
 * é a mesma nos dois idiomas —, então um segundo idioma não provaria nada.
 */
function montar(secao: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    resources: {
      'pt-BR': { settings: settingsPtBR, models: modelsPtBR },
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

/** Quantas vezes a api foi perguntada pelo binding DESTE agente. */
function leiturasDoAgente() {
  return getAgentModelBinding.mock.calls.filter((c) => c[1] === SLUG).length;
}

/**
 * Abre o picker da linha do `SLUG` — a única cujo gatilho tem NOME de modelo,
 * porque só ela tem binding — e escolhe o outro modelo da lista.
 */
async function escolherOutroModelo() {
  montar(<ModelsSection projectId="proj-1" />);
  const gatilho = await screen.findByRole('button', { name: new RegExp(VIGENTE) });
  const antes = leiturasDoAgente();
  fireEvent.click(gatilho);
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(ESCOLHIDO) }));
  return antes;
}

beforeEach(() => {
  vi.clearAllMocks();
  getProject.mockResolvedValue(project());
  listModels.mockResolvedValue(MODELOS);
  getAgentModelBinding.mockImplementation((_p: string, slug: string) =>
    Promise.resolve(
      slug === SLUG ? { modelId: 'm-atual', origin: 'agent', skipped: [] } : null,
    ),
  );
  getAreaModelBinding.mockResolvedValue(null);
  getProjectModelBinding.mockResolvedValue(null);
  getWorkspaceModelBinding.mockResolvedValue(null);
  getProjectAgentCosts.mockResolvedValue([]);
  setAgentModelBinding.mockResolvedValue(undefined);
  useCurrentWorkspaceWithRole.mockReturnValue({
    data: { workspace: { id: 'ws-1' }, role: 'developer' },
  });
});

describe('trocar o modelo do agente — caminho feliz', () => {
  it('grava a escolha e relê a linha', async () => {
    const antes = await escolherOutroModelo();

    await waitFor(() =>
      expect(setAgentModelBinding).toHaveBeenCalledWith('proj-1', SLUG, 'm-novo'),
    );
    // O modelo vigente, a cadeia da coluna Origem e o fallback mudaram no
    // banco: a linha relê em vez de acreditar no que já tinha.
    await waitFor(() => expect(leiturasDoAgente()).toBeGreaterThan(antes));
  });
});

describe('trocar o modelo do agente — a api recusa', () => {
  /**
   * O caso REAL: o modelo sumiu do provider (ou o owner o desligou no
   * catálogo depois do último `listModels`, que é cacheado). Antes disto o
   * clique virava `unhandled promise rejection`.
   */
  it('422: a frase da api vai para a tela, e a linha NÃO é relida', async () => {
    const FRASE =
      'Modelo "Modelo Novo" não está mais disponível no provider. Escolha outro — os vínculos e o histórico dele são preservados.';
    setAgentModelBinding.mockRejectedValue(new ApiError(422, { message: FRASE }));

    const antes = await escolherOutroModelo();

    expect(await screen.findByText(FRASE)).toBeInTheDocument();
    // Nada mudou no banco — reler seria pedir de novo a mesma resposta.
    expect(leiturasDoAgente()).toBe(antes);
  });

  /**
   * O que a RN-470 e a RN-088 proíbem (`docs/business-rules/custo.md` e
   * `docs/business-rules.md`): a tela afirmando um estado que não existe no
   * banco — nem por traço, nem por enum, nem por otimismo. Depois da recusa a coluna MODELO
   * VIGENTE tem de continuar mostrando o binding que a api confirmou — o
   * `ModelPicker` não guarda a escolha em estado local, e este teste é o que
   * impede alguém de "melhorar" isso com uma atualização otimista sem desfazê-la
   * na recusa.
   */
  it('a linha continua exibindo o modelo antigo, nunca o recusado', async () => {
    setAgentModelBinding.mockRejectedValue(
      new ApiError(422, { message: 'Modelo indisponível' }),
    );

    await escolherOutroModelo();
    await screen.findByText('Modelo indisponível');

    // O dropdown fechou: o único lugar onde um dos dois nomes ainda aparece é
    // o gatilho da linha, e ele mostra o vigente.
    expect(screen.getByRole('button', { name: new RegExp(VIGENTE) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(ESCOLHIDO) })).toBeNull();
  });

  /**
   * O CONTRASTE com `handleClearAgentBinding` (`voltar-a-herdar.test.tsx`),
   * que dá ao 404 um desfecho próprio, em texto do cliente. Ali o 404 tem uma
   * causa só; aqui tem DUAS — "Modelo não encontrado" e "Projeto não
   * encontrado" —, e nenhuma delas é dedutível do status. Escolher uma frase
   * seria a tela afirmando o que não sabe, então o 404 segue a gramática de
   * falha normal como qualquer outro status.
   */
  it('404: NÃO ganha desfecho próprio — segue a gramática de falha normal', async () => {
    setAgentModelBinding.mockRejectedValue(
      new ApiError(404, { message: 'Modelo não encontrado' }),
    );

    await escolherOutroModelo();

    expect(await screen.findByText('Modelo não encontrado')).toBeInTheDocument();
    // A frase que o 404 da função IRMÃ produz não pode vazar para cá.
    expect(
      screen.queryByText(/já herdava — não havia modelo próprio para apagar/),
    ).toBeNull();
  });
});
