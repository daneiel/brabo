import { describe, it, expect } from 'vitest';
import {
  hashtagDaSessao,
  idCurtoDaSessao,
  rotuloDaSessao,
} from './session-label';

/**
 * O defeito real que estes testes travam.
 *
 * `sessionId.slice(0, 8)` estava inline em CINCO lugares e em nenhum helper. O
 * risco disso não é estético: é o id INTEIRO vazar para a tela quando alguém
 * migrar um dos cinco pela metade — um uuid de 36 caracteres no lugar de oito
 * estoura a linha da lista de sessões e a topbar da sessão, que são grades de
 * largura fixa.
 *
 * Por isso a asserção mais dura aqui é sobre o TAMANHO, não sobre o texto: um
 * helper que devolvesse o id completo passaria por qualquer teste que só
 * verificasse "contém o id".
 */
describe('rótulo de sessão', () => {
  const ID = 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7';

  it('a hashtag é a cerquilha mais os oito primeiros caracteres', () => {
    expect(hashtagDaSessao(ID)).toBe('#a1b2c3d4');
  });

  it('a hashtag NUNCA carrega o id inteiro', () => {
    // A asserção que morre se a truncagem sumir. `toContain` não serviria:
    // o id inteiro contém o prefixo.
    const hashtag = hashtagDaSessao(ID);
    expect(hashtag).toHaveLength(9);
    expect(hashtag).not.toContain(ID);
    expect(hashtag.includes('-')).toBe(false);
  });

  it('o id curto sai sem cerquilha — é o que a faixa de Insights escreve', () => {
    expect(idCurtoDaSessao(ID)).toBe('a1b2c3d4');
    expect(idCurtoDaSessao(ID)).toHaveLength(8);
  });

  it('sem nome, o rótulo degrada para a hashtag sozinha', () => {
    expect(rotuloDaSessao(ID)).toBe('#a1b2c3d4');
    expect(rotuloDaSessao(ID, null)).toBe('#a1b2c3d4');
  });

  it('com nome, o rótulo compõe e PRESERVA a hashtag', () => {
    // A hashtag é o que se cola numa URL; nome escolhido por pessoa não é único.
    expect(rotuloDaSessao(ID, 'Checkout do carrinho')).toBe(
      'Checkout do carrinho · #a1b2c3d4',
    );
  });

  it('nome em branco conta como ausente', () => {
    // Caso de falha: sem isto o rótulo viraria " · #a1b2c3d4", pior que a
    // hashtag sozinha. Espaço em volta do nome também não vaza.
    expect(rotuloDaSessao(ID, '   ')).toBe('#a1b2c3d4');
    expect(rotuloDaSessao(ID, '')).toBe('#a1b2c3d4');
    expect(rotuloDaSessao(ID, '  Beta  ')).toBe('Beta · #a1b2c3d4');
  });

  it('id mais curto que oito não quebra nem inventa caractere', () => {
    // Caso de falha: os testes e o Noop criam ids curtos.
    expect(hashtagDaSessao('abc')).toBe('#abc');
    expect(rotuloDaSessao('abc')).toBe('#abc');
  });
});
