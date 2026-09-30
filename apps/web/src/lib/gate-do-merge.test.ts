import { describe, expect, it } from 'vitest';
import { gatePendenteNoMerge } from './gate-do-merge';

describe('gatePendenteNoMerge (AT-249, RN-663)', () => {
  it('nomeia o gate que ainda não julgou a tarefa', () => {
    expect(gatePendenteNoMerge({ status: 'in_review', gateStatus: 'awaiting_qa' })).toBe(
      'qa-verificada',
    );
    expect(gatePendenteNoMerge({ status: 'in_review', gateStatus: 'awaiting_secops' })).toBe(
      'secops-segura',
    );
    // O gate nem abriu: é o de QA que falta.
    expect(gatePendenteNoMerge({ status: 'in_progress', gateStatus: null })).toBe(
      'qa-verificada',
    );
  });

  it('gates passados, tarefa concluída ou PR sem tarefa: nada a avisar', () => {
    expect(gatePendenteNoMerge({ status: 'in_review', gateStatus: 'awaiting_user' })).toBeNull();
    expect(gatePendenteNoMerge({ status: 'done', gateStatus: 'awaiting_qa' })).toBeNull();
    expect(gatePendenteNoMerge(undefined)).toBeNull();
  });
});
