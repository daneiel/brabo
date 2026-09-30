import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { lerTokens } from './lib/contraste';

/**
 * As tintas semânticas de `design/tokens.css` (AT-285).
 *
 * Os módulos CSS repetiam ~110 `color-mix()` sobre os mesmos cinco tons, com
 * uma dúzia de porcentagens vizinhas para o mesmo papel. Elas viraram tokens
 * (`--accent-soft`, `--danger-line`, `--success-panel`, `--focus-ring`…), e
 * este arquivo guarda as duas formas de a escala voltar a se espalhar:
 *
 * 1. um módulo misturar de novo um tom FIXO com porcentagem literal — em vez
 *    do token, ou da porcentagem-token (`var(--tint-soft)`) quando a cor é
 *    dinâmica;
 * 2. um módulo referenciar uma tinta que o `tokens.css` não declara (a regra
 *    CSS cai no valor inicial, sem erro nenhum).
 *
 * O teste de contraste não vê estas tintas — `color-mix` não resolve a uma cor
 * literal no parser dele —, então a paridade entre os temas é conferida aqui.
 */

const raizDoWeb = process.cwd();
const css = readFileSync(resolve(raizDoWeb, '../../design/tokens.css'), 'utf8');
const RAIZ = lerTokens(css, ':root');
const CLARO = lerTokens(css, `\\[data-theme='light'\\]`);

const TONS_FIXOS = ['accent', 'success', 'warning', 'danger', 'violet'];
const TINTA = /^--(accent|success|warning|danger|violet)-(soft|line|panel|panel-border)$|^--(focus-ring|focus-ring-inset|danger-ring)$/;

function modulosCss(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...modulosCss(caminho));
    else if (nome.endsWith('.module.css')) saida.push(caminho);
  }
  return saida;
}

/** `color-mix` de um tom FIXO com porcentagem literal, fora de comentário. */
function misturasSoltas(fonte: string): string[] {
  const semComentario = fonte.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = new RegExp(
    `color-mix\\(in srgb, var\\(--(${TONS_FIXOS.join('|')})\\) \\d+%`,
    'g',
  );
  return semComentario.match(re) ?? [];
}

/** Toda tinta (`--x-soft`, `--focus-ring`…) referenciada por `var()`. */
function tintasReferenciadas(fonte: string): string[] {
  return [...fonte.matchAll(/var\((--[\w-]+)\)/g)]
    .map((m) => m[1])
    .filter((nome) => TINTA.test(nome));
}

const MODULOS = modulosCss(resolve(raizDoWeb, 'src'));

describe('tintas semânticas (AT-285)', () => {
  const tintasDaRaiz = Object.keys(RAIZ).filter((n) => TINTA.test(n));

  it('existem no :root — a lista não nasce vazia', () => {
    expect(tintasDaRaiz.length).toBeGreaterThanOrEqual(21);
    expect(RAIZ['--tint-soft']).toBe('12%');
  });

  it('cada tinta é redeclarada no tema claro com a MESMA expressão', () => {
    for (const nome of tintasDaRaiz) {
      expect(CLARO[nome], `${nome} falta em [data-theme='light']`).toBe(RAIZ[nome]);
    }
  });

  it('o detector reprova mistura solta de tom fixo (caso de falha)', () => {
    expect(
      misturasSoltas('.x { background: color-mix(in srgb, var(--accent) 12%, transparent); }'),
    ).toHaveLength(1);
    // Comentário e cor dinâmica não contam.
    expect(
      misturasSoltas(
        '/* color-mix(in srgb, var(--danger) 10%, x) */ .y { background: color-mix(in srgb, var(--agent-color) 14%, transparent); }',
      ),
    ).toEqual([]);
  });

  it('nenhum módulo CSS mistura tom fixo com porcentagem literal', () => {
    expect(MODULOS.length).toBeGreaterThan(50);
    const soltas = MODULOS.flatMap((arquivo) =>
      misturasSoltas(readFileSync(arquivo, 'utf8')).map(
        (m) => `${relative(raizDoWeb, arquivo)}: ${m}`,
      ),
    );
    expect(soltas).toEqual([]);
  });

  it('toda tinta referenciada por um módulo existe no tokens.css', () => {
    const inexistentes = MODULOS.flatMap((arquivo) =>
      tintasReferenciadas(readFileSync(arquivo, 'utf8'))
        .filter((nome) => !(nome in RAIZ))
        .map((nome) => `${relative(raizDoWeb, arquivo)}: ${nome}`),
    );
    expect(inexistentes).toEqual([]);
  });
});
