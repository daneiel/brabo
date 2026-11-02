/**
 * Tema do shiki feito de `var(--syntax-*)` (AT-657, RN-972): nenhuma cor
 * literal, então os dois temas saem do `data-theme` e o `contraste.test.ts`
 * já mede as oito cores.
 */
export const COR_POR_PAPEL = {
  keyword: 'var(--syntax-keyword)',
  function: 'var(--syntax-function)',
  string: 'var(--syntax-string)',
  number: 'var(--syntax-number)',
  comment: 'var(--syntax-comment)',
  type: 'var(--syntax-type)',
  operator: 'var(--syntax-operator)',
  text: 'var(--syntax-text)',
} as const;

const C = COR_POR_PAPEL;

export const temaShikiBrabo = {
  name: 'brabo',
  type: 'dark' as const,
  settings: [
    { settings: { foreground: C.text } },
    { scope: ['keyword', 'storage', 'constant.language'], settings: { foreground: C.keyword } },
    { scope: ['entity.name.function', 'support.function', 'meta.function-call'], settings: { foreground: C.function } },
    { scope: ['string', 'markup.inserted'], settings: { foreground: C.string } },
    { scope: ['constant.numeric', 'constant.character'], settings: { foreground: C.number } },
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: C.comment } },
    { scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class'], settings: { foreground: C.type } },
    { scope: ['keyword.operator', 'punctuation'], settings: { foreground: C.operator } },
  ],
};
