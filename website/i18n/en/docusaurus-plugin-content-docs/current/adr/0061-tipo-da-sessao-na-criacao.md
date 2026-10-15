# ADR 0061 — The session's type is data set at creation, and execution stays an event

- **Status:** accepted
- **Date:** 2026-08-09
- **Prior context:** [ADR 0045](0045-reagendamento-por-evento-do-dev-agent.md)
  (the dev agent's state is derived from events — the same family of decision),
  [ADR 0046](0046-promocao-de-story-com-autoridade-do-usuario.md) (new default
  + directed backfill, the migration format reused here)

## Context

Every session used to be born the same. To reach the Criativo agent — the one
that runs ideation and is the entry point of the chain that produces — you had
to open the session first and **discover afterward** a button in the top bar.
The user reported exactly that: *"the process of having to select the button
above to start the creative agent wasn't clear enough; make a distinction
between a merely consultative session type and one that actually starts the
creative agent"*. Along with it came two requests from the same navigation
session: being able to **name** the session without losing the hashtag it's
referenced by, and having a **way back** to the dashboard — `SessionPage`
didn't import `Link` or `useNavigate`, and entering a session was a dead end.

The first request is the one that carries architectural risk, and it isn't
the new field: it's that the product **already knew** how to distinguish a
session that executes. It knew by derivation — `findActiveExecutionSession`
looks for the `active` session that carries the `execution.activated` event,
and that's what makes reactivation land on the session where the dev agents
are already working, instead of opening an orphan on every click (finding #11
from the first dogfooding round). Storing a type in the table creates a
**second source** for a similar question. Two sources about the same thing end
up diverging, and the divergence here wouldn't be cosmetic: it decides where
the dev agents write.

There was the option of storing nothing and continuing to derive everything
from the log. That doesn't work, and the reason is temporal: the intent
exists **before** any event — at the click that opens the session — and that
is precisely the moment the product needed to ask. A creative session nobody
has activated yet has no event to derive from, and that's the exact one the
user's request describes.

## Decision

**Both sources exist, and they answer different questions.**

`sessions.kind` (`consultiva | criativa`) classifies the **intent behind
creation**. It's chosen in the body of `POST /projects/:projectId/sessions`,
which until now received no body at all, and it's **immutable** — there's no
route that changes it. The `execution.activated` event keeps classifying the
**execution state**, and `findActiveExecutionSession` did **not** start
looking at `kind`: a creative session that never activated execution is not
the current execution session.

What keeps the two from writing over each other is a single rule, and it's
the real decision here: **`execution.activated` on a `consultiva` session is
an error (409), not a silent conversion**. Letting the event promote the type
would be exactly the two sources fighting over the same row. The guard lives
in the **funnel** — `AppendSessionEventUseCase` — not in
`ActivateExecutionUseCase`: both paths that write events (the user's route
and the engine's `/internal/*`) go through it, and guarding in the use case
would leave the other one open. It runs before `incrementSeq`, so a rejected
attempt doesn't consume a `seq`.

The type is **required** at every creation point, including internal ones:
the repository method and the use case require the field. An optional
parameter would let the five callers silently inherit the default, which is
the original defect with another name. The four internal paths (provision,
adopt, activate execution, seed) declare `criativa`, because the next thing
those sessions receive is `execution.activated`.

The **column default** is `consultiva` — the type that can do less. It
doesn't exist for convenience: it exists so a row coming from a path that
doesn't go through the route doesn't earn the right to execute. The
migration's **backfill** goes in the opposite direction, and it's directed:
at the moment it runs, every session predates the distinction, and some are
sessions where dev agents are working right now — waking up as `consultiva`,
they would refuse reactivation of an in-progress project without anyone
having decided anything. It's the same shape as ADR 0046, reaching the same
conclusion by the same argument.

**The name is a label, not a fact.** `sessions.name` is optional and
changeable via `PATCH /projects/:projectId/sessions/:sessionId` (role
`developer`, the same one that opens a session). Renaming does **not**
become an event: the log is what the session lived through, and N renames
would push exactly what matters out of the 200-event tail. The label is
composite — name **and** hashtag — because the hashtag is what gets pasted
into a URL and a person-chosen name isn't unique; without a name, it
degrades to the hashtag alone. A blank value counts as absence, and `null`
in the body is the way to undo it.

## Consequences

**What gets better.** The choice happens where it's made, with both
explanations visible, and the consultative session stops offering what it
doesn't do — the "Start ideation" button only exists on the creative one.
The session gains a name and an exit. And the design system's `Disclosure`
got its first real call site: the "Event log" collapse, which used to be a
`button` with text `−`/`+`, no `aria-controls` and no named region.

**What gets worse, and is accepted.** The question "does this session
execute?" now has two places to look, and no comment replaces that memory:
whoever changes `findActiveExecutionSession` to look at `kind` will make the
product start sending dev agents to sessions nobody activated. The test that
dies in that case is explicit, and it's written to die *for that reason*.

**The type is immutable, and that will be annoying.** Whoever opens a
consultative session and changes their mind opens another one. It's
deliberate: a `changeKind` would turn intent into state, and would hand back
at once the problem this ADR exists to avoid creating. If the annoyance
proves real, the fix isn't unlocking the field — it's an explicit "promote"
action that copies the context into a new session and leaves a trace that
the promotion happened.

**A name cap, and no uniqueness.** The name is limited to 80 characters
because the label shares a fixed-width bar with the hashtag. There's no
`unique`: two sessions can have the same name, and it's the hashtag that
distinguishes them — requiring uniqueness would ask the user to manage a
namespace they never asked for.

**Out of scope, declared.** The creative session does **not** activate the
Criativo agent by itself: it's still a click, just now only where it makes
sense. Activating on its own would be a side effect of opening a screen, and
the product doesn't do that. The Chat and Criativo tabs, which PHASE 24 will
build on top of `kind`, also don't enter here.
