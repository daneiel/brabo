import { describe, expect, it } from 'vitest';
import { derivarPrimeirosPassos } from './primeiros-passos';

describe('derivarPrimeirosPassos (RN-708)', () => {
  it('projeto novo: os três pendentes, na ordem', () => {
    const passos = derivarPrimeirosPassos({ credenciais: 0, timeComModelo: false, temSessao: false });
    expect(passos).toEqual([
      { chave: 'credencial', feito: false },
      { chave: 'modelo', feito: false },
      { chave: 'ideacao', feito: false },
    ]);
  });

  it('marca o que já foi feito e mantém o cartão enquanto falta um', () => {
    const passos = derivarPrimeirosPassos({ credenciais: 2, timeComModelo: true, temSessao: false });
    expect(passos?.map((p) => p.feito)).toEqual([true, true, false]);
  });

  it('tudo feito: o cartão some', () => {
    expect(derivarPrimeirosPassos({ credenciais: 1, timeComModelo: true, temSessao: true })).toBeNull();
  });

  it('insumo não lido não vira "pendente" — o cartão espera', () => {
    expect(derivarPrimeirosPassos({ credenciais: undefined, timeComModelo: false, temSessao: false })).toBeNull();
    expect(derivarPrimeirosPassos({ credenciais: 0, timeComModelo: undefined, temSessao: false })).toBeNull();
  });
});
