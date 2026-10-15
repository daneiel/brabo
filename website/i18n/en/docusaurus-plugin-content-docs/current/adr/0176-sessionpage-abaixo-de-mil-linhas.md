---
traducao_de: 6b761ce09ad165373334e6fd24e9f8f1b2d21f9c
---

# ADR 0176 — `SessionPage.tsx` below 1,000 lines, in ten mechanical PRs, and the lock only afterwards

## Status

**Accepted.** 2026-09-28 (AT-138, `BRB-015`). Maintainer decision
(2026-09-27): **yes, and lock afterwards** — decompose
`apps/web/src/routes/SessionPage.tsx` to below 1,000 lines in mechanical PRs,
and only then turn the ceiling into a CI lock.

References, without editing, [ADR 0122](0122-sessionpage-dividido-em-cinco-prs.md)
(the five mechanical PRs that took the file from 3,807 to 2,661 lines and
decided that the extracted siblings import `SessionPage.module.css` directly),
[ADR 0124](0124-hook-do-canal-de-turno-do-sessionpage.md) (the turn channel
cluster in `useTurnoDoAgente`, which this program does NOT touch) and
[ADR 0125](0125-projectsettingstab-dividido-por-secao.md) (the same rule of
"importers change nothing", applied to `ProjectSettingsTab.tsx`).

## Context

The `SessionPage.tsx` debt line closed on 2026-08-30, through ADRs 0122 and
0124, at **2,479** lines. It closed on a NUMBER, and nothing measured the number
afterwards: on 2026-09-13 the file had 2,559 lines (`architecture.md` started
declaring this, AT-031), and on today's `origin/dev` (`018b8cd24c`, measured
with `wc -l`) it has **2,637 lines and 122,379 bytes**. Nobody did anything
wrong — each addition was a legitimate feature (the fit-models filter, the Infra
handoff card, the closed-session refusal, the Infra Lead in the composer) — and
that is exactly why the regression happened: without a lock, debt comes back as
a sum of right decisions.

What the file was, measured before this program:

- **A ~2,400-line component.** The body of `SessionPage` went from line 237 to
  2,637. Outside it there were only the imports, the re-export of the timeline
  functions and `agruparNarracoesDoTurno`.
- **The biggest block was a 762-line `useMemo`**, the timeline assembly: one
  JSX node per event type, the batch of stories awaiting promotion
  (RN-126/RN-148) and the approval cards (RN-155).
- **The returned JSX had ~625 lines** in three independent strips: the top bar,
  the scrolling thread content, and the bottom strip (Infra card, manual
  handoff, composer).
- **The handlers were ~500 lines**, in three families: the TURN ones
  (`handleSend`, `handleCancel`, `handleReadiness`,
  `handleArchitectureReadiness` — the door of the ADR 0124 cluster), the story
  PROMOTION ones and the HANDOFF/EXECUTION ones that are not turns.
- **28 `SessionPage.*.test.tsx` files**, 173 tests, all with MODULE `vi.mock`
  (`../lib/api-client`, `../lib/hooks`, `../lib/session-channel`…). A module
  mock applies to any file that imports the module, so code moved to a sibling
  file stays mocked — that is what makes moving without editing tests viable.

## Decision

**Ten PRs, stacked in order** (each on top of the previous, `--base` the
previous one's branch), each MECHANICAL: move code without changing behaviour —
no refactoring logic, renaming the component's public API or "improving in
passing". The acceptance rule is ADR 0122's, word for word: **the 28 existing
test files pass WITHOUT EDITS**. A PR that needs to edit one of them is not
mechanical and stops.

`SessionPage.tsx` goes from **2,637** to **834** lines (−1,803):

| PR | What leaves | Where to | `SessionPage.tsx` after |
|---|---|---|---|
| — | ADR 0176 (this document) | `docs/adr/` | 2,637 |
| 1 | `agruparNarracoesDoTurno`, `FIO_RECENTES_ABERTAS`, the body of the `useMemo`s `timelineAgrupada` (collapse by agent, RN-138) and `fio` (cut by origin, RN-177) | `routes/session-fio.tsx` (`agruparTimelinePorAgente`, `dividirFio`) | 2,445 (−192) |
| 2 | the body of the `timeline` `useMemo` (762 lines) | `routes/session-timeline-montagem.tsx` (`montarTimeline`) | 1,718 (−727) |
| 3 | the top bar | `routes/SessionTopbar.tsx` | 1,561 (−157) |
| 4 | the thread content (invitation, history, recent, optimistic, streaming bubble) | `routes/SessionFio.tsx` | 1,390 (−171) |
| 5 | the bottom strip (Infra card, manual handoff, composer) | `routes/SessionComposer.tsx` | 1,225 (−165) |
| 6 | `activeFor`, `offeredHandoff`, `handoffDaInfraOferecido` and the three "already declared" | `lib/session-handoffs.ts` (`derivarHandoffsDaSessao`) | 1,163 (−62) |
| 7 | the four refs and the four scroll effects, and `rolarParaOFim` | `lib/session-rolagem.ts` (`useRolagemDoFio`) | 1,094 (−69) |
| 8 | the five states and three story-promotion handlers, and the return modal | `lib/session-promocao.ts` (`usePromocaoDeHistorias`) + `routes/DevolverHistoriaModal.tsx` | 982 (−112) |
| 9 | the four states and five handoff/execution handlers that are not turns (RN-406, RN-440, RN-161, RN-137, RN-153) | `lib/session-acoes-de-handoff.ts` (`useAcoesDeHandoff`) | 834 (−148) |
| 10 | **the lock** | `routes/SessionPage.teto.test.ts` | 834 |

**The order goes from least to most risky**, as in ADR 0122: first what is a
pure or nearly pure function (PRs 1–2), then stateless JSX (PRs 3–5), then pure
derivation (PR 6), and lastly the HOOKS (PRs 7–9), which are the only ones that
touch the component's hook order.

**What "mechanical" means for each kind of cut**, decided once here so it is
not relitigated in ten reviews:

1. **A `useMemo` body becomes a function called FROM INSIDE the same `useMemo`,
   with the SAME dependency list, byte for byte** — including the ones it does
   not list. The timeline assembly closes over handlers (`handlePromoteStory`,
   `handleAcceptHandoff`…), `t` and `semRepositorio` that were never in the
   dependencies; completing the list would change WHEN the timeline is rebuilt,
   and that is behaviour. `oxlint` keeps warning (`exhaustive-deps` is `warn`)
   about what it already warned about.
2. **A JSX block becomes a component whose props have the SAME names** the block
   read from `SessionPage`'s scope. The component calls its own
   `useTranslation('sessionPage')`. A block with several siblings becomes a
   fragment. The modal's `{recusandoStory && …}` went along, inside the
   component.
3. **Pure derivation becomes a pure function** that returns the same names,
   computed on every render as before.
4. **State + handlers become a hook** called at the SAME point where the
   effects were (PR 7), or right after `useTurnoDoAgente` when the handlers
   depend on it (PRs 8–9). The position of the `useState`s in the hook order
   changes, and that is not observable: React only requires the same order
   between one render and the next. The handlers remain functions recreated on
   every render, as the component's `async function`s were.
5. **Without JSX goes to `lib/*.ts`; with JSX stays in `routes/*.tsx`** and
   imports `SessionPage.module.css` directly — ADR 0122's answer to the CSS
   question, reused without reopening. `lib/` stays without code `.tsx`.
6. **Comments go along with the code**, including the ones saying "here" or
   "just below" — the new file says at the top where they came from. Rewriting a
   comment in passing is the "improving in passing" the program forbids.
7. **`SessionPage.tsx` re-exports what the tests import from it**:
   `agruparNarracoesDoTurno` moved to `session-fio.tsx` and is still
   re-exported, for the same reason as the four timeline functions of ADR 0122.

**The lock is born in the LAST PR, and not before.** It is a web test
(`SessionPage.teto.test.ts`) that fails `SessionPage.tsx` at **1,000 lines or
more**, counting like `wc -l`, and that proves its own count at both edges (999
passes, 1,000 fails) — also measured by mutation, adding 166 lines to the real
file. It lives in web, and not in `scripts/ci/`, because it runs in the suite
that every PR touching the file already runs.

### Out of scope, on purpose

- **The TURN handlers** (`handleSend`, `handleCancel`, `handleReadiness`,
  `handleArchitectureReadiness`, `avisarSessaoEncerrada`) and the session
  lifecycle ones (`handleActivate`, `handleClose`, `handleRename`,
  `handleStartIdeation`) stay in `SessionPage`. The turn ones are the entry
  door of the cluster that ADR 0124 moved to `useTurnoDoAgente` and left called
  FROM HERE; removing them would mean deciding again where the turn lives, and
  that is not mechanical. The ceiling was reached without them.
- **`useTurnoDoAgente`, `useSessionReadiness`, `ContextAside`,
  `StructuredQuestionCard`, `StorySlide`** — already extracted, they do not
  change.
- **No dependency list is "fixed"**, no handler becomes a `useCallback`, no
  prop or function name changes. Each of those would be a change of behaviour
  or API, and each, if worthwhile, is its own PR that does not present itself
  as mechanical.

## Consequences

- **The file goes from 2,637 to 834 lines**, with 166 of slack until the lock.
  The slack is on purpose: the ceiling cannot be the next feature to fall into
  it. Whoever needs to pass 999 takes out a cut — there are candidates declared
  above —, never raises the number. Raising the ceiling is a new ADR that
  references this one.
- **The total number of lines GROWS**: the ten new files have 2,574 lines
  against the 1,803 that left, because each gained its own imports, a props or
  context block, and a header saying where it came from. It is the price of
  explicit boundaries, and it is the same that ADR 0125 accepted.
- **The largest new file has 861 lines** (`session-timeline-montagem.tsx`,
  almost all of the original `useMemo`). It does NOT get a lock here: the
  declared debt is `SessionPage.tsx`'s, and locking a file that was just born
  would be the mistake AT-031 named. If it grows, the next natural cut is one
  file per event family.
- **The `file:line` references to `SessionPage.tsx` in
  `docs/business-rules.md` and `docs/business-rules/autenticacao.md` moved** —
  many were already stale before this program. They are updated in PR 10, once,
  when the lines stop moving; in PRs 1–9 `verificarRefsComSimbolo` (in `warn`)
  warns.
- **`BRB-015` stops reproducing** in PR 10, and the `architecture.md` line that
  declared the regression closes with it, pointing to the lock.
- **The stacked PRs merge in order.** A feature PR touching `SessionPage.tsx`
  between two of them rebases onto the cut — the cost ADR 0122 had already
  accepted by not freezing the file.

## Discarded alternatives

- **Lock before decomposing**, with the ceiling at today's number, going down
  with each PR. Refused by the maintainer: a ceiling that follows the descent is
  a number to edit in every PR of the program, and a fixed ceiling above the
  file prevents nothing. The lock only has value as the NO to "it grew again",
  and that only exists after getting there.
- **A single PR.** Refused for the same reason as ADR 0122: 1,800 lines moved in
  one diff cannot be reviewed, and the file keeps receiving features.
- **Take the turn handlers along** to get further. Refused: it is the cluster
  ADR 0124 decided, and the ceiling did not need it.
- **One file per event type already in PR 2.** Refused for this program:
  breaking the `useMemo` into functions per event requires deciding each one's
  signature (the promotion batch and the loop's `continue` cross types), and
  that stops being moving. Moving the whole body first is what allows that cut,
  if it comes, to be reviewed on its own.
