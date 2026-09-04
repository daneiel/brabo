# ADR 0098 — Consistent transport limits and effective compaction window

- **Status:** Accepted
- **Date:** 2026-08-19
- **Context:** fix for `413 request entity too large` on PRs
  (found through real use), RN-412

## Context

The QA/SecOps gate was dying with `413 request entity too large` on
legitimate PRs. Comments scattered across the code (`apps/engine/config/runtime.exs`,
`apps/engine/lib/engine/actions/terminal_executor.ex`, `docker/docker-compose.yml`)
attributed the error to the LLM PROVIDER. The investigation confirmed that
attribution was wrong: `Engine.Agents.FalhaDeTurno.origem({413, _})`
already classified the failure as `"codigo"` (code), not `"modelo"`
(model) — the classifier was correct, nobody had just followed the
trail to the end.

The real cause has two independent ends, and both need to close
together — fixing only one just postpones the overflow, it doesn't
resolve it:

1. **The api never configured an Express body limit.** `NestFactory.create`
   in `apps/api/src/main.ts` never touched the JSON parser, so the
   Express default applied: **100 KB**. Phoenix (engine) accepts bodies
   up to 8 MB. On the heaviest leg of the transport — engine → api,
   specifically `POST /internal/sessions/:sessionId/llm-turn`, which
   receives the ENTIRE conversation history on every `ToolLoop`
   iteration — the api was the narrowest bottleneck by a factor of 80×,
   without anyone having decided this: it was an absence of
   configuration, not a choice.
2. **The engine's context compaction was structurally unreachable
   before the overflow.** `Engine.Harness.ContextManager.Default`
   decides to compact when the token estimate exceeds
   `threshold * context_window`. Two defects pushed that trigger far
   past the transport limit:
   - `estimate/1` only summed the `content` field of messages.
     `assistant` messages with `toolCalls` (the format of a tool call)
     have empty `content` — the tool call arguments, which ARE real
     bytes in the HTTP body, counted as ~zero tokens.
   - The compaction window used only `context_window` — 128,000
     tokens across the five gate/dev agents (`qa_automacao_agent.ex`,
     `qa_performance_seguranca_agent.ex`, `qa_estrategia_agent.ex`,
     `appsec_agent.ex`, `dev_agent_server.ex`). With `threshold: 0.7`,
     that puts compaction at ~350 KB of estimated payload — well past
     any reasonable transport limit, and worse still when the estimate
     itself was already undercounting.

With a gate at 60 iterations (the ceiling for execution/gate agents)
and three to four 32 KiB tool results (the INDIVIDUAL cap already
closed by RN-150), the accumulated body exceeded 100 KB long before
compaction would even consider acting.

## Decision

**Both ends close in the same fix, deliberately together:**

1. `apps/api/src/main.ts` now explicitly configures the JSON parser
   limit (`app.useBodyParser('json', { limit })`), read from
   `API_JSON_BODY_LIMIT` with default `10mb` — headroom over the 8 MB
   that Phoenix already accepts, with no redeploy required if the
   engine's cap changes.
2. `Engine.Harness.ContextManager.Default` gains:
   - `estimate/1` now counts `content` of EVERY message PLUS the JSON
     serialization of `toolCalls` on `assistant` messages — the
     bytes-per-token heuristic is the SAME one the approximate
     tokenizer uses (`Engine.Harness.Tokenizer.bytes_per_token/0`, a
     new public function, to avoid duplicating the constant).
   - The EFFECTIVE compaction window becomes `min(context_window,
     transport_ceiling)`, where the transport ceiling is a NEW config
     (`transport_max_body_bytes`, default 8 MiB — the cap of the
     engine's OWN transport, not replicated across the five agent
     files, which keep declaring `context_window: 128_000` because
     that describes the MODEL, not the transport).
   - The cut between old messages (summarized) and recent ones
     (preserved) now respects the `ToolLoop`'s ITERATION BOUNDARY
     (`group_by_iteration/1`) — an `assistant` message with `toolCalls`
     and the `role: "tool"` messages that answer it always travel
     together to the same side of the cut. Cutting through the middle
     would break the provider's tool-use protocol (a tool result with
     no matching call in the history).

The general rule this ADR records: **compaction must trigger BEFORE
the body overflows the real HTTP limit, not before the model
"forgets" its window.** A transport ceiling that only exists implicitly
(a library's default) isn't a ceiling — it's a failure waiting for the
right payload.

## Consequences

- The value of `transport_max_body_bytes` (8 MiB) is declared config,
  not calibrated against real traffic — the same honesty rule the
  hybrid search (RAG) weights and the `search_workspace` caps
  (RN-150) already follow: an adjustable starting point, not a
  definitive number.
- Raising only the api's limit without fixing the engine's estimate
  (or vice versa) reintroduces the defect in another form: either the
  body keeps growing unchecked up to a bigger ceiling, or compaction
  starts acting too early and summarizes context that would still fit
  in the transport. Both ends were born in the same commit.
- `dev.awaiting_gate` as a dev agent state should get rarer in
  practice (the gate no longer dies to a 413 on a legitimate payload),
  but RN-412 also extends `DEV_PENDING_TYPES` to hold the session in
  that state — defense in depth, not a dependency on this ADR closing
  100% of the gate-slow/stuck cases for any other reason.
