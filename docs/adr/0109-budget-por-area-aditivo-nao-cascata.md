# ADR 0109 — Budget per area is ADDITIVE, next to project/session — not a cascade, and not a new table

- **Status:** Accepted
- **Date:** 2026-08-23
- **Context:** closes the "budget per area" item from the ADR 0038 cut, tracked since FASE 8 and last mentioned in ADR 0053's Consequences ("`budget per area`... is one step closer: the missing table now exists")
- **Extends (without editing):** [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) (`agent_areas`/`max_parallel`), [ADR 0063](0063-duas-audiencias-para-o-mesmo-gasto.md) (project/session budgets, `CheckBudgetGateUseCase`/`RecordLlmUsageUseCase`), [ADR 0064](0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md) (the DIFFERENT mechanism this one must not be confused with)

## Context

`agent_areas` (`dev`/`qa`/`infra`, per project) has had `max_parallel` since
FASE 14d — a cap the lead can spend without asking, above which the user
authorizes. Token spend, meanwhile, only had two ceilings: project and
session (`budgets` table, `CheckBudgetGateUseCase` blocking pre-call,
`RecordLlmUsageUseCase` incrementing post-call). Nothing capped what a
single AREA could burn — a dev area with five parallel agents and no
individual cap could spend as much as the session limit allowed, same as
one with a single agent, with no way to see or bound the difference per
area.

## Decision

### 1. Additive, not cascade — a different mechanism from ADR 0064

This is the finding this ADR exists to record, because the two mechanisms
share a vocabulary word ("area") and nothing else. ADR 0064's model-binding
cascade (`session > agent > area > project > workspace`) picks ONE winner —
the most specific scope that has a value overrides everything below it.
Budget doesn't work that way, and never has: project and session budgets
were already independent checks, each capable of blocking on its own
(`CheckBudgetGateUseCase.execute` runs both in parallel and returns
`blocked: true` the instant either one is over). Area budget joins as a
THIRD independent check, in the same `Promise.all`, with the same
either-blocks-it-all semantics. There is no "area budget overrides project
budget" or vice versa — an agent can be blocked by ANY of the three,
regardless of what the other two say.

### 2. The columns live on `agent_areas`, not the generic `budgets` table, not a new one

Three options were on the table:

- **The generic `budgets` table.** It has a CHECK constraint
  (`budgets_scope_check`) enforcing that EXACTLY ONE of `project_id`/
  `session_id` is set — the table's whole shape is built around mutual
  exclusion between two scopes. Wedging a third (`area_id`, needing its own
  compound key with `project_id` since areas aren't globally unique)
  through that constraint would mean reworking it into a three-way
  exclusion rule for a table that was never designed to carry more than
  two, and area is a fundamentally different kind of scope: it doesn't
  need `policy` (`block`/`allow`) or the 70/90/100 threshold notifications
  the other two have — it's a simpler on/off cap, no warn-only mode.
- **A new `area_budgets` table.** Technically clean, but it would mean two
  round trips (and two potential inconsistency windows) for every read and
  write that already touches `agent_areas` — the exact same shape of
  question `max_parallel` already answers directly on the row: "how much
  can this area's lead do without asking." A join for what's already a
  1:1 relationship with a row that's read on every parallelism decision.
- **`agent_areas.budget_micros`/`spent_micros` (chosen).** Mirrors
  `max_parallel` exactly — same table, same row, same "the lead's ceiling,
  the user's decision" pattern, same `setBudget`/`setMaxParallel` shape on
  `AgentAreaRepository`. `budget_micros` is nullable (`null` = no cap, the
  default — most projects will never configure one) with a CHECK
  (`IS NULL OR >= 0`); `spent_micros` is `NOT NULL DEFAULT 0` with its own
  CHECK (`>= 0`), incremented atomically (`spent_micros = spent_micros +
  delta`) by the same single metering path (`RecordLlmUsageUseCase`) that
  already increments project and session spend — SEMPRE, whether or not a
  cap is configured, so the area's real spend is visible from the first
  agent turn, before anyone sets a limit.

### 3. Resolving which area an actor belongs to uses the pure catalog function, not a membership query

`areaDo(agentId)` (`src/domain/agents/agent-areas.ts`, ADR 0053) already
answers "what area is this agent's lead or member of" WITHOUT touching the
database — it's a pure function over the static catalog (`qa`/`infra` fixed
members, `dev` matched by the `dev-` prefix, which covers `dev-<modulo>`
AND `dev-<modulo>-2` without needing to know the project's `module_map`).
`CheckBudgetGateUseCase` and `RecordLlmUsageUseCase` call it first, on just
the `agentId` string, and only query `AgentAreaRepository.findByKey` when
it returns a match — so an actor with no area (a human in chat, or an
agent outside any area) costs nothing beyond the one pure function call.
This is a DIFFERENT resolution path from `RequestParallelizationUseCase`,
which already knows the context is `dev` and looks up that key directly
(`this.areas.findByKey(projectId, 'dev')`) — it doesn't need to resolve an
arbitrary actor's area, only read the one it already knows about.

### 4. `maintainer`, no domain event, same reasoning as `max_parallel`

`SetAreaBudgetUseCase` mirrors `SetAreaMaxParallelUseCase`: `maintainer`
(changing a spend ceiling is deciding how much the product can spend
without asking, same rule as activating execution), and no event is
emitted (project configuration, no session to log into — the same
reasoning already recorded on `SetAreaMaxParallelUseCase`). Unlike
`max_parallel`, the value can be `null`, and clearing it is a first-class
input, not a separate delete route — same `ValidateIf`-over-`IsOptional`
DTO shape already used by `RenameSessionDto` (`name: null` clears the
session's name).

## Consequences

**For**

- The "budget per area" item leaves the backlog (`docs/explanation/backlog.md`)
  after being open since FASE 8.
- Area spend is visible even without a cap — `spent_micros` is not gated
  behind configuring `budget_micros` first.
- No migration cost beyond two columns and two CHECKs on an existing
  table — no new table, no new FK, no join added to the hot path
  (`agent_areas` is already read on every parallelism decision).

**Against**

- No threshold notifications (70/90/100%) for area budgets, unlike
  project/session — a deliberate simplification (item 2), not an
  oversight: if it proves necessary, it can be added later without
  touching the additive-vs-cascade decision.
- `RecordLlmUsageUseCase` now depends on `AgentAreaRepository` in addition
  to `BudgetRepository` — one more dependency in the single metering path,
  accepted because splitting it into two write paths would reopen exactly
  the "not obrigatório by construction" risk the class's own doc comment
  warns against.

## Alternatives considered

**A fourth `budgetScope: 'area'` value on the generic `budgets` table.**
Rejected in item 2 — the CHECK constraint and `policy`/threshold shape
don't fit a scope this much simpler, and area already has a natural home
(`agent_areas`) that `max_parallel` already proved out.

**Making it a cascade with project/session (most specific wins).** Would
have collapsed the difference between this feature and ADR 0064's model
binding, and would have been a WEAKER guarantee than what exists today —
"project budget always blocks, independent of anything else" would stop
being true the moment a lower scope could override it. Rejected outright;
recorded here mainly because the naming collision with ADR 0064 makes the
temptation to conflate the two real enough to warrant writing it down.

## References

- [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) — `agent_areas`/
  `max_parallel`, the pattern this ADR mirrors
- [ADR 0063](0063-duas-audiencias-para-o-mesmo-gasto.md) — project/session
  budgets, `CheckBudgetGateUseCase`/`RecordLlmUsageUseCase`
- [ADR 0064](0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md) — the model-binding cascade,
  a DIFFERENT mechanism from this one
- `apps/api/src/domain/llm/area-budget.ts` — `isAreaBudgetExceeded`, the
  pure predicate
- `apps/api/src/domain/agents/agent-areas.ts` — `areaDo`, the pure
  membership resolver reused here
- [RN-440](../business-rules.md#rn-440)
