# ADR 0067 — The gate survives a restart

- **Status:** accepted
- **Date:** 2026-08-12
- **Context:** recurring finding during review — "PR under Dev review never
  finishes"
- **Extends:** [ADR 0057](0057-o-gate-espera-a-aprovacao.md), in the same
  relationship that one has with [ADR 0052](0052-dev-agent-espera-aprovacao-no-meio-do-laco.md)

## Context

[ADR 0057](0057-o-gate-espera-a-aprovacao.md) solved, for the gate agents,
the problem 0052 had already solved for the dev agent: suspending
mid-loop instead of dying with a misleading `origin: infra`. It already
declared, in the "What this does NOT resolve" section:
**"a restart mid-wait loses the loop"** — the `QaLeadServer`'s
`pendente`/`em_voo` (pending/in-flight) lives only in the process's memory,
which is `restart: :temporary` (same as `SecOpsAgentServer`), and creating
the durable table equivalent to `dev_agent_states` (Phase 12b) had been
declared its own scope.

That own scope is this ADR — but it covers MORE than the original sentence
suggests. Investigating the code again (`qa_lead_server.ex`,
`secops_agent_server.ex`, `dispatcher.ex`) found a SECOND loss window,
distinct from suspension in `{:awaiting, ...}`: the gate's intermediate
transitions — `DevAgentServer.correct/3` (hands back to the dev agent) and
`Dispatcher.run_secops/2` (QA approved, calls SecOps) — are DIRECT
in-memory calls, made AFTER `record_gate_verdict` has already durably
advanced the task's `gate_status` on the api. If the process dies exactly
between the two (verdict already recorded, in-process call not yet made),
the api thinks the next gate is running and the engine never calls
anyone — the PR gets stuck in `awaiting_secops` (or `awaiting_qa` waiting
for a correction that never arrives) forever, and no engine restart fixes
it, because nothing ever knew that step was pending.

Two windows, then, not one:

1. **`in_progress`** — the process died BEFORE any verdict was recorded (at
   the start of a cycle, or in the middle of a subagent suspended waiting
   for approval, the case 0057 already covered).
2. **`dispatch_pending`** — the verdict was ALREADY recorded (durably, in
   the api), and only the in-process call that applies the next step
   (`correct` or `run_secops`) got lost.

The first one 0057 documented; the second hadn't been noticed — and in
practice it's the easier one to hit: it's exactly the gap between an HTTP
response coming back and the next line of code running.

## Decision

**The gate gains durable state, in the same idiom as `dev_agent_states`
(ADR 0045), and a rescuer that resumes whatever was left pending — without
manual intervention.**

### The table: `gate_states` (schema `engine`)

Composite key `{project_id, task_id, gate}`. Each row represents a gate
cycle IN FLIGHT, with a `step`:

- `"in_progress"` — no verdict recorded in this attempt. `subagent`
  (optional) is purely diagnostic — which sub-specialty was suspended —
  the ToolLoop's `ctx` is NOT persisted (same choice as the dev agent's
  `laço_pendente`: it doesn't survive a restart, and pretending it does
  would be worse than not trying).
- `"dispatch_pending"` — the verdict was already recorded; `next_action`
  (`"correct"` | `"run_secops"`) and, when it's `"correct"`,
  `correction_reason`/`correction_diagnosis` hold what
  `DevAgentServer.correct/3` needs to be re-called without re-reading the
  api.

Written and deleted at the SAME points where `qa_lead_server.ex`/
`secops_agent_server.ex` already make the transitions — there's no
parallel path. `run_area`/`run_secops` write `in_progress` before any
subagent/scanner runs; `apply_gate_result`/`apply_verdict` write
`dispatch_pending` IMMEDIATELY after `record_gate_verdict` returns
`correct`/`run_secops` and BEFORE making the in-process call; the row is
deleted right after the call (or on any other terminal outcome — `done`,
a block, or an error).

### The rescuer: `Engine.Gates.GateRescuer`

Sweeps `gate_states` for rows stuck longer than
`gate_rescue_stale_after_seconds` (default 900s — **deliberately
generous**: a QA subagent's ToolLoop can legitimately run up to
`TOOL_LOOP_MAX_ITERATIONS_GATE` (60) iterations, and a short threshold
would rescue — and duplicate — a cycle that's merely slow). For each row:

- `in_progress` → restarts the whole AREA (`Dispatcher.run_qa`/`run_secops`
  again). There's no possible SURGICAL resumption (the `ctx` didn't
  survive), but it's SAFE: the api only accepts `record_gate_verdict` for
  the gate that's still the OWNER of the current `gate_status`
  (`nextGateStatus`, `pr-gate-state-machine.ts:67-69`) — if this cycle had
  already finished through another path, the second attempt gets an error
  (today an unmapped 500 — see "Consequences") and corrupts nothing.
- `dispatch_pending` → resends exactly the call that was missing
  (`Dispatcher.run_secops`/`DevAgentServer.correct`).

Called from two places, the same pair `Engine.Dev.DevRehydrator` uses: once
at boot (`Engine.Application`, after the two gate supervisors) and
periodically via `Engine.Workers.GateRescueSchedulerWorker` — a
self-rescheduling Oban tick (5-minute default), the same idiom as
`ModelSyncSchedulerWorker`/`AnamneseSchedulerWorker`. Reusing Oban instead
of inventing another scheduling mechanism is a deliberate decision: the
engine already uses Postgres queues for this, and a second mechanism just
for gates would be duplicating what already exists for the wrong reason.

### Two guards against duplicating work

A gate cycle running again is expensive (LLM) and, at the limit, can
produce two competing verdicts for the same step. Two guards, neither
perfect alone, together sufficient:

1. **`Registry.lookup` before any rescue.** A process alive on THIS node is
   never disturbed — if it's still running (even if slowly), the rescue
   doesn't act. This does NOT cover another replica: `Engine.Gates.Registry`
   is local to the node, the same caveat `Engine.Dev.Wake` already assumes
   since ADR 0045 (at-most-once PubSub delivery because of it).
2. **The staleness threshold** is the second line of defense precisely for
   the case guard 1 doesn't cover — generous enough to give a remote
   replica time to finish a real cycle before another one tries again.

The worst outcome of a residual race (both guards failing at the same
time) is DUPLICATED and CHEAP work — SecOps re-scans (deterministic, no
LLM); QA re-runs and the second `record_gate_verdict` is rejected by the
api without writing anything — never inconsistent data.
`DevAgentServer.correct/3` was already idempotent-by-state-guard since
ADR 0052 (`handle_cast({:correct, _}, state)` only acts if
`status == :awaiting_gate`); a second `correct` arriving after the first
already advanced the agent is a free NO-OP.

## Consequences

**ADR 0057's finding closes, and goes beyond what it declared.** Both
windows (`in_progress` and `dispatch_pending`) are covered; the second one
hadn't even been named until this investigation.

**`InvalidGateActionError` still has no mapped filter.** Investigating the
api for this ADR found that a second call to `record_gate_verdict` for a
gate that's no longer the owner of `gate_status` leaks as a generic Nest
500, not a semantic 4xx — `DomainTransitionErrorFilter` only catches
`InvalidSessionTransitionError`/`InvalidActionTransitionError`. The
`in_progress` rescue depends on that rejection to avoid corrupting
anything in a residual race, and it DOES WORK (the exception stops
execution before any `UPDATE`/`INSERT` —
`record-gate-verdict.use-case.ts:82-88`, before the transaction), but the
log ends up uglier than it needed to be. Mapping the filter is an
observability improvement, not a bug fix, and stays out of this ADR —
recorded in the backlog.

**The residual window between `record_gate_verdict` returning and the
local `upsert!` of `dispatch_pending` COMMITTING isn't closed — it's
accepted, by the same reasoning ADR 0045 already accepted for
`Engine.Dev.Wake`.** The two writes (the `UPDATE` on the api, remote; the
local `INSERT`, in the engine) can't be transactional with each other
without 2PC — out of scope. The in-process call between them is local and
instantaneous (no network I/O), so the window is on the order of
microseconds, not seconds; the generous staleness threshold means the
sweeper never realistically collides with it.

**Multi-replica remains the already-known limit.** `Registry` local to the
node, `Engine.Dev.Wake` at-most-once — this ADR doesn't change either one,
it just uses the same pattern that already existed (guard 1 above).
Closing that for good (a `:global` registry) remains ADR 0045's follow-up,
not this one's.

**Finding X/Z/AD (the verb allowlist doesn't converge) stays out of
scope** — no change to the ToolLoop's policy, no change to the allowlist.
This ADR is only about the gate SURVIVING a restart mid-cycle, not about
what it does inside the cycle.

## Alternatives considered

**Resuming the suspended `ctx` SURGICALLY, by persisting it.** Rejected,
for the same reason the dev agent already doesn't do that for a rehydrated
`working`: a ToolLoop's message history is large, changes shape with the
harness, and persisting a format that's only ever read once, at rescue
time, is debt born ready to rot. Restarting the area from scratch is
cheaper to maintain and, by the api's state-check argument, equally safe.

**A second scheduling mechanism just for gates**, instead of Oban.
Rejected: the engine already uses Postgres queues for everything (outbox
drain, dev agent wake, Anamnese, catalog sync) — inventing another
mechanism just for this would duplicate infrastructure for the wrong
reason.

**Lowering the staleness threshold to seconds, for a faster rescue.**
Rejected: a QA subagent legitimately running 40 of the 60 allowed
iterations would get rescued MID-WAY, duplicating work that was about to
finish on its own. The cost of waiting up to 15 minutes for a genuine
rescue is smaller than the cost of rescuing too early a cycle that was
merely busy.
