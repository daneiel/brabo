import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Contraste WCAG dos pares de token que as telas de auth realmente usam.
 *
 * ## Por que cálculo e não axe
 *
 * A regra `color-contrast` do axe precisa de layout e de cor resolvida. jsdom não
 * aplica CSS Module, não resolve `var()` e devolve cor vazia — a regra sai como
 * "incomplete" ou passa sem ter olhado nada, e teste que passa sem olhar é pior
 * que teste ausente. Aqui as cores saem de `design/tokens.css` lido do disco, e a
 * razão de contraste é a fórmula do WCAG 2.1 (luminância relativa). É o mesmo
 * número que o DevTools mostra.
 *
 * O que este arquivo NÃO cobre: se o CSS de fato aplica esse par nesse elemento.
 * Isso é conferência visual, e o par só entra na lista abaixo depois de alguém
 * olhar de onde ele vem — o comentário de cada linha é essa procedência.
 *
 * ## A exceção do botão primário ACABOU (ADR 0181)
 *
 * Do ADR 0036 ao ADR 0181, `--on-accent` sobre `--accent` dava 3.20:1 no botão
 * primário do escuro, contra os 4.5:1 que texto de 14px/600 exige, e o teste
 * travava esse valor como exceção conhecida do design system. A paleta neutra
 * do ADR 0181 trocou o `--on-accent` do escuro pelo preto neutro — 5.61:1 sobre
 * o terracota suave —, então o que era número travado virou PISO nos dois
 * temas, afirmado abaixo.
 *
 * ## Tema claro
 *
 * Até o ADR 0074, `[data-theme='light']` existia nos tokens e **nada o definia**
 * em lugar nenhum da app: os pares do claro eram registro do que se herdava, e
 * três reprovavam. Agora `public/theme-boot.js` escreve o atributo (RN-182) e o
 * tema claro é uma tela de verdade — então os MESMOS pares de auth são cobrados
 * nos dois temas, com o mesmo piso. Ver o `describe.each` abaixo.
 */
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TOKENS = readFileSync(join(RAIZ, 'design', 'tokens.css'), 'utf8');

/** Declarações `--x: y;` do primeiro bloco cujo seletor casa. */
function lerBloco(seletor: string): Record<string, string> {
  const inicio = TOKENS.indexOf(seletor);
  if (inicio === -1) throw new Error(`seletor ausente em tokens.css: ${seletor}`);
  const abre = TOKENS.indexOf('{', inicio);
  const fecha = TOKENS.indexOf('}', abre);
  const valores: Record<string, string> = {};
  for (const linha of TOKENS.slice(abre + 1, fecha).split('\n')) {
    const m = /(--[\w-]+)\s*:\s*([^;]+);/.exec(linha);
    if (m) valores[m[1]] = m[2].trim();
  }
  return valores;
}

const DARK = lerBloco(':root');
const LIGHT = { ...DARK, ...lerBloco("[data-theme='light']") };

/** Resolve `var(--x)` até chegar a um hex. Os tokens têm no máximo um nível. */
function hex(token: string, tema: Record<string, string>): string {
  let valor = tema[token];
  for (let i = 0; i < 5; i++) {
    const m = /^var\((--[\w-]+)\)$/.exec(valor);
    if (!m) break;
    valor = tema[m[1]];
  }
  if (!/^#[0-9a-f]{6}$/i.test(valor)) {
    throw new Error(`${token} não resolveu para hex de 6 dígitos: ${valor}`);
  }
  return valor;
}

function luminancia(cor: string): number {
  const canais = [1, 3, 5].map((i) => {
    const c = parseInt(cor.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
}

function razao(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)];
  const [claro, escuro] = x > y ? [x, y] : [y, x];
  return (claro + 0.05) / (escuro + 0.05);
}

function contraste(
  frente: string,
  fundo: string,
  tema = DARK,
): number {
  return razao(hex(frente, tema), hex(fundo, tema));
}

/** 4.5:1 — texto normal. 3:1 vale só para ≥24px, ou ≥18.66px em negrito. */
const AA = 4.5;
/** 3:1 — ícone, borda e outro componente gráfico (WCAG 1.4.11). */
const AA_GRAFICO = 3;

describe.each<[string, Record<string, string>]>([
  ['dark', DARK],
  ['light', LIGHT],
])('contraste dos tokens usados nas telas de auth (tema %s)', (_nome, tema) => {
  describe('texto', () => {
    it.each<[string, string, string]>([
      // Título e subtítulo do card, texto do alerta de erro.
      ['--text-primary', '--surface-1', 'texto do card'],
      ['--text-secondary', '--surface-1', 'subtítulo, rótulo, texto de alerta'],
      // Rodapé do card, que é --surface-0 (um degrau abaixo do card).
      ['--text-secondary', '--surface-0', 'rodapé do card'],
      // Tagline (10px mono) e rodapé de página (10.5px mono), sobre o fundo.
      ['--text-muted', '--surface-0', 'tagline e rodapé de página'],
      // Texto digitado e placeholder do campo preenchido.
      ['--text-primary', '--surface-2', 'texto digitado no campo'],
      ['--text-secondary', '--surface-2', 'placeholder do campo preenchido'],
      // `.hint` do Input, sobre o card. Era --text-muted (3.89) até a Fase 7;
      // ficou no secondary por hierarquia depois que o muted passou (ADR 0181).
      ['--text-secondary', '--surface-1', 'texto de apoio do campo'],
      // `.link` em repouso. Foi --accent-hover enquanto o --accent dava 3.88
      // sobre o card; desde o ADR 0181 é o --accent do mock, e o hover
      // sublinha. O hover continua medido porque `a:hover` global o usa.
      ['--accent', '--surface-1', 'link sobre o corpo do card'],
      ['--accent', '--surface-0', 'link no rodapé do card'],
      ['--accent-hover', '--surface-1', 'link em hover (a:hover global)'],
    ])('%s sobre %s (%s) passa AA', (frente, fundo) => {
      expect(contraste(frente, fundo, tema)).toBeGreaterThanOrEqual(AA);
    });
  });

  describe('gráfico — ícone, borda, indicador', () => {
    it.each<[string, string, string]>([
      ['--danger', '--surface-1', 'ícone e borda do alerta de erro'],
      ['--warning', '--surface-1', 'ícone e barra do aviso de migração'],
      ['--success', '--surface-1', 'ícone do alerta de sucesso'],
      ['--text-muted', '--surface-2', 'ícone do botão de revelar senha'],
      ['--accent', '--surface-1', 'anel de foco do campo'],
    ])('%s sobre %s (%s) passa 3:1', (frente, fundo) => {
      expect(contraste(frente, fundo, tema)).toBeGreaterThanOrEqual(AA_GRAFICO);
    });
  });
});

describe('o botão primário — a exceção que deixou de existir', () => {
  it.each<[string, Record<string, string>]>([
    ['dark', DARK],
    ['light', LIGHT],
  ])('no tema %s o texto do botão primário passa AA, em repouso e em hover', (_nome, tema) => {
    // O escuro saiu de 3.20 (travado como exceção) para o preto neutro sobre o
    // terracota suave; o claro já passava desde o ADR 0074 com o terracota
    // escurecido. Cair abaixo de 4.5 em qualquer um é regressão, não dívida.
    expect(contraste('--on-accent', '--accent', tema)).toBeGreaterThanOrEqual(AA);
    expect(contraste('--on-accent', '--accent-hover', tema)).toBeGreaterThanOrEqual(AA);
  });

  it('a cor de marca continua terracota nos dois temas — o conserto não apagou a identidade', () => {
    // A régua que o ADR 0036 temia ("muda a marca em toda a UI") é medida aqui
    // pelo MATIZ: o acento segue na faixa laranja-avermelhada (10°–30°) nos
    // dois temas, e só a luminosidade/saturação mudaram.
    for (const tema of [DARK, LIGHT]) {
      const h = hex('--accent', tema);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      expect(max).toBe(r);
      const matiz = (60 * ((g - b) / (max - min)) + 360) % 360;
      expect(matiz).toBeGreaterThanOrEqual(10);
      expect(matiz).toBeLessThanOrEqual(30);
    }
  });
});
