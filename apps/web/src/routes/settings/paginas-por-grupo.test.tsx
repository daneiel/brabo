import { describe, expect, it, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectSettingsTab } from '../ProjectSettingsTab';
import { ToastProvider } from '../../components/ui/ToastProvider';
import { ContextoDeGrupoInicial, ContextoDeSecaoInicial, ContextoDeTrocaDeGrupo } from './secao-inicial';
import {
  GRUPOS_DO_SUMARIO,
  SECOES_DE_CONFIGURACOES,
  grupoDaSecao,
  idDaSecao,
  resolverGrupo,
  type ChaveDeSecao,
  type GrupoDoSumario,
} from './sumario';
// A instância REAL do app, como `ProficiencySection.test.tsx` já faz: a aba
// usa `useTranslation` sem provedor próprio.
import i18n from '../../lib/i18n';

/**
 * O sumário ancorado da aba Configurações (#4 do canvas de melhorias).
 *
 * A pergunta que este arquivo responde é a única que nenhum teste de seção
 * responde: as 19 seções, o registro (`sumario.ts`) e a URL concordam? É por
 * isso que ele monta a aba INTEIRA, com dado suficiente para as 19 aparecerem
 * — inclusive as sete que somem quando falta repositório, projeto, catálogo ou
 * papel de `owner`.
 */

const papel = vi.fn(() => ({ data: { role: 'owner' } }));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../lib/hooks', () => ({
  useCurrentWorkspaceWithRole: () => papel(),
  useProficiency: () => ({ data: [] }),
}));

/**
 * O cliente da api inteiro, derivado do módulo REAL.
 *
 * Enumerar à mão as ~30 funções que as 19 seções chamam faria este arquivo
 * quebrar toda vez que uma seção passasse a ler mais um dado — e o que ele
 * testa não é dado nenhum, é navegação. Então toda função exportada vira uma
 * que resolve `null`, e só as poucas que precisam de forma específica para a
 * seção não sumir estão em `RESPOSTAS`. `ApiError`/`mensagemDaApi` ficam reais
 * porque não são chamada de rede.
 */
vi.mock('../../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../../lib/api-client')>(
    '../../lib/api-client',
  );
  const RESPOSTAS: Record<string, unknown> = {
    getProject: {
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
    },
    getRepository: {
      id: 'repo-1',
      projectId: 'proj-1',
      provider: 'github',
      externalId: 'org/checkout',
      defaultBranch: 'main',
      visibility: 'private',
      origin: 'created',
    },
    listModels: { local: {}, cloud: {} },
    listModelCatalog: { local: {}, cloud: {} },
    listAgentAreas: [],
    listProjectMembers: [],
    listCredentials: [],
    listPersonalAccessTokens: [],
    listAllPersonalAccessTokens: [],
    listProjectInstructionVersions: [],
    getProjectAgentCosts: [],
    getCredentialSpend: {
      workspaceId: 'ws-1',
      ownerId: 'user-1',
      meses: 3,
      totalMicros: 0,
      porProvider: [],
    },
  };
  const REAIS = new Set(['ApiError', 'mensagemDaApi']);
  const mock: Record<string, unknown> = {};
  for (const [nome, valor] of Object.entries(real)) {
    mock[nome] =
      typeof valor === 'function' && !REAIS.has(nome)
        ? () => Promise.resolve(RESPOSTAS[nome] ?? null)
        : valor;
  }
  return mock;
});

/** As entradas capturadas do `IntersectionObserver` que o provedor criou. */
type Callback = (entradas: { target: Element; isIntersecting: boolean }[]) => void;

class ObservadorFalso {
  constructor(_cb: Callback) {}
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

const scrollIntoView = vi.fn();

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
  papel.mockReturnValue({ data: { role: 'owner' } });
  scrollIntoView.mockClear();
  // jsdom não implementa NENHUM dos dois — mesma lacuna que
  // `SessionPage.ordenacao-e-avisos.test.tsx` já contorna para o
  // `scrollIntoView`. O produto guarda os dois com `?.`/`typeof`, então sem os
  // dublês o sumário navegaria calado em vez de quebrar; é justamente o que
  // estes testes precisam observar.
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: scrollIntoView,
    configurable: true,
    writable: true,
  });
  vi.stubGlobal('IntersectionObserver', ObservadorFalso);
});

afterEach(() => {
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  vi.unstubAllGlobals();
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

function montar(grupo?: GrupoDoSumario, secaoInicial?: ChaveDeSecao) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ContextoDeSecaoInicial.Provider value={secaoInicial}>
          <ContextoDeGrupoInicial.Provider value={grupo}>
            <ProjectSettingsTab projectId="proj-1" />
          </ContextoDeGrupoInicial.Provider>
        </ContextoDeSecaoInicial.Provider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const noDom = (chave: string) => document.getElementById(idDaSecao(chave as ChaveDeSecao));

describe('Configurações em páginas por grupo (RN-980)', () => {
  it.each(GRUPOS_DO_SUMARIO)('a página %s monta as seções do grupo e nenhuma de outro', async (grupo) => {
    montar(grupo);
    const dele = SECOES_DE_CONFIGURACOES.filter((s) => s.grupo === grupo);
    // Presentes as que não dependem de papel/dado (as que renderizam `null` não contam).
    await waitFor(() => expect(noDom(dele[0].chave)).toBeTruthy());
    for (const s of SECOES_DE_CONFIGURACOES.filter((s) => s.grupo !== grupo))
      expect(noDom(s.chave)).toBeNull();
  });

  it('sem grupo, a página padrão é Modelos', async () => {
    montar();
    await waitFor(() => expect(noDom('models')).toBeTruthy());
    expect(noDom('members')).toBeNull();
  });

  it('todo ?section= antigo cai na página do seu grupo; aposentada ou desconhecida, no topo de Modelos', () => {
    for (const s of SECOES_DE_CONFIGURACOES)
      expect(resolverGrupo(s.chave, undefined)).toBe(grupoDaSecao(s.chave));
    expect(resolverGrupo('members', 'modelos')).toBe('pessoas'); // a seção vence
    expect(resolverGrupo(undefined, 'pessoas')).toBe('pessoas');
    // `router.tsx` já descarta a chave aposentada (RN-911) antes daqui.
    expect(resolverGrupo(undefined, undefined)).toBeUndefined();
    expect(resolverGrupo(undefined, 'credentials')).toBeUndefined();
  });

  it('o deep-link ?section= rola até a seção pedida dentro da página do grupo', async () => {
    montar('pessoas', 'members');
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView.mock.instances[0]).toBe(noDom('members'));
  });

  it('sem ?section= a página abre no topo, sem rolar sozinha', async () => {
    montar('projeto');
    await waitFor(() => expect(noDom('execution')).toBeTruthy());
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('CASO DE FALHA: a aba NÃO tem o gasto por chave nem a matriz (RN-911)', async () => {
    montar('modelos');
    await waitFor(() => expect(noDom('models')).toBeTruthy());
    for (const saiu of ['key-spend', 'approval-matrix', 'credentials', 'model-catalog'])
      expect(document.getElementById(`secao-${saiu}`)).toBeNull();
  });
});

describe('Faixa de abas dos grupos (RN-980)', () => {
  function montarComTroca(inicial: GrupoDoSumario) {
    const trocar = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ContextoDeTrocaDeGrupo.Provider value={trocar}>
            <ContextoDeGrupoInicial.Provider value={inicial}>
              <ProjectSettingsTab projectId="proj-1" />
            </ContextoDeGrupoInicial.Provider>
          </ContextoDeTrocaDeGrupo.Provider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    return trocar;
  }

  it('mostra as 4 abas, marca a do grupo e o clique pede a troca', async () => {
    const trocar = montarComTroca('pessoas');
    const abas = screen.getAllByRole('tab');
    expect(abas.map((a) => a.textContent)).toEqual([
      'Modelos',
      'Projeto e execução',
      'Pessoas e acesso',
      'Avançado',
    ]);
    expect(screen.getByRole('tab', { name: 'Pessoas e acesso' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Pessoas e acesso' })).toHaveAttribute('aria-controls');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Avançado' }));
    expect(trocar).toHaveBeenCalledWith('avancado');
  });

  it('o teclado anda pelas abas: seta e End', async () => {
    montarComTroca("modelos");
    const u = userEvent.setup();
    screen.getByRole('tab', { name: 'Modelos' }).focus();
    await u.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Projeto e execução' }));
    await u.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Avançado' }));
  });
});
