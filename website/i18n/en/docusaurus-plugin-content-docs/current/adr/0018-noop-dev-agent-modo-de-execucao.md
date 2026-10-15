# ADR 0018 — NoopDevAgent as a permanent execution mode

- Status: accepted
- Date: 2026-07-25
- Phase: 4a (execution infrastructure validation)

## Context

The NoopDevAgent existed in Phase 4a (ADR 0011) as the body of the
`DevAgentServer`'s `:work`, and was **replaced** by the real agent in the
following session (ADR 0012). With that, the only way to exercise the
execution infrastructure end to end — an isolated worktree, the
`dev-<module>[bot]` identity, the `proposed_actions` pipeline, the PR —
became running the REAL agent, which depends on an LLM: expensive, slow
and non-deterministic. An infrastructure smoke test can't depend on a
model.

This session brings the Noop back, now as a **permanent execution mode**
that coexists with the real agent.

## Decisions

### 1. `Engine.Dev.AgentIo` — the shared side effects
New module with `via/2`, `emit/3`, `claim_task/1`, `propose/3`,
`propose_commit/2` (the identity), `propose_push/1`, `propose_pr/3`,
`persist/1`, `block_task/3` and `worktree_manager/0`, extracted from
`DevAgentServer` with no behavior change. **Both servers use the same
code**: a Noop that reimplemented worktree/identity/pipeline would
validate a copy, not the infrastructure. `dev_agent_server_test.exs` (12
cases) is the extraction's safety net — it passed with no edits.

### 2. `Engine.Dev.NoopDevAgentServer` — a mode, not an identity
Its own GenServer, same Registry, **same `agent_id`** (`dev-<module>`) and
the same real agent's durable state. Being the same agent_id, the autonomy
and instructions seeded by the api apply with no change at all. Cycle:
claim → worktree → trivial file → commit → push → PR → task `in_review`.
**Doesn't open a gate** (QA is an LLM agent): the Noop stops at the PR.
`{:correct, _}` has a defensive clause that returns the task with a
diagnostic instead of crashing the process — `DevAgentServer.correct/3` is
a cast on the `via/2` and would land here.

### 3. `dev_agent_states.impl` — the mode is durable
New column (default `"real"`). Rehydration is what picks the module to
bring up: without persisting the mode, a Noop would come back as a
**real** agent after a node restart — starting to spend tokens with
nobody asking for it. `DevAgentSupervisor.start_agent/7` receives `impl`;
`server_for/1` maps mode → module (anything other than `"noop"` falls
through to the real one — the safe default is the production one). The
parallelization acceptance **inherits the `impl`** of the base agent, for
the same reason it already inherited the ceilings.

### 4. Accepting parallelization now seeds the extra subagent
A fix for a real bug: `AcceptParallelizationUseCase` wasn't creating an
`agent_autonomy` row nor an instruction for `dev-<module>-2`. Without
autonomy, `decide()` falls back to the `require_approval` default — the
"one-click acceptance" turned into three manual approvals per task, and
the acceptance criterion ("see the third one working") didn't close. Now
it seeds instruction + `auto_approve` on the same `DEV_AUTO_GIT_ACTIONS`
as the base agent, **before** calling the engine. `git_merge` stays
excluded.

### 5. Bare repos mounted RW for the engine in Compose
It used to be `git_local_repos:/data/git-repos:ro`. Since Phase 4a the
`git_push` executor runs ON THE ENGINE and pushes the worktree branch to
the bare repo — with the mount read-only, the push dies with `remote
unpack failed: unable to create temporary object directory` and the dev
agent's PR never opens. The `:ro` was a Phase 1 assumption (the engine
only did checkouts) that Phase 4a invalidated without anyone noticing:
the acceptance criterion demo **did not pass** with the previous
configuration.

## Consequences

- `POST /projects/:id/execution/activate` accepts `devAgentImpl: 'real' |
  'noop'` (omitted = `real`). The UI **doesn't change** — the Noop mode is
  a validation tool, not a product feature; the demo triggers it via a
  script.
- `pnpm --filter api demo:noop-execution` runs the whole acceptance
  criterion against the Compose stack.
- New tests: `noop_dev_agent_server_test.exs` (cycle, identity, absence of
  an LLM, worktree failing, 2 agents in parallel),
  `dev_rehydrator_test.exs` (the mode survives a restart, `:work` isn't
  re-triggered, idempotency) and `git_executor_test.exs` (the identity
  against **real git**: bot author + `Co-authored-by`, isolated
  worktrees) — the latter covered a gap: until now only the proposal
  payload was asserted, never the resulting commit.

## Scope & assumptions

The Noop doesn't replace the real agent in any way: it doesn't read task
context, doesn't run the suite, doesn't go through gates. It exists to
answer "is the execution infrastructure standing?" without lighting up an
LLM. The parallelization suggestion is still
`countClaimableByModule >= 2`, not a task-dependency graph (there's no
dependency between tasks in the schema) — it remains open, as ADR 0017
already recorded.
