---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0156 — The self-downgrade ceiling also on project member removal

## Status

**Accepted.** It closes the gap that
[ADR 0127](0127-tetos-de-rebaixamento-em-project-members.md) declared in writing
and pinned in a test. It neither revokes nor revises it: the two ceilings of that
ADR remain exactly as they are, and what changes is the set of DOORS through
which ceiling 2 is evaluated. It corresponds to `BRB-001`, a security P1 of the
maintainer's register.

## Context

ADR 0127 put two ceilings on the WRITE path of `project_members` — nobody
downgrades the workspace `owner`, nobody downgrades themselves — and
deliberately chose not to cover a third move, leaving the reason and the cost
recorded in the section "Still possible, by name":

> **self-downgrade through REMOVAL.** `RemoveProjectMemberUseCase` did NOT gain
> a ceiling (…) The premise that "removal is always benign" is false, and it
> stays written here so it is not rediscovered. Both cases are PINNED in tests
> (…), including the one that remains open, so the next person knows it is a
> decision and not forgetfulness. Closing it costs the signature of
> `RemoveProjectMemberUseCase.execute`, which today is called by
> `list-projects-and-members.use-case.spec.ts` with two arguments.

This ADR is that next person, and the foreseen cost was exactly the one charged.

**The defect, measured.** `RemoveProjectMemberUseCase.execute` received
`(projectId, userId)` — **it did not receive the actor** — and the controller
(`@Delete(':projectId/members/:userId')`, `@RequireRole('maintainer')`) called it
with the two route parameters, without `@CurrentUser()`. Since
`ResolveEffectiveRoleUseCase.forProject` is `projectRole ?? workspaceRole`
([RN-471](../business-rules.md#rn-471)), deleting the project row does not delete
a role: it SWAPS the effective role for the second term. When the workspace role
is lower, the net effect is the downgrade ceiling 2 exists to prevent, with the
same irreversibility — going back is `POST :projectId/members`, which requires
the `maintainer` one just abandoned. With no workspace role at all, the fall is
to NO access.

The case had been reproduced in a test since ADR 0127, with its name saying what
it documented: *"e a remoção SEGUE podendo rebaixar quem a chamou, quando o
workspace não segura — lacuna declarada no ADR 0127"*. A `maintainer` whose
authority came from the project row, `viewer` in the workspace, removed their own
row and fell to `viewer` with no way back through the screen.

**Why it is the same rule, and not a new one.** Ceiling 2 compares TODAY's
effective role with the effective role AFTER, and never needed to know through
which route the second arrived. In `add` the after-role is the body's; in removal
it is the workspace's. Writing a second rule for the second door would be the
fourth copy of a comparison that already lives in
`domain/iam/tetos-de-rebaixamento.ts` — and copying a rule is the failure mode
this repository pursues in several places (the generated list of areas,
`roleAtLeast` with the same name on both sides, `caminhoDeWorkspaceLocalValido`
reused instead of rewritten).

## Decision

**1. Removal now receives the actor and refuses the net self-downgrade.**
`RemoveProjectMemberUseCase.execute` becomes `(projectId, atorId, alvoId)` — the
same order as `AddProjectMemberUseCase` — and throws `ForbiddenException` (403)
when removing the CALLER's OWN row would leave them with a lower role than
today's. The controller passes `@CurrentUser()`, as `add` already did.

**2. The rule is ceiling 2 reused, with the workspace role in place of the
requested role.** `remocaoEhAutoRebaixamento` enters the same domain module, and
it reimplements no comparison at all: it delegates to `ehAutoRebaixamento`
passing `papelPedidoNoProjeto: papelDoAtorNoWorkspace`. It exists, instead of the
use case calling `ehAutoRebaixamento` directly, because of ONE case the other's
signature cannot state — an actor without a workspace role, where the
after-role is "none", which is not a `Role`. That case is the maximum downgrade
and refuses.

**3. Ceiling 1 does NOT gain a pair, and the absence is a decision.** Removing
the project row of someone who is WORKSPACE `owner` can only RAISE their
effective role, or keep it: `owner` is the top of `ROLE_ORDER`, so there is no
workspace role for which the fall is a fall. More than harmless, the move is the
ONLY way to undo the restriction that ceiling 1 of ADR 0127 prevents from being
created — a workspace `owner` who already had a `viewer` row in a project
(written before that ADR, or by a direct database write) reaches their own
project again exactly that way. A ceiling there would refuse only benign moves,
and would make permanent a state ADR 0127 was born to eliminate. The absence is
written in the code, next to the function, and pinned in a test.

**4. No threshold, like ceiling 2.** The refusal is "oneself", not "below
`maintainer`", and the declared price of ADR 0127 comes along: the self-removal
that drops from project `owner` to workspace `maintainer` is reversible and ALSO
FALLS. It remains reachable by another `maintainer`. That case used to pass and
now refuses — it is the only behavior change this ADR introduces on a benign
move, and it is the same trade ADR 0127 had already accepted for `add`: a clause
with no number, against an exception that needs to be explained every time.

**5. The message is ITS OWN, not `add`'s.** Whoever clicked "remove" did not ask
to change any role, and a sentence talking about "downgrading oneself" would not
explain what happened. `MENSAGEM_TETO_AUTO_REBAIXAMENTO_POR_REMOCAO` states the
mechanism: without the project row the role falls to the workspace's, and going
back requires the abandoned role.

**6. The OpenAPI description now describes the code.** The route's said only
that "whoever has a role in the workspace keeps seeing the project by
inheritance" — half true, and the missing half is the reason for this decision:
the inheritance can be LOWER than the row. `openapi.json` and
`api-types.generated.ts` come from the generator.

## What this ADR explicitly rejects

- **A workspace `owner` ceiling on removal.** See point 3. It is not a forgotten
  symmetry: there is no removal that downgrades a workspace `owner`.
- **A second role comparison rule.** See point 2. The comparison keeps living in
  a single place.
- **Touching `ResolveEffectiveRoleUseCase.forProject`.** `projectRole ??
  workspaceRole` stays byte for byte, in both directions — it is the capability
  ADR 0127 refused to eliminate, and nothing here reopens the question.
- **Extending the ceiling to the workspace.**
  `POST workspaces/:workspaceId/members` is an upsert with no ceiling at all, as
  ADR 0127 already declared — and removal does not even exist there:
  `WorkspacesController` has no member `@Delete` (measured), so the equivalent
  move is not reachable over HTTP in that scope. Different scope, separate
  decision.
- **Blocking the removal of ANOTHER person, even when they drop in role.** It is
  the usual legitimate capability — the same that restricts a `developer` to
  `viewer` in a sensitive project —, and it applies to removal as it applies to
  writing.
- **A gate on the screen.** See Consequences.

## Consequences

**A benign move falls along, and it is the price already accepted.** The
self-removal of someone with `owner` in the project and `maintainer` in the
workspace was allowed and becomes 403. It is reversible by another
`maintainer`, and the test that pinned the permission now pins the refusal, with
its name saying it is the price of the ceiling without a threshold. Whoever wants
to leave a list in that situation asks another `maintainer` — the same outcome
ceiling 2 already produced through `add`.

**The screen still offers the button the api refuses, and the refusal shows.**
`MembersSection.handleRemove` already has a `try/catch` with `mensagemDaApi`
([RN-471](../business-rules.md#rn-471)), so the api's sentence reaches the toast
without a single web line. Unlike ceiling 1, this gate IS computable on the
client — `userIdDaSessao()` and the effective role are there —, but computing
only it would produce a button honest about one refusal and silent about the
other, which is exactly the half-gate ADR 0127 refused. It is left for the web PR
that solves the whole problem.

**Two more queries per removal**, even when the target is another person: the
actor's `forProject` (which redoes the `findById`) and `forWorkspace`. It is the
cost ADR 0127 had already accepted in `add`, on an administration route, and the
alternative — an `if (atorId === alvoId)` before the reads — would repeat in the
use case the clause the pure function exists to contain.

**The signature changed, and two tests called it.** `execute` has three
arguments now; `list-projects-and-members.use-case.spec.ts` and
`tetos-de-rebaixamento.use-case.spec.ts` were updated. There is no other caller:
the constructor gained `ResolveEffectiveRoleUseCase`, which was already
registered in `iam-use-cases.module.ts`.

**The gap test became a ceiling test.** The block ADR 0127 left pinning the hole
("removal STILL can downgrade whoever called it") was INVERTED instead of
deleted, and the name keeps the origin. It is the form this repository already
uses so as not to lose the evidence of why something existed.

**Still possible, by name:** downgrading another person through the removal of
their row; self-PROMOTION (unchanged); and the entire workspace scope, whose
member `POST` remains without a ceiling.
