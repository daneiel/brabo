# ADR 0077 — Model ranking by capability, with no invented score

- **Status:** accepted
- **Date:** 2026-08-15
- **Context:** PROGRAM 28, Wave 2, front H2 — design handoff, Settings item 5
  ("Best models by capability") and item 6 ("Models by agent", dropdown with
  an "ideal" badge)
- **Extends:** [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)
  (capability declared only when proven), [ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
  (curation is always manual), [ADR 0051](0051-facetas-de-capability-e-curadoria-por-uso.md)
  (`uses` as workspace curation, not capability — [RN-057](../business-rules/custo.md#rn-057))

## Context

The handoff (`design_handoff_brabo/README.md`, section 7) asks for two things
the Settings screen didn't have:

1. A RANKING table — "Best models by capability" — with columns capability,
   recommended, alternative, **score**, and "used by". The mock example shows
   numbers like "code → claude-sonnet-4 / qwen2.5-coder:14b (9.4)".
2. A green **ideal** badge in the `ModelPicker` dropdown, "when the model
   covers ALL the capabilities the agent requires".

Both ask for the same kind of data the product doesn't have, and the
investigation before coding confirmed this through TWO independent paths.

### The score is fictitious

"9.4", "9.1", "8.7"... are numbers from the MOCK, with no correspondence in
any provider catalog nor in any metric the product computes. No provider
publishes "code quality" and the product doesn't measure success rate,
satisfaction, or any proxy for that. Copying the mock's numbers into
production would mean showing fabricated data as if it were measured — the
same "guess dressed as data" that [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)
forbids for MODEL capability, now applied to quality.

### "Capabilities the agent requires" doesn't exist in the domain

The code search (web and api) found NO structure at all binding an
`AgentKey` to a set of required capabilities. More than that: `ModelsSection`
(`ProjectSettingsTab.tsx`) itself had already decided this before this front
— the column in the design was "Agent · capabilities" and the code renamed
it to just "Agent", with the comment "the capabilities required per agent
don't exist in the domain, and promising a column with no content is worse
than not promising one". Inventing an `AgentKey → UsoDeModelo[]` table now,
even "declared" by hand like `color`/`icon`/`initials` in `agents.ts`, would
contradict that decision without revoking it — and it's exactly the kind of
product classification CLAUDE.md reserves for an explicit user decision, with
an ADR.

There's a second barrier, structural, that closes the question even if the
first didn't exist: the `ModelPicker` used to bind a model to an agent reads
`GET /projects/:projectId/models` (role `viewer`), which returns a plain
`Model`. Curation (`uses`, ADR 0051) only exists on `ModelComCuradoria`,
served by `GET /workspaces/:workspaceId/models/catalog` — which requires
`maintainer`. Painting a badge that depends on `uses` in that picker would
require either (a) raising the agent picker's access level to `maintainer`
(an RBAC step-back nobody asked for), or (b) opening a new route that leaks
`uses` at a lower level — both are a change to the access boundary, a
product decision in its own right.

## Decision

**The "ideal" badge is NOT built.** It's documented in
`apps/web/src/components/ModelPicker.tsx`, at the spot where the handoff
asked for it, with the two reasons above. It isn't a regression: the badge
never existed. It's a declared pending item, like the ones PHASE 26 already
left for blame/PRs before 26b.

**The "Best models by capability" block IS built, with two REAL signals and
no score:**

| handoff column | what the screen shows now | where it comes from |
| --- | --- | --- |
| score | *(removed)* | no data exists — see above |
| recommended / alternative | the top two models, among the ones curation (`uses`) marked for that capability | `workspace_models.uses` (ADR 0051), never computed |
| used by | count of agents in THIS project whose current binding resolves to that model | the same cascade `ModelsSection` already reads (`getAgentModelBinding` per agent) |

Tie-breaking between candidates is by COST (`inputPricePerMillionMicros`
ascending) — real, from the catalog, never a quality proxy. The priority
ORDER is real usage first (how many agents in the project already resolve to
that model), cost second: "what the team already chose" is the most honest
signal available without inventing a score. A capability with no curated
model shows "no curated coverage" — the line never disappears, same pattern
as `fallbackDe`/the Origin column in `ModelsSection`.

The section (`MelhoresModelosPorCapacidadeSection`,
`apps/web/src/routes/ProjectSettingsTab.tsx`) reads
`GET /workspaces/:workspaceId/models/catalog` — the same route as
`ModelCatalogSection`, and thus inherits the SAME visibility (`maintainer`):
this isn't a new screen with its own access rule, it's the same question
("how did this workspace curate the catalog?") answered a different way.

## Consequences

- Anyone who isn't a workspace `maintainer` doesn't see this section — same
  as the existing `CatalogoDeModelos`. Not a new rule.
- "Recommended" changes when the team switches models (real usage) or when
  the owner manually re-prices (`manualPricing`) — never on its own: there's
  no job recomputing anything, it's derived at read time.
- If the product ever gains a real quality metric someday (proposed_action
  success rate by model, for example), it comes in as a NEW COLUMN, not a
  replacement for "used by"/cost — the two questions ("what does the team
  use" and "what performs better") are different, same argument as
  [ADR 0063](0063-duas-audiencias-para-o-mesmo-gasto.md) for not merging
  different questions into a single metric.
- The "ideal" badge stays in the `docs/explanation/backlog.md`-equivalent
  backlog only if the user decides "capabilities required per agent" is
  worth existing as data — which is a product decision, not an automatic
  resumption of this front.
