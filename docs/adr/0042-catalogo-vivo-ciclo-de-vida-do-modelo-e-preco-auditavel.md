# 0042 — Living catalog, model lifecycle and auditable price

## Context

[ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)
delivered the OpenAI-compatible base, the provider contract, and per-model
capabilities. What was missing was the other half of Phase 9: discovering
models on its own, knowing what to do when one disappears, and changing
price without corrupting history.

The exploration before coding found three things that redefined the work.

### The historical cost was already frozen — the hole was elsewhere

The scope called for a test proving that "changing the price doesn't
change yesterday's cost". That test would pass today, vacuously:
`calculateCostMicros` runs at call time and the result becomes
`token_usage.cost_micros`; nothing recalculates it later.

The real hole is that `token_usage` **didn't store the price** that
produced the cost. An old value was immutable, but not
**reproducible**: `tokens × price` stopped adding up as soon as someone
corrected a row in `models`, and there was no way to tell "the cost is
right" apart from "the cost has been wrong all along".

### `is_active` was decorative

The column had existed since Phase 1 and was read in **one** place:
`listActive()`. `findById` and `findCandidates` ignored it. Deactivating a
model didn't stop a new binding, didn't interrupt an existing one, and the
call kept happening and getting billed. The screen said "deactivated" and
the system disagreed.

### There was no fallback based on availability

`binding-resolver.ts` received `{scope, modelId}` and nothing else — it
didn't know the model. The cascade was over SCOPES, never over the state
of the model being pointed to. A binding to a model the provider had
removed would resolve normally and only fail at call time, with a 404
from the vendor.

## Decision

### Two independent axes, not a single state

| column | who writes it | question it answers |
| --- | --- | --- |
| `models.is_active` | the owner, via the curation screen | "do I want to use this model?" |
| `models.availability` | the sync, on its own | "does this model still exist over there?" |

A single state wouldn't do the job: if the sync wrote to `is_active`, a
model that disappeared for an hour would come back **turned off**, losing
its curation; if the owner wrote to `availability`, they could "reactivate"
a model that no longer exists on the other end. The intersection of the
two is what generates the warning on the screen.

The repository's upsert `set` **doesn't include `is_active`** — that's the
line guaranteeing the rule: the sync rediscovering a model can't turn back
on what someone deliberately turned off.

### A discovered model comes in INACTIVE, a disappeared model is flagged and preserved

Formalized in [RN-043](../business-rules/custo.md#rn-043). Deleting is never an
option: `model_bindings` and `token_usage` point to the row.

The third rule is the one that shows up least and matters most: **a
provider that failed doesn't make anything unavailable.** A 401 means "I
don't know what's over there." Treating that as an empty catalog would
mark every model from that provider as gone and take down every binding
at once — because of one revoked key. The provider is SKIPPED, with the
origin of the failure (`infra` | `modelo`) in the report, in the
vocabulary of [ADR 0020](0020-destravar-gates-qa-secops.md).

For the same reason, the base's `listModels` **throws** when the
capability isn't declared, instead of returning `[]`: an empty list is
indistinguishable from "the provider has no models at all", and the sync
would read that as "they all disappeared".

### The cascade revalidates capability at every level

`resolveBinding` now receives `{availability, supportsToolCalling}`
alongside the id and returns `skipped[]` — what was discarded and why.

The non-obvious point: when the turn carries tools, the
`supports_tool_calling` filter applies to **every** candidate, not just
the first. Without that, an agent's binding to an unavailable model would
fall to the level below and land on a chat-only model, silently violating
[RN-040](../business-rules/custo.md#rn-040) — the failure would only show up
later, in the ToolLoop, as "the agent just stopped by itself". That's
exactly the kind of failure that cost nine executions to diagnose in
ADR 0020.

The trigger is the turn HAVING tools, not the actor being an agent: a
context-manager summarization turn with no `tools` runs fine on a
chat-only model, and locking it down would restrict more than the rule
calls for.

### Price: snapshot in `token_usage`, audit trail in its own table

`token_usage` gained `input_price_per_million_micros` and
`output_price_per_million_micros` — the price that produced that cost.
That's what makes an old cost reproducible, not merely immutable
([RN-044](../business-rules/custo.md#rn-044)).

The alternative considered was a **validity-period table** (a price with a
validity interval, cost recalculated via join). It was discarded: it would
force every cost read to resolve the right interval, and a bug in that
join would reprice the entire past — exactly what the phase forbids. The
snapshot puts the answer on the row itself.

`model_price_changes` is append-only, with the before/after pair. It lives
in its own table and **not in the outbox**:
`Engine.Outbox.Drain.run_once/0` filters `aggregate_type == "session"`, so
a price row there would sit with `processed_at` null forever and pollute
the outbox lag metric. It's an immutable domain log, like
`session_events` — the same CLAUDE.md rule.

### The engine schedules, the api executes

The sync runs as a **self-rescheduling** Oban worker
(`ModelSyncSchedulerWorker`), in the idiom the repository has used since
`OutboxDrainWorker` — `Oban.Plugins.Cron` isn't installed, and the
`unique:` clause stays only on `kickoff/0`, never on `use`, or else a job
already in progress would collide with itself and kill the chain after one
round.

The worker calls `POST /internal/models/sync` because the api is the one
that holds the credentials and the provider registry; duplicating the
registry in Elixir would mean maintaining two catalogs. The rescheduling
happens **before** the work, on purpose: a bad round can't kill the
periodic chain.

The UI's "Refresh catalog" button calls the same use case via
`POST /workspaces/:id/models/sync` — there aren't two reconciliations that
could diverge.

### Curation hangs off a `:workspaceId`, and the catalog is global

`RolesGuard` resolves the effective role from `:projectId` or
`:workspaceId` in the route. Without either it has nowhere to pull a role
from, and a `@RequireRole('owner')` on a scopeless route would **always
reject**. That's why the curation routes are `/workspaces/:workspaceId/models/*`.

The catalog itself stays global — the `models` table was never
per-workspace. The workspace in the path is an RBAC anchor, not a data
scope, and the consequence is recorded below as backlog.

## Consequences

- A new provider that exposes `GET /models` gets sync without anyone
  writing sync code: it declares `listModels: true` and, if the format
  diverges, a `parseCatalogo`.
- The UI now has a curation screen, with batch activation and the sync
  report showing **every** provider, including the skipped one.
- The `ModelPicker` was regrouped by origin (Local · Direct APIs · Hubs)
  and gained the "fit for agents" filter — which the RN-040 error message
  had been referencing since Phase 9a without it existing.
- Price is now shown with input and output **separated**. The average
  hid the asymmetry: a model with 3 USD input and 15 output showed up as
  "9", which is the price of nothing.

## What's left for later

- **The six Phase 9b providers** (NVIDIA NIM, Deep Infra, Together AI,
  Bitdeer AI, Vultr and OpenRouter). This session's environment egress
  policy denies all outbound HTTPS, and the phase scope requires verifying
  `baseUrl`, auth, `usage` format and streaming quirks **against the
  official docs** before coding. The base, the contract, the sync and the
  metering by `upstream_provider` are ready to receive them: each one is
  config + seed + a credential kind.
- **OpenRouter's acceptance with a real credential** (a real catalog and
  `upstream_provider` filled in on a task), which depends on the item
  above.
- **`listModels` for Ollama and Anthropic.** Both have a catalog endpoint,
  not verified against the docs in this phase. They declare `false` and
  are explicitly skipped, which is honest; declaring `true` with guessed
  parsing would mark the whole catalog as gone.
- **Automatic price sync turned on by default.** The sync only writes
  price where the row isn't flagged `manual_pricing`; applying a
  sync-sourced price over a manual row requires an explicit owner
  decision, and the UI for that decision doesn't exist yet.
- **Catalog per workspace.** Today curation is global and the route's
  `:workspaceId` is just an RBAC anchor — an owner of workspace A
  activating a model activates it for B too.
- **Bedrock and Azure OpenAI**, out of scope for Phase 9 since the
  original brief.
- **`brabo_llm_call_errors_total`**, which ADR 0041 recorded as
  practically inert. Still noted, not fixed in passing.
