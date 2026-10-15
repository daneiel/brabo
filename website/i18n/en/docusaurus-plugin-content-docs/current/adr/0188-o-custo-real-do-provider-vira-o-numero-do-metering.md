---
traducao_de: 8397a73e2338fe4d24d56ee0a87b33fdff223ff8
---

# ADR 0188 — The real cost the provider returns becomes the metering number

## Status

**Accepted.** 2026-09-30 (AT-270 and AT-272, story HS-070, epic EP-030, round
34; owner decision on 30/09: *"the real cost becomes the number"* — when the
provider returns what it charged, that is the value recorded and shown, with
`estimated = false`; the catalog price stays only where there is no real cost).
Complements
[ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
(frozen, auditable price) and
[ADR 0076](0076-provider-volta-a-ser-dimensao-de-gasto.md) (the provider as a
spending dimension) without editing them: the frozen price still exists and is
still the number of every call whose response does not state the cost; what
changes is which of the two sources wins when both exist. Extends to CHAT the
design that [ADR 0179](0179-o-laco-pergunta-ao-jev-qual-ferramenta.md) set for
the cost of Jev's tool decision — the SAME `price_implicit` column and the SAME
`precoImplicitoPorMilhao` function —, instead of a second way of saying "this
cost is the real one".

## Context

Measured in the `dev` code on 2026-09-30, before changing:

- The cost recorded in `token_usage.cost_micros` came from ONE place, repeated
  in three use cases — `RunLlmTurnUseCase` (276 of the 305 rows of the 29/09
  real use), `StreamLlmTurnUseCase` (28) and `SendChatMessageUseCase` (1):
  `calculateCostMicros(tokens, preço de models)`. No other path records metering
  (`RecordLlmUsageUseCase` is the only one, and it just passes the number on).
- `OpenAICompatibleProvider.chat` read, from the `usage` frame, only
  `prompt_tokens` and `completion_tokens`. It discarded `usage.cost` (the cost
  OpenRouter charged, in USD), `model` (the model that SERVED — the alias
  `~deepseek/deepseek-flash-latest` resolves to a dated version) and `id`
  (`gen-…`, the identifier `GET /api/v1/generation?id=` accepts). The finding of
  the real-use analysis (`openai-compatible-provider.ts:237-245`) reproduces
  byte for byte on `dev`.
- The gap is measured, not assumed: the 29/09 real use added up to
  US$ 0.314259 at the frozen price (20,000 / 600,000 micros per million), and
  the test key recorded US$ 0.5807 that day (1.85×). Repriced by the UNDERLYING
  provider that `upstream_provider` already recorded, the no-cache ceiling gives
  ≈ US$ 0.917. A hub's catalog price is that of ONE route; the hub charges for
  the route it used.
- `usage.cost` was already the spending source of all paid measurements done
  against OpenRouter (`docs/explanation/medicao-do-idioma.md`,
  `medicao-do-jev.md`, `scripts/idioma/validar.ts`): the field exists in the
  real `/chat/completions` response and it is through it that their spending
  was summed, never through the `/key` counter.

## Decision

1. **Precedence.** When the `usage` chunk carries `costMicros`, it IS the row's
   `cost_micros`, the number the engine adds to the loop's local budget (the
   turn's `usage.costMicros`), what increments the project, session and area
   budgets, and what the Spending tab sums. Without it, the catalog's frozen
   price (ADR 0042) produces the number, as always. One domain function decides
   both things — `custoDaChamada` (`domain/llm/custo-da-chamada.ts`) —, and the
   three use cases go through it; there is no second rule.
2. **The price of a row with real cost is IMPLICIT.** `cost ÷ tokens`, the same
   value in both price columns (the provider returns ONE cost; splitting it
   between input and output would be inventing the proportion), and
   `price_implicit = true` says so. That is what keeps `tokens × price = cost`
   (RN-044) reproducible, up to the rounding of the integer price, without
   pretending a list price produced the number. It is the SAME formula
   (`precoImplicitoPorMilhao`) and the SAME column as ADR 0179.
3. **What the catalog would have charged goes alongside**, in
   `catalog_cost_micros`, only on rows whose number is the real one (`null` on
   the others). It is what the card asked for ("record the real cost alongside
   the estimate") and it is what allows measuring, row by row, the gap the
   29/09 analysis measured in aggregate.
4. **`estimated` does not change meaning.** It still says whether the TOKENS
   were counted by the provider or estimated locally (RN-041). A row with real
   cost has `estimated = false` because the cost only arrives together with the
   provider's `usage`; the mark that the COST is real is `price_implicit`.
   Reusing `estimated` for both questions would erase the distinction "the
   provider said 0 tokens" × "the provider said nothing".
5. **The resolved model and the generation id are recorded** —
   `resolved_model_name` and `generation_id`, read from the frame's `model` and
   `id` by EVERY provider of the dialect (they are fields of the
   `/chat/completions` dialect itself, not a hub quirk). `model_name` stays the
   CATALOG name: it is the reports' dimension (RN-101/RN-186) and the link to
   `model_id`; swapping it for the resolved one would split the same binding
   into N report rows with every new dated version of the alias.
6. **Whoever reads the cost is a config hook, not the base.**
   `extrairCustoReal` in `OpenAICompatibleConfig`, configured ONLY on
   OpenRouter (`extrairCustoRealOpenRouter`). A provider without the hook
   ignores a `usage.cost` even when present — the field's unit and meaning
   belong to the hub, and the Phase 9 rule is that a provider particularity
   becomes a hook/flag, never an `if`. No new capability is born in
   `LLMProviderCapabilities`: the cost is observed PER RESPONSE, and its absence
   degrades on its own to the catalog, row by row.
7. **BYOK is not real cost.** With `usage.is_byok === true`, `cost` is the
   hub's fee and inference is charged by the provider separately; recording only
   the fee would be recording LESS than what was charged — the defect this ADR
   closes —, so the row falls back to the catalog. A cost that is not a finite,
   non-negative number is also "did not say", never zero; real zero (a free
   model) is real cost.

8. **The parts of input and output are recorded** (AT-272, RN-666):
   `cached_input_tokens` (`usage.prompt_tokens_details.cached_tokens`) and
   `reasoning_tokens` (`usage.completion_tokens_details.reasoning_tokens`), read
   by the base for every provider of the dialect, because they are OpenAI's own
   fields. They are PARTS of `input_tokens`/`output_tokens`, never added to
   them, and do not recompute cost: with real cost, the cache discount is
   already in the number; without it, the catalog has no cache price to apply,
   and inventing one would be another estimate. `null` is "did not say",
   distinct from 0. The measurement (`medir-execucao.ts`) now states, per agent,
   how much of the input was cache read — only over the calls that reported it,
   and in how many — and in how many the cost is the real one. The range the
   29/09 analysis left as a hypothesis (between US$ 0.58 and 0.92, depending on
   cache) becomes measurable in new calls; the 305 old ones remain without the
   information.

## Consequences

- The number of the Spending tab, of the budgets and of the loop's local budget
  becomes what OpenRouter charges, on the calls it measures. The same report
  sums real rows and estimated rows; `price_implicit` distinguishes the two per
  row.
- **A budget may "jump".** A budget calibrated on the catalog price sees, from
  here on, spending up to ~1.85× higher for the same calls (the 29/09 measure):
  the 70/90/100% thresholds arrive earlier. It is the requested behaviour — the
  budget becomes about money, not the estimate —, and it stays declared for
  whoever calibrated a ceiling before.
- **The screen still says "estimated".** The subtitle of the member's Spending
  tab (RN-101) states that the cost is estimated. How the screen distinguishes
  real from estimated — a label per row, a proportion, or just changing the
  sentence — is a product decision pending with the owner; no screen was touched
  here, and the api does not expose `price_implicit` on any route yet.
- **Proof without a key.** There is no OpenRouter credential on this machine:
  the proof is the RECORDED RESPONSE in the contract suite
  (`openrouter-provider.contract.spec.ts`, with the `usage` shape the paid
  measurements read) and the manual smoke (`openrouter-provider.smoke.spec.ts`)
  now requires `price_implicit` and the `gen-…` with a credential. The meaning
  of `cost` in BYOK is a READING of the documentation, not a measurement.
- **One column, two authors.** `price_implicit` was born in migration 0066 (Jev);
  this decision only adds a second writer of it, and migration 0067 creates only
  the three new columns. A row with `price_implicit = true` is either Jev
  (`model_name = typesafe/jev-1.13`, null `model_id`) or a chat call with real
  cost (`model_id` filled, non-null `catalog_cost_micros`); Jev does not record
  `catalog_cost_micros`, because it has no catalog price.
- **Anthropic stays out of the parts.** It reports cache in its own protocol
  (`cache_read_input_tokens`), which its adapter does not read; its rows record
  `null` in both columns. No other provider changes.
- What the resolved model and the id unlock — checking a row's charge with
  `GET /generation?id=`, repricing by dated version — remains to be built; here
  it is only recorded.
