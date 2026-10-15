---
traducao_de: 36da3628893047b803131fbe7b06c832f6a3081d
---

# 0207 — A gate cycle stalled for more than 2 h parks, and only a human gesture resumes it

## Status

**Accepted.** 2026-10-02 (AT-391, owner decision on 02/10). Revises
[ADR 0067](0067-o-gate-sobrevive-ao-restart.md) without editing it: automatic
rescue continues, with an age ceiling.

## Context

ADR 0067 made the `GateRescuer` resume on its own every `in_progress` cycle
stalled for more than 15 min, at boot and on every tick. The real use of 02/10
showed three problems: (1) it restarted a cycle whose session had a
`proposed_action` pending from a `qa-*` actor — the cycle was waiting for a
person, the area was paid again and the action would be orphaned; (2) the "live
process" test was per PROJECT and the row is per TASK, so a lost cycle went 8 h
without rescue because the project's QA Lead was alive and idle; (3) there is no
ceiling: a cycle nobody looked at for hours is restarted entirely over a context
that may have changed.

## Decision

1. **Alive is per task.** The rescue asks the lead (`{:em_voo?, task_id}`); a
   lead too busy to answer counts as alive.
2. **A pending human decision holds the rescue.** A `pending` action from a gate
   actor (`qa*`, `secops*`, `appsec`) in the cycle's session: log only.
3. **A 2 h ceiling, by last activity.** Age counts from `updated_at`, the same
   column as the staleness threshold, and not from `inserted_at`: `upsert!`
   touches `updated_at` on every subagent, so a cycle that advances is not old;
   counting from creation would park long, live cycles. Above the ceiling, the
   row gets `parked_at`, the session log gets `gate.rescue_parked` (task, gate,
   age, reason) and the sweep stops seeing it — boot and tick.
4. **Resuming requires a human gesture**, through
   `GateRescuer.retomar_estacionado/3`. A new in-flight entry of the same cycle
   clears the mark.

## Consequences

- There was no human path to resume a gate cycle; the minimum delivered is the
  engine function, called by the operator. An internal route and a button on the
  event remain proposed, not done.
- The pending item is read by SESSION, not by task: `proposed_actions` has no
  `task_id`. Two tasks in the same session with a pending QA action hold each
  other — an accepted price, the worst case is not rescuing, never paying twice.
- Rule: [RN-722](../business-rules.md#rn-722), which revises RN-140.
