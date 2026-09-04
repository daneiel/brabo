# ADR 0125 — `ProjectSettingsTab.tsx` split into one file per section, behind a barrel

- **Status:** accepted
- **Date:** 2026-08-30
- **References (without editing):**
  [ADR 0121](0121-schema-dividido-por-agregado-de-dominio.md) (the closest
  sibling — a barrel-backed decomposition whose acceptance bar was "the
  importers change nothing"; this ADR reuses that shape on the web side),
  [ADR 0122](0122-sessionpage-dividido-em-cinco-prs.md) and
  [ADR 0124](0124-hook-do-canal-de-turno-do-sessionpage.md) (both named this
  file and both explicitly deferred it — "a fully separate, still-open scope
  decision"; this ADR is that decision, taken).

## Context

`apps/web/src/routes/ProjectSettingsTab.tsx` is 2 532 lines and 89.9 KiB.
It is the **last** open half of the technical-debt row in
`docs/architecture.md` and `docs/explanation/backlog.md`:

> Decompose `SessionPage.tsx` / `ProjectSettingsTab.tsx` | G |
> `SessionPage.tsx` was 169 KiB with 25 test files importing it;
> `ProjectSettingsTab.tsx` is 90 KiB

The `SessionPage.tsx` half closed across seven PRs and two ADRs (0122, 0124).
Both of those ADRs named `ProjectSettingsTab.tsx` in their "out of scope"
sections rather than quietly narrowing the row — which is exactly why it is
still here, and why closing it needs a number of its own instead of a
drive-by refactor.

**This file is structurally much cleaner than `SessionPage.tsx` ever was**,
and that difference is the whole reason this is one PR instead of five:

1. **The parent holds nothing.** `ProjectSettingsTab` (lines 217–239 before
   this change) is 17 JSX children and a props interface. No hook, no
   `useQuery`, no `useQueryClient`, no `useTranslation`, no role check, no
   `useState` — nothing at all to distribute or to reconcile against React's
   render cycle.
2. **No section takes more than `{ projectId: string }`,** and two
   (`MatrixSection`, `CredentialsSection`) take no props at all. There is no
   prop-drilling of data, no context, no shared `useState`, and no callback
   passed down. Each section calls its own hooks and owns its own queries.
3. **11 of the 17 sections are already exported** — the test suite had
   already drawn most of the boundary, the same argument ADR 0122 made for
   `SessionPage`'s five timeline helpers.

The duplication between sections is **deliberate, and stays**:
`useTranslation('settings')` appears ~14×, `useQueryClient()` 11×,
`useToast()` 10×, `useCurrentWorkspaceWithRole()` 5×, and
`useQuery({ queryKey: ['project', projectId] })` 7×. React Query dedupes
those at runtime — that is what makes the pattern safe, and what makes each
section independently mountable. Hoisting them into a shared parent or a
context would be a behavior change dressed as cleanup, and it is not done
here.

## Decision

One file per section under `apps/web/src/routes/settings/`, plus one shared
helper module — 18 new files — and **`ProjectSettingsTab.tsx` stays at its
current path as the entry point and barrel**.

### The barrel is load-bearing, not decorative

Three test files depend on the path or the export names, and all three must
pass **unedited** — that is this PR's entire acceptance bar:

- `apps/web/src/routes/ProjectSettingsTab.test.tsx` (1 356 lines, 62 `it`s)
  imports **11 named exports** from `./ProjectSettingsTab`.
- `apps/web/src/routes/ProjectPage.test.tsx` and
  `apps/web/src/routes/project-tabs.test.tsx` both
  `vi.mock('./ProjectSettingsTab', …)` **by path** — moving or renaming the
  file breaks both mocks silently.
- `apps/web/src/routes/ProficiencySection.test.tsx` imports
  `ProjectSettingsTab` itself and renders it, making it the only test that
  mounts all 17 sections at once — the end-to-end proof that the barrel is
  wired in the right order with the right props.

Same reasoning as ADR 0121's `db/schema.ts`: the old path keeps working, so
nothing downstream changes. Where 0121 used `export *`, this barrel names
each export explicitly, because a settings section is a React component with
a specific prop shape, not a table — an explicit list is what lets the
compiler catch a section that stops matching its call site. New sections go
into the barrel **in subject position, never appended at the end** — the
same rule 0121 set, and here the position is literal: the barrel's import
list, its re-export list and its JSX all follow render order.

### The 17 files, in render order

| file | lines | exported by the barrel |
|---|---|---|
| `settings/RepositorySection.tsx` | 80 | no |
| `settings/ExecutionSection.tsx` | 88 | yes |
| `settings/ExecutionModeSection.tsx` | 174 | yes |
| `settings/ParallelismSection.tsx` | 121 | yes |
| `settings/BudgetSection.tsx` | 132 | yes |
| `settings/PromotionSection.tsx` | 85 | yes |
| `settings/MelhoresModelosPorCapacidadeSection.tsx` | 194 | yes |
| `settings/ModelsSection.tsx` | 334 | yes |
| `settings/AreaModelsSection.tsx` | 143 | yes |
| `settings/CatalogoDeModelos.tsx` | 17 | no |
| `settings/MembersSection.tsx` | 184 | no |
| `settings/PersonalAccessTokensSection.tsx` | 284 | yes |
| `settings/ProficiencySection.tsx` | 256 | yes |
| `settings/InstructionVersionsSection.tsx` | 161 | no |
| `settings/MatrixSection.tsx` | 65 | no |
| `settings/CredentialsSection.tsx` | 269 | yes |
| `settings/GastoDasChaves.tsx` | 22 | no |
| `settings/shared.ts` | 30 | — |

A subfolder, not 18 siblings in `routes/`: the precedent is `routes/code/`,
and 17 files for one tab is precisely the size at which a folder earns
itself. This differs from ADR 0122's PRs 2–4, which put single extracted
components next to `SessionPage.tsx` — one or two siblings do not justify a
folder; seventeen do.

### Exported by its own file, private to the barrel

The 6 sections that are private today (`RepositorySection`,
`CatalogoDeModelos`, `MembersSection`, `InstructionVersionsSection`,
`MatrixSection`, `GastoDasChaves`) each gain an `export` **on their own
module** — that is a mechanical consequence of the move, not a decision: the
barrel cannot compose a function it cannot import.

They are **not** re-exported by the barrel. That part *is* a decision, and
the reason is that the barrel's export list is the public surface of this
tab, and a mechanical move should not widen it. Making the barrel uniform
across all 17 would have been defensible too, but it would mean this PR
changed something observable — the module's export set — while claiming to
change nothing. A later PR that genuinely needs one of the 6 imports it from
its own file, which is now possible and was not before.

### Shared helpers: only what more than one section calls

Twelve module-scope helpers moved. The rule applied is mechanical: **a
helper used by exactly one section moves into that section's file; a helper
used by two or more goes to `settings/shared.ts`.** Verified by grep, not
assumed — and the check corrected one expectation: `iniciaisDe`,
`PARES_DE_GRADIENTE` and `gradienteDe` are called **only** by
`MembersSection`, never by `ProficiencySection`.

- `settings/shared.ts` (2 helpers): `ORIGIN_TONE` (`ModelsSection` +
  `AreaModelsSection`) and `formatarCustoMicros` (`ModelsSection` +
  `BudgetSection`).
- Into their single caller's file (10): `USO_TONE` →
  `MelhoresModelosPorCapacidadeSection`; `MATRIX_ROWS` → `MatrixSection`;
  `iniciaisDe`, `PARES_DE_GRADIENTE`, `gradienteDe` → `MembersSection`;
  `siglaDoConector`, `COR_DO_CONECTOR` → `CredentialsSection`; `LEVEL_TONE`
  and `identidadeDe` → `ProficiencySection`;
  `DEFAULT_MAX_CONSECUTIVE_BLOCKED` → `ExecutionSection`;
  `MODOS_DE_EXECUCAO` → `ExecutionModeSection`.

A two-symbol `shared.ts` is small on purpose. The alternative — one shared
module holding all twelve — would put ten helpers one indirection away from
their only reader for no benefit, and would make the next person guess
whether a given constant is shared. Two symbols in `shared.ts` means exactly
what it says: these two, and only these two, are actually shared.

### The CSS module stays single and shared

`ProjectSettingsTab.module.css` keeps its current path and is imported by
all 15 section files that use it (`CatalogoDeModelos` and `GastoDasChaves`
render only a delegate component and reference no class). One stylesheet,
fifteen importers, where before there was one.

This is the same answer ADR 0122 gave for `SessionPage.module.css`, and for
the same reason: there was never a second copy, so there is nothing to
drift. Forking the file per section would create fifteen chances for the
`.section`/`.sectionHead`/`.title`/`.eyebrow` frame — which every section
renders identically — to diverge, in exchange for nothing.

## Consequences

- **`ProjectSettingsTab.tsx` goes from 2 532 lines / 89.9 KiB to 77 lines /
  4.1 KiB.** The 17 sections plus `shared.ts` total 2 639 lines across 18
  files, the largest being `ModelsSection.tsx` at 334. The growth over the
  original (2 532 → 2 716 including the barrel) is entirely import headers
  and the barrel itself; not one line of a section body changed.
- **This closes the last declared open technical-debt item in
  `docs/architecture.md`.** The row that named `SessionPage.tsx` and
  `ProjectSettingsTab.tsx` closes on both halves; the remaining rows in that
  table are other debts (the api↔engine four-file contract, the
  `TerminalExecutor` sandbox, Phase 4a's unclosed criterion), not this one.
- **The acceptance bar is zero observable behavior change**, proven by the
  full web suite — 142 files, 1 537 tests — passing with **zero test files
  edited**, including the three that constrain the path and the export
  names. A mechanical check backs the review: every block in every new file
  was matched verbatim against the pre-change file from `git show dev:…`,
  and every non-blank line of the original from the import header down was
  confirmed to land either in a section file or in the barrel. The only
  edits the move made are the added `export` keywords listed above and the
  per-file import headers.
- **Two people can now edit two settings sections without touching the same
  file** — the same benefit ADR 0121 claimed for the schema, at 17 units
  instead of 16.
- **Four UI improvements land in these same files in later PRs of this same
  effort** (the accepted 8-PR plan this is PR 0 of): a table of contents
  with anchors for the tab, one unified phrasing for inherited values across
  the four places that word it differently, save-per-section granularity for
  `ParallelismSection`/`BudgetSection`/`CredentialsSection` only (the three
  autosave sections keep autosave, deliberately), and a readable
  model-origin chain in `ModelsSection`/`AreaModelsSection`. **None of them
  is in this PR.** Doing the move first is what makes each of those four a
  small diff in one named file instead of a large diff in a 2 500-line one —
  which is why the plan ordered it first.
- **The duplication stays, and stays deliberate.** Fourteen
  `useTranslation('settings')` calls are now spread across fourteen files
  instead of concentrated in one, which makes the pattern *more* visible,
  not less. It is not a defect to fix later: the sections are independently
  mountable precisely because none of them depends on a parent having called
  a hook first.

## Discarded alternatives

- **Splitting into five PRs, like ADR 0122 did for `SessionPage.tsx`.**
  Rejected: 0122's five-PR shape was forced by active churn (50 commits,
  25 dependent test files, interleaved control flow) and by PR 5 not being a
  file move at all. Here every section is already independent, the parent
  holds no state, and each file is a contiguous byte-identical block — the
  churn argument does not apply and five PRs would be five reviews of the
  same trivial diff.
- **Deleting `ProjectSettingsTab.tsx` and pointing `project-tabs.ts` at a
  `settings/index.tsx`.** Rejected on evidence, not taste: two test files
  `vi.mock` the module by path and a third imports 11 names from it. The
  route would still work; three test files would break for a rename that
  buys nothing.
- **Hoisting the shared queries (`['project', projectId]`, `useToast`,
  `useTranslation`) into the parent and passing results down.** Rejected:
  it converts 17 self-sufficient components into 17 components with a
  parent contract, which is a design change, not a move — and React Query
  already dedupes the fetches, so the "duplication" costs nothing at
  runtime. It would also make each section unmountable in isolation, which
  is exactly how `ProjectSettingsTab.test.tsx` exercises 11 of them today.
- **Putting all twelve module-scope helpers in `shared.ts`.** Rejected: ten
  of the twelve have exactly one caller, and a shared module that holds
  private helpers stops answering the question it exists to answer.
