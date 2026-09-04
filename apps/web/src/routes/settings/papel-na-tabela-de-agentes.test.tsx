import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import settingsPtBR from '../../locales/pt-BR/settings.json';
import modelsPtBR from '../../locales/pt-BR/models.json';
import { ToastProvider } from '../../components/ui/ToastProvider';
import type { Model, ModelsByCategory, Project } from '../../lib/api-types';
import { roleAtLeast } from '../../lib/roles';
import { ModelsSection } from './ModelsSection';
import { AreaModelsSection } from './AreaModelsSection';

/**
 * O PAPEL na tabela de Modelos por agente — quem pode editar, e quem só lê.
 *
 * O defeito: `ModelsSection` não checava papel nenhum. Os dois controles de
 * cada linha — o `ModelPicker` da coluna MODELO VIGENTE e o "voltar a herdar"
 * da coluna ORIGEM — apareciam clicáveis para todo mundo, `viewer` incluído, e
 * a api recusava com 403. Desde a #441/#440 esse 403 pelo menos vira toast, o
 * que não torna isto desnecessário: oferecer um controle que só existe para
 * ser recusado é a tela mentindo sobre o que a pessoa pode fazer.
 *
 * ## O mínimo é `developer`, e NÃO o `maintainer` da seção irmã
 *
 * É o ponto que este arquivo protege, e a razão de o último caso montar as
 * DUAS seções juntas. A régua é do ENDPOINT, não da tela
 * (`model-bindings.controller.ts`):
 *
 * | endpoint | papel |
 * |---|---|
 * | `PUT`/`DELETE .../agent-bindings/:agentSlug` | `developer` |
 * | `PUT`/`DELETE .../area-bindings/:areaKey` | `maintainer` |
 *
 * A diferença é a regra, não descuido ([RN-102](docs/business-rules/custo.md#rn-102)):
 * o binding do agente alcança UM agente, o da área alcança o lead e todos os
 * subagentes de uma vez. Copiar aqui o gate de `AreaModelsSection` trancaria um
 * `developer` fora de uma ação que a api aceita — o defeito INVERSO, e pior que
 * o original, porque tirar capacidade de quem tem é invisível para quem a
 * perdeu.
 *
 * ## Desabilitar, não esconder
 *
 * Quem não pode editar continua VENDO o modelo vigente e a cadeia de origem
 * (ADR 0064): some o controle, nunca a informação. O motivo de o controle estar
 * apagado é dito uma vez, em TEXTO, na legenda da seção — e não por `title` em
 * cada linha, porque tooltip em elemento `disabled` não abre no Chromium (o
 * navegador não despacha evento de mouse em controle desabilitado).
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
const DA_AREA = 'Modelo da área';

/** As duas regiões — o `<section>` de cada seção tem nome acessível. */
const REGIAO_AGENTES = 'Modelos por agente';
const REGIAO_AREAS = 'Modelo por área';

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
      modelo({ id: 'm-area', name: 'area', displayName: DA_AREA }),
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

/**
 * A comparação que faltava em `lib/roles.ts` e que cada tela vinha refazendo à
 * mão. A linha `developer` é a que a tabela de agentes depende e a que um
 * `role === 'owner' || role === 'maintainer'` copiado da seção irmã erraria.
 */
describe('roleAtLeast — a hierarquia sai de `ROLE_ORDER`, não de nomes à mão', () => {
  it('o mínimo `developer` inclui `developer` e tudo acima dele', () => {
    expect(roleAtLeast('developer', 'developer')).toBe(true);
    expect(roleAtLeast('maintainer', 'developer')).toBe(true);
    expect(roleAtLeast('owner', 'developer')).toBe(true);
    expect(roleAtLeast('viewer', 'developer')).toBe(false);
  });

  it('o mínimo `maintainer` é MAIS estrito: o `developer` não alcança', () => {
    expect(roleAtLeast('developer', 'maintainer')).toBe(false);
    expect(roleAtLeast('maintainer', 'maintainer')).toBe(true);
    expect(roleAtLeast('owner', 'maintainer')).toBe(true);
  });

  it('papel ausente nunca alcança nada — nem o mínimo mais baixo', () => {
    expect(roleAtLeast(undefined, 'viewer')).toBe(false);
    expect(roleAtLeast(null, 'developer')).toBe(false);
  });
});

describe('tabela de agentes — quem NÃO pode editar', () => {
  it('viewer: os dois controles ficam inertes, e o clique não chega na api', async () => {
    comPapel('viewer');
    const { picker, voltar } = await tabelaDeAgentes();

    expect(picker).toBeDisabled();
    expect(voltar).toBeDisabled();

    // Inerte de verdade, não só na aparência: o dropdown não abre e o DELETE
    // não sai. É o que separa esta correção de um `opacity` no CSS.
    fireEvent.click(picker);
    expect(screen.queryByText(OUTRO)).toBeNull();
    fireEvent.click(voltar);
    expect(clearAgentModelBinding).not.toHaveBeenCalled();
  });

  it('viewer: some o CONTROLE, nunca a informação da linha', async () => {
    comPapel('viewer');
    const { picker, voltar } = await tabelaDeAgentes();

    // O modelo vigente continua legível no gatilho desabilitado...
    expect(picker).toHaveTextContent(DO_AGENTE);
    // ...a cadeia de origem continua na tela...
    expect(
      within(screen.getByRole('region', { name: REGIAO_AGENTES })).getAllByText(
        'agente',
      ).length,
    ).toBeGreaterThan(0);
    // ...e o botão CONTINUA existindo: ele é o que diz que esta linha
    // divergiu, e escondê-lo apagaria um estado que dá para ler sem poder.
    expect(voltar).toBeInTheDocument();
  });

  it('viewer: a legenda da seção diz POR QUE os controles estão apagados', async () => {
    comPapel('viewer');
    await tabelaDeAgentes();

    // Dito uma vez, em texto, e nomeando as DUAS ações que ficaram inertes —
    // `title` em elemento `disabled` não abre no Chromium.
    expect(
      screen.getByText(/Exige papel developer para trocar o modelo/),
    ).toBeInTheDocument();
  });

  it('papel ainda não lido: inerte — a tela não promete o que não sabe se pode', async () => {
    comPapel(undefined);
    const { picker, voltar } = await tabelaDeAgentes();

    // Errar para o lado de desabilitar se conserta recarregando; errar para o
    // lado de habilitar faz a tela prometer uma ação que termina em 403.
    expect(picker).toBeDisabled();
    expect(voltar).toBeDisabled();
  });
});

describe('tabela de agentes — quem PODE editar', () => {
  it('developer: troca o modelo, e o PUT chega na api', async () => {
    comPapel('developer');
    const { picker } = await tabelaDeAgentes();

    expect(picker).toBeEnabled();
    fireEvent.click(picker);
    fireEvent.click(await screen.findByText(OUTRO));

    await waitFor(() =>
      expect(setAgentModelBinding).toHaveBeenCalledWith('proj-1', SLUG, 'm-outro'),
    );
  });

  it('developer: volta a herdar, e o DELETE chega na api', async () => {
    comPapel('developer');
    const { voltar } = await tabelaDeAgentes();

    expect(voltar).toBeEnabled();
    fireEvent.click(voltar);

    await waitFor(() =>
      expect(clearAgentModelBinding).toHaveBeenCalledWith('proj-1', SLUG),
    );
  });

  it('developer: a legenda do papel NÃO aparece para quem pode editar', async () => {
    comPapel('developer');
    await tabelaDeAgentes();

    expect(screen.queryByText(/Exige papel developer/)).toBeNull();
  });
});

/**
 * O caso que impede a próxima pessoa de "uniformizar" as duas seções: as duas
 * fazem a MESMA pergunta com mínimos DIFERENTES, e um `developer` tem de ver
 * uma habilitada e a outra não, na mesma tela, ao mesmo tempo.
 */
describe('a régua é do ENDPOINT, não da seção', () => {
  it('developer edita o AGENTE e não a ÁREA', async () => {
    comPapel('developer');
    montar(
      <>
        <ModelsSection projectId="proj-1" />
        <AreaModelsSection projectId="proj-1" />
      </>,
    );

    const agentes = within(
      await screen.findByRole('region', { name: REGIAO_AGENTES }),
    );
    const areas = within(screen.getByRole('region', { name: REGIAO_AREAS }));

    expect(await agentes.findByRole('button', { name: DO_AGENTE })).toBeEnabled();
    expect(agentes.getByRole('button', { name: VOLTAR_INLINE })).toBeEnabled();

    // A seção de área pede `maintainer`: TODO picker dela e todo "Voltar a
    // herdar" dela continuam desabilitados para o mesmo `developer`.
    const pickersDeArea = await areas.findAllByRole('button', { name: DA_AREA });
    expect(pickersDeArea.length).toBeGreaterThan(0);
    for (const picker of pickersDeArea) expect(picker).toBeDisabled();
    for (const botao of areas.getAllByRole('button', { name: 'Voltar a herdar' })) {
      expect(botao).toBeDisabled();
    }
  });

  it('maintainer alcança as duas — o mínimo do agente é MENOR, não outro', async () => {
    comPapel('maintainer');
    montar(
      <>
        <ModelsSection projectId="proj-1" />
        <AreaModelsSection projectId="proj-1" />
      </>,
    );

    const agentes = within(
      await screen.findByRole('region', { name: REGIAO_AGENTES }),
    );
    const areas = within(screen.getByRole('region', { name: REGIAO_AREAS }));

    expect(await agentes.findByRole('button', { name: DO_AGENTE })).toBeEnabled();
    for (const picker of await areas.findAllByRole('button', { name: DA_AREA })) {
      expect(picker).toBeEnabled();
    }
  });
});
