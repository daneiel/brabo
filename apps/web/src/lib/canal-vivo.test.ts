import { describe, it, expect } from 'vitest';
import { canalDaSessaoVivo, marcarCanalDaSessao } from './canal-vivo';

describe('marcarCanalDaSessao conta conexões (AT-500, RN-833)', () => {
  it('com duas conexões, a queda de uma não marca a sessão morta', () => {
    const a = {};
    const b = {};
    marcarCanalDaSessao('s-dupla', true, a);
    marcarCanalDaSessao('s-dupla', true, b);
    marcarCanalDaSessao('s-dupla', false, a);
    expect(canalDaSessaoVivo('s-dupla')).toBe(true);
    marcarCanalDaSessao('s-dupla', false, b);
    expect(canalDaSessaoVivo('s-dupla')).toBe(false);
  });

  it('falha: marcar morta uma conexão que nunca esteve viva não derruba a viva', () => {
    const viva = {};
    marcarCanalDaSessao('s-x', true, viva);
    marcarCanalDaSessao('s-x', false, {});
    expect(canalDaSessaoVivo('s-x')).toBe(true);
    marcarCanalDaSessao('s-x', false, viva);
  });
});
