import { describe, expect, it } from 'vitest';
import { deriveStepStates } from './bootstrap';
import type { SessionEvent } from './api-types';

function evt(
  seq: number,
  type: string,
  payload: Record<string, unknown>,
): SessionEvent {
  return {
    id: `evt-${seq}`,
    sessionId: 'session-1',
    seq,
    type,
    actor: { kind: 'system', id: 'git-bootstrap' },
    payload,
    createdAt: new Date().toISOString(),
  };
}

describe('deriveStepStates', () => {
  it('sem eventos: todos os passos pendentes', () => {
    const states = deriveStepStates([]);
    expect(states.commit_pr_template.state).toBe('pendente');
    expect(states.protect_branches.state).toBe('pendente');
  });

  it('started depois completed vira ok (last-wins por seq)', () => {
    const states = deriveStepStates([
      evt(1, 'bootstrap.step_started', { step: 'commit_pr_template' }),
      evt(2, 'bootstrap.step_completed', {
        step: 'commit_pr_template',
        path: '.github/pull_request_template.md',
        sha: 'abc',
      }),
    ]);
    expect(states.commit_pr_template.state).toBe('ok');
  });

  it('falha no meio: passo culpado = falha, anteriores = ok, posteriores = pendente', () => {
    const states = deriveStepStates([
      evt(1, 'bootstrap.step_started', { step: 'commit_pr_template' }),
      evt(2, 'bootstrap.step_completed', { step: 'commit_pr_template' }),
      evt(3, 'bootstrap.step_started', { step: 'commit_branching_policy' }),
      evt(4, 'bootstrap.step_failed', {
        step: 'commit_branching_policy',
        error: 'sem permissão de escrita',
      }),
    ]);

    expect(states.commit_pr_template.state).toBe('ok');
    expect(states.commit_branching_policy.state).toBe('falha');
    expect(states.commit_branching_policy.note).toBe('sem permissão de escrita');
    expect(states.create_dev_branch.state).toBe('pendente');
    expect(states.protect_branches.state).toBe('pendente');
  });

  it('degradado (capability_unsupported) vira skip com nota', () => {
    const states = deriveStepStates([
      evt(1, 'bootstrap.step_degraded', {
        step: 'protect_branches',
        reason: 'capability_unsupported',
        provider: 'local',
      }),
    ]);
    expect(states.protect_branches.state).toBe('skip');
    expect(states.protect_branches.note).toBe('não suportado');
  });

  it('skipped (already_satisfied) vira skip', () => {
    const states = deriveStepStates([
      evt(1, 'bootstrap.step_skipped', {
        step: 'create_dev_branch',
        reason: 'already_satisfied',
      }),
    ]);
    expect(states.create_dev_branch.state).toBe('skip');
  });

  it('ignora eventos fora de ordem (aplica por seq)', () => {
    const states = deriveStepStates([
      evt(2, 'bootstrap.step_completed', { step: 'commit_pr_template' }),
      evt(1, 'bootstrap.step_started', { step: 'commit_pr_template' }),
    ]);
    expect(states.commit_pr_template.state).toBe('ok');
  });
});
