# 0043 — Six LLM providers on top of the base, and Phase 9b finally closed

## Context

[ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)
delivered the OpenAI-compatible base, the provider contract and the
two-layer capabilities. [ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
delivered the live catalog and the auditable price, but left it explicit
in its own "What's left for later": **the six Phase 9b providers**
(NVIDIA NIM, Deep Infra, Together AI, Bitdeer AI, Vultr and OpenRouter)
didn't go in — the egress policy of that phase's session denied all
outbound HTTPS, and verifying `baseUrl`, auth and streaming quirks
**against the official doc** before coding was part of the scope
itself, not a detail.

Phase 11 delivered the six, in two waves. First OpenRouter alone
(11a) — the only **hub** of the six, chosen first precisely to prove
the base against real production before repeating the mold five times.
Then the five direct ones (11b) — NVIDIA NIM, Together AI, DeepInfra,
Bitdeer, Vultr — in series, each one investigated **from scratch**
against that provider's official API doc. The rule that guided both
waves, inherited from the spirit of ADR 0041 itself ("every flag
exists because a real provider diverges"): assuming a quirk is NEVER
inherited between providers. A provider that looks like another can
diverge exactly where nobody checked.

## Decision

### The acceptance table, provider by provider

| provider | `listModels` | why | connection test | quirks | model origin |
| --- | --- | --- | --- | --- | --- |
| **OpenRouter** (11a) | `true` | catalog with pricing on its own line (decimal USD/token string, converted) | `GET /key`, dedicated endpoint | its own headers (`HTTP-Referer`/`X-Title`); error IN THE MIDDLE of the stream (the only hub); model id prefixed by the upstream | sync |
| **NVIDIA NIM** | `false` | `GET /v1/models` exists, with no price in any doc verified | `GET /v1/models`, status-only | tool calling is per MODEL, not per API; hosted endpoint ≠ self-hosted container | seed |
| **Together AI** | `true` | catalog with flattened `pricing` (number), unit inferred by market comparison — not explicitly documented | `GET /v1/models`, status-only | namespaced ids (404 without prefix); 429 with `error_type` | sync + seed |
| **DeepInfra** | `true` | **public, unauthenticated** catalog, confirmed LIVE with real price | none — the public catalog doesn't distinguish a good key from a bad one | catalog mixes chat/image/audio/video (filtered by `tags`) | sync + seed |
| **Bitdeer** | `false` | no catalog/price shape found publicly | `GET /v1/models`, confirmed 401 live without a key | shallowest public doc of the six; 3 REAL ids confirmed in the blog's own config example | seed |
| **Vultr** | `false` | the route the base calls (`/models`) has no price in the doc; the documented route with price returned 404 live | `GET /v1/models`, confirmed 401 live without a key | tool calling confirmed with a real example (`kimi-k2-instruct`, `finish_reason: "tool_calls"`) | seed |

### "Honest false" beat "fragile true" twice, live

The ADR 0041/0042 rule ("a capability is only declared when proven")
isn't just a principle — it was tested during implementation and
changed the outcome twice:

- **DeepInfra** entered the plan as a candidate for `listModels:
  false` (the doc suggested mandatory authentication and unconfirmed
  pricing on the endpoint the base calls). A LIVE check against
  `GET https://api.deepinfra.com/v1/openai/models` (the same endpoint
  `OpenAICompatibleProvider.listModels()` always calls —
  `{baseUrl}/models`, no exception) revealed the catalog is public,
  with no authentication at all, and returns real price under
  `metadata.pricing.{input_tokens,output_tokens}`. It turned `true` —
  without needing to extend the base, because the URL it already calls
  by default was enough.
- **Vultr** had the opposite path: the plan pointed to `true`
  (Vultr's doc associates price with a `GET /provider` endpoint with
  `cost`/`contextWindow`). A LIVE check on that path returned **404**
  — the doc was outdated or the documented path never existed in that
  form. Since the base only calls `{baseUrl}/models`, and that route
  (confirmed to exist, 401 without a key) has no price according to
  Vultr's own official reference, the decision became `false`.

In both cases, the final decision didn't come from the plan — it came
from hitting the real API during implementation. A plan that locked
the decision before that check would have gotten NIM/Bitdeer right and
DeepInfra/Vultr wrong.

### No new "credential kind"

Every LLM credential, across the nine providers, has the SAME shape —
an API key encrypted by envelope encryption
(`user_credentials.encrypted_api_key`). There was not, and still
isn't, a structural distinction of credential "type" (OAuth vs. key,
for example) on the LLM side. What varies by provider is only
**whether** it has a declared connection test (dedicated `GET /key`
for OpenRouter; status-only `GET {baseUrl}/models` for the five direct
ones that support it; none for DeepInfra, whose public catalog can't
validate any key).

## Consequences

- `LLM_PROVIDER_NAMES` went from 3 to **9** entries (`llmProviderEnum`
  and `credentialProviderEnum` follow along, via migration `0030`).
  The bidirectional exhaustiveness check that ADR 0041 already
  guaranteed (type × array) held the build red until the registry and
  the module got the 9 cases — it worked exactly as designed.
- The credential registration DTO
  (`upsert-credential.dto.ts`) and the connection tester
  (`llm-credential-connection-tester.ts`) stopped having a hardcoded
  provider list (tripled in the DTO — Swagger, `@IsIn`, TS type) and
  started deriving from `LLM_PROVIDER_NAMES_COM_CREDENCIAL`/an overrides
  map. Real finding from this phase: the manual list was exactly what
  broke a test in the middle of the work, when the credential tester's
  constructor gained one more parameter and a spec didn't keep up —
  the same kind of silent failure the ADR 0041 exhaustiveness check
  already existed to prevent on the type side, just here it was on the
  value side.
- The credentials screen and `ModelPicker` absorbed the 9 without a
  new component: `ROTULO_DO_PROVIDER` (an exhaustive `Record`) gained
  6 labels, `HUBS` still has a single member (`openrouter`) — the five
  direct ones fall into "direct APIs" for not being on that list, not
  because of a new rule.
- The generated reference (`docs/reference/llm-providers.md`, block
  `providers-capabilities`) gained three columns — credential, model
  origin (`sync` | `seed` | `sync + seed`) and summarized quirks — all
  DERIVED mechanically (from the code and the prose already written by
  hand), without touching a single provider file just to feed the doc.

### Insight note: the hook for the Psychologist's cost routing

`upstream_provider` (ADR 0042, Phase 9b prep) now has real data behind
it — not just an empty schema. The example query in
`docs/reference/llm-providers.md` ("Hubs and real cost") shows that
comparing the cost of the SAME model, hub × direct, is already
queryable today. **This is recorded as a seed, not implemented**:
there's no automatic consumer of this comparison, and the natural
reading — the Psychologist one day suggesting "this model is cheaper
direct than via the hub" — stays just noted here, with no ticket or
phase scope.

### Verification that the base came out untouched

`git diff origin/main -- apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts`
is **empty** — `SyncModelCatalogUseCase` already iterated
`LLM_PROVIDER_NAMES` generically since ADR 0042; absorbing 6 more
providers didn't require a single line.

`git diff origin/main -- apps/api/src/infrastructure/llm/openai-compatible-provider.ts`
**isn't empty**: +31/-0, a single hook —

```ts
export type ParseErrorFrame = (
  frame: Record<string, unknown>,
) => LLMProviderError | undefined;
```

plus the optional `parseErrorFrame?: ParseErrorFrame` field on
`OpenAICompatibleConfig`, and its call IN THE MIDDLE of the SSE loop,
before reading `delta`/`usage` — because a hub error frame isn't a
content frame with empty fields, it's something else, and treating it
as the latter would hide the failure instead of reporting it. The 31
lines exist exclusively because **OpenRouter is the only hub of the
six**: only a hub accepts the connection, starts sending text, and has
the real provider behind it falling over IN THE MIDDLE of the stream —
no direct provider has this class of failure, because none of them
route to third-party infrastructure. Proof that the extension was
minimal and necessary, not speculative: the five direct providers from
11b went through the entire contract suite without declaring any
`parseErrorFrame`, and none needed one.

No other base file (`http-stream.ts`,
`llm-provider-errors.ts`, `model-capabilities.ts`,
`model.repository.ts`) has any diff against `origin/main`.

## What's left for later

- **Acceptance with a real credential for the six smokes**
  (`openrouter-provider.smoke.spec.ts` and the five from 11b), each
  gated by its own `<PROVIDER>_TEST_KEY`. Written, tested against the
  mock, never run against a real key — the same pending item ADR 0042
  already recorded for OpenRouter, now extended to the five new ones.
  Running each one (whenever a key exists) is what finally proves
  Together/DeepInfra's price and NIM/Bitdeer/Vultr's estimated IDs
  against reality, not against the doc.
- **Estimated pricing for NVIDIA NIM, Bitdeer and Vultr** — none of
  the three publishes per-model pricing in an accessible doc at this
  phase; the seeded values are a market approximation
  (`manual_pricing: true`), correctable as soon as an official source
  exists.
- **The Psychologist's cost-routing reading** (see the insight note
  above) — a seed, not the scope of any phase yet.
- **The dogfooding P1 findings** (Phase 10) remain untouched, competing
  with the rest of the backlog for Phase 12 — Phase 11 never had
  authorization to touch them, and didn't.

References [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)
and [ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md),
whose foundation supported the six providers as config — none of them
needed refactoring in the base beyond the single hook that OpenRouter,
being a hub, proved necessary.
