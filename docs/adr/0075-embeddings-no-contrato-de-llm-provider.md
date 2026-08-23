# ADR 0075 — Embeddings in the LLMProvider contract

- **Status:** accepted
- **Date:** 2026-08-14
- **Extends:** [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md),
  [ADR 0043](0043-seis-providers-de-llm-e-o-fechamento-da-fase-9b.md)

## Context

The Chat RAG coming down the line needs to turn text into vectors, and the
product doesn't know how to do that. The search was literal: **the word
"embedding" showed up in one comment**, in the prose of `bitdeer-provider.ts`,
explaining that the only authenticated `curl` example found in Bitdeer's docs
was for their embeddings API. No provider implements the operation, no type
describes it, no capability declares it.

Three things make this more than "add a method".

**1. The capability is a new dimension, not a variation of the existing
ones.** Today's capabilities — `streaming`, `toolCalling`, `listModels`, and
the `supports_*` columns of `models` — describe how the model CONVERSES.
Embedding isn't a poorer conversation: it's a different operation, with a
different endpoint, a different body, and a different response type.

**2. The model layer here is EXCLUSION, not a gradient.** Tool calling
admits degradation: a model that doesn't request tools still answers with
text, which is why [RN-040](../business-rules.md#rn-040) only blocks agent
binding rather than banning the model outright. Embedding admits none:
`nomic-embed-text` doesn't answer a question and `llama3.2` doesn't return a
vector. They are two disjoint sets of models, and the question "is this
model an embedding model?" didn't fit into any existing column.

**3. Declaring by reading documentation has already cost money.**
[ADR 0043](0043-seis-providers-de-llm-e-o-fechamento-da-fase-9b.md) records
two LIVE reversals — DeepInfra and Vultr — of capabilities the docs promised
and execution disproved. Every cloud provider has a page saying it serves
`/embeddings`; none of them is proof.

## Decision

### The operation: `embed`, optional, with an error that THROWS

```ts
embed?(
  inputs: readonly string[],
  options: EmbeddingOptions,
): Promise<EmbeddingResult>;
```

Optional under the same two-sided contract `listModels` has followed since
Phase 9c: **whoever declares the capability implements the method, and
whoever doesn't declare it doesn't expose it**. Consumers degrade by looking
at the capability, never by discovering it on failure.

**Batch, not single.** An index receives N chunks at once, and every
provider accepts `input` as an array. Order is the only link between input
and vector, and from that comes the contract's most important guarantee:
**one vector per input or an error** — never a shorter list. A partially
rejected response is undetectable later, because the i-th vector would then
belong to a different sentence and the index would be silently wrong.

**The return carries four things**, each for a reason:

| field | why |
| --- | --- |
| `vectors` | the result, in the order of the inputs |
| `dimensions` | checked against what CAME BACK, not copied from the catalog — a vector index has a fixed dimension, and writing a different size fails far from the cause |
| `model` | what the provider SAYS it used, which isn't always the one requested (an alias resolves to a dated version) — this is what goes to metering, for the same reason as the frozen price ([RN-044](../business-rules.md#rn-044)) |
| `inputTokens` + `estimated` | embedding costs money, and the distinction "said zero" × "said nothing" is the same one from [RN-041](../business-rules.md#rn-041) |

**The error THROWS, normalized by `code`**, instead of turning into a chunk
like in `chat`. The reason for the chunk pattern is to preserve the spend of
a turn already in progress; here there's nothing to preserve — either the
provider returned the vectors and charged for them, or it didn't return them
and didn't charge. It's the same choice `listModels` made, with the same
argument, and the taxonomy is the SAME (`auth`, `rate_limit`,
`model_not_found`, `context_length`, `timeout`, `connection`, `upstream`): no
new code.

### The capability in two layers

**Provider** — `LLMProviderCapabilities.embeddings`, required (not
optional), by the same argument that made `code` required in
`ChatErrorChunk`: with an optional field, a new provider forgets to declare
it and nobody notices.

**Model** — `ModeloDoCatalogo.supportsEmbeddings` and `embeddingDimensions`,
both optional, because absence means **"the provider didn't say"** and is
never a made-up `false` (ADR 0041). Ollama is the only one of the nine that
publishes this per model: `capabilities: ["embedding"]` in `/api/tags`, with
`details.embedding_length` giving the dimension.

The `assertCanEmbed` guard checks the two in the order that fails best: the
provider first, because switching models doesn't fix a provider that can't
embed. It also rejects a model **without a declaration**, with a different
message — the reader's next action is to sync the catalog, not to switch
models. Inferring the capability from the model's NAME would be a guess
dressed as data, exactly what ADR 0041 forbids.

### The proof: one `true`, eight `false`

The contract suite gained five cases, run against every provider that
declares the capability: one vector per input in the right order, dimension
and model used, an incomplete batch turning into an error, provider errors
normalized by `code`, and an empty input list rejected before hitting the
network.

**Only `ollama` declares `embeddings: true`**, and the proof is execution:
`POST /api/embed` against daemon 0.32.1 with `nomic-embed-text`, two inputs
→ two vectors of 768 and `prompt_eval_count: 10`. The same run produced the
finding that became a test: **a chat model responds `501`** ("This server
does not support embeddings") — the model layer failing at the latest
possible point, which is the reason `assertCanEmbed` exists.

The other eight declare `false`, for two different reasons that each one's
prose records. Seven are **lack of proof**: there's no key for them in the
environment, and the only paid smoke that has run (OpenRouter, Phase 13a)
was for CHAT — on a hub, embedding routes to different providers than chat
does, and proof of one endpoint isn't proof of the other. The eighth is
**absence of the operation**: Anthropic has no embedding endpoint of its
own, and its docs point to a third party, which is a different provider with
a different key and a different dialect.

The OpenAI-compatible base's `/embeddings` dialect, however, IS **proven** —
the contract suite runs a second time against the base configured with the
capability turned on. That's what makes it cheap to flip a provider to
`true` the day a key exists: change one literal, and the parsing is already
exercised.

## Consequences

**Embedding spend still isn't metered, and this is a declared cut, not an
oversight.** The return carries `inputTokens`/`estimated` precisely to feed
`RecordLlmUsageUseCase`, which remains the only metering path — and
`calculateCostMicros(input, 0, …)` already works, because embedding has no
output tokens. What's missing is structural and didn't fit here:
`token_usage` has `session_id` as **NOT NULL** with an FK to `sessions`, and
indexing a repository doesn't happen inside a session. Improvising a
synthetic session just to have somewhere to write would produce the fix
right after; the decision belongs to the wave that implements the consumer.

**The model layer still has no column.** It lives today on the catalog row
(`ModeloDoCatalogo.supportsEmbeddings`), and `models` did not gain a
`supports_embeddings` column because this wave's migration slot belongs to a
different front — two concurrent migrations collide in `_journal.json` and
the drizzle snapshots, which is the program's declared bottleneck. The
honest consequence: catalog sync reads the capability and still has nowhere
to persist it, so whoever consumes it needs to ask the provider or load the
column separately. `assertCanEmbed` receives a narrow `Pick` on purpose, to
serve both sources without changing once the column exists.

**Nine providers now declare one more field.** The cost is real and was paid
up front: a required capability is what keeps the next provider from being
born without an answer. `TracedLLMProvider` forwards `embed` conditionally,
same as it does `listModels` — and it got its own test, because that's
exactly where `listModels` once vanished from the whole product silently.
