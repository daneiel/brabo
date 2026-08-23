# ADR 0017 — Workspace initialization lock, dev agent Monitor and ceiling inheritance

- Status: accepted
- Date: 2026-07-25
- Phase: 4a (post-audit corrections)

## Context

Phase 4a audit against the original session's 7 items and the acceptance
criterion. Four confirmed defects (one of them breaking the acceptance
criterion) and ~50% flakiness in the engine suite. This ADR records what
changes structurally; the original decisions are in
[ADR 0011](0011-infra-dev-agents-worktrees-merge-lock.md).

## Decisions

### 1. `Workspace.ensure!/3` serializes per-project initialization (revises 0011 §4)

ADR 0011 accepted the working-tree race as "not a requirement of the
acceptance criterion". **It was one**: on activation, a project's N dev
agents come up together and all call `ensure!/3` seeing the working tree
still nonexistent. The `git init`/`fetch` calls collided on the same
directory (`could not lock config file`, `cannot copy
.../hooks/*.sample`). Measured: with 8 agents, 7 died; with 2 — the
acceptance criterion's number — 1 died, reproducible in 6/6 runs.

Initialization now runs inside `:global.trans({{Workspace, project_id},
self()})`, with a recheck inside the critical section (whoever waited
finds the working tree already ready). The lock is per project: distinct
projects keep running in parallel. The hot path (working tree already
existing) doesn't even touch the lock.

### 2. `Workspace.ensure/3` doesn't raise; a worktree failure returns the task

`ensure!/3` used to raise `MatchError`, and `DevAgentServer` is
`restart: :temporary` — the agent died for good. Worse: the task had
already been claimed (`in_progress`, `blocked = false`), becoming invisible
to claiming (which only picks up `todo`) and out of reach for unblocking.
A stuck task with no recovery path from the UI.

New `ensure/3` returns `{:ok, dir} | {:error, mensagem}`, used by
`WorktreeManager.create/3`; `DevAgentServer` fixes the `task_id` in its
state **before** setting up the worktree and calls `block_task/3` on
failure.

### 3. `Engine.Dev.Monitor` — dev agents get the Monitor that only sessions had

`DevAgentState.delete/2` existed with no call site anywhere: the row
outlived the process, and `DevRehydrator` would resurrect, on every boot,
every dev agent that had ever existed (including the ones killed by a
crash, which came back with no work cycle and held onto the `agent_id` in
the Registry — leaving `WorktreeCleanupWorker` inert, since an
agent that's "alive" never has an orphaned worktree).

New `Engine.Dev.Monitor` mirrors `Engine.Sessions.Monitor`, with one
distinction the session one doesn't make: **`:shutdown` preserves the
row** (it's exactly the case rehydration covers — the node going down),
any other reason deletes it.

Both Monitors are **singletons**: if they die, the engine loses monitoring
of all observed processes at once. The database `delete` is now guarded
(`rescue`/`catch :exit`) in both — a database outage must not have that
effect. It was also the root cause of the suite's remaining flakiness.

### 4. The parallelization subagent inherits the base agent's ceilings

`parallelize` used to bring up `dev-<module>-2` with `nil` defaults. Since
the `ToolLoop`'s guard is `when is_integer(budget)`, `nil` means
**unlimited**: accepting with a single click created an agent with no
spending ceiling. The api can't be the source — it doesn't persist the
budget chosen at activation —, so the extra agent inherits from the base
agent's durable state; with no base agent, the engine refuses with a 409
instead of creating an unbounded agent. `AcceptParallelizationUseCase` now
calls the engine **before** writing the event, since the event log is
immutable.

### 5. `persist/1` writes `max_gate_corrections` explicitly

The column is in the `on_conflict`'s `:replace` list; omitting it in the
upsert zeroed it out on the task's first cycle. The gates read this field
from the database (`qa_agent_server`/`secops_agent_server`), so the
ceiling the user chose silently turned into the api's
`DEFAULT_MAX_GATE_CORRECTIONS = 3`.

## Consequences

- The two-devs-in-parallel acceptance criterion now holds on a new
  project.
- New tests: 8 concurrent `ensure/3` calls on the same project; `ensure/3`
  returning an error without raising; a worktree failure returning the
  task; ceilings surviving `persist`; the Monitor deleting on crash and
  preserving on `:shutdown`; ceiling inheritance in parallelization and the
  409 without a base agent.
- Engine suite: 173 tests, 12/12 green runs (baseline: 9 failures across
  18 runs).
- `workspace_test.exs` and `workspace_files_test.exs` become
  `async: false` — they were the only `async: true` modules mutating the
  global `Application.env` `:project_workspaces_root`.

## Unresolved (audit)

What the audit found and this session doesn't address is recorded here:
the parallelization suggestion is still `count >= 2`, not a dependency
graph (there's no dependency between tasks in the schema);
`dev_agent_states.status` never leaves `"working"`; the branch isn't
persisted; the merge lock doesn't cover `git_merge` without `targetBranch`
in the payload (unreachable today — no agent proposes `git_merge`); and
the outbox only drains `aggregate_type = "session"`.
