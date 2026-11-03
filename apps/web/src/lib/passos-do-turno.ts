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

const TETO_DE_SAIDA = 2000;

export function passosDoTurno(events: SessionEvent[], resposta: SessionEvent): PassoDeFerramenta[] {
  const passos: PassoDeFerramenta[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.seq >= resposta.seq || e.actor.id !== resposta.actor.id) continue;
    if (e.type === 'agent.response') break;
    if (e.type !== 'tool.result') continue;
    const p = (e.payload ?? {}) as { tool?: unknown; ok?: unknown; resultado?: unknown; resultadoTotal?: unknown; result?: unknown };
    // AT-718: o ToolLoop dos dev agents grava `result` (sem `resultadoTotal`); o corte é o mesmo teto da RN-589.
    const saida = p.resultado !== undefined ? p.resultado : p.result;
    const texto = saida === undefined || saida === null ? undefined : typeof saida === 'string' ? saida : JSON.stringify(saida);
    const cortadoAqui = p.resultado === undefined && p.resultadoTotal === undefined && texto !== undefined && texto.length > TETO_DE_SAIDA;
    passos.unshift({
      id: e.id,
      tool: typeof p.tool === 'string' ? p.tool : '?',
      ok: p.ok !== false,
      resultado: texto === undefined ? undefined : cortadoAqui ? texto.slice(0, TETO_DE_SAIDA) : texto,
      truncado: p.resultadoTotal !== undefined || cortadoAqui,
    });
  }
  return passos;
}

