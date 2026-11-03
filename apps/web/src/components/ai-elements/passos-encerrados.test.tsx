import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../../lib/i18n';
import { passosDoTurno } from '../../lib/passos-do-turno';
import type { SessionEvent } from '../../lib/api-types';
import { PassosEncerrados } from './passos-encerrados';

const ev = (seq: number, type: string, payload: unknown = {}, actor = 'dev'): SessionEvent =>
  ({ id: `e${seq}`, seq, type, actor: { kind: 'agent', id: actor }, payload }) as unknown as SessionEvent;
const tr = (seq: number, tool: string, ok = true, extra = {}) =>
  ev(seq, 'tool.result', { tool, ok, resultado: `r-${tool}`, args: { segredo: 'X' }, ...extra });

describe('passos do turno encerrado (RN-974)', () => {
  it('3 ferramentas viram 3 passos em ordem, sem args', () => {
    const events = [ev(1, 'agent.response'), tr(2, 'a'), tr(3, 'b'), tr(4, 'c'), ev(5, 'agent.response')];
    const passos = passosDoTurno(events, events[4]!);
    expect(passos.map((p) => p.tool)).toEqual(['a', 'b', 'c']);
    const { container } = render(<PassosEncerrados passos={passos} />);
    expect(container.querySelectorAll('[data-slot="ai-tool"]').length).toBe(0); // recolhido
    fireEvent.click(screen.getByRole('button'));
    expect(container.querySelectorAll('[data-slot="ai-tool"]').length).toBe(3);
    expect(container.textContent).not.toContain('segredo');
  });

  it('ok:false aparece como falha e o corte é avisado', () => {
    const events = [tr(1, 'x', false, { resultadoTotal: 5000 }), ev(2, 'agent.response')];
    render(<PassosEncerrados passos={passosDoTurno(events, events[1]!)} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getAllByRole('button')[1]!);
    expect(screen.getByRole('alert').textContent).toContain('r-x');
    expect(document.querySelector('[data-slot="ai-tool-truncated"]')).toBeTruthy();
  });

  it('turno sem ferramenta não ganha passos', () => {
    const events = [ev(1, 'agent.response'), ev(2, 'agent.response')];
    expect(passosDoTurno(events, events[1]!)).toEqual([]);
  });
});

describe('passos do turno: formato do ToolLoop dos dev agents (AT-718)', () => {
  it('tool.result com `result` mostra a saída', () => {
    const events = [ev(1, 'tool.result', { tool: 'run_tests', ok: true, result: 'PASS 3' }, 'dev-x'), ev(2, 'agent.response', {}, 'dev-x')];
    const passos = passosDoTurno(events, events[1]!);
    expect(passos[0]!.resultado).toBe('PASS 3');
    expect(passos[0]!.truncado).toBe(false);
  });

  it('result não-string vira JSON', () => {
    const events = [ev(1, 'tool.result', { tool: 't', ok: true, result: { n: 2 } }, 'dev-x'), ev(2, 'agent.response', {}, 'dev-x')];
    expect(passosDoTurno(events, events[1]!)[0]!.resultado).toBe('{"n":2}');
  });

  it('result longo é cortado no teto com o aviso', () => {
    const longo = 'a'.repeat(2500);
    const events = [ev(1, 'tool.result', { tool: 't', ok: true, result: longo }, 'dev-x'), ev(2, 'agent.response', {}, 'dev-x')];
    const p = passosDoTurno(events, events[1]!)[0]!;
    expect(p.resultado?.length).toBe(2000);
    expect(p.truncado).toBe(true);
  });

  it('formato da RN-589 (resultado) continua igual', () => {
    const events = [tr(1, 'a'), ev(2, 'agent.response')];
    const p = passosDoTurno(events, events[1]!)[0]!;
    expect(p.resultado).toBe('r-a');
    expect(p.truncado).toBe(false);
  });
});
