import { describe, expect, it } from 'vitest';
import {
  agentesEmConversa,
  agentesParaChamar,
  ativadosSemJanela,
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

describe('ativadosSemJanela (RN-631, revisão do PR #759)', () => {
  it('soma resumo, handoffs (quem recebeu aceito e quem ofereceu) e gasto da sessão', () => {
    const oferecido = { ...aceito('ux-designer'), fromAgent: 'po', status: 'offered' as const };
    expect(
      ativadosSemJanela({
        doResumo: ['criativo'],
        handoffs: [aceito('arquiteto'), oferecido],
        gasto: [{ actorId: 'staff', costMicros: 1, inputTokens: 1, outputTokens: 1 }],
      }),
    ).toEqual(['arquiteto', 'criativo', 'po', 'staff', 'x']);
  });

  it('CASO DE FALHA: oferta PENDENTE não põe o destino como ativo, e sem fonte nenhuma é vazio', () => {
    const oferecido = { ...aceito('ux-designer'), fromAgent: 'po', status: 'offered' as const };
    expect(ativadosSemJanela({ handoffs: [oferecido] })).not.toContain('ux-designer');
    expect(ativadosSemJanela({ handoffs: [] })).toEqual([]);
  });
});

describe('agentesParaChamar (RN-682)', () => {
  it('lista os agentes que conversam, sem o Criativo', () => {
    expect(agentesParaChamar(() => false)).toEqual([
      'po',
      'arquiteto',
      'dev-lead',
      'ux-designer',
      'staff',
      'infra',
    ]);
  });

  it('CASO DE FALHA: quem já entrou na sessão não é oferecido de novo', () => {
    expect(agentesParaChamar((a) => a === 'staff' || a === 'po')).toEqual([
      'arquiteto',
      'dev-lead',
      'ux-designer',
      'infra',
    ]);
  });
});
