import { describe, expect, it } from 'vitest';
import type { SessionEvent } from './api-types';
import { estadosNaFila } from './fila-de-mensagens';

const ev = (seq: number, type: string, actorId: string, payload: unknown): SessionEvent =>
  ({
    id: `e${seq}`,
    seq,
    type,
    actor: { kind: type === 'chat.message_cancelled' ? 'user' : 'agent', id: actorId },
    payload,
    createdAt: '2026-10-01T00:00:00.000Z',
  }) as SessionEvent;

// RN-673: o estado na fila sai do log, pela MESMA derivação do engine.
describe('estadosNaFila (RN-673)', () => {
  it('enfileirada e nem entregue nem cancelada é "naFila", com o agente da fila', () => {
    const estados = estadosNaFila([
      ev(1, 'chat.message_queued', 'po', { mensagemId: 'm1' }),
      ev(2, 'chat.message_queued', 'po', { mensagemId: 'm2' }),
      ev(3, 'chat.message_delivered', 'po', { mensagemIds: ['m1'] }),
    ]);
    expect(estados.get('m1')).toBeUndefined();
    expect(estados.get('m2')).toEqual({ estado: 'naFila', agente: 'po' });
  });

  it('cancelada vence a fila; payload torto não vira selo', () => {
    const estados = estadosNaFila([
      ev(1, 'chat.message_queued', 'po', { mensagemId: 'm1' }),
      ev(2, 'chat.message_cancelled', 'u1', { mensagemId: 'm1', agente: 'po' }),
      ev(3, 'chat.message_queued', 'po', { mensagemId: 42 }),
      ev(4, 'chat.message_delivered', 'po', { mensagemIds: 'm9' }),
    ]);
    expect(estados.get('m1')).toEqual({ estado: 'cancelada', agente: 'po' });
    expect(estados.size).toBe(1);
  });
});
