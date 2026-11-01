# ADR 0234 — `shiki` no Code Block e `recharts` no Chart, sempre por carga dinâmica

- **Status:** aceito
- **Data:** 2026-11-01
- **Revisa:** a justificativa "sem dependência" do realce de código por regex
  (`MarkdownMessage`, aba Código) e do gráfico em SVG próprio
  (`SpendCharts.tsx`); o [ADR 0232](0232-shadcn-com-base-ui-no-apps-web.md)
  segue valendo inteiro
- **Contexto anterior:** [ADR 0068](0068-diagrama-c4-do-arquiteto.md) e
  [ADR 0103](0103-runner-local-execucao-na-maquina-do-usuario.md) (o molde de dependência pesada
  atrás de `import()`), [ADR 0074](0074-tema-alcancavel-e-o-boot-sob-csp.md) e
  [ADR 0181](0181-tema-preto-neutro.md) (dois temas, contraste como piso)

## Contexto

A adoção do shadcn/AI Elements (AT-636) tem quatro extras que o dono liberou em
31/10 (decisão 4): ⌘K, `shiki` no Code Block, `recharts` no Chart dos Gastos e
`@shadcn/react` no Questionnaire. O ⌘K saiu sem dependência nova (o
`Autocomplete` do `@base-ui/react`, já instalado, em vez do `cmdk`, que traria o
Radix) e o `@shadcn/react` já entrou na AT-653. Restam duas dependências de peso
medido no levantamento de 01/11 (esbuild + gzip): `shiki@4.5.0` (núcleo ~55 KB
gz, de 0,1 a 16 KB por linguagem; 44 pacotes transitivos; MIT) e
`recharts@3.8.0` (~105 KB gz; 37 transitivos de licença permissiva). `pnpm
audit --prod`: zero vulnerabilidades nas duas.

## Decisão

1. As duas entram no `apps/web` com versão EXATA e NUNCA no JS inicial nem em
   `codeSplitting.groups` (lista de permitidos): só por `import()`/`React.lazy`,
   no chunk de quem as usa.
2. `shiki` mora atrás de `lib/realce-shiki.ts`: `shiki/core` com o motor de
   regex em JS (sem WASM), linguagem sob demanda, tema próprio com
   `var(--syntax-*)` (sem hex, nos dois temas). O realce por regex de hoje fica
   como queda: enquanto o `shiki` carrega e para linguagem que ele não conhece.
3. `recharts` mora atrás de `GraficoDeGastoPorDia.tsx` (lazy), só nas séries
   diárias de gasto, com o SVG de hoje como queda e a tabela alternativa ao lado.
   Ele não pode ser importado por `SpendCharts.tsx`, que a aba Sessões também
   importa.
4. Cor de gráfico e de realce sai de token (`var(--accent)`, `var(--syntax-*)`);
   cor que precisa sair do CSS passa por `lib/tokens-padrao.ts`.

## Consequências

- O JS inicial não muda; quem não abre a tela de Gastos nem um bloco de código
  não baixa nada novo. Cada PR que mexe nessas telas mede o chunk antes e depois.
- Duas dependências a manter, com `overrides` se um aviso transitivo aparecer
  (disciplina do `pnpm-workspace.yaml`).
- Se uma das duas sair, a queda (regex, SVG) já está no código.
