import { describe, expect, it } from 'vitest';
import type { SessionEvent } from './api-types';
import { planoDoTurno } from './plano-do-turno';

const ev = (seq: number, type: string, payload: unknown, id = 'po') =>
  ({ id: `e${seq}`, sessionId: 's', seq, type, actor: { kind: 'agent', id }, payload, createdAt: '' }) as SessionEvent;
const plano = (seq: number, objetivo: string, id = 'po') =>
  ev(seq, 'agent.plan', { objetivo, passos: [{ texto: 'a', estado: 'feito' }] }, id);
const working = (seq: number) => ev(seq, 'agent.status', { status: 'working' });

describe('planoDoTurno', () => {
  it('devolve o último plano do agente posterior à abertura do turno', () => {
    const r = planoDoTurno([plano(1, 'velho'), working(2), plano(3, 'p1'), plano(4, 'p2'), plano(5, 'outro', 'dev')], 'po');
    expect(r?.objetivo).toBe('p2');
  });
  it('plano de turno anterior ou sem agente: nada', () => {
    expect(planoDoTurno([plano(1, 'velho'), working(2)], 'po')).toBeNull();
    expect(planoDoTurno([working(1), plano(2, 'x')], null)).toBeNull();
  });
});
