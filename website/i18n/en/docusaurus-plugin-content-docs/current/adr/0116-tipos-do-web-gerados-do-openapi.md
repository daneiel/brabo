# ADR 0116 — `ActionType` (and future types) generated from the OpenAPI contract, not hand-copied

- **Status:** Accepted
- **Date:** 2026-08-28
- **Context:** pays down the tech debt named in `docs/architecture.md` ("The
  `ActionType` union is a copy, and a copy ages") and tracked in
  `docs/explanation/backlog.md`; the union has already diverged from the
  backend twice in production
- **Does not replace:** `apps/web/src/lib/api-types.ts` — most of it stays
  hand-written; see Decision, item 3

## Context

`apps/web/src/lib/api-types.ts` (~1600 lines) mirrors entities from
`apps/api/src/domain/**` by hand, on purpose: `apps/web` does not depend on
server-side code, and the file's own header says so. That has been the right
call for most of the file — it is small, stable, UI-shaped types. It has been
the WRONG call for one type in particular: `ActionType`.

`ActionType` (`apps/api/src/domain/actions/decide.ts`, `ACTION_TYPES`) is not
UI-shaped — it is the exhaustive list `decide()` switches on, and every
consumer downstream (`ApprovalCard`, `lib/aprovacoes.ts`'s
`VERBO_DA_ACAO`/`FRASE_DA_ACAO` records) needs it complete or it silently
degrades. It diverged from the hand-copied union in `api-types.ts` TWICE in
production, both times without the compiler noticing, because `apps/api` is
not a dependency of `apps/web`:

1. The three Gitflow bootstrap types (`git_repo_create`, `git_branch_create`,
   `git_branch_protect`) were missing from the web union. `ApprovalCard`'s
   `ACTION_ICON[actionType]` returned `undefined` for them and crashed the
   whole session screen — every project bootstrapped against a real provider
   had an unopenable session.
2. `parallelize`/`raise_max_parallel` shipped in FASE 14d and nobody
   remembered to add them to the web copy.

The only thing catching this today is `apps/web/src/lib/aprovacoes.test.ts`,
which reads `decide.ts`'s source text at test time and fails a type with no
sentence. That is a real safety net, but it is a runtime one, discovered at
`pnpm test`, not a structural one the compiler enforces on every edit.

Separately, `apps/api/src/scripts/export-openapi.ts` already exports the
full OpenAPI document, and `docs/reference/openapi.json` is already a
generated, drift-checked artifact (`docs/.docmap.yml`, rule
`referencia-openapi`; `docs:generate`/`docs:check`). `ACTION_TYPES` is
already exposed there as a real JSON Schema `enum` — three DTOs
(`ProposeActionDto`, `CreateActionInternalDto`, `ProposedActionResponseDto`)
declare `@ApiProperty({ enum: ACTION_TYPES })` on their `actionType` field,
so the 17 values already round-trip through the contract the web already
has to trust for everything else.

## Decision

### 1. `openapi-typescript` (`^7.13.0`) generates `apps/web/src/lib/api-types.generated.ts` from `docs/reference/openapi.json`

Chosen over a hand-rolled generator because turning a JSON Schema `enum`
(and, if the file ever grows, whole request/response shapes) into a
TypeScript union is exactly the problem the library solves, and it is the
de facto standard for it — this is the "dependência pesada" the
`CLAUDE.md` rule asks to be justified, and the justification is the two
production incidents above, not convenience.

The input is the COMMITTED `docs/reference/openapi.json`, not a fresh
`export-openapi.ts` run piped in. That file already has an enforced
freshness invariant (`docs:generate --check`, run in
`.github/workflows/docs-check.yml`'s `guardiao` job) — reading the live
export from `apps/web` would mean spinning up the whole `AppModule` from
a package that has no NestJS dependency and no reason to gain one, to
re-derive a guarantee that already exists one door down.

Two npm scripts, in `apps/web/package.json` (not `apps/api`): the CONSUMER
decides when to regenerate, and the source is a file already sitting in
the repo, not a live api process — `apps/web` needing the api's dev server
running to get its own types would be a worse dependency than the one this
ADR removes.

- `openapi:types` — writes `src/lib/api-types.generated.ts`.
- `openapi:types:check` — the library's native `--check` mode: recomputes
  and compares, never writes. Wired into `docs-check.yml` right after the
  existing `openapi.json` freshness step, and depending on it running
  first — `--check` here can only be trusted once `openapi.json` itself
  is known fresh.

### 2. `docs/reference/openapi.json` freshness gate: reused, not duplicated

`docs/.docmap.yml`'s `referencia-openapi` rule already watches every DTO
and controller and requires `openapi.json`/the MDX manifest to move with
them. `apps/web/src/lib/api-types.generated.ts` was added to the SAME
rule's `docs:` list instead of a new rule with a copy of the same `watch:`
— it is generated FROM `openapi.json`, by the same trigger, and a second
rule would only ever drift from the first one's glob list.

### 3. Only `ActionType` migrates in this change — not the other ~1600 lines

`api-types.ts`'s own header already draws the real line: types genuinely
shared between api and web (`HealthStatus`, `GitProviderName`) live in
`packages/shared`, not here; everything else in the file is a
domain-entity mirror maintained by hand. Regenerating the whole file in
one pass, without going consumer-by-consumer, would be exactly the kind
of change `CLAUDE.md` warns against ("Não refatorar código de fase
concluída sem pedido explícito") applied to 1600 lines nobody re-read for
this PR. `ActionType` is the one type with a demonstrated, repeated,
production cost to being hand-copied; it moves. The remaining lines of
`api-types.ts` are untouched and stay hand-written, re-evaluated
type-by-type in future PRs the same way this one was.

`api-types.ts` now does:

```ts
import type { components } from './api-types.generated';

export type ActionType =
  components['schemas']['ProposedActionResponseDto']['actionType'];
```

`ProposedActionResponseDto` was picked over `ProposeActionDto` /
`CreateActionInternalDto` (which declare the identical 17-value enum)
because it is the response shape the web actually reads on every
approvals screen; the three are the same union today, and NestJS Swagger
does not emit a single named `ActionType` schema to point at instead — it
inlines the enum per-DTO, since none of the three uses `@ApiExtraModels`/
a shared enum name. Naming the enum globally in the OpenAPI document is
future work, not required for this fix: `ProposedActionResponseDto`'s
`actionType` is a plain string-literal union, structurally identical to
the type it replaces.

### 4. `aprovacoes.test.ts` (FASE 19) stays — its job changed, it didn't disappear

The test used to do two things: prove every backend `ActionType` has a
verb/sentence entry (EXISTENCE), and prove that entry is non-empty,
in Portuguese, and correctly punctuated (CONTENT). Existence is now also
caught by the compiler — `Record<ActionType, string>` in
`lib/aprovacoes.ts` fails to compile the moment a value from
`api-types.generated.ts` has no key, before `pnpm test` ever runs. That
makes the test's existence check REDUNDANT with a stronger, earlier
guarantee — but its content assertions (frase length, trailing period, no
raw `snake_case` leaking into Portuguese prose) are not something a type
system checks, and stay exactly as valuable as before. Removing the test
would trade a belt-and-suspenders situation for no suspenders; it stays,
documented here as partially superseded rather than quietly kept for
inertia.

## Consequences

**For**

- The class of bug that has hit production twice (`ApprovalCard` crashing
  on an `ActionType` the web didn't know about) is now caught by `tsc`,
  on every PR that touches `decide.ts` and regenerates `openapi.json` —
  not discovered live.
- `docs-check.yml` fails LOUDLY (`::error::`) with the exact command to
  run, the same UX as every other generated artifact in the repo.
- No change to any HTTP contract, DTO, or runtime behavior — this is a
  types-only, dev-time change.

**Against**

- A second devDependency surface for `apps/web` (`openapi-typescript`)
  purely for codegen; it never ships to the browser bundle
  (`api-types.generated.ts` is source, not the library itself).
- `api-types.generated.ts` is ~18k lines (the FULL OpenAPI surface, every
  path and DTO) even though only one type is consumed from it today —
  `--root-types`/schema filtering could shrink this later if it becomes a
  real cost (it is not loaded at runtime; it is a `.d.ts`-shaped source
  file `tsc` reads and vite never bundles).
- `api-types.ts` is now, for one type, a re-export rather than a
  definition — a reader has to follow one more hop
  (`api-types.ts` → `api-types.generated.ts` → `openapi.json` →
  `decide.ts`) to find the source of truth. The comment at the import site
  in `api-types.ts` names every link in that chain for exactly this
  reason.

## Alternatives considered

**Regenerate all of `api-types.ts` from the OpenAPI document in one PR.**
Rejected — the file is not a pure entity mirror (`packages/shared` already
carves out what's genuinely shared), and a wholesale replacement without
tracing each of ~1600 lines to its consumers would risk silent shape
changes nobody reviewed for. Migrating type-by-type, starting with the one
with a proven cost, is slower but each step is checkable.

**Generate from a live `export-openapi.ts` run instead of the committed
`openapi.json`.** Rejected in item 1 — would require `apps/web` to either
depend on `apps/api`'s NestJS runtime or shell out to it, to re-derive a
freshness guarantee `docs:check` already provides for free.

**Drop `aprovacoes.test.ts` now that the compiler covers exhaustiveness.**
Rejected in item 4 — the content assertions (frase quality) are not
type-level properties, and removing the file would also remove the
governing comment explaining WHY the sentence-per-type rule exists
(RN-096).

## References

- `apps/api/src/domain/actions/decide.ts` — `ACTION_TYPES`, the canonical
  source
- `apps/web/src/lib/api-types.ts` — the re-export, and the comment naming
  the full chain
- `apps/web/src/lib/aprovacoes.ts` / `aprovacoes.test.ts` — the consumer
  whose exhaustiveness is now compiler-checked
- `docs/.docmap.yml`, rule `referencia-openapi` — the shared freshness
  gate
- `.github/workflows/docs-check.yml` — `openapi:types:check`, wired after
  the `openapi.json` freshness step
- `docs/architecture.md` — "The `ActionType` union is a copy, and a copy
  ages"
- [RN-096](../business-rules.md#rn-096) — every `ActionType` needs a
  Portuguese sentence
