# ADR 0122 — `SessionPage.tsx` split into five mechanical PRs, declared upfront

- **Status:** accepted
- **Date:** 2026-08-29
- **References (without editing):** [ADR 0121](0121-schema-dividido-por-agregado-de-dominio.md)
  (same shape of reasoning as this one — a shared file grew past the point
  where "just work around it" is cheaper than drawing a boundary — but a
  different execution shape: 0121 was one zero-diff commit, this is five
  PRs in sequence, because the file is under active feature churn and a
  single PR would either freeze the codebase or race every other change).

## Context

`apps/web/src/routes/SessionPage.tsx` is 3 807 lines and 169 KiB —
`docs/explanation/backlog.md`'s technical-debt review already carries a row
for it:

> Decompose `SessionPage.tsx` / `ProjectSettingsTab.tsx` | G | `SessionPage.tsx`
> is 169 KiB with 25 test files importing it; `ProjectSettingsTab.tsx` is
> 90 KiB | already informally called a "disputed file" in
> historico-de-fases.md, but never promoted to a tracked debt item; per the
> standing rule this is its own phase, never a drive-by refactor

Three concrete costs make this more than a size complaint:

1. **25 test files depend on it** (`SessionPage.*.test.tsx` plus
   `SessionPage.ponto.test.ts`) — any structural change risks a wide blast
   radius, and the size of the file makes it hard to tell in advance which
   of the 25 a given change can touch.
2. **The file is under active churn, not legacy code.** 50 commits have
   touched it; the most recent 15 are almost entirely `feat` additions
   (structured questions, handoff, the turn-activity strip, the RN-172
   turn/desfecho ordering…), and none of them was an extraction — this is
   the first attempt at drawing an internal boundary in the file's history.
   That rules out a big-bang rewrite: freezing the file for one large PR
   would either block every other feature landing in it or force painful,
   repeated rebases.
3. **The test suite already draws part of the boundary.** Before this PR,
   `SessionPage.ordenacao-e-avisos.test.tsx` imports `aberturasDeTurno`,
   `turnoDoSeq`, `afundarDesfechos`, `ordemDaAcaoNaTimeline` and
   `agruparNarracoesDoTurno` **directly by name** from `./SessionPage`
   (`await import('./SessionPage')`, destructured), and
   `SessionPage.ponto.test.ts` does the same for `pontoDaSessao` — not
   through rendering the component, but as plain function calls. The tests
   had already decided these five (plus `agruparNarracoesDoTurno`) are
   independent units; this ADR promotes that existing boundary to a real
   module boundary instead of inventing a new one.

Given the churn and the blast radius, the standing rule from `CLAUDE.md`
applies — "not a drive-by refactor" — so this is its own phase, planned as a
sequence of independently-mergeable, behavior-neutral PRs, each one
evidenced by the same 25 test files passing **unedited**.

## Decision

Five PRs, executed and merged one at a time (never in parallel — each one
lands on `dev` before the next starts), in this order:

1. **Pure timeline/turn helpers → `apps/web/src/lib/session-timeline.ts`**
   (this PR). `aberturasDeTurno`, `turnoDoSeq`, `afundarDesfechos`,
   `pontoDaSessao`, `ordemDaAcaoNaTimeline`, and the `TimelineEntry` type
   they share. All five are confirmed pure — no JSX, no `styles`/CSS-module
   reference, no closure over component state — which makes this the
   lowest-risk slice and the right one to go first: a mechanical `.ts` move
   with nothing to reconcile against React's render cycle.
   `agruparNarracoesDoTurno` stays in `SessionPage.tsx` on purpose, even
   though it sits in the same region and is tested the same way: it returns
   JSX (`<Disclosure>`) and reads three `styles.narracoes*` class names from
   `SessionPage.module.css`. Moving it would mean deciding that `lib/`
   accepts its first `.tsx` file — today it holds only `.ts` sources (a few
   `.tsx` **tests** exist, but zero `.tsx` **source** files) — and that
   precedent belongs to a PR that is actually about JSX sub-components
   (PR 2), not one that is supposed to be a pure-function move.

2. **`StorySlide` → `apps/web/src/routes/StorySlide.tsx`.** The first JSX
   sub-component to move, and the simplest one: a single leaf component
   (the promotion-carousel slide, RN-148) with no children that also need
   to move. This is the PR that decides the `SessionPage.module.css`
   sharing question, covered below.

3. **`StructuredQuestionCard` + `permiteOutra` → `apps/web/src/routes/StructuredQuestionCard.tsx`.**
   Another self-contained JSX sub-component (the RN-162/RN-171 structured-
   question form) plus the one pure helper it privately depends on — moved
   together because splitting a component from the single helper that only
   it calls would add a file for no reader's benefit.

4. **Backlog-tree helpers + `ItemDeBacklog` + `ContextAside` → `apps/web/src/lib/session-backlog-tree.ts` + `apps/web/src/routes/ContextAside.tsx`.**
   The largest slice: pure tree-shaping helpers (their natural home is
   `lib/`, same reasoning as PR 1) alongside the JSX that renders them
   (`ItemDeBacklog`, `ContextAside` — natural home is `routes/`, same
   reasoning as PRs 2–3). Goes after the simpler single-component moves
   specifically because it's a two-file, two-kind extraction and benefits
   from PRs 2–3 having already answered the CSS-sharing question once.

5. **Readiness flags → `apps/web/src/lib/session-readiness.ts`, a
   `useSessionReadiness` hook.** Last, and the only PR in the set that is
   **not** a file move: the readiness flags (RN-160/RN-161 gates on the
   Architect/PO buttons) are computed inline from state and props that live
   in `SessionPage.tsx`, so extracting them means writing a new hook with an
   explicit input/output contract, not relocating an existing standalone
   function or component. Ordered last because it is the riskiest of the
   five — a hook boundary can change *when* something recomputes even when
   the formula is unchanged — and by PR 5 the other four will have already
   shrunk the file enough to make that risk easier to review in isolation.

### The `SessionPage.module.css` sharing question, answered once

`SessionPage.module.css` has exactly one importer today —
`SessionPage.tsx` itself (verified: `grep` for the specifier across
`apps/web/src` outside test files returns one hit). That means PRs 2–4 can
have their newly-extracted sibling files (`StorySlide.tsx`,
`StructuredQuestionCard.tsx`, `ContextAside.tsx`) import
`../routes/SessionPage.module.css` directly, the same way `SessionPage.tsx`
does today — no CSS split, no new shared stylesheet, no risk of the two
copies drifting, because there was never a second copy. This is a decision
worth writing down once, here, rather than re-litigating it in three
separate PR reviews.

### Explicitly out of scope for the whole five-PR effort

Two things stay untouched by this ADR and by all five PRs:

- **The turn-channel state cluster**: `turnoViaCanal`, `statusAgent`,
  `pensandoVisivel`, `atividadeDoTurno`. These four pieces of state are
  read AND written by four different turn-entry handlers
  (`handleSend`, `handleReadiness`, `handleArchitectureReadiness`,
  `handleAcceptHandoff`) and closed over by `finalizarTurnoDoAgente`, which
  the in-code comment calls "o ÚNICO lugar que finaliza um turno" (the ONE
  place that ends a turn) — every one of those four handlers turns
  `turnoViaCanal` on, and only `finalizarTurnoDoAgente` turns it off. It is
  not a contiguous JSX subtree or a set of pure functions; it is
  interleaved control flow, and moving it is a design decision about where
  turn-lifecycle state should live, not a mechanical relocation. It gets
  its own, later, separately-numbered ADR when that work is scoped.
- **`apps/web/src/routes/ProjectSettingsTab.tsx`** (~90 KiB, the other file
  named in the same backlog row). Smaller, already has its own in-progress
  first step (named in-file functions, not yet extracted to modules), and
  is a separate scope decision — this ADR covers `SessionPage.tsx` only.

## Consequences

- **Two people can work in different corners of `SessionPage.tsx` with
  less overlap** after all five PRs land — the same benefit ADR 0121
  described for the schema split, at smaller scale (five extracted units,
  not sixteen files).
- **The acceptance bar for every PR in this set is the same: zero
  observable behavior change**, proven by the same 25
  `SessionPage.*.test.tsx` files passing **unedited** after each PR. A PR
  in this set that needs to edit one of those 25 files to make it pass is
  not actually mechanical, and should stop rather than "fix" the test.
- **The turn-channel cluster and `ProjectSettingsTab.tsx` stay exactly as
  disputed as before.** This ADR does not reduce their risk and does not
  claim to — naming them here is what keeps the cut declared instead of
  silently narrowed. A future PR that touches the turn-channel cluster
  needs its own new-numbered ADR that references this one; it does not
  amend this one, per the standing rule that an accepted ADR is never
  edited.
- **`lib/` gains its first files with `TimelineEntry`-shaped JSX-adjacent
  types** (PR 1's `TimelineEntry` holds a `ReactNode` field) **without
  gaining its first `.tsx` source file** — `agruparNarracoesDoTurno`
  staying in `SessionPage.tsx` is what preserves that property through PR 1.
  PR 2 is the one that spends that precedent, deliberately, once, with its
  own review.
- **`SessionPage.tsx` shrinks in five visible steps** (3 807 → smaller after
  each PR) instead of one large diff — easier to review, but it also means
  the file spends four PRs' worth of time in a partially-decomposed state,
  which is accepted here as the cost of not freezing active feature work.

## Discarded alternatives

- **One large PR moving everything at once.** Rejected: the file is under
  active churn (50 commits, the last 15 mostly feature additions), so a
  single PR either freezes all other `SessionPage.tsx` work until it merges
  or accumulates merge conflicts faster than it can be reviewed. Splitting
  into five independently-mergeable PRs lets normal feature work continue
  between them.
- **Moving `agruparNarracoesDoTurno` alongside the other five in PR 1**,
  since it lives in the same source region (lines 281–345) and is tested
  the same way. Rejected: it returns JSX and reads `styles.narracoes*`,
  so moving it would silently decide that `lib/` accepts `.tsx` source
  files — a real precedent that deserves its own review, not a side effect
  of a PR framed as "pure function move."
- **Extracting the turn-channel cluster as part of this same plan**, since
  it is the other large chunk of state in the file. Rejected outright:
  it is coupled control flow across four handlers, not a boundary the
  test suite already draws, and the in-code comment already names it as
  the one place that must stay synchronized — exactly the kind of change
  this ADR's "mechanical, provably behavior-neutral" acceptance bar cannot
  honestly claim to cover.
