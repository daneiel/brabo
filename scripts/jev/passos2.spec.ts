import { describe, expect, it } from 'vitest';
import { montarPassos, parearChamadas, textoDoDesfecho, type Catalogo, type Evento, type LinhaDeUso } from './passos.ts';

const catalogo: Catalogo = { agentes: { 'dev-*': ['terminal', 'write_file'] }, ferramentas: {}, identidades: {} };
const t = (s: number, us = 0) => `2026-09-29T06:00:${String(s).padStart(2, '0')}.${String(us).padStart(6, '0')}Z`;
let seq = 0;
const ev = (tipo: string, ator: string, em: string, payload: Record<string, unknown>): Evento => ({ sessao: 's1', seq: ++seq, tipo, atorTipo: 'agent', ator, em, projetoId: 'p1', payload });
const uso = (em: string): LinhaDeUso => ({ sessao: 's1', ator: 'dev-x', em });

describe('o desfecho das ações e o texto do modelo (2ª rodada)', () => {
  it('textoDoDesfecho reproduz o `texto_do_desfecho/1` do dev agent (dev_agent_server.ex) para cada status liquidado', () => {
    const a = (status: string, exec: Record<string, unknown> | null, motivo: string | null = null) => ({ id: 'x', status, execution_result: exec, rejection_reason: motivo });
    expect(textoDoDesfecho(a('executed', { exitCode: 0, stdout: 'ok' }))).toBe('exit 0\nok');
    expect(textoDoDesfecho(a('executed', { stdout: 'ok' }))).toBe('exit ?\nok');
    expect(textoDoDesfecho(a('failed', { stderr: 'E:', stdout: 'o' }))).toBe('falhou: E:o');
    expect(textoDoDesfecho(a('denied', null, 'não'))).toBe('recusado pelo usuário: não');
    expect(textoDoDesfecho(a('denied', null))).toBe('recusado pelo usuário: sem motivo informado');
    expect(textoDoDesfecho(a('pending', null))).toBeNull();
  });

  it('a proposta gravada logo depois do tool.call amarra a chamada ao desfecho; o tool.result do log continua mandando', () => {
    seq = 0;
    const eventos = [
      ev('tool.call', 'dev-x', t(1), { tool: 'terminal', args: { command: 'a' } }),
      ev('proposed_action.created', 'dev-x', t(1, 5), { actionId: 'ac1' }),
      ev('tool.call', 'dev-x', t(2), { tool: 'terminal', args: { command: 'b' } }),
      ev('proposed_action.created', 'dev-x', t(2, 5), { actionId: 'ac2' }),
      ev('tool.result', 'dev-x', t(2, 9), { tool: 'terminal', ok: true, result: 'do log' }),
    ];
    const acoes = new Map([
      ['ac1', { id: 'ac1', status: 'executed', execution_result: { exitCode: 0, stdout: 'aprovado' }, rejection_reason: null }],
      ['ac2', { id: 'ac2', status: 'executed', execution_result: { exitCode: 0, stdout: 'outro' }, rejection_reason: null }],
    ]);
    const [a, b] = parearChamadas(eventos, acoes).get('s1|dev-x')!;
    expect(a!.resultado).toBeNull();
    expect(a!.resultadoReconstruido).toBe('exit 0\naprovado');
    expect(b!.resultado).toBe('do log');
  });

  it('o texto (`agent.response`) entra no passo em que foi escrito', () => {
    seq = 0;
    const eventos = [
      ev('agent.response', 'dev-x', t(1, 100), { content: 'primeiro' }),
      ev('tool.call', 'dev-x', t(1, 200), { tool: 'terminal', args: {} }),
      ev('agent.response', 'dev-x', t(3, 100), { content: 'segundo' }),
      ev('tool.call', 'dev-x', t(3, 200), { tool: 'write_file', args: {} }),
    ];
    const { passos } = montarPassos(eventos, [uso(t(1)), uso(t(3))], catalogo);
    expect(passos.map((p) => p.texto)).toEqual(['primeiro', 'segundo']);
  });
});
