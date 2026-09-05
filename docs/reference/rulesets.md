---
id: rulesets
title: Repository rulesets
sidebar_label: Rulesets
sidebar_position: 8
description: The exact configuration of the rulesets for the three permanent branches and tags, for manual application — the repository versions the source, GitHub receives the application.
keywords: [rulesets, branch protection, required checks, tags, release]
---

# Repository rulesets

This page is the **versioned source** of the protection. Applying it on
GitHub is a **manual** step — the repository has no way to protect itself,
and this asymmetry is intentional: whoever loosens the protection has to be
a person, with a record.

The policy that these rules apply is in
[Branch policy](../explanation/branching-policy.md).

> **Current state:** `gh api repos/daneiel/brabo/rulesets` returns **0**.
> Nothing applied yet. Until then, everything here is declared intent, not
> real protection.

## Prerequisite: the three branches must exist

The ladder has three rungs, and a ruleset can't target what doesn't exist.

```bash
git fetch origin
git push origin origin/dev:refs/heads/qa
```

`dev` and `main` already exist. `qa` is born from `dev` — the ladder starts
empty and is filled by promotions.

> The `rc` branch was **removed** from the ladder. If it still exists on the
> remote of an old clone, delete it: `git push origin --delete rc`. A
> permanent branch that isn't in the ladder is an invitation for a PR to
> target a rung that no longer exists.

## Ruleset 1 — the three permanent branches

**Name:** `permanentes`
**Enforcement:** `Active`
**Target:** Branch → `Include by pattern`, three entries: `dev`, `qa`, `main`

> One ruleset for all three, not three rulesets: the requirement is
> identical across all of them. What differs between rungs is **who
> approves**, and that is decided by `approval-ladder` based on the
> destination, not by the protection.

### Rules to check

| rule | value | why |
|---|---|---|
| **Restrict deletions** | ✅ | deleting `main` by accident is irreversible through the interface |
| **Block force pushes** | ✅ | force-pushing to a permanent branch rewrites what has already been promoted; the rung's tag would end up pointing to a nonexistent commit |
| **Require a pull request before merging** | ✅ | this is the central rule: no change gets in without a PR |
| ↳ Required approvals | **0** | the counting is done by `approval-ladder`, which knows the mode and the destination. GitHub's native number doesn't distinguish `dev` from `main` |
| ↳ Dismiss stale approvals on push | ✅ | approval of an old commit doesn't count — what was approved isn't what's going to be merged |
| ↳ Require review from Code Owners | ✅ | `CODEOWNERS` sets the owner as reviewer for everything |
| **Require status checks to pass** | ✅ | see the list below |
| ↳ Require branches to be up to date | ❌ | would force a rebase on every merge into `dev`; CI already runs on the merge commit |
| **Block merge queue** | — | not used |

**Required approvals = 0 is not a loosening.** GitHub can only count; it
doesn't know that `main` requires PO + manager and `dev` requires one dev,
nor that in `solo` mode the owner's own PR passes without review. Setting
`1` here would **break** solo mode: the owner can't approve their own PR
through the interface, and the PR would stay stuck forever. The real
requirement lives in `approval-ladder`, which is a required check — and a
required check can't be cheated.

### The two configurations, side by side

The ruleset is the **same** in both modes. What changes is the variable —
and that's why the migration doesn't go through Settings → Rules.

| | `solo` (today) | `community` (future) |
|---|---|---|
| **Required approvals in the ruleset** | **0** | **0** |
| who requires it | the `Escada de aprovação` check | the same check |
| variables | `APPROVAL_MODE=solo`, `OWNER_HANDLE` | `APPROVAL_MODE=community`, `APROVADORES_*` |
| `dev` | 1 from the owner | 1 × devs |
| `qa` | 1 from the owner | 2 × devs |
| `main` | 1 from the owner | 1 × PO + 1 × management |
| the owner's own PR | passes without review | follows the ladder like anyone else's |
| distinct people | suspended | applies on `main` |

**Required approvals stays at 0 in both cases, and that's deliberate.**
GitHub can only count: it doesn't distinguish `dev` from `main`, doesn't
know about roles, and doesn't know that in solo mode the owner's own PR
passes without review. Setting `1` there **would break solo mode** — the
owner can't approve their own PR through the interface, and every one of
their PRs would stay stuck forever. The real requirement lives in the
check, which is required and can't be cheated.

Copy-paste to activate each mode:

```bash
# solo — what's in effect today
gh variable set APPROVAL_MODE --body solo
gh variable set OWNER_HANDLE  --body daneiel

# community — fill in the lists BEFORE flipping the switch
gh variable set APROVADORES_DEVS   --body "ana,bruno,carla"
gh variable set APROVADORES_PO     --body "paula"
gh variable set APROVADORES_GESTAO --body "gustavo"
gh variable set APPROVAL_MODE      --body community
```

### Required checks

**Exact** name, as GitHub registers it (it's the job's `name:`, not the
workflow's):

The duration column is **measured**, not estimated — three real runs, cold
and warm cache. It exists so that "optimizing CI" starts from the number,
not the guess.

| check | workflow | cold | warm |
|---|---|---|---|
| `Build, scan e smoke das imagens de produção` | `ci.yml` | **295s** | 109s |
| `Testes TS (api + web)` | `ci.yml` | 159s\* | **159s**\* |
| `Testes do engine (ExUnit)` | `ci.yml` | 124s | 39s |
| `Auditoria de dependências` | `ci.yml` | 99s | 85s |
| `Lint` | `ci.yml` | 66s | 69s |
| `Drift, gerados e build` | `docs-check.yml` | 53s | 51s |
| `Manifests de Kubernetes` | `ci.yml` | 14s | 13s |
| `Gitleaks no repositório` | `ci.yml` | 5s | 7s |
| `Política de branches` | `pr-police.yml` | 7s | 7s |
| `Escada de aprovação` | `approval-ladder.yml` | 13s | 15s |
| `Check de promoção` | `promotion-check.yml` | 9s | 9s |
| `Backmerge gate` | `backmerge-gate.yml` | 7s | 7s |

**`ci.yml` is already 100% parallel** — none of its jobs have `needs:`.
There's no serial graph to untangle, and the full PR verdict costs the
SLOWEST job, not the sum (which is ~12min of CPU). Anyone wanting to
shorten the PR has two targets, and only two:

- **cold cache: the images job**, where 195s of the 295s are the
  `docker buildx bake` — the single largest item in all of CI, 3× the
  second. The bakefile already builds all four in parallel with `type=gha`
  cache per image, and the comment at its top measures why breaking it
  into a job matrix would be WORSE: 1.7 GB of images per artifact costs
  more than the build, and the smoke test needs all four on the same
  daemon;
- **warm cache: `Testes TS`**, where 91s of the 159s were
  `pnpm --filter api test`, serialized by `fileParallelism: false` in
  `apps/api/vitest.config.ts` because the ~80 specs that touch the database
  shared ONE `brabo_test` and ran TRUNCATE between tests — arrivals in
  parallel would collide. That's fixed now
  (`perf/banco-por-worker-nos-testes-da-api`, CHANGELOG): each Vitest worker
  gets its OWN database instead — `test/support/global-setup.ts` migrates a
  TEMPLATE once and clones one database per worker via
  `CREATE DATABASE ... TEMPLATE` (cheap, a page copy, not a migration
  replay), `test/support/test-db-name.ts` resolves which one a given spec
  connects to from `VITEST_POOL_ID`, and `vitest.config.ts` flips
  `fileParallelism: true` with `maxWorkers: 4` (fixed at the runner's 4
  vCPU, not auto-detected — the number has to be the SAME on a dev machine
  with more cores and on the runner, or the locally measured behavior isn't
  what runs there). Measured locally: the api suite's own duration dropped
  from 792.58s to 471.23s on a clean run (~40%, three repeats with no
  flakiness). \* The `159s`/`91s` above are the PRE-change numbers — this
  hasn't had a fresh cold/warm sample on a GitHub-hosted runner yet.
  **TODO(humano):** re-measure `Testes TS (api + web)` on `ci.yml` after
  this lands on `dev` and replace the row above.

> **Splitting a job to parallelize it has two costs the number doesn't
> show.** The first: the job's name **is** the required check's name, so
> splitting `Testes TS (api + web)` into three would erase a required
> check — which would never report again and would lock every PR forever
> (the same trap as the note further below). Preserving the name would
> require a fan-in job with `needs:`, or touching Settings.
>
> The second: **measured, the gain wasn't there.** Each new job repays
> `checkout` + `setup-node` + `pnpm install` (~25s) and, in the api's case,
> the Postgres container (13s). Splitting the 159s gives ~150s, because the
> api test's 91s stay whole and carry the setup regardless. **~7s** of gain
> for the cost of a required check and one more job — it doesn't pay off.
> What pays off is attacking the 91s.

> **The check's name is smaller than what it guards.** `Drift, gerados e
> build` is three things in the title and **five** gates in the job:
> `.docmap.yml` integrity, generated files up to date, drift, site build,
> and — ever since the API reference shipped broken in two releases — **the
> API reference renders** (`scripts/docs/api-render-check.mjs`).
>
> That last one exists because a green build isn't a page that renders: the
> MDX compiles, the SSR writes the content, `docs:build` passes, and the
> page dies at hydration in the browser. The whole mechanism is in
> `docs/explanation/documentation-workflow.md`. When adding a gate to this
> job, the check's name **doesn't** change — and that's why it doesn't need
> to be re-entered into the table above, but it needs to be written down
> somewhere. Here it is.

> **`pull_request_target` requires the workflow to be on the DEFAULT
> branch.** Being on the PR's base branch isn't enough. This was measured,
> not assumed: with `pull_request_target`, `pr-police` had **zero runs**,
> while `approval-ladder` and `docs-check` — which use `pull_request` — ran
> normally from the same commit. Since the default is `main` and it only
> advances through the ladder that the check itself guards, the trigger
> would be a chicken-and-egg problem. Both use `pull_request`.

> **Where GitHub reads each workflow from — three families, three
> answers.** This cost three separate discoveries during this phase, and
> it isn't obvious anywhere:
>
> | trigger | reads the workflow from | consequence here |
> |---|---|---|
> | `pull_request`, `push` | the **event's branch** | works from the first PR |
> | `pull_request_target` | the **default branch** | wasn't running: `main` is behind |
> | `workflow_dispatch` | the **default branch** | doesn't even appear in the workflow list |
>
> The last two create a chicken-and-egg problem when the default branch is
> out of date: the workflow that makes the pipeline move needs to already
> be on `main` to be triggerable. The workaround was running the `promote`
> script by hand on the first promotion — the same script, just the manual
> trigger. Once `main` receives the workflows, the dispatch works forever.

> **A required check that never runs locks the PR forever.** That's why
> `ci.yml`'s trigger covers all three permanent branches — before FASE 6 it
> only fired on PRs targeting `dev`, and requiring these checks on a
> `dev→qa` promotion would produce an eternally pending PR. The `push`
> trigger was removed: with `pull_request` covering everything, it only
> duplicated runs. When adding a new job to CI, either it enters this
> list, or it's left out on purpose and someone writes down why.

> **And a required check that doesn't RE-run pastes on a stale verdict.**
> This is the other side of the lesson above, and it cost a PR a mistaken
> failure.
>
> `pull_request`'s defaults are `opened`, `reopened`, and `synchronize` —
> none of those cover **changing the base**. And changing the base is
> routine: GitHub opens the PR against the default branch, the author then
> corrects it to `dev`. On PR #71, `Drift, gerados e build` ran in the
> first half-dozen seconds, against `origin/main...HEAD`, and failed on
> seven files that had already been reviewed and merged in #70. The
> retarget didn't re-run it; the red stayed.
>
> The criterion for knowing who needs `edited` is **what the check depends
> on**:
>
> | the check depends on… | needs `edited`? | who |
> |---|---|---|
> | only the HEAD | no | `ci.yml` — tests the commit, and the base doesn't change the result |
> | the BASE, or the PR's BODY | **yes** | `pr-police`, `approval-ladder`, `promotion-check`, `backmerge-gate`, `docs-check` |
>
> In `docs-check` it's both: the drift compares a range that starts at the
> base, and reads the body past the `docs-not-needed:` line. Without
> `edited`, the escape hatch documented just below was unreachable —
> writing the justification in the body didn't reevaluate anything, and
> only a fake commit would unlock the PR.

**`claude-review` is deliberately left out of this list**, and this is the
"someone writes down why": LLM review is opinionated and costs tokens, so
it informs the PR without being able to block it. Since it isn't required,
the job can be skipped without leaving the PR pending — and it is skipped
on promotion PRs, which `github-actions[bot]` opens. The action refuses to
run with a non-human actor (*"Workflow initiated by non-human actor"*), and
even if it ran it would be the same diff reviewed again: the promotion only
carries commits already reviewed in the PR to `dev`. Without that `if`,
the check fails on every promotion — which is what happened on PRs #64 and
#65 of the `v0.3.1` cycle.

### What a PR between permanent branches can't satisfy

`Drift, gerados e build` **is** required, so it runs on every PR — but the
**drift** step declares itself inapplicable when the head is a permanent
branch of the repository itself (promotion `dev→qa`, `qa→main`; back-merge
`main→qa`, `qa→dev`). The job's other steps — docmap, generated files, and
site build — keep running: they only depend on the HEAD, and apply at any
rung.

The reason is the same as `claude-review`'s, with one aggravating factor.
Redundancy, first: a PR between permanent branches has no **authorship**,
it packages commits whose drift was already charged in the PR to `dev`,
file by file. Charging again means charging the same debt at every rung.
But, unlike LLM review, here the requirement was **unsatisfiable** — and
it's what failed #72, the promotion for the `v1.0.1` cycle, over
`docker/**` files that came from #70:

| the apparent way out | why it doesn't exist |
|---|---|
| updating the doc in the promotion PR | `promotion-check` requires a **clean range** — the head has to be the tip of the source. Committing there fails the other required check |
| repeating the original PR's `docs-not-needed:` | the promotion PR's body is generated by `promote`; #70's justification doesn't carry across the rung |
| putting the label on every promotion | that's teaching people to use the escape hatch by reflex, until it stops meaning anything — the opposite of what `.docmap.yml` asks for |

The filter lives **inside** the step, not in an `if:` on the job,
following the same principle `promotion-check` records: a required check
indexed by sha that doesn't run leaves the PR pending forever. The step
runs, decides it doesn't apply, and writes that in the summary — instead
of disappearing.

> **A head called `main` coming from a fork is not a promotion.** It's a
> third party's working branch, and it goes through the drift check like
> any other. That's why the condition matches the name **and** requires
> the same repository — the same caveat `pr-police` applies when
> classifying the PR's family.

### Bypass

| who | mode | for what |
|---|---|---|
| the `BRABO_BOT_TOKEN` actor | `Always` | writing `.release/gate.json` on `main` |

**No person has bypass** — not even the owner. This one belongs to the
bot, and it exists for a reason with no workaround: the gate locks the
branches, and a PR to open the lock would be blocked by the gate itself.
The commit stays in `git log`, with date and content, and `tag-release`
recognizes it by what it touches (`.release/` and nothing else), not by
who it claims to be.

> **Warning about the bypass's reach.** GitHub rulesets grant bypass to
> the **actor**, not to a path: whoever can write `.release/gate.json` on
> `main` can, technically, write anything. There's no way to restrict by
> path in the interface. What actually limits it is the workflow — it
> only writes that one file — and the history, where any other direct
> commit stands out immediately. Recorded for what it is: a limitation of
> the tool, not a decision.

### The `BRABO_BOT_TOKEN` secret

Classic PAT with `repo` + `workflow` scopes, in **Settings → Secrets and
variables → Actions**:

```bash
gh secret set BRABO_BOT_TOKEN --body '<token>'
```

It isn't a convenience. Two things depend on it, and both fail silently
without it:

| what | why |
|---|---|
| the tag triggering `Release` | **a tag created with `GITHUB_TOKEN` doesn't trigger a workflow** |
| back-merge PRs being born with checks | **a PR opened with `GITHUB_TOKEN` doesn't trigger a workflow** |

It's GitHub's rule against recursion, and it already took its toll: the
`v0.2.0` Release never published because of it. The second case is worse
— a back-merge PR without a check would never go green, and the chain
would lock up forever. That's why the gate job **fails loudly** when the
secret doesn't exist, instead of proceeding and leaving the repository in
a dead end.

The `workflow` scope isn't overkill: back-merge PRs carry the entire
branch, and it may contain a change to `.github/workflows/**`. Without
that scope the push is rejected in exactly the case that matters most —
propagating a CI fix.

> **Current state: configured and exercised.** On `v1.1.1` the pipeline
> closed on its own for the first time — `tag-release` skipped the warning
> step, pushed the tag with the PAT, and that **triggered** `release.yml`,
> which published the Release. A tag pushed with `GITHUB_TOKEN` wouldn't
> trigger it; that trigger is proof the token is valid and has push scope.
>
> **Six tags remain orphaned** — `v0.2.0`, `v0.3.0`, `v0.3.1`, `v1.0.0`,
> `v1.0.1`, and `v1.1.0` — from the period when the secret didn't exist.
> The PAT doesn't recover them: it only applies to new tags. For those,
> the procedure is below.

### Republishing a tag that was orphaned

`release.yml` has `workflow_dispatch` with a tag input, and it exists
because of the six above. Only the `push: tags` trigger would make the
failure **irreversible**: republishing would require deleting and
recreating the tag, that is, rewriting the record to fix its effect.

```bash
gh workflow run release.yml -f tag=v1.1.0
```

Three guards, and each exists because of a concrete failure mode:

| guard | against what |
|---|---|
| only `OWNER_HANDLE` can trigger it (`solo` mode) | same restriction as `promote`; the push trigger doesn't go through here, because there what authorized it was the tag |
| the input has to match `^v[0-9]+\.[0-9]+\.[0-9]+$` | `workflow_dispatch` accepts free text. Without this, `-qa.1` would publish a Release of something nobody validated as final |
| refuses if the Release already exists | a published note is a record; overwriting silently would erase what someone already read or linked to |

And the `checkout` is done **on the tag**, not on the event's ref. In a
dispatch, `github.ref_name` is the default branch — without this care,
republishing would generate a Release called `main`, with `main`'s
changelog, with no error at all.

> **The dispatch only works after this reaches `main`.** It's the
> chicken-and-egg problem from the trigger table above: `workflow_dispatch`
> reads the workflow from the **default** branch. While the change is only
> on `dev`, the input doesn't even show up.

## Ruleset 2 — version tags

**Name:** `tags-de-release`
**Enforcement:** `Active`
**Target:** Tag → `Include by pattern` → `v*`

| rule | value |
|---|---|
| **Restrict creations** | ✅ |
| **Restrict updates** | ✅ |
| **Restrict deletions** | ✅ |

The `v*` pattern covers the three forms the pipeline creates: `-dev.N`,
`-qa.N`, and the final one. Only `tag-release` can create them.

### Bypass

| who | mode |
|---|---|
| the app/bot that runs the release workflow | `Always` |

This is the push exception that the policy allows for: **a version is
born from a workflow, never by hand**. A manually created tag doesn't go
through the verification that the final tag points to the same commit as
the last `-qa.N`, and it's exactly that verification that prevents
publishing something different from what was validated.

## How to apply

Interface: **Settings → Rules → Rulesets → New ruleset**.

Via API, if you'd rather version the command:

```bash
gh api -X POST repos/daneiel/brabo/rulesets --input ruleset-permanentes.json
gh api repos/daneiel/brabo/rulesets --jq '.[] | "\(.name): \(.enforcement)"'
```

> **TODO(human):** the two payload `.json` files aren't versioned here
> because the rulesets API requires `repository_id` and app ids that vary
> by installation — a fixed file would get copied wrong. If you want to
> version them, generate with
> `gh api repos/daneiel/brabo/rulesets/<id> > docs/reference/...` after
> applying through the interface, and this document will then point to
> them.

## Settings → Pages: the source is the `gh-pages` branch

**Manual** application, for the same reason as the rulesets: the
repository versions the source, GitHub receives the application.

**Settings → Pages → Build and deployment → Source:
`Deploy from a branch`**, with branch **`gh-pages`** and folder
**`/ (root)`**.

**Already applied.** `gh api repos/daneiel/brabo/pages` returns
`"build_type": "legacy"` with `source.branch: "gh-pages"`, and all three
rungs respond live.

The intermediate step is worth recording, because it's confusing: while
`build_type` was `"workflow"`, `docs-deploy.yml` committed to `gh-pages`
**and Pages served nothing from there** — the publication stayed in the
repository without going live, with the old site still responding from
`actions/deploy-pages`'s last artifact. Nothing in CI goes red in that
state.

Why the switch is mandatory and not a preference: `actions/deploy-pages`
publishes **one artifact as the entire site** and doesn't know how to
update part of a tree, which is incompatible with one subdirectory per
rung. The full design, the discarded alternatives, and the push exception
this opens are in
[ADR 0034](../explanation/../adr/0034-documentacao-publicada-por-degrau.md).

| branch | URL | indexed |
|---|---|---|
| — (index of all three) | `https://daneiel.github.io/brabo/` | ❌ `noindex, follow` |
| `main` | `https://daneiel.github.io/brabo/prd/` | ✅ |
| `qa` | `https://daneiel.github.io/brabo/qa/` | ❌ `noIndex` |
| `dev` | `https://daneiel.github.io/brabo/dev/` | ❌ `noIndex` |

The three became symmetric in
[ADR 0071](../adr/0071-publicacao-simetrica-por-degrau.md), which also
explains the generated root and the `404.html` that forwards old links to
the stable rung. [ADR 0073](../adr/0073-o-caminho-publicado-nomeia-o-ambiente.md)
separated the PATH from the BRANCH: `main` publishes at `/prd/`, because
the address names the environment for the reader. `404.html` started
rewriting `/brabo/main/<something>` to `/brabo/prd/<something>` — the old
directory leaves the tree, and `keep_files: false` removes it.

**The Pages configuration doesn't change with either of these** — the
source remains the `gh-pages` branch in the `/ (root)` folder; what
changed is the content the workflow assembles before pushing. And `prd`
**is not** a branch: it's in no ruleset, it doesn't exist in `git`, and
it's just the name of a directory in `gh-pages`.

> **`gh-pages` does NOT enter the permanent-branches ruleset.** It isn't
> permanent, and the bot needs to push to it — including it would lock up
> the publication itself. That's also why `GITHUB_TOKEN` is enough there,
> with no bypass and no `BRABO_BOT_TOKEN`.

> **And it's excluded from Gitleaks' scope, for a reason that only
> surfaced later.** `gitleaks detect` scans **every reachable commit**,
> not just the HEAD history — and `fetch-depth: 0` brings in all refs. As
> soon as `gh-pages` was born, the built site entered the scan: **112
> `generic-api-key` findings** in a single commit, all in
> `dev/assets/js/*.js`, which are avatar filenames inside a minified
> bundle with entropy too high for the rule. It failed the promotion PR
> **#78**, the first one scanned after its debut.
>
> `ci.yml` now deletes `refs/remotes/origin/gh-pages` before scanning.
> **Not** via a path allowlist in `.gitleaks.toml`: that would apply to
> every commit, and a `dev/` that one day showed up in the source code
> would silently go unscanned. Excluding the ref excludes exactly the
> commits that aren't source.
>
> Measured with gitleaks 8.30.1, CI's version: 133 commits and 112
> findings before, 132 and none after — and a GitHub PAT with real entropy
> planted in `apps/api/src/` is still detected, which is proof it didn't
> open a hole.

## The family labels need to exist

`pr-police` applies one of the four labels, and `gh pr edit --add-label`
**fails** if the label doesn't exist — which would leave the PR silently
unclassified.

```bash
gh label create trabalho        --color 0E8A16 --description "Work PR: taxonomy prefix for dev"
gh label create promocao        --color 1D76DB --description "Promotion between adjacent rungs, going up"
gh label create retropropagacao --color 5319E7 --description "Back-propagation between adjacent rungs, going down"
gh label create correcao-alta   --color D93F0B --description "hotfix: a fix that's born high on the ladder"
```

No `|| true` on purpose: if the command fails, you need to see it.

## Verify it's standing

```bash
# do the rulesets exist and are they active?
gh api repos/daneiel/brabo/rulesets --jq '.[] | "\(.name): \(.enforcement)"'

# does the protection respond? (should be REJECTED)
git push origin HEAD:dev
```

The second command is the test that matters. A ruleset configured but not
verified is indistinguishable from a ruleset that's absent — and the
difference only shows up on the day someone pushes directly to `main`.
