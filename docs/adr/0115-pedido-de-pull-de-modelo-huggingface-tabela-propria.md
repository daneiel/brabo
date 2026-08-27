# ADR 0115 — Hugging Face model pull: a dedicated table, two-step confirmation, and an official-publisher allowlist — never `proposed_actions`

- **Status:** Accepted
- **Date:** 2026-08-26
- **Context:** lets a workspace owner/maintainer search the Hugging Face Hub and pull a GGUF model into the local Ollama daemon from Project/Workspace Settings, closing a gap the local-LLM path had no answer for (getting a model that isn't one of the few baked into the compose entrypoint)
- **References (without editing):** [ADR 0042](0042-catalogo-com-curadoria-e-preco-congelado.md) ("never activate an auto-discovered model" — the rule this decision applies to a new surface), [ADR 0100](0100-rag-search-e-modelos-garantidos-no-boot.md) (Ollama as the local daemon this pulls into), the original FASE 1 ADR that introduced `proposed_actions` and `decide()`

## Context

The product already has a pipeline for "an agent proposes, a human decides":
`proposed_actions`, `permissions.json`/`decide()`, and the three screens that
read from it (Aprovações, session chat, Insights). Pulling a Hugging Face
model into Ollama looked, on the surface, like it might fit — it's an action
with a real external effect (a multi-gigabyte download, then activating a
model other agents can spend against) and the product wants a deliberate,
two-step confirmation before it runs, not a single click.

It doesn't fit, and the mismatch only shows up once you trace what the
pipeline is actually built around.

## Decision

### `huggingface_model_pull_requests` is a new, small table — not `proposed_actions`

Before building anything, the mechanism traced four things `proposed_actions`
requires and checked whether they're true here:

- `proposed_actions.session_id` is `NOT NULL` (FK to `sessions`, cascade).
  This feature has no session — it's invoked from Project/Workspace
  Settings, not from an agent's turn inside a session. Fitting it in would
  mean fabricating a session for an action that has nothing to do with one.
- `actor_kind`/`actor_id` record **who proposed** (`user`/`agent`/`system`),
  and `resolved_policy` is always the output of running `decide()` against
  `permissions.json`/`agent_autonomy` — a policy-resolution stage built for
  autonomy tiers (`auto_approve`/`require_approval`/`deny`) on **agent**
  behavior. Here the actor requesting the pull **is** the human — already
  gated by `@RequireRole('maintainer')` on the route
  (`apps/api/src/interfaces/http/llm/huggingface-models.controller.ts:63-72`)
  — and there is no agent to supervise. Running it through `decide()` would
  apply autonomy-tier semantics to a case that has no autonomy tier: a
  maintainer confirming their own request a second time.
- `action_type` is validated against `decide.ts`'s closed `ActionType`
  union, and CLAUDE.md's own rule for that union is direct: a type new type
  needs a phrase in `apps/web/src/lib/aprovacoes.ts`, and it renders on the
  three screens built for agent supervision. Fabricating an entry there for
  "a human clicked confirm on their own Settings action" would surface it on
  UI built to answer a different question ("what is an agent asking me to
  approve") for an action that never asks that question.
- The "second explicit confirmation" this feature needs is a UX/safety gate
  on a **direct human action**, not an approval-of-an-agent's-proposal gate
  — a different shape of "are you sure," not the same one.

Given that, forcing this into `proposed_actions` would mean bending a
mechanism built for supervising an untrustworthy agent onto a case with no
agent in it — coupling the feature to `permissions.json`/`agent_autonomy`
semantics it doesn't need and was never designed to answer.

**The new table**, `huggingface_model_pull_requests` (migration
`0053_optimal_sauron.sql`): `id`, `workspace_id` (FK `workspaces`, cascade),
`requested_by` (FK `users`), `repo_id`, `estimated_size_bytes` (nullable —
never guessed when the Hub doesn't publish one), `status`
(`huggingface_model_pull_status`: `pending_confirmation` → `confirmed` →
`pulling` → `active` | `failed`), `confirmed_at`, `failed_reason` (always
prefixed with the ADR 0020 origin vocabulary — `infra`/`modelo`/`código`/
`política`), timestamps, and an index on `workspace_id`
(`apps/api/src/db/schema.ts:2371-2393`).

### The two-step confirmation IS the state machine, not an extra flag

`RequestModelPullUseCase`
(`apps/api/src/application/use-cases/llm/huggingface/request-model-pull.use-case.ts:23`)
creates the row in `pending_confirmation` and does nothing else — no
network call, no side effect. Only a **separate** call to
`ConfirmModelPullUseCase`
(`.../huggingface/confirm-model-pull.use-case.ts:45`), reachable exclusively
via `POST .../pull-requests/:id/confirm`, moves the row to `confirmed` →
`pulling` and actually calls `OllamaProvider.pullModel`. There is no third
flag or column recording "was this confirmed" — the `pending_confirmation
→ confirmed` transition itself **is** the second confirmation, and
`ConfirmModelPullUseCase` refuses (409, `ConflictException`) to run it
twice: a row that isn't `pending_confirmation` anymore cannot be confirmed
again.

### `repoId` travels in the request body, not the route

The Hub's real id shape is `<publisher>/<model>` (e.g.
`meta-llama/Llama-3.1-8B-Instruct-GGUF`) — a `/` inside what would have been
a `:repoId` path segment breaks Nest/Express single-segment route matching.
`POST .../pull-requests` takes it in the body (`RequestModelPullDto`)
instead, the same choice already made for file paths in
`apps/api/src/interfaces/http/git/code.controller.ts` for the identical
reason.

### The pull runs synchronously inside the confirming HTTP request

`ConfirmModelPullUseCase` awaits the whole download before returning. The
api has no background-job runner reachable from itself — Oban lives in the
Elixir engine, and no synchronous command channel from the api to it exists
for this. Firing the pull and returning immediately would mean losing the
unhandled exception the moment the calling function returned, and the
`markFailed` in the use case's `catch` would never run.
`GET .../pull-requests/:id` exists for callers who don't want to hold that
connection open (a reverse proxy or gateway often times out sooner than a
multi-gigabyte download finishes) — the pull itself keeps running
server-side regardless of whether anyone is still polling.

### Official-publisher allowlist — the ADR 0042 rule, applied to a new badge

`HUGGINFACE_OFFICIAL_PUBLISHERS`
(`apps/api/src/domain/llm/huggingface-official-publishers.ts:17-26`) is a
short, hand-curated, case-sensitive list of Hub orgs recognized as the
actual manufacturer of what they publish (`meta-llama`, `google`,
`mistralai`, `microsoft`, `Qwen`, `deepseek-ai`, `openai`, `nvidia`) — the
same "never activate an auto-discovered model, curation is always manual"
posture ADR 0042 already holds for the LLM catalog, applied here to the
"official" badge instead of to activation. `isOfficialPublisher` compares
the `repoId`'s publisher segment exactly, not case-folded: the Hub itself is
case-sensitive (`Qwen`, not `qwen`), and normalizing case would let a
lowercase reupload — which is *not* the official org — earn the badge by
accident.

`SearchHuggingFaceModelsUseCase`
(`.../huggingface/search-huggingface-models.use-case.ts:28`) filters to
`official: true` results **by default**; `includeCommunity: true` returns
every publisher, each tagged `official`/not, and never hides the
distinction. The web side
(`apps/web/src/components/HuggingFaceModelBrowser.tsx:190-203`) renders that
choice as an off-by-default toggle plus a persistent, explicit danger-toned
warning banner (`Alert tone="danger"`) that only appears while community
results are showing — the opt-in and the risk warning are the same gesture,
never a setting a user can turn on once and forget is on.

## Consequences

**A route-shape deviation the caller must respect.** `repoId` is a body
field, never interpolated into a URL path — documented at the route and
repeated here so a future edit doesn't "simplify" it back into a path
param and reintroduce the `/`-in-a-segment bug.

**A real, declared corner cut: no queue.** The synchronous pull is a
deliberate trade-off, not an oversight — flagged in the use case's own
comment as ADR-worthy, which this ADR closes. A proper background queue in
the api is the natural next step if pull volume ever justifies the added
complexity; nothing here blocks building one later.

**Pulled models are priced and activated the same way any other local
Ollama model is.** `ConfirmModelPullUseCase` inserts into `models` with
price `0`/`manualPricing: false` (mirroring
`sync-model-catalog.use-case.ts`'s treatment of every other local Ollama
entry) and activates the model **only for the requesting workspace** via
`WorkspaceModelRepository.setActive`. This is not the "never activate an
auto-discovered model" rule from ADR 0042 being violated — that rule is
about a background sync discovering something nobody asked for; here
activation is the direct, traceable consequence of one human asking for
this exact model twice (request, then confirm).

**Display name is the raw `repoId`.** A pulled model's `displayName` is
whatever the Hub called it (e.g.
`meta-llama/Llama-3.1-8B-Instruct-GGUF`), never reformatted — left as a
product/UX question for later, not resolved here.

**The Hub search response carries no size estimate today.** The estimate
shown at confirmation time only ever comes from what the client already
knew when it called `POST .../pull-requests` (`estimatedSizeBytes`, always
`null` when not supplied) — the search endpoint doesn't populate one, so the
confirm screen will usually show "not reported by the Hub" rather than a
real number. Consistent with the product's declared rule of never
fabricating an estimate; not a bug, a real current limitation of what the
Hub's search response exposes.

## Alternatives considered

- **Reuse `proposed_actions`.** Rejected for the reasons traced in
  Decision above: no session to hang it from, a policy-resolution stage
  built for agent autonomy tiers that doesn't apply to a human's own
  request, a closed `ActionType` vocabulary whose UI surfaces are built for
  a different question, and a "second confirmation" that is a direct-action
  safety gate, not an approve/deny gate on someone else's proposal.
- **A boolean `confirmed` flag on a single-step request, instead of a
  state machine.** Rejected: the two-request shape (`create` then a
  separate `confirm` call, gated by role on both routes) is what makes the
  confirmation **explicit and re-visitable** — a flag flipped in the same
  request as creation would collapse the two steps the product explicitly
  wants kept apart, and `ConfirmModelPullUseCase`'s refusal to re-confirm
  falls directly out of modeling it as states instead of a flag.
- **Case-insensitive publisher matching for the official badge.** Rejected:
  the Hub itself treats publisher names as case-sensitive, and folding case
  would hand the "official" badge to a lowercase reupload of an official
  org's name — exactly the kind of name a less careful third-party
  publisher would choose on purpose.
