---
traducao_de: 15e14c662cd4de7b1d041babd7caf3ef71f9ae2a
---

# 0173 — Workspace member removal is born, protected by the same clause

## Status

**Accepted.** It is the FOURTH in the line opened by
[ADR 0127](0127-tetos-de-rebaixamento-em-project-members.md) and continued by
[ADR 0156](0156-teto-de-auto-rebaixamento-na-remocao.md) and
[ADR 0157](0157-teto-de-auto-movimento-no-upsert-de-workspace.md). It opens the
door that 0157 refused to open in passing — *"A route for removing a workspace
member (…) Separate decision, if someone asks for it"* — by decision of the
maintainer (2026-09-27, AT-115/HS-006): **the route is born, protected by a
CLAUSE.** An accepted ADR is not edited: 0157 still says the route does not
exist, and this one is what says it now exists.

## Context

Offboarding a workspace member was a direct write to the database:
`WorkspacesController` had no member `@Delete` — measured during `BRB-002` and
used by 0157 as part of its argument. 0157 left three questions for whoever
opened this door, and HS-006 showed they are the same conversation:

1. **the last `owner`.** Today the "never zero owners" invariant comes from a
   clause — removing the last one would require them to do it themselves, and
   ceiling 2 prevents that. HS-006 feared a removal route would reopen that
   path and that the guarantee would have to come from a count, which is what
   0127 refused (*"stated as a clause, it has no number to go stale"*);
2. **ceiling 1 in the workspace.** It was left out (0157, point 3) because,
   combined with the absence of a removal route, it would make `owner` an
   absorbing state;
3. **ceiling 2 on removal**: does it inherit the delegation of project removal
   (`remocaoEhAutoRebaixamento`) or need its own statement, since here the
   "after" is always *none*?

## Decision

**1. `DELETE /workspaces/:workspaceId/members/:userId` is born, `owner`, 204.**
The same minimum as the upsert: whoever changes the member list is whoever
maintains it. Idempotent like project removal — a target without a row is not
an error.

**2. Ceiling 2 is INHERITED, with no new rule.** `RemoveWorkspaceMemberUseCase`
calls `remocaoEhAutoRebaixamento` passing the actor's WORKSPACE role as today's
effective role (in the workspace there is no composition: the effective role is
the row) and `null` as the role AFTER. That branch already existed — it is the
one for a project without a workspace row, *"the maximum demotion"* — and it
answers question 3: the "after" here is always *none*, and the function already
knew how to state *none*. Removing oneself from the workspace is **always 403**,
with its own sentence (`MENSAGEM_TETO_AUTO_REMOCAO_DO_WORKSPACE`): whoever
clicked "remove" did not ask for a role change, the same reason project removal
got its own in 0156. The parameter names stayed the project ones: renaming them
would change the other doors for the sake of a reading, and the function's
docblock states the reading.

**3. The last `owner` is protected by the SAME clause, without counting
owners.** The proof, in the mould of the one 0157 made for the upsert:

- the route requires `owner` (`@RequireRole('owner')`), so **whoever removes is
  always an `owner`** of the workspace;
- **nobody removes themselves** (point 2);
- therefore every successful removal leaves at least one `owner` standing:
  **the caller themselves**. Removing the last one would require them to remove
  themselves — the refused move.

HS-006's premise ("the route would reopen the path") was not confirmed: the
route OPENS the removal of others, but removing the last one is precisely
self-removal, and that remains closed by the clause that already closed
self-demotion. Counting stays refused for the reasons in 0157, point 2. The
proof is in a test: *"with two owners, any sequence of removals leaves at least
one: whoever removes stays"*, and the route's `owner` minimum is asserted in the
controller test, because it is HALF of the proof — if the minimum drops, the
proof drops with it.

**4. Removing ANOTHER `owner` remains possible.** It is the way to revoke
ownership entirely, and it is the natural extension of 0157's point 3, which
kept demoting another owner. **Ceiling 1 still has no counterpart in this
scope** (question 2): the premise HS-006 saw falling — "there being no way out
of `owner` over HTTP" — was 0157's COST argument, and the PRINCIPLE one still
stands: ceiling 1 is a rule about hierarchy inversion, and
`@RequireRole('owner')` makes inversion impossible. The new route only
reinforces the cost: with it and a mirrored ceiling 1, removing another owner
would also be refused, and `owner` would become absorbing again.

**5. The cascade, in one transaction.** Removing the `workspace_members` row
alone would be cosmetic: the `projectRole ?? workspaceRole` overlay
([RN-471](../business-rules.md#rn-471)) would keep the removed person inside
every project where they had their own row. So, together:

- the `workspace_members` row;
- the removed person's `project_members` rows **in this workspace's projects**
  (those of other workspaces are not touched);
- their credentials tied to those projects: the **PROJECT** device keys (by the
  same column that [RN-519](../business-rules.md#rn-519) lists) and the
  **PATs** — every PAT belongs to a project (`project_id NOT NULL`) —, revoked
  with the reason `workspace_member_removed`. Without this, being re-added one
  day would silently reactivate a pairing the removal should have ended.

**6. After the commit, the live connection drops via the RN-520 path.** One
`disconnectRunnerOfUser(projectId, userId)` per project of the workspace — ALL,
not only those in `runner` mode, because the runner also connects in
`container`/`mounted` (the mirror, [RN-516](../business-rules.md#rn-516)); one
extra project costs a `sem_runner`, one missing leaves standing what the
removal exists to bring down. In a `try/catch` that only logs: a side effect
never brings down the main effect, the rule of
[RN-520](../business-rules.md#rn-520).

**7. The HOLDER does not leave; holdership is transferred** (maintainer
decision, 2026-09-27, [RN-616](../business-rules.md#rn-616)).
`workspaces.created_by` does not decide authorization (the role does, ADR 0127),
but it is what resolves the LLM credential the agents spend and the git
credential of agent actions ([RN-058](../business-rules/custo.md#rn-058),
`ResolveCredentialOwnerUseCase`) and the owner of the spending report
([RN-060](../business-rules/custo.md#rn-060)). Removing the creator through
point 4 would leave the agents spending the credential of someone no longer in
the workspace. So, under the name **holder**:

- `DELETE .../members/:userId` targeting the holder is a **named 409**,
  `criador_do_workspace`, saying that a transfer is needed first and why. The
  point-2 ceiling comes first: the holder trying to remove themselves gets the
  usual 403. Point 3 still holds — the holder is an `owner`, and the caller is
  still the owner who stays.
- `PUT /workspaces/:workspaceId/owner-of-record` is born, `owner`, body
  `{ userId }`. The target must ALREADY be an `owner` of the workspace — being
  holder means paying — otherwise **409** `titular_precisa_ser_owner`. It
  writes `created_by`, in a transaction with the role read; transferring to the
  current holder is idempotent. Any `owner` can call it, including transferring
  to ANOTHER owner who did not ask: it is the same authority that already
  removes and demotes owners, and the target's consent would be an invitation
  flow the product does not have.
- **Spending, from the commit on:** `ResolveCredentialOwnerUseCase` starts
  returning the NEW holder; the agent turn looks for THEIR credential for the
  model's provider, and git actions, their git credential. If they do not have
  one, the product does what it already did with any holder without a
  credential: the turn ends with `"Nenhuma credencial cadastrada para
  <provider>"` (`RunLlmTurnUseCase`/`StreamLlmTurnUseCase`) and the git remote
  read fails naming whose credential is missing. The transfer does NOT check
  this beforehand — it would be one read per provider without knowing which
  ones the projects use, and refusing because of it would lock precisely the
  exit of the holder who is leaving. `ollama` uses no credential and stays the
  same. Spending already recorded stays where it was: `token_usage` does not
  store the holder, and the report is now read by the new holder in full,
  history included.
- There is no domain event for member or holdership changes (the upsert and the
  removal do not emit one either); the transfer leaves a log line with
  from/to/who. An audit event for all three is a separate front.

## What is declared and NOT done

- **MACHINE keys** (`project_id` null) stay: they belong to the ACCOUNT and
  serve the person's other workspaces. Here they no longer reach anything — the
  `PatAuthGuard` resolves the role against the requested project, and it is
  none.
- **Open sessions** stay open: they belong to the project, not the person, and
  the event log is append-only. A session socket ALREADY connected by the
  removed person stays until it drops; the new ticket (RN-108) requires
  `viewer` and is refused. Dropping the session channel per user would require
  a new command in the engine — a separate front.
- **The `:web` terminal** of the removed person is not a target of the
  disconnection (RN-520 only drops `:runner`); same gap, same reason.
- **Screen.** There is no workspace members section in `apps/web` (measured: the
  only trace of `/workspaces/:id/members` is the generated type in
  `api-types.generated.ts`, and there is not even a `GET` of workspace members).
  None is created here; the route is an API route, like the upsert.

## Consequences

**Offboarding stops being a database write.** An `owner` removes any other
person, including another `owner` (the holder after transferring), and the
removal is real: they leave the workspace and all its projects, and their
runner drops.

**The ceiling line has five doors and two ceilings.** No new ceiling was born:
ceiling 2 gained one more door, through the same function, and ceiling 1 stays
only in the project. `docs/security-surface.md` gets the note about the fifth
route.

**Two old sentences become false, and this ADR is what replaces them.** The one
in 0157 (*"`WorkspacesController` has no member `@Delete`"*) and the 403
message for self-demotion in the workspace, which said *"there is no route that
removes a member"* and no longer does — an error sentence cannot assert what is
not true.

**One more query before writing** (the actor's role), and N HTTP calls to the
engine afterwards, one per project of the workspace, on the least frequent
administration route in the product.
