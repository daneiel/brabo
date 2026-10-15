---
traducao_de: e48d6fadf002507531282196656b6b651acd9ed5
---

# ADR 0198 — Semantic duplicates of stories and rules are warned by embedding with a threshold, and the spending enters metering

## Status

**Accepted.** 2026-10-01 (AT-171, story HS-047, epic EP-026, round 36; owner
decision on 01/10: *"embedding with a threshold, only warns"* — it compares at
emission against the project's existing stories and rules and WARNS above the
threshold, never blocks; the embedding spending of this check enters metering as
its own row). Opens ONE exception to the metering cut of
[ADR 0075](0075-embeddings-no-contrato-de-llm-provider.md) without editing it:
the cut still holds for RAG indexing and search
([ADR 0080](0080-busca-hibrida-pesos-limiar-e-citacao.md)); only this check now
records `token_usage`. Closes the half that
[RN-080](../business-rules/custo.md#rn-080) and
[RN-081](../business-rules/custo.md#rn-081) declared out of reach, without
changing either: the EXACT duplicate is still refused.

## Context

Measured in the `dev` code on 2026-10-01, before changing:

- **Where emission happens.** Story: the PO's `create_story`
  (`apps/engine/lib/engine/harness/tools/create_story.ex`) calls
  `POST /internal/sessions/:id/stories`, and whoever creates is
  `CreateStoryUseCase` in the api — an equal title refuses, a contained
  justification warns (RN-081). Business rule: `emit_artifact` (the Criativo and
  five other conversational agents) records the `artifact.business_rule` event
  through the api (`append_event`), after `ArtifactDedupe` refuses an equal title
  (RN-080). There is no rules table: the rule IS the event. Neither server
  (`po_server.ex`, `criativo_server.ex`) needed to change — emission lives in the
  two tools.
- **How the RAG calls `embed`.** Through a single point,
  `RagEmbeddingService`, with a FIXED provider and model
  (`ollama`/`nomic-embed-text`, 768 dimensions — RN-222/233): the only provider
  declaring `capabilities.embeddings` (RN-191). Failure becomes
  `available: false` with a reason, never an exception. The service discarded
  the `inputTokens` the contract returns — the 0075 cut.
- **Whether vectors are stored.** They are not. `chunks` indexes
  `chat.message`, `agent.response`, `docs/` and ADRs; no `artifact.*`, no story.
  The check has to vectorize on the spot.
- **Why the 0075 cut does not reach this check.** Its reason was structural:
  `token_usage.session_id` is `NOT NULL`, and indexing a repository does not
  happen in a session. Emitting a story or rule ALWAYS happens inside an agent's
  session — the `session_id` exists.

## Decision

1. **What it compares.** The new TITLE against the titles of the existing ones of
   the SAME type in the PROJECT (story with story, rule with rule), by cosine
   between vectors from the RAG model, called through the SAME
   `RagEmbeddingService` — never a second path to `embed`. Title, and not
   title+description: finding R's pair is of titles, and the description changes
   size and tone between the model's turns (cost and noise with no case asking
   for it). The exact duplicate (equal normalized title) is not this ADR's
   subject — it is refused earlier, by RN-080/081, and for that reason also
   leaves the comparison.
2. **It only WARNS.** The check runs AFTER recording: the story and the rule
   exist with or without a warning. The warning goes back to the agent as part
   of the tool result (`create_story`, `emit_artifact`) and stays in the log as
   `backlog.semantic_duplicate_warned`, naming the similar item and the number.
3. **The threshold is 0.80, an uncalibrated STARTING POINT** — like the four
   numbers of 0080's hybrid search. "From": equal warns. See "What was not
   measured". Erring low costs one more warning, which blocks nothing; that is
   why a provisional number fits here and would not fit in a refusal.
4. **Without an embedding provider, the check is SKIPPED and STATED.** Missing
   capability, daemon down, model not pulled, or the time ceiling — all become
   `status: skipped` with the reason, narrated as
   `backlog.semantic_duplicate_check_skipped` and in the sentence to the agent.
   It never fails the emission, it is never silent: without this, "no warning"
   would read as "not a duplicate".
5. **The spending enters metering as ITS OWN ROW.** Through the only path,
   `RecordLlmUsageUseCase`, with actor `system`/`duplicata-semantica` (outside the
   per-agent sums, RN-038, and area spending, ADR 0110), the RAG's
   provider/model, `output_tokens = 0`, `input_tokens` and `estimated` from what
   the provider said, catalog price when the model is in it (otherwise 0, with a
   null `model_id`). `RagEmbeddingService` now RETURNS the summed usage (`uso`);
   indexing and search ignore it, and that is what keeps 0075's cut for them.
6. **Ceilings.** The 100 MOST RECENT existing ones, at most
   (`TETO_DE_COMPARACOES_DE_DUPLICATA`), in a single batch; when it cuts, the
   result says how many of how many (RN-180). And 10 s of wall clock for the
   whole check (`TETO_DE_TEMPO_DA_CHECAGEM_MS`), below the 15 s of the engine's
   `Req` that calls it: Ollama's timeout reaches 300 s in the installation, and
   the check is on the path of an agent tool.
7. **No migration.** Nothing is stored: no vector, no new column. The own row in
   `token_usage` is distinguished by the actor, which already exists.

## Consequences

**The cost of emitting now grows with the project.** Each emission vectorizes
`min(N, 100) + 1` titles, N = existing ones of the same type. A story or rule
title has 5 to 15 words; with the `nomic-embed-text` tokenizer that is ESTIMATED
at 10–30 tokens per title, i.e. up to ~3,000 input tokens per emission at the
ceiling — with local Ollama, catalog price 0 and cost 0 micros; what grows is
LATENCY, not measured here. The real number comes from metering, which is what
the row exists for. Storing each item's vector (a column in `stories`, a table
for the rule-events) would reduce it to one call per emission, and is a
migration — left for when the measured cost asks for it.

**Finding R's pair stops going unnoticed — if the threshold is right.** And that
"if" is this decision's gap (below).

**The warning sentence has ONE source**, `fraseParaOAgente` in the api; the
engine only passes it on. The same check serves both types.

**What still passes.** A duplicate whose meaning is in the DESCRIPTION and not
the title ("Saudação com nome" × "Quem chama pode se identificar", RN-080's
example) is not compared. A warning lost to timeout is stated, but the check is
not redone. And the budget with `policy = 'block'`
([RN-019](../business-rules/custo.md#rn-019)) is not checked BEFORE this call:
the row adds to spending and may cross the thresholds, but the check is not
refused for an exceeded budget — it blocks nothing, and with local Ollama the
recorded cost is 0. If a paid embedding provider comes in, that choice is back on
the table.

**What this ADR does NOT change:** the refusal of the exact duplicate
(RN-080/081), the metering cut of indexing and search (ADR 0075), the RAG's fixed
model and provider (ADR 0080), and no conversational server.

## What was not measured

The owner's decision asked to calibrate the threshold with finding R's pair and
with pairs that are NOT duplicates, proving it by a test with recorded vectors.
The environment where this change was born **could not reach** the Ollama
registry (`registry.ollama.ai`: 403 at the proxy) nor Hugging Face (403), and had
no daemon — measured on 2026-10-01. A hand-written vector would prove the hand,
not the model. What exists, then:

- `apps/api/test/fixtures/duplicata-semantica/pares.json` — the calibration
  pairs: finding R's and two paraphrases that MUST warn; five neighbouring-topic
  pairs that MUST NOT.
- `apps/api/scripts/gravar-vetores-de-duplicata.ts` — records `vetores.json`
  against real Ollama, with the model the daemon said it used, and prints each
  pair's cosine against the current threshold.
- `apps/api/test/domain/backlog/limiar-de-duplicata.calibracao.spec.ts` — runs on
  its own when `vetores.json` exists: every `duplicata` pair warns, every
  `distinta` passes. Without the file, it SKIPS with a named notice (the rule of
  Ollama's embedding smoke), never passes silently.

Until someone records the vectors, 0.80 is general knowledge about sentence
embedding models, not measurement. If the recording shows that no number
separates the two sides, the answer is to revise the pairs or the compared text —
never to loosen the test.
