import { describe, expect, it } from 'vitest';
import { montarArvore } from './timeline-tree';
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
});
