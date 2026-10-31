# ADR 0232 — shadcn/ui com Base UI e Tailwind 4 no `apps/web`

## Status

**Accepted.** 2026-10-31 (AT-645, onda 1 da AT-636; decisões do dono em 31/10).
Não edita os ADRs 0074 (tema nos dois modos) nem 0181 (paleta neutra): usa os
tokens deles como fonte. O número 0231 está reservado para a AT-626.

## Context

O chat e a interface de IA passam a usar os padrões do AI Elements, que o
shadcn absorveu. O `apps/web` é CSS Modules sobre `design/tokens.css`, sem
Tailwind e sem alias `@/`. O tema é escrito em `[data-theme]` por
`public/theme-boot.js`; o shadcn espera `.dark`. Há colisões de nome entre os
tokens do Brabo e as variáveis cruas do shadcn (`--accent`, `--radius-*`,
`--font-mono`).

## Decision

- **Base:** shadcn/ui, estilo `base-nova`, sobre **Base UI** (`@base-ui/react`),
  não Radix. Tailwind 4 via `@tailwindcss/vite`.
- **Tema:** a paleta neutra com terracota e as fontes Space Grotesk, Archivo e
  IBM Plex Mono ficam. O shadcn é tematizado pelos tokens do Brabo, nunca o
  contrário.
- **Convivência:** os `*.module.css` continuam até a limpeza final. O
  **preflight do Tailwind só entra no fim**; até lá `src/shadcn.css` importa só
  `tailwindcss/theme` e `utilities`, em layers (perdem para o CSS sem layer), com
  `source(none)` e `@source` apenas em `components/shadcn/` para não emitir
  utilitários soltos (`.absolute`, `.container`) a partir do resto do `src`.
- **Cores:** `@theme { --color-*: initial }` e `@theme inline` mapeando as
  cores semânticas aos tokens (`primary`→`--accent`, `accent`→`--surface-2`...).
  O projeto NÃO declara variáveis cruas do shadcn. `--radius-*` e `--font-mono`
  já são do Brabo e o `:root` sem layer vence o default do Tailwind.
- **Dark:** `@custom-variant dark` sobre `[data-theme='dark']`.
- **Alias** `@/` → `apps/web/src` (vite e tsconfig); o código existente não é
  reescrito. `components.json`: `aliases.ui` = `@/components/shadcn` (não
  `components/ui`, que é das primitivas da casa), `utils` = `@/lib/utils` (`cn`).
- **Dependências**, cada uma com o motivo:
  - `tailwindcss` e `@tailwindcss/vite`: o motor dos utilitários do shadcn;
  - `@base-ui/react`: as primitivas sem estilo sob os componentes;
  - `class-variance-authority`: variantes dos componentes copiados;
  - `clsx` e `tailwind-merge`: o `cn`, que resolve conflito de classes;
  - `lucide-react`: ícones do `iconLibrary` do shadcn (ainda sem uso).
- **Bundle:** grupo `vendor-ui` na lista de permitidos de `codeSplitting.groups`
  (Base UI, cva, clsx, tailwind-merge, lucide).
- **Prova mínima:** `components/shadcn/button.tsx` (registry `base-nova`, com a
  importação de `cn` trocada e as referências `var(--secondary)`/`var(--foreground)`
  trocadas por tokens do Brabo), sem uso em tela, com teste.

## Consequences

- Nenhuma tela muda. O CSS global cresce pelo layer do tema e pelos utilitários
  do Button; o JS do chunk inicial não muda (Button sem importador).
- Componente novo do shadcn nasce em `components/shadcn/`; o CLI tenta rodar
  `pnpm add` e pode falhar sem `pnpm` no PATH, e então o arquivo vem do registry
  e é ajustado à mão.
- Fora desta onda: adaptadores da casa, padrões ai-elements, telas, preflight e
  a remoção dos `module.css`.
