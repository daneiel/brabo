import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AA_NAO_TEXTO,
  AA_TEXTO_NORMAL,
  lerCor,
  lerTokens,
  razaoDeContraste,
  resolverToken,
} from './contraste';

// A partir do cwd (`apps/web`), não de `import.meta.url`: o ambiente jsdom não
// garante URL de arquivo, e a leitura falhava antes de rodar teste nenhum.
const css = readFileSync(resolve(process.cwd(), '../../design/tokens.css'), 'utf8');

/**
 * Contraste dos tokens, medido.
 *
 * "Baixa visibilidade" é o defeito de UI mais fácil de introduzir e o mais
 * difícil de pegar em revisão: a cor parece boa no monitor de quem escreveu.
 * Este teste transforma a impressão em número, contra os MESMOS tokens que a
 * interface consome — o dark mode é o primário do design system, então ele é
 * o que precisa fechar.
 */
const dark = lerTokens(css, ':root');

/** Os pares que a interface realmente usa, escritos um a um. */
const PARES: { texto: string; fundo: string; piso: number; onde: string }[] = [
  { texto: '--text-primary', fundo: '--surface-0', piso: AA_TEXTO_NORMAL, onde: 'corpo sobre o fundo da página' },
  { texto: '--text-primary', fundo: '--surface-1', piso: AA_TEXTO_NORMAL, onde: 'corpo dentro de card' },
  { texto: '--text-primary', fundo: '--surface-2', piso: AA_TEXTO_NORMAL, onde: 'corpo em cabeçalho de tabela' },
  { texto: '--text-secondary', fundo: '--surface-0', piso: AA_TEXTO_NORMAL, onde: 'texto de apoio na página' },
  { texto: '--text-secondary', fundo: '--surface-1', piso: AA_TEXTO_NORMAL, onde: 'texto de apoio em card' },
  { texto: '--accent', fundo: '--surface-0', piso: AA_NAO_TEXTO, onde: 'link e realce' },
  { texto: '--danger', fundo: '--surface-0', piso: AA_NAO_TEXTO, onde: 'erro sobre o fundo' },
];

describe('contraste dos tokens (dark, o modo primário)', () => {
  it('o arquivo de tokens foi lido — o parser não passa vazio', () => {
    expect(Object.keys(dark).length).toBeGreaterThan(10);
    expect(resolverToken('--text-primary', dark)).not.toBeNull();
  });

  for (const par of PARES) {
    it(`${par.texto} sobre ${par.fundo} (${par.onde}) atinge ${par.piso}:1`, () => {
      const texto = resolverToken(par.texto, dark);
      const fundo = resolverToken(par.fundo, dark);
      expect(texto, `${par.texto} não resolve`).not.toBeNull();
      expect(fundo, `${par.fundo} não resolve`).not.toBeNull();

      const razao = razaoDeContraste(texto!, fundo!);
      expect(
        Number(razao.toFixed(2)),
        `${par.texto} sobre ${par.fundo} está em ${razao.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(par.piso);
    });
  }
});

/**
 * A dívida de contraste, MEDIDA e registrada.
 *
 * Estes pares estão em uso e NÃO atingem 4,5:1 para texto normal. Não os
 * escondo passando o piso para 3, nem quebro o CI por uma decisão que é do
 * design system (`design/tokens.css` é a fonte, e mexer na paleta é escolha do
 * dono). O teste trava o valor ATUAL: se alguém melhorar, ele avisa; se
 * piorar, ele reprova. É a diferença entre dívida conhecida e defeito novo.
 */
describe('dívida de contraste conhecida', () => {
  const DIVIDA: { texto: string; fundo: string; razao: number; onde: string }[] = [
    { texto: '--text-muted', fundo: '--surface-1', razao: 3.89, onde: 'legenda dentro de card' },
    { texto: '--text-muted', fundo: '--surface-2', razao: 3.1, onde: 'cabeçalho de tabela' },
    { texto: '--accent', fundo: '--surface-1', razao: 3.88, onde: 'link dentro de card' },
    { texto: '--danger', fundo: '--surface-1', razao: 3.88, onde: 'erro dentro de card' },
    { texto: '--success', fundo: '--surface-2', razao: 4.41, onde: 'selo em cabeçalho' },
  ];

  for (const d of DIVIDA) {
    it(`${d.texto} sobre ${d.fundo} (${d.onde}) continua em ${d.razao}:1`, () => {
      const razao = razaoDeContraste(
        resolverToken(d.texto, dark)!,
        resolverToken(d.fundo, dark)!,
      );
      expect(Number(razao.toFixed(2))).toBeCloseTo(d.razao, 1);
      // O piso que eles CUMPREM: servem como elemento de interface, não como
      // texto corrido. Cair abaixo de 3 seria defeito novo, não dívida.
      expect(razao).toBeGreaterThanOrEqual(AA_NAO_TEXTO);
    });
  }
});

describe('a aritmética', () => {
  it('preto no branco é 21:1 e branco no branco é 1:1', () => {
    const preto = lerCor('#000000')!;
    const branco = lerCor('#ffffff')!;
    expect(Math.round(razaoDeContraste(preto, branco))).toBe(21);
    expect(razaoDeContraste(branco, branco)).toBe(1);
  });

  it('lê hex curto e longo, e recusa o que não é cor', () => {
    expect(lerCor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(lerCor('#d6633a')).toEqual({ r: 214, g: 99, b: 58 });
    expect(lerCor('var(--x)')).toBeNull();
  });

  /** Alias quebrado é erro de escrita, não contraste ruim — não pode virar 0. */
  it('token inexistente devolve null em vez de fingir uma cor', () => {
    expect(resolverToken('--nao-existe', dark)).toBeNull();
  });
});
