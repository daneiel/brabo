import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ApprovalCard } from './ApprovalCard';
import type { ProposedAction } from '../lib/api-types';

function makeAction(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'action-1',
    projectId: 'project-1',
    sessionId: 'session-1',
    seq: 1,
    actionType: 'terminal',
    payload: { command: 'rm -rf /tmp/build' },
    status: 'pending',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'llama3.1:8b' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ApprovalCard', () => {
  it('chama onApprove ao clicar em Aprovar', () => {
    const onApprove = vi.fn();
    render(
      <ApprovalCard action={makeAction()} onApprove={onApprove} onDeny={vi.fn()} onAlwaysAllow={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('chama onDeny ao clicar em Negar', () => {
    const onDeny = vi.fn();
    render(
      <ApprovalCard action={makeAction()} onApprove={vi.fn()} onDeny={onDeny} onAlwaysAllow={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Negar' }));
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it('chama onAlwaysAllow ao clicar em Sempre permitir', () => {
    const onAlwaysAllow = vi.fn();
    render(
      <ApprovalCard action={makeAction()} onApprove={vi.fn()} onDeny={vi.fn()} onAlwaysAllow={onAlwaysAllow} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sempre permitir' }));
    expect(onAlwaysAllow).toHaveBeenCalledTimes(1);
  });

  it('mostra a nota de permissions.json na variante chat', () => {
    render(<ApprovalCard action={makeAction()} variant="chat" onApprove={vi.fn()} onDeny={vi.fn()} onAlwaysAllow={vi.fn()} />);
    expect(screen.getByText(/permissions\.json/)).toBeInTheDocument();
  });

  it('esconde os botões e mostra o estado decidido quando negado', () => {
    render(
      <ApprovalCard
        action={makeAction({ status: 'denied', rejectionReason: 'comando destrutivo' })}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onAlwaysAllow={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Aprovar' })).not.toBeInTheDocument();
    expect(screen.getByText(/Negado/)).toBeInTheDocument();
    expect(screen.getByText(/comando destrutivo/)).toBeInTheDocument();
  });

  it('mostra "sempre permitido" quando auto_approved com política auto_approve', () => {
    render(
      <ApprovalCard
        action={makeAction({ status: 'auto_approved', resolvedPolicy: 'auto_approve' })}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onAlwaysAllow={vi.fn()}
      />,
    );

    expect(screen.getByText(/Sempre permitido/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprovar' })).not.toBeInTheDocument();
  });

  it('mostra "Aprovado · comando em execução" para ação terminal aprovada', () => {
    render(
      <ApprovalCard action={makeAction({ status: 'approved' })} onApprove={vi.fn()} onDeny={vi.fn()} onAlwaysAllow={vi.fn()} />,
    );
    expect(screen.getByText('Aprovado · comando em execução')).toBeInTheDocument();
  });

  it('renderiza o comando da ação terminal', () => {
    render(<ApprovalCard action={makeAction()} onApprove={vi.fn()} onDeny={vi.fn()} onAlwaysAllow={vi.fn()} />);
    expect(screen.getByText(/rm -rf \/tmp\/build/)).toBeInTheDocument();
  });

  it('permite seleção em lote quando selectable', () => {
    const onToggleSelect = vi.fn();
    render(
      <ApprovalCard
        action={makeAction()}
        variant="queue"
        selectable
        selected={false}
        onToggleSelect={onToggleSelect}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onAlwaysAllow={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
  });
});
