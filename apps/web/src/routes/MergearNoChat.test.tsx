import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProposedAction, SessionEvent } from '../lib/api-types';
import i18n from '../lib/i18n';

const proposeAction = vi.fn();
const showToast = vi.fn();

vi.mock('../lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api-client')>();
  return { ...original, proposeAction: (...a: unknown[]) => proposeAction(...a) };
});
vi.mock('../lib/auth', () => ({ userIdDaSessao: () => 'user-1' }));
vi.mock('../components/ui/ToastProvider', () => ({
  useToast: () => ({ showToast }),
}));

const { MergearNoChat, jaHaMergeDaPr, prAbertaDaAcao } = await import('./MergearNoChat');
const { ApiError } = await import('../lib/api-client');

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});
afterAll(() => {
  void i18n.changeLanguage('en');
});
beforeEach(() => vi.clearAllMocks());

function acao(over: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'pr-action',
    projectId: 'proj-1',
    sessionId: 's-1',
    seq: 1,
    actionType: 'pr_open',
    payload: { title: 'feat: x', sourceBranch: 'feature/x', targetBranch: 'dev' },
    status: 'approved',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'dev-api' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}
const eventoPr = (actionId: string, pullRequestId: unknown): SessionEvent =>
  ({
    id: 'e1',
    sessionId: 's-1',
    seq: 5,
    type: 'action.pr_open',
    actor: { kind: 'agent', id: 'dev-api' },
    payload: { actionId, pullRequestId, pullRequestUrl: 'https://x/pr/7' },
    createdAt: new Date().toISOString(),
  }) as SessionEvent;

describe('prAbertaDaAcao / jaHaMergeDaPr (AT-266)', () => {
  it('lê a PR do evento que a execução gravou; sem evento (ou pendente/falha) não há PR', () => {
    expect(prAbertaDaAcao(acao(), [eventoPr('pr-action', 7)])).toMatchObject({
      pullRequestId: '7',
      sourceBranch: 'feature/x',
      targetBranch: 'dev',
    });
    expect(prAbertaDaAcao(acao(), [])).toBeNull();
    expect(prAbertaDaAcao(acao(), [eventoPr('outra', 7)])).toBeNull();
    expect(prAbertaDaAcao(acao({ status: 'pending' }), [eventoPr('pr-action', 7)])).toBeNull();
    expect(prAbertaDaAcao(acao({ status: 'failed' }), [eventoPr('pr-action', 7)])).toBeNull();
    expect(prAbertaDaAcao(acao({ actionType: 'terminal' }), [eventoPr('pr-action', 7)])).toBeNull();
  });

  it('dedupe: merge pendente/aprovado da mesma PR esconde o botão; negado, não', () => {
    const merge = (status: ProposedAction['status'], pr = '7') =>
      acao({ id: `m-${status}`, actionType: 'git_merge', status, payload: { pullRequestId: pr } });
    expect(jaHaMergeDaPr([merge('pending')], '7')).toBe(true);
    expect(jaHaMergeDaPr([merge('approved')], '7')).toBe(true);
    expect(jaHaMergeDaPr([merge('denied')], '7')).toBe(false);
    expect(jaHaMergeDaPr([merge('pending', '8')], '7')).toBe(false);
  });
});

function montar(podeDecidir = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MergearNoChat
        projectId="proj-1"
        sessionId="s-1"
        pr={{ pullRequestId: '7', sourceBranch: 'feature/x', targetBranch: 'dev', title: 'feat: x' }}
        podeDecidir={podeDecidir}
      />
    </QueryClientProvider>,
  );
}

describe('MergearNoChat (AT-266)', () => {
  it('o clique PROPÕE git_merge como usuário, na sessão — não aprova nada por conta própria', async () => {
    proposeAction.mockResolvedValue({});
    montar();

    fireEvent.click(screen.getByRole('button', { name: 'Mergear' }));

    await waitFor(() =>
      expect(proposeAction).toHaveBeenCalledWith('proj-1', 's-1', {
        actionType: 'git_merge',
        actor: { kind: 'user', id: 'user-1' },
        payload: {
          pullRequestId: '7',
          sourceBranch: 'feature/x',
          targetBranch: 'dev',
          title: 'feat: x',
        },
      }),
    );
    expect(screen.getByTestId('mergear-nota')).toHaveTextContent('quem confirma é você');
  });

  it('CASO DE FALHA: a recusa da api (409) vira toast com a frase dela', async () => {
    proposeAction.mockRejectedValue(new ApiError(409, { message: 'PR já mergeada.' }));
    montar();

    fireEvent.click(screen.getByRole('button', { name: 'Mergear' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'PR já mergeada.', tone: 'danger' }),
      ),
    );
  });

  it('papel abaixo de developer: botão inerte, com o motivo em texto', () => {
    montar(false);
    expect(screen.getByRole('button', { name: 'Mergear' })).toBeDisabled();
    expect(screen.getByTestId('mergear-nota')).toHaveTextContent('papel developer');
    expect(proposeAction).not.toHaveBeenCalled();
  });
});
