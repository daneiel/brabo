import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApprovalCard } from './ApprovalCard';
import { ApiError } from '../lib/api-client';
import type { ProposedAction } from '../lib/api-types';
import i18n from '../lib/i18n';

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});
afterAll(() => {
  void i18n.changeLanguage('en');
});

function acao(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'action-1',
    projectId: 'project-1',
    sessionId: 'session-1',
    seq: 1,
    actionType: 'terminal',
    payload: { command: 'ls' },
    status: 'pending',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'dev-api' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ApprovalCard — a decisão em voo e a ação que já saiu de pending (AT-256)', () => {
  it('segura os botões enquanto a decisão está em voo: o duplo clique não vira um 409', async () => {
    let resolver: () => void = () => {};
    const onApprove = vi.fn(() => new Promise<void>((r) => (resolver = r)));
    render(<ApprovalCard action={acao()} onApprove={onApprove} onDeny={vi.fn()} onAlwaysAllow={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Negar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sempre permitir' })).toBeDisabled();

    await act(async () => resolver());
    expect(screen.getByRole('button', { name: 'Negar' })).toBeEnabled();
  });

  it('no 409 mostra a frase da api no card e deixa os botões inertes, com o motivo em texto', async () => {
    const onAlwaysAllow = vi.fn(() =>
      Promise.reject(new ApiError(409, { message: 'A ação já foi aprovada.' })),
    );
    render(<ApprovalCard action={acao()} onApprove={vi.fn()} onDeny={vi.fn()} onAlwaysAllow={onAlwaysAllow} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sempre permitir' }));

    const recusa = await screen.findByTestId('recusa-da-decisao');
    expect(recusa).toHaveTextContent('A ação já foi aprovada.');
    expect(recusa).toHaveTextContent('já foi decidida por outro caminho');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aprovar' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Negar' })).toBeDisabled();
  });

  it('erro que não é 409 mostra a frase e devolve os botões (dá para tentar de novo)', async () => {
    const onApprove = vi.fn(() =>
      Promise.reject(new ApiError(500, { message: 'falhou ao executar' })),
    );
    render(<ApprovalCard action={acao()} onApprove={onApprove} onDeny={vi.fn()} onAlwaysAllow={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }));

    expect(await screen.findByTestId('recusa-da-decisao')).toHaveTextContent('falhou ao executar');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aprovar' })).toBeEnabled());
  });

  it('ação que saiu de pending não oferece botão nenhum (a linha de desfecho no lugar)', () => {
    render(
      <ApprovalCard
        action={acao({ status: 'approved' })}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onAlwaysAllow={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Aprovar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sempre permitir' })).toBeNull();
  });
});
