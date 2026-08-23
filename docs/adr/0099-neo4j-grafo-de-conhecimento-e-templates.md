# ADR 0099 — Neo4j as knowledge graph and prompt templates, driver in the api

- **Status:** Accepted
- **Date:** 2026-08-19
- **Context:** foundation of the knowledge graph (RN-413/414/415), the
  product owner's decision to bring Neo4j into the product

## Context

Two real gaps in the product motivated this delivery. First: **no
agent consumes the RAG** that already exists (pgvector, hybrid
vector+lexical search, `HybridSearchUseCase`) — it's only used by the
"Chat RAG" web tab. Second: **every agent prompt is an inline Elixir
heredoc** — identities (`Engine.Harness.Agents`), kickoffs for
PO/Architect/Dev Lead/UX/Infra, the `ContextManager`'s summarization
prompt — none of it lives outside the code, versioned or reusable.

The product owner asked for Neo4j, inspired by the repository
[`ErickWendel/neo4j-ai-experiments`](https://github.com/ErickWendel/neo4j-ai-experiments),
which uses the graph as AI agent memory and keeps prompts in files
separate from application logic (a `prompts/` directory, with
templates named for NL→Cypher conversion, context, and response
formatting). **This project was the concrete inspiration for the
pattern adopted here** — the explicit thanks is warranted: without it,
the "prompt as versioned file, not string embedded in code" shape
wouldn't have had such a direct precedent to follow.

## Decision

Neo4j enters as a **knowledge graph** — memory DERIVED from the event
log, never the source of truth — with two responsibilities:

1. **Versioned prompt templates** (`PromptTemplate`/`PromptVersion`),
   gradually replacing the inline heredocs (migrating the GenServers
   themselves is a future wave; this delivery only builds the
   foundation).
2. **Relational memory**: user interactions, Psychologist hypotheses
   with evidence (`EVIDENCIA` → `Evento{sessionId,seq}`), Anamnese
   proficiency profiles, handoffs between agents.

**pgvector CONTINUES to be the vector index for chunks** — the graph
stores no embedding at all. Storing the same vector in two databases
would diverge on the first reindex that only touched one of them; the
decision was to keep ONE vector source with the graph as a
RELATIONSHIP layer on top.

**Driver: `neo4j-driver` (official package) in `apps/api`, not the
engine.** The api already owns ALL persistence for the product
(Postgres, pgvector, `permissions.json`) and the existing RAG; the
engine already consumes everything over internal HTTP with a service
token, and has never opened a direct connection to a domain database.
Repeating that pattern — engine calls an internal route, api talks to
the database — keeps ONE credential/pool boundary instead of two.

**Minimal schema, with uniqueness constraints** (Neo4j Community has
no composite NODE KEY, only `IS UNIQUE` on a single property):
`PromptTemplate.name`, `Usuario.id`, `Projeto.id`, `Agente.slug`,
`Interacao.sessionId`. `Hipotese`/`Handoff` use MERGE on their own
natural key (hypothesis id; handoff `(sessionId, seq)`) with no formal
constraint — idempotency comes from the MERGE, not an extra structural
restriction.

## Degradation, not crash

`GraphStore.onModuleInit` NEVER throws. Three environment variables
(`NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD`) are **required in
production** (fail fast at boot, the same spirit as `GIT_OAUTH_STATE_SECRET`
in ADR 0059) and **optional outside it** — nobody needs to spin up a
local Neo4j just to run the api's suite. When absent or unreachable,
the driver stays `null` and every operation throws
`GraphUnavailableError`, converted to 503 (never a raw 500) by the
global `GraphErrorFilter`, or into a degraded response in the use
cases that have a fallback (RAG search without graph enrichment, for
example).

## Consequences

- The graph is reconstructible by replaying the event log/outbox (see
  Wave 2, RN-416) — never a second source of truth to keep in sync by
  manual discipline.
- Migrating the GenServers' inline kickoffs to consume graph templates
  is a LATER wave, declared out of scope here — this ADR only
  establishes that the mechanism exists and is safe to introduce
  gradually.
- An accepted consequence, new for the product: this is the first
  infrastructure dependency that is neither Postgres nor Ollama. The
  `docker-compose.yml` gains one more service for anyone running
  `pnpm dev` locally, with a bounded heap (the reference dev machine
  has 15 GB, already split between Postgres, Ollama, api, engine, and
  web).
