# 0046 — Story promotion with user authority

## Context

Dogfooding finding #13, verbatim from
`docs/missions/dogfooding-mission.md:669`:

> There's no "promote to ready": promotion is automatic on creation.
> `TransitionStoryUseCase` validates and emits `backlog.story_transitioned`,
> but **it isn't wired to any route** — it's dead code. The Backlog tab
> is read-only.

It was born classified as **P2** and became one of the three P1s Phase
12 kills, for a reason that only became clear after the run: of the
three findings, this is the only one that isn't about convenience.
Adoption and rescheduling were friction — the human doing by hand what
the machine should do. Here it's the opposite: the machine did on its
own what the human should decide, and `CLAUDE.md` says, in the very
first line of what the product is, that final authority belongs to the
user. A story turning `ready` at creation means the PO — an LLM agent
— decides alone what enters the dev agents' work queue.

Three facts verified in the code, BEFORE designing, shaped the
decision:

1. **`story.status` is the claim's gate.** `TaskRepository.claimNext`
   filters by `s.status = 'ready' AND s.module_ids ? module AND
   t.status = 'todo' AND t.blocked = false`. Nothing beyond the
   story's status separates "proposed work" from "claimable work."
2. **Validation was duplicated and asymmetric.** Creation called
   `canBecomeReady`; the transition called `assertReady` +
   `assertModulesResolved`. Two doors for the same state, with
   different locks.
3. **`TransitionStoryUseCase` already did everything** — it validated,
   emitted the event and, since Phase 12b, wrote a `task.became_claimable`
   outbox line per freed task. What was missing was a caller.

## Decision

**`proposed_ready` is a boolean, not a new value in the status enum.**
It was the first attempt, discarded. A `story_status = 'proposed'`
would be more expressive, but the enum is literally the claim's gate
(fact 1): adding a value would force revisiting every query that
compares status, and a forgotten spot wouldn't error out — it would
produce a claimable story too early, silently. The boolean says what
the thing is: a PROPOSAL about a story that stays `draft`. The state
machine doesn't change because nothing actually changed; what exists
is a pending item addressed to the user.

**Promoting reuses `TransitionStoryUseCase`; no new transition was
written.** Finding #13's dead code gets called again, and with it
comes 12b's rescheduling for free: promoting writes the outbox lines
that wake up idle dev agents in the module. A "custom" promotion would
have had to reimplement this — and the first version that forgot to
would leave the batch of tasks claimable with nobody notified, the
agent finding out by chance on the next unrelated event.

`execute` gained an optional `actor` parameter. The
`backlog.story_transitioned` event is immutable and is what the audit
reads; recording `agent/po` on a promotion that was the user's decision
would erase exactly the human step this phase gives back.

**Validation was unified into `assertPromotable` BEFORE making the
trigger configurable**, and that order isn't a detail. As long as the
two paths had different locks, "promoting via the UI" and "promoting
at creation" would be distinct rules with the same name, and the
`manual` mode would be more strict or more lenient than `auto` by
implementation accident. The symmetry test in
`story-promotion.spec.ts` is what maintains the property: **the mode
changes WHO triggers it, never WHAT gets validated.**

A detail that almost silently broke `auto` mode: an empty `moduleIds`
PASSES validation, and it has to. At creation the story doesn't have
modules yet — the Architect is the one who assigns them, later. Wiring
`assertPromotable` to the creation path without preserving this would
make `auto` mode never promote anything again, with no error at all.

**The backfill is directed, not blind.** The column is born `manual`
(the new default) and the same migration moves all existing projects
to `auto`. It's the opposite of RN-046's backfill, which could be
blind because adoption didn't exist before it. Here the behavior
already existed and was in use: a project in progress can't stop
producing because of a deploy. The new default applies to whoever comes
after.

**The refusal mirrors returning a gate to the dev, and inverts the
rearm's order.** The reason becomes a message PINNED in the PO's
session — the first `pinned` message outside the system prompt in a
conversational agent — with the same precedence phrasing that the dev
agent's `correction_message/1` has carried since ADR 0020. Pinned
because the refusal is a pending item, not chat: compacted by the
`ContextManager`, the PO would repropose the same story with the same
flaw.

The write happens BEFORE the call to the engine, unlike
`RearmDevAgentUseCase`. There, the event (`dev.rearmed`) asserts
something ABOUT THE ENGINE, and writing it beforehand would be a lie
in the log if the engine refused. Here the event asserts something
about the USER — they refused, and that's true whether or not a PO
process is standing there to hear it. Losing the decision because the
agent's process died in a restart would send the user back to square
one for no reason. That's why the engine call is best-effort, and the
internal route responds with **404** when the PO is dead instead of
throwing `:noproc`.

**The return message says what the PO CAN do, and that's an accepted
limitation.** There's no story-editing tool — only `create_story`. The
message instructs it to create a corrected version, or ask the user if
the reason isn't clear. Telling it to "fix the story" would be asking
the impossible, and a model facing an impossible instruction either
invents a tool or repeats the call until it exhausts the loop — that's
how the dev agent burned three corrections in a row during ADR 0020's
acceptance.

**Batch promotion isn't all-or-nothing.** Each story is its own
transaction; whichever one fails goes back to `failed` with the
reason, in a 201. The real case is concrete: between the PO's proposal
and the user's decision, a module may have dropped out of the
`module_map`. Aborting the whole batch because of that would undo the
review the user just did on the others.

## Consequences

The default changed, and that's a **behavior break** for anyone
creating a new project: the backlog doesn't move forward on its own
until someone promotes it. It's in the CHANGELOG as breaking. Existing
projects feel nothing.

The Backlog UI stopped being read-only. These are the only two backlog
writes that belong to the user and not to an agent — everything else
still comes in through `/internal/*` routes.

`POST /internal/sessions/:id/agent/revise` is the first api→engine path
that gives work back to a CONVERSATIONAL agent. Until now, returns
(gate → dev) were internal to the engine, in-process. The route
inherited its shape and existence check from `rearm`.

Left for later, as backlog and not as hidden debt:

- **Story-editing tool.** While it doesn't exist, the refusal loop
  closes via recreation, and the refused story stays in `draft` with
  the reason recorded. It's auditable, but leaves litter in the
  backlog.
- **Batch promotion with side-by-side review.** Today the batch is a
  multi-select with the stories expanded in the queue itself; a
  dedicated review screen makes sense once volume grows.
- **Demoting a promoted story by mistake.** `assertTransition` allows
  `ready → draft` (it works like RN-012's `story_demoted`), but there's
  no user route for it. Today the path is refusing BEFORE promoting.
