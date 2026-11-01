import type { SessionEvent } from './api-types';
import { planoVigente, type PlanoDoAgente } from '../routes/RetomarTurnoInterrompido';

/**
 * O plano do agente NO TURNO EM CURSO (RN-967): o último `agent.plan` dele
 * com `seq` posterior à abertura do turno (o último `agent.status: working`),
 * lido dos eventos já carregados — nenhuma requisição.
 */
export function planoDoTurno(events: SessionEvent[], agente: string | null): PlanoDoAgente | null {
  if (!agente) return null;
  const abertura = events
    .filter(
      (e) =>
        e.type === 'agent.status' &&
        e.actor.kind === 'agent' &&
        e.actor.id === agente &&
        (e.payload as { status?: unknown } | null)?.status === 'working',
    )
    .reduce((m, e) => Math.max(m, e.seq), -1);
  const maior = events.reduce((m, e) => Math.max(m, e.seq), 0);
  return planoVigente(
    events.filter((e) => e.seq > abertura),
    { actor: { kind: 'agent', id: agente }, seq: maior + 1 } as SessionEvent,
  );
}
