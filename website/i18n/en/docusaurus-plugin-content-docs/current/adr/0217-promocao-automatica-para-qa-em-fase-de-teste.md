---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0217 — Automatic `dev` → `qa` promotion while QA is in a test phase

## Status

**Accepted.** 2026-10-15 (AT-555, owner decision of 15/10): *"To gain agility, an
auto-merge rule into qa whenever there is a merge into dev, and a notice that,
while it is in a test phase, qa will not yet be considered."*

Theme: `git`. Revises, without editing, ADR 0030's promotion flow (the promotion
merge as a manual act) and its approval ladder, only for the `dev` → `qa` pair
and only with the variable on. ADR 0073 (the published path names the
environment) does not change: what changes is how much `/brabo/qa/` publishes.

## Context

The `dev` → `qa` promotion was always manual: `promote.yml`
(`workflow_dispatch`) computes the version and opens the PR through
`BRABO_BOT_TOKEN`, and the owner approves and merges. With `qa` not yet used as a
validated environment, that step cost one human gesture per cycle without
protecting anything anyone consumed.

The repository has no required checks: `gh pr merge --auto` would merge at once,
without waiting for CI. Automating the merge requires the WAIT to be the
automation's.

## Decision

1. **Workflow `promote-auto-qa.yml`**, on `push` to `dev`, only with the
   repository variable `QA_FASE_DE_TESTE == 'true'`. It runs the SAME version
   computation (`scripts/ci/promote.ts`) and the SAME opening step
   (`scripts/ci/abrir-pr-de-promocao.sh`, extracted from `promote.yml`) to open
   or update the `dev` → `qa` PR through `BRABO_BOT_TOKEN`.
2. **Wait and merge** through `scripts/ci/promocao-automatica.ts`: it reads the
   head's check runs until ALL have finished; it merges with a merge commit (and
   `--match-head-commit`) only if none ended `failure`, `cancelled`,
   `timed_out`, `action_required`, `startup_failure` or `stale`. Zero checks
   means waiting, never merging. Any failure stops the promotion and writes in
   the job summary which check and the link. A 50-minute wait ceiling.
   Concurrency `promote-auto-qa`, no cancellation.
3. **An empty cycle is not a failure** in automatic promotion
   (`cicloVazioEhFalha`): a push to `dev` with no new work — a promotion merge, a
   backmerge, `dev` already equal to `qa` — exits 0 with `::notice::` and
   "nothing to promote: the cycle is empty" in the summary, without opening a PR.
   Recurring red would teach people to ignore red. In the manual `promote.yml` it
   is still a failure.
4. **Without `BRABO_BOT_TOKEN`, a visible failure**: the job exits red saying
   so. The default token would open the PR with checks in `action_required` and
   its merge would trigger neither `tag-release` nor `docs-deploy`.
5. **The ladder** (`scripts/ci/approval-ladder.ts`,
   `ehPromocaoAutomaticaDaFaseDeTeste`) waives approval ONLY when the pair is
   `dev` → `qa`, the variable is on and the PR's author is the
   `BRABO_BOT_TOKEN` user — resolved in the workflow through `gh api user` with
   the secret itself, never by a fixed name. The reason appears in the check's
   summary. `qa` → `main` and any other pair still require approval, in both
   modes.
6. **The notice**: the site published at `/brabo/qa/` gains a fixed
   `announcementBar`, and the automatic PR's body opens with the same text —
   *"Fase de teste: a QA é promovida automaticamente a cada merge na dev e ainda
   não é considerada ambiente validado."*

## Consequences

- Each merge into `dev` with green CI becomes a `-qa.N` tag (`tag-release` runs
  on the push to `qa`), and `N` now counts merges, not validation rounds.
- `/brabo/qa/` is republished on every merge into `dev`.
- The variable turns on and off without touching code: deleting it or changing
  the value goes back to the manual `promote.yml`, and the ladder again requires
  the owner.
- `qa` → `main` stays intact: manual, with approval, and the final tag is only
  born on the commit of the last `-qa.N`.
- If the `BRABO_BOT_TOKEN` user is the owner themselves, the ladder already
  passed by authorship (`solo` mode); the new waiver only changes the written
  reason.
- Declared price: `qa` stops being a validated candidate while the variable is
  on — which is exactly what the notice says.
