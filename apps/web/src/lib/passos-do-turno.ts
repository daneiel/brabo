import type { SessionEvent } from './api-types';

/*
 * AT-675, RN-974: as ferramentas de um turno ENCERRADO, lidas dos `tool.result`
 * que o fio já tem (RN-589: `tool`, `ok`, `resultado`). NUNCA devolve `args`
 * (RN-096). O turno vai do `agent.response` anterior do mesmo ator até este.
 */
export interface PassoDeFerramenta {
  id: string;
  tool: string;
  ok: boolean;
  resultado?: string;
  truncado: boolean;
}

export function passosDoTurno(events: SessionEvent[], resposta: SessionEvent): PassoDeFerramenta[] {
  const passos: PassoDeFerramenta[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.seq >= resposta.seq || e.actor.id !== resposta.actor.id) continue;
    if (e.type === 'agent.response') break;
    if (e.type !== 'tool.result') continue;
    const p = (e.payload ?? {}) as { tool?: unknown; ok?: unknown; resultado?: unknown; resultadoTotal?: unknown };
    passos.unshift({
      id: e.id,
      tool: typeof p.tool === 'string' ? p.tool : '?',
      ok: p.ok !== false,
      resultado: typeof p.resultado === 'string' ? p.resultado : undefined,
      truncado: p.resultadoTotal !== undefined,
    });
  }
  return passos;
}

