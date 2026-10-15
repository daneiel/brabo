---
traducao_de: 9d4f011ddd0f94cccc993a6640002463803b1925
---

# ADR 0210 — Text animation with `motion`

## Status

**Accepted.** 2026-10-03 (AT-401; owner decision on 03/10: use AI Elements'
Shimmer on every "in progress" text, with the `motion` lib).

## Context

The text saying "the agent is working" ("Thinking…", "Gathering
information…", the "working" status) was static or came with three pulsing
dots. The owner chose AI Elements' Shimmer
(<https://elements.ai-sdk.dev/components/shimmer>). The original uses
`motion/react`, Tailwind and shadcn's `cn`; Brabo's web has no Tailwind, shadcn
nor `clsx` — it is CSS Modules over `design/tokens.css`.

## Decision

- `motion` enters `apps/web` and lives behind ONE component,
  `apps/web/src/components/ui/Shimmer.tsx`; no other file imports it.
- `LazyMotion` + `domAnimation` + `m.create(tag)` (cached per tag in the
  module), to load only the DOM animation subset.
- Its OWN vendor group, `vendor-motion`, in the allow list of
  `codeSplitting.groups` (AT-300). The chunk does not enter the initial load:
  only the screens that use the Shimmer (session, Overview, Executors) pull it.
- The gradient uses tokens: base `--text-secondary`, shine `--text-primary`. The
  worst point (the base) is measured in `design-contraste.test.ts` over
  `--surface-0/1/2`, in both themes.
- This PR applies it to the agent's turn; the loading texts and the other
  in-progress states come in their own PRs.

## Consequences

- Measured weight (`pnpm --filter web build`): initial `index` chunk 52.81 →
  52.89 kB (16.73 → 16.75 kB gzip); new `vendor-motion`, 76.23 kB (26.53 kB
  gzip), outside `index.html`.
- Reduced motion: `useReducedMotion()` returns the static text in the base
  color, and the CSS Module has `@media (prefers-reduced-motion: reduce)`.
- The thread's three `.typing/.typingDot` dots went away; the `bpulse` keyframe
  stays, because other components use it.
