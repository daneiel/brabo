# 0065 — Container per project: the boundary stops being policy

## Status

Accepted, **with a declared cut**. The half this ADR delivers — the
Architect's artifact, the gate, and the external-effect boundary — is
implemented and proven by test. The half it does **not** deliver —
provisioning, stopping, recycling and cleaning up the container — is
declared in "What this ADR does NOT do," with the reason. The cut is of
scope, not of the argument: the architecture decision stands whole, and it's
what dictates what the next phase builds.

This ADR **revises [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md)**,
which stays accepted and is not edited. 0055 says of itself, in the
consequences section, that it is *policy, not isolation*, and records the
per-project container as an explicit pending item. That's the pending item
this document addresses.

## Context

### The debt, in the words of the document that created it

> **What this ADR does NOT resolve.** Scope is **policy**, not isolation.
> As long as the Brabo monorepo is mounted at `/workspace` inside the
> container that runs the commands, the boundary depends on the policy
> getting it right.
> — ADR 0055

And the same document's acceptance note, which measures the gap that was
left: path normalization is **lexical**, `..` is rejected, and a **symlink
from inside the project pointing outward is not detected**. Closing that
isn't a matter of writing a better rule — it's about having a wall.

Today the agent runs in the **same container as the Brabo monorepo**. What
separates it from the platform's own code is a string comparison in
`decide.ts`.

### The findings that don't converge

PHASE 13b left two findings open, and their argument matters more than the
list of runs that produced them (`docs/explanation/achados-execucao-real.md`):

- **Z and AD** — the verb allowlist **doesn't converge**. Verb, form, and
  invocation are distinct spaces: `curl`, `wget`, `python -c
  "urllib..."` and a `.sh` script doing any of the three are the same
  egress written four different ways. Runs 6, 7 and 8 got stuck on one of
  each.
- **AE** — the QA agent tries to fix the code it's judging, against its own
  prompt, contained by two independent barriers (allowlist and scope).

PHASE 13's conclusion, written before this phase existed, is the same one
this ADR arrives at: **the path to autonomy doesn't go through loosening
policy.**

### What the user decided

> "Each project should have its own separate infrastructure, meaning it will
> spin up via a per-project container, isolating the terminal that way and
> giving it full permission; Code is only unlocked after the architect's
> definition, since they will decide which type of container will run that
> code, being the one who decides the best fit for which image to use."

And, about the extent of "full permission":

> "The agent is free to do whatever it wants as long as it isn't git
> commands related to deploy and PR — those actions still have to be
> human."

Two sentences, three decisions: **who** chooses the image, **when** Code
unlocks, and **where** the freedom ends.

## Decision

### 1. The project's image is the ARCHITECT's ARTIFACT

`artifact.project_image` in the event log, with `image`, `rationale`,
`network` and `resources`. Versioned — revising it means emitting a new
version, and the current one is whichever has the highest `version`.

It's an artifact and not configuration because **whoever chooses the image
chooses what the agent can do**: which runtime exists, which package
manager, which compiler. That's an architecture decision, of the same
caliber as `module_map`, and an architecture decision has an author, a
date, and a reason. An environment variable has none of the three.

**No table, and not for economy's sake.** The event log already provides
the three properties this decision needs to have — immutable, versioned,
with an author — and it's where `artifact.module_map` and
`artifact.business_rule` already live. A table would give the same thing
with a possible `UPDATE`, and `UPDATE` on an architecture decision is how
it stops being auditable.

**An explicit tag, `latest` rejected.** An artifact that says `node:latest`
describes nothing: March's container and today's are different images with
the same name, and the audit trail ends up lying.

**A resource cap that rejects instead of downgrading.** A request above the
maximum is a 400 with the reason, never a silent trim — an artifact that
promises more than the container gets lies to whoever audits it.

### 2. While the Architect hasn't decided, Code doesn't unlock

The gate is the user's literal order, and its reason is about the product:
the container is what gives reading code there any meaning — reading it in
order to later run, build, or fix it. The reading surface from
[ADR 0060](0060-superficie-de-leitura-de-codigo.md) responds **409** while
the state is `sem_decisao` (no decision), with the message saying what's
missing.

409, not 403: nothing is wrong with the requester or their permission — the
resource simply doesn't exist yet in this state. And the check lives in the
**same funnel** as the path containment (`alvo`), not in the four routes,
for the reason stated in
[RN-092](../business-rules.md#rn-092): a check duplicated across four
callers is a check that one day diverges in one of them.

### 3. The boundary: inside is free, outside is human

**Inside** the container the agent is free — read, write, install, build,
test, run. This is what closes Z and AD, and it's the only known way to
close them: the wall replaces the enumeration.

**Outside** stays human. Three effects cross the wall and reach the world —
`git push`, opening a PR, and deploy — and a terminal command that invokes
them is **denied**, with the message saying which **typed** action to use
instead.

**`deny`, not `require_approval`**, and this is the part that needs an
argument. Each of those effects already has a typed path (`git_push`,
`pr_open`, `git_merge`) that's born as a `proposed_action`, has its own
minimum role, is executed by the platform, and leaves in the event log
**what was pushed and where**. The terminal would be a second door to the
same effect, with none of those guarantees: the log would just say "a
command ran." And `require_approval` wouldn't be enough because "always
allow" exists — one click would write the pattern to `allow` and the
second door would stay open forever. `deny` beats `allow` at every stage,
and that's why it's the right shape for this rule: it's not a configurable
preference, it's where the container ends.

Denying doesn't take power away from the agent — it **redirects**. That's
how the dev agent always worked (`agent_io.ex` proposes `git_push`); what
changes is that it's now guaranteed, not just agreed upon. And merging into
a protected branch stays manual per
[RN-014](../business-rules.md#rn-014), unchanged.

### 4. Networking is a CONTAINER posture, decided once — not command by command

This is the decision the requested "own verdict" on networking produces,
and it's the opposite of what intuition suggests.

The temptation would be to add egress rules to the allowlist: block `curl`,
`wget`, `npm install`. **That's exactly the attempt Z and AD proved doesn't
converge.** An egress allowlist would have the same shape, the same size,
and the same fate as the verb allowlist.

So networking is decided **once**, in the artifact, at the boundary the
kernel understands: `network: none` is the default, and it's what makes
"inside the agent is free" a safe sentence — free in a place with no way
out. `egress` is a legitimate request (a stack that downloads dependencies
doesn't work without it), the Architect declares it with a justification,
and **the user is the one who authorizes it**, at provisioning time — the
same reason authorizing the parallelism cap works
([ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)): reaching the
internet is spend and it's surface area.

**Spend** gets the same treatment: `cpus`, `memoryMb` and `pidsLimit` in
the artifact, with a hard cap. `pidsLimit` deserves a note — it's what
contains a fork bomb without depending on any verb allowlist, and it's the
cleanest example of what changes once the boundary stops being lexical.

The **token** caps don't change: they stay project, session, and task.

## What this ADR does NOT do

**The container's lifecycle (25b).** Provisioning, stopping, recycling,
cleaning up; what happens when the image changes; what survives a restart;
the agent's worktree moving to live inside the container.

The reason is concrete and isn't a lack of design: **container state needs
a table.** Container id, status, image in use, when it came up, which
version of the artifact it corresponds to — none of that is an event, it's
mutable state, and forcing it into the event log would be using the wrong
tool because the right one was busy. This wave's single migration slot
belongs to another phase.

Delivering half a provisioning flow would be worse than not delivering it:
**a container that comes up and never recycles is worse than none** — it
accumulates, nobody knows whose it is, and the first decided image becomes
permanent in practice.

**Honest consequence of the cut:** the "inside the agent is free" half
**hasn't taken effect yet**. The ADR 0055 terminal policy stays exactly as
it is — path scope, narrow allowlist, `cd` loosened within scope. Loosening
it before the wall exists would repeat the mistake this document came to
correct, and PHASE 13 already wrote the conclusion: the path to autonomy
doesn't go through loosening policy. What this phase delivers is the half
**outside** the boundary — the one that needs to hold true first, not
after.

## Consequences

**What gets better now.** The image decision exists, has an owner, a
version and a justification; Code's gate is real and tested across the four
routes; and the second door for push/PR/deploy closed — before it ever
existed, which is the right time to close a door.

**What changes for the operator.** An existing project **has no** image
decision, so the Code tab starts responding 409 until the Architect runs.
It's an observable behavior change on a surface that just arrived (ADR
0060), and that's why this change is born under `breaking/`: whoever was
already using the tab needs to know why it closed.

**What's lost.** Nothing about execution: no command that worked stops
working, because `git push` through the terminal was never how the dev
agent pushes. What's lost is the *possibility* of configuring a terminal
shortcut for push/PR/deploy — and losing that is the point.

**What's still owed, measured.** A symlink from inside pointing outward
**is still not detected**. This ADR doesn't close that vector; it decides
how to close it (a wall) and delivers the image decision the wall needs.
Until the container comes up, the weak point in 0055 keeps holding, and
it's written here instead of being mistaken for resolved.

## Alternatives considered

**Loosen the policy now and bring up the container later.** Rejected with
the strongest argument the project has: it's literally PHASE 13's
conclusion in reverse. Freedom without a wall is the hole, not the
solution.

**A network-egress allowlist.** Rejected by Z and AD: it would have the
same shape and the same fate as the verb allowlist. Networking is a
property of the container.

**The image as project configuration (a column, `.env`, a Settings
screen).** Rejected because it takes away from the Architect the decision
the user gave them, and because configuration has no rationale. The
required `rationale` is what makes the decision reviewable instead of
archaeological.

**A `project_containers` table now.** It's the right design for the
container's **state**, and that's exactly why it's left for the wave with a
migration slot. Improvising the state in the event log just to avoid
waiting would produce the corrective migration right after.

**`require_approval` on the terminal instead of `deny`.** Rejected because
of "always allow": it writes the pattern to `allow`, and one click would be
enough for the second door to stay permanently open.

## References

- [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md) — the
  policy this document revises, which declared this pending item itself.
- [ADR 0060](0060-superficie-de-leitura-de-codigo.md) — the Code tab, whose
  gate this decision closes.
- [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) — whoever
  authorizes spend is whoever answers for the project; networking follows
  the same criterion.
- [ADR 0045](0045-reagendamento-por-evento-do-dev-agent.md) — the worktree
  is per AGENT, not per task; it's the one that will live inside the
  container.
- [RN-014](../business-rules.md#rn-014), [RN-092](../business-rules.md#rn-092),
  [RN-105](../business-rules.md#rn-105), [RN-106](../business-rules.md#rn-106).
- `docs/explanation/achados-execucao-real.md` — findings Z, AD and AE.
- `apps/api/src/domain/containers/project-container.ts`,
  `apps/api/src/domain/actions/external-effect.ts`,
  `apps/api/src/application/use-cases/containers/`,
  `apps/engine/lib/engine/harness/tools/choose_project_image.ex`.
