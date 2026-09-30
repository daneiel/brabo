import { describe, expect, it } from 'vitest';
import {
  agentesEmConversa,
  resolverDestinatario,
} from './session-destinatario';
import type { Handoff, SessionEvent } from './api-types';

function ativou(agent: string, seq: number): SessionEvent {
  return {
    id: `e-${seq}`,
    seq,
    type: 'agent.activated',
    actor: { kind: 'agent', id: agent },
    payload: { agent },
    createdAt: '2026-09-29T12:00:00.000Z',
  } as SessionEvent;
}

function aceito(toAgent: string): Handoff {
  return {
    id: `h-${toAgent}`,
    sessionId: 's',
    projectId: 'p',
    fromAgent: 'x',
    toAgent,
    artifactId: null,
    status: 'accepted',
    createdAt: '2026-09-29T12:00:00.000Z',
    updatedAt: '2026-09-29T12:00:00.000Z',
  };
}

describe('agentesEmConversa (RN-631)', () => {
  it('junta ativados na janela e handoffs aceitos, só entre os que conversam, na ordem de AGENTES_DE_CHAT', () => {
    const opcoes = agentesEmConversa(
      [ativou('infra', 1), ativou('qa', 2), ativou('criativo', 3)],
      [aceito('arquiteto')],
      'consultiva',
    );
    // `qa` é lead de área sem cláusula de `message` — nunca opção.
    expect(opcoes).toEqual(['criativo', 'arquiteto', 'infra']);
  });

  it('handoff OFERECIDO não conta: o agente ainda não está na sessão', () => {
    const oferecido = { ...aceito('po'), status: 'offered' as const };
    expect(agentesEmConversa([], [oferecido], 'consultiva')).toEqual([]);
  });

  it('a sessão criativa oferece o Criativo antes de qualquer ativação', () => {
    expect(agentesEmConversa([], [], 'criativa')).toEqual(['criativo']);
  });
});

describe('resolverDestinatario (RN-631)', () => {
  it('a escolha vale enquanto for opção', () => {
    expect(resolverDestinatario(['po', 'arquiteto'], 'arquiteto')).toBe('arquiteto');
  });

  it('opção única é o destinatário', () => {
    expect(resolverDestinatario(['po'], null)).toBe('po');
  });

  it('CASO DE FALHA: duas opções sem escolha não viram "a mais recente" — é null', () => {
    expect(resolverDestinatario(['po', 'arquiteto'], null)).toBeNull();
  });

  it('escolha que deixou de ser opção não vale', () => {
    expect(resolverDestinatario(['po', 'arquiteto'], 'staff')).toBeNull();
  });
});
