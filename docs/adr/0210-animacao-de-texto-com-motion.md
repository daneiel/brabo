# 0210 — Animação de texto com `motion`

## Status

**Accepted.** 2026-10-03 (AT-401; decisão do dono em 03/10: usar o Shimmer do
AI Elements em todo texto de "em curso", com a lib `motion`).

## Context

O texto que diz "o agente está trabalhando" ("Pensando…", "Reunindo
informações…", o status "trabalhando") era estático ou vinha com três pontos
pulsando. O dono escolheu o Shimmer do AI Elements
(<https://elements.ai-sdk.dev/components/shimmer>). O original usa
`motion/react`, Tailwind e o `cn` do shadcn; o web do Brabo não tem Tailwind,
shadcn nem `clsx` — é CSS Modules sobre `design/tokens.css`.

## Decision

- `motion` entra em `apps/web` e mora atrás de UM componente,
  `apps/web/src/components/ui/Shimmer.tsx`; nenhum outro arquivo o importa.
- `LazyMotion` + `domAnimation` + `m.create(tag)` (cacheado por tag no
  módulo), para carregar só o subconjunto de animação de DOM.
- Grupo de vendor PRÓPRIO, `vendor-motion`, na lista de permitidos de
  `codeSplitting.groups` (AT-300). O chunk não entra na carga inicial: só as
  telas que usam o Shimmer (sessão, Visão geral, Executores) o puxam.
- O gradiente usa tokens: base `--text-secondary`, brilho `--text-primary`.
  O pior ponto (a base) é medido em `design-contraste.test.ts` sobre
  `--surface-0/1/2`, nos dois temas.
- Este PR aplica no turno do agente; os textos de carregamento e os demais
  estados em curso vêm em PRs próprios.

## Consequences

- Peso medido (`pnpm --filter web build`): chunk inicial `index` 52,81 →
  52,89 kB (16,73 → 16,75 kB gzip); `vendor-motion` novo, 76,23 kB (26,53 kB
  gzip), fora do `index.html`.
- Movimento reduzido: `useReducedMotion()` devolve o texto estático na
  cor-base, e o CSS Module tem `@media (prefers-reduced-motion: reduce)`.
- Os três pontos `.typing/.typingDot` do fio saíram; o keyframe `bpulse`
  fica, porque outros componentes o usam.
