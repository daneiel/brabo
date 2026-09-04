# 0044 — Adoption of an existing repository, and the plan as a gate

## Context

The first dogfooding (Phase 10) only ran because someone inserted rows
by hand. P1 finding #1, verbatim from
`docs/missions/dogfooding-mission.md:638`:

> The product doesn't know how to point a project at an existing
> repository. `createRepo` is unconditional; `getRepo` exists and is
> called by no use case; the DTO has no field for `externalId`.

The mission procedure (`:102-134`) describes the workaround: an
`INSERT` into `project_repositories` and into `repo_bootstraps`, the
latter "marked as converged — so the product doesn't try to resume a
bootstrap that never ran." In other words: using Brabo on a repository
that already existed required lying to the database about a bootstrap
that never happened.

Three things that already existed shaped the solution:

1. **The dry-run was already written, nobody had just called it that
   way.** `BootstrapStep.check(ctx)` (Phase 2,
   [ADR 0005](0005-repo-bootstrap-idempotent-steps.md)) re-reads the
   REMOTE state and returns the mutations still pending. It's called
   on every run, and that's what gives idempotency and resumability. A
   plan is that same list **without** calling `run()`.
2. **Branch protection, in the contract, is a boolean.**
   [ADR 0028](0028-protecao-de-branch-divergencia-entre-providers.md)
   deliberately refused to give `ProtectBranchInput` configuration
   ("it would create a vocabulary that only one of the providers knows
   how to honor, and the other would have to silently ignore"), leaving
   a normalized `ProtectionPolicy` for when there was real need. The
   contract only promises the observable: `listBranches` returns
   `protected: true`.
3. **The bootstrap already didn't overwrite protection.**
   `bootstrap-steps.ts:112` skips a branch with `protected: true` since
   Phase 2. What was missing wasn't the guard — it was **making what
   it would do visible and explicitly approved**.

It's worth noting that ADR 0028 does **not** say "never overwrite
existing protection." That rule is born here; 0028 is the reason it
can only operate at the boolean level.

## Decision

### `origin` as an axis, on both tables

`project_repositories.origin` and `repo_bootstraps.origin` (`created` |
`adopted`), written explicitly by whoever writes them — not by the
column default, so adoption is a visible choice in the code and not an
absence ([RN-046](../business-rules/custo.md#rn-046)). Migration `0031`'s
backfill is deliberately blind: adoption didn't exist before it, so
every pre-existing row was created by Brabo by definition, and there's
no case to misclassify — unlike `0026`'s directed backfill.

### The plan lives on the cursor, not on a new table

`repo_bootstraps` gains `plan` (jsonb), `plan_generated_at`,
`plan_decision`, `plan_decided_at`, `plan_decided_by`.

The plan is a **snapshot**, not a log: same owner, same key and same
lifetime as the cursor ADR 0005 already defined. A dedicated table
would suggest a queryable history of old plans — and the history
already lives in `session_events` and `proposed_actions`, in two
narratives that don't need a third.

### The gate sits BEFORE the runner

A null `plan_decision` is the state that matters: plan generated,
nothing decided, **nothing runs**. There's no filter inside the
executor — the `BootstrapRunner` is the one from Phase 2, extracted
verbatim (128 lines checked byte by byte) to be shareable, and simply
isn't called. Combined with the `:112` guard, there is no code path
that protects a branch outside an approved plan
([RN-045](../business-rules/custo.md#rn-045)).

Approval is **all-or-nothing**: selective approval would break the
`dev←main, qa←dev, rc←qa` cascade (approving `qa` without `dev` is
unsatisfiable) and would require rewriting the runner. What runs is
the plan **re-derived** by `check()` at execution time — equal to or
smaller than what was displayed.

**Correction made during implementation:** the first version promised
LESS than it would execute. `protect_branches.check()` reads the
current state, and a branch the plan itself is about to create (`rc`,
in the Phase 10 fork) doesn't exist yet to be listed as unprotected —
but it would exist at execution time, and would get protected. The
plan gained a pass that projects the protections of the planned
branches. Promising more is acceptable (the runner skips whatever is
already protected); promising less would nullify the rule precisely in
the most common adoption case.

### "Adopt as-is" doesn't tamper with the cursor

Dismissing the bootstrap records `plan_decision = 'as_is'` and an
event — and leaves the cursor where it is. Moving the cursor to "last
step, done" would turn Phase 10's manual seed into official behavior:
the cursor would say six steps ran when none did. What makes the
project operable is the recorded decision, which
`deriveProvisioningStatus` respects. The plan stays stored as evidence
of what was deliberately not applied.

Hence also the new `awaiting_plan_decision` status: without it, an
adopted project would stay `provisioning` forever, with the UI polling
for work that doesn't exist.

### A separate route, not `mode` in the DTO

`POST .../repository/adopt` instead of a discriminated DTO:
`@RequireRole` and OpenAPI are per route, `route-surface.spec.ts`
classifies by route, and the responses actually differ (creating
returns the bootstrap's cursor; adopting returns the plan). A DTO with
`@ValidateIf` would produce a weak schema in the generated document —
exactly what that spec exists to catch.

### Why it does NOT go through `decide()`/`ProposeActionUseCase`

The generic approval pipeline decides **per mutation**. Here the
decision is **per plan**: the user approves a coherent set, not
fourteen actions one by one. Besides, the bootstrap, since Phase 2, is
born `auto_approved` and narrates in a dedicated session, outside
`decide()` — and each approved mutation still becomes a
`proposed_action` when the runner runs, so traceability doesn't move
elsewhere.

## Consequences

- `getRepo` stops being an unused import: it existed since Phase 2,
  covered by the contract suite, and had never been called by any use
  case.
- Provider errors (404 vs 403) already arrived distinct; what was
  missing was for the **message to say what to do**, which is
  opposite in each case — checking the identifier vs. swapping the
  credential. Collapsing both into "adoption failed" would be the
  diagnosis-by-elimination [ADR 0020](0020-destravar-gates-qa-secops.md)
  forbids repeating.
- **The GitProvider contract suite stayed untouched**, and no new
  method entered the contract. It was an explicit acceptance criterion,
  and it's what keeps the divergence between providers where ADR 0028
  left it.
- **A hole closed along the way:** `ProvisionRepositoryUseCase.execute`
  on an adopted project used to fall into the "both already exist"
  branch and would run the bootstrap on a third party's repository
  without a plan. Now it refuses with 409.
- The wizard gains a step before everything, and adoption **skips**
  the branch-policy step: promising the template for a repository that
  already has its own policy would be a lie. No UI component beyond the
  plan screen.
- The plan screen renders `BootstrapSteps` itself instead of navigating
  to `ProvisioningPage` — that one dispatches `provisionRepository` on
  mount, which would **create** a repository.

## What's left for later

- **Normalized `ProtectionPolicy`** (deferred by ADR 0028). While it
  doesn't exist, divergence in protection CONFIGURATION is invisible: a
  branch with partial protection counts as unprotected and can be
  overwritten — within an approved plan. It's dogfooding's P1 finding
  #2, **not fixed here**.
- **The `rc` that Phase 6's policy doesn't use** (finding #3, P2): the
  template still creates and protects `rc`. Out of scope for 12a.
- **Acceptance against the real fork**: `adopt-repository.smoke.spec.ts`
  exists, is READ-ONLY and runs gated by `ADOPT_TEST_REPO` +
  `GITHUB_TEST_TOKEN`. It never approves — approving would mutate a
  real repository, and that decision is the human gate, not a test.
  "Project operable afterward" remains a manual checklist.
- **The dogfooding harvest doesn't exist.**
  `docs/explanation/primeiro-dogfooding.md` is cited by CLAUDE.md and
  was never written; what exists is the skeleton
  `docs/missions/colheita-esqueleto.md`. The source cited here is
  `docs/missions/dogfooding-mission.md`. Phase 10's ADR is also still
  open.
- **Adoption doesn't migrate any data** (issues, historical PRs) — it's
  access and policy, only (CLAUDE.md, Phase 12).

References [ADR 0005](0005-repo-bootstrap-idempotent-steps.md), where
the `check()` that became a dry-run comes from, and
[ADR 0028](0028-protecao-de-branch-divergencia-entre-providers.md),
which defines why "divergent protection" here can only be boolean.
