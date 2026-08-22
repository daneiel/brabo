# 0038 — Agent hierarchy: areas, leads and delegation

## Context

Since Phase 3b, a handoff can address any agent in the roster directly:
`CreateHandoffUseCase` receives `toAgent` and creates the record without
validating who can be a target — `Handoff { fromAgent, toAgent, artifactId,
status }`, with `toAgent` free
(`apps/api/src/domain/sessions/handoff.entity.ts`). The only activation rule
today is `canActivateAgent` (`domain/sessions/agent-activation.ts`): an agent
only comes on stage with an `accepted` handoff addressed to it, except the
Creative agent, which starts on the user's command.

That worked through Phase 4 because each agent was a single unit: one
handoff, one agent, one verdict. Phase 8 introduces **sub-specialization
within an area** — the first instance is QA (8b), which comes to have QA
Automation and QA Performance/Security —, and in that design a handoff
addressing a sub-specialization directly would break the premise the whole
rest of the system assumes: **one handoff, one response**. If the Architect
could address `qa-performance` directly, who consolidates the verdict with
`qa-automacao`'s? The answer can't be "no one" — the gate expects ONE
verdict per area (`pr-gate-state-machine.ts:nextGateStatus`, which receives
a single `GateVerdict`).

This ADR fixes the generic model — area, lead, delegation, consolidation,
budget, failure — **before** any sub-specialization exists. QA (8b) and the
Workflows subagent within Infra (8c) are instances of the same model, not
designs of their own.

### Why the ORIGIN of the failure needs a type now

CLAUDE.md has required, since ADR 0020, that every failure outcome record
its origin — `infra | modelo | código | política` — and forbids diagnosis by
elimination. In practice, the origin today is **free text** inside
`reason`/`diagnosis`: in `qa_agent_server.ex:176-183`,
`falha_do_qa({:limit_reached, _})` returns the phrase *"iteration limit
reached without emit_qa_verdict"* — correct, but not a value another piece
of code can branch on.

Item 4 of this phase requires **the lead to decide based on the origin**
(redistribute | consolidate partial | block), and an automated decision
can't branch on prose. So this ADR types `failure_origin` and **retrofits**
the points that already informally classify failure — `task_blocked`,
`dev.error`, the QA and SecOps verdicts — rather than introducing the type
only for delegations and leaving the rest of the system with two
coexisting failure vocabularies.

## Decision

### 1. An area belongs to a project, and has exactly one lead

`agent_areas` (one row per area, per project) and `agent_area_members` (who
belongs, with an `is_lead` boolean). Two invariants guaranteed **in the
database**, not just in the application — this repo treats a constraint as
a business rule (`docs/.docmap.yml`, `schema-e-migrations` rule):

- `unique(project_id, agent)` on `agent_area_members` — an agent belongs to
  **at most one** area, and the lead is subject to the same rule: it can't
  also be a plain member of another area.
- `unique(area_id) where is_lead` — **at most one** lead per area. The
  *existence* of a lead (at least one) is a creation invariant, validated in
  the domain when the area is assembled, not a database constraint — an
  area being composed member by member would pass through a transient
  leadless state the database has no way to distinguish from an error.

Agents without an area — Creative, PO, Architect, Psychologist, Anamnesis —
don't enter `agent_area_members` and stay exactly as they are today:
addressable by direct handoff. This ADR doesn't change their flow.

**Dev stays out of scope for this phase.** `dev-<modulo>` is instantiated
dynamically per module (Phase 4 ADR) and doesn't become an area — there's no
"Dev Lead" yet. Recorded as future extension, not implemented (see
Consequences).

### 2. An external handoff can only address a lead or an area-less agent

`CreateHandoffUseCase` — the only place in the system that today writes
`toAgent` with no validation — now calls
`assertHandoffTargetAllowed(toAgent, areaMembers)` before creating the
record. A target that's an area subagent (a member, not the lead) is
rejected with a typed error (`HandoffToSubagentError`, carrying the agent
and the area), never silently filtered nor promoted to the lead by mistake.

`OfferInfraHandoffUseCase` (the readiness confirmation that signals the
engine to offer the handoff to the InfraAgent) does **not** write `toAgent`
— it only triggers the engine, which is what calls `CreateHandoffUseCase`
afterward. The validation lives in one place, at the point that actually
decides the target.

This is the `agent-activation.ts` precedent extended: that file decides "who
can ACTIVATE"; this one decides "who can be the TARGET of an **external**
handoff" — the second question didn't exist because, until now, every agent
was external by definition.

### 3. Delegation is the internal mechanism, and it's private to the area

`delegations`: a lead delegates a task to a subagent in the SAME area.
`assertDelegationAllowed(lead, subagent, members)` rejects whoever isn't the
area's lead and whoever delegates outside it. Delegation **never** appears
as a handoff — they're different tables and lifecycles, and the distinction
is what preserves the property "the lead is the only external contact":
nothing outside the area observes an individual delegation, only the
consolidated result.

### 4. Consolidation: a single artifact, external contract untouched

The lead closes the handoff it received with **one**
`consolidated_verdict` artifact — a new type in `ArtifactSchemas` (engine),
**server-emitted** like `task_blocked` and the `*_verdict` types already
are: none of the three is something the model chooses to emit via tool
call, they're the record of an outcome the server determines. Payload:
`área` (area), `veredito` (verdict), `resumo` (summary), and `delegações`
(delegations) — the list of internal verdicts referenced by id, not copied
(traceability without duplicating content).

`ArtifactSchemas` validates the SHAPE (every `completed` delegation has a
`parecerArtifactId`; every `failed` one has a `failureOrigin`) — it's the
same question `check_extra/2` already answers for `qa_verdict`/
`secops_verdict` today. The api's domain validates the RULE — consolidation
is only possible once **all** delegations are resolved
(`assertConsolidatable`, rejecting with the list of what's missing) —
because only the api has the full list of the area's delegations; the
engine, at the moment it emits the artifact, only knows what it has
received so far.

**The gates' external contract doesn't change.** `nextGateStatus` still
receives one `GateVerdict` (`approved | changes_requested`) per gate — the
`consolidated_verdict` is what the QA Lead **uses to decide** that single
verdict; whoever calls the gate never sees a delegation. This is the
central guarantee of this ADR: the hierarchy is invisible from outside the
area.

### 5. Cascading budget, failure with mandatory origin

A cap on the area (`agent_areas.budget_micros`), a sub-cap per delegation
(`delegations.budget_micros`, optional — not every delegation needs one).
Exceeding the sub-cap becomes `failed` with `failure_origin = politica` —
the same classification session/project budgets already use in
`budget-threshold.ts`, extended to the delegation.

**The Phase 1 `budgets` table isn't touched.** It has `budgets_scope_check`
locked down to exactly two scopes (`project` XOR `session`); accommodating
a third scope there would alter a central table for an area's local need.
The area cap and the delegation sub-cap live in new tables.

Every subagent failure — a budget overrun, an equivalent `task_blocked`,
whatever it is — reaches the lead with `failure_origin` filled in. The lead
decides one of three outcomes, and the decision **is** an event
(`area.decision`), never a silent side effect:

- **redistribute**: a new delegation is born, covering what the failure
  left pending;
- **consolidate partial**: the `consolidated_verdict` closes with what
  there is, citing the `failed` delegation and its origin — the external
  consumer sees a complete verdict, even if internally a part failed;
- **block**: the whole area gets blocked with the real origin propagated —
  never a generic `changes_requested` like Phase 4a already fixed for the
  case of QA without a verdict (see the comment in
  `qa_agent_server.ex:148-153`, which this ADR generalizes).

### 6. Failure origin: new type, retrofitted across the whole system that already classifies failure

`failure_origin`: `infra | modelo | codigo | politica` (Postgres enum,
without accents like the other `schema.ts` enums). Retrofit — an explicit
decision, not a model committed to delegation alone:

- `tasks.blocked_origin` and `stories.blocked_origin` (new columns,
  alongside the existing `blocked`/`blocked_reason` — **new field, not a
  replacement**);
- `Engine.Dev.AgentIo.block_task/3` gains a 4th argument; the ~18 call
  sites in `dev_agent_server.ex`/`noop_dev_agent_server.ex` are classified
  one by one (a failing worktree is `infra`; malformed context is
  `codigo`; iteration limit is `modelo`; budget is `politica`);
- `falha_do_qa/1` (`qa_agent_server.ex`) and the SecOps equivalent now
  return an origin alongside `reason`/`diagnosis`;
- `task_blocked` in `ArtifactSchemas` gains `origin` among its required
  keys.

No existing message is removed or rewritten — the origin is a NEW field
alongside the free text, which keeps existing for humans to read.

## Consequences

### What becomes available

- Addressing a handoff to a subagent is a creation-time error, not a latent
  bug that would only show up when someone tried.
- The QA gate (8b) and the Workflows subagent within Infra (8c) have the
  mechanism ready — neither needs to reinvent delegation or consolidation.
- Every partial-failure decision becomes an auditable event
  (`area.decision`), closing the gap that CLAUDE.md already forbade in
  theory and had no way to enforce in practice — the origin was text, and
  text doesn't stop an `if` from guessing.

### What's recorded as a future extension, not implemented

- **Dev Lead.** `dev-<modulo>` continues to be instantiated dynamically per
  module, with no lead. If it ever needs an area, the model is already
  ready — an area doesn't presuppose a fixed number of members nor a fixed
  instruction per subagent.
- **Areas proposed by the Architect via `module_map`.** Today an area is
  created implicitly by each phase's scope (QA in 8b, Infra in 8c); the
  idea of the Architect dynamically proposing a new area, from the module
  map it already produces, is out of scope — it would require its own
  approval flow.

### Risks accepted

- **The origin retrofit touches Phase 4 code validated by real execution**
  (ADR 0020). Each of the ~18 points is classified individually and no
  existing message changes — the risk is forgetting a point, not breaking
  one that already works; the tests cover the points, not a sample.
- **`delegation_status` is born with a value that has no use yet**
  (`dispensed`, reserved for 8b — "no performance NFR, delegation
  dismissed"). Changing a Postgres enum after it's written means a
  migration with a table lock; it's born now so as not to pay that cost
  twice.
- **No sweep for orphan delegations.** If the engine dies between starting
  a delegation and reporting the result, it stays `pending` forever in this
  phase — the lead doesn't consolidate (correct behavior: it doesn't close
  an incomplete verdict silently), but there's also no automatic alarm.
  Left for when there's a real case, not a hypothetical one.

## Closure (Phase 8d)

The two instances anticipated by this ADR were built — QA (8b) and the
Workflows subagent within Infra (8c) — plus the presentation side (8d:
team panel grouped by area, PR timeline expanding internal verdicts,
Insights grouped by area, feed narrating delegation). Closing out what was
decided versus what stayed pending:

### `consolidated_verdict` wasn't implemented — the decision validated in practice

Decision #4 above designed a generic `consolidated_verdict` artifact.
Neither QA nor Infra uses it: both already had a contract of their OWN,
predating the ADR — `qa_verdict` (QA) and `open_infra_pr` (Infra) — and
changing that contract would have broken `RecordGateVerdictUseCase`/
`ExecuteInfraPrUseCase` and the demos that already proved the happy path
without the hierarchy. `Engine.Gates.QaLead.consolidar/1` produces exactly
the shape of `qa_verdict`; `Engine.Infra.InfraLead.consolidar/2` produces
the union of files `open_infra_pr` already expected. Whoever consumes it
never knew there was more than one agent behind it — the ADR's central
guarantee (line 118 above) held up without needing the generic artifact.

`consolidated_verdict` remains available in `ArtifactSchemas` as a DESIGN,
not as code — a future area with no artifact of its own to reuse (unlike
QA/Infra, which already had one before becoming an area) is the natural
candidate to implement it for real. Until then, the established pattern is:
**prefer reusing the artifact the area already emitted before becoming an
area**; only implement the generic one if there isn't one.

### Dev Lead and dynamic areas — still not implemented, and the seed recorded

The two items the "future extension" section already recorded remain
outside scope, confirmed after three real instances of the model (QA,
Infra, and the UI that exposes them). Recording the seed of the second,
as requested:

**The `module_map` already dictates HOW MANY dev agents exist** — one per
module (`devAgentId`/`Engine.Dev.*` derive from that today, without a
table of their own: a dev's existence is a FUNCTION of the module_map, not
a parallel record). The natural next step — not implemented here — is for
the Architect to propose not just the modules but their GROUPING into an
area: for example, `payments-api` and `payments-worker` under a "payments"
area, with one of the two (or a dedicated lead) as the external contact.
This would become the same "the area exists because the module_map says
it does" dynamic that today only applies to individual devs — an area
would stop being a fixed catalog (QA, Infra) and become a PROPOSAL from
the Architect, with user approval, the way the module_map already is.

Prerequisites for this to become code, not just an idea: real
`agent_areas`/`agent_area_members` (the apparatus 8b/8c deliberately cut
from scope — today `area`/`subagent`/`leadAgent` in `delegations` are
TEXT, with no association table, because only two fixed areas were known
in advance); an approval flow for creating an area (same pattern as
handoff/module_map, user decides); and an answer to "who becomes lead"
when an area is born from a proposal instead of a fixed catalog — Dev
Lead and dynamic area are the SAME open problem, not two.
