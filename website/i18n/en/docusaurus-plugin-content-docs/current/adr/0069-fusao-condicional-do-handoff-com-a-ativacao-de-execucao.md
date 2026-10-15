# ADR 0069 — Conditional merge of handoff acceptance with execution activation

- **Status:** accepted
- **Date:** 2026-08-13
- **Context:** user request — reduce two clicks to one when whoever accepts
  the handoff to the Dev Lead already has the role needed to activate
  execution
- **Extends:** [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) (the
  Dev Lead as an addressable agent); RN-135/RN-136/RN-137 in
  `docs/business-rules.md` (the handoff card and the "Activate execution"
  shortcut that this decision now chains)

## Context

The handoff card to the Dev Lead, in `SessionPage.tsx`, currently has two
buttons: "Accept handoff and start dev-lead" (requires `developer`) and
"Activate execution" (requires `maintainer`, RN-137). They are two clicks
because they are two different AUTHORIZATIONS, deliberately not aligned:
whoever activates execution becomes `session.createdBy` of the execution
session, and it's that role that `ProposeActionUseCase`/
`ResolveEffectiveRoleUseCase` resolve as the EFFECTIVE role for every
`git_commit`/`git_push`/`pr_open` that the dev agents propose from then on
(`ExecutionController#activate`, `RequireRole('maintainer')`). Activating as
`developer` would leave dev agents unable to open PRs — the original
justification for keeping the two routes with different requirements, and it
still fully holds.

The request isn't to lower that requirement. It's that, when whoever is on
the screen ALREADY has `maintainer`/`owner` — and could therefore already
click both buttons in sequence without hitting a single 403 — the second
click protects nothing: it just repeats a decision the user's role already
authorizes. For someone with only `developer`, the second click remains the
only way to signal "yes, I want THIS to become the execution session" — it
can't disappear, because that person would never be able to activate even by
clicking.

## Decision

**`handleAcceptHandoff` (SessionPage.tsx) chains `activateExecution`
automatically when `toAgent === 'dev-lead'` AND the EFFECTIVE role of whoever
accepts — read from the SAME `useCurrentWorkspaceWithRole()` that already
authorizes "Auto mode" (RN-153) and the Approvals/Settings screens — is
`owner` or `maintainer`. For `developer` (or a role not yet resolved), the
current flow stays UNTOUCHED: accepting doesn't activate anything, and
"Activate execution" remains as a second button while the card is on
screen.**

```ts
if (toAgent === 'dev-lead' && podeFundirHandoffComExecucao) {
  await handleActivateExecution();
}
```

Three decisions within the decision:

1. **The check happens only on the CLIENT — the backend doesn't change.**
   `POST .../execution/activate` continues requiring `maintainer` as it
   always has. The merge is purely a matter of HOW MANY clicks the UI asks
   for to reach the same state that was already reachable; a `developer`
   who inspected the network and called the route directly would still get
   a 403, exactly as today. There's no new authorization surface — only a
   shortcut that only fires when the outcome was already guaranteed.
2. **`handleActivateExecution` isn't duplicated, it's REUSED.** The same
   function the "Activate execution" button already calls (RN-137, with
   `sessionId` as `originSessionId`) — which already handles its own error
   with `mensagemDaApi` and never re-throws. This matters: if the merge
   fired and the backend refused for some late reason (a session that
   became inconsistent between acceptance and activation, for instance),
   the `catch` in `handleAcceptHandoff` must NOT show "Could not accept
   handoff" — the acceptance had already succeeded. Reusing the function
   that already swallows its own error (its own toast) is what guarantees
   the correct message without duplicating error handling.
3. **The role is read from the WORKSPACE, not from a new project
   endpoint.** Same approach already used in `ProjectApprovalsTab.tsx`/
   `ProjectSettingsTab.tsx`/the "Auto mode" toggle on this same screen: there
   is no PROJECT role resolved on the client today, so the question "am I a
   maintainer?" was already answered this way before this change — it's not
   a new source, it's the source that already authorized the display of
   other equivalent controls.

## Alternatives considered and discarded

- **Always merge, and let the single click fail with 403 for `developer`.**
  Discarded: the card would have a single button that, for half the roles,
  would make a call DOOMED to fail behind an acceptance that had already
  worked — the user would see "Insufficient role" after having already
  successfully accepted the handoff, a confusing message tied to an action
  that actually succeeded. Worse UX than keeping the two buttons for whoever
  needs them.
- **Ask ("Do you also want to activate execution?") instead of chaining
  silently.** Discarded by user decision: for `maintainer`/`owner`, today's
  two clicks ALREADY are explicit, redundant consent — the second
  confirmation doesn't protect a decision the person already made twice
  (accepting the handoff, then clicking activate). Asking again would be
  friction with no security gain.
- **Lower the requirement of `POST .../execution/activate` to `developer`,
  eliminating the distinction at the root.** Discarded — that's exactly what
  RN-137 had already decided NOT to do, because it would silently invert
  the EFFECTIVE role resolution of the PRs that dev agents open (every PR
  would go from `auto_approve` to `require_approval` whenever whoever
  activated was `developer`, without anyone having explicitly decided that).
  This merge doesn't reopen that question — it only avoids a redundant click
  for whoever already had both roles.
- **Resolve the effective PROJECT role (not workspace) to decide the
  merge.** Discarded because it doesn't exist today: the client has no route
  that returns the effective role BY PROJECT (the closest thing is the
  `agent`/`area` scope from ADR 0064, which is about the LLM model, not
  RBAC). Introducing that route just for this UX decision would be the
  wrong cause — `useCurrentWorkspaceWithRole()` is already the approach used
  everywhere equivalent on the same screen.

## Consequences

- **`developer` doesn't get the shortcut — and that's intentional, not a
  gap.** Still needs a `maintainer`/`owner` to activate execution
  afterward, exactly as today. Nobody loses capability: whoever only
  accepted the handoff continues accepting it.
- **Zero backend contract change.** `ExecutionController#activate` continues
  with `RequireRole('maintainer')` unchanged; this is an `apps/web`-only
  decision.
- **One fewer click means an execution session reaching the correct
  `originSessionId` faster.** RN-135 (the chat session closes when execution
  takes off via this path) now happens, for `maintainer`/`owner`, at the
  exact moment of acceptance — without the window between the two clicks
  where the origin session stayed `active` waiting for the second one.
- **The "Activate execution" button was not removed from the card.** It
  would be redundant for whoever has the role (the merge already did the
  work) and have no effect for whoever doesn't (it would still 403), but
  removing it conditionally by role would open up one more state surface to
  test with no clear benefit — the whole card already disappears as soon as
  the handoff is no longer `offered` (accepted), so the window in which the
  button is "left over" visible and inert is, in practice, the time between
  the click and the invalidation of the handoffs query — not a functional
  gap.
