# ADR 0064 — Area scope in the model cascade, and the global agent binding

- **Status:** accepted
- **Date:** 2026-08-09
- **Prior context:** [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)
  (capabilities in two layers, and `resolveBinding` revalidating when it
  falls back a level), [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)
  (areas as data per project, `agent_areas`/`agent_area_members`), PHASE 18
  (the area is born with the project, RN-094)

## Context

The user's request: "for area leads and their subgroup to be together, giving
the option to choose the same current model for both." His decision came
along with it — the area's model is a **heritable default**: a specific agent
can diverge, and the UI shows who inherits and who diverged.

The binding cascade (`domain/llm/binding-resolver.ts`) today resolves
`session > agent > project > workspace`, one binding per scope, the most
specific one winning. `agent_areas`/`agent_area_members` (ADR 0053, PHASE 18)
are already real data per project — lead, subagents and the parallelism cap.
What's missing is for the area's MODEL to enter that same cascade.

That raises a positioning question: between which two levels does the area
go? And a second one, which only shows up when trying to answer the first,
is the heart of this ADR.

### The inconsistency: agent binding is GLOBAL, area is PER PROJECT

`SetModelBindingUseCase.execute('agent', agentSlug, ...)` writes with
`scope_id = agentSlug` — a SLUG, with no project. `PUT
/projects/:projectId/agent-bindings/:agentSlug` receives `:projectId` in the
route and **explicitly discards it**: the comment in the code already said
this is intentional. Choosing the Architect's model on one project's screen
changes their model in EVERY project where they exist.

Area, by contrast, has been per project since ADR 0053 — the same `qa` area
in two different projects can have different caps and (now) different
models.

Putting a PER-PROJECT scope above a GLOBAL scope in the same cascade is a
factual contradiction, not just a stylistic one: the same agent would
resolve different models per project **only where an area happened to be
configured**, and the same everywhere else — behavior that depends on a data
accident, not a rule. There are two mutually exclusive ways out:

1. **The agent binding becomes per project.** Changes a behavior that had
   existed since Phase 9a.
2. **The area sits BELOW the agent in the cascade.** Keeps the agent global,
   but contradicts "heritable default" — the area could never be the
   default for an agent that already has a binding (which is the common
   case, because TODAY almost every registered binding is an agent's, with
   no level between it and the project).

## Decision

**Option 1 was chosen: the agent binding becomes per project.**

The cascade gains the `area` level, between `agent` and `project`:

```
session > agent > area > project > workspace
```

The area is the DEFAULT that a lead and its area's subagents share; the
agent's own binding is the explicit DIVERGENCE that overrides it. That
ORDER — not just the level's existence — is the user's decision being
honored: if area came above agent it would always win, and "heritable
default" would, in practice, be "imposed default."

For the position to make sense without the contradiction of a global scope
sitting above a per-project scope, the `agent` binding had to stop being
global. The `scope_id` of `agent` and `area` became **composite**:
`<projectId>:<agent slug | area key>`. No new table: project `UUID`s and
slugs/keys never contain `:`, which makes the first `:` an unambiguous
separator (`domain/llm/binding-scope-id.ts`), and the old format (no `:`)
is **rejected** on write — writing it would create a binding the cascade
would never find again, invisible instead of an error.

Migration 0040 spreads each existing global agent binding into one row per
project, preserving the model each project was resolving to before the
change, and removes the old format. It's a spread, not a "pick an owning
project": the global row never held information about who it belonged to.

**The new level enters the same capability revalidation that already
existed** (ADR 0041/RN-041/RN-043): an area model that vanished from the
provider or doesn't support tool calling is skipped and recorded in
`skipped`, exactly as already happened for `agent`. `area` also came to
require `supports_tool_calling` (`assertModelFitsBindingScope`) — it's
never read by human chat, only by agents, and letting it pass would just
postpone the same silent failure to another level.

**"Go back to inheriting" deletes the binding, it never copies the model
from the level below into the one above.** `DELETE
/projects/:id/agent-bindings/:slug` and `DELETE
/projects/:id/area-bindings/:key`, both 204, both 404 when the scope
already inherits. Writing the area's chosen model into the agent would look
the same on screen and isn't: it would become a copy, and the area's next
change would leave that agent behind silently — inheriting is the ABSENCE
of a decision of one's own.

Changing an AREA's model requires the `maintainer` role, not `developer`
like an individual agent's — the same reason as the parallelism cap
(RN-083): the area's binding reaches the lead and every subagent at once,
and choosing a model is deciding how much the product spends without
asking. The agent binding stays at `developer`, as it already was.

The UI (`AreaModelsSection` in `ProjectSettingsTab.tsx`) lists each area's
default next to the agent table; the agent table's Origin column gains
"go back to inheriting" when `origin === 'agent'` — the agent diverges,
from an area when it has one, or from the project/workspace when it
doesn't.

## Consequences

- **The cascade grows from four to five levels**, and every consumer that
  enumerated the four (tests, DTOs, `ORIGIN_TONE` in the UI) needed the
  fifth. It's a one-time cost; the structure (capability revalidation,
  `skipped`, explicit origin) already existed and just extended.
- **The agent binding stopped being global.** Whoever depended on the
  global slug — three seed/demo scripts — started writing per project
  (`chaveDeAgente(projectId, slug)`). There's no longer a way to set "one
  model for this agent everywhere"; whoever wants that today configures it
  per project, or configures it at the `workspace` level (which stays
  global and remains everyone's fallback).
- **The area has no binding table of its own** — it reuses
  `model_bindings` with `scope = 'area'`, for the same reason `agent`
  always reused it: no binding attribute depends on the scope type, only
  on `scope_id`.
- **A composite `scope_id` is an implicit format**, not enforced by a
  database constraint (it's `text`). The validation lives in a single
  function (`assertScopeIdBemFormado`), and it — not the schema — is what
  prevents the phantom binding. If `area`/`agent` ever get their own table,
  this format becomes its `id` and `scope_id` goes away.
- **Inheriting an area default doesn't reach subagents outside the
  catalog**: an agent's area is resolved through the static catalog
  (`agent-areas.ts`), which already covers the dynamic `dev` area through
  the `ehDevDeModulo` predicate without a round trip to the database — no
  new query against `agent_areas` was necessary.
