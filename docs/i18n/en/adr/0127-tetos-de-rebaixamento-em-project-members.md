---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0127 — Two downgrade ceilings on `project_members`, and the override stays

## Context

`ResolveEffectiveRoleUseCase.forProject` has been, since Phase 1,
`projectRole ?? workspaceRole`: when there is a row in `project_members`, it
**wins**, without comparing it with the workspace role. The override applies in
BOTH directions — up and down.

This was discovered by the review of #444, which closed the role gate of the
Members section, and is recorded in
[RN-471](../business-rules.md#rn-471). The finding has two halves. The first is
documentary: FOUR places promised the opposite — "the EFFECTIVE role is the
higher of this one and what the person already has in the workspace",
"associating someone as `viewer` here doesn't downgrade a workspace `owner`" —
three OpenAPI descriptions and a comment in `apps/web/src/lib/roles.ts`. RN-471
fixed the web one (it was the worst: it lived in the module that exports
`roleAtLeast` and `ROLE_ORDER`, that is, in the code the next person in this
family opens before anything else) and DECLARED the three in the api as not
fixed, because they are a contract change.

The second half was not kept anywhere, and it is the reason for this ADR: with
the override applying downward, `AddProjectMemberUseCase` was a one-line
passthrough to the repository upsert and `RemoveProjectMemberUseCase` only
checked whether the project existed. Neither of them looked at WHO the target
is nor at the relation between actor and target. Two consequences reachable by
any `maintainer`, today:

1. **downgrading the workspace `owner`.** A `maintainer` writes `viewer` for the
   owner in a project and the owner loses their own project — the dashboard
   read, the decisions, everything. Restoring it requires `maintainer`, which
   the owner just lost in that scope;
2. **irreversible self-downgrade.** A `maintainer` writes themselves as `viewer`
   and cannot undo it, because undoing is the same route, which requires
   `maintainer`. There is no way back through the screen.

None of this is privilege escalation — nobody gains a role they did not have.
It is loss of access, and the difference matters: a `maintainer` could already
do damage in the project, but could not produce a state from which NOBODY
leaves without going to the database.

The obvious path would be to make `forProject` return "the higher of the two"
and erase the problem at the root, aligning the code with the three
descriptions instead of the other way around. It was considered and REJECTED:
restricting someone in a sensitive project — a workspace `developer` who becomes
`viewer` in project X — is a deliberate product capability, and it is the only
way that exists to contain access per project. "The higher of the two"
eliminates it, and `resolve-effective-role.use-case.spec.ts` has always pinned
the upward half ("project role overrides the workspace one").

## Decision

**The override stays in both directions, and the two dangerous moves are now
refused.** `forProject` does NOT change: it remains `projectRole ??
workspaceRole`, and remains the only composition of that role in the system.

**Ceiling 1 — nobody downgrades whoever is workspace `owner`.** The role
requested for someone whose workspace role is `owner` must be `owner`; anything
below is 403. Writing project `owner` for someone who is already workspace
`owner` is redundant and passes — only the downgrade is refused.

The `owner` is read from **`workspace_members.role`**, never from
`workspaces.created_by`. Both exist in `db/schema/iam.ts` and are not the same
thing. `created_by` is a historical fact: who created the workspace. It is the
`role` that authorization uses EVERYWHERE else in the system —
`ResolveEffectiveRoleUseCase.forWorkspace` is `workspaces.findMemberRole`, and
`created_by` appears in no authorization path (it appears in
`get-credential-spend.use-case.ts`, to know whose LLM key is being spent, which
is another question). A ceiling that read `created_by` would protect the wrong
person in two concrete and opposite cases: the creator who already transferred
ownership and is now `developer` would be shielded without being owner, and the
current `owner` who created nothing — the normal case of a workspace with more
than one owner, and that of transferred ownership — would be unprotected, which
is exactly the hole the ceiling exists to close.

**Ceiling 2 — nobody downgrades THEMSELVES.** If the target is the caller
themselves and the requested role is lower than the effective role they have
TODAY in the project, it is 403.

That is the formulation, with no threshold. The alternative considered was "do
not self-downgrade **below `maintainer`**", with the argument that `maintainer`
is the role that undoes. Both refuse the dangerous move, but the one with a
threshold is a domain rule that copies a number from a controller's
`@RequireRole`: it ages silently the day the route changes its minimum, and it
cannot be stated without explaining where the `maintainer` came from. "Nobody
downgrades themselves" is a clause, has no number to age, and is the SAME shape
as ceiling 1 — who, not how much. The price is a harmless move that falls along
with it: an `owner` setting themselves as `maintainer` in their own project
would be reversible, and is now refused. It remains reachable by another
`maintainer`, and the cost of stating the rule with an exception is greater
than that of losing the move. **Raising** one's own role is not a downgrade and
is not touched here.

**Where the ceilings live: in the use case, with the rule in the domain.** Not
in `RolesGuard`. The guard answers another question — it authorizes the CALLER
against the route's `@RequireRole` — and sees neither the body (`dto.role`) nor
the target (`dto.userId`), while both ceilings are about the TARGET and about
the actor↔target relation. A guard that needed the body would have to know each
route's DTO, which is the boundary it exists not to cross.

The SHAPE follows the precedent the repository already has for an absolute
ceiling: `domain/actions/decide.ts` (RN-154, and RN-418 which revised RN-106) —
pure function, in the domain, message next to the condition, no configuration
key and no "always allow". The new
`apps/api/src/domain/iam/tetos-de-rebaixamento.ts` is that shape applied here,
and `AddProjectMemberUseCase` calls it before writing. What does NOT carry over
from the precedent is the outcome: in `decide.ts` the ceiling becomes
`require_approval` on an agent `proposed_action`, because there is a human
approval queue on the other side. Here the call already IS human and
synchronous, there is no queue to send it to, and the outcome is refusal.

**Status: 403 in both.** It is an AUTHORIZATION refusal — the caller has the
route's role and lacks authority for this specific move. It is not 409, because
it is not a conflict with a state that passes (waiting changes nothing); it is
not 400, because the body is valid and the same body with another target would
pass. `ForbiddenException` with its own message is what the other policy uses
in the api already do (`ActivateAgentUseCase`, `CreateSocketTicketUseCase`,
`RegisterUseCase`), and the message reaches the screen: #444 put a `try/catch`
with `mensagemDaApi` in the two actions that failed silently.

**The three OpenAPI descriptions that RN-471 declared now describe what the code
does** — those of `POST :projectId/members`, of `AddMemberDto.role` and the
summary of `GET :projectId/members`, which promised "includes whoever inherits
access from the workspace" while `listMembers` is an `innerJoin` on
`project_members`. `openapi.json` and `api-types.generated.ts` come from the
generator.

**The web side stays OUT of this PR**, and not because of size. The screen can
compute ceiling 2 on its own (`userIdDaSessao()` and the effective role are
already there since #444), but it **cannot** compute ceiling 1:
`listProjectMembers` returns the role of the PROJECT ROW, and the target's
WORKSPACE role is within reach of no client query. Disabling half of the
options would produce a `Select` that is honest about one refusal and silently
wrong about the other — the second role source invented on the screen that
RN-471 itself writes against. Meanwhile, the refusal SHOWS: `handleRoleChange`
already shows `mensagemDaApi(erro, …)` in a toast, and it is the api's sentence
that explains WHICH ceiling was hit.

## Consequences

**The override remains a double-edged sword, and that is what was bought.**
Neither of these two ceilings makes `projectRole ?? workspaceRole` safe in
general; they refuse two named moves. A `maintainer` can still downgrade anyone
who is NOT workspace `owner` and who is not themselves — including another
`maintainer`, including in a way the victim cannot undo. That is the
capability, not an oversight: it is the same mechanics that restricts a
`developer` to `viewer` in a sensitive project, and there is no way to keep one
without the other. What changed is that the state from which NOBODY leaves
(owner out of their own project; the only `maintainer` erasing themselves) is
no longer reachable.

**Still possible, by name:**

- downgrading another `maintainer` who is not workspace `owner`, without their
  consent and with no way back by their hand;
- **self-downgrade through REMOVAL.** `RemoveProjectMemberUseCase` did NOT gain
  a ceiling, and that is one more move, outside the two chosen. Removing one's
  own row drops the effective role to the workspace role: when the workspace
  holds (`maintainer` there), it is benign and is precisely how someone leaves
  the list; when it does NOT hold — the `maintainer` whose authority came from
  the project row, with `viewer` in the workspace — it is irreversible
  self-downgrade through the other door. The premise that "removal is always
  benign" is false, and it stays written here so it is not rediscovered. Both
  cases are PINNED in tests (`tetos-de-rebaixamento.use-case.spec.ts`),
  including the one that remains open, so the next person knows it is a
  decision and not forgetfulness. Closing it costs the signature of
  `RemoveProjectMemberUseCase.execute`, which today is called by
  `list-projects-and-members.use-case.spec.ts` with two arguments;
- **self-PROMOTION.** A `maintainer` can write themselves as project `owner`.
  It was already possible before this ADR and still is; the ceilings are about
  going down, and opening the question of going up here would have changed, in
  passing, a capability nobody asked to change;
- downgrading the workspace `owner` **in the workspace**. Ceiling 1 is about
  `project_members`. `POST workspaces/:workspaceId/members` remains an upsert
  with no ceiling at all — same class of defect, scope above, not addressed
  here.

**The screen offers what the api refuses, for now.** It is exactly the defect
that the last PRs of this family closed, and it comes back through one PR, on
purpose: half of the gate is impossible on the client today (see Decision). The
web PR needs to decide between exposing the target's workspace role in
`GET :projectId/members` — a contract change, and RN-471 already recorded that
the route promises an `innerJoin` it does not do — and erasing only what it
knows. Until then, the refusal is told by the toast, with the api's sentence.

**A 500 became a 404.** `AddProjectMemberUseCase` now calls `projects.findById`
(it needs the `workspaceId` to read the target's role) and throws
`NotFoundException` when the project does not exist, as
`ListProjectMembersUseCase` and `RemoveProjectMemberUseCase` already did. Over
HTTP it is unreachable — `RolesGuard` refuses earlier with 403 —, but the use
case stopped presuming the caller.

**Two more queries per association.** `findById`, `findMemberRole` in the
workspace and the actor's `forProject` (which redoes the `findById`). It is an
administration route, called once per invitation, and the alternative — reusing
the `request.effectiveRole` the guard already computed — would tie the use case
to the guard's state, which is the coupling the choice of WHERE the ceiling
lives exists to avoid.

**The three OpenAPI descriptions change without changing any response.**
Whoever integrated by reading the old promise ("higher of") was already wrong
since Phase 1; the generated contract now describes the real behavior, and the
`403` of the two ceilings is genuinely new for whoever calls the route.
