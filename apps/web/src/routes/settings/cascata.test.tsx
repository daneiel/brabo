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
import { AGENT_LIST } from '../../lib/agents';
import type { Project } from '../../lib/api-types';
import { AreaModelsSection } from './AreaModelsSection';
import { ModelsSection } from './ModelsSection';
import { herdouDoCriativo, montarCadeia } from './cascata';

/**
 * A cascata de modelo como CADEIA VISÍVEL (`settings/cascata.tsx`).
 *
 * O que este arquivo protege é uma DISTINÇÃO, não uma redação: `origin:
 * 'agent'` vindo da api significa duas coisas diferentes — o agente tem binding
 * próprio, ou ninguém escolheu nada e o modelo foi herdado do Criativo pelo
 * passo pós-cascata (`herdarModeloDeStart`, api). As duas mostravam a mesma
 * palavra `agent`. Um refactor que voltasse a colapsá-las passaria despercebido
 * sem os dois primeiros casos abaixo.
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

beforeEach(() => {
  vi.clearAllMocks();
  getProject.mockResolvedValue(project());
  listModels.mockResolvedValue({ local: {}, cloud: {} });
  getAgentModelBinding.mockResolvedValue(null);
  getAreaModelBinding.mockResolvedValue(null);
  getProjectModelBinding.mockResolvedValue(null);
  getWorkspaceModelBinding.mockResolvedValue(null);
  getProjectAgentCosts.mockResolvedValue([]);
  useCurrentWorkspaceWithRole.mockReturnValue({
    data: { role: 'maintainer', workspace: { id: 'ws-1' } },
  });
});

describe('cadeia da cascata — os DOIS sentidos de `agent`', () => {
  /**
   * Caso 1: existe uma linha de escopo `agent` em `model_bindings`. O nó
   * `agente` é o vigente, e o nome do Criativo não aparece em cadeia nenhuma.
   */
  it('binding PRÓPRIO do agente: a cadeia termina no nó `agente`', async () => {
    getAgentModelBinding.mockImplementation((_p: string, slug: string) =>
      Promise.resolve(
        slug === 'qa-automacao'
          ? { modelId: 'm-agente', origin: 'agent', skipped: [] }
          : null,
      ),
    );
    // O projeto tem padrão PRÓPRIO: a cascata teria pousado nele se o agente
    // não tivesse linha, então `agent` aqui só pode ser linha de verdade.
    getProjectModelBinding.mockResolvedValue({ modelId: 'm-proj' });
    montar(<ModelsSection projectId="proj-1" />);

    const vigente = await screen.findAllByTitle(
      'É deste nível que sai o modelo vigente (m-agente).',
    );
    expect(vigente).toHaveLength(1);
    expect(vigente[0]).toHaveTextContent('agente');
    expect(screen.queryAllByTitle(/herda o do Criativo/)).toHaveLength(0);
  });

  /**
   * Caso 2: NENHUMA linha para este agente. A cascata pousou em `workspace` e o
   * modelo veio do Criativo (`herdarModeloDeStart`) — a api devolve o mesmo
   * `origin: 'agent'` do caso 1, e a tela tem de mostrar outra coisa.
   */
  it('herança do Criativo: o nó `agente` fica VAZIO e um nó extra nomeia o Criativo', async () => {
    // É o que a api devolve de verdade: todo agente sem linha própria recebe o
    // modelo do Criativo com `origin: 'agent'`.
    getAgentModelBinding.mockResolvedValue({
      modelId: 'm-criativo',
      origin: 'agent',
      skipped: [],
    });
    getWorkspaceModelBinding.mockResolvedValue({ modelId: 'm-workspace' });
    montar(<ModelsSection projectId="proj-1" />);

    // Um nó por agente, MENOS o próprio Criativo: quem já é o agente de start
    // não herda de si mesmo, e a linha dele continua sendo binding próprio.
    const doCriativo = await screen.findAllByTitle(/herda o do Criativo/);
    expect(doCriativo).toHaveLength(AGENT_LIST.length - 1);
    expect(doCriativo[0]).toHaveTextContent('Criativo');

    // O nível que a cascata ALCANÇOU aparece como definido-e-não-vigente: o
    // modelo do workspace NÃO é o que vale em linha nenhuma, e marcá-lo vigente
    // seria afirmar o modelo errado.
    expect(
      await screen.findAllByTitle(
        'Valor próprio neste nível (m-workspace), mas um nível mais específico venceu.',
      ),
    ).toHaveLength(AGENT_LIST.length);
    expect(
      screen.queryAllByTitle(
        'É deste nível que sai o modelo vigente (m-workspace).',
      ),
    ).toHaveLength(0);

    // A linha do próprio Criativo: um vigente só, e é o nó `agente`.
    const vigente = screen.getAllByTitle(
      'É deste nível que sai o modelo vigente (m-criativo).',
    );
    expect(vigente).toHaveLength(1);
    expect(vigente[0]).toHaveTextContent('agente');
  });

  /**
   * A consulta de ÁREA não tem escopo de agente na cascata, então `agent` ali só
   * pode ser o passo pós-cascata — sem o caso ambíguo da tabela de agentes.
   */
  it('na seção de ÁREA, `agent` só pode ser o Criativo, e a cadeia diz isso', async () => {
    getAreaModelBinding.mockResolvedValue({
      modelId: 'm-criativo',
      origin: 'agent',
      skipped: [],
    });
    getWorkspaceModelBinding.mockResolvedValue({ modelId: 'm-workspace' });
    montar(<AreaModelsSection projectId="proj-1" />);

    expect(await screen.findAllByTitle(/herda o do Criativo/)).toHaveLength(3);
    expect(screen.queryAllByText('agent')).toHaveLength(0);
  });

  it('en: a distinção sobrevive à troca de idioma', async () => {
    getAgentModelBinding.mockResolvedValue({
      modelId: 'm-criativo',
      origin: 'agent',
      skipped: [],
    });
    montar(<ModelsSection projectId="proj-1" />, 'en');

    expect(
      await screen.findAllByTitle(/inherits the Creative's/),
    ).toHaveLength(AGENT_LIST.length - 1);
  });
});

describe('cadeia da cascata — o nível PULADO entra na própria cadeia', () => {
  /**
   * O aviso de nível descartado (Fase 9c) era um SEGUNDO badge ao lado da
   * origem: duas explicações da mesma descida, competindo. Agora é um nó
   * riscado dentro da cadeia.
   */
  it('nível descartado vira nó riscado, e não um badge concorrente', async () => {
    getAgentModelBinding.mockImplementation((_p: string, slug: string) =>
      Promise.resolve(
        slug === 'qa-automacao'
          ? {
              modelId: 'm-proj',
              origin: 'project',
              skipped: [
                { scope: 'agent', modelId: 'm-sumiu', reason: 'unavailable' },
              ],
            }
          : null,
      ),
    );
    getProjectModelBinding.mockResolvedValue({ modelId: 'm-proj' });
    montar(<ModelsSection projectId="proj-1" />);

    const pulado = await screen.findAllByTitle(
      'A cascata DESCARTOU este nível: m-sumiu sumiu do provider.',
    );
    expect(pulado).toHaveLength(1);
    expect(pulado[0]).toHaveTextContent('agente');
    // O badge separado de "pulado" não existe mais.
    expect(screen.queryByText(/pulado/)).toBeNull();
  });
});

describe('cadeia da cascata — os três vazios que eram o mesmo traço', () => {
  it('sem binding em nível nenhum: texto do vazio do AGENTE', async () => {
    montar(<ModelsSection projectId="proj-1" />);

    expect(
      await screen.findAllByText('sem modelo em nenhum nível'),
    ).toHaveLength(AGENT_LIST.length);
  });

  it('agente sem consumo: texto do vazio do CUSTO, diferente do da origem', async () => {
    montar(<ModelsSection projectId="proj-1" />);

    expect(await screen.findAllByText('sem gasto ainda')).toHaveLength(
      AGENT_LIST.length,
    );
    // Zero de verdade continua sendo número, não este texto.
    expect(screen.queryByText(/US\$/)).toBeNull();
  });

  it('área sem padrão em nível nenhum: texto PRÓPRIO, não o do agente', async () => {
    montar(<AreaModelsSection projectId="proj-1" />);

    expect(
      await screen.findAllByText('sem padrão em nenhum nível'),
    ).toHaveLength(3);
    expect(screen.queryByText('sem modelo em nenhum nível')).toBeNull();
  });

  it('nenhum traço solto sobrou nas três células', async () => {
    montar(<ModelsSection projectId="proj-1" />);

    await screen.findByText('Modelos por agente');
    // O `—` do card de custo do time é OUTRA coisa (carregando), e fica.
    expect(screen.queryAllByText('—')).toHaveLength(1);
  });
});

describe('montarCadeia — a derivação, sem tela', () => {
  const niveis = ['workspace', 'project', 'area', 'agent'] as const;

  it('nível mais ESPECÍFICO que o vencedor é vazio — a cascata provou', () => {
    const cadeia = montarCadeia({
      resolvido: { modelId: 'm', origin: 'project', skipped: [] },
      niveis: [...niveis],
      proprios: { workspace: 'm-ws', project: 'm' },
      herdadoDoStart: false,
    });

    expect(cadeia.map((n) => [n.escopo, n.estado])).toEqual([
      ['workspace', 'definido'],
      ['project', 'vigente'],
      ['area', 'vazio'],
      ['agent', 'vazio'],
    ]);
  });

  it('herança do Criativo: o vencedor da cascata NÃO é o valor vigente', () => {
    const cadeia = montarCadeia({
      resolvido: { modelId: 'm-criativo', origin: 'agent', skipped: [] },
      niveis: [...niveis],
      proprios: { workspace: 'm-ws' },
      herdadoDoStart: true,
    });

    expect(cadeia.map((n) => [n.escopo, n.estado])).toEqual([
      ['workspace', 'definido'],
      ['project', 'vazio'],
      ['area', 'vazio'],
      ['agent', 'vazio'],
      ['start', 'vigente'],
    ]);
    expect(cadeia.at(-1)?.modelId).toBe('m-criativo');
  });

  it('sem binding nenhum: todos os níveis vazios, nenhum vigente', () => {
    const cadeia = montarCadeia({
      resolvido: null,
      niveis: [...niveis],
      proprios: {},
      herdadoDoStart: false,
    });

    expect(cadeia.every((n) => n.estado === 'vazio')).toBe(true);
  });

  it('nível descartado vence a leitura de estado do próprio nível', () => {
    const cadeia = montarCadeia({
      resolvido: {
        modelId: 'm-ws',
        origin: 'workspace',
        skipped: [{ scope: 'area', modelId: 'm-sumiu', reason: 'unavailable' }],
      },
      niveis: [...niveis],
      proprios: { workspace: 'm-ws', area: 'm-sumiu' },
      herdadoDoStart: false,
    });

    const area = cadeia.find((n) => n.escopo === 'area');
    expect(area?.estado).toBe('pulado');
    expect(area?.motivo).toBe('unavailable');
  });
});

describe('herdouDoCriativo — o que a tela consegue provar', () => {
  const doCriativo = { modelId: 'm-criativo', origin: 'agent' as const, skipped: [] };
  const resolvido = { modelId: 'm-criativo', origin: 'agent' as const, skipped: [] };

  it('nada acima do workspace + Criativo com linha própria: é herança', () => {
    expect(
      herdouDoCriativo({
        agentKey: 'qa-automacao',
        resolvido,
        daArea: null,
        doProjeto: null,
        doCriativo,
      }),
    ).toBe(true);
  });

  it('o próprio Criativo nunca herda de si mesmo', () => {
    expect(
      herdouDoCriativo({
        agentKey: 'criativo',
        resolvido,
        daArea: null,
        doProjeto: null,
        doCriativo,
      }),
    ).toBe(false);
  });

  it('padrão PRÓPRIO de área segura a descida: não é herança', () => {
    expect(
      herdouDoCriativo({
        agentKey: 'qa-automacao',
        resolvido,
        daArea: { modelId: 'm-area', origin: 'area', skipped: [] },
        doProjeto: null,
        doCriativo,
      }),
    ).toBe(false);
  });

  it('padrão de área DESCARTADO não segura a descida: continua herança', () => {
    expect(
      herdouDoCriativo({
        agentKey: 'qa-automacao',
        resolvido: {
          ...resolvido,
          skipped: [{ scope: 'area', modelId: 'm-area', reason: 'unavailable' }],
        },
        daArea: { modelId: 'm-area', origin: 'area', skipped: [] },
        doProjeto: null,
        doCriativo,
      }),
    ).toBe(true);
  });

  it('binding de projeto segura a descida: não é herança', () => {
    expect(
      herdouDoCriativo({
        agentKey: 'qa-automacao',
        resolvido,
        daArea: null,
        doProjeto: { modelId: 'm-proj' },
        doCriativo,
      }),
    ).toBe(false);
  });

  it('Criativo sem linha própria: ninguém pode ter herdado dele', () => {
    expect(
      herdouDoCriativo({
        agentKey: 'qa-automacao',
        resolvido,
        daArea: null,
        doProjeto: null,
        doCriativo: { modelId: 'm-ws', origin: 'workspace', skipped: [] },
      }),
    ).toBe(false);
  });

  it('modelo diferente do Criativo: só pode ser linha própria do agente', () => {
    expect(
      herdouDoCriativo({
        agentKey: 'qa-automacao',
        resolvido: { modelId: 'm-outro', origin: 'agent', skipped: [] },
        daArea: null,
        doProjeto: null,
        doCriativo,
      }),
    ).toBe(false);
  });
});
