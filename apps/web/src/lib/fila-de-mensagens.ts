import type { SessionEvent } from './api-types';

/**
 * O estado de cada `chat.message` na fila de um agente (RN-673, ADR 0191),
 * derivado do event log — a MESMA derivação que o engine faz para reconstruir
 * a fila (`Engine.Agents.FilaDeMensagens.pendentes/2`), nunca um estado
 * guardado na tela.
 *
 * - `naFila` — o engine gravou `chat.message_queued` e ainda não a entregou nem
 *   ela foi cancelada: espera o fim do turno do agente;
 * - `cancelada` — `chat.message_cancelled`: nunca foi lida por agente nenhum;
 * - mensagem que nunca entrou na fila, ou que já foi entregue, não aparece no
 *   mapa — é uma mensagem comum.
 *
 * Recorte (RN-180): a leitura é a janela de eventos da tela. Um
 * `chat.message_queued` que saiu da janela deixa a mensagem sem selo — a tela
 * não afirma "na fila" sobre o que não leu.
 */
export type EstadoNaFila =
  | { estado: 'naFila'; agente: string }
  | { estado: 'cancelada'; agente: string | null };

function texto(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

export function estadosNaFila(events: readonly SessionEvent[]): Map<string, EstadoNaFila> {
  const enfileiradas = new Map<string, string>();
  const entregues = new Set<string>();
  const canceladas = new Map<string, string | null>();

  for (const e of events) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    if (e.type === 'chat.message_queued') {
      const id = texto(p.mensagemId);
      if (id) enfileiradas.set(id, e.actor.id);
    } else if (e.type === 'chat.message_delivered') {
      if (Array.isArray(p.mensagemIds)) {
        for (const id of p.mensagemIds) if (typeof id === 'string') entregues.add(id);
      }
    } else if (e.type === 'chat.message_cancelled') {
      const id = texto(p.mensagemId);
      if (id) canceladas.set(id, texto(p.agente));
    }
  }

  const estados = new Map<string, EstadoNaFila>();
  for (const [id, agente] of canceladas) estados.set(id, { estado: 'cancelada', agente });
  for (const [id, agente] of enfileiradas) {
    if (!entregues.has(id) && !canceladas.has(id)) estados.set(id, { estado: 'naFila', agente });
  }
  return estados;
}
