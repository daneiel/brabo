import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { lerTokens } from './lib/contraste';

/**
 * A escala tipográfica, de espaço e de raio (AT-288).
 *
 * Três regras, cada uma com o detector provado por um caso que reprova:
 *
 * 1. Os meios-degraus (10,5 / 11,5 / 12,5 px) não existem em módulo nenhum. O
 *    12,5 do handoff é o `--fs-mono`, e é por ele que entra.
 * 2. Nos módulos da Sessão, do Shell e do trilho do projeto, tamanho de fonte
 *    que COINCIDE com um degrau `--fs-*` é escrito pelo token — é por esses que
 *    a tela se lê primeiro, e é ali que o número solto derivava.
 * 3. Raio que coincide com um degrau da família `--r-*`/`--radius-*` é escrito
 *    pelo token. Os DOIS nomes convivem como ALIAS declarado (ver o
 *    `tokens.css`), com um degrau que NÃO coincide: `--r-sm` é 7px e
 *    `--radius-sm` é 4px — o teste fixa isso para ninguém "unificar" os dois.
 */

const raiz = process.cwd();
const TOKENS = lerTokens(readFileSync(resolve(raiz, '../../design/tokens.css'), 'utf8'), ':root');

function modulos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const c = join(dir, nome);
    if (statSync(c).isDirectory()) return modulos(c);
    return nome.endsWith('.module.css') ? [c] : [];
  });
}

function semComentario(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function meiosDegraus(css: string): string[] {
  return semComentario(css).match(/font-size:\s*1[0-2]\.5px/g) ?? [];
}

/** `font-size` literal cujo valor é um degrau da escala `--fs-*`. */
function tamanhosQueTemToken(css: string): string[] {
  const degraus = new Set(
    Object.entries(TOKENS)
      .filter(([nome]) => nome.startsWith('--fs-'))
      .map(([, valor]) => valor),
  );
  return (semComentario(css).match(/font-size:\s*[0-9.]+px/g) ?? []).filter((d) =>
    degraus.has(d.replace(/font-size:\s*/, '')),
  );
}

const RAIOS_COM_TOKEN = /border-radius:\s*(4|5|7|8|12|999)px\s*;/g;

const TODOS = modulos(resolve(raiz, 'src'));
const ESCOPO = [
  'src/routes/SessionPage.module.css',
  'src/routes/Shell.module.css',
  'src/routes/ProjectRail.module.css',
  'src/routes/SessionLanguageIndicator.module.css',
].map((c) => resolve(raiz, c));

describe('escala tipográfica, de espaço e de raio (AT-288)', () => {
  it('os detectores reprovam o que dizem reprovar (caso de falha)', () => {
    expect(meiosDegraus('.a { font-size: 11.5px; }')).toHaveLength(1);
    expect(meiosDegraus('/* font-size: 12.5px */ .a { font-size: var(--fs-mono); }')).toEqual([]);
    expect(tamanhosQueTemToken('.a { font-size: 13px; } .b { font-size: 14px; }')).toEqual([
      'font-size: 13px',
    ]);
    expect(semComentario('.a { border-radius: 7px; }').match(RAIOS_COM_TOKEN)).toHaveLength(1);
  });

  it('nenhum módulo tem meio-degrau de fonte', () => {
    const achados = TODOS.flatMap((f) =>
      meiosDegraus(readFileSync(f, 'utf8')).map((m) => `${relative(raiz, f)}: ${m}`),
    );
    expect(achados).toEqual([]);
  });

  it('Sessão, Shell e trilho escrevem pelo token todo tamanho que tem degrau', () => {
    const achados = ESCOPO.flatMap((f) =>
      tamanhosQueTemToken(readFileSync(f, 'utf8')).map((m) => `${relative(raiz, f)}: ${m}`),
    );
    expect(achados).toEqual([]);
  });

  it('raio que coincide com um degrau é escrito pelo token, em todo módulo', () => {
    const achados = TODOS.flatMap((f) =>
      (semComentario(readFileSync(f, 'utf8')).match(RAIOS_COM_TOKEN) ?? []).map(
        (m) => `${relative(raiz, f)}: ${m}`,
      ),
    );
    expect(achados).toEqual([]);
  });

  it('--r-sm e --radius-sm são degraus DIFERENTES, e os alias apontam para os --radius-*', () => {
    expect(TOKENS['--r-sm']).toBe('7px');
    expect(TOKENS['--radius-sm']).toBe('4px');
    expect(TOKENS['--r-md']).toBe('var(--radius-md)');
    expect(TOKENS['--r-lg']).toBe('var(--radius-lg)');
    expect(TOKENS['--r-pill']).toBe('var(--radius-full)');
  });
});
