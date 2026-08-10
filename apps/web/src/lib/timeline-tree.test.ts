import { describe, expect, it } from 'vitest';
import { marcoExpansivel, montarArvore, ramosAbertosPorPadrao } from './timeline-tree';
import type { SessionEvent } from './api-types';

let seq = 0;
function evento(
  type: string,
  actor: { kind: string; id: string },
  payload: Record<string, unknown> = {},
): SessionEvent {
  seq += 1;
  return {
    id: `evt-${seq}`,
    sessionId: 's1',
    seq,
    type,
    actor,
    payload,
    createdAt: new Date(2026, 7, 4, 12, 0, seq).toISOString(),
  } as SessionEvent;
}

const agente = (id: string) => ({ kind: 'agent', id });

/**
 * A árvore inverte o eixo do feed: agente primeiro, tempo depois. A pergunta
 * que ela responde — "o que cada um está fazendo AGORA" — não tinha resposta
 * numa coluna cronológica com quatro agentes falando junto.
 */
describe('montarArvore', () => {
  it('agrupa marcos por agente, em ordem', () => {
    const { ramos } = montarArvore([
      evento('agent.activated', agente('criativo')),
      evento('agent.activated', agente('po')),
      evento('agent.response', agente('criativo'), { content: 'oi' }),
    ]);

    const criativo = ramos.find((r) => r.agente === 'criativo')!;
    expect(criativo.marcos.map((m) => m.tipo)).toEqual(['ativado', 'resposta']);
    expect(ramos.map((r) => r.agente).sort()).toEqual(['criativo', 'po']);
  });

  it('diz o que o agente está fazendo agora, a partir do último marco', () => {
    const { ramos } = montarArvore([
      evento('agent.activated', agente('po')),
      evento('tool.call', agente('po'), { tool: 'create_story' }),
    ]);

    expect(ramos[0].agora).toBe('usou ferramenta — create_story');
    expect(ramos[0].ativo).toBe(true);
  });

  /** Ramo mudo era o defeito de origem: silêncio não pode ser um estado. */
  it('agente que só foi ativado diz que ainda não agiu, não fica em branco', () => {
    const { ramos } = montarArvore([evento('agent.activated', agente('criativo'))]);

    expect(ramos[0].agora).toBe('assumiu o trabalho');
    expect(ramos[0].marcos).toHaveLength(1);
  });

  it('desfecho encerra: resposta, falha e handoff deixam o ramo inativo', () => {
    const comResposta = montarArvore([
      evento('agent.activated', agente('a')),
      evento('agent.response', agente('a'), {}),
    ]);
    const comFalha = montarArvore([
      evento('agent.activated', agente('b')),
      evento('agent.error', agente('b'), { origem: 'infra' }),
    ]);
    const comHandoff = montarArvore([
      evento('agent.activated', agente('c')),
      evento('handoff.offered', agente('c'), { toAgent: 'po' }),
    ]);

    expect(comResposta.ramos[0]).toMatchObject({ ativo: false, agora: 'terminou o turno' });
    expect(comFalha.ramos[0]).toMatchObject({ ativo: false });
    expect(comFalha.ramos[0].agora).toContain('origem infra');
    expect(comHandoff.ramos[0].agora).toContain('→ po');
  });

  /** Quem está trabalhando AGORA é a pergunta da tela; histórico pode esperar. */
  it('ordena os ativos antes dos parados', () => {
    const { ramos } = montarArvore([
      evento('agent.activated', agente('parado')),
      evento('agent.response', agente('parado'), {}),
      evento('agent.activated', agente('trabalhando')),
      evento('tool.call', agente('trabalhando'), { tool: 'x' }),
    ]);

    expect(ramos.map((r) => r.agente)).toEqual(['trabalhando', 'parado']);
  });

  /** Marco sem dono não pode ser pendurado num agente: seria inventar autoria. */
  it('evento de system ou de user não vira ramo de agente', () => {
    const { ramos, tronco } = montarArvore([
      evento('chat.message', { kind: 'user', id: 'u-1' }, { text: 'oi' }),
      evento('execution.activated', { kind: 'user', id: 'u-1' }, {}),
      evento('pr.gate_changed', { kind: 'system', id: 'gate' }, { gate: 'awaiting_qa' }),
    ]);

    expect(ramos).toEqual([]);
    expect(tronco.length).toBeGreaterThan(0);
  });

  it('evento sem tradução não vira nó — a árvore mostra marcos, não o log', () => {
    const { ramos } = montarArvore([
      evento('agent.activated', agente('a')),
      evento('algum.evento.novo', agente('a'), {}),
    ]);

    expect(ramos[0].marcos).toHaveLength(1);
  });

  it('sessão sem evento nenhum devolve árvore vazia, não quebra', () => {
    expect(montarArvore([])).toEqual({ ramos: [], tronco: [] });
  });

  /**
   * `tool.call`/`tool.result` não carregam `iteration` no payload (só
   * `agent.response` carrega, via ToolLoop) — o agrupamento por iteração é
   * inferido pela PROXIMIDADE de `seq`: os marcos de ferramenta pertencem à
   * resposta imediatamente ANTERIOR, porque é ela quem os despachou.
   */
  it('agrupa tool.call/tool.result na iteração do agent.response que os despachou', () => {
    const { ramos } = montarArvore([
      evento('agent.response', agente('dev-backend'), { iteration: 0 }),
      evento('tool.call', agente('dev-backend'), { tool: 'read_file', args: { path: 'a.ex' } }),
      evento('tool.result', agente('dev-backend'), { tool: 'read_file', ok: true, result: 'conteúdo' }),
      evento('agent.response', agente('dev-backend'), { iteration: 1 }),
      evento('tool.call', agente('dev-backend'), { tool: 'write_file', args: { path: 'b.ex' } }),
    ]);

    const marcos = ramos[0].marcos;
    expect(marcos.map((m) => m.iteracao)).toEqual([0, 0, 0, 1, 1]);
  });

  /** Agente fora do ToolLoop (PO/Criativo) não tem `iteration` no payload —
   * ganha um contador PRÓPRIO, incrementado a cada resposta, pra ainda dar
   * pra desenhar a fronteira entre turnos. */
  it('infere iteração por um contador próprio quando o payload não carrega `iteration`', () => {
    const { ramos } = montarArvore([
      evento('agent.response', agente('po'), { content: 'primeiro turno' }),
      evento('tool.call', agente('po'), { tool: 'create_story' }),
      evento('agent.response', agente('po'), { content: 'segundo turno' }),
    ]);

    expect(ramos[0].marcos.map((m) => m.iteracao)).toEqual([0, 0, 1]);
  });

  it('marco sem dono de iteração (antes da primeira resposta) fica sem `iteracao`', () => {
    const { ramos } = montarArvore([
      evento('agent.activated', agente('criativo')),
    ]);

    expect(ramos[0].marcos[0].iteracao).toBeUndefined();
  });

  it('só tool.call/tool.result/agent.response são expansíveis', () => {
    const { ramos } = montarArvore([
      evento('agent.activated', agente('a')),
      evento('agent.response', agente('a'), { iteration: 0 }),
      evento('tool.call', agente('a'), { tool: 'x' }),
      evento('handoff.offered', agente('a'), { toAgent: 'po' }),
    ]);

    const porTipo = new Map(ramos[0].marcos.map((m) => [m.eventType, marcoExpansivel(m)]));
    expect(porTipo.get('agent.activated')).toBe(false);
    expect(porTipo.get('agent.response')).toBe(true);
    expect(porTipo.get('tool.call')).toBe(true);
    expect(porTipo.get('handoff.offered')).toBe(false);
  });
});

describe('ramosAbertosPorPadrao', () => {
  /**
   * Critério A: os 5 agentes com atividade mais RECENTE abrem por padrão.
   * `montarArvore` já ordena os ramos com os mais recentes primeiro (dentro
   * de cada grupo ativo/parado) — a função só corta a fatia.
   */
  it('abre os 5 mais recentes quando ninguém está ativo', () => {
    const eventos: SessionEvent[] = [];
    const nomes = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    for (const nome of nomes) {
      eventos.push(evento('agent.activated', agente(nome)));
      eventos.push(evento('agent.response', agente(nome), {})); // encerra o ramo — todos "parados"
    }
    const { ramos } = montarArvore(eventos);

    // 7 agentes criados em ordem a..g — g é o de maior `seq` (mais recente),
    // a é o de menor. Os 5 últimos são c, d, e, f, g; a e b ficam de fora.
    expect(ramosAbertosPorPadrao(ramos)).toEqual(new Set(['c', 'd', 'e', 'f', 'g']));
  });

  it('agente ATIVO sempre abre, mesmo sendo o mais ANTIGO — prioridade sobre recência', () => {
    const eventos: SessionEvent[] = [
      evento('agent.activated', agente('velho-ativo')),
      evento('tool.call', agente('velho-ativo'), { tool: 'x' }), // segue ativo
    ];
    for (const nome of ['a', 'b', 'c', 'd', 'e']) {
      eventos.push(evento('agent.activated', agente(nome)));
      eventos.push(evento('agent.response', agente(nome), {})); // parado
    }
    const { ramos } = montarArvore(eventos);

    // Total aberto continua 5 (o "5 últimos" não vira "5 + os ativos"), mas
    // quem preenche a fatia muda: o ativo entra garantido mesmo sendo o mais
    // ANTIGO de todos, empurrando pra fora o parado mais antigo (`a`).
    const abertos = ramosAbertosPorPadrao(ramos);
    expect(abertos).toEqual(new Set(['velho-ativo', 'b', 'c', 'd', 'e']));
  });

  it('mais de 5 agentes ativos: todos abrem, sem corte', () => {
    const eventos: SessionEvent[] = [];
    for (const nome of ['a', 'b', 'c', 'd', 'e', 'f']) {
      eventos.push(evento('agent.activated', agente(nome)));
      eventos.push(evento('tool.call', agente(nome), { tool: 'x' })); // todos ATIVOS
    }
    const { ramos } = montarArvore(eventos);

    expect(ramosAbertosPorPadrao(ramos)).toEqual(new Set(['a', 'b', 'c', 'd', 'e', 'f']));
  });

  it('com poucos agentes, todos abrem — não há corte artificial', () => {
    const { ramos } = montarArvore([
      evento('agent.activated', agente('a')),
      evento('agent.activated', agente('b')),
    ]);

    expect(ramosAbertosPorPadrao(ramos)).toEqual(new Set(['a', 'b']));
  });
});
