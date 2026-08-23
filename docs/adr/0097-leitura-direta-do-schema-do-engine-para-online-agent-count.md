# ADR 0097 — Direct read of the engine schema for the dashboard's "N agents online"

- **Status:** Accepted
- **Date:** 2026-08-18
- **Context:** closing of the backlog item "N agents online in the
  dashboard" (RN-409), inherited from the dogfooding harvest (Phase 13c)

## Context

The dashboard needed a REAL liveness number — how many agents are working
or have a pending decision awaiting them right now, never team size or
historical presence (a product decision already made, see RN-409). The
prior investigation confirmed that this data only existed in TWO different
places, and neither served the dashboard as is:

1. Real live status only existed on the CLIENT, derived from the event log
   (`deriveAgentRoster`), and only when a project is OPEN — the dashboard
   lists all projects at once, without opening any session.
2. Each dev agent's current state is already persisted —
   `dev_agent_states`, an ENGINE table, in the Postgres schema `"engine"`
   (Ecto), with composite key `(project_id, agent_id)` and `status` as one
   of five values (`working`/`idle`/`idle_tripped`/`awaiting_gate`/
   `awaiting_approval`, RN-047/ADR 0052).

`api` and `engine` share the SAME physical database (`brabo`/`brabo_test`),
with the SAME connection user/role (`brabo`), separated by schema — not by
instance or credential. The communication convention declared in
CLAUDE.md ("events via Postgres + internal HTTP with service token for
synchronous commands") covers EFFECTS — commands that change state on the
other side —, not report reads. And there's already precedent for direct
cross-schema reads: `apps/api/scripts/medir-execucao.ts` (Phase 13b)
already reads `engine.oban_peers` via raw SQL through the same path, to
detect an engine restart during a measured execution — but only as a
manual SCRIPT, never covered by an automated test.

The dashboard's read model (`DrizzleProjectsSummaryRepository`, RN-090)
requires ONE aggregated query per ENTIRE WORKSPACE, never one per project —
that's the property `projects-summary.repository.spec.ts` proves constant
against 2 and 20 projects.

## Decision

The count of dev agents online reads `engine.dev_agent_states` DIRECTLY,
via batched raw SQL per workspace (`WHERE project_id IN (...) AND status
NOT IN ('idle', 'idle_tripped') GROUP BY project_id`), inside the SAME
`Promise.all` that already batches the read model's other eleven
queries — raising the pattern from `medir-execucao.ts`'s manual script to
tested production code (a fixture of the table in
`test/support/global-setup.ts`, under the same `"engine"` schema).

The alternative considered and REJECTED was exposing a new internal HTTP
route on the engine (`GET
/internal/dev-agent-states/online-counts?projectIds=...`) and calling it
from the api. Three reasons:

1. **The RN-090 property is about SQL queries, not network calls.** An
   HTTP dependency inside `DrizzleProjectsSummaryRepository` — today a
   PURE database-read repository — would introduce a network failure into
   a path that today can only fail because Postgres is down, and the
   query-count test (`pool.query`) would stop seeing the real cost of the
   call.
2. **The data is STATE, not COMMAND.** The internal HTTP convention exists
   to synchronize ACTION between the two sides (activate an agent,
   revalidate an instruction) — reading a state table that already exists
   physically right next to it is the same kind of read the api already
   does of itself, just through a different schema.
3. **Smaller new surface.** A new internal HTTP route would require
   service-token authentication, its own DTO, contract tests on both
   sides — a bigger cost than one more SQL query inside a `Promise.all`
   that already sums fourteen.

## Consequences

- `DrizzleProjectsSummaryRepository` now depends on a table the api does
  NOT migrate. The accepted assumption: whoever operates the product
  migrates both sides together (`db:migrate` AND `engine:migrate`) —
  already the implicit assumption of the rest of the product (without
  `engine:migrate`, no agent comes up, and the dashboard would show zero
  history anyway). If only the api has migrated, the query FAILS — there's
  no try/catch hiding the error; the whole dashboard errors loudly and
  visibly, not just one card silently missing its number.
- `brabo_test` (the api's vitest test database) gained a MINIMAL fixture of
  the `"engine"` schema — `CREATE SCHEMA IF NOT EXISTS engine` +
  `CREATE TABLE dev_agent_states (project_id, agent_id, status)` — in
  `test/support/global-setup.ts`, DECLARED as a partial copy of the real
  engine migration
  (`apps/engine/priv/repo/migrations/20260724124356_create_dev_agent_states.exs`),
  not a second migrator. If the real migration ever changes the name/type
  of those two columns, this fixture has to be updated manually — that's
  the declared price of this decision.
- If the engine ever gains MORE consumers of dev-agent state from the api
  side (not just counting), the pressure to promote this to a proper
  internal HTTP route — with a contract and tests on both sides — grows.
  This ADR doesn't close that door; it just declares that ONE batched read
  consumer doesn't pay the cost of opening it yet.
