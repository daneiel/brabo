/**
 * Contraste dos tokens semânticos, medido — não estimado no olho.
 *
 * "Baixa visibilidade" é o defeito de UI mais fácil de introduzir e o mais
 * difícil de notar revisando: a cor parece boa no monitor de quem escreveu.
 * Aqui ele vira número: a razão WCAG entre um texto e o fundo em que ele é
 * usado, calculada dos MESMOS tokens que a interface consome.
 *
 * Não substitui olhar a tela — pega só o que é aritmética. Menu fora de lugar
 * e texto vazando exigem layout de verdade, e são o outro verificador
 * (`scripts/dev/validacao-visual.js`).
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** `#rgb`, `#rrggbb`. Devolve `null` para o que não for cor literal. */
export function lerCor(valor: string): Rgb | null {
  const t = valor.trim();
  const curto = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(t);
  if (curto) {
    return {
      r: parseInt(curto[1] + curto[1], 16),
      g: parseInt(curto[2] + curto[2], 16),
      b: parseInt(curto[3] + curto[3], 16),
    };
  }
  const longo = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(t);
  if (longo) {
    return {
      r: parseInt(longo[1], 16),
      g: parseInt(longo[2], 16),
      b: parseInt(longo[3], 16),
    };
  }
  return null;
}

/** Luminância relativa da WCAG 2.1. */
export function luminancia({ r, g, b }: Rgb): number {
  const canal = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/** Razão de contraste WCAG, de 1 (invisível) a 21 (preto no branco). */
export function razaoDeContraste(a: Rgb, b: Rgb): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  const [claro, escuro] = la > lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (escuro + 0.05);
}

/**
 * Resolve `var(--x)` até chegar a uma cor literal, dentro de um bloco de
 * tokens. Um alias que não resolve devolve `null` em vez de zero: token que
 * não existe é erro de escrita, não contraste ruim.
 */
export function resolverToken(
  nome: string,
  tokens: Record<string, string>,
  profundidade = 0,
): Rgb | null {
  if (profundidade > 10) return null;
  const valor = tokens[nome];
  if (!valor) return null;

  const alias = /^var\(\s*(--[\w-]+)\s*\)$/.exec(valor.trim());
  if (alias) return resolverToken(alias[1], tokens, profundidade + 1);

  return lerCor(valor);
}

/**
 * Extrai os tokens de um bloco `:root { … }` (ou de qualquer seletor) de uma
 * folha CSS. O parser é deliberadamente burro: se o arquivo mudar de forma, o
 * teste que o usa falha em vez de passar medindo outra coisa.
 */
export function lerTokens(css: string, seletor: string): Record<string, string> {
  const bloco = new RegExp(
    `${seletor.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*\\{([^}]*)\\}`,
  ).exec(css);
  if (!bloco) return {};

  const tokens: Record<string, string> = {};
  // Comentários saem ANTES do split: um `/* … */` na linha de cima deixava o
  // pedaço começando pelo comentário, e o `^` da regex nunca chegava ao token.
  // Efeito prático: metade dos tokens semânticos sumia do parser, e o teste de
  // contraste passava medindo só a outra metade.
  const corpo = bloco[1].replace(/\/\*[\s\S]*?\*\//g, '');
  for (const pedaco of corpo.split(';')) {
    const par = /^\s*(--[\w-]+)\s*:\s*([^]+)$/.exec(pedaco.trim());
    if (par) tokens[par[1]] = par[2].trim();
  }
  return tokens;
}

/** Piso da WCAG AA para texto normal. Texto grande (≥18.66px bold / 24px) é 3. */
export const AA_TEXTO_NORMAL = 4.5;
export const AA_TEXTO_GRANDE = 3;
/** Piso para elemento de interface (borda de campo, ícone que carrega sentido). */
export const AA_NAO_TEXTO = 3;
