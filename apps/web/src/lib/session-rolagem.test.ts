import { describe, it, expect } from 'vitest';
import type { SessionEvent } from './api-types';
import { seqDaEsperaPorAprovacao } from './session-rolagem';

function status(seq: number, valor: string): SessionEvent {
  return {
    id: `e${seq}`,
    seq,
    type: 'agent.status',
    actor: { kind: 'agent', id: 'dev-lead' },
    payload: { status: valor },
    createdAt: new Date(0).toISOString(),
  } as unknown as SessionEvent;
}

describe('seqDaEsperaPorAprovacao (RN-748)', () => {
  it('caminho feliz: devolve o seq da espera por aprovação mais recente', () => {
    expect(
      seqDaEsperaPorAprovacao([
        status(1, 'working'),
        status(4, 'awaiting_approval'),
        status(2, 'awaiting_approval'),
      ]),
    ).toBe(4);
  });

  it('sem espera por aprovação no log: null', () => {
    expect(seqDaEsperaPorAprovacao([status(1, 'working'), status(2, 'idle')])).toBeNull();
  });
});
