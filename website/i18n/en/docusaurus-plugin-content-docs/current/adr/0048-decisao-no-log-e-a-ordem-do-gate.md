# 0048 — The decision in the event log, and the gate's ordering

## Context

Two dogfooding findings that Phase 12 had left recorded and unfixed.
Revisited together because they're the same class of defect: **an
important fact happened and wasn't written anywhere that served as
memory.**

### Finding #17 — an action's decision didn't exist in the log

`proposed_action.created`, `.approved` and `.denied` only went **to the
outbox**. The outbox is transport: it gets drained, marked with
`processed_at` and pruned. The decision only survived in
`proposed_actions.decided_at`, a column that says WHEN but doesn't show
up in the timeline the UI, the Psychologist and the Anamnese read.

Two consequences, and the second one only became visible while writing
this ADR:

1. **Phase 10's main metric couldn't be collected.** "Approval clicks"
   was the central column of the dogfooding observation table, and
   there was no query that could produce it.
2. **`docs/reference/events.md` had documented all three as domain
   events all along.** The doc promised what the code didn't do — the
   worst kind of documentation error, because the reader has no way to
   suspect it.

### D5, and the defect underneath it

[ADR 0045](0045-reagendamento-por-evento-do-dev-agent.md) recorded D5
as a known limit: with the dev's autonomy set to `require_approval`,
the agent recycled the worktree and the pending approval ran against a
path that no longer existed. It predicted the right fix would be
"worktree per task."

While investigating to fix it, the picture was different and worse:

**`AgentIo.propose/3` discarded the action's status** (`{:ok, _action} -> :ok`).
The agent would propose commit, push and PR and call `open_gate` +
`run_qa` **unconditionally**, with no idea whether anything had
actually executed. With manual autonomy:

1. the three actions are born `pending`;
2. the gate opens anyway, and QA scans the **worktree** — where the
   files are — and approves;
3. SecOps approves, the task becomes `done`;
4. `task.gate_resolved` frees the agent, which claims the next task and
   deletes the worktree;
5. the user approves the commit, and `git add -A` runs in a directory
   that's gone.

Step 5 returns `{"", 2}` — `System.cmd` with a nonexistent `cd` doesn't
raise an exception — and `git/2` turns that into `{:error, ""}`: the
action fails with an **empty diagnosis**.

The real damage isn't the approval failing. It's the **task closing as
done with no line committed and no PR at all**. And it didn't require
exotic configuration: the panel's toggle exposes `require_approval` for
`dev-*`.

## Decision

### The action's decision becomes a domain event, with the real actor

`proposed_action.created` (actor = the agent that proposed it),
`.approved` and `.denied` (actor = the **user** who decided) start
being recorded in `session_events`, alongside the outbox lines that
already existed. The outbox stays as transport; the log becomes memory.

The `.created` payload carries the resulting `status`, and that's what
makes auto-approval **auditable**: counting `.approved` events counts
HUMAN decisions; the policy deciding on its own shows up in `.created`
with `status: auto_approved` and an agent actor, and is never confused
with a click. That distinction was exactly what was missing for Phase
10's metric.

`approve_always` gets it for free: it delegates to
`ApproveActionUseCase`.

Left out, deliberately, is the `proposed_action.created` that
`provision-repository` and `bootstrap-runner` emit directly to the
outbox: those actions are bootstrap mutations, already narrated by
`bootstrap.step_*` in the same session, and duplicating them would
count the same fact twice in an approval metric.

### The gate only opens after the PR opens

`AgentIo.propose/3` now returns `:executed | :pending | :refused`. The
agent reads the three outcomes and:

- **everything executed** (`auto_approve` autonomy, the default
  activation seeds) — opens the gate, as always;
- **something pending** — enters `:awaiting_approval`, **retaining the
  worktree**, and opens no gate. With no PR, there's nothing to judge.

What releases the agent is `task.pr_settled`, emitted by the api when
`pr_open` reaches an outcome — executed, denied or failed. `opened:
true` opens the gate, late but correct; `opened: false` returns the
task with a diagnosis instead of leaving the agent waiting forever for
a gate nobody is going to open.

Three things made this cheap:

- **`propose_pr` already carried `storyTaskId` in its payload**, so the
  api knows exactly which task the PR opened for, with no new table or
  join.
- **`aggregateType: 'task'` is already drained** by
  `Engine.Outbox.Drain` since Phase 12b — no new aggregate type, no new
  worker, just one more clause in `DevAgentWakeWorker`.
- **`dev_agent_states.status` is a `:string`**, not an enum — the new
  state didn't require a migration.

A denied PR **doesn't count against the circuit breaker.** The decision
was the user's; the agent didn't burn any cap. It's the same principle
that already applied to restart recovery (RN-047).

### Why NOT worktree per task

ADR 0045 predicted worktree-per-task as D5's fix. That prediction
**wasn't fulfilled, and the reason is it was treating the wrong
symptom**: worktree per task keeps the directory from disappearing, but
the gate would still be judging a PR that doesn't exist, and the task
would still close with no commit. The defect wasn't the deletion — it
was the gate opening too early.

With the order fixed, D5 dies as a consequence: the worktree is only
recycled on `gate_resolved`, the gate only opens after the PR has
opened, and the PR only opens after commit and push have executed.
**No pending action outlives its own worktree**, with no change to the
directory structure, no disk growth and no new cleanup policy.

## Consequences

`docs/reference/events.md` stops lying about three event types — and
the generator, which compares the prose against the emission points,
now actually finds all three.

The metric Phase 10 lost now exists. A future dogfooding can answer
"how many times did the human decide" with a query, instead of live
note-taking — which is exactly what got lost by not being done (see
[the harvest](../explanation/primeiro-dogfooding.md)).

`session_events` volume grows: every proposed action generates one more
event. These are actions that were already narrated during execution
(`action.executed`/`action.failed`); what was missing was the beginning
and the decision.

The engine test fake's default changed from `pending` to
`auto_approved`. It made no difference while the status was discarded;
from here on it does, and `auto_approved` is what reality produces —
`ActivateExecutionUseCase` seeds `auto_approve` for every dev agent's
git actions. A default different from production would send the whole
suite down the manual-approval path.

Left for later, as backlog:

- **Worktree per task**, if a case ever shows up where the approval
  takes long enough for the worktree to become a problem for another
  reason. It stopped being a defect fix and became an architecture
  choice.
- **`git/2` with an empty diagnosis.** `System.cmd` with a nonexistent
  `cd` returns `{"", 2}`, and that turns into `{:error, ""}` on any
  directory failure, not just this one. This one's root cause is now
  closed, so the empty message no longer has a known trigger — but the
  diagnosis gap is still there.
- **Pending actions of types other than `pr_open`.** The interlock
  covers the dev agent's path, which is where the damage was concrete.
  A pending `terminal` still doesn't block anything, and it didn't need
  to.
