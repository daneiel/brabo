import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BootstrapSteps } from './BootstrapSteps';
import { BOOTSTRAP_STEPS, type StepUi } from '../lib/bootstrap';
import type { BootstrapStepName } from '../lib/api-types';

function states(
  overrides: Partial<Record<BootstrapStepName, StepUi>> = {},
): Record<BootstrapStepName, StepUi> {
  const base = {} as Record<BootstrapStepName, StepUi>;
  for (const step of BOOTSTRAP_STEPS) base[step.name] = { state: 'pendente' };
  return { ...base, ...overrides };
}

describe('BootstrapSteps', () => {
  it('renderiza os 5 passos', () => {
    // Eram 6 até `create_rc_branch` sair da sequência junto com o degrau
    // `rc` (ADR 0030, achado #3). O painel lista o que o bootstrap FAZ.
    render(<BootstrapSteps stepStates={states()} />);
    const items = screen.getByTestId('bootstrap-steps').querySelectorAll('li');
    expect(items).toHaveLength(5);
  });

  it('marca o passo que falhou com data-state=falha e mostra a nota', () => {
    render(
      <BootstrapSteps
        stepStates={states({
          commit_pr_template: { state: 'ok' },
          commit_branching_policy: { state: 'falha', note: 'sem permissão' },
        })}
        failedStep="commit_branching_policy"
      />,
    );

    const failed = document.querySelector('[data-step="commit_branching_policy"]');
    expect(failed).toHaveAttribute('data-state', 'falha');
    expect(failed).toHaveTextContent('sem permissão');

    const ok = document.querySelector('[data-step="commit_pr_template"]');
    expect(ok).toHaveAttribute('data-state', 'ok');
  });

  it('failedStep força falha mesmo sem estado de evento', () => {
    render(
      <BootstrapSteps stepStates={states()} failedStep="create_qa_branch" />,
    );
    const failed = document.querySelector('[data-step="create_qa_branch"]');
    expect(failed).toHaveAttribute('data-state', 'falha');
  });
});
