import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import settingsPtBR from '../locales/pt-BR/settings.json';
// `ModelPicker`/`ModelCatalogSection` (namespace `models`) são filhos de
// `AreaModelsSection`/`ModelsSection` — sem o namespace aqui, o gatilho do
// picker cai na chave crua (`picker.selectModel`).
import modelsPtBR from '../locales/pt-BR/models.json';
// `ExecutionModeSection` reusa os rótulos dos três modos e o placeholder do
// caminho do wizard de criação (`newProject:workspaceMode.*`/
// `newProject:workspace.pathPlaceholder`) — sem o namespace aqui, esses
// textos caem na chave crua.
import newProjectPtBR from '../locales/pt-BR/newProject.json';
import {
  AreaModelsSection,
  BudgetSection,
  CredentialsSection,
  ExecutionModeSection,
  ExecutionSection,
  MelhoresModelosPorCapacidadeSection,
  ModelsSection,
  ParallelismSection,
  PersonalAccessTokensSection,
  ProficiencySection,
  PromotionSection,
} from './ProjectSettingsTab';
import { ToastProvider } from '../components/ui/ToastProvider';
import { ApiError } from '../lib/api-client';
import { CREDENCIAIS_DE_LLM } from '../lib/models';
import type { Project, UserCredentialMetadata } from '../lib/api-types';

const getProject = vi.fn();
const updateProject = vi.fn();
const convertProjectExecutionMode = vi.fn();
const listCredentials = vi.fn();
const upsertCredential = vi.fn();
const deleteCredential = vi.fn();
const testCredential = vi.fn();
const listModels = vi.fn();
const listModelCatalog = vi.fn();
const getAgentModelBinding = vi.fn();
const clearAgentModelBinding = vi.fn();
const getProjectModelBinding = vi.fn();
const getWorkspaceModelBinding = vi.fn();
const getAreaModelBinding = vi.fn();
const setAreaModelBinding = vi.fn();
const clearAreaModelBinding = vi.fn();
const getProjectAgentCosts = vi.fn();
const setAgentModelBinding = vi.fn();
const listAgentAreas = vi.fn();
const setAreaMaxParallel = vi.fn();
const setAreaBudget = vi.fn();
const useCurrentWorkspaceWithRole = vi.fn();
const runAnamnese = vi.fn();
const listPersonalAccessTokens = vi.fn();
const issuePersonalAccessToken = vi.fn();
const revokePersonalAccessToken = vi.fn();
const listAllPersonalAccessTokens = vi.fn();
const revokePersonalAccessTokenAsMaintainer = vi.fn();

vi.mock('../lib/hooks', () => ({
  useCurrentWorkspaceWithRole: (...args: unknown[]) =>
    useCurrentWorkspaceWithRole(...args),
  useProficiency: () => ({ data: undefined }),
}));

vi.mock('../lib/api-client', async () => {
  // `mensagemDaApi` e `ApiError` entram de verdade: é justamente a extração da
  // mensagem que o teste do caminho de erro precisa exercitar.
  const real = await vi.importActual<typeof import('../lib/api-client')>(
    '../lib/api-client',
  );
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getProject: (...args: unknown[]) => getProject(...args),
    updateProject: (...args: unknown[]) => updateProject(...args),
    convertProjectExecutionMode: (...args: unknown[]) =>
      convertProjectExecutionMode(...args),
    listCredentials: (...args: unknown[]) => listCredentials(...args),
    upsertCredential: (...args: unknown[]) => upsertCredential(...args),
    deleteCredential: (...args: unknown[]) => deleteCredential(...args),
    testCredential: (...args: unknown[]) => testCredential(...args),
    listModels: (...args: unknown[]) => listModels(...args),
    listModelCatalog: (...args: unknown[]) => listModelCatalog(...args),
    getAgentModelBinding: (...args: unknown[]) => getAgentModelBinding(...args),
    clearAgentModelBinding: (...args: unknown[]) =>
      clearAgentModelBinding(...args),
    getProjectModelBinding: (...args: unknown[]) =>
      getProjectModelBinding(...args),
    getWorkspaceModelBinding: (...args: unknown[]) =>
      getWorkspaceModelBinding(...args),
    getAreaModelBinding: (...args: unknown[]) => getAreaModelBinding(...args),
    setAreaModelBinding: (...args: unknown[]) => setAreaModelBinding(...args),
    clearAreaModelBinding: (...args: unknown[]) =>
      clearAreaModelBinding(...args),
    getProjectAgentCosts: (...args: unknown[]) => getProjectAgentCosts(...args),
    setAgentModelBinding: (...args: unknown[]) => setAgentModelBinding(...args),
    listAgentAreas: (...args: unknown[]) => listAgentAreas(...args),
    setAreaMaxParallel: (...args: unknown[]) => setAreaMaxParallel(...args),
    setAreaBudget: (...args: unknown[]) => setAreaBudget(...args),
    runAnamnese: (...args: unknown[]) => runAnamnese(...args),
    listPersonalAccessTokens: (...args: unknown[]) =>
      listPersonalAccessTokens(...args),
    issuePersonalAccessToken: (...args: unknown[]) =>
      issuePersonalAccessToken(...args),
    revokePersonalAccessToken: (...args: unknown[]) =>
      revokePersonalAccessToken(...args),
    listAllPersonalAccessTokens: (...args: unknown[]) =>
      listAllPersonalAccessTokens(...args),
    revokePersonalAccessTokenAsMaintainer: (...args: unknown[]) =>
      revokePersonalAccessTokenAsMaintainer(...args),
  };
});

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
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...over,
  };
}

/**
 * Instância própria de i18next para o teste, como `AccountPage.test.tsx` já
 * faz — só o namespace "settings" que este arquivo precisa, em pt-BR: é o
 * idioma que as asserções existentes já esperavam antes da extração, e trocar
 * de idioma não é o que este arquivo prova (isso é `idioma.test.ts`).
 */
function novaInstanciaI18n() {
  const instancia = i18next.createInstance();
  void instancia.use(initReactI18next).init({
    resources: {
      'pt-BR': {
        settings: settingsPtBR,
        models: modelsPtBR,
        newProject: newProjectPtBR,
      },
    },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'settings',
    ns: ['settings', 'models', 'newProject'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instancia;
}

function montarSecao(secao: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const i18n = novaInstanciaI18n();
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ToastProvider>{secao}</ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

function montar() {
  return montarSecao(<ExecutionSection projectId="proj-1" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  updateProject.mockResolvedValue(project({ maxConsecutiveBlocked: 3 }));
  convertProjectExecutionMode.mockResolvedValue(project({ executionMode: 'mounted' }));
  listCredentials.mockResolvedValue([]);
  listModels.mockResolvedValue({ local: {}, cloud: {} });
  listModelCatalog.mockResolvedValue({ local: {}, cloud: {} });
  getAgentModelBinding.mockResolvedValue(null);
  clearAgentModelBinding.mockResolvedValue(undefined);
  getProjectModelBinding.mockResolvedValue(null);
  getWorkspaceModelBinding.mockResolvedValue(null);
  getAreaModelBinding.mockResolvedValue(null);
  setAreaModelBinding.mockResolvedValue(undefined);
  clearAreaModelBinding.mockResolvedValue(undefined);
  getProjectAgentCosts.mockResolvedValue([]);
  upsertCredential.mockResolvedValue({});
  deleteCredential.mockResolvedValue({ ok: true });
  listAgentAreas.mockResolvedValue([]);
  setAreaMaxParallel.mockResolvedValue({});
  setAreaBudget.mockResolvedValue({});
  useCurrentWorkspaceWithRole.mockReturnValue({ data: { role: 'maintainer' } });
  runAnamnese.mockResolvedValue(undefined);
  listPersonalAccessTokens.mockResolvedValue([]);
  issuePersonalAccessToken.mockResolvedValue(undefined);
  revokePersonalAccessToken.mockResolvedValue(undefined);
  listAllPersonalAccessTokens.mockResolvedValue([]);
  revokePersonalAccessTokenAsMaintainer.mockResolvedValue(undefined);
});

function credencial(over: Partial<UserCredentialMetadata> = {}): UserCredentialMetadata {
  return {
    id: 'cred-1',
    provider: 'openrouter',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

/** O card do OpenRouter, que é o provider do bug que originou esta seção. */
async function campoDoOpenrouter() {
  return await screen.findByLabelText('API key de OpenRouter');
}

function area(over: Record<string, unknown> = {}) {
  return {
    id: 'area-1',
    projectId: 'proj-1',
    key: 'dev',
    leadAgentId: 'dev-lead',
    maxParallel: 2,
    budgetMicros: null,
    spentMicros: 0,
    members: ['dev-api', 'dev-web'],
    ...over,
  };
}

describe('ParallelismSection', () => {
  it('sem áreas: explica DE ONDE elas vêm em vez de sumir', async () => {
    // Seção que desaparece parece bug, e o motivo (as áreas nascem do
    // module_map, na ativação) não é adivinhável por quem olha a tela.
    listAgentAreas.mockResolvedValue([]);
    montarSecao(<ParallelismSection projectId="proj-1" />);

    expect(
      await screen.findByText(/nascem quando você ativa a execução/i),
    ).toBeInTheDocument();
  });

  it('mostra o teto atual da área, pré-preenchido', async () => {
    listAgentAreas.mockResolvedValue([area({ maxParallel: 4 })]);
    montarSecao(<ParallelismSection projectId="proj-1" />);

    const campo = await screen.findByLabelText('Teto de agentes da área dev');
    expect(campo).toHaveValue(4);
  });

  it('salva o teto novo', async () => {
    listAgentAreas.mockResolvedValue([area()]);
    setAreaMaxParallel.mockResolvedValue(area({ maxParallel: 5 }));
    montarSecao(<ParallelismSection projectId="proj-1" />);

    const campo = await screen.findByLabelText('Teto de agentes da área dev');
    fireEvent.change(campo, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(setAreaMaxParallel).toHaveBeenCalledWith('proj-1', 'dev', 5),
    );
  });

  it('zero NÃO salva: o botão fica desabilitado', async () => {
    // Zero não é "sem limite" — é configuração inválida, e a api recusa. Barrar
    // aqui evita mandar um pedido que já se sabe que volta 400.
    listAgentAreas.mockResolvedValue([area()]);
    montarSecao(<ParallelismSection projectId="proj-1" />);

    const campo = await screen.findByLabelText('Teto de agentes da área dev');
    fireEvent.change(campo, { target: { value: '0' } });

    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
    expect(setAreaMaxParallel).not.toHaveBeenCalled();
  });

  it('cada área tem o seu campo, e editar uma não mexe na outra', async () => {
    // O teto é da ÁREA: um rascunho compartilhado faria digitar em dev alterar
    // o número exibido em qa.
    listAgentAreas.mockResolvedValue([
      area(),
      area({ id: 'area-2', key: 'qa', leadAgentId: 'qa-lead', maxParallel: 3 }),
    ]);
    montarSecao(<ParallelismSection projectId="proj-1" />);

    const devInput = await screen.findByLabelText('Teto de agentes da área dev');
    fireEvent.change(devInput, { target: { value: '7' } });

    expect(screen.getByLabelText('Teto de agentes da área qa')).toHaveValue(3);
  });

  it('a api recusando mostra a mensagem DELA, não uma genérica', async () => {
    listAgentAreas.mockResolvedValue([area()]);
    setAreaMaxParallel.mockRejectedValue(
      new ApiError(400, { message: 'max_parallel precisa ser inteiro >= 1' }),
    );
    montarSecao(<ParallelismSection projectId="proj-1" />);

    const campo = await screen.findByLabelText('Teto de agentes da área dev');
    fireEvent.change(campo, { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(
      await screen.findByText(/max_parallel precisa ser inteiro/i),
    ).toBeInTheDocument();
  });
});

describe('BudgetSection (ADR 0110, RN-443)', () => {
  it('sem áreas: explica DE ONDE elas vêm em vez de sumir', async () => {
    listAgentAreas.mockResolvedValue([]);
    montarSecao(<BudgetSection projectId="proj-1" />);

    expect(
      await screen.findByText(/nascem quando você ativa a execução/i),
    ).toBeInTheDocument();
  });

  it('sem teto configurado, o campo nasce VAZIO — não zero', async () => {
    listAgentAreas.mockResolvedValue([area({ budgetMicros: null })]);
    montarSecao(<BudgetSection projectId="proj-1" />);

    const campo = await screen.findByLabelText(
      'Teto de gasto da área dev, em dólares',
    );
    expect(campo).toHaveValue(null);
  });

  it('com teto configurado, mostra o valor em DÓLAR, convertido de micro-USD', async () => {
    listAgentAreas.mockResolvedValue([area({ budgetMicros: 20_000_000 })]);
    montarSecao(<BudgetSection projectId="proj-1" />);

    const campo = await screen.findByLabelText(
      'Teto de gasto da área dev, em dólares',
    );
    expect(campo).toHaveValue(20);
  });

  it('mostra o gasto acumulado da área', async () => {
    listAgentAreas.mockResolvedValue([area({ spentMicros: 4_300_000 })]);
    montarSecao(<BudgetSection projectId="proj-1" />);

    expect(await screen.findByText(/Gasto: US\$ 4,30/)).toBeInTheDocument();
  });

  it('salva o teto novo, convertido pra micro-USD pelo backend (envia em dólar)', async () => {
    listAgentAreas.mockResolvedValue([area()]);
    setAreaBudget.mockResolvedValue(area({ budgetMicros: 30_000_000 }));
    montarSecao(<BudgetSection projectId="proj-1" />);

    const campo = await screen.findByLabelText(
      'Teto de gasto da área dev, em dólares',
    );
    fireEvent.change(campo, { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(setAreaBudget).toHaveBeenCalledWith('proj-1', 'dev', 30),
    );
  });

  it('campo vazio salva null — LIMPA o teto, não é erro', async () => {
    listAgentAreas.mockResolvedValue([area({ budgetMicros: 20_000_000 })]);
    montarSecao(<BudgetSection projectId="proj-1" />);

    const campo = await screen.findByLabelText(
      'Teto de gasto da área dev, em dólares',
    );
    fireEvent.change(campo, { target: { value: '' } });

    expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(setAreaBudget).toHaveBeenCalledWith('proj-1', 'dev', null),
    );
  });

  it('negativo NÃO salva: o botão fica desabilitado', async () => {
    listAgentAreas.mockResolvedValue([area()]);
    montarSecao(<BudgetSection projectId="proj-1" />);

    const campo = await screen.findByLabelText(
      'Teto de gasto da área dev, em dólares',
    );
    fireEvent.change(campo, { target: { value: '-5' } });

    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
    expect(setAreaBudget).not.toHaveBeenCalled();
  });

  it('zero é válido — é um teto de verdade, não erro', async () => {
    listAgentAreas.mockResolvedValue([area()]);
    montarSecao(<BudgetSection projectId="proj-1" />);

    const campo = await screen.findByLabelText(
      'Teto de gasto da área dev, em dólares',
    );
    fireEvent.change(campo, { target: { value: '0' } });

    expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled();
  });

  it('cada área tem o seu campo, e editar uma não mexe na outra', async () => {
    listAgentAreas.mockResolvedValue([
      area(),
      area({
        id: 'area-2',
        key: 'qa',
        leadAgentId: 'qa-lead',
        budgetMicros: 5_000_000,
      }),
    ]);
    montarSecao(<BudgetSection projectId="proj-1" />);

    const devInput = await screen.findByLabelText(
      'Teto de gasto da área dev, em dólares',
    );
    fireEvent.change(devInput, { target: { value: '99' } });

    expect(
      screen.getByLabelText('Teto de gasto da área qa, em dólares'),
    ).toHaveValue(5);
  });

  it('a api recusando mostra a mensagem DELA, não uma genérica', async () => {
    listAgentAreas.mockResolvedValue([area()]);
    setAreaBudget.mockRejectedValue(
      new ApiError(400, { message: 'budgetMicros precisa ser null ou >= 0' }),
    );
    montarSecao(<BudgetSection projectId="proj-1" />);

    const campo = await screen.findByLabelText(
      'Teto de gasto da área dev, em dólares',
    );
    fireEvent.change(campo, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(
      await screen.findByText(/budgetMicros precisa ser null/i),
    ).toBeInTheDocument();
  });
});

describe('ExecutionSection', () => {
  it('sem valor próprio: mostra o default (3), pré-preenchido no campo', async () => {
    getProject.mockResolvedValue(project({ maxConsecutiveBlocked: null }));
    montar();

    expect(await screen.findByText(/usa o default \(3\)/)).toBeTruthy();
    expect(screen.getByDisplayValue('3')).toBeTruthy();
  });

  it('com valor próprio: mostra o valor configurado, não o default', async () => {
    getProject.mockResolvedValue(project({ maxConsecutiveBlocked: 5 }));
    montar();

    expect(await screen.findByDisplayValue('5')).toBeTruthy();
    expect(screen.getByText('Configurado para este projeto')).toBeTruthy();
  });

  it('salvar envia o número digitado e invalida a query do projeto', async () => {
    getProject.mockResolvedValue(project({ maxConsecutiveBlocked: null }));
    montar();

    const campo = await screen.findByDisplayValue('3');
    fireEvent.change(campo, { target: { value: '7' } });
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() =>
      expect(updateProject).toHaveBeenCalledWith('proj-1', {
        maxConsecutiveBlocked: 7,
      }),
    );
    expect(await screen.findByText('Teto do circuit breaker salvo')).toBeTruthy();
  });

  it('valor inválido (zero, negativo, fracionário): botão desabilitado, nada é salvo', async () => {
    getProject.mockResolvedValue(project({ maxConsecutiveBlocked: 3 }));
    montar();

    const campo = await screen.findByDisplayValue('3');
    fireEvent.change(campo, { target: { value: '0' } });

    const botao = screen.getByText('Salvar').closest('button');
    expect(botao?.disabled).toBe(true);

    fireEvent.click(screen.getByText('Salvar'));
    expect(updateProject).not.toHaveBeenCalled();
  });
});

describe('ExecutionModeSection (RN-447..450, ADR 0111)', () => {
  function montarModo() {
    return montarSecao(<ExecutionModeSection projectId="proj-1" />);
  }

  it('mostra o modo atual (container) e não pede caminho', async () => {
    getProject.mockResolvedValue(project({ executionMode: 'container' }));
    montarModo();

    expect(await screen.findByDisplayValue('Container')).toBeTruthy();
    expect(screen.queryByLabelText('Novo caminho da pasta')).toBeNull();
    // Nada mudou ainda — Converter fica desabilitado.
    expect(screen.getByText('Converter').closest('button')?.disabled).toBe(
      true,
    );
  });

  it('trocar para `mounted` mostra o campo de caminho, vazio', async () => {
    getProject.mockResolvedValue(project({ executionMode: 'container' }));
    montarModo();

    const select = await screen.findByLabelText('Novo modo de execução');
    fireEvent.change(select, { target: { value: 'mounted' } });

    const campo = await screen.findByLabelText('Novo caminho da pasta');
    expect(campo).toHaveValue('');
    // Sem caminho digitado, Converter continua desabilitado.
    expect(screen.getByText('Converter').closest('button')?.disabled).toBe(
      true,
    );
  });

  it('converte com o modo e o caminho digitados', async () => {
    getProject.mockResolvedValue(project({ executionMode: 'container' }));
    convertProjectExecutionMode.mockResolvedValue(
      project({ executionMode: 'mounted', workspacePath: '/home/voce/loja' }),
    );
    montarModo();

    const select = await screen.findByLabelText('Novo modo de execução');
    fireEvent.change(select, { target: { value: 'mounted' } });
    const campo = await screen.findByLabelText('Novo caminho da pasta');
    fireEvent.change(campo, { target: { value: '/home/voce/loja' } });
    fireEvent.click(screen.getByText('Converter'));

    await waitFor(() =>
      expect(convertProjectExecutionMode).toHaveBeenCalledWith('proj-1', {
        executionMode: 'mounted',
        workspacePath: '/home/voce/loja',
      }),
    );
    expect(await screen.findByText('Modo de execução convertido')).toBeTruthy();
  });

  it('projeto já `runner`: voltar para `container` não exige caminho', async () => {
    getProject.mockResolvedValue(
      project({ executionMode: 'runner', workspacePath: '/home/voce/loja' }),
    );
    convertProjectExecutionMode.mockResolvedValue(
      project({ executionMode: 'container', workspacePath: null }),
    );
    montarModo();

    const select = await screen.findByLabelText('Novo modo de execução');
    fireEvent.change(select, { target: { value: 'container' } });

    expect(screen.queryByLabelText('Novo caminho da pasta')).toBeNull();
    fireEvent.click(screen.getByText('Converter'));

    await waitFor(() =>
      expect(convertProjectExecutionMode).toHaveBeenCalledWith('proj-1', {
        executionMode: 'container',
      }),
    );
  });

  it('quem não é maintainer/owner: controles desabilitados, com aviso', async () => {
    useCurrentWorkspaceWithRole.mockReturnValue({ data: { role: 'developer' } });
    getProject.mockResolvedValue(project({ executionMode: 'container' }));
    montarModo();

    expect(
      await screen.findByText(/Só quem é maintainer ou owner pode converter/),
    ).toBeTruthy();
    expect(screen.getByLabelText('Novo modo de execução')).toBeDisabled();
    expect(screen.getByText('Converter').closest('button')?.disabled).toBe(
      true,
    );
  });

  it('dev agent ativo: a api recusa (409) e a mensagem DELA aparece, não uma genérica', async () => {
    getProject.mockResolvedValue(project({ executionMode: 'container' }));
    convertProjectExecutionMode.mockRejectedValue(
      new ApiError(409, {
        message: 'Este projeto tem dev agent trabalhando ou travado agora',
      }),
    );
    montarModo();

    const select = await screen.findByLabelText('Novo modo de execução');
    fireEvent.change(select, { target: { value: 'runner' } });
    const campo = await screen.findByLabelText('Novo caminho da pasta');
    fireEvent.change(campo, { target: { value: '/home/voce/loja' } });
    fireEvent.click(screen.getByText('Converter'));

    expect(
      await screen.findByText(/dev agent trabalhando ou travado agora/),
    ).toBeTruthy();
  });
});

describe('PromotionSection (Fase 12c — RN-048)', () => {
  function montarPromocao() {
    return montarSecao(<PromotionSection projectId="proj-1" />);
  }

  it('projeto novo cai em manual e explica o que isso significa', async () => {
    getProject.mockResolvedValue(project({ storyPromotion: 'manual' }));
    montarPromocao();

    expect(await screen.findByDisplayValue('Manual — eu promovo')).toBeTruthy();
    expect(screen.getByText(/Nenhuma tarefa dela é pegável até lá/)).toBeTruthy();
  });

  it('projeto em auto mostra que é o comportamento anterior, mantido como opção', async () => {
    getProject.mockResolvedValue(project({ storyPromotion: 'auto' }));
    montarPromocao();

    expect(
      await screen.findByDisplayValue('Automática — o PO promove'),
    ).toBeTruthy();
    expect(screen.getByText(/comportamento anterior à Fase 12c/)).toBeTruthy();
  });

  it('trocar o modo salva no onChange, sem botão', async () => {
    getProject.mockResolvedValue(project({ storyPromotion: 'manual' }));
    updateProject.mockResolvedValue(project({ storyPromotion: 'auto' }));
    montarPromocao();

    const select = await screen.findByLabelText('Quem promove histórias');
    fireEvent.change(select, { target: { value: 'auto' } });

    await waitFor(() =>
      expect(updateProject).toHaveBeenCalledWith('proj-1', {
        storyPromotion: 'auto',
      }),
    );
  });
});

/**
 * Esta seção existia sem teste nenhum, e foi exatamente onde o bug morou: o
 * `handleSave` sem `try/catch` deixava o `ApiError` escapar para o
 * `unhandledrejection` global (que só loga), e o botão Salvar parecia não ter
 * ação enquanto a api respondia 422 a cada clique.
 */
describe('CredentialsSection (ADR 0050)', () => {
  it('erro da api ao salvar VIRA TOAST — o bug era este silêncio', async () => {
    upsertCredential.mockRejectedValue(
      new ApiError(422, { message: 'teste de conexão falhou para openrouter' }),
    );
    montarSecao(<CredentialsSection />);

    fireEvent.change(await campoDoOpenrouter(), { target: { value: 'sk-xxx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar chave de OpenRouter' }));

    expect(await screen.findByText('Não deu para salvar')).toBeInTheDocument();
    expect(
      screen.getByText('teste de conexão falhou para openrouter'),
    ).toBeInTheDocument();
  });

  it('salvar com sucesso avisa e limpa o campo', async () => {
    montarSecao(<CredentialsSection />);

    const campo = await campoDoOpenrouter();
    fireEvent.change(campo, { target: { value: 'sk-boa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar chave de OpenRouter' }));

    expect(await screen.findByText('Credencial salva')).toBeInTheDocument();
    expect(upsertCredential).toHaveBeenCalledWith({
      provider: 'openrouter',
      apiKey: 'sk-boa',
    });
    await waitFor(() => expect(campo).toHaveValue(''));
  });

  it('com credencial salva o campo continua lá, para TROCAR sem remover antes', async () => {
    listCredentials.mockResolvedValue([credencial()]);
    montarSecao(<CredentialsSection />);

    const campo = await screen.findByLabelText('Nova chave de OpenRouter');
    fireEvent.change(campo, { target: { value: 'sk-nova' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trocar chave de OpenRouter' }));

    await waitFor(() =>
      expect(upsertCredential).toHaveBeenCalledWith({
        provider: 'openrouter',
        apiKey: 'sk-nova',
      }),
    );
  });

  it('testar: o provider aceita', async () => {
    listCredentials.mockResolvedValue([credencial()]);
    testCredential.mockResolvedValue({ resultado: 'ok' });
    montarSecao(<CredentialsSection />);

    fireEvent.click(
      await screen.findByRole('button', { name: /^Testar chave de / }),
    );

    expect(
      await screen.findByText('O provider aceitou a chave'),
    ).toBeInTheDocument();
  });

  it('testar: recusa mostra o MOTIVO que o provider deu', async () => {
    listCredentials.mockResolvedValue([credencial()]);
    testCredential.mockResolvedValue({
      resultado: 'recusado',
      motivo: 'openrouter respondeu 401',
    });
    montarSecao(<CredentialsSection />);

    fireEvent.click(
      await screen.findByRole('button', { name: /^Testar chave de / }),
    );

    expect(
      await screen.findByText('O provider recusou a chave'),
    ).toBeInTheDocument();
    expect(screen.getByText('openrouter respondeu 401')).toBeInTheDocument();
  });

  /**
   * O estado que obrigou o resultado a ter três valores: sem ele, um provider
   * sem endpoint de teste apareceria como sucesso, e a tela afirmaria uma
   * verificação que nunca aconteceu.
   */
  it('testar: provider sem verificação NÃO é apresentado como sucesso', async () => {
    listCredentials.mockResolvedValue([credencial({ provider: 'anthropic' })]);
    testCredential.mockResolvedValue({ resultado: 'nao_suportado' });
    montarSecao(<CredentialsSection />);

    fireEvent.click(
      await screen.findByRole('button', { name: /^Testar chave de / }),
    );

    expect(
      await screen.findByText('Sem verificação para este provider'),
    ).toBeInTheDocument();
    expect(screen.queryByText('O provider aceitou a chave')).toBeNull();
  });

  it('salvar fica desabilitado com o campo vazio', async () => {
    montarSecao(<CredentialsSection />);
    await campoDoOpenrouter();

    expect(
      screen.getByRole('button', { name: 'Salvar chave de OpenRouter' }),
    ).toBeDisabled();
  });

  /**
   * O chip de duas letras do handoff, conferido na TELA e não na função: o que
   * importa é que dois cards vizinhos não tragam o mesmo distintivo. Quebrar
   * por espaço dava `OP` para "OpenAI" e para "OpenRouter", que são uma palavra
   * só cada.
   */
  it('cada conector tem uma sigla própria no chip', async () => {
    montarSecao(<CredentialsSection />);
    await campoDoOpenrouter();

    expect(screen.getByText('OA')).toBeInTheDocument();
    expect(screen.getByText('OR')).toBeInTheDocument();
    // Uma maiúscula só cai nas duas primeiras letras.
    expect(screen.getByText('AN')).toBeInTheDocument();

    const siglas = screen
      .getAllByText(/^[A-Z]{2}$/)
      .map((el) => el.textContent);
    expect(siglas).toHaveLength(CREDENCIAIS_DE_LLM.length);
    expect(new Set(siglas).size).toBe(siglas.length);
  });
});

/**
 * "Melhores modelos por capacidade" (handoff, item 5 — ADR 0077). Sem coluna
 * de nota de qualidade: só custo real do catálogo e uso real dos agentes
 * deste projeto, sobre a curadoria (`uses`) que o workspace já marcou.
 */
describe('MelhoresModelosPorCapacidadeSection', () => {
  function modeloCurado(
    over: Partial<{
      id: string;
      displayName: string;
      isActive: boolean;
      uses: string[];
      inputPricePerMillionMicros: number;
    }> = {},
  ) {
    return {
      id: 'm-1',
      provider: 'ollama',
      name: 'modelo',
      displayName: 'Modelo',
      inputPricePerMillionMicros: 0,
      outputPricePerMillionMicros: 0,
      contextWindow: null,
      supportsToolCalling: true,
      supportsStreaming: true,
      supportsVision: false,
      supportsReasoning: false,
      generatesImage: false,
      manualPricing: true,
      availability: 'available',
      lastSeenAt: null,
      isActive: true,
      uses: ['codigo'],
      ...over,
    };
  }

  beforeEach(() => {
    getProject.mockResolvedValue(project());
  });

  it('recomenda o modelo curado para a capacidade que MAIS agentes deste projeto usam, custo desempatando', async () => {
    listModelCatalog.mockResolvedValue({
      local: {
        ollama: [
          modeloCurado({
            id: 'barato-sem-uso',
            displayName: 'Barato sem uso',
            uses: ['codigo'],
            inputPricePerMillionMicros: 0,
          }),
        ],
      },
      cloud: {
        anthropic: [
          modeloCurado({
            id: 'caro-usado',
            displayName: 'Caro mas usado',
            uses: ['codigo'],
            inputPricePerMillionMicros: 3_000_000,
          }),
        ],
      },
    });
    // Um agente do projeto resolve, pela cascata, para o modelo caro — é
    // esse sinal de uso real que deve vencer o desempate de custo.
    getAgentModelBinding.mockImplementation((_projectId: string, slug: string) =>
      Promise.resolve(
        slug === 'dev-backend'
          ? { modelId: 'caro-usado', origin: 'agent', skipped: [] }
          : null,
      ),
    );

    montarSecao(<MelhoresModelosPorCapacidadeSection projectId="proj-1" />);

    await screen.findByText('Melhores modelos por capacidade');
    expect(await screen.findAllByText('Caro mas usado')).not.toHaveLength(0);
    expect(screen.getByText('Barato sem uso')).toBeInTheDocument();
    expect(screen.getByText('1 agente deste projeto')).toBeInTheDocument();
  });

  it('capacidade sem modelo curado mostra "sem cobertura curada", nunca esconde a linha', async () => {
    // Catálogo com um modelo curado só para "imagem" — as outras quatro
    // capacidades (código, documentação, análise, conversa) ficam sem
    // cobertura, e a linha continua aparecendo.
    listModelCatalog.mockResolvedValue({
      local: {},
      cloud: {
        openai: [modeloCurado({ id: 'so-imagem', displayName: 'Só imagem', uses: ['imagem'] })],
      },
    });

    montarSecao(<MelhoresModelosPorCapacidadeSection projectId="proj-1" />);

    await screen.findByText('Melhores modelos por capacidade');
    expect(await screen.findAllByText('sem cobertura curada')).toHaveLength(4);
    expect(screen.getByText('Só imagem')).toBeInTheDocument();
  });
});

/**
 * As colunas que o mockup (`design/SCREENS.md`) desenha e a tela não tinha.
 * `FALLBACK` é derivado da cascata no cliente; `EST. MÊS` vem da rota de custo
 * por agente.
 */
describe('ModelsSection — colunas do desenho', () => {
  function modelo(id: string, displayName: string) {
    return {
      id,
      provider: 'ollama',
      name: displayName,
      displayName,
      inputPricePerMillionMicros: 0,
      outputPricePerMillionMicros: 0,
      contextWindow: null,
      supportsToolCalling: true,
      supportsStreaming: true,
      supportsVision: false,
      manualPricing: true,
      availability: 'available',
      lastSeenAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
  }

  beforeEach(() => {
    getProject.mockResolvedValue(project());
    listModels.mockResolvedValue({
      local: { ollama: [modelo('m-proj', 'Modelo do Projeto')] },
      cloud: {},
    });
  });

  it('FALLBACK mostra o nível abaixo quando a origem é o agente', async () => {
    getAgentModelBinding.mockResolvedValue({
      modelId: 'm-agente',
      origin: 'agent',
      skipped: [],
    });
    getProjectModelBinding.mockResolvedValue({ modelId: 'm-proj' });
    montarSecao(<ModelsSection projectId="proj-1" />);

    expect(await screen.findAllByText('Modelo do Projeto')).not.toHaveLength(0);
  });

  /**
   * `workspace` é o último nível da cascata: não há para onde cair, e inventar
   * um fallback ali seria afirmar um degrau que não existe.
   */
  it('origem workspace não tem fallback', async () => {
    getAgentModelBinding.mockResolvedValue({
      modelId: 'm-proj',
      origin: 'workspace',
      skipped: [],
    });
    getProjectModelBinding.mockResolvedValue({ modelId: 'm-proj' });
    montarSecao(<ModelsSection projectId="proj-1" />);

    await screen.findByText('Modelos por agente');
    expect(screen.queryByText('Modelo do Projeto')).toBeNull();
  });

  it('EST. MÊS mostra o custo do agente e o card soma o time', async () => {
    getProjectAgentCosts.mockResolvedValue([
      { actorId: 'po', costMicros: 2_500_000, inputTokens: 0, outputTokens: 0 },
      { actorId: 'qa', costMicros: 1_500_000, inputTokens: 0, outputTokens: 0 },
    ]);
    montarSecao(<ModelsSection projectId="proj-1" />);

    // 2,50 + 1,50 = 4,00 no card do time.
    expect(await screen.findByText(/US\$\s*4,00/)).toBeInTheDocument();
    expect(screen.getByText(/US\$\s*2,50/)).toBeInTheDocument();
  });

  /**
   * Agente que nunca rodou não vem na resposta. Traço é diferente de zero:
   * zero afirmaria um agente ativo e gratuito.
   */
  /**
   * Preço de token é da ordem de 10⁻⁶. Arredondar para duas casas fazia um
   * agente que gastou 1811 micro-USD aparecer com o mesmo `US$ 0,00` de quem
   * não gastou nada — a coluna afirmava ausência de consumo onde havia
   * consumo. Caso REAL, visto na tela.
   */
  it('gasto abaixo de um centavo não vira US$ 0,00', async () => {
    getProjectAgentCosts.mockResolvedValue([
      { actorId: 'psicologo', costMicros: 1811, inputTokens: 0, outputTokens: 0 },
    ]);
    montarSecao(<ModelsSection projectId="proj-1" />);

    expect(await screen.findAllByText(/< US\$\s*0,01/)).not.toHaveLength(0);
    expect(screen.queryByText(/^US\$\s*0,00$/)).toBeNull();
  });

  /** Zero de verdade continua sendo zero — o agente rodou e foi grátis. */
  it('custo zero real continua US$ 0,00', async () => {
    getProjectAgentCosts.mockResolvedValue([
      { actorId: 'criativo', costMicros: 0, inputTokens: 0, outputTokens: 0 },
    ]);
    montarSecao(<ModelsSection projectId="proj-1" />);

    expect(await screen.findAllByText(/US\$\s*0,00/)).not.toHaveLength(0);
  });

  it('agente sem consumo fica com traço, não com zero', async () => {
    getProjectAgentCosts.mockResolvedValue([]);
    montarSecao(<ModelsSection projectId="proj-1" />);

    await screen.findByText('Modelos por agente');
    expect(screen.queryByText(/US\$\s*0,00/)).toBeNull();
  });

  // ------------------------------------------------ FASE 23 / ADR 0064

  it('agente que DIVERGIU mostra "voltar a herdar", e clicar apaga o binding dele', async () => {
    getAgentModelBinding.mockImplementation((_projectId: string, slug: string) =>
      Promise.resolve(
        slug === 'qa-automacao'
          ? { modelId: 'm-agente', origin: 'agent', skipped: [] }
          : null,
      ),
    );
    montarSecao(<ModelsSection projectId="proj-1" />);

    const botao = await screen.findByRole('button', { name: 'voltar a herdar' });
    fireEvent.click(botao);

    await waitFor(() =>
      expect(clearAgentModelBinding).toHaveBeenCalledWith('proj-1', 'qa-automacao'),
    );
  });

  it('agente que HERDA (sem binding próprio) não mostra o botão de herança', async () => {
    getAgentModelBinding.mockResolvedValue({
      modelId: 'm-area',
      origin: 'area',
      skipped: [],
    });
    montarSecao(<ModelsSection projectId="proj-1" />);

    await screen.findByText('Modelos por agente');
    expect(screen.queryByRole('button', { name: 'voltar a herdar' })).toBeNull();
  });

  it('FALLBACK de um agente com área mostra o padrão da ÁREA, não o do projeto', async () => {
    // `qa-automacao` é subagente da área `qa` (agent-areas.ts) — quando ele
    // diverge, o degrau de baixo é o padrão da área, e só depois o projeto.
    getAgentModelBinding.mockImplementation((_projectId: string, slug: string) =>
      Promise.resolve(
        slug === 'qa-automacao'
          ? { modelId: 'm-agente', origin: 'agent', skipped: [] }
          : null,
      ),
    );
    getAreaModelBinding.mockImplementation((_projectId: string, key: string) =>
      Promise.resolve(
        key === 'qa'
          ? { modelId: 'm-area', origin: 'area', skipped: [] }
          : null,
      ),
    );
    listModels.mockResolvedValue({
      local: {
        ollama: [
          modelo('m-proj', 'Modelo do Projeto'),
          modelo('m-area', 'Modelo da Área'),
        ],
      },
      cloud: {},
    });
    getProjectModelBinding.mockResolvedValue({ modelId: 'm-proj' });
    montarSecao(<ModelsSection projectId="proj-1" />);

    expect(await screen.findAllByText('Modelo da Área')).not.toHaveLength(0);
    expect(screen.queryByText('Modelo do Projeto')).toBeNull();
  });
});

describe('AreaModelsSection — padrão herdável da área (ADR 0064, RN-102)', () => {
  function modeloDaArea(id: string, displayName: string) {
    return {
      id,
      provider: 'ollama',
      name: displayName,
      displayName,
      inputPricePerMillionMicros: 0,
      outputPricePerMillionMicros: 0,
      contextWindow: null,
      supportsToolCalling: true,
      supportsStreaming: true,
      supportsVision: false,
      manualPricing: true,
      availability: 'available',
      lastSeenAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
  }

  beforeEach(() => {
    listModels.mockResolvedValue({
      local: { ollama: [modeloDaArea('m-area', 'Modelo QA')] },
      cloud: {},
    });
  });

  it('lista as três áreas do catálogo, com lead e origem', async () => {
    getAreaModelBinding.mockResolvedValue({
      modelId: 'm-area',
      origin: 'project',
      skipped: [],
    });
    montarSecao(<AreaModelsSection projectId="proj-1" />);

    expect(await screen.findByText('Área Dev')).toBeInTheDocument();
    expect(screen.getByText('Área QA')).toBeInTheDocument();
    expect(screen.getByText('Área Infra')).toBeInTheDocument();
    expect(screen.getByText(/Lead: dev-lead/)).toBeInTheDocument();
  });

  it('área SEM padrão próprio não mostra "Voltar a herdar"', async () => {
    getAreaModelBinding.mockResolvedValue({
      modelId: 'm-area',
      origin: 'project',
      skipped: [],
    });
    montarSecao(<AreaModelsSection projectId="proj-1" />);

    await screen.findByText('Área Dev');
    expect(screen.queryByRole('button', { name: 'Voltar a herdar' })).toBeNull();
  });

  it('área COM padrão próprio mostra "Voltar a herdar", e clicar apaga (RN-102)', async () => {
    getAreaModelBinding.mockResolvedValue({
      modelId: 'm-area',
      origin: 'area',
      skipped: [],
    });
    montarSecao(<AreaModelsSection projectId="proj-1" />);

    const botoes = await screen.findAllByRole('button', { name: 'Voltar a herdar' });
    expect(botoes).toHaveLength(3); // uma por área
    fireEvent.click(botoes[0]);

    await waitFor(() => expect(clearAreaModelBinding).toHaveBeenCalled());
  });

  it('define o modelo padrão da área — chama setAreaModelBinding, não setAgentModelBinding', async () => {
    getAreaModelBinding.mockResolvedValue(null);
    montarSecao(<AreaModelsSection projectId="proj-1" />);

    const gatilhos = await screen.findAllByRole('button', { name: 'Selecionar modelo' });
    fireEvent.click(gatilhos[1]); // a área QA, segunda linha
    fireEvent.click(screen.getByText('Modelo QA'));

    await waitFor(() =>
      expect(setAreaModelBinding).toHaveBeenCalledWith('proj-1', 'qa', 'm-area'),
    );
    expect(setAgentModelBinding).not.toHaveBeenCalled();
  });

  it('sem papel maintainer, o seletor de modelo fica desabilitado', async () => {
    useCurrentWorkspaceWithRole.mockReturnValue({ data: { role: 'developer' } });
    getAreaModelBinding.mockResolvedValue(null);
    montarSecao(<AreaModelsSection projectId="proj-1" />);

    const gatilhos = await screen.findAllByRole('button', { name: 'Selecionar modelo' });
    for (const gatilho of gatilhos) {
      expect(gatilho).toBeDisabled();
    }
    expect(
      screen.getByText(/Exige papel maintainer para alterar/),
    ).toBeInTheDocument();
  });
});

/**
 * A Anamnese pode estar pausada GLOBALMENTE (decisão do usuário em
 * 2026-08-10, não bug — ver docs/explanation/backlog.md). Não confundir com o
 * opt-in/opt-out POR MEMBRO ("Voltar a ser perfilado"), que é outro conceito e
 * não muda aqui.
 */
describe('ProficiencySection — Anamnese pausada globalmente', () => {
  function montarProficiencia() {
    return montarSecao(<ProficiencySection projectId="proj-1" />);
  }

  it('rodar agora com sucesso avisa e não desabilita o botão', async () => {
    montarProficiencia();

    fireEvent.click(screen.getByRole('button', { name: 'Rodar agora' }));

    expect(await screen.findByText('Rodada enfileirada')).toBeInTheDocument();
    expect(runAnamnese).toHaveBeenCalledWith('proj-1');
    expect(screen.getByRole('button', { name: 'Rodar agora' })).not.toBeDisabled();
  });

  it('503 (desativada globalmente) é distinto de erro genérico: some toast claro, o botão desabilita e a explicação fica na tela', async () => {
    runAnamnese.mockRejectedValue(
      new ApiError(503, {
        message: 'A Anamnese está desativada globalmente por decisão do usuário — aguardando refinamento futuro.',
        reason: 'anamnese_disabled',
      }),
    );
    montarProficiencia();

    fireEvent.click(screen.getByRole('button', { name: 'Rodar agora' }));

    expect(await screen.findByText('Anamnese pausada')).toBeInTheDocument();
    expect(
      screen.getByText(
        'A Anamnese está desativada globalmente por decisão do usuário — aguardando refinamento futuro.',
      ),
    ).toBeInTheDocument();

    // Persistente na tela, não só o toast (RN-088: nunca falha silenciosa ou
    // confusa) — e o botão para de convidar um clique que sabidamente falha.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Rodar agora' })).toBeDisabled(),
    );
    expect(
      screen.getByText(/A Anamnese está pausada globalmente por decisão do time/),
    ).toBeInTheDocument();
  });

  it('erro genérico (não 503) não mexe no botão — só o toast de erro comum', async () => {
    runAnamnese.mockRejectedValue(new ApiError(500, { message: 'boom' }));
    montarProficiencia();

    fireEvent.click(screen.getByRole('button', { name: 'Rodar agora' }));

    expect(await screen.findByText('Erro')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rodar agora' })).not.toBeDisabled();
  });
});

/**
 * Personal Access Tokens do runner (`brb_…`, ADR 0105). O token bruto só
 * existe na resposta de EMISSÃO — nunca na listagem, e o modal de "mostrar
 * uma vez" precisa exibir exatamente o que a api devolveu, sem refazer
 * fetch nenhum pra buscá-lo de novo (ele não é recuperável).
 */
describe('PersonalAccessTokensSection (ADR 0105)', () => {
  function montarTokens() {
    return montarSecao(<PersonalAccessTokensSection projectId="proj-1" />);
  }

  function token(over: Record<string, unknown> = {}) {
    return {
      id: 'pat-1',
      name: 'laptop',
      projectId: 'proj-1',
      createdAt: '2026-08-10T00:00:00.000Z',
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
      ...over,
    };
  }

  it('lista renderiza uma linha por token', async () => {
    listPersonalAccessTokens.mockResolvedValue([
      token({ id: 'pat-1', name: 'laptop' }),
      token({ id: 'pat-2', name: 'ci' }),
    ]);
    montarTokens();

    expect(await screen.findByText('laptop')).toBeInTheDocument();
    expect(screen.getByText('ci')).toBeInTheDocument();
  });

  it('gerar token abre o modal com o valor exato da resposta, sem refazer fetch dele', async () => {
    issuePersonalAccessToken.mockResolvedValue({
      ...token({ id: 'pat-novo', name: 'laptop' }),
      token: 'brb_valorquesoexisteumavez',
    });
    montarTokens();

    fireEvent.change(screen.getByPlaceholderText('Nome (ex.: laptop)'), {
      target: { value: 'laptop' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Gerar token' }));

    expect(
      await screen.findByDisplayValue('brb_valorquesoexisteumavez'),
    ).toBeInTheDocument();
    expect(issuePersonalAccessToken).toHaveBeenCalledWith('proj-1', {
      name: 'laptop',
      expiresInDays: undefined,
    });
    // O valor só existe na resposta da emissão — a listagem não é
    // reconsultada pra exibir o modal.
    expect(listPersonalAccessTokens).toHaveBeenCalledTimes(1);
  });

  it('revogar chama o DELETE e invalida a listagem', async () => {
    listPersonalAccessTokens.mockResolvedValueOnce([token({ id: 'pat-1', name: 'laptop' })]);
    listPersonalAccessTokens.mockResolvedValueOnce([
      token({ id: 'pat-1', name: 'laptop', revokedAt: '2026-08-11T00:00:00.000Z' }),
    ]);
    montarTokens();

    fireEvent.click(await screen.findByRole('button', { name: 'Revogar laptop' }));

    await waitFor(() =>
      expect(revokePersonalAccessToken).toHaveBeenCalledWith('proj-1', 'pat-1'),
    );
    expect(listPersonalAccessTokens).toHaveBeenCalledTimes(2);
  });

  function tokenDeOutro(over: Record<string, unknown> = {}) {
    return {
      ...token(over),
      userId: 'user-2',
      userEmail: 'outro@brabo.dev',
      ...over,
    };
  }

  it('maintainer vê a sub-lista com TODOS os tokens do projeto, com o dono de cada um (RN-427)', async () => {
    useCurrentWorkspaceWithRole.mockReturnValue({ data: { role: 'maintainer' } });
    listAllPersonalAccessTokens.mockResolvedValue([
      tokenDeOutro({ id: 'pat-2', name: 'ci', userEmail: 'outro@brabo.dev' }),
    ]);
    montarTokens();

    expect(await screen.findByText('Todos os tokens do projeto')).toBeInTheDocument();
    expect(await screen.findByText('outro@brabo.dev')).toBeInTheDocument();
    expect(listAllPersonalAccessTokens).toHaveBeenCalledWith('proj-1');
  });

  it('developer NÃO vê a sub-lista de admin nem dispara a listagem de todos', async () => {
    useCurrentWorkspaceWithRole.mockReturnValue({ data: { role: 'developer' } });
    listPersonalAccessTokens.mockResolvedValue([token({ id: 'pat-1', name: 'laptop' })]);
    montarTokens();

    expect(await screen.findByText('laptop')).toBeInTheDocument();
    expect(screen.queryByText('Todos os tokens do projeto')).not.toBeInTheDocument();
    expect(listAllPersonalAccessTokens).not.toHaveBeenCalled();
  });

  it('revogar como maintainer chama o DELETE de admin e invalida só a listagem de admin (RN-427)', async () => {
    listPersonalAccessTokens.mockResolvedValue([token({ id: 'pat-1', name: 'laptop' })]);
    listAllPersonalAccessTokens.mockResolvedValueOnce([
      tokenDeOutro({ id: 'pat-2', name: 'ci' }),
    ]);
    listAllPersonalAccessTokens.mockResolvedValueOnce([
      tokenDeOutro({ id: 'pat-2', name: 'ci', revokedAt: '2026-08-11T00:00:00.000Z' }),
    ]);
    montarTokens();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Revogar ci (outro@brabo.dev)' }),
    );

    await waitFor(() =>
      expect(revokePersonalAccessTokenAsMaintainer).toHaveBeenCalledWith(
        'proj-1',
        'pat-2',
      ),
    );
    expect(listAllPersonalAccessTokens).toHaveBeenCalledTimes(2);
    // Revogar de admin não mexe na listagem própria — são queries separadas.
    expect(revokePersonalAccessToken).not.toHaveBeenCalled();
  });
});
