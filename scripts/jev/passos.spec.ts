import { describe, expect, it } from 'vitest';
import {
  CORTE_DO_PASSO,
  PASSOS_RECENTES,
  catalogoDoAtor,
  montarEstado,
  montarPassos,
  parearChamadas,
  pedidoDoPasso,
  suspeitasDe,
  type Catalogo,
  type Evento,
  type LinhaDeUso,
} from './passos.ts';

const catalogo: Catalogo = {
  agentes: { po: ['listar_backlog', 'create_story'], 'dev-*': ['terminal', 'write_file'], psicologo: ['emit_hypotheses'] },
  ferramentas: { listar_backlog: 'lista', create_story: 'cria', terminal: 'shell', write_file: 'escreve' },
  identidades: { po: 'Você é o PO.' },
};

const t = (s: number, us = 0) => `2026-09-29T06:00:${String(s).padStart(2, '0')}.${String(us).padStart(6, '0')}Z`;
let seq = 0;
function ev(tipo: string, ator: string, em: string, payload: Record<string, unknown>, atorTipo = 'agent'): Evento {
  return { sessao: 's1', seq: ++seq, tipo, atorTipo, ator, em, projetoId: 'p1', payload };
}
const uso = (ator: string, em: string): LinhaDeUso => ({ sessao: 's1', ator, em });

describe('parearChamadas', () => {
  it('pareia o resultado com a chamada MAIS RECENTE sem resultado, e a que nunca ganhou resultado fica sem', () => {
    seq = 0;
    const eventos = [
      ev('tool.call', 'dev-x', t(1), { tool: 'terminal', args: { command: 'a' } }),
      ev('tool.call', 'dev-x', t(2), { tool: 'terminal', args: { command: 'b' } }),
      ev('tool.result', 'dev-x', t(3), { tool: 'terminal', ok: true, result: 'exit 0\nB' }),
    ];
    const [a, b] = parearChamadas(eventos).get('s1|dev-x')!;
    expect(a!.resultado).toBeNull();
    expect(b!.resultado).toBe('exit 0\nB');
  });

  it('lê `resultado` (conversacionais, RN-589) e `result` (ToolLoop)', () => {
    seq = 0;
    const eventos = [
      ev('tool.call', 'po', t(1), { tool: 'listar_backlog', args: {} }),
      ev('tool.result', 'po', t(2), { tool: 'listar_backlog', ok: true, resultado: 'vazio' }),
    ];
    expect(parearChamadas(eventos).get('s1|po')![0]!.resultado).toBe('vazio');
  });
});

describe('montarPassos', () => {
  it('a fronteira é a linha de token_usage; passo sem tool.call é o rótulo de responder_sem_ferramenta', () => {
    seq = 0;
    const eventos = [
      ev('tool.call', 'po', t(1, 500), { tool: 'listar_backlog', args: {} }),
      ev('tool.result', 'po', t(1, 900), { tool: 'listar_backlog', ok: true, resultado: 'x' }),
      ev('tool.call', 'po', t(3, 10), { tool: 'create_story', args: {} }),
      ev('tool.call', 'po', t(3, 20), { tool: 'listar_backlog', args: {} }),
    ];
    // O mesmo milissegundo, microssegundos diferentes: comparar como texto separa os dois.
    const usos = [uso('po', t(1, 100)), uso('po', t(3, 1)), uso('po', t(5))];
    const { passos } = montarPassos(eventos, usos, catalogo);
    expect(passos.map((p) => p.rotulos)).toEqual([['listar_backlog'], ['create_story', 'listar_backlog'], []]);
  });

  it('ator fora do catálogo não vira passo; dev-<modulo> usa o catálogo dev-*', () => {
    seq = 0;
    const eventos = [ev('tool.call', 'dev-scoring', t(2), { tool: 'terminal', args: {} })];
    const { passos } = montarPassos(eventos, [uso('dev-scoring', t(1)), uso('context-manager', t(1))], catalogo);
    expect(passos).toHaveLength(1);
    expect(catalogoDoAtor(catalogo, 'dev-lead')).toBeUndefined();
  });

  it('conta tool.call antes da primeira fronteira e ferramenta fora do catálogo', () => {
    seq = 0;
    const eventos = [
      ev('tool.call', 'po', t(1), { tool: 'listar_backlog', args: {} }),
      ev('tool.call', 'po', t(3), { tool: 'offer_handoff', args: {} }),
    ];
    const r = montarPassos(eventos, [uso('po', t(2))], catalogo);
    expect(r.semFronteira).toBe(1);
    expect(r.foraDoCatalogo).toBe(1);
  });
});

describe('suspeitasDe', () => {
  it('separa sem resultado, ok:false e texto de falha', () => {
    const base = { seq: 1, em: t(1), ferramenta: 'terminal', argumentos: null };
    expect(suspeitasDe([{ ...base, resultado: null, ok: null }])).toEqual(['sem_resultado']);
    expect(suspeitasDe([{ ...base, resultado: 'x', ok: false }])).toEqual(['ok_false']);
    expect(suspeitasDe([{ ...base, resultado: 'falhou: npm', ok: true }])).toEqual(['falhou']);
    expect(suspeitasDe([{ ...base, resultado: 'exit 2\n', ok: true }])).toEqual(['falhou']);
    expect(suspeitasDe([{ ...base, resultado: 'exit 0\nok', ok: true }])).toEqual([]);
  });
});

describe('o state do passo', () => {
  it('conversacional: pedido = última chat.message do USUÁRIO antes do passo; nunca uma posterior', () => {
    seq = 0;
    const eventos = [
      ev('chat.message', 'u', t(1), { text: 'primeira' }, 'user'),
      ev('chat.message', 'u', t(2), { text: 'crie a história' }, 'user'),
      ev('tool.call', 'po', t(4), { tool: 'create_story', args: {} }),
      ev('chat.message', 'u', t(6), { text: 'depois' }, 'user'),
    ];
    const { passos } = montarPassos(eventos, [uso('po', t(3))], catalogo);
    expect(pedidoDoPasso(eventos, passos[0]!)).toBe('crie a história');
  });

  it('dev agent: pedido = título da tarefa do dev.working DELE', () => {
    seq = 0;
    const eventos = [
      ev('dev.working', 'dev-a', t(1), { agentId: 'dev-a', taskTitle: 'Tarefa A' }),
      ev('dev.working', 'dev-b', t(1, 5), { agentId: 'dev-b', taskTitle: 'Tarefa B' }),
      ev('tool.call', 'dev-a', t(3), { tool: 'terminal', args: {} }),
    ];
    const { passos } = montarPassos(eventos, [uso('dev-a', t(2))], catalogo);
    expect(pedidoDoPasso(eventos, passos[0]!)).toBe('Tarefa: Tarefa A');
  });

  it('leva só os últimos N passos ANTERIORES, cortados, e a identidade + a instrução do projeto', () => {
    seq = 0;
    const eventos: Evento[] = [];
    const usos: LinhaDeUso[] = [];
    for (let i = 0; i < 9; i++) {
      usos.push(uso('po', t(i * 2 + 1)));
      eventos.push(ev('tool.call', 'po', t(i * 2 + 2), { tool: 'listar_backlog', args: { i } }));
      eventos.push(ev('tool.result', 'po', t(i * 2 + 2, 1), { tool: 'listar_backlog', ok: true, resultado: 'r'.repeat(900) }));
    }
    const { passos } = montarPassos(eventos, usos, catalogo);
    const ultimo = passos.at(-1)!;
    const e = montarEstado(eventos, passos, ultimo, catalogo, new Map([['p1|po', 'Instrução do projeto']]));
    expect(e.passos_recentes).toHaveLength(PASSOS_RECENTES);
    expect(e.passos_recentes.at(-1)!.argumentos).toBe('{"i":7}');
    expect(e.passos_recentes[0]!.resultado.length).toBeLessThan(CORTE_DO_PASSO + 20);
    expect(e.contexto).toBe('Você é o PO.\n\nInstrução do projeto');
  });
});
