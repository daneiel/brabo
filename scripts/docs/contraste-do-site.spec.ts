import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// O site de docs segue os tokens do produto (AT-561, ADR 0181): este spec
// resolve os --site-* do site até hex, nos dois temas, e cobra 4,5:1.
const raiz = resolve(__dirname, '../..');
const TOKENS = readFileSync(resolve(raiz, 'design/tokens.css'), 'utf8');
const SITE = readFileSync(resolve(raiz, 'scripts/docs/site/assets/site.css'), 'utf8');

function bloco(css: string, seletor: string): Record<string, string> {
  const inicio = css.indexOf(`${seletor} {`);
  if (inicio < 0) return {};
  const corpo = css
    .slice(inicio, css.indexOf('\n}', inicio))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const vars: Record<string, string> = {};
  for (const m of corpo.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

function resolver(vars: Record<string, string>, nome: string): string | null {
  let v: string | undefined = vars[nome];
  for (let i = 0; v && i < 10; i++) {
    const ref = /^var\((--[\w-]+)\)$/.exec(v);
    if (!ref) break;
    v = vars[ref[1]];
  }
  return v && /^#[0-9a-f]{6}$/i.test(v) ? v : null;
}

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// [texto, fundo]: os pares que o site.css realmente desenha.
const PARES: [string, string][] = [
  ['--site-texto', '--site-fundo'],
  ['--site-texto-2', '--site-fundo'],
  ['--site-texto-mudo', '--site-fundo'],
  ['--site-link', '--site-fundo'],
  ['--site-texto', '--site-fundo-lateral'],
  ['--site-texto-2', '--site-fundo-lateral'],
  ['--site-link', '--site-fundo-lateral'],
  ['--site-codigo-texto', '--site-codigo-fundo'],
];

function medir(tokens: string, site: string) {
  const escuro = bloco(tokens, ':root');
  const claro = { ...escuro, ...bloco(tokens, "[data-theme='light']") };
  const mapa = bloco(site, ':root');
  const out: { tema: string; nome: string; razao: number }[] = [];
  for (const [tema, base] of [
    ['escuro', escuro],
    ['claro', claro],
  ] as const) {
    const vars = { ...base, ...mapa };
    for (const [texto, fundo] of PARES) {
      const c = resolver(vars, texto);
      const f = resolver(vars, fundo);
      if (c && f) out.push({ tema, nome: `${texto} / ${fundo}`, razao: contraste(c, f) });
    }
  }
  return out;
}

describe('contraste do site de documentação', () => {
  it('todo texto resolvido passa 4,5:1 contra o fundo nos dois temas', () => {
    const medidas = medir(TOKENS, SITE);
    console.log(medidas.map((m) => `${m.tema} ${m.nome} ${m.razao.toFixed(2)}`).join('\n'));
    expect(medidas.length, 'CEGO: nenhum valor resolvido').toBe(PARES.length * 2);
    for (const m of medidas) expect(m.razao, `${m.tema} ${m.nome}`).toBeGreaterThanOrEqual(4.5);
  });

  it('mutação: primary claro #c4552d sobre branco reprova (4,48)', () => {
    const mutado = TOKENS.replace(
      /(\[data-theme='light'\] \{[\s\S]*?--accent:\s*)#a4502c/,
      '$1#c4552d',
    );
    expect(mutado).not.toBe(TOKENS);
    const m = medir(mutado, SITE).find(
      (x) => x.tema === 'claro' && x.nome === '--site-link / --site-fundo',
    );
    expect(m?.razao).toBeLessThan(4.5);
  });

  it('mutação: sem o mapa do site é CEGO (zero valores)', () => {
    expect(medir(TOKENS, '')).toHaveLength(0);
  });
});
