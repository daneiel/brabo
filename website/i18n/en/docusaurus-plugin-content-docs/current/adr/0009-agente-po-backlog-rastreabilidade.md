# ADR 0009 — PO agent, backlog (epics/stories/tasks) and traceability

- Status: accepted
- Date: 2026-07-24
- Phase: 3b (session 2)

## Context

3b session 1 delivered the conversational Creative agent (emits
`business_rule`, consolidates `product_brief` and **offers** a handoff to the
PO — `handoffs` with status `offered`, activation rule requiring
`accepted`). This session closes the loop: the user **accepts** the handoff,
the **PO** is activated, consumes the brief + the rules and **produces the
backlog** (epics → stories → tasks) with DoD/DoR and a mandatory link to
business rules, maintaining rule→stories traceability.

## Decisions

### 1. PO as a conversational GenServer with a per-turn tool-use loop
The `Engine.Agents.PoServer` mirrors `CriativoServer` (per-session GenServer,
state + rehydration + streaming over the Phoenix channel), but **each turn
runs a bounded tool-use loop**: it dispatches `create_epic/create_story/
create_task` and **injects the result (id/error) back as a `tool` message**,
re-invoking the model — so it can chain calls (epic id → `create_story` →
`create_task`). The Creative agent doesn't do this (single-turn). Activated
by the accepted handoff (not by a user command), the PO runs a `:kickoff` on
a FRESH start (reads the brief + rules from the event log and generates the
backlog); a restart/reactivation does not regenerate it.

### 2. Backlog in its own tables; arrays as JSONB; rule link by ULID
`epics`/`stories`/`tasks` (migration 0011). Since the project **doesn't use
Postgres arrays**, RF/RNF/DoD/DoR/`business_rule_ids` are `jsonb`
(`$type<string[]>`). `business_rule_ids` references `session_events.id` (the
`artifact.business_rule` artifact) by **ULID text without an FK** — the same
choice as `handoffs.artifact_id` (a logical, not relational, link). Tasks
inherit the link from the story (derived, not stored).

### 3. draft→ready readiness validated in the DOMAIN
`domain/backlog/story-readiness.ts` (`assertReady` → `StoryNotReadyError`)
requires non-empty DoD, DoR, ≥1 RF and ≥1 linked rule — "validation in the
domain, not just the prompt". `story-state-machine.ts` covers
`draft→ready→in_progress→done`. `create_story` creates in `draft` and
promotes to `ready` in the same operation **when the rule is satisfied** (the
PO only uses the 3 named tools — there is no transition tool);
`TransitionStoryUseCase` exposes the explicit transition (tested) and serves
future states.

### 4. PO tools go through the api (never direct SQL/insert)
`create_epic/create_story/create_task` are `:direct` tools that call
`EngineApiClient` → internal endpoints → use-cases with domain validation.
`CreateStoryUseCase` **validates that each `business_rule_id` actually
references an existing `artifact.business_rule` event** (rejects made-up
ids; nothing is created). Each creation emits `backlog.*` to the event log
(the PO's narrative).

### 5. Rule→stories traceability (a gap = a discovery)
`domain/backlog/coverage.ts` (`computeCoverage`, pure) + `GET /projects/:id/
coverage`: for each `artifact.business_rule` of the project, which stories
cover it (via `business_rule_ids`). A rule with no coverage is a
**discovery** — the UI shows it in red on the Backlog tab. Project-level
(aggregates the rules from sessions via a join on `sessions`).

### 6. Accepting the handoff activates the PO via the session-1 rule
`AcceptHandoffUseCase` (a user action): `offered→accepted` +
`handoff.accepted` → calls `ActivateAgentUseCase` for the `toAgent`. The
activation rule (requiring an `accepted` handoff) now passes precisely
because of this acceptance. UI: "Accept handoff and start PO" button on the
session.

## Consequences

- The Backlog tab is project-level (local state, no new route), read from
  the `GET backlog` + `GET coverage` poll — reflects the PO generating it in
  real time.
- The session composer routes to the active agent (the PO takes precedence
  over the Creative agent) via `sendAgentMessage`.
- Tests: domain (`story-readiness`, `story-state-machine`, `coverage`),
  use-case (`create-story` rejects a nonexistent rule;
  `transition-story` rejects draft→ready without DoD), and `po_server_test`
  (kickoff chains create_epic→create_story with result injection; an invalid
  rule becomes an error tool-result without derailing the loop; broadcast;
  rehydration).

## Scope

Only the PO + backlog + traceability. The **Architect** (ADRs in the
project repo's docs/adr/, `module_map`, validating that a story references
an existing module) is the next session. `in_progress`/`done` and manual
backlog editing in the UI are left for later (the state machine already
covers them).
