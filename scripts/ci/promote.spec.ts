import { describe, it, expect } from 'vitest';
import { celulaDeTabela, corpoDaPromocao } from './promote.ts';

/**
 * Escape de célula da tabela do corpo do PR de promoção (CodeQL
 * `js/incomplete-sanitization`).
 *
 * O caso que motiva o teste não é o do pipe solto — esse já funcionava. É o do
 * título terminado em contrabarra ANTES do pipe, onde escapar só o `|`
 * produzia `\\|`: contrabarra escapada seguida de delimitador de coluna, com a
 * linha ganhando uma célula a mais.
 */
describe('celulaDeTabela', () => {
  it('caminho feliz: texto sem nada de especial passa intacto', () => {
    expect(celulaDeTabela('feat: sobe o teto de iterações')).toBe(
      'feat: sobe o teto de iterações',
    );
  });

  it('escapa o pipe', () => {
    expect(celulaDeTabela('a | b')).toBe('a \\| b');
  });

  it('escapa a contrabarra ANTES do pipe — o caso que quebrava a tabela', () => {
    // Sem o escape da contrabarra isto virava `a\\|b`, que o GFM lê como
    // contrabarra escapada + delimitador de coluna.
    expect(celulaDeTabela('a\\|b')).toBe('a\\\\\\|b');
  });

  it('contrabarra sozinha também é escapada', () => {
    expect(celulaDeTabela('C:\\tmp')).toBe('C:\\\\tmp');
  });
});

describe('corpoDaPromocao', () => {
  const pr = (titulo: string) => ({
    numero: 1,
    funcao: 'feature',
    impacto: 'minor' as const,
    titulo,
    branch: 'feature/algo',
  });

  it('a tabela tem uma linha por PR, com as quatro colunas', () => {
    const corpo = corpoDaPromocao('dev', 'qa', 'v1.2.0', 'v1.1.0', [
      pr('feat: algo'),
    ]);
    const linha = corpo
      .split('\n')
      .find((l) => l.startsWith('| #1 '))!;
    expect(linha).toBe('| #1 | `feature` | MINOR ⬅ | feat: algo |');
  });

  it('título com pipe e contrabarra não acrescenta coluna nenhuma', () => {
    const corpo = corpoDaPromocao('dev', 'qa', 'v1.2.0', 'v1.1.0', [
      pr('fix: trata `a\\|b` no parser'),
    ]);
    const linha = corpo
      .split('\n')
      .find((l) => l.startsWith('| #1 '))!;

    // Contagem de delimitadores REAIS: um `|` não precedido de contrabarra.
    const delimitadores = [...linha.matchAll(/(?<!\\)\|/g)].length;
    expect(delimitadores).toBe(5); // 4 colunas => 5 bordas
  });
});
