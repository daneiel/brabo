import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { ProjectPage } from './ProjectPage';
import {
  ABAS_DO_PROJETO,
  CHAVES_DE_ABA,
  abaPorChave,
  ehChaveDeAba,
} from './project-tabs';
import type { Project } from '../lib/api-types';

const getProject = vi.fn();
const getRepository = vi.fn();
const getProjectBudget = vi.fn();

vi.mock('../lib/api-client', async () => {
  // `ApiError`/`mensagemDaApi` reais pelo mesmo motivo de `ProjectPage.test.tsx`:
  // dublê deles provaria só que o componente chama uma função.
  const real =
    await vi.importActual<typeof import('../lib/api-client')>('../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getProject: (...args: unknown[]) => getProject(...args),
    getRepository: (...args: unknown[]) => getRepository(...args),
    getProjectBudget: (...args: unknown[]) => getProjectBudget(...args),
  };
});

const useBacklog = vi.fn(() => ({ data: [] as unknown[] }));
const useHypotheses = vi.fn(() => ({ data: [] as unknown[] }));
const usePendingActions = vi.fn(() => ({ data: undefined as unknown }));

vi.mock('../lib/hooks', () => ({
  useBacklog: () => useBacklog(),
  useHypotheses: () => useHypotheses(),
  useLatestSession: () => ({ latest: undefined }),
  usePendingActions: () => usePendingActions(),
}));

// Cada painel vira uma frase única. É o que permite afirmar QUAL aba
// renderizou — o que uma cadeia de `&&` incompleta não conseguiria fazer.
vi.mock('./ProjectOverviewTab', () => ({
  ProjectOverviewTab: () => <div>painel de overview</div>,
}));
vi.mock('./ProjectSessionsTab', () => ({
  // FASE 24: duas abas saem deste módulo, uma por `kind`. A frase de cada uma
  // é a CHAVE do registro, para que a asserção genérica lá embaixo continue
  // provando qual painel renderizou.
  ProjectCriativoTab: () => <div>painel de criativo</div>,
  ProjectChatTab: () => <div>painel de sessions</div>,
}));
vi.mock('./ProjectApprovalsTab', () => ({
  ProjectApprovalsTab: () => <div>painel de approvals</div>,
}));
vi.mock('./ProjectBacklogTab', () => ({
  ProjectBacklogTab: () => <div>painel de backlog</div>,
  aguardandoPromocao: (itens: unknown[] | undefined) => itens ?? [],
}));
vi.mock('./ProjectInsightsTab', () => ({
  ProjectInsightsTab: () => <div>painel de insights</div>,
}));
vi.mock('./ProjectSpendTab', () => ({
  ProjectSpendTab: () => <div>painel de spend</div>,
}));
vi.mock('./ProjectSettingsTab', () => ({
  ProjectSettingsTab: () => <div>painel de settings</div>,
}));

const PROJETO: Project = {
  id: 'proj-1',
  workspaceId: 'ws-1',
  name: 'Checkout',
  slug: 'checkout',
  createdBy: 'user-1',
  maxConsecutiveBlocked: null,
  storyPromotion: 'manual',
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
};

function montar(initialTab?: Parameters<typeof ProjectPage>[0]['initialTab']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProjectPage projectId="proj-1" initialTab={initialTab} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getProject.mockResolvedValue(PROJETO);
  getRepository.mockResolvedValue(null);
  getProjectBudget.mockResolvedValue(null);
  useBacklog.mockReturnValue({ data: [] });
  useHypotheses.mockReturnValue({ data: [] });
  usePendingActions.mockReturnValue({ data: undefined });
});

/**
 * O defeito real: a lista de abas do projeto existia em QUATRO lugares que não
 * se enxergavam — `PROJECT_TABS` no `router.tsx` (que valida o deep-link
 * `?tab=`), o `type TabKey`, o array passado à régua e a cadeia de `&&` que
 * renderiza, os três últimos no `ProjectPage.tsx`.
 *
 * Nada disso quebra compilação quando diverge, e é essa a armadilha: aceitar
 * `?tab=x` e ter painel para `x` eram decisões independentes. Uma chave só no
 * router abre o projeto numa aba EM BRANCO; uma chave só no `ProjectPage` faz
 * o deep-link cair silenciosamente na Visão geral.
 *
 * Estes testes varrem o registro — não uma lista escrita aqui. Uma aba nova
 * entra automaticamente em todas as asserções, e se qualquer um dos quatro
 * pontos parar de derivar do registro, um deles morre.
 */
describe('abas do projeto derivam de um registro só', () => {
  it.each(ABAS_DO_PROJETO.map((aba) => [aba.key, aba.label] as const))(
    'a aba %s tem botão na régua E painel que renderiza',
    async (key, label) => {
      montar(key as never);

      // Ponto 3: a régua.
      expect(
        await screen.findByRole('tab', { name: new RegExp(label) }),
      ).toBeInTheDocument();
      // Ponto 4: o render. Uma cadeia de `&&` sem esta chave mostraria o
      // cabeçalho do projeto e um corpo vazio.
      expect(screen.getByText(`painel de ${key}`)).toBeInTheDocument();
    },
  );

  it('a régua mostra exatamente as abas do registro, na ordem declarada', async () => {
    montar();

    const botoes = await screen.findAllByRole('tab');
    expect(botoes.map((b) => b.textContent)).toEqual(
      ABAS_DO_PROJETO.map((aba) => aba.label),
    );
  });

  it('toda chave do registro é aceita pelo guarda do deep-link', () => {
    // Ponto 1: é este guarda que o `validateSearch` do router usa. Se ele
    // voltasse a ter lista própria, uma aba nova cairia na Visão geral.
    for (const chave of CHAVES_DE_ABA) {
      expect(ehChaveDeAba(chave)).toBe(true);
    }
    expect(CHAVES_DE_ABA).toHaveLength(ABAS_DO_PROJETO.length);
  });

  it('chave desconhecida NÃO é aceita e cai na aba padrão', () => {
    // O caso de falha do deep-link: `?tab=code` de uma fase futura, ou um
    // link velho. Nada de tela em branco — volta para a Visão geral.
    expect(ehChaveDeAba('code')).toBe(false);
    expect(ehChaveDeAba(undefined)).toBe(false);
    expect(ehChaveDeAba(42)).toBe(false);
    expect(abaPorChave('code').key).toBe('overview');
    expect(abaPorChave(undefined).key).toBe('overview');
  });

  /**
   * FASE 24 — a colisão que a fase teve de resolver (RN-104).
   *
   * Com Chat e Criativo filtrando por tipo, manter "Sessões" daria TRÊS
   * entradas para a mesma lista. Ela saiu; o que ficou é a CHAVE de deep-link,
   * que agora é a do Chat — um `?tab=sessions` guardado em link antigo abre no
   * Chat, e a asserção que importa é a segunda: a aba fica MARCADA na régua.
   * Resolver `sessions` como alias só no painel deixaria a régua sem seleção
   * nenhuma, porque `Tabs` compara `active` com `key`.
   */
  it('nenhuma aba lista os dois tipos juntos — "Sessões" saiu da régua', async () => {
    montar();

    await screen.findAllByRole('tab');
    expect(screen.queryByRole('tab', { name: 'Sessões' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Criativo' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Chat' })).toBeInTheDocument();
  });

  it('o deep-link antigo `?tab=sessions` abre no Chat, com a aba marcada', async () => {
    expect(ehChaveDeAba('sessions')).toBe(true);
    expect(abaPorChave('sessions').label).toBe('Chat');

    montar('sessions' as never);

    const chat = await screen.findByRole('tab', { name: 'Chat' });
    expect(chat.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('painel de sessions')).toBeInTheDocument();
  });

  it('ordem é única — duas abas no mesmo lugar seria régua instável', () => {
    const ordens = ABAS_DO_PROJETO.map((aba) => aba.ordem);
    expect(new Set(ordens).size).toBe(ordens.length);
    expect([...ordens].sort((a, b) => a - b)).toEqual(ordens);
  });

  it('o selo numérico sai do registro, e some quando a fila está vazia', async () => {
    // Zero pendência não é informação, é ruído: `count` devolve `undefined`.
    usePendingActions.mockReturnValue({
      data: { items: [{ status: 'pending' }, { status: 'approved' }] },
    });
    useHypotheses.mockReturnValue({
      data: [{ status: 'proposed' }, { status: 'accepted' }],
    });
    useBacklog.mockReturnValue({ data: [] });

    montar();

    expect(
      await screen.findByRole('tab', { name: /Aprovações\s*1/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Insights\s*1/ })).toBeInTheDocument();
    // Backlog está vazio: o rótulo sai sozinho, sem `0` colado.
    expect(screen.getByRole('tab', { name: 'Backlog' })).toBeInTheDocument();
    // E as abas sem contador declarado nunca ganham selo.
    expect(screen.getByRole('tab', { name: 'Configurações' })).toBeInTheDocument();
  });
});
