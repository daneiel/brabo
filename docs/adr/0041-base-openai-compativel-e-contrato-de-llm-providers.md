# 0041 — An OpenAI-compatible base, an LLM provider contract, and capabilities that refuse a binding

## Context

Phase 9 will add six new LLM providers (NVIDIA NIM, Deep Infra, Together
AI, Bitdeer AI, Vultr and OpenRouter). Before writing the first one,
exploring what already existed showed the foundation didn't even hold up
the three current ones:

1. **`OpenAIProvider` silently dropped `options.tools`.** Fifty-four lines,
   the `openai` SDK, and a comment in the file itself admitting that tool
   calling "isn't supported by this provider yet". Whoever bound an OpenAI
   model to an agent would see the ToolLoop end without a conclusion — the
   same symptom that took nine executions to diagnose in
   [ADR 0020](0020-destravar-gates-qa-secops.md).
2. **There was no test at all for `OpenAIProvider` or `AnthropicProvider`.**
   The only tested provider was Ollama, and only at the transport level.
3. **There was no LLM error taxonomy.** All three providers did
   `yield { type: 'error', message: (error as Error).message }`. An expired
   key, a rate limit and a nonexistent model all reached the user as the
   same opaque vendor string. The git side solved this in
   [ADR 0002](0002-git-error-normalization.md) and the lesson never crossed
   over.
4. **`models` had no capabilities and `LLMProvider` had no `capabilities`**
   — unlike `GitProviderContract`, which has carried its own since Phase 2.
   Any model could be bound to any agent.
5. **There was no LLM contract suite**, even though the git one
   (`test/contract/git-provider.contract.ts`) has been in CLAUDE.md as a
   project convention since [ADR 0001](0001-git-provider-contract-shape.md).

Six new providers on top of that foundation would multiply the five
problems by six.

## Decision

### The base speaks `node:http`, not the SDK

`OpenAICompatibleProvider` implements the `/chat/completions` dialect once,
and implements it over raw `node:http` — not over the `openai` SDK, which
leaves `package.json`.

The reason is the item the phase scope requires and the SDK doesn't
deliver: **idle timeout**. The SDK speaks `fetch`, whose timeout is for the
whole request; what we need is to drop the socket when it goes QUIET,
whether that means "hasn't sent the headers yet" or "stopped sending
chunks midstream". That's exactly the distinction ADR 0020 hunted down,
and the `postStream` it wrote for Ollama was extracted into
`infrastructure/llm/http-stream.ts` and now serves both.

The side benefit is that per-provider quirks become config flags
(`baseUrl`, auth header, `streamOptionsIncludeUsage`, `maxTokensField`)
instead of running into what the SDK lets you configure. Each flag exists
because a real provider diverges — the rule is: don't add a flag without a
provider that needs it, and Phase 9b confirms each one against the
official docs while implementing it.

### The normalized error goes in the chunk, with a mandatory `code`

`ChatErrorChunk` gained `code: LLMErrorCode`, and the taxonomy became
classes in `domain/llm/llm-provider-errors.ts`. The field is
**mandatory**, not optional: with an optional field, a new provider
forgets to classify and its error goes back to being an opaque string
without anyone noticing.

| status | `code` |
| --- | --- |
| 401, 403 | `auth` |
| 404 | `model_not_found` |
| 429 | `rate_limit` |
| 413, or 400 with a context marker | `context_length` |
| mute socket | `timeout` |
| didn't connect | `connection` |
| everything else | `upstream` |

Unlike `git-errors.ts`, which is a set of standalone classes, here there's
a base class: the error's destination isn't an HTTP filter with a status
per type, it's the conversion to `ChatErrorChunk`. Whoever converts needs a
single point that always exposes `code` and `message`.

### Capabilities in two layers, and a binding that gets rejected

`LLMProvider` gained `capabilities` (the backend's CEILING) and `models`
gained three `supports_*` columns (what that specific model knows). A
model can be poorer than the provider, never richer.

Discrete columns, not a `jsonb`: Phase 9c's "fit for agents" filter needs
to be a `WHERE`, and a capability without a column is a capability nobody
can query.

On top of this comes a new rule
([RN-040](../business-rules/custo.md#rn-040)): `assertModelFitsBindingScope`
refuses to bind a model without native tool calling to an **agent**, with a
message pointing to the filter the user needs to use. Only the `agent`
scope validates — `workspace` and `project` are the fallback for human
chat, and locking them down would ban chat-only models from the whole
product.

The engine's `ToolCallRecovery` keeps existing and keeps being a
**rescue, not a license**: it depends on the model getting the format
right by chance and fails silently when it doesn't. Choosing that chance
on purpose is what the rule refuses.

**A scope premise correction:** `context-manager` isn't a binding scope —
it's an agent slug under `scope='agent'` (ADR 0007). The rule covers it by
construction, with no new enum.

### The contract owns the assertions; the harness owns the dialect

`test/contract/llm-provider.contract.ts` runs the same battery against any
`LLMProvider`. Each provider's harness translates nine scenarios into its
own wire format, and inherits the tests: a stream with a frame split
across two `res.write`s, usage present and absent, tool calling, the four
errors, and the mute server.

The fake server is a real `node:http` on an ephemeral port — the mold from
Ollama's Phase 4 test — not a `fetch` mock. What's under test is precisely
socket behavior; a mock would respond nicely and prove nothing.

A Phase 9b provider now gets born with thirty assertions without writing a
single one.

### Anthropic gained tool calling and stayed on the SDK

Anthropic doesn't speak `/chat/completions`, so it doesn't derive from the
base. It gained native tool calling (`tool_use` blocks, and `role: 'tool'`
messages become grouped `tool_result`s in a `user` turn — the format
requires that results of parallel calls arrive in the same turn),
normalized status-based errors, and the idle-timeout ceiling via
`withIdleTimeout`, which wraps the SDK's generator and rearms a clock on
every event.

## Consequences

### Divergences that stayed documented instead of hidden

The contract has an axis parameterized by harness — `usageFallback` —
because the three dialects answer the same question differently:

- the **compatible base** relies on the local tokenizer and marks
  `estimated: true`;
- **Ollama** emits no `usage` at all (without the `done` line there's
  nothing to report);
- **Anthropic** can't omit the count — `usage` is mandatory in
  `message_start`, and a "no usage" scenario there would be invalid
  protocol.

Hiding this in a single test that only checks "has usage or not" would
cost the distinction between "the provider said zero" and "the provider
said nothing" — which is exactly what the `estimated` flag exists to
carry.

### Accepted costs

- **`OpenAIProvider` changed transport.** It's not "just moving code": it
  left the SDK and did its own SSE parsing. Since there was no test for it
  before, the migration was validated by the new contract suite, not by
  pre-existing tests. In exchange, the parsing is now exercised by thirty
  assertions and by a verified mutation: dropping the `tools` payload
  makes the contract fail.
- **One existing test assertion changed.** `ollama-provider.spec.ts`
  compared the error chunk with an exact `toEqual`; the extra `code` key
  breaks that. One line.
- **Four test fakes gained `capabilities`.** `capabilities` on the port is
  abstract, so `FakeProvider`/`ThrowingProvider` in the use cases needed
  to declare it. Without it they'd have an invalid type and still pass —
  `tsconfig.build` excludes `test/` and vitest uses SWC without
  typechecking, meaning the error would be silent.
- **The migration backfill is a literal list of seven models.** A blind
  `UPDATE` would be simpler and would lie about any model the operator
  inserted via SQL — the `false` default needs to keep holding for
  whatever hasn't been verified.

### What remains open

- **`brabo_llm_call_errors_total` barely fires.** `TracedLLMProvider` only
  increments on a *thrown* exception, and the providers *yield* an error
  chunk instead of throwing. Now that the error has a `code`, the counter
  could gain a reason label and start actually counting — but that's
  touching observability in a phase already closed without being asked to,
  and it's recorded here instead of done in passing.
- **`supports_vision` is in the table and nobody uses it.** It went in
  because the phase scope lists it among the capabilities; it gets a
  consumer in the ModelPicker in Phase 9c.
- **The six providers, `list_models`, the price sync and the regrouped
  ModelPicker** are 9b and 9c. This phase is the foundation: no new value
  in `llm_provider` or `credential_provider`.

References [ADR 0020](0020-destravar-gates-qa-secops.md), where
`postStream` and the rule of always recording the origin of a failure come
from, and [ADR 0002](0002-git-error-normalization.md), whose error
normalization this ADR finally replicates on the LLM side.
