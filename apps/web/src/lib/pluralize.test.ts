import { describe, it, expect } from 'vitest';
import { contagemAgentes, contagemProjetos, pluralizar } from './pluralize';

describe('pluralizar', () => {
  it('singular só para exatamente 1', () => {
    expect(pluralizar(1, 'projeto', 'projetos')).toBe('projeto');
  });

  it('plural para 0', () => {
    expect(pluralizar(0, 'projeto', 'projetos')).toBe('projetos');
  });

  it('plural para 2 e para muitos', () => {
    expect(pluralizar(2, 'projeto', 'projetos')).toBe('projetos');
    expect(pluralizar(47, 'projeto', 'projetos')).toBe('projetos');
  });
});

describe('contagemProjetos', () => {
  it('1 projeto ativo — singular, sem o bug "1 projetos ativos"', () => {
    expect(contagemProjetos(1)).toBe('1 projeto ativo');
  });

  it('0 e N projetos — plural', () => {
    expect(contagemProjetos(0)).toBe('0 projetos ativos');
    expect(contagemProjetos(3)).toBe('3 projetos ativos');
  });
});

describe('contagemAgentes', () => {
  it('1 agente — singular', () => {
    expect(contagemAgentes(1)).toBe('1 agente');
  });

  it('0 e N agentes — plural', () => {
    expect(contagemAgentes(0)).toBe('0 agentes');
    expect(contagemAgentes(5)).toBe('5 agentes');
  });
});
