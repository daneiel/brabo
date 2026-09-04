# ADR 0085 — Role flow as a declarative registry (fluxo.yml)

## Status
Proposed

## Context
The product holds three truths about the agent team in three places:
the catalog (`agent-areas.ts`, single source, PHASE 18), the control
(`docs/gates.yml`, ADR 0054), and the RELATIONSHIPS — who delivers what
to whom — which only exist implicitly in prompts, use cases, and the ADR
history. An implicit relationship is neither auditable nor measurable.
The team model designed in Aug/2026 (market-profession map → agents)
produced this third piece with nowhere to live, and auditing it against
the product diverged on exactly four points for lack of it.

## Decision
`docs/fluxo.yml`, versioned, segmented by layer, with per-role contracts:
mission, typed inputs/outputs (artifact + origin/destination + via),
exit gate referencing gates.yml, status
(`active|planned|proposto|em-refinamento`) and declared absorptions.
Rules:
- A `proposto` role DECLARES who absorbs it today and the objective
  criterion for separation — the target org chart becomes an activation
  sequence, never an aspiration.
- A role that references a gate missing from gates.yml fails the test;
  an active gate with no owning role fails too.
- An `em-refinamento` role keeps its code untouched and drops out of the
  formal flow; the pending items the suspension creates are declared in
  the file itself.
- A relationship with `lacuna` status is trackable backlog, never a
  promise.

## Alternatives considered
- Keep it implicit: rejected — it was the absence of this piece that
  made the audit diverge from the product.
- Merge with gates.yml: rejected — control and relationship change for
  different reasons (ADR 0054 declares locks; this one declares
  contracts).
- Register only active roles: rejected — without the `proposto` ones
  and their criteria, every new capability would rediscover the model
  from scratch.

## Consequences
- Activating Staff/Platform and the proposed gates
  (necessidade-validada, adr-aprovado, implementavel,
  prototipo-validado) becomes a data change + its own ADR.
- Psychologist/Anamnese under refinement are left with visible pending
  items (author of the cap proposal RN-086; the Staff's trigger).
- The trigger table in modelo-de-time.md is the roadmap for future
  waves: each trigger fires the separation of the corresponding role.

## References
ADR 0038, 0053, 0054; RN-083/086/087; PHASE 15/18.
