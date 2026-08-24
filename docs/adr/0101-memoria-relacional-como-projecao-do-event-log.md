# ADR 0101 — Relational memory as an event log projection; templates consumed without touching GenServers

- **Status:** Accepted
- **Date:** 2026-08-20
- **Context:** consumption of the graph foundation (RN-416/417),
  companion to [ADR 0099](0099-neo4j-grafo-de-conhecimento-e-templates.md)/
  [ADR 0100](0100-rag-search-e-modelos-garantidos-no-boot.md)

## Context

The previous wave built the graph foundation (Neo4j, versioned
templates, `rag_search`) with no real consumer. This wave connects the
two sides: (1) three agents start resolving their kickoff/identity
from a graph template, falling back to the inline text; (2)
Psychologist and Anamnese start composing "N most recent"/"time
window" with RELEVANT excerpts from the project via `rag_search`; (3)
the graph starts writing itself, by projecting the event log.

Two design questions needed answers BEFORE parallelizing: how to
consume templates without rewriting the GenServers entirely, and how
to write to the graph without opening a second write path from the
engine.

## Decision

**Templates: `InstructionFiles` gains a `:graph` source, with no
contract change.** Final precedence: **`db > graph > dir > root`** —
the user's `instruction_patch` still beats everything (an already
established rule: the user can always override); the graph beats what's
on disk. `PromptAssembler` doesn't change; no agent GenServer loses a
single line of logic — each one just starts TRYING to resolve the
template before falling back to the inline text. ETS cache is reused
(no new parallel cache), short TTL.

Two flags, deliberately SEPARATE: `graph_templates_enabled?`
(Psychologist + Anamnese, same key, same kickoff consumer) and
`graph_instruction_templates_enabled?` (ux-designer, via
`InstructionFiles`). A single key would collide with OPPOSITE defaults
between the two fronts that wrote them in parallel — and Elixir's
`config/2` resolution with a duplicate key keeps the LAST occurrence,
silently overriding one of the two WITH NO ERROR AT ALL. Two
unmistakably named keys is cheaper than coordinating a single value
between parallel fronts. Both defaults are `false`: the new capability
is born off until the seed runs and someone deliberately turns it on —
the same criterion as `psychologist_enabled?`/`anamnese_enabled?`.

**Relevance: composition, never replacement.** Psychologist and
Anamnese keep reading what they always read (recent events / time
window) and GAIN a second source, `rag_search`, with a query derived
from the analysis TRIGGER (the classified termination cause, for
Psychologist; competencies with no profile yet, for Anamnese — never
free-text hypothesis/hesitation, following the already established
ban on Anamnese ever inferring health/personality/age/gender).
`Triage`'s existing caps (`max_prompt_events`, `max_payload_chars`)
CONTINUE to be the total budget — relevant excerpts eat into the
recents window's slots, never add on top. `degraded: true` from the
RAG shows up explicitly in the assembled context, in both agents —
never hidden. RAG failure is strictly additive: with no hit, the
behavior is IDENTICAL to before this wave (which is what kept the
~50 pre-existing tests green without touching a single one).

**Relational memory: projection of the EXISTING outbox, its own
aggregate_type.** The obvious alternative — the engine writing to the
graph directly — was rejected: it would open a SECOND write path
besides the event log, breaking the guarantee that the event log is
the single source of truth. The alternative of reusing the
`aggregateType: 'session'` the outbox already has was also rejected:
`Engine.Outbox.Drain` on the engine side already drains that type
every ~2s and marks `processed_at` — a consumer on the api side racing
against the same type would lose the race almost every time. The
decision: a SECOND outbox line, same transaction, `aggregateType:
'graph_projection'` — a value the engine's filter (`IN ('session',
'task')`) never matches, the same pattern `deny-action.use-case.ts`
already uses to write to two `aggregateType`s in the same transaction.
`GraphProjector` (a poller, ~2s, the same shape as
`DomainGaugesCollector`) drains this queue and calls the already
existing write use cases (`RecordHandoff`, `RecordHypothesis`,
`RecordAnamneseProfile`, `RecordInteraction`) — idempotency lives IN
THEM, the projector doesn't duplicate the logic.

## Consequences

- The graph remains reconstructible by replay: `graph_projection` is a
  queue DERIVED from the event log, never a second primary write —
  losing Neo4j and rebuilding from scratch is a replay, not data loss.
- A `GraphUnavailableError` mid-batch STOPS the whole cycle (it doesn't
  try the rest of the batch, which would fail for the same reason) —
  the row stays unprocessed and retries on the next cycle. Retry is
  automatic, with no intervention.
- Consumption declared OUT of this delivery, the same honesty pattern
  as the previous ADRs: `query_user_context` (hypotheses with evidence
  + profiles from the graph) still has no exposed HTTP route —
  Psychologist/Anamnese still don't READ from the graph, only the RAG
  (pgvector) via `rag_search`; only `psychologist.hypothesis_proposed`
  is projected (not `accepted`/`dismissed`); `context-manager-summarize`
  is the only one of the first wave's four templates still not
  consumed by any agent.
- Both flags (`graph_templates_enabled?`,
  `graph_instruction_templates_enabled?`) remain `false` in every
  environment until someone runs the seeder and deliberately turns
  them on — this delivery doesn't change observable behavior in
  production on its own.
