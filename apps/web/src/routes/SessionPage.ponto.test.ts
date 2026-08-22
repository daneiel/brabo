import { describe, expect, it } from 'vitest';
import { pontoDaSessao } from './SessionPage';
import type { SessionStatus } from '../lib/api-types';

/**
 * O ponto da barra de topo era `background: var(--success)` fixo, e só o PULSO
 * dependia do estado: uma sessão encerrada exibia exatamente o mesmo sinal de
 * "ao vivo" de uma em curso — o verde é justamente o que se olha primeiro.
 *
 * O teste varre a máquina de estados inteira em vez de checar dois casos: é o
 * que faz um estado novo (`closing` foi o último a entrar) precisar de uma
 * decisão explícita aqui, em vez de herdar calado a aparência de ativa.
 */
const ESTADOS: SessionStatus[] = [
  'created',
  'active',
  'closing',
  'closed',
  'closed_abnormally',
];

describe('ponto de estado da sessão', () => {
  it('só a sessão ATIVA pulsa em verde', () => {
    expect(pontoDaSessao('active').classe).toBe('pulsing');
    for (const estado of ESTADOS.filter((e) => e !== 'active')) {
      expect(pontoDaSessao(estado).classe, estado).not.toBe('pulsing');
    }
  });

  it('término anormal se distingue de término normal', () => {
    expect(pontoDaSessao('closed_abnormally').classe).toBe('statusDotFalha');
    expect(pontoDaSessao('closed').classe).toBe('statusDotParado');
  });

  it('todo estado da máquina tem aparência e rótulo próprios', () => {
    const rotulos = ESTADOS.map((e) => pontoDaSessao(e).rotuloKey);
    expect(new Set(rotulos).size).toBe(ESTADOS.length);
    for (const rotulo of rotulos) expect(rotulo).not.toBe('');
  });

  /** Sem sessão carregada não é "encerrada" — é desconhecido, e o ponto apaga. */
  it('sessão que ainda não chegou não finge estado nenhum', () => {
    expect(pontoDaSessao(undefined).classe).toBe('statusDotParado');
    expect(pontoDaSessao(undefined).rotuloKey).toBe('status.loading');
  });
});
