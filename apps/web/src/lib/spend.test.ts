import { describe, expect, it } from 'vitest';
import {
  alturasRelativas,
  diaCurto,
  rotuloDoAtor,
  tituloDoDia,
  tokensDe,
  type SpendLinha,
} from './spend';

describe('alturasRelativas', () => {
  it('escala pelo maior da série', () => {
    expect(alturasRelativas([0, 50, 100])).toEqual([0, 0.5, 1]);
  });

  /**
   * A divisão direta daria `NaN`, e `NaN` num atributo de SVG rende barra
   * fantasma — o gráfico de um dia sem gasto mostrando ruído.
   */
  it('série toda zerada não vira NaN', () => {
    expect(alturasRelativas([0, 0, 0])).toEqual([0, 0, 0]);
    expect(alturasRelativas([])).toEqual([]);
  });
});

describe('diaCurto', () => {
  /**
   * Fatiar a string em vez de passar por `Date`: o bucket já vem truncado em
   * UTC, e `new Date('2026-08-09')` renderizado em America/Sao_Paulo volta um
   * dia — a série inteira apareceria deslocada.
   */
  it('não desloca o dia por fuso', () => {
    expect(diaCurto('2026-08-09')).toBe('09/08');
    expect(diaCurto('2026-01-01')).toBe('01/01');
  });
});

describe('tituloDoDia', () => {
  it('singulariza a chamada', () => {
    expect(
      tituloDoDia({ dia: '2026-08-09', costMicros: 1, chamadas: 1 }, 'US$ 0,01'),
    ).toBe('09/08 · US$ 0,01 · 1 chamada');
    expect(
      tituloDoDia({ dia: '2026-08-09', costMicros: 2, chamadas: 2 }, 'US$ 0,02'),
    ).toBe('09/08 · US$ 0,02 · 2 chamadas');
  });
});

describe('rotuloDoAtor', () => {
  const base: SpendLinha = {
    chave: '',
    rotulo: null,
    actorKind: null,
    costMicros: 0,
    inputTokens: 0,
    outputTokens: 0,
    chamadas: 0,
  };

  it('agente pelo slug, pessoa pelo id curto', () => {
    expect(rotuloDoAtor({ ...base, chave: 'criativo', actorKind: 'agent' })).toBe(
      'criativo',
    );
    expect(
      rotuloDoAtor({
        ...base,
        chave: 'a1b2c3d4-0000-0000-0000-000000000000',
        actorKind: 'user',
      }),
    ).toBe('a1b2c3d4 (pessoa)');
  });
});

describe('tokensDe', () => {
  it('soma entrada e saída', () => {
    expect(tokensDe({ inputTokens: 10, outputTokens: 5 })).toBe(15);
  });
});
