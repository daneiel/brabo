import { describe, expect, it } from 'vitest';
import { compactarFerramentas, montarArvore } from './timeline-tree';
import type { SessionEvent } from './api-types';

/** AT-394 — a Visão geral funde chamadas seguidas da mesma ferramenta. */
let seq = 0;
function ev(type: string, payload: Record<string, unknown>): SessionEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    sessionId: 's',
    seq,
    type,
    actor: { kind: 'agent', id: 'po' },
    payload,
    createdAt: '2026-10-02T12:00:00.000Z',
  } as SessionEvent;
}

describe('compactarFerramentas (AT-394)', () => {
  it('funde chamadas consecutivas da mesma ferramenta e some com o tool.result', () => {
    const eventos = [
      ev('tool.call', { tool: 'create_story' }),
      ev('tool.result', { tool: 'create_story' }),
      ev('tool.call', { tool: 'create_story' }),
      ev('tool.result', { tool: 'create_story' }),
      ev('tool.call', { tool: 'create_story' }),
    ];
    const [ramo] = compactarFerramentas(montarArvore(eventos, 'pt-BR').ramos);
    expect(ramo.marcos).toHaveLength(1);
    expect(ramo.marcos[0].detalhe).toBe('create_story ×3');
  });

  it('ferramenta diferente ou outro marco quebra a sequência', () => {
    const eventos = [
      ev('tool.call', { tool: 'create_story' }),
      ev('tool.call', { tool: 'create_epic' }),
      ev('agent.response', { content: 'ok' }),
      ev('tool.call', { tool: 'create_epic' }),
    ];
    const [ramo] = compactarFerramentas(montarArvore(eventos, 'pt-BR').ramos);
    expect(ramo.marcos.map((m) => m.detalhe ?? m.eventType)).toEqual([
      'create_story',
      'create_epic',
      'agent.response',
      'create_epic',
    ]);
  });
});
