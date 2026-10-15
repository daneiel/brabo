# ADR 0100 — `rag_search` for agents and Ollama models guaranteed at boot

- **Status:** Accepted
- **Date:** 2026-08-20
- **Context:** foundation of the knowledge graph (RN-413/414/415),
  companion to [ADR 0099](0099-neo4j-grafo-de-conhecimento-e-templates.md)

## Context

The RAG (pgvector, hybrid vector+lexical search, ADR 0079/0080/0082)
has existed in full in the api since Program 28's Wave 4/front G2 —
but `grep -rn "rag" apps/engine/lib` returned ZERO hits before this
delivery. **No agent had ever queried its own project's RAG.** It's
the biggest gap in the current design: the product builds an index and
only the "Chat RAG" web tab reads it.

Second finding, also real and unrelated to this feature:
`nomic-embed-text` (`RAG_EMBEDDING_MODEL` in `rag-search-limits.ts`)
**is never pulled automatically**. The `ollama` service entrypoint in
`docker-compose.yml` only pulls `llama3.2:1b`. In any clean
environment, the RAG silently degrades to lexical-only search until
someone runs `ollama pull nomic-embed-text` by hand — nobody had
noticed because the product never had, until now, a programmatic
consumer of search that would make the degradation visible early.

## Decision

**New tool `rag_search`** (`apps/engine/lib/engine/harness/tools/rag_search.ex`),
category `:direct` (read, doesn't go through `ActionPipeline`/
`proposed_action` — reading isn't an external effect, an already
established rule). Calls `POST /internal/rag/search` (a new api
route, reusing `HybridSearchUseCase` without duplicating search
logic) and formats hits with an explicit CITATION (`path` + excerpt),
so the model can reference the source of what it read. When the
response comes back `degraded: true` (embedding unavailable, search
fell back to lexical-only), that appears **at the start** of the text
returned to the model — never hidden at the bottom, where a byte-cap
truncation could erase the warning.

**Its own caps**, in the spirit of RN-150 (every read tool that can
overflow gets its OWN variable, never reused from another): `top_k`
clamped to a maximum (10) inside the tool itself, and a BYTE cap on
the formatted text (16 KiB, smaller than `search_workspace`'s/
`read_file`'s 32 KiB — each RAG hit is already a whole chunk+excerpt,
it accumulates bytes faster per item).

Registered in the default registry (`Engine.Harness.Tools`, serving
PO/Architect/conversational agents) and in the dev agent registry
(`Engine.Dev.Tools`). Also extended to the reading gates that already
cite an indexed ADR/convention (`QaTools`, `QaEstrategiaAgent`,
`AppSecAgent`, `QaPerformanceSegurancaAgent`) — but not
`Infra.WorkflowsAgent` (deliberately narrow, with no
`ReadFile`/`SearchWorkspace` today) nor Psychologist/Anamnese (they
reason over the event log, not the project's docs/code).

**`ollama-model-loader`**: a new one-shot service in
`docker-compose.yml` (dev and prod) that pulls `gemma:1b`,
`yi-coder:1.5b`, and `nomic-embed-text` via `OLLAMA_REQUIRED_MODELS` —
additive to the existing `ollama` service (whose entrypoint keeps
pulling `llama3.2:1b` for the engine's own use, untouched). Closes the
real bug of `nomic-embed-text` never arriving on its own, not just
this feature's need.

## Consequences

- The RAG capability for agents is declared only when exercised — the
  real roundtrip against `POST /internal/rag/search` depends on the
  api's route being up; the tool degrades with a legible error to the
  model (never crashes the `ToolLoop`, RN-163) when the api is down.
- `deploy/k8s/` gains minimal manifests for Neo4j and the model
  loader, DECLARED as unvalidated against a real cluster (the same
  discipline as the rest of `deploy/k8s/`: capability is only declared
  when proven).
- The embedding cost of `rag_search` still doesn't go through
  metering — the same gap already declared in ADR 0075 for RAG in
  general (`token_usage.session_id` is `NOT NULL`, and indexing
  doesn't happen inside a session).
