import { describe, expect, it } from 'vitest';
import type { Handoff, HandoffStatus, SessionEvent } from './api-types';
import { derivarHandoffsDaSessao } from './session-handoffs';

// RN-635 (ADR 0182, AT-291): a api passou a devolver `superseded` — a oferta
// que deixou de ser a vigente (o agente foi ativado por outro caminho, ou uma
// oferta mais nova ao mesmo destino a substituiu). Ela NÃO pode virar botão
// de aceitar em lugar nenhum da tela: nem o card do fio, nem a faixa das
// ofertas fora da janela, nem o card próprio da Infra.

const agora = Date.parse('2026-09-30T12:00:00Z');

function handoff(id: string, toAgent: string, status: HandoffStatus, minutosAtras: number): Handoff {
  const instante = new Date(agora - minutosAtras * 60_000).toISOString();
  return {
    id,
    sessionId: 's1',
    projectId: 'p1',
    fromAgent: 'arquiteto',
    toAgent,
    artifactId: null,
    status,
    createdAt: instante,
    updatedAt: instante,
  };
}

// Um evento qualquer MAIS NOVO que as ofertas: a janela começa depois delas,
// então as ofertas cujo evento não está aqui contam como "fora da janela".
const janela: SessionEvent[] = [
  {
    id: 'e1',
    sessionId: 's1',
    seq: 900,
    type: 'chat.message',
    actor: { kind: 'user', id: 'u1' },
    payload: {},
    createdAt: new Date(agora).toISOString(),
  } as SessionEvent,
];

describe('derivarHandoffsDaSessao — oferta superseded (RN-635)', () => {
  it('oferta `offered` continua acionável (controle): no fio e na faixa fora da janela', () => {
    const d = derivarHandoffsDaSessao(janela, [handoff('h1', 'dev-lead', 'offered', 60)]);
    expect(d.ofertasAcionaveis.map((h) => h.id)).toEqual(['h1']);
    expect(d.ofertasForaDaJanela.map((h) => h.id)).toEqual(['h1']);
  });

  it('oferta `superseded` não vira card acionável nem faixa', () => {
    const d = derivarHandoffsDaSessao(janela, [handoff('h1', 'dev-lead', 'superseded', 60)]);
    expect(d.ofertasAcionaveis).toEqual([]);
    expect(d.ofertasForaDaJanela).toEqual([]);
  });

  it('a `superseded` não toma o lugar da vigente ao mesmo destino, nem sendo a mais nova', () => {
    const d = derivarHandoffsDaSessao(janela, [
      handoff('vigente', 'po', 'offered', 90),
      handoff('antiga-substituida', 'po', 'superseded', 30),
    ]);
    expect(d.ofertasAcionaveis.map((h) => h.id)).toEqual(['vigente']);
  });

  it('handoff da Infra `superseded` não reabre o card próprio da Infra (RN-499)', () => {
    const d = derivarHandoffsDaSessao(janela, [handoff('hi', 'infra', 'superseded', 60)]);
    expect(d.handoffDaInfraOferecido).toBeUndefined();
    const vigente = derivarHandoffsDaSessao(janela, [handoff('hi', 'infra', 'offered', 60)]);
    expect(vigente.handoffDaInfraOferecido?.id).toBe('hi');
  });
});
