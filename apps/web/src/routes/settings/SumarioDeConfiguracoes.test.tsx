import { describe, expect, it, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectSettingsTab } from '../ProjectSettingsTab';
import { ToastProvider } from '../../components/ui/ToastProvider';
import { ContextoDeSecaoInicial } from './secao-inicial';
import { SECOES_DE_CONFIGURACOES, idDaSecao, type ChaveDeSecao } from './sumario';
// A instância REAL do app, como `ProficiencySection.test.tsx` já faz: a aba
// usa `useTranslation` sem provedor próprio.
import i18n from '../../lib/i18n';

/**
 * O sumário ancorado da aba Configurações (#4 do canvas de melhorias).
 *
 * A pergunta que este arquivo responde é a única que nenhum teste de seção
 * responde: as 17 seções, o registro (`sumario.ts`) e a URL concordam? É por
 * isso que ele monta a aba INTEIRA, com dado suficiente para as 17 aparecerem
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
 * Enumerar à mão as ~30 funções que as 17 seções chamam faria este arquivo
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
let ultimoObservador: Callback | undefined;

class ObservadorFalso {
  constructor(cb: Callback) {
    ultimoObservador = (entradas) => cb(entradas);
  }
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
  ultimoObservador = undefined;
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

function montar(secaoInicial?: ChaveDeSecao) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ContextoDeSecaoInicial.Provider value={secaoInicial}>
          <ProjectSettingsTab projectId="proj-1" />
        </ContextoDeSecaoInicial.Provider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function entradaDoSumario(nome: string): HTMLElement {
  const sumario = screen.getByRole('navigation', {
    name: 'Sumário das configurações',
  });
  const alvo = Array.from(sumario.querySelectorAll('button')).find(
    (b) => b.textContent === nome,
  );
  if (!alvo) throw new Error(`entrada "${nome}" não está no sumário`);
  return alvo;
}

describe('sumário ancorado de Configurações', () => {
  it('TODA seção do registro tem âncora alcançável no DOM', async () => {
    montar();

    // O acordo que importa: o registro não lista seção que o barrel não
    // compõe, e o barrel não compõe seção que o registro não conhece. Sem
    // isto, uma seção nova nasceria sem entrada no sumário e uma chave morta
    // continuaria aceita em `?section=`.
    for (const secao of SECOES_DE_CONFIGURACOES) {
      await waitFor(() =>
        expect(document.getElementById(idDaSecao(secao.chave))).toBeTruthy(),
      );
    }
  });

  it('a âncora é uma `region` com nome — o mesmo título que a seção mostra', async () => {
    montar();

    await waitFor(() =>
      expect(document.getElementById(idDaSecao('budget'))).toBeTruthy(),
    );
    const secao = document.getElementById(idDaSecao('budget'));
    expect(secao?.tagName).toBe('SECTION');
    expect(secao?.getAttribute('aria-label')).toBe('Teto de gasto por área');
  });

  it('clicar numa entrada rola até a seção correspondente', async () => {
    montar();
    await waitFor(() => entradaDoSumario('Teto de gasto por área'));

    fireEvent.click(entradaDoSumario('Teto de gasto por área'));

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(
      document.getElementById(idDaSecao('budget')),
    );
    // Sem `behavior: 'smooth'` — a rolagem suave foi MEDIDA como cancelada
    // dentro do container desta aba; o porquê está em `SecaoDeConfiguracoes`.
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });

  it('o deep-link `?section=` rola para a seção pedida ao abrir', async () => {
    montar('credentials');

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView.mock.instances[0]).toBe(
      document.getElementById(idDaSecao('credentials')),
    );
    expect(entradaDoSumario('Credenciais de provider').getAttribute('aria-current')).toBe(
      'location',
    );
  });

  it('sem `?section=` a aba abre no topo, sem rolar sozinha', async () => {
    montar();
    await waitFor(() => entradaDoSumario('Repositório'));

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('o scroll-spy marca a PRIMEIRA seção visível, na ordem de render', async () => {
    montar();
    await waitFor(() => entradaDoSumario('Membros e papéis'));
    expect(ultimoObservador).toBeTruthy();

    // Duas visíveis ao mesmo tempo: quem manda é a de cima na página, e a
    // ordem de cima é a do registro — nunca a ordem em que o observador
    // entregou as entradas.
    ultimoObservador?.([
      { target: document.getElementById(idDaSecao('proficiency'))!, isIntersecting: true },
      { target: document.getElementById(idDaSecao('members'))!, isIntersecting: true },
    ]);

    await waitFor(() =>
      expect(entradaDoSumario('Membros e papéis').getAttribute('aria-current')).toBe(
        'location',
      ),
    );
    expect(
      entradaDoSumario('Perfil de proficiência').getAttribute('aria-current'),
    ).toBeNull();
  });

  it('nenhuma seção visível MANTÉM a última marcada, não apaga a marcação', async () => {
    montar();
    await waitFor(() => entradaDoSumario('Membros e papéis'));

    const membros = document.getElementById(idDaSecao('members'))!;
    ultimoObservador?.([{ target: membros, isIntersecting: true }]);
    await waitFor(() =>
      expect(entradaDoSumario('Membros e papéis').getAttribute('aria-current')).toBe(
        'location',
      ),
    );

    ultimoObservador?.([{ target: membros, isIntersecting: false }]);

    await waitFor(() =>
      expect(entradaDoSumario('Membros e papéis').getAttribute('aria-current')).toBe(
        'location',
      ),
    );
  });

  it('seção que não monta NÃO vira entrada do sumário', async () => {
    // `GastoDasChaves` é só do owner (RN-060). Sem o papel, a seção não monta,
    // não se registra — e o sumário não oferece uma sala fechada.
    papel.mockReturnValue({ data: { role: 'developer' } });
    montar();

    await waitFor(() => entradaDoSumario('Membros e papéis'));
    expect(document.getElementById(idDaSecao('key-spend'))).toBeNull();
    expect(() => entradaDoSumario('Gasto das suas chaves')).toThrow();
  });
});
