import { describe, it, expect } from 'vitest';
import {
  decidir,
  resumoDaParada,
  NOME_DO_PROPRIO_CHECK,
  type CheckRun,
} from './promocao-automatica.ts';

const ok = (nome: string): CheckRun => ({
  nome,
  status: 'completed',
  conclusao: 'success',
  url: `u/${nome}`,
});
const pendente = (nome: string): CheckRun => ({ nome, status: 'in_progress', conclusao: null, url: '' });

describe('decidir', () => {
  it('caminho feliz: todos terminados em sucesso/skipped/neutral mergeia', () => {
    const d = decidir([
      ok('lint'),
      { ...ok('docs'), conclusao: 'skipped' },
      { ...ok('x'), conclusao: 'neutral' },
    ]);
    expect(d).toEqual({ acao: 'mergear', contados: 3 });
  });

  it('falha para a promoção e nomeia o check', () => {
    const d = decidir([ok('lint'), { ...ok('testes'), conclusao: 'failure' }]);
    expect(d.acao).toBe('parar');
    if (d.acao === 'parar') expect(d.falhas.map((f) => f.nome)).toEqual(['testes']);
  });

  it('cancelado e timed_out também param', () => {
    for (const conclusao of ['cancelled', 'timed_out']) {
      expect(decidir([ok('a'), { ...ok('b'), conclusao }]).acao).toBe('parar');
    }
  });

  it('check pendente espera', () => {
    expect(decidir([ok('a'), pendente('b')])).toEqual({ acao: 'esperar', pendentes: ['b'] });
  });

  it('falha vence pendente', () => {
    expect(decidir([{ ...ok('a'), conclusao: 'failure' }, pendente('b')]).acao).toBe('parar');
  });

  it('zero checks espera — nunca mergeia sem CI', () => {
    expect(decidir([]).acao).toBe('esperar');
    expect(decidir([pendente(NOME_DO_PROPRIO_CHECK)]).acao).toBe('esperar');
  });

  it('ignora o próprio check pendente', () => {
    expect(decidir([ok('a'), pendente(NOME_DO_PROPRIO_CHECK)]).acao).toBe('mergear');
  });
});

describe('resumoDaParada', () => {
  it('diz o check e o link', () => {
    const r = resumoDaParada('12', [{ ...ok('testes'), conclusao: 'failure' }]);
    expect(r).toContain('testes');
    expect(r).toContain('u/testes');
    expect(r).toContain('#12');
  });
});
