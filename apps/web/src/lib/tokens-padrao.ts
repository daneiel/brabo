/**
 * Valor PADRÃO dos tokens de cor para quem precisa deles fora do CSS — AT-284,
 * ADR 0181.
 *
 * Três lugares do web pintam com uma biblioteca que recebe COR, não
 * `var(--x)`: o tema do Mermaid (`mermaid-render.ts`), o tema do xterm
 * (`routes/code/TerminalPanel.tsx`) e o canvas do minimapa
 * (`routes/code/minimap.ts`). Os três leem o token do `<html>` por
 * `getComputedStyle` — e cada um tinha o próprio fallback em hex, escrito à
 * mão, para quando o token não resolve (render fora do navegador, folha ainda
 * não aplicada). Eram 27 literais soltos, e o ADR 0181 os pegou mentindo: o
 * Mermaid caía no azul-petróleo de antes (com `--teal-400/600` da paleta BRUTA
 * no lugar de um semântico), o cursor do xterm caía no teal que não é o
 * acento, e o minimapa num cinza que não existe no design system.
 *
 * Aqui mora UMA cópia, do tema PRIMÁRIO (escuro), e `tokens-padrao.test.ts` lê
 * `design/tokens.css` e reprova quando um valor daqui deixa de ser o que o
 * `:root` resolve. É o mesmo mecanismo que tirou a cópia à mão de
 * `design-contraste.test.ts` no ADR 0074: a cópia existe porque o runtime
 * precisa dela, e o teste impede que ela diverja em silêncio.
 */
export const TOKENS_PADRAO = {
  '--surface-0': '#0d0d0f',
  '--surface-1': '#141417',
  '--surface-2': '#1c1c21',
  '--text-primary': '#ececef',
  '--text-secondary': '#a1a1aa',
  '--accent': '#c8744f',
  '--border': '#2a2a30',
  '--border-strong': '#3a3a42',
  '--code-bg': '#0a0a0c',
  '--syntax-keyword': '#c8744f',
  '--syntax-function': '#5fb3a8',
  '--syntax-string': '#d4a13a',
  '--syntax-number': '#9d8ad6',
  '--syntax-comment': '#80808a',
  '--syntax-type': '#3fb68b',
  '--syntax-operator': '#a1a1aa',
  // Não é cor, mas o xterm também a recebe como valor e não como `var()`.
  '--font-mono': "'IBM Plex Mono', monospace",
} as const;

export type TokenComPadrao = keyof typeof TOKENS_PADRAO;

/**
 * O valor do token no tema ATIVO, lido do elemento (o `<html>` por padrão, onde
 * o `data-theme` mora), ou o padrão do tema primário quando ele não resolve.
 * Nunca lança: fora do navegador (`window` ausente) devolve o padrão.
 */
export function lerTokenDoTema(nome: TokenComPadrao, elemento?: Element): string {
  if (typeof window === 'undefined') return TOKENS_PADRAO[nome];
  const alvo = elemento ?? document.documentElement;
  const valor = getComputedStyle(alvo).getPropertyValue(nome).trim();
  return valor || TOKENS_PADRAO[nome];
}
