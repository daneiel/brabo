# 0049 — Model curation per workspace

## Context

[ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
spelled out the problem plainly and did not solve it:

> **Catalog per workspace.** Today curation is global and the `:workspaceId`
> in the route is just an RBAC anchor — an owner of workspace A activating a
> model activates it for B too.

It wasn't theory. `models.is_active` was **one column for the entire
installation**. The curation routes were already
`/workspaces/:workspaceId/models/*` — but `:workspaceId` never entered the
query; it only served so `RolesGuard` had somewhere to pull the effective
role from. Whoever clicked "activate" on a screen decided for every
workspace in the installation, and the screen gave no sign of that.

Three consequences, in order of severity:

1. **One workspace turns on an expensive model for its neighbor.** The
   other workspace's picker starts offering it, and the spend shows up in
   the budget of someone who decided nothing.
2. **Turning off is just as contagious.** An owner removing a model they
   don't trust from the picker also removes it for anyone who depended on
   it.
3. **There was no way to know who decided.** `is_active` is a boolean with
   no author and no timestamp of its own.

## Decision

**The catalog stays global; curation becomes per workspace.**

The split answers the question "who owns this data?":

| data | owner | where |
| --- | --- | --- |
| name, price, window, capabilities | the **provider** | `models` (global) |
| `availability` | the **provider**, observed by sync | `models` (global) |
| `is_active` — does it show in the picker? | the **workspace** | `workspace_models` |

`workspace_models` has `(workspace_id, model_id)` as primary key, plus
`is_active` and `curated_by`.

### Why NOT duplicate `models` per workspace

The obvious alternative — one `models` row per workspace — was rejected:

- It would create **N truths about the same model**. `gpt-4o`'s price is
  the same for everyone; keeping it in N rows guarantees they diverge.
- It would split `token_usage.model_id` and `model_bindings.model_id` down
  the middle: the cost history points to one `models` row, and duplicating
  it would require rewriting the past — exactly what
  [RN-044](../business-rules/custo.md#rn-044) forbids.
- The catalog sync would go from writing once to writing N times for the
  same fact.

### Absence of a row IS "off"

There is no third state, "never decided," separate from "off." A model the
sync discovers simply **has no row** in `workspace_models`, and reads treat
it as inactive.

This preserves [RN-043](../business-rules/custo.md#rn-043) ("discovered model
starts off") **with no column at all in `models` for the sync to be able to
run over** — the sync no longer has any curation field in its upsert. The
rule went from "the sync writes `false`" to "the sync never reaches that
decision," which is stronger.

Turning off, however, is `UPDATE`, not `DELETE`: deleting the row would
also erase who decided and when. Reads treat both cases as inactive; the
record exists for whoever needs to audit it.

### The picker route hangs off the PROJECT

`GET /models` became `GET /projects/:projectId/models`, not
`/workspaces/:workspaceId/models`. The three screens that consume the list
(overview, settings, and the session) are all inside a project and **none
had a workspace at hand**; `RolesGuard` resolves the role from
`:projectId` just as well. The workspace comes out of the project inside
the use case — one translation, in one place, instead of scattered across
the UI.

### `isActive` left the `Model` entity

`Model` no longer has `isActive`; whoever needs it uses
`ModelComCuradoria`, a type that **only exists when a workspace is at
hand**. The same holds on the wire: `ModelResponseDto` (picker) and
`ModelComCuradoriaResponseDto` (curation).

It's deliberate that the workspace-less version doesn't compile: it was
precisely the existence of a global curation read that produced the
defect, and a type is more reliable than a comment asking for care.

## Consequences

- **Data migration before the `DROP`.** Migration `0034` does the
  cartesian product of `workspaces × models WHERE is_active` and only then
  drops the column: every existing workspace receives exactly what it saw
  before. `curated_by` is left null on those rows — the decision came from
  a global curation that never recorded an owner, and null is more honest
  than attributing it to the workspace's creator.
- **HTTP contract break.** `GET /models` no longer exists. It's the only
  route that moved, and it's in the CHANGELOG as a breaking change.
- **The seed had to start curating.** Without an explicit activation call,
  the models would exist in the catalog and the picker would come up
  empty — and the workspace binding, right below in the same seed, would
  be rejected for "model deactivated."
- **`agent` and `session` scopes don't check curation.** Neither has a
  workspace anchor: agent binding is by global SLUG (the route's
  `:projectId` is explicitly ignored today). `assertModelIsBindable`
  receives `null` in those cases and checks only availability. The gap is
  old and is now **explicit** instead of being papered over with a guessed
  workspace.

## What's left for later

- **Per-project agent binding.** As long as the `agent` scope is a global
  slug, curation has no way to reach it. Fixing this changes the semantics
  of binding, not of curation — and deserves its own decision.
- **Curation inheritance.** A new workspace is born with no model linked
  at all, and today someone has to link them one by one. An installation
  default, or copying from the first workspace, would fix this — but it's
  product policy, not a technical consequence of this decision.
- **Per-workspace budget tied to curation.** Turning on an expensive model
  is still a decision with no cap of its own; the real caps remain
  project, session, and task.
