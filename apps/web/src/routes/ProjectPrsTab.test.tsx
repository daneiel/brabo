import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectPrsTab } from './ProjectPrsTab';
import { ToastProvider } from '../components/ui/ToastProvider';
import type { CodePullRequestList, Epic, ProposedAction, Session, Task } from '../lib/api-types';

const getCodePullRequests = vi.fn();
const getCodeDiff = vi.fn();
const proposeAction = vi.fn();
const approveAction = vi.fn();
const denyAction = vi.fn();
const approveAlwaysAction = vi.fn();

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
