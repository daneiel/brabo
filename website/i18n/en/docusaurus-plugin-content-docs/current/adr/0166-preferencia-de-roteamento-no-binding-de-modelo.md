---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0166 — The routing preference lives in the model binding, travels with it, and freezes in metering

## Status

**Accepted.** Decided by the maintainer on 2026-09-18 (AT-090): *"the routing
preference is CONFIGURABLE PER BINDING"*. It extends
[ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)
(capability in two layers, only declared when proven) and
[ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
(what produced the number goes frozen in the `token_usage` row). It edits
neither. The rule born from here is
[RN-583](../business-rules/custo.md#rn-583).

## Context

Measured in the `token_usage` of the v6.1.0 installation (2026-09-14): 24 calls
of `~deepseek/deepseek-v4-flash-latest` via `openrouter`. The
`upstream_provider` ([RN-042](../business-rules/custo.md#rn-042)) already said
who served each one: **Relace in 23**, with an average latency of 69.5 s
(between 32 and 47 tok/s), and **Baidu in 1**, with 37.8 s (~190 tok/s).
OpenRouter chooses the upstream through a balancing that favors PRICE when the
request says nothing — and `openrouter-provider.ts` said nothing: the
`/chat/completions` body went out without `provider`/`sort`.

The hub accepts `provider: { sort: "price" | "throughput" | "latency" }` in the
body. The remaining question is a PRODUCT one, not a wire one: *who* chooses the
criterion, and *where* that choice lives.

## Decision

### 1. A column in the binding, in the `llm` aggregate

`routing_preference` (enum `routing_preference`: `price | throughput |
latency`), **nullable**, in `model_bindings`. `null` is today's behavior:
nothing is sent and the hub decides on its own. The column enters
`apps/api/src/db/schema/llm.ts`, where the binding already lives — the aggregate
is the model's, and the enum lives with the two tables that call it (the enum
rule of [ADR 0121](0121-schema-dividido-por-agregado-de-dominio.md)).

### 2. The preference does NOT cascade on its own: it travels with the binding that won

The cascade (`session > agent > area > project > workspace`, plus the Criativo's
(Creative's) post-cascade step) remains a **binding** cascade. The winning
binding brings the model AND its preference; no level "inherits only the
preference" from another. Three reasons:

- **The preference only makes sense together with the model with which it was
  chosen.** It exists for ONE provider (the hub); cascading it separately would
  produce combinations nobody chose — the agent's model on a provider without the
  capability and the project's `throughput`, or the workspace's `latency` applied
  to a model the workspace owner never saw.
- **An independent cascade would require a second chain on the screen.**
  [RN-470](../business-rules/custo.md#rn-470) made the MODEL's chain visible node
  by node; two chains landing at different levels on the same row would be
  exactly the state the screen does not know how to explain.
- **The level the cascade SKIPS takes the preference with it.** A binding
  skipped for unavailability or lack of tool calling stops being valid whole —
  model and criterion. Having only the criterion survive would be the same defect
  as the first reason, created by the fall.

Written consequence: to put `throughput` on an entire area, one writes it on the
AREA's binding; the agent that diverges with its own binding has ITS preference
(null until someone chooses).

### 3. The write: absent preserves, `null` clears, a provider without the capability refuses

`PUT .../model-binding` (all five scopes) gains
`routingPreference?: 'price' | 'throughput' | 'latency' | null`:

- **absent** — preserves the recorded preference, *if the new model's provider
  accepts it*; otherwise it becomes `null`. Omitting cannot clear silently (that is
  how the usual model swap and "apply to all" keep calling the route), and it also
  cannot leave recorded a criterion the new provider does not understand;
- **`null`** — clears, explicitly;
- **a value, with a provider without the capability** — 422
  (`RoutingPreferenceNotSupportedError`), in the same filter as the other binding
  refusals. The request is well formed; what does not hold is the combination.

The invariant the three rules sustain: **no binding keeps a preference for a
provider that does not declare it.**

### 4. A PROVIDER capability, declared `false` while not proven

`LLMProviderCapabilities.routingPreference`, mandatory like `embeddings` (an
optional field would be the new provider that forgets to declare). All nine
declare it. The wire mapping (`provider: { sort }`) is an OpenRouter
particularity and enters as a hook of its config (`campoDeRoteamento`), in the
design of `extrairUpstreamProvider`: the base only calls it when the capability
is `true` AND there is a preference — never `if (name === 'openrouter')` in the
parsing.

The MODEL layer gains no column: `sort` is a criterion of the HUB over the
upstreams that serve the model, OpenRouter's catalog does not publish it per row,
and a model with a single upstream receives it as a no-op. Inventing the column
would be a capability without a source.

**OpenRouter's value is whatever the proof says.** The capability only becomes
`true` with the smoke against the real API
(`openrouter-provider.roteamento.smoke.spec.ts`) returning the chosen upstream.
Without a credential in the implementer's environment, it is born `false` and the
feature is born DORMANT: the route refuses with 422 and the screen says in text
that no provider of this installation has the option proven.

### 5. What was ASKED goes frozen in `token_usage`

`token_usage.routing_preference`, nullable, written per call: the preference that
**went over the wire** — `null` when the binding had none, and `null` also when it
had one but the provider does not declare it (it was not sent, so it is the
provenance of nothing). It is the same rule as the frozen price: without it,
comparing the `upstream_provider` and `latency_ms` of before and after turning on
`throughput` would depend on reconstructing the state of the binding at that
instant, which is recorded nowhere.

### 6. The screen discovers the capability through a PROVIDER route

`GET llm/provider-capabilities` returns the capabilities of the nine providers,
read from the registry's instances — the same source the adapter uses. A new
route, and not a field in an existing response, because no existing response is
about a PROVIDER: the model is a catalog row (the vendor's fact, `MesmasChaves`
with the entity) and the binding is a scope's decision. No role (authentication
only), like `users/me/credentials`: it is a fact of this installation's code, the
same for everyone.

The control lives where the binding is edited — the agents table and the areas
section in Settings —, with the ENDPOINT's minimum role
([RN-102](../business-rules/custo.md#rn-102)): `developer` on the agent,
`maintainer` on the area. It is only editable on the row that HAS its own
binding; on the inheriting row, it says from which level the current criterion
came. A model whose provider does not have the capability gains no option — it
gains the sentence saying why.

## Consequences

- With the capability `true`, putting `throughput` on an OpenRouter binding
  changes the body of every call that resolves to it, and the `token_usage` row
  says which criterion was asked and who served — the before/after comparison is
  a query, not a reconstruction.
- While the capability is `false`, nothing changes on the wire for anyone: the
  code is in place, the route refuses and the screen explains. Flipping the flag
  is a one-line PR accompanied by the smoke's output.
- Declared price: `sort: throughput` can route to a more EXPENSIVE upstream.
  Metering keeps charging the model's catalog price (ADR 0042), which is
  OpenRouter's reference price and not the upstream's — that difference already
  existed and is not measured here.

**Out of scope, declared:**

- the session (`SessionPage`) and the project and workspace levels have no
  control on the screen: the API accepts the field in all five scopes, but
  project and workspace have no model selector on any screen (measured: no
  `setProjectModelBinding`/`setWorkspaceModelBinding` is called by the web), and
  the session selector is another surface;
- the agent card (Overview/Executors) shows the model and does NOT edit the
  binding — the control did not go there, because the binding is not edited
  there;
- the other fields of OpenRouter's `provider` object (`order`, `only`, `ignore`,
  `allow_fallbacks`, `max_price`) and the `:nitro` suffix: none was asked for,
  and each one is a product decision of its own.
