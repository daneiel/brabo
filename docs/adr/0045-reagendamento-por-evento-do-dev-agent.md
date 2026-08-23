# 0045 — Event-based rescheduling of the dev agent, and the circuit breaker

## Context

Dogfooding's P1 finding #10, verbatim from
`docs/missions/dogfooding-mission.md:659`:

> **A dev agent processes ONE task and stops.** `:work` is only
> triggered on activation and on accepting parallelization; `report_done`
> opens the gate and doesn't reschedule; no Oban worker redispatches it.
> Cap per module: 1 task, or 2 with parallelization.

The practical consequence is in `:396-398` of the same harvest: Phase
10 ran in **batches** — a human reactivating execution (or restarting
the engine) between each task, because nothing in the system took the
agent from the open PR back to "free to claim." Finding #11 (`:660`,
P2) describes the symptom of trying to work around it from the
outside: reactivating doesn't redispatch `:work` (the supervisor
returns `:existing`) and still creates an orphaned session.

Two facts verified in the code, BEFORE designing, shaped the entire
decision:

1. **The worktree is per AGENT, not per task.** `WorktreeManager.add_worktree/3`
   deletes the agent's previous worktree before creating the next one,
   and `QaLeadServer`/`SecOpsAgentServer` find it via
   `DevAgentState.find_by_task_id/2` while the gate runs. Claiming the
   next task as soon as the PR opens would physically destroy the
   worktree the gate is still scanning. That decided that an open PR
   can't free the agent — it needs a state that RETAINS the worktree
   until the gate finishes.
2. **`prod/patches.yaml` runs 2 engine replicas**, and
   `Engine.Dev.Registry` is local to the node. An async job (Oban) can
   run on any replica; resolving "where is this agent's process" via
   Registry would miss delivery in half the cases in production.

## Decision

### The signal is outbox, not an in-process call

`task.gate_resolved` (only on TERMINAL outcomes — `done`/`blocked`)
and `task.became_claimable` (story promoted, task created under an
already-ready story, task unblocked) are outbox lines the api emits,
read by the already-existing `Engine.Outbox.Drain` (`aggregate_type`
gained `"task"` alongside `"session"`) and routed to the new
`Engine.Workers.DevAgentWakeWorker` — the same mechanism as always, a
new handler.

The choice of outbox instead of, for example, the gate calling
`DevAgentServer.correct/3` directly the way it already does for
`changes_requested` (that in-process call CONTINUES to exist,
unchanged) is about **survival**: an outbox line persists across an
engine restart between the verdict and the wake. An in-process call
doesn't — and that's exactly the property Phase 12b-6 (rehydration)
needs to close the rehydrated `awaiting_gate` reacting to a gate
resolved after the restart.

### `awaiting_gate` is the interlock, not a label

Open PR → the agent enters `awaiting_gate` and KEEPS
`task_id`/`worktree`/`branch` — nothing claims anything while the gate
hasn't resolved. Only the terminal outcome (via `task.gate_resolved`)
releases it, through `finish_task/2`. The worktree fact from #1 above
is the entire reason this state exists.

### Delivery via PubSub, not Registry

`Engine.Dev.Wake` uses `Phoenix.PubSub` (already supervised as
`Engine.PubSub`, unused in `lib/` until now) — cluster-wide for free,
unlike the node-local Registry (fact #2). `DevAgentServer` subscribes
to its own topic in `init/1`; `DevAgentWakeWorker` never calls the
GenServer directly, always via `Wake.deliver/3`.

**Consciously accepted limit: delivery is AT-MOST-ONCE.** If the
agent's process is momentarily down when the broadcast happens, the
wake is lost and the agent only wakes on the NEXT event. Fully closing
this would require `:global` registration for dev agents — the same
thing `Engine.Sessions.SessionServer` already does, for the same
reason — rewriting `AgentIo.via/2`, `DevAgentSupervisor.start_agent`
and `Monitor`. Out of scope for this phase; see "what's left for
later."

### The circuit breaker lives in the engine, not in the api

`backlog.task_blocked`'s `actor.id` is WHO BLOCKED IT (`qa-agent`,
`secops-agent`, `qa-lead`, or the dev itself) — the api has no way to
tell "THIS agent's sequence" apart from it. `consecutive_blocked` lives
in `dev_agent_states`, incremented in only one place (`finish_task/2`),
because it's the only point through which the agent learns EVERY
outcome of its own task — local (ToolLoop) or remote
(`task.gate_resolved` with `nextAction: "blocked"`, the gate's
correction cap exhausted). RN-047 details the mechanism and the
invariants.

The cap (`max_consecutive_blocked`) follows the pattern of
`task_budget_micros` — a column on `projects`, resolved at activation
(parameter → project setting → default) — but got what that one never
had: a PATCH + a field in Settings. The user's decision: even at the
cost of more surface, the breaker's cap is the kind you want to adjust
without blindly reactivating execution.

### Rearm is the only way out of `idle_tripped`

A single click (`POST .../agents/:agentId/rearm`) — no automatic
unlock, same principle as `unblock` for individual tasks. The api
records `dev.rearmed` with `actor: user` BEFORE anything is guaranteed
to happen in the engine (the same order — engine first, event after —
that `AcceptParallelizationUseCase` already uses, for the same reason:
the event log is immutable, and recording before a refusal would leave
a lie in it). The engine does NOT emit a second `dev.rearmed` of its
own: that would be the same event counted twice by different actors in
the same session. What happens next (claimed something or went back to
idle) already gets narrated via `dev.working`/`dev.idle`, which the
rearm's `try_claim/1` triggers.

## Consequences

- **Acceptance of the central requirement**: a project with N ready
  tasks in a module processes all of them in sequence with ONE agent,
  with no engine restart and no manual reactivation — the chain claim
  → PR → gate approved → claim next → empty queue → idle → new task →
  wakes up is deterministic and tested end to end
  (`dev_agent_chain_test.exs`), with the REAL outbox/drain/worker/PubSub
  infrastructure in the middle, not simulated.
- **The dev↔gate correction path (`changes_requested`) stays exactly
  as it was** — in-process, without outbox. It's the mechanical proof
  that rescheduling doesn't duplicate that path: `task.gate_resolved`
  is only emitted for terminal outcomes, so there's no second line to
  trigger it.
- **Rehydration stopped being "come back blank"**: `awaiting_gate` and
  `working` retain or recover whatever made sense to retain; an
  interrupted `working` blocks with an honest restart diagnosis instead
  of silently complaining or trying to resume a ToolLoop that no longer
  exists.
- **The atomic claim didn't change** (`FOR UPDATE OF t SKIP LOCKED`,
  `backlog.repository.ts`) — rescheduling increases WHO attempts the
  claim (the same agent, more times; two agents of the module waking up
  together), not the guarantee that already existed. The api's
  concurrency proof (8 real parallel claims) stays untouched; the new
  one is on the engine side, over the reaction logic.
- **`NoopDevAgentServer` stays outside the entire mechanism**: never
  opens a gate, never gets woken up, `status` fixed at `"working"`.
  It's an infrastructure smoke test, not a second product to keep in
  sync with the state machine.

## Adversarial review, and what it found

The implementation went through an independent audit BEFORE leaving
the branch — done without feeding the auditor the justifications
above, so as not to inherit whoever wrote it's blind spots. It found
**eight defects, four of them capable of locking up an agent or the
boot**. All were fixed; the record stays here because the lesson is
more useful than the list.

**This ADR's decision didn't change.** What changed was its
implementation, which was wrong at points the tests couldn't reach.

**Why the whole suite passed green with four lockups inside:** the
fakes (`FakeWorktreeManager`, `FakeEngineApiClient`) return instantly
and **always with success**. There was no test path for a `claim_task`
that fails, for the ToolLoop's real cost inside `init/1`, nor for a
gate finishing a task outside `RecordGateVerdictUseCase`. A test that
only exercises the happy path measures the absence of typos, not the
correctness of the design. The fake gained an error branch and
configurable delay along with the fixes.

The four critical ones, for what they teach:

- **Partial state is worse than wrong state.** `finish_task/2` zeroed
  `task_id` but didn't touch `status`; a transient 5xx on the claim was
  enough for the agent to end up `awaiting_gate` with `task_id` nil —
  a combination NONE of the three guards accept. The agent stayed
  half-dead, and the cause was a one-second network failure.
- **`init/1` is a boot path, not a place to work.** Recovering an
  interrupted `working` ran in there, and since `start_link`/`start_child`
  expect `:infinity`, the whole boot got stuck for the duration of an
  LLM task. It moved to `handle_continue`.
- **A funnel that isn't the only funnel isn't a funnel.** The design
  said "the agent learns EVERY outcome of its own task via
  `finish_task/2`" — but `QaLeadServer` blocks by calling
  `MarkTaskBlockedUseCase` directly, without going through
  `RecordGateVerdictUseCase`, where the emission lived. The emission
  moved down to the real funnel.
- **I copied the outbox mechanism without copying its reason.** The
  four new emissions didn't use `UnitOfWork`, even though
  `AppendSessionEventUseCase` does — breaking the invariant
  `architecture.md` describes as the reason the outbox exists, in a
  file I edited in this same phase.

## What's left for later

- **`:global` for dev agents** — would close the at-most-once gap of
  PubSub delivery. Not urgent: the next event (another gate, another
  claimable task) still reaches an agent that missed a wake, just not
  immediately.
- **"3 real gates in sequence, no restart" as manual acceptance, not
  CI.** QA Lead and SecOps are LLM judgment — non-deterministic by
  nature, the same reason [ADR 0020](0020-destravar-gates-qa-secops.md)
  already recorded for Phase 4a's acceptance criterion ("CLOSED, but
  not deterministic"). What the suite proves is everything DOWNSTREAM
  of the verdict; dogfooding with real gates remains a human
  demonstration, recorded in the CHANGELOG.
- **A kill in the middle of the ToolLoop has no automatic resumption,
  by decision.** Turn, messages and worktree edits only exist in
  memory — there's nothing to resume. Blocking with a diagnosis and
  leaving a human to decide is the same doctrine that already governs
  local blocks; a full automatic resumption (redispatching a new
  ToolLoop on the SAME already-claimed task) would be new autonomy, and
  CLAUDE.md marks that as an explicit non-goal of Phase 12.
- **The worktree can disappear under a pending approval** — finding D5
  from the review, **consciously accepted, not fixed**. The
  `awaiting_gate` interlock protects the GATE window, but not the
  approval pipeline's window: with the dev's autonomy set to `manual`
  (the panel toggle allows it), `git_commit`/`git_push` stay `pending`;
  gates scan the WORKTREE, not the PR, so they can approve, the agent
  claims the next task and `add_worktree/3` deletes the directory — and
  the human approval, when it comes, runs against a path that no
  longer exists. Before 12b the agent would stop and the worktree would
  survive indefinitely.

  It wasn't fixed because the obvious fix — holding the claim while
  there's a pending `proposed_action` for that worktree — reintroduces
  exactly the coupling this phase removed: the agent would go back to
  depending on external state to decide whether it can work. The path
  also requires leaving the default: `ActivateExecutionUseCase` seeds
  `auto_approve` for `git_commit`/`git_push`/`pr_open` of every dev
  agent, so it only reaches whoever changed autonomy by hand. It stays
  recorded as a known limit; if it shows up in practice, the right fix
  is for the worktree to be per TASK instead of per agent, which is a
  structural change and calls for its own ADR.
- **12b didn't touch findings #12 through #16** from the same harvest
  (free manual handoff, story promotion — that's Phase 12c —, return
  to the PO, shared panel tab, approval counter). Out of scope.

References [ADR 0005](0005-repo-bootstrap-idempotent-steps.md) (the
durable-state + rehydration mold this ADR extends to dev agents) and
[ADR 0020](0020-destravar-gates-qa-secops.md) (the origin of the
"never silent reclaim" doctrine and the precedent for manual acceptance
of a non-deterministic criterion).
