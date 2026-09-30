import { describe, expect, it } from 'vitest';
import { turnoEmCursoNoLog } from './session-turno';
import type { SessionEvent } from './api-types';

function status(seq: number, ator: string, estado: string): SessionEvent {
  return {
    id: `e-${seq}`,
    sessionId: 's-1',
    seq,
    type: 'agent.status',
    actor: { kind: 'agent', id: ator },
    payload: { status: estado },
    createdAt: '2026-09-29T12:00:00.000Z',
  } as SessionEvent;
}

describe('turnoEmCursoNoLog (AT-268)', () => {
  it('o working mais recente de um agente é o turno em curso', () => {
    expect(turnoEmCursoNoLog([status(1, 'po', 'idle'), status(4, 'po', 'working')])).toBe('po');
  });

  it('idle e awaiting_approval fecham o turno', () => {
    expect(turnoEmCursoNoLog([status(1, 'po', 'working'), status(2, 'po', 'idle')])).toBeNull();
    expect(
      turnoEmCursoNoLog([status(1, 'dev-lead', 'working'), status(2, 'dev-lead', 'awaiting_approval')]),
    ).toBeNull();
  });

  it('com dois agentes, vale o working de maior seq; o que fechou não conta', () => {
    const eventos = [
      status(1, 'po', 'working'),
      status(2, 'arquiteto', 'working'),
      status(3, 'po', 'idle'),
    ];
    expect(turnoEmCursoNoLog(eventos)).toBe('arquiteto');
  });

  it('sem nenhum agent.status na janela: não sabe, logo não afirma', () => {
    expect(turnoEmCursoNoLog([])).toBeNull();
  });
});
