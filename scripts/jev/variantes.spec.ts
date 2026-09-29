import { describe, expect, it } from 'vitest';
import type { Dados } from './dados.ts';
import { inicioDaExecucao, montarEstadoV2, passosAnteriores, progressoDe, VARIANTES, type Contexto } from './variantes.ts';
import { montarPassos, type Acao, type Catalogo, type Evento, type LinhaDeUso } from './passos.ts';

const catalogo: Catalogo = {
  agentes: { 'dev-*': ['read_file', 'write_file', 'terminal', 'report_done', 'report_blocked'] },
  ferramentas: {},
  identidades: {},
};
const t = (s: number, us = 0) => `2026-09-29T06:00:${String(s).padStart(2, '0')}.${String(us).padStart(6, '0')}Z`;
let seq = 0;
const ev = (tipo: string, ator: string, em: string, payload: Record<string, unknown>): Evento => ({ sessao: 's1', seq: ++seq, tipo, atorTipo: 'agent', ator, em, projetoId: 'p1', payload });
const uso = (em: string): LinhaDeUso => ({ sessao: 's1', ator: 'dev-x', em });

/** Dois passos da tarefa A (o segundo termina com report_done), depois a tarefa B com três passos. */
function fixture(acoes: Acao[] = []) {
  seq = 0;
  const eventos: Evento[] = [
    ev('dev.working', 'dev-x', t(0), { taskId: 'tA', agentId: 'dev-x', taskTitle: 'Tarefa A' }),
    ev('agent.response', 'dev-x', t(1, 1), { content: 'TEXTO_A1' }),
    ev('tool.call', 'dev-x', t(1, 2), { tool: 'read_file', args: { path: 'a.ts' } }),
    ev('tool.result', 'dev-x', t(1, 3), { tool: 'read_file', ok: true, result: 'RESULTADO_A1' }),
    ev('tool.call', 'dev-x', t(2, 2), { tool: 'report_done', args: {} }),
    ev('tool.result', 'dev-x', t(2, 3), { tool: 'report_done', ok: true, result: 'RESULTADO_A2' }),
    ev('dev.working', 'dev-x', t(3), { taskId: 'tB', agentId: 'dev-x', taskTitle: 'Tarefa B' }),
    ev('agent.response', 'dev-x', t(4, 1), { content: 'TEXTO_B1' }),
    ev('tool.call', 'dev-x', t(4, 2), { tool: 'write_file', args: { path: 'b.ts' } }),
    ev('tool.result', 'dev-x', t(4, 3), { tool: 'write_file', ok: true, result: 'RESULTADO_B1' }),
    ev('tool.call', 'dev-x', t(5, 2), { tool: 'terminal', args: { command: 'npm test' } }),
    ev('proposed_action.created', 'dev-x', t(5, 3), { actionId: 'ac1', status: 'pending' }),
    // sem tool.result: o comando esperou aprovação
    ev('agent.response', 'dev-x', t(7, 1), { content: 'TEXTO_ALVO' }),
    ev('tool.call', 'dev-x', t(7, 2), { tool: 'report_done', args: { segredo: 'ARGUMENTO_ALVO' } }),
    ev('tool.result', 'dev-x', t(7, 3), { tool: 'report_done', ok: true, result: 'RESULTADO_ALVO' }),
  ];
  const usos = [uso(t(1)), uso(t(2)), uso(t(4)), uso(t(5)), uso(t(7))];
  const dados: Dados = {
    eventos,
    usos,
    instrucoes: [],
    tarefas: [
      { id: 'tA', storyId: 'h1', title: 'Tarefa A', description: null },
      { id: 'tB', storyId: 'h1', title: 'Tarefa B', description: null },
    ],
    historias: [{ id: 'h1', title: 'Historia', description: null, rf: [], rnf: [], dod: [] }],
    modulos: [],
    acoes,
  };
  const { passos } = montarPassos(eventos, usos, catalogo, new Map(acoes.map((a) => [a.id, a])));
  const cx: Contexto = { dados, eventos, passos, catalogo, instrucoes: new Map() };
  return { cx, passos, alvo: passos.at(-1)! };
}

describe('nada do passo-alvo entra no state', () => {
  it('nem a ferramenta, nem o argumento, nem o resultado, nem o texto do próprio passo — em nenhuma variante', () => {
    const { cx, alvo } = fixture();
    expect(alvo.chamadas[0]!.ferramenta).toBe('report_done');
    for (const v of Object.values(VARIANTES)) {
      const json = JSON.stringify(montarEstadoV2(cx, alvo, v));
      for (const proibido of ['ARGUMENTO_ALVO', 'RESULTADO_ALVO', 'TEXTO_ALVO']) expect(json, `${v.nome}: ${proibido}`).not.toContain(proibido);
    }
  });
});

describe('escopo da execução', () => {
  it('o kickoff (dev.working) recomeça o laço: a tarefa anterior não está no ctx.messages', () => {
    const { cx, alvo } = fixture();
    const sem = montarEstadoV2(cx, alvo, VARIANTES.kickoff!);
    const com = montarEstadoV2(cx, alvo, VARIANTES.escopo!);
    expect(JSON.stringify(sem.passos_recentes)).toContain('a.ts');
    expect(JSON.stringify(com.passos_recentes)).not.toContain('a.ts');
    expect(JSON.stringify(com.passos_recentes)).toContain('b.ts');
  });

  it('uma ferramenta de fim (report_done) encerra a execução; a do passo do alvo não conta', () => {
    const { cx, passos, alvo } = fixture();
    const inicio = inicioDaExecucao(cx.eventos, passos, alvo);
    expect(inicio).toBe(t(3)); // o `dev.working` da tarefa B, depois do report_done da A
    expect(passosAnteriores(cx.eventos, passos, alvo, true).map((p) => p.chamadas[0]!.ferramenta)).toEqual(['write_file', 'terminal']);
    expect(passosAnteriores(cx.eventos, passos, alvo, false)).toHaveLength(4);
  });
});

describe('o que cada liga acrescenta', () => {
  it('kickoff: o pedido é a mensagem inicial do laço, com o título da tarefa e o da história', () => {
    const { cx, alvo } = fixture();
    expect(montarEstadoV2(cx, alvo, VARIANTES.original!).pedido).toBe('Tarefa: Tarefa B');
    expect(montarEstadoV2(cx, alvo, VARIANTES.kickoff!).pedido).toContain('Implemente a task "Tarefa B" da story "Historia".');
  });

  it('texto: o texto do modelo dos passos ANTERIORES, na primeira chamada do passo, e só com a liga', () => {
    const { cx, alvo } = fixture();
    expect(JSON.stringify(montarEstadoV2(cx, alvo, VARIANTES.escopo!))).not.toContain('TEXTO_B1');
    const com = montarEstadoV2(cx, alvo, VARIANTES.texto!);
    expect(com.passos_recentes[0]!.texto_do_modelo).toBe('TEXTO_B1');
  });

  it('acoes: o resultado do comando aprovado à mão vem do desfecho, no formato que o laço leu', () => {
    const acao: Acao = { id: 'ac1', status: 'executed', execution_result: { exitCode: 0, stdout: 'SAIDA', stderr: '' }, rejection_reason: null };
    const { cx, alvo } = fixture([acao]);
    const terminal = (v: string) => montarEstadoV2(cx, alvo, VARIANTES[v]!).passos_recentes.find((p) => p.ferramenta === 'terminal')!;
    expect(terminal('escopo').resultado).toBe('(sem resultado gravado)');
    expect(terminal('acoes').resultado).toBe('exit 0\nSAIDA');
  });

  it('acoes: falha e recusa têm o texto do `texto_do_desfecho/1`', () => {
    const falha: Acao = { id: 'ac1', status: 'failed', execution_result: { stderr: 'ERRO ', stdout: 'x' }, rejection_reason: null };
    expect(montarEstadoV2(fixture([falha]).cx, fixture([falha]).alvo, VARIANTES.acoes!).passos_recentes.at(-1)!.resultado).toBe('falhou: ERRO x');
    const recusa: Acao = { id: 'ac1', status: 'denied', execution_result: null, rejection_reason: 'não' };
    const f = fixture([recusa]);
    expect(montarEstadoV2(f.cx, f.alvo, VARIANTES.acoes!).passos_recentes.at(-1)!.resultado).toBe('recusado pelo usuário: não');
  });

  it('recentes: 0 é lista vazia (slice(-0) devolveria tudo)', () => {
    const { cx, alvo } = fixture();
    expect(montarEstadoV2(cx, alvo, VARIANTES.so_trilha!).passos_recentes).toEqual([]);
    expect(montarEstadoV2(cx, alvo, VARIANTES.so_trilha!).trilha).toEqual(['write_file', 'terminal']);
  });

  it('progresso: só contagens do que já aconteceu', () => {
    const { cx, alvo } = fixture();
    const p = progressoDe(passosAnteriores(cx.eventos, cx.passos, alvo, true));
    expect(p).toMatchObject({
      passos_anteriores: 2,
      chamadas_por_ferramenta: { write_file: 1, terminal: 1 },
      comandos_de_terminal: { execucao: 1 },
      execucoes_de_teste: 1,
      arquivos_gravados: 1,
      ultima_ferramenta: 'terminal',
    });
  });
});
