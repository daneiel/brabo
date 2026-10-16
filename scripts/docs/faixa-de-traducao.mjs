/**
 * Leitura PURA do `idioma_original` do frontmatter (AT-564), usada pela guarda
 * `faixa-de-traducao-check.mjs`. Ausente = `null` (a fonte está em pt-BR).
 */
export function idiomaOriginal(texto) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(texto);
  return (fm && /^idioma_original:\s*['"]?([\w-]+)/m.exec(fm[1])?.[1]) || null;
}
