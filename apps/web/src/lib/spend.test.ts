import { describe, expect, it, beforeAll } from 'vitest';
import i18n from './i18n';
import {
  alertaDeOrcamento,
  alturasRelativas,
  diaCurto,
  rotuloDoAtor,
  tituloDoDia,
  tokensDe,
  type BudgetParaAlerta,
  type SpendLinha,
} from './spend';

/**
 * `tituloDoDia`/`rotuloDoAtor`/`alertaDeOrcamento` resolvem texto pelo
 * singleton REAL de `./i18n` (mesmo padrão de `session-kind.ts`) — sem
 * `changeLanguage`, o idioma seguiria `idiomaInicial()` (o default do app,
 * `en`, quando `navigator.language` do jsdom não começa com "pt"). Fixar
 * `pt-BR` aqui mantém as asserções abaixo idênticas ao texto que já existia
 * antes da extração.
 */
beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});

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

describe('alertaDeOrcamento (RN-213)', () => {
  const base: BudgetParaAlerta = {
    limitMicros: 10_000_000,
    spentMicros: 0,
    policy: 'allow',
    lastThresholdNotified: 0,
  };

  it('sem teto definido, não alerta mesmo com gasto alto', () => {
    expect(
      alertaDeOrcamento({ ...base, limitMicros: 0, spentMicros: 99, lastThresholdNotified: 100 }),
    ).toBeNull();
  });

  it('abaixo de 70%, não alerta', () => {
    expect(
      alertaDeOrcamento({ ...base, spentMicros: 6_000_000, lastThresholdNotified: 0 }),
    ).toBeNull();
  });

  it('cruzou 70%, alerta nível warning', () => {
    expect(
      alertaDeOrcamento({ ...base, spentMicros: 7_000_000, lastThresholdNotified: 70 }),
    ).toEqual({
      nivel: 'warning',
      mensagem: 'Este projeto já passou de 70% do orçamento definido.',
    });
  });

  it('cruzou 90%, alerta nível danger', () => {
    expect(
      alertaDeOrcamento({ ...base, spentMicros: 9_200_000, lastThresholdNotified: 90 }),
    ).toEqual({
      nivel: 'danger',
      mensagem: 'Este projeto já passou de 90% do orçamento definido.',
    });
  });

  /**
   * `lastThresholdNotified` já É o veredito — a função nunca refaz a conta de
   * `spentMicros`/`limitMicros` para decidir SE cruzou, só para decidir se a
   * política `block` está ATIVAMENTE recusando chamada agora.
   */
  it('política block e teto atingido, avisa que chamadas estão bloqueadas', () => {
    const alerta = alertaDeOrcamento({
      ...base,
      policy: 'block',
      spentMicros: 10_000_000,
      lastThresholdNotified: 100,
    });
    expect(alerta?.nivel).toBe('danger');
    expect(alerta?.mensagem).toMatch(/BLOQUEADAS/);
  });

  it('política block mas ainda não bateu o teto, não fala em bloqueio', () => {
    const alerta = alertaDeOrcamento({
      ...base,
      policy: 'block',
      spentMicros: 9_500_000,
      lastThresholdNotified: 90,
    });
    expect(alerta?.mensagem).not.toMatch(/BLOQUEADAS/);
  });
});
