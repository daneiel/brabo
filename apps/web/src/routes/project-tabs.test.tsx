import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { ProjectPage } from './ProjectPage';
// A instância REAL do app (não uma isolada): `project-tabs.ts` (não-React)
// resolve `label` chamando `i18n.t(...)` direto no singleton global de
// `lib/i18n.ts` (mesmo padrão de `ProjectExecutorsTab.test.tsx`), então uma
// instância isolada aqui não alcançaria essas chamadas. As asserções abaixo
// checam o texto ATUAL em português, que é o que já estava hardcoded antes
// da extração.
import i18n from '../lib/i18n';
import {
  ABAS_DO_PROJETO,
  CHAVES_DE_ABA,
  GRUPOS_DO_PROJETO,
  abaPorChave,
  ehChaveDeAba,
  resolverChaveDeAba,
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
// `useArchitecture` (Onda 3) e `useProjectPendingActions` (Onda 2) — as duas
// contagens novas que `ProjectPage.tsx` lê pra `arquiteturaPendente`/
// `prsPendentes`. O que este arquivo prova é a moldura de abas, não o
// número em si (isso é `ProjectPage.test.tsx`/os testes de cada onda), daí
// os dois ficarem em `undefined` fixo — sem `vi.fn()` próprio, ninguém aqui
// varia o retorno.
vi.mock('../lib/hooks', () => ({
  useBacklog: () => useBacklog(),
  useHypotheses: () => useHypotheses(),
  useLatestSession: () => ({ latest: undefined }),
  usePendingActions: () => usePendingActions(),
  useArchitecture: () => ({ data: undefined }),
  useProjectPendingActions: () => ({ data: undefined }),
}));

// Cada painel vira uma frase única. É o que permite afirmar QUAL aba
// renderizou — o que uma cadeia de `&&` incompleta não conseguiria fazer.
vi.mock('./ProjectOverviewTab', () => ({
  ProjectOverviewTab: () => <div>painel de overview</div>,
}));
vi.mock('./ProjectSessionsTab', () => ({
  // FASE 24: `ProjectCriativoTab` continua vindo daqui. `ProjectChatTab`
  // também continua exportado daqui (o Chat RAG que consome
  // `./ProjectChatShell`, mockado abaixo, é quem o monta agora — este
  // registro não importa `ProjectChatTab` mais diretamente).
  ProjectCriativoTab: () => <div>painel de criativo</div>,
}));
vi.mock('./ProjectChatShell', () => ({
  // A fusão da Onda 1: `chat` é UMA aba, controlando por dentro o segmento
  // Conversar/Buscar — ver `ProjectChatShell.test.tsx` para o comportamento
  // do segmento. Aqui só importa que a chave `chat` tem painel.
  ProjectChatShell: () => <div>painel de chat</div>,
}));
vi.mock('./ProjectCodeTab', () => ({
  ProjectCodeTab: () => <div>painel de code</div>,
}));
vi.mock('./ProjectPrsTab', () => ({
  ProjectPrsTab: () => <div>painel de prs</div>,
}));
vi.mock('./ProjectArchitectureTab', () => ({
  ProjectArchitectureTab: () => <div>painel de arquitetura</div>,
}));
vi.mock('./ProjectExecutorsTab', () => ({
  ProjectExecutorsTab: () => <div>painel de executores</div>,
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
  workspaceMode: 'container',
  workspacePath: null,
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

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('pt-BR');
  getProject.mockResolvedValue(PROJETO);
  getRepository.mockResolvedValue(null);
  getProjectBudget.mockResolvedValue(null);
  useBacklog.mockReturnValue({ data: [] });
  useHypotheses.mockReturnValue({ data: [] });
  usePendingActions.mockReturnValue({ data: undefined });
});

// Restaura o default do app depois deste arquivo — a instância é o
// singleton REAL (`../lib/i18n`), então deixar em `pt-BR` vazaria para
// qualquer teste seguinte que compartilhe o mesmo registro de módulos.
afterAll(() => {
  void i18n.changeLanguage('en');
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
  // `.map(aba => aba.key)`, NUNCA `.label` aqui: `it.each` avalia este array
  // na COLETA do teste, antes de qualquer `beforeEach` rodar — `.label` é
  // getter sobre `i18n.t()` (RN-425), e capturá-lo agora prenderia o idioma
  // que o singleton tinha ANTES de `changeLanguage('pt-BR')`. O rótulo certo
  // só existe depois, dentro do corpo do teste.
  it.each(ABAS_DO_PROJETO.map((aba) => aba.key))(
    'a aba %s tem botão na régua (eventualmente dentro do grupo) E painel que renderiza',
    async (key) => {
      const label = abaPorChave(key)!.label;
      montar(key as never);

      // Ponto 3: a régua. Se a chave é filha de um grupo, montar com essa
      // chave como `active` é o que faz `GroupedTabs` abrir o grupo e
      // revelar a segunda linha — é ali que o rótulo da FILHA aparece; o
      // rótulo que aparece SEMPRE no topo, para abas soltas, é o dela
      // mesma. O regex é ANCORADO (início e fim): sem âncora, "Chat"
      // bateria por SUBSTRING dentro de rótulos maiores.
      const escapado = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(
        await screen.findByRole('tab', { name: new RegExp(`^${escapado}$`) }),
      ).toBeInTheDocument();
      // Ponto 4: o render. Uma cadeia de `&&` sem esta chave mostraria o
      // cabeçalho do projeto e um corpo vazio.
      expect(screen.getByText(`painel de ${key}`)).toBeInTheDocument();
    },
  );

  it('a régua de TOPO mostra os grupos e as abas soltas, na ordem declarada — nunca as 12 chaves achatadas', async () => {
    montar();

    const botoes = await screen.findAllByRole('tab');
    expect(botoes.map((b) => b.textContent)).toEqual([
      'Visão geral',
      'Agentes',
      'Dev',
      'Documentação',
      'Gastos',
      'Configurações',
    ]);
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
    // O caso de falha do deep-link: uma chave que nunca existiu, ou um link
    // velho de uma aba que saiu do registro. Nada de tela em branco — volta
    // para a Visão geral.
    expect(ehChaveDeAba('nao-existe')).toBe(false);
    expect(ehChaveDeAba(undefined)).toBe(false);
    expect(ehChaveDeAba(42)).toBe(false);
    expect(abaPorChave('nao-existe').key).toBe('overview');
    expect(abaPorChave(undefined).key).toBe('overview');
  });

  it('ordem é única — duas abas no mesmo lugar seria régua instável', () => {
    const ordens = ABAS_DO_PROJETO.map((aba) => aba.ordem);
    expect(new Set(ordens).size).toBe(ordens.length);
    expect([...ordens].sort((a, b) => a - b)).toEqual(ordens);
  });

  it('o selo numérico de uma aba SOLTA sai do registro, e some quando a fila está vazia', async () => {
    usePendingActions.mockReturnValue({
      data: { items: [{ status: 'pending' }, { status: 'approved' }] },
    });
    useHypotheses.mockReturnValue({
      data: [{ status: 'proposed' }, { status: 'accepted' }],
    });
    useBacklog.mockReturnValue({ data: [] });

    // Aprovações e Insights são filhas de grupo — mostrar o selo delas
    // exige o grupo aberto. Backlog também é filha (Documentação), e ela
    // fica vazia neste teste — é o caso "aba sem contador" verificado logo
    // abaixo, dentro do grupo.
    montar('approvals' as never);

    expect(
      await screen.findByRole('tab', { name: /Aprovações\s*1/ }),
    ).toBeInTheDocument();
    // E abas sem contador declarado nunca ganham selo.
    expect(screen.getByRole('tab', { name: 'Código' })).toBeInTheDocument();
  });

  it('o selo do GRUPO é a SOMA dos selos das filhas, e some quando a soma é zero', async () => {
    usePendingActions.mockReturnValue({
      data: { items: [{ status: 'pending' }] },
    });
    useHypotheses.mockReturnValue({
      data: [{ status: 'proposed' }],
    });
    useBacklog.mockReturnValue({ data: [] });

    // `active` de fora de todo grupo (Visão geral): a régua de topo mostra
    // só os selos AGREGADOS.
    montar();

    // "Dev" soma só Aprovações (1) — Código e PRs não têm contador.
    expect(await screen.findByRole('tab', { name: /^Dev\s*1$/ })).toBeInTheDocument();
    // "Agentes" soma só Insights (1) — Executores/Criativo/Chat não têm.
    expect(screen.getByRole('tab', { name: /^Agentes\s*1$/ })).toBeInTheDocument();
    // "Documentação" soma Backlog (0) e Arquitetura (0, placeholder): zero
    // é ruído, não selo.
    expect(screen.getByRole('tab', { name: 'Documentação' })).toBeInTheDocument();
  });

  /**
   * PROGRAMA de abas agrupadas — Onda 1. O handoff do PROGRAMA 28 previa 7
   * abas; este registro tem mais. As nascidas depois do handoff —
   * `executores`, `backlog`, `insights` — continuam aqui (RN-203, ADR
   * 0078): o handoff é referência de fidelidade visual, não teto de
   * produto. `chat` é a fusão desta onda (substitui `sessions` e `rag`,
   * que saíram do registro); `prs`/`arquitetura` são placeholder das
   * Ondas 2/3.
   */
  it('as abas que o handoff não previu continuam no registro, e a fusão Chat/RAG tirou uma chave', () => {
    expect(ABAS_DO_PROJETO).toHaveLength(12);
    const chaves = ABAS_DO_PROJETO.map((aba) => aba.key);
    expect(chaves).toEqual(
      expect.arrayContaining([
        'executores',
        'backlog',
        'insights',
        'chat',
        'prs',
        'arquitetura',
      ]),
    );
    // `sessions` e `rag` não são mais chaves de registro — viraram alias
    // (ver testes de `resolverChaveDeAba` abaixo) e segmento interno do
    // `ProjectChatShell`, respectivamente.
    expect(ehChaveDeAba('sessions')).toBe(false);
    expect(ehChaveDeAba('rag')).toBe(false);
  });

  it('a aba `chat` continua rotulada "Chat" — nunca "Chat RAG": RAG virou segmento interno, não aba', async () => {
    montar('chat' as never);

    expect(await screen.findByRole('tab', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Chat RAG' })).toBeNull();

    const chatAba = ABAS_DO_PROJETO.find((aba) => aba.key === 'chat');
    expect(chatAba?.label).toBe('Chat');
  });

  describe('resolverChaveDeAba — os aliases que a fusão Chat/RAG aposentou', () => {
    it('`sessions` e `rag` resolvem para `chat`, a chave de hoje', () => {
      expect(resolverChaveDeAba('sessions')).toBe('chat');
      expect(resolverChaveDeAba('rag')).toBe('chat');
    });

    it('uma chave válida continua resolvendo pra ela mesma', () => {
      expect(resolverChaveDeAba('overview')).toBe('overview');
      expect(resolverChaveDeAba('chat')).toBe('chat');
    });

    it('chave desconhecida (nem registro, nem alias) devolve undefined', () => {
      expect(resolverChaveDeAba('nao-existe')).toBeUndefined();
      expect(resolverChaveDeAba(undefined)).toBeUndefined();
      expect(resolverChaveDeAba(42)).toBeUndefined();
    });
  });

  describe('GRUPOS_DO_PROJETO — a estrutura que alimenta a régua de dois níveis', () => {
    it('toda ChaveDeAba pertence a EXATAMENTE um grupo ou está solta — nunca as duas coisas, nunca nenhuma', () => {
      const vistas = new Set<string>();
      for (const item of GRUPOS_DO_PROJETO) {
        const chaves = item.tipo === 'grupo' ? item.abas.map((a) => a.key) : [item.aba.key];
        for (const chave of chaves) {
          expect(vistas.has(chave)).toBe(false); // nunca duas vezes
          vistas.add(chave);
        }
      }
      expect(vistas).toEqual(new Set(CHAVES_DE_ABA)); // nunca nenhuma de fora
    });

    it('grupos e filhas saem ordenados pelo próprio `ordem`', () => {
      const ordensDeTopo = GRUPOS_DO_PROJETO.map((item) =>
        item.tipo === 'grupo' ? item.ordem : item.aba.ordem,
      );
      expect([...ordensDeTopo].sort((a, b) => a - b)).toEqual(ordensDeTopo);

      for (const item of GRUPOS_DO_PROJETO) {
        if (item.tipo !== 'grupo') continue;
        const ordensDasFilhas = item.abas.map((aba) => aba.ordem);
        expect([...ordensDasFilhas].sort((a, b) => a - b)).toEqual(ordensDasFilhas);
      }
    });

    it('o mapeamento final: agentes, dev e documentação com as filhas certas', () => {
      const grupos = Object.fromEntries(
        GRUPOS_DO_PROJETO.filter((item) => item.tipo === 'grupo').map((item) => [
          item.chave,
          item.abas.map((aba) => aba.key),
        ]),
      );
      expect(grupos.agentes).toEqual(['executores', 'criativo', 'chat', 'insights']);
      expect(grupos.dev).toEqual(['code', 'prs', 'approvals']);
      expect(grupos.documentacao).toEqual(['backlog', 'arquitetura']);

      const soltas = GRUPOS_DO_PROJETO.filter((item) => item.tipo === 'aba').map(
        (item) => (item as { aba: { key: string } }).aba.key,
      );
      expect(soltas).toEqual(['overview', 'spend', 'settings']);
    });
  });
});
