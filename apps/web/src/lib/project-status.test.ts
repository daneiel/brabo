import { describe, it, expect } from 'vitest';
import { deriveProjectStatus } from './project-status';

const base = { budgetPct: 0, blockedTaskCount: 0, hasRecentActivity: true };

describe('deriveProjectStatus', () => {
  it('saudável: orçamento baixo, sem bloqueio, com atividade recente', () => {
    expect(deriveProjectStatus(base)).toBe('saudavel');
  });

  it('atenção: orçamento entre 70% e 89%', () => {
    expect(deriveProjectStatus({ ...base, budgetPct: 70 })).toBe('atencao');
    expect(deriveProjectStatus({ ...base, budgetPct: 89 })).toBe('atencao');
  });

  it('risco: orçamento ≥90%', () => {
    expect(deriveProjectStatus({ ...base, budgetPct: 90 })).toBe('risco');
    expect(deriveProjectStatus({ ...base, budgetPct: 150 })).toBe('risco');
  });

  it('risco: qualquer task bloqueada, mesmo com orçamento baixo', () => {
    expect(deriveProjectStatus({ ...base, blockedTaskCount: 1 })).toBe('risco');
  });

  it('inativo: sem atividade recente, orçamento e bloqueio OK', () => {
    expect(deriveProjectStatus({ ...base, hasRecentActivity: false })).toBe(
      'inativo',
    );
  });

  it('risco vence inativo — projeto estourado e parado não vira cinza', () => {
    expect(
      deriveProjectStatus({
        budgetPct: 95,
        blockedTaskCount: 0,
        hasRecentActivity: false,
      }),
    ).toBe('risco');
    expect(
      deriveProjectStatus({
        budgetPct: 0,
        blockedTaskCount: 2,
        hasRecentActivity: false,
      }),
    ).toBe('risco');
  });

  it('atenção vence inativo — mesma prioridade de sinal de risco sobre inatividade', () => {
    expect(
      deriveProjectStatus({
        budgetPct: 75,
        blockedTaskCount: 0,
        hasRecentActivity: false,
      }),
    ).toBe('atencao');
  });
});
