# ADR 0053 — Dev Lead as an area, and parallelism authorized by the user

- **Status:** Accepted (implemented in PHASE 14d, 2026-08-07)
- **Date:** 2026-08-05
- **Context:** PHASE 14d
- **Revokes cuts from:** [ADR 0038](0038-hierarquia-de-agentes.md) (the
  generic area apparatus, and dynamic areas via `module_map`)

## Context

Today the parallelism of dev agents is: one agent per module on
`activate`, and one extra per module (`dev-<modulo>-2`) via a one-click
accept (`AcceptParallelizationUseCase`). There's no session cap. Nothing
stops a project from spinning up one agent per module plus one extra for
each, with spend climbing along without anyone authorizing it.

PHASE 14d decides that **the lead is the one who evaluates how many
agents are worth it**, and that going above two in a session requires
user authorization.

### The tension this ADR resolves

The parallelism in question is the **devs'**, and the **Dev Lead doesn't
exist**. The existing areas are two, with fixed members written by hand
in `apps/web/src/lib/agents.ts`: `qa` (lead `qa`, members `qa-automacao`
and `qa-performance-seguranca`) and `infra`.

Worse: CLAUDE.md explicitly forbade the two things needed here — "don't
implement Dev Lead or dynamic areas via `module_map`" and "don't implement
the generic area apparatus (`agent_areas`/budget per area)."

The user's decision is to lift both prohibitions and build the Dev Lead
for real. This ADR records that, and why.

### Why the dev area can't be hardcoded

`qa` and `infra` have known members at write time. The dev area doesn't:
the members are **one per module of the `module_map`**, which is decided
by the Architect, differs per project, and changes whenever the
architecture is revised.

It's exactly the case Phase 8's cut deferred. It was honest while every
area was static; it stops being honest the moment the first dynamic area
shows up. There's no way to build the Dev Lead without the apparatus —
and that's why both cuts fall together, not out of convenience.

## Decision

### 1. Areas become data, per project

`agent_areas` and `agent_area_members` come in, scoped by project:

- `agent_areas`: `project_id`, `key` (today `dev`, `qa`, `infra`),
  `lead_agent_id`, `max_parallel` (default **2**)
- `agent_area_members`: `area_id`, `agent_id`

`qa` and `infra` keep being born with the members they already have — the
apparatus becomes the source, and the hardcoded list disappears from
`agents.ts`. **The gates' external contract doesn't change**: whoever
consumes it sees one verdict per gate, exactly as today, and Phase 4's
suite has to stay green with no modification. That's the proof the source
swap didn't leak outside the area.

The `dev` area is born on `activate-execution`, with one member per module
of the current `module_map`.

### 2. The lead decides, the user authorizes above 2

The lead evaluates how many agents are worth it for the work at hand — no
longer a number in the code. But its decision isn't sovereign over
spending:

- up to `max_parallel` (default 2), the lead spins up the agents and
  moves on;
- **above that**, it becomes a `proposed_action` of type `parallelize`,
  through the same approval pipeline as any action with external effect.
  The user decides, and the decision stays in the event log.

The cap is per **session**, not per module. Counting per module would
allow N modules × 2 agents with no authorization at all, which is today's
hole under a different name.

`AcceptParallelizationUseCase` (the one-click accept) is absorbed: it
becomes the approval path for that `proposed_action`, instead of a button
parallel to the pipeline.

### 3. `max_parallel` is configurable per lead

In the Settings screen, each lead has its own, with **2** as the default.
It's the cap the lead can use without asking — not the cap on what the
user can approve.

### 4. Anamnese proposes raising it when authorization becomes recurring

When it notices the user has been repeatedly approving the same request,
it proposes raising that lead's `max_parallel`, through the same
hypothesis mechanism it already uses, with evidence of real event ids and
the user deciding.

What it **doesn't** do is raise it on its own. Automating that would be
the product raising its own spend cap, which is precisely what the
approval pipeline exists to prevent.

### 5. The Dev Lead is a conversational agent, and receives the handoff from the Architect

It isn't a role of the Architect at activation time: it's its own agent
(`dev-lead`), with an instruction, model binding, and a place in the
feed, like Criativo, PO, and Architect.

The chain becomes **Architect → Dev Lead → execution**. Today the
Architect finishes and execution is activated by a user button, with
nobody in between to evaluate the work; with the Dev Lead there's an
interlocutor for parallelism — which is the point of 14d, and what "the
lead decides" requires in order not to be just a sentence.

This **fits the handoff rule that already exists** instead of opening an
exception: an external handoff addresses only an area's lead or an
arealess agent. Today the `dev-<modulo>` are arealess agents and thus
addressable; once they become members of the dev area, they stop being
so — and the only external address for execution becomes the Dev Lead.
ADR 0038's hierarchy holds for dev with no special case.

Direct consequences:

- **Internal delegation.** Dev Lead → `dev-<modulo>` is area delegation,
  private, in the `delegations` table with `area = "dev"` — the same
  path as QA and Infra. Subagent failure reports its origin to the lead,
  who decides and records the event.
- **The "Activate execution" button changes owner.** It stops being the
  trigger and becomes the acceptance of the Dev Lead's plan: it says how
  many agents it wants and why, and the user approves — within the cap
  with no ceremony, above it via item 2's `proposed_action`.
- **Its own instruction.** What the Dev Lead needs to know is the
  `module_map`, the pickable backlog, and the current cap. It doesn't
  write code: it distributes work and answers for it.

> **ANSWERED on 2026-08-07:** the post-gate correction keeps going
> **directly to the `dev-<modulo>`** that opened the PR. This preserves
> Phase 4's suite intact and the current internal contract; it's less
> consistent with the hierarchy, and it's reversible — it can go through
> the lead later, once it exists and is proven. Deciding now, without the
> Dev Lead implemented, would be choosing blind.

## Consequences

**For**

- Spend on parallelism gets a cap and an owner. Today it has neither.
- The area apparatus stops being declared debt and becomes a mechanism,
  with the first dynamic area as proof it serves the hard case.
- `budget per area` (the other item from Phase 8's cut) is one step
  closer: the missing table now exists.

**Against**

- It's the biggest structural change since Phase 8, and it touches the
  handoff flow: the Architect starts delivering to the Dev Lead, not to
  the user's manual activation.
- One more conversational agent is one more LLM turn per execution,
  before any code gets written. What it buys is the spend cap having an
  owner; if its plan fits within the cap, its cost is the cost of the
  request itself.
- `delegations.area` is TEXT with "qa" and "infra" today; it gains "dev"
  and gets a source of truth in a table. The migration needs to keep the
  history legible.
- Swapping the source of `qa`/`infra`'s members is pure risk with no
  immediate benefit for them — mitigated by keeping Phase 4's suite
  untouched as the acceptance criterion.

## Alternatives considered

**Session cap without a Dev Lead.** Would deliver the central value —
authorized spend cap — without violating any cut, and was the
recommendation. Rejected because it leaves "the lead decides" with no
owner: the cap would exist, but nobody would evaluate how many agents are
worth it, which is half of what 14d asks for.

**Apply it only to QA and Infra.** Faithful to the text and implementable
today, but low value: the two areas have fixed members, there's barely
anything to decide, and it doesn't touch the devs' parallelism — which is
where the spending happens.

**A bigger fixed number in the code.** It's what exists today with a
different value. It solves nothing: without authorization, any number is
arbitrary.

## References

- [ADR 0038](0038-hierarquia-de-agentes.md) — hierarchy by area, and the
  cuts this ADR revokes
- [ADR 0045](0045-reagendamento-por-evento-do-dev-agent.md) — the dev
  agent's state machine, where the extra agents fit in
- `apps/api/src/db/schema.ts` (note on `delegations`) — where the cut is
  documented
- `apps/api/src/application/use-cases/execution/accept-parallelization.use-case.ts`
  — today's mechanism, absorbed by item 2
