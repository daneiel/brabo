# 0005 — Idempotent and resumable Gitflow bootstrap

## Context

Phase 2, session 3 ("the heart"): `ProvisionRepositoryUseCase`, in
addition to creating the repository, now runs the full Gitflow
bootstrap (dev/qa/rc branches, protections per capabilities, PR
template, docs/branching-policy.md) as a sequence of steps that needs
to: converge to the same state no matter how many times it runs
(idempotence), resume from where it stopped after a mid-run crash
(progress persistence), and narrate every mutation as an
`auto_approved` `proposed_action` in the session's event log — all of
this with no precedent in the codebase (the first "kill the process
mid-way and resume" feature in this repository).

Two decisions were explicitly confirmed with the user before
implementation; the rest was resolved during implementation, as
integration with existing code (sessions, proposed_actions,
`GitProviderContract`) revealed real constraints.

## Decisions

**1. `getFileContent` as the `GitProviderContract`'s 9th operation.**
The "file already committed with the same content" check (idempotence
of commit steps) can't be done with the original 8 operations — none of
them reads file content. Confirmed with the user: add
`getFileContent(externalId, branch, path): Promise<string | null>`,
implemented across the 3 providers (LocalGitProvider via `git show`,
GithubProvider via Octokit `repos.getContent`, GitlabProvider via
Gitbeaker `RepositoryFiles.show`), covered by the single contract
suite. The GitHub/GitLab fake backends (msw) had to start tracking real
content (previously only branch/PR metadata) — a blob→tree→commit graph
for GitHub (mirrors the real API), a path→content map per branch for
GitLab (the commit API sends the full state at once).

**2. A dedicated session, created once and reused on every resume.**
`proposed_actions`/`session_events` require an existing `sessionId` —
there's no support for an action/event "without a session". Confirmed
with the user: `ProvisionRepositoryUseCase` creates ONE session per
project on the first attempt (the same cheap mechanism as
`CreateSessionUseCase` — just an INSERT + an outbox event, never calls
the engine), stores its id in `repo_bootstraps.session_id`, and REUSES
it on every resume — the bootstrap's history (success, failure, resume,
skips) stays narrated as a continuous timeline, not fragmented across
sessions. The session never transitions to `active` via
`TransitionSessionUseCase` (which would call the engine through
`ApiToEngineClient.startSession` — wrong for a session that never runs
any command): the `created→active` transition is done directly via
`SessionRepository.updateStatus`, guarded by `assertTransition`. For the
same reason, the session NEVER goes to `closed_abnormally` on a step
failure — that's a terminal state (no outgoing transitions,
`session-state-machine.ts`) and would break reuse across future
resumes; it stays `active` through any number of failed
attempts/resumes, only closing (`closing→closed`, without touching the
engine on either hop) once all 6 steps converge in the same run.

**3. A single cursor per project, full revalidation on every run.**
`repo_bootstraps` is one row per project (not a log per step) —
`{project_id, session_id, step, status, attempts, last_error}`.
Idempotence does NOT come from skipping steps based on that cursor:
EVERY run (fresh or resumed) walks through all 6 steps from the start,
calling each one's `check()` against the real state on the provider —
only when `check()` reports "not satisfied" does an actual mutation
happen. The cursor is only a diagnostic (last step touched + result),
never a gate. This single rule gives, for free: idempotence (running N
times = every `check()` returns satisfied, zero mutations), resumption
after a failure (the steps already done remain satisfied, only what's
missing runs), and resumption after "killing the process mid-mutation"
(the row is left with `status=running`; on the next run `check()`
discovers the mutation actually already happened and skips it) — the 3
scenarios from the acceptance criteria (item 6) are the SAME mechanism,
not three separate implementations.

**4. No `decide()` in the bootstrap's path — status is born hardcoded
as `auto_approved`.** The request says "auto_approved decision for the
bootstrap". Calling the real `decide()` (the way `ProposeActionUseCase`
does for user/agent actions) would NOT produce that by default:
`decide()`'s fallback when no rule in `permissions.json` applies is
`require_approval`, never `auto_approve`. In other words,
always-auto-approved bootstrap only makes sense as a structural
category separate from the discretionary pipeline, not as "the typical
result of decide() for a new project". Structurally safe:
`auto_approved` is never a transition destination in
`action-state-machine.ts` (only an initial state), so hardcoding it at
creation doesn't violate the state machine. Accepted consequence: a
`deny` in `permissions.json` targeting `git_branch_create` etc. does not
block the bootstrap — it's new-project infrastructure, not a
discretionary agent/user action.

**5. Step EXECUTION order differs from the order listed in the
request.** The request lists "create dev from main" first, with commits
last. That's impossible as stated: `createRepo` creates an empty bare
repo, with no initial commit, on all 3 providers (`auto_init: false` —
"provisioned" needs to mean the same thing everywhere), and a ref with
no commits can't be the source of `createBranch`. The two commits on
`main` (PR template, `branching-policy.md`) need to come FIRST — they
are what give `main` its first commit. Real execution order
(`BOOTSTRAP_STEP_SEQUENCE`/`BOOTSTRAP_STEPS`, kept in sync):
`commit_pr_template → commit_branching_policy → create_dev_branch →
create_qa_branch → create_rc_branch → protect_branches`. The branch
cascade is dev←main, qa←dev, rc←qa (my default — the request doesn't
specify the origin of qa/rc; it follows the dev→qa→rc→main promotion
pipeline described in CLAUDE.md). The `bootstrap_step` enum in the
schema (declaration order) didn't need to change — it's never compared
by order, only by equality.

**6. No 409 for reprovisioning an already-converged project.** The
previous version of `ProvisionRepositoryUseCase` threw a
`ConflictException` if a repo already existed for the project. Keeping
that guard would have broken idempotence: "running the use case N times
converges without error" (item 2 of the request) is incompatible with
"the 2nd call throws 409". Resolved: no conflict guard in that sense —
an already-converged project just makes all 6 `check()`s report
satisfied (a pure skip), never an error.

**7. github/gitlab credential is per-user (PAT), no longer per-project
(OAuth).** The previous version resolved the token via
`project_git_connections` (per-project OAuth connection, used by the
legacy `createRepository`). The new contract (`createRepo` etc.) expects
a PAT (`token:` in Gitbeaker's constructor — `PRIVATE-TOKEN`), not an
OAuth token (`oauthToken:` — `Authorization: Bearer`); the two aren't
interchangeable (docs/adr/0004). Resolved: the credential now comes from
`UserCredentialRepository` (a PAT registered by the user, see
docs/adr/0004), decrypted directly (a raw string, without the OAuth
flow's `{accessToken,refreshToken}` JSON wrapper).

**8. The legacy `GitProvider`/`createRepository` contract retired.**
Confirmed by grep that `ProvisionRepositoryUseCase` was the only
consumer of `.createRepository()` in all of `src/` — `GitProviderRegistry`
now returns `GitProviderContract` directly. This closes the "explicit
debt" recorded in docs/adr/0001.

## Consequences

- No status column on `projects` — `provisioning|provisioned|
  provision_failed` is derived purely from `repo_bootstraps`
  (`repo-bootstrap-status.ts`, the same framework-free philosophy as
  `action-state-machine.ts`), avoiding two sources of truth.
- `repo_bootstraps` doesn't use `SELECT ... FOR UPDATE` — concurrent
  provisioning for the SAME project isn't serialized in this session
  (the same implicit simplification the old `findByProjectId` guard
  already made). If this becomes a real problem, the future decision is
  about an optimistic/pessimistic lock on the row, not about
  redesigning the cursor.
- Real risk, not implemented in this session:
  `GithubProvider.protectBranch` hardcodes `enforce_admins: true`, which
  would block the commits on `main` if the order were reversed
  (protecting before committing) — that's not the case here (commits
  come first), but a real GitHub with `main` already protected outside
  the bootstrap could reject an administrative push later. Out of scope
  for this session (acceptance criteria tested against
  LocalGitProvider, which has no concept of protection).
- `apps/api/scripts/demo-repo-bootstrap.ts` demonstrates the end-to-end
  acceptance criteria: provisions with LocalGitProvider, injects a
  failure on the 2nd `createBranch` call (an observable equivalent to
  killing the process at step 4 of 6), runs again, converges, and prints
  the full event log showing the `bootstrap.step_skipped` events for
  steps 1-3 on resume.
