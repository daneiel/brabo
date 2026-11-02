# ADR 0237 — O visual v3 liga o preflight e sobe os raios

- **Status:** aceito
- **Data:** 2026-11-02
- **Revisa:** o [ADR 0232](0232-shadcn-com-base-ui-no-apps-web.md), só no
  preflight ("sem preflight até a limpeza final"). A fidelidade ao design system
  do Brabo continua.

## Contexto

O dono avaliou três prévias de visual (v1, v2 e v3, em `13-design` do vault). Em
02/11/2026 aprovou a v3, o meio-termo: o preflight do Tailwind e os raios do
shadcn, mantendo o terracota, a tipografia e as superfícies do Brabo.

## Decisão

1. `src/shadcn.css` importa `tailwindcss/preflight` na camada `base`. Como o
   `index.css` não está em camada, ele vence o preflight.
2. O `index.css` restaura o que o preflight zera: tamanho de h1–h6, peso e margem
   de h4–h6, e margem de `p`, `ul` e `ol` (com marcador e recuo nas listas), só
   para o elemento SEM `class`.
3. Os raios nascem de `--radius: 0.625rem` em `design/tokens.css`:
   `--radius-sm/md/lg` = 6/8/10px e `--r-xs/sm` = 6/8px. `--radius-full` e
   `--r-pill` não mudam. `--r-sm` e `--radius-sm` continuam degraus diferentes.

## Consequências

- Telas com raio literal em módulo CSS não mudam; as que usam token ficam mais
  arredondadas.
- Os pisos de contraste não mudam.
