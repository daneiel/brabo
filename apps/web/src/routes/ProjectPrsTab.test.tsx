import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectPrsTab } from './ProjectPrsTab';
import { ToastProvider } from '../components/ui/ToastProvider';
import { ApiError } from '../lib/api-client';
import type { CodePullRequestList, Epic, ProposedAction, Session, Task } from '../lib/api-types';
// Instância REAL do app (mesmo motivo de `AgentCard.test.tsx`): sem
// `I18nextProvider` no teste, o hook `useTranslation` cai no singleton
// global de `lib/i18n.ts` — as asserções abaixo checam o texto ATUAL em
// português.
import i18n from '../lib/i18n';

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

const getCodePullRequests = vi.fn();
const getCodeDiff = vi.fn();
const proposeAction = vi.fn();
const approveAction = vi.fn();
const denyAction = vi.fn();
const approveAlwaysAction = vi.fn();
const getProjectPendingActions = vi.fn();

vi.mock('../lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api-client')>();
  return {
    ...original,
    getCodePullRequests: (...args: unknown[]) => getCodePullRequests(...args),
    getCodeDiff: (...args: unknown[]) => getCodeDiff(...args),
    proposeAction: (...args: unknown[]) => proposeAction(...args),
    approveAction: (...args: unknown[]) => approveAction(...args),
    denyAction: (...args: unknown[]) => denyAction(...args),
    approveAlwaysAction: (...args: unknown[]) => approveAlwaysAction(...args),
    getProjectPendingActions: (...args: unknown[]) => getProjectPendingActions(...args),
  };
});

const useBacklog = vi.fn();
const useLatestSession = vi.fn();
const useProjectPendingActions = vi.fn();

vi.mock('../lib/hooks', () => ({
  useBacklog: (...args: unknown[]) => useBacklog(...args),
  useLatestSession: (...args: unknown[]) => useLatestSession(...args),
  useProjectPendingActions: (...args: unknown[]) => useProjectPendingActions(...args),
}));

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ProjectPrsTab projectId="proj-1" />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function sessaoRecente(id = 'sess-recente'): Session {
  return {
    id,
    projectId: 'proj-1',
    createdBy: 'user-1',
    status: 'active',
    kind: 'criativa',
    name: null,
    nextSeq: 10,
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
    closedAt: null,
  };
}

function prAberta(overrides: Partial<CodePullRequestList['items'][number]> = {}) {
  return {
    id: 'pr-a',
    number: 1,
    title: 'feat: A',
    url: 'https://example.com/pr/1',
    author: 'daneiel',
    state: 'open' as const,
    sourceBranch: 'feature/task-aaaaaaaa',
    targetBranch: 'dev',
    updatedAt: null,
    ...overrides,
  };
}

function acaoDeMerge(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'action-merge-1',
    projectId: 'proj-1',
    sessionId: 'sess-antiga',
    seq: 5,
    actionType: 'git_merge',
    payload: { pullRequestId: 'pr-a', sourceBranch: 'feature/task-aaaaaaaa', targetBranch: 'dev', title: 'feat: A' },
    status: 'pending',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'user', id: 'user-1' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: null,
    createdAt: '2026-08-19T10:00:00.000Z',
    updatedAt: '2026-08-19T10:00:00.000Z',
    ...overrides,
  };
}

function epicComTask(taskOverrides: Partial<Task> = {}): Epic[] {
  const task: Task = {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    storyId: 'story-1',
    title: 'Implementar A',
    description: '',
    status: 'in_progress',
    assignedTo: 'dev-api',
    blocked: false,
    blockedReason: null,
    gateStatus: 'awaiting_qa',
    gateCorrectionCount: 0,
    createdAt: '2026-08-18T10:00:00.000Z',
    updatedAt: '2026-08-18T10:00:00.000Z',
    ...taskOverrides,
  };
  return [
    {
      id: 'epic-1',
      projectId: 'proj-1',
      sessionId: 'sess-1',
      title: 'Épico',
      description: '',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      stories: [
        {
          id: 'story-1',
          epicId: 'epic-1',
          projectId: 'proj-1',
          sessionId: 'sess-1',
          title: 'História',
          description: '',
          rf: [],
          rnf: [],
          businessRuleIds: [],
          dod: [],
          dor: [],
          status: 'ready',
          proposedReady: false,
          returnedReason: null,
          returnedAt: null,
          createdAt: '2026-08-01T10:00:00.000Z',
          updatedAt: '2026-08-01T10:00:00.000Z',
          tasks: [task],
        },
      ],
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  useBacklog.mockReturnValue({ data: undefined, isError: false, error: null, refetch: vi.fn() });
  useLatestSession.mockReturnValue({ latest: sessaoRecente() });
  useProjectPendingActions.mockReturnValue({ data: [] });
  getCodeDiff.mockResolvedValue({ pullRequestId: '', files: [], truncated: false });
  getProjectPendingActions.mockResolvedValue([]);
});

describe('ProjectPrsTab — o bug de visibilidade não existe por desenho', () => {
  it('lista PRs de MÚLTIPLAS sessões: a fonte é o provider de git, não usePendingActions(latestSession)', async () => {
    // PR A foi proposta (no sentido de "existe no provider") há muito tempo;
    // PR B é recente. A sessão mais recente do projeto (`latest`) não tem
    // NENHUMA relação com nenhuma das duas — é exatamente o que o antigo
    // `ProjectApprovalsTab` (usePendingActions(projectId, latestSession?.id))
    // não conseguia expressar: a PR de uma sessão anterior sumia da tela
    // assim que uma sessão nova nascia.
    const lista: CodePullRequestList = {
      items: [
        prAberta({ id: 'pr-a', number: 1, title: 'feat: A (sessão antiga)' }),
        prAberta({
          id: 'pr-b',
          number: 2,
          title: 'feat: B (sessão nova)',
          sourceBranch: 'feature/task-bbbbbbbb',
        }),
      ],
      truncated: false,
    };
    getCodePullRequests.mockResolvedValue(lista);
    useLatestSession.mockReturnValue({ latest: sessaoRecente('sess-mais-recente-de-todas') });

    montar();

    expect(await screen.findByText('#1 feat: A (sessão antiga)')).toBeInTheDocument();
    expect(screen.getByText('#2 feat: B (sessão nova)')).toBeInTheDocument();
  });

  it('cruza um git_merge pendente NASCIDO NUMA SESSÃO ANTIGA com o PR certo, e decide com o sessionId da própria ação', async () => {
    getCodePullRequests.mockResolvedValue({ items: [prAberta()], truncated: false });
    // A ação pendente tem `sessionId: 'sess-antiga'` — DIFERENTE da sessão
    // mais recente do projeto (`sessaoRecente()` → 'sess-recente'). O
    // cruzamento é project-wide (`useProjectPendingActions`), então ele acha
    // a ação de qualquer forma.
    useProjectPendingActions.mockReturnValue({ data: [acaoDeMerge({ sessionId: 'sess-antiga' })] });

    montar();

    const aprovar = await screen.findByRole('button', { name: 'Aprovar' });
    fireEvent.click(aprovar);

    await waitFor(() =>
      expect(approveAction).toHaveBeenCalledWith('proj-1', 'sess-antiga', 'action-merge-1'),
    );
    // NUNCA a sessão mais recente — seria o mesmo defeito com outro nome.
    expect(approveAction).not.toHaveBeenCalledWith('proj-1', 'sess-recente', 'action-merge-1');
  });
});

describe('ProjectPrsTab — botão Merge', () => {
  it('propõe git_merge na sessão ATUAL ao clicar em Merge, sem git_merge pendente ainda', async () => {
    getCodePullRequests.mockResolvedValue({ items: [prAberta()], truncated: false });
    useProjectPendingActions.mockReturnValue({ data: [] });
    proposeAction.mockResolvedValue(acaoDeMerge());

    montar();

    const botaoMerge = await screen.findByRole('button', { name: 'Merge' });
    fireEvent.click(botaoMerge);

    await waitFor(() =>
      expect(proposeAction).toHaveBeenCalledWith(
        'proj-1',
        'sess-recente',
        expect.objectContaining({
          actionType: 'git_merge',
          payload: expect.objectContaining({
            pullRequestId: 'pr-a',
            sourceBranch: 'feature/task-aaaaaaaa',
            targetBranch: 'dev',
          }),
        }),
      ),
    );
  });

  it('gate bloqueado desabilita o Merge com o motivo em tooltip', async () => {
    getCodePullRequests.mockResolvedValue({ items: [prAberta()], truncated: false });
    useBacklog.mockReturnValue({
      data: epicComTask({ blocked: true, blockedReason: 'QA pediu mudanças' }),
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    montar();

    const botaoMerge = await screen.findByRole('button', { name: 'Merge' });
    expect(botaoMerge).toBeDisabled();
    expect(botaoMerge.getAttribute('title')).toBe('QA pediu mudanças');
  });

  it('AT-451: tarefa bloqueada com gate pendente NÃO diz que o merge segue disponível', async () => {
    getCodePullRequests.mockResolvedValue({ items: [prAberta()], truncated: false });
    useBacklog.mockReturnValue({
      data: epicComTask({ blocked: true, blockedReason: 'QA pediu mudanças', gateStatus: null }),
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    montar();

    const botaoMerge = await screen.findByRole('button', { name: 'Merge' });
    expect(botaoMerge).toBeDisabled();
    expect(screen.queryByTestId('aviso-gate-pendente')).toBeNull();
    const aviso = screen.getByTestId('aviso-merge-indisponivel');
    expect(aviso).toHaveTextContent('qa-verificada');
    expect(aviso.textContent).not.toMatch(/segue disponível|stays available/);
  });

  it('gate de QA pendente AVISA em texto, nomeando o gate, e o Merge segue ativo (AT-249, RN-663)', async () => {
    getCodePullRequests.mockResolvedValue({ items: [prAberta()], truncated: false });
    useBacklog.mockReturnValue({
      data: epicComTask({ gateStatus: 'awaiting_qa' }),
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    montar();

    const botaoMerge = await screen.findByRole('button', { name: 'Merge' });
    expect(botaoMerge).toBeEnabled();
    expect(screen.getByTestId('aviso-gate-pendente')).toHaveTextContent(
      'O gate qa-verificada ainda está pendente',
    );
  });

  it('o aviso acompanha também o card da proposta pendente', async () => {
    getCodePullRequests.mockResolvedValue({ items: [prAberta()], truncated: false });
    useBacklog.mockReturnValue({
      data: epicComTask({ gateStatus: 'awaiting_secops' }),
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    useProjectPendingActions.mockReturnValue({ data: [acaoDeMerge()] });

    montar();

    expect(await screen.findByRole('button', { name: 'Aprovar' })).toBeEnabled();
    expect(screen.getByTestId('aviso-gate-pendente')).toHaveTextContent('secops-segura');
  });

  it('gates já passados (awaiting_user): nenhum aviso', async () => {
    getCodePullRequests.mockResolvedValue({ items: [prAberta()], truncated: false });
    useBacklog.mockReturnValue({
      data: epicComTask({ gateStatus: 'awaiting_user' }),
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    montar();

    await screen.findByRole('button', { name: 'Merge' });
    expect(screen.queryByTestId('aviso-gate-pendente')).toBeNull();
  });

  it('CASO DE FALHA: aprovar o merge de PR já mergeada mostra a frase da api (409)', async () => {
    getCodePullRequests.mockResolvedValue({ items: [prAberta()], truncated: false });
    useProjectPendingActions.mockReturnValue({ data: [acaoDeMerge()] });
    approveAction.mockRejectedValue(
      new ApiError(409, {
        code: 'pr_ja_mergeado',
        message: 'A PR pr-a já foi mergeada: não há o que mergear.',
      }),
    );

    montar();

    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));
    expect(
      await screen.findByText(/A PR pr-a já foi mergeada: não há o que mergear\./),
    ).toBeInTheDocument();
  });

  it('sem sessão no projeto, o Merge fica desabilitado', async () => {
    getCodePullRequests.mockResolvedValue({ items: [prAberta()], truncated: false });
    useLatestSession.mockReturnValue({ latest: undefined });

    montar();

    const botaoMerge = await screen.findByRole('button', { name: 'Merge' });
    expect(botaoMerge).toBeDisabled();
  });

  it('PR fechada/mesclada não ganha botão de Merge', async () => {
    getCodePullRequests.mockResolvedValue({
      items: [prAberta({ id: 'pr-c', number: 3, title: 'feat: C', state: 'merged' })],
      truncated: false,
    });

    montar();

    expect(await screen.findByText('#3 feat: C')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull();
  });
});

describe('ProjectPrsTab — o gate do container não é erro genérico (achado de uso)', () => {
  // Bug real: a aba PRs (diferente da aba Code, que PERGUNTA antes em
  // `ProjectCodeTab.tsx`) chamava `getCodePullRequests` sem saber do portão
  // do container (RN-105) e mostrava o 409 dele como erro transitório, com
  // "Tentar de novo" — a afordância errada para um estado que só o
  // Arquiteto resolve, decidindo a imagem.
  it('409 do portão vira o estado dedicado, com o texto da aba PRs e não o da aba Código (AT-323)', async () => {
    getCodePullRequests.mockRejectedValue(
      new ApiError(409, {
        message:
          'A aba Code ainda não está liberada: o Arquiteto não decidiu qual imagem de container sobe para este projeto.',
      }),
    );

    montar();

    expect(
      await screen.findByText('A lista de PRs ainda não está liberada'),
    ).toBeInTheDocument();
    // O motivo nomeia a aba Código pelo MESMO rótulo do trilho, nunca "Code".
    expect(screen.getByText(/mesmo caminho da aba Código/)).toBeInTheDocument();
    expect(screen.getByText(/as duas abas, Código e PRs/)).toBeInTheDocument();
    expect(screen.queryByText(/aba Code/)).not.toBeInTheDocument();
    expect(screen.queryByText('A aba Código ainda não está liberada')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Tentar de novo')).not.toBeInTheDocument();
  });

  it('409 no diff aberto por id também usa o texto da aba PRs', async () => {
    getCodePullRequests.mockResolvedValue({ items: [], truncated: false });
    getCodeDiff.mockRejectedValue(new ApiError(409, { message: 'portão' }));

    montar();

    const campo = await screen.findByRole('textbox');
    fireEvent.change(campo, { target: { value: '42' } });
    fireEvent.submit(campo.closest('form')!);

    expect(
      await screen.findByText('A lista de PRs ainda não está liberada'),
    ).toBeInTheDocument();
  });

  it('erro de verdade (não o gate) continua com o banner e Tentar de novo', async () => {
    getCodePullRequests.mockRejectedValue(new ApiError(500, { message: 'falha interna' }));

    montar();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Tentar de novo')).toBeInTheDocument();
    expect(screen.queryByText('A lista de PRs ainda não está liberada')).not.toBeInTheDocument();
  });
});

describe('ProjectPrsTab — a recusa de merge aparece (RN-705)', () => {
  it('conflito de merge: mostra motivo e arquivos, diz que é preciso resolver, e o Merge segue ativo', async () => {
    getCodePullRequests.mockResolvedValue({ items: [prAberta()], truncated: false });
    getProjectPendingActions.mockResolvedValue([
      acaoDeMerge({
        status: 'failed',
        executionResult: {
          kind: 'git_merge',
          failed: true,
          error: 'conflito de merge na PR pr-a: package.json',
          pullRequestId: 'pr-a',
          conflictingFiles: ['package.json'],
        } as unknown as ProposedAction['executionResult'],
      }),
    ]);

    montar();

    const aviso = await screen.findByTestId('aviso-merge-recusado');
    expect(aviso.textContent).toContain('conflito de merge na PR pr-a');
    expect(aviso.textContent).toContain('Arquivo em conflito: package.json');
    expect(aviso.textContent).toContain('Resolva o conflito antes');
    expect(screen.getByRole('button', { name: 'Merge' })).not.toBeDisabled();
    expect(getProjectPendingActions).toHaveBeenCalledWith('proj-1', {
      actionType: 'git_merge',
      status: 'failed',
    });
  });

  it('recusa de OUTRA PR não aparece nesta', async () => {
    getCodePullRequests.mockResolvedValue({ items: [prAberta()], truncated: false });
    getProjectPendingActions.mockResolvedValue([
      acaoDeMerge({
        status: 'failed',
        payload: { pullRequestId: 'pr-outra' },
        executionResult: { kind: 'git_merge', failed: true, error: 'x' } as unknown as ProposedAction['executionResult'],
      }),
    ]);

    montar();

    await screen.findByRole('button', { name: 'Merge' });
    expect(screen.queryByTestId('aviso-merge-recusado')).toBeNull();
  });

  it('aprovar o merge invalida a lista de PRs (a mergeada sai de Abertas sem recarregar)', async () => {
    getCodePullRequests.mockResolvedValue({ items: [prAberta()], truncated: false });
    useProjectPendingActions.mockReturnValue({ data: [acaoDeMerge()] });
    approveAction.mockResolvedValue({});

    montar();
    await waitFor(() => expect(getCodePullRequests).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: /Aprovar/ }));

    await waitFor(() => expect(getCodePullRequests).toHaveBeenCalledTimes(2));
  });

  describe('RN-816 (AT-480): o Merge não muda de lugar quando o backlog chega', () => {
    it('com o backlog carregando, o Merge vem primeiro e a esteira tem o lugar reservado', async () => {
      getCodePullRequests.mockResolvedValue({ items: [prAberta()], truncated: false });
      useBacklog.mockReturnValue({ data: undefined, isPending: true, isError: false, error: null, refetch: vi.fn() });

      montar();

      const botaoMerge = await screen.findByRole('button', { name: 'Merge' });
      const reserva = screen.getByTestId('reserva-da-esteira');
      // O botão vem ANTES da reserva no DOM: o que chega depois fica abaixo dele.
      expect(botaoMerge.compareDocumentPosition(reserva) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('com o backlog lido, a reserva sai e a esteira entra no MESMO lugar, abaixo do botão', async () => {
      getCodePullRequests.mockResolvedValue({ items: [prAberta()], truncated: false });
      useBacklog.mockReturnValue({ data: epicComTask(), isPending: false, isError: false, error: null, refetch: vi.fn() });

      montar();

      const botaoMerge = await screen.findByRole('button', { name: 'Merge' });
      expect(screen.queryByTestId('reserva-da-esteira')).not.toBeInTheDocument();
      const esteira = screen.getByText('Implementar A');
      expect(botaoMerge.compareDocumentPosition(esteira) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });
});
