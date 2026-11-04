---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0157 — The self-movement ceiling on the workspace upsert, and the self-promotion that was a loophole

## Status

**Accepted.** It is the THIRD in the line opened by
[ADR 0127](0127-tetos-de-rebaixamento-em-project-members.md) and continued by
[ADR 0156](0156-teto-de-auto-rebaixamento-na-remocao.md). It closes the last
move the two left declared in writing, and **revises** one sentence of 0127:
self-PROMOTION, which it recorded in the Consequences as a capability that
stayed, is now refused. An accepted ADR is not edited — this one references it
and says what changed. It corresponds to `BRB-002`, a security P1 of the
maintainer's register.

## Context

The two previous ADRs closed the three doors of `project_members` — the two
write ones and the removal one — and each of them pointed, in so many words, to
what was left open. 0127:

> downgrading the workspace `owner` **in the workspace**. Ceiling 1 is about
> `project_members`. `POST workspaces/:workspaceId/members` remains an upsert
> with no ceiling at all — same class of defect, scope above, not addressed
> here.

And 0156, reaffirming:

> **Extending the ceiling to the workspace.** `POST workspaces/:workspaceId/members`
> is an upsert with no ceiling at all, as ADR 0127 already declared (…)
> Different scope, separate decision.

**The defect, measured.** `AddWorkspaceMemberUseCase` was a twelve-line
pass-through: `execute(workspaceId, userId, role)` calling
`workspaces.addMember`. **It did not receive the actor**, and the controller
(`@Post(':workspaceId/members')`, `@RequireRole('owner')`) called it with the
bare body, without `@CurrentUser()` — there was nothing with which to apply any
ceiling, just as there was nothing on removal before 0156.

It is the same class of defect one scope ABOVE, and it is more serious for two
reasons that do not exist in the project:

1. **there is no level above to hold the fall.** In the project, downgrading
   oneself drops the effective role to the workspace role, which often holds
   it. In the workspace the role is the role: an `owner` who writes themselves as
   `viewer` loses the whole workspace, and with it all projects, the LLM spend
   that is theirs by [RN-060](../business-rules/custo.md#rn-060), and the very
   ability to invite whoever would replace them;
2. **there is no member removal route to undo it by another path.**
   `WorkspacesController` has no member `@Delete` — 0156 had already measured
   that and used it as an argument not to extend the ceiling in that PR. Undoing
   is THIS same route, which requires the freshly abandoned `owner`. There is no
   way back through the screen, nor through the api.

**The second half: self-promotion.** ADR 0127 wrote, in the list of what
remained possible:

> **self-PROMOTION.** A `maintainer` can write themselves as project `owner`. It
> was already possible before this ADR and still is; the ceilings are about going
> down, and opening the question of going up here would have changed, in passing,
> a capability nobody asked to change.

There was a test pinning this — *"raising one's own role is not a downgrade and
still passes"* —, with a workspace `maintainer` writing themselves as project
`owner`. The decision not to open the question in that PR was right by process,
and the answer, now that it is open, is that **it is a loophole**. Both halves
are the same move — a person deciding alone what authority they have —, and the
upper one is the only one of the two that **escalates privilege**: 0127 could say
its ceilings were not about escalation ("nobody gains a role they did not have"),
and about self-promotion that is false. A `maintainer` becomes project `owner`
without anyone promoting them, and in a workspace with sensitive projects it is
the difference between restricting and being unrestrictable.

## Decision

**1. The workspace upsert receives the actor and refuses self-movement.**
`AddWorkspaceMemberUseCase.execute` becomes
`(workspaceId, atorId, alvoId, papel)` — the same order `AddProjectMemberUseCase`
has had since 0127 and `RemoveProjectMemberUseCase` gained in 0156 —, the
controller passes `@CurrentUser()`, and changing one's OWN role there is 403.

**2. The ceiling does NOT count owners.** Refusing only when the caller is the
last owner would be the obvious "safe" rule, and it is rejected by the literal
criterion of ADR 0127: *"it is stated in a clause, it has no number to age"*. A
count ages in three ways — it introduces one more read that can fall out of
phase with the write; it has to decide what to do when the second owner is a
service account or a person who left the company, which the api cannot tell
apart; and it makes the route's answer depend on the state of OTHER rows, so the
same call with the same body passes today and refuses tomorrow without anything
the caller controls having changed. Whoever wants to leave their own role asks
another `owner`, which is the same outcome ceiling 2 already produced in the
project.

And there is an argument stronger than aesthetics: **the clause already produces
the invariant the count would exist to guarantee.** A workspace never ends up
without an `owner`, because the route requires `owner` and the only actor able
to remove the last owner would be themselves — which is exactly the refused
move. The number does not need to be counted because the shape of the rule makes
it unreachable.

**3. Ceiling 1 does NOT have a pair in this scope, and the absence is a
decision.** It was really considered, because here — unlike 0156's removal — the
move EXISTS: an `owner` can downgrade another `owner`. The refusal comes from
ceiling 1 being a rule about **hierarchy inversion**, and inversion not being
possible in this scope:

- in the project, `projectRole ?? workspaceRole` makes the project row OVERRIDE
  the workspace one ([RN-471](../business-rules.md#rn-471)), so a `maintainer`
  reaches whoever is ABOVE them. That is how 0127 described the damage: *"the
  owner loses their own project (…) restoring requires `maintainer`, which the
  owner just lost in that scope"*. Whoever acted was BELOW whoever suffered;
- in the workspace that does not happen. `@RequireRole('owner')` is the top of
  `ROLE_ORDER`, so whoever calls the route is never below anyone it reaches. The
  precondition of ceiling 1 is absent — it is not a forgotten symmetry, it is a
  rule without a subject.

And the cost of adding the pair anyway would be high and irreversible: added to
the ceiling of point 1 and the absence of a removal route, `owner` would become
an **absorbing state** — nobody would ever leave it over HTTP, neither by their
own will nor by another owner's hand. Offboarding someone who leaves the
company, ownership rotation and correcting a wrong invitation would come to
require a direct database write. That is the class of state ADR 0127 was born to
eliminate, assembled again with the sign flipped.

Downgrading another `owner`, therefore, STAYS — and it is reversible through the
same route, by any remaining owner, which the project move was not.

**4. Self-promotion closes, on BOTH association routes.** Ceiling 2 stops being
"nobody downgrades themselves" and becomes "nobody touches their own role", in
both directions, in the project and in the workspace. Rewriting the SAME role
still passes: an idempotent upsert is not a move, and refusing it would break
`seed.ts`, which rewrites roles on purpose.

**5. The rule is not copied: the comparison becomes ONE classifier.** The module
`domain/iam/tetos-de-rebaixamento.ts` gains `autoMovimentoDoProprioPapel`,
which returns the DIRECTION (`'rebaixamento' | 'promocao' | null`) instead of a
boolean. It was this, and not a separate `ehAutoPromocao`, because **the caller
needs the direction**: the decision of point 6 requires different messages, and
two boolean predicates would make each use case ask the same comparison twice to
find out which of the two answered. `ehAutoRebaixamento` **still exists** and
becomes a reading of the classifier (`=== 'rebaixamento'`), byte for byte in
behavior.

It survives for a behavioral reason and not a compatibility one: whoever
delegates to it is `remocaoEhAutoRebaixamento`, and REMOVAL only sees the lower
half. Widening it would make removal also refuse self-promotion — and removing
one's own project row that restricted someone is precisely how one undoes the
restriction ceiling 1 prevents from being created, the benign move point 3 of ADR
0156 protected explicitly. Unifying everything would have changed, in passing, a
door this ADR did not open.

**6. The messages are specific by DIRECTION and by SCOPE.** There are four, and
none serves two things: whoever tried to promote themselves does not receive the
downgrade sentence (it is not what they did), and whoever hits the workspace
ceiling is not sent to talk to a `maintainer` — there the role that undoes is
`owner`. It is the same discipline as point 5 of ADR 0156 and of
[RN-470](../business-rules/custo.md#rn-470): do not collapse two states because
they share an outcome.

**7. The actor's role comes from the repository, not from
`ResolveEffectiveRoleUseCase`.** It is the inverse of 0156's choice, for the same
reason it gave ("no extra dependency for one read"): in the project use cases
`ResolveEffectiveRoleUseCase` enters so the actor's role does not become a second
composition of `projectRole ?? workspaceRole` written by hand; in the workspace
**there is no composition to protect** — `forWorkspace` IS
`workspaces.findMemberRole` —, and this use case already has the repository in
hand, because it is with it that it writes.

**8. 403, in the use case, never in `RolesGuard`.** Nothing new: the guard
authorizes the CALLER against the route's `@RequireRole` and sees neither the
body (`dto.role`) nor the target (`dto.userId`), and this ceiling is about the
actor↔target relation. The whole reasoning is in ADR 0127 and is not repeated
here.

**9. Promotion is enforced even though it is unreachable over HTTP on this
route.** With `@RequireRole('owner')`, the actor is already at the top and there
is nowhere to go up — the upper half of the ceiling, in the workspace scope, is a
mechanism that does not fire today. It enters anyway, and tested, for the reason
ceiling 2 always had not to have a threshold: the use case does not presume the
guard, and it is what stays right the day the route changes its minimum. It is
the same design as the capability refusal of
[RN-514](../business-rules.md#rn-514), implemented and tested before having a
trigger.

## What this ADR explicitly rejects

- **Counting owners.** See point 2. Neither "only the last one", nor "only if no
  other active owner remains". The clause has no number to age, and already
  produces the invariant of never having zero owners.
- **A workspace `owner` ceiling in this scope.** See point 3. It is neither a
  forgotten symmetry nor a reflexive discard: it is a rule about hierarchy
  inversion on a route where inversion is impossible, and adding it would make
  `owner` a state nobody leaves over HTTP.
- **A workspace member removal route.** Its absence is part of this ADR's
  context (it is why self-downgrade has no way back), and creating it would be
  opening a new door while closing another — and the new door would be born
  needing the same ceiling, plus the judgment about removing the last owner,
  which this ADR does not have the material to make. A separate decision, if
  someone asks for it.
- **Widening the project member REMOVAL ceiling to promotion.** See point 5. ADR
  0156 protected that move in writing and it stays byte for byte.
- **Touching `ResolveEffectiveRoleUseCase.forProject`.** Third ADR in a row in
  which this is said: `projectRole ?? workspaceRole` stays in both directions.
- **A gate on the screen.** There is no screen:
  `POST /workspaces/:workspaceId/members` has no caller in `apps/web` —
  measured; the only occurrence is the generated type in
  `api-types.generated.ts`. Whoever calls the route today is `seed.ts` (through
  the use case, with the `owner` as actor) and direct integrations. There is no
  toast to adjust, and no web line changes.

## Consequences

**A legitimate `maintainer` who needs `owner` in the project now depends on
another person.** It is the direct cost of the decision of point 4, and it is not
hypothetical: it was the path through which someone with the route's role gave
themselves the role they needed for the next task. It remains reachable — by any
other `maintainer` of the project, and by any `owner` of the workspace —, and
what is bought is that role elevation now takes two people. It is the same trade
ADR 0127 made for going down, with the same price in the same currency.

**ADR 0127's sentence about self-promotion becomes FALSE, and it is this ADR
that replaces it.** It remains written there, like every superseded decision in
this repository; whoever reads it has to get here. That is why the index line and
the docblock of `ehAutoRebaixamento` name the revision.

**The test that pinned the permission was INVERTED, not deleted**, with its name
keeping the origin — *"raising one's own role was allowed for being 'not a
downgrade', and becomes 403 (ADR 0157)"*. The same form 0156 used for the
removal gap test. It is the evidence of why the capability existed, and it is
not thrown away.

**One more query per workspace association**, and only one: the actor's role.
The route is an administration one and the comparison is pure, so the cost is
the same 0127 accepted in the project (where there were two) and 0156 on removal
(two).

**The signature changed, and there were TWO callers** — the controller and
`apps/api/src/db/seed.ts`, which passes `owner.id` as the actor. There the actor
and the target are different people on purpose, so no ceiling is reached and the
seed gains no exception at all. **`CreateWorkspaceUseCase` is not a caller**, and
it is good that it is not: it writes the creator as `owner` through the
repository, inside the creation transaction, which is a legitimate
self-promotion — the only one in the product — and would come to be refused if it
were ever routed through here. The comment next to the null-role clause records
this.

**The route's surface changed without changing any success response**, and it
is in `docs/security-surface.md`: `role:owner` remains in the table and remains
what `RolesGuard` enforces, but it is no longer the complete answer to "who can
do what here" — the third route in this family to receive that note.

**Still possible, by name:** an `owner` downgrading ANOTHER `owner` (point 3,
reversible through the same route); downgrading anyone who is not the caller, in
any scope, which is the usual capability; and self-PROMOTION through the removal
of one's own project row — removing the row that restricted someone raises their
effective role, and ADR 0156 protected that move on purpose.
