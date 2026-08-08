import { describe, expect, it } from 'vitest';
import { ApiError } from './api-client';
import { deveRetentar, pollQueParaNoErro } from './query-policy';

function query(status: 'pending' | 'error' | 'success') {
  return { state: { status } };
}

/**
 * A origem: 1128 erros 429 num console só. A api limita 300 req/min por
 * usuário; a app respondia ao limite com três retentativas por falha e um poll
 * que nunca parava — mais tráfego exatamente quando o servidor pedia menos.
 */
describe('deveRetentar — 429 é o servidor mandando parar', () => {
  it('não retenta 429', () => {
    const limite = new ApiError(429, { message: 'Limite de requisições excedido.' });
    expect(deveRetentar(0, limite)).toBe(false);
  });

  it('não retenta os outros 4xx (401 já renovou por dentro, 403/404 não mudam)', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(deveRetentar(0, new ApiError(status, null))).toBe(false);
    }
  });

  it('retenta 5xx até três vezes — ali a causa costuma ser transitória', () => {
    const erro = new ApiError(503, null);
    expect(deveRetentar(0, erro)).toBe(true);
    expect(deveRetentar(2, erro)).toBe(true);
    expect(deveRetentar(3, erro)).toBe(false);
  });

  it('retenta falha de rede, que não é ApiError nenhum', () => {
    expect(deveRetentar(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(deveRetentar(3, new TypeError('Failed to fetch'))).toBe(false);
  });
});

describe('pollQueParaNoErro', () => {
  it('mantém o intervalo enquanto a query vai bem', () => {
    const intervalo = pollQueParaNoErro(3000);
    expect(intervalo(query('success'))).toBe(3000);
    expect(intervalo(query('pending'))).toBe(3000);
  });

  it('para quando a query erra — é o que impedia o 429 de virar mil', () => {
    expect(pollQueParaNoErro(3000)(query('error'))).toBe(false);
  });
});
