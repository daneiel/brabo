import { describe, expect, it } from 'vitest';
import { turnoTerminouNoLog } from './session-turno';
import { mensagemDaRecusaDoAgente } from './recusa-do-agente';
import type { SessionEvent } from './api-types';

/**
 * ADR 0163 (RN-578): a chamada que dispara turno resolve no ACEITE, e a rede
 * de segurança contra o `agent.done` perdido passou a ser o `agent.status`
 * persistido mais recente do agente. Estas são as regras puras dessa leitura.
 */

function evento(
  seq: number,
  type: string,
  ator: string,
  payload: unknown = {},
): SessionEvent {
  return {
    id: `e-${seq}`,
    sessionId: 's-1',
    seq,
    type,
    actor: { kind: 'agent', id: ator },
    payload,
    createdAt: '2026-09-18T12:00:00.000Z',
  } as SessionEvent;
}

describe('turnoTerminouNoLog', () => {
  it('working mais recente: o turno segue', () => {
    const eventos = [
      evento(1, 'agent.status', 'criativo', { status: 'idle' }),
      evento(4, 'agent.status', 'criativo', { status: 'working' }),
    ];
    expect(turnoTerminouNoLog(eventos, 'criativo')).toBe(false);
  });

  it('idle mais recente: o turno acabou', () => {
    const eventos = [
      evento(4, 'agent.status', 'criativo', { status: 'working' }),
      evento(9, 'agent.status', 'criativo', { status: 'idle' }),
    ];
    expect(turnoTerminouNoLog(eventos, 'criativo')).toBe(true);
  });

  it('awaiting_approval (Dev Lead suspenso, ADR 0086) também fecha a faixa', () => {
    const eventos = [
      evento(4, 'agent.status', 'dev-lead', { status: 'working' }),
      evento(9, 'agent.status', 'dev-lead', { status: 'awaiting_approval' }),
    ];
    expect(turnoTerminouNoLog(eventos, 'dev-lead')).toBe(true);
  });

  it('é o MAIOR seq que decide, não a ordem da lista', () => {
    const eventos = [
      evento(9, 'agent.status', 'criativo', { status: 'working' }),
      evento(4, 'agent.status', 'criativo', { status: 'idle' }),
    ];
    expect(turnoTerminouNoLog(eventos, 'criativo')).toBe(false);
  });

  it('o idle de OUTRO agente não fecha o turno deste', () => {
    const eventos = [
      evento(4, 'agent.status', 'arquiteto', { status: 'working' }),
      evento(9, 'agent.status', 'infra', { status: 'idle' }),
    ];
    expect(turnoTerminouNoLog(eventos, 'arquiteto')).toBe(false);
  });

  it('sem agent.status do agente na janela: não saber não é "acabou"', () => {
    const eventos = [evento(2, 'chat.message', 'user-1', { text: 'oi' })];
    expect(turnoTerminouNoLog(eventos, 'criativo')).toBe(false);
  });
});

describe('mensagemDaRecusaDoAgente', () => {
  it('409 com frase: devolve a frase do engine', () => {
    const erro = { status: 409, body: { message: 'ficou registrada, mas não foi lida' } };
    expect(mensagemDaRecusaDoAgente(erro, 'padrão')).toBe(
      'ficou registrada, mas não foi lida',
    );
  });

  it('422 com frase: devolve a frase do engine', () => {
    const erro = { status: 422, body: { message: 'sem regra de negócio' } };
    expect(mensagemDaRecusaDoAgente(erro, 'padrão')).toBe('sem regra de negócio');
  });

  it('500, erro de rede ou corpo sem frase: o padrão, nunca o texto cru', () => {
    expect(mensagemDaRecusaDoAgente({ status: 500, body: { message: 'boom' } }, 'padrão')).toBe(
      'padrão',
    );
    expect(mensagemDaRecusaDoAgente(new TypeError('Failed to fetch'), 'padrão')).toBe('padrão');
    expect(mensagemDaRecusaDoAgente({ status: 409, body: null }, 'padrão')).toBe('padrão');
    expect(mensagemDaRecusaDoAgente(undefined, 'padrão')).toBe('padrão');
  });
});
