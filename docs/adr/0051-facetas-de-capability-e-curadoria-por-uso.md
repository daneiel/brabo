# 0051 — Proven capability facets; "what it's good for" is curation

## Context

OpenRouter's first real sync brought **338 models** into the curation
screen. Grouping by manufacturer (Phase 12, hub with subgroups) made the
list navigable, but didn't answer the question actually asked in front of
it: *which of these serves what I need right now?*

Two findings, measured against the live API, bound the problem.

**First: the catalog already published what the screen didn't show.** The
parser read `id`, `name`, `context_length`, `pricing`, and
`supported_parameters` — and discarded `architecture`. Worse, the sync
never consulted the remote for modality capability at all:

```ts
// sync-model-catalog.use-case.ts:202, before
supportsVision: local?.supportsVision ?? false,
```

The value came from whatever was already stored, and whatever was stored
had been born `false`. Result: `supports_vision = false` across all 338,
including models whose entire provider page is titled "vision." The
column was born false and died false — there was no path by which it
could ever become true.

Against the 2026-08-04 catalog, OpenRouter declares: **181** models accept
image input, **11** produce image output, **213** accept `reasoning`,
**25** accept audio, **0** produce video.

**Second: half of what people want to filter by doesn't exist in any
catalog.** The request included "best AIs by type — documentation, image,
video, thinking, code." Image and thinking are declared by the provider.
"Best for code" and "good for documentation" **no provider publishes** —
there's no field, no convention, nothing beyond the model's name. And
deriving capability from the name is exactly what
[ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)
forbids: capability is only declared when the suite proves it.

Video is the extreme case: zero models, across nine providers. A video
facet would be a filter that never matches anything.

## Decision

**The two axes exist, separated, and each lives where its truth lives.**

### 1. Capability facet — what the provider PROVES

Three new fields on `models`, fed by the remote catalog:

| field | OpenRouter source |
|---|---|
| `supports_vision` | `architecture.input_modalities` contains `image` |
| `generates_image` | `architecture.output_modalities` contains `image` |
| `supports_reasoning` | `supported_parameters` contains `reasoning` |

Image input and output are **distinct axes**, not one: a model that reads
diagrams and one that draws them solve different problems, and merging
them would send the user to the wrong model.

The sync now reads from the remote with local fallback, in the same shape
as `supportsToolCalling`:

```ts
supportsVision: remoto.supportsVision ?? local?.supportsVision ?? false,
```

`undefined` on the remote side preserves the local value — **absence of a
declaration is not a declaration of absence**. The parser omits the field
when the provider says nothing, instead of emitting `false`; declaring
`false` there would wipe out hand-done curation the first time the
provider changed its catalog's format.

Audio and video are left **out**: audio because no part of the product
consumes it today, video because it doesn't exist. They come in when
there's something to filter.

### 2. Usage curation — what the TEAM discovered

A closed vocabulary of five uses — `codigo`, `documentacao`, `analise`,
`imagem`, `conversa` — flagged per workspace, in the
`workspace_models.uses` column (`text[]`).

It lives in `workspace_models`, not `models`, for the same reason as
[ADR 0049](0049-curadoria-de-modelo-por-workspace.md): it's **the
operator's opinion**. The same model is "the coding one" in one workspace
and the cheap-chat one in another, and whoever pays the bill has the right
to decide. There's no global axis because there's no global answer.

The vocabulary is **closed**, not free text: `code`, `coding`, `Code`, and
`código` all showing up on the same screen within a week produces a filter
that matches nothing — worse than no filter at all. A new use enters the
type and gets a migration, with exhaustiveness proven at compile time on
both sides (the same mechanism as `llm-provider-names.ts`).

`text[]`, not a Postgres enum, like `delegations.area` from Phase 8: a new
use shouldn't require a type migration.

### 3. The two axes never mix, in the UI or in the database

- The facet badge and the usage badge have **different tones** on the
  catalog row, and the filter chips are separated by a divider.
- Flagging a use **doesn't turn the model on** in the picker. The
  `is_active` column has DEFAULT `true`, so a row born from a usage flag
  is inserted with `isActive: false` explicit — without that, opining
  about a model would authorize it to spend, against
  [RN-043](../business-rules.md#rn-043).
- Changing the use doesn't turn off what was already on: `is_active`
  stays out of the `ON CONFLICT`'s `SET`.
- The screen never writes "doesn't read images." A badge only affirms
  what's true, because `false` here means "the provider didn't declare
  it."

## Consequences

- The screen answers "which model serves this" through two paths: what
  the provider proves and what the team discovered by using it.
- A filter that zeroes out the list becomes distinguishable from an empty
  catalog — before, the screen would say "register a credential" to
  someone who already had one.
- The existing catalog only gets the true facets **on the next sync**:
  the migration creates the columns with `false`, and it's the sync that
  fills them in from the remote. No backfill is possible without querying
  the provider, and inventing a value would be the original defect all
  over again.
- The eight providers that don't publish modality stay at `false` —
  honest, and gracefully upgradable the moment any of them starts
  declaring it.
- "Best for code" will never be a capability in this product. If a
  provider ever publishes a field like that, it will be one more
  opinion — theirs — and it doesn't replace the team's.

Three designs were discarded, and the reason for each is the consequence
it would have left behind:

- **Inferring use from the model's name** (`*-coder-*` → code): a guess
  dressed as data. It fails on the generalist that's good at code, fails
  on the one with "coder" in the name that the team found bad, and no one
  who knows can correct it.
- **Global use in `models`**: would repeat exactly the defect ADR 0049
  fixed — one workspace deciding for its neighbor.
- **Free text for use**: fragments the vocabulary within a week and turns
  the filter into a text search.

## What's left for later

**Audio and video facets**, once there's something to filter: audio
already has 25 models on OpenRouter, but no part of the product consumes
audio today; video has zero across nine providers.

**Sorting the catalog by flagged use** — today use only filters. With the
vocabulary locked, sorting is a one-liner; with nobody having flagged
anything yet, it would sort by an empty list.

**The facets on the other eight providers.** Only OpenRouter publishes
modality today; each of the rest needs to be investigated against its
official docs, the way Phase 11 did for the quirks — inheriting one
provider's parser for another is forbidden.

The rules are in [RN-056](../business-rules.md#rn-056) and
[RN-057](../business-rules.md#rn-057).
