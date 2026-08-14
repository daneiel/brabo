import { describe, it, expect } from 'vitest';
import { agruparPorOrigem, origemDoEvento } from './activity';
import type { SessionEvent } from './api-types';

let seq = 0;
function ev(type: string, kind: 'user' | 'agent' | 'system' = 'agent'): SessionEvent {
  seq += 1;
  return {
    id: `e-${seq}`,
    sessionId: 'sess-1',
    seq,
    type,
    actor: { kind, id: kind === 'agent' ? 'po' : kind },
    payload: {},
    createdAt: new Date().toISOString(),
  } as SessionEvent;
}

/**
 * A ORIGEM (RN-177) — a classificação que separa o histórico em punhados
 * legíveis, no painel de log e no fio.
 *
 * Cada caso aqui existe por uma decisão de PRECEDÊNCIA: é a ordem dos `if` que
 * a torna previsível, e é ela que um refactor quebraria sem que mais nada
 * reclamasse.
 */
describe('origemDoEvento (RN-177)', () => {
  it('mecanismo vence ator: tool.*, toolloop.* e companhia são do harness', () => {
    expect(origemDoEvento({ type: 'tool.call', actor: { kind: 'agent' } })).toBe('harness');
    expect(origemDoEvento({ type: 'tool.result', actor: { kind: 'agent' } })).toBe('harness');
    expect(
      origemDoEvento({ type: 'toolloop.limit_reached', actor: { kind: 'agent' } }),
    ).toBe('harness');
    expect(origemDoEvento({ type: 'agent.status', actor: { kind: 'agent' } })).toBe('harness');
    expect(origemDoEvento({ type: 'context.compacted', actor: { kind: 'system' } })).toBe(
      'harness',
    );
  });

  it('o turno do modelo é llm, e não arrasta o resto do prefixo agent. junto', () => {
    expect(origemDoEvento({ type: 'agent.response', actor: { kind: 'agent' } })).toBe('llm');
    expect(origemDoEvento({ type: 'agent.delta', actor: { kind: 'agent' } })).toBe('llm');
    // Mesmo prefixo, camada diferente: entrar na sessão e falhar são do AGENTE.
    expect(origemDoEvento({ type: 'agent.activated', actor: { kind: 'agent' } })).toBe('agente');
    expect(origemDoEvento({ type: 'agent.error', actor: { kind: 'agent' } })).toBe('agente');
  });

  it('o ator decide usuário e sistema — inclusive num tipo que também é de agente', () => {
    // `chat.*` existe dos dois lados; quem os distingue é o ator, e é por isso
    // que a checagem de ator vem ANTES dos prefixos de agente.
    expect(origemDoEvento({ type: 'chat.message', actor: { kind: 'user' } })).toBe('usuario');
    expect(
      origemDoEvento({ type: 'chat.structured_question', actor: { kind: 'agent' } }),
    ).toBe('agente');
    expect(
      origemDoEvento({ type: 'bootstrap.step_started', actor: { kind: 'system' } }),
    ).toBe('sistema');
  });

  it('handoff e delegação são do agente; o domínio é todo o resto', () => {
    expect(origemDoEvento({ type: 'handoff.offered', actor: { kind: 'agent' } })).toBe('agente');
    expect(origemDoEvento({ type: 'delegation.failed', actor: { kind: 'agent' } })).toBe(
      'agente',
    );
    expect(origemDoEvento({ type: 'backlog.story_created', actor: { kind: 'agent' } })).toBe(
      'eventos',
    );
    expect(origemDoEvento({ type: 'git.push', actor: { kind: 'agent' } })).toBe('eventos');
    // CASO DE FALHA: tipo que ninguém previu não some nem inventa categoria —
    // cai no domínio, que é o grupo de "o event log propriamente dito".
    expect(origemDoEvento({ type: 'coisa.nunca.vista', actor: { kind: 'agent' } })).toBe(
      'eventos',
    );
  });
});

describe('agruparPorOrigem (RN-177)', () => {
  it('respeita a ORDEM declarada e descarta grupo vazio', () => {
    const grupos = agruparPorOrigem(
      [
        ev('chat.message', 'user'),
        ev('tool.call'),
        ev('backlog.epic_created'),
        ev('tool.result'),
      ],
      origemDoEvento,
    );

    expect(grupos.map((g) => g.origem)).toEqual(['eventos', 'harness', 'usuario']);
    expect(grupos.find((g) => g.origem === 'harness')!.itens).toHaveLength(2);
    // Grupo sem item nenhum simplesmente não existe: "Sistema · 0" seria ruído
    // com outro nome.
    expect(grupos.some((g) => g.origem === 'sistema')).toBe(false);
  });

  it('dentro do grupo, a ordem de entrada é preservada', () => {
    const a = ev('tool.call');
    const b = ev('tool.result');

    expect(agruparPorOrigem([a, b], origemDoEvento)[0].itens).toEqual([a, b]);
  });
});
