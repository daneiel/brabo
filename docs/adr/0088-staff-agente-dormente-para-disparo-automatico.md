# ADR 0088 — Staff: code ready, dormant for automatic trigger

- **Status:** Accepted
- **Date:** 2026-08-16
- **Context:** `docs/fluxo.yml`, block `id: staff` (`camada_decisao_tecnica`),
  `status: planned` since ADR 0085
- **Direct precedent:** [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)
  (Dev Lead — solo conversational agent, no area),
  [ADR 0068](0068-diagrama-c4-do-arquiteto.md) (artifact without table,
  versioned in the event log)

## Context

`docs/fluxo.yml` has declared the Staff/Principal Engineer since ADR 0085
as `status: planned`: "contract ready, activation decided, awaiting
trigger." The trigger envisioned for it is the Anamnese noticing a
RECURRING systemic problem — but the Anamnese is paused
(`ANAMNESE_ENABLED=false`, product decision from 2026-08-10) and won't
propose any handoff while that lasts.

The product owner decided to get ahead on the CODE even knowing the
automatic trigger won't fire: the Staff becomes ready and can be
triggered MANUALLY (any agent or the user can address a handoff to it
today, via the generic internal route), and only the automatic trigger
remains pending. This is NOT a half-implementation — it's the same
distinction ADR 0081 already made for the container lifecycle (table
ready, orchestrator not yet): the missing piece is declared, not hidden.

## Decision

**The Staff is born as the FIFTH solo conversational agent** (alongside
Criativo, PO, Arquiteto, and Dev Lead), mirroring the Arquiteto's mold
exactly — per-session GenServer, event-log rehydration, its own bounded
tool-use loop (cap 14, same tier as Arquiteto/Dev Lead: reasoning, not
light conversation) — with two deliberate differences.

### 1. No `kickoff/1`

All the other conversational leads synthesize an opening instruction from
the session's event log on a FRESH start (`kickoff_instruction/1` in each
one) — there's always a prior artifact (product_brief, module_map,
backlog) to summarize. The Staff has no such source: the systemic problem
that would bring it up comes from OUTSIDE (the Anamnese, when it exists,
or whoever creates the handoff manually today), not from the session's
own event log. With no kickoff, `Engine.Agents.StaffSupervisor.start_agent/2`
brings the process up (rehydrating the history) and it stays idle until
the first `user_message` — which is how whoever addressed the handoff
explains the problem.

`apps/engine/lib/engine_web/controllers/agent_command_controller.ex`
reflects this: the "staff" `start/2` clause NEVER calls
`StaffServer.kickoff/1` (the function doesn't even exist), unlike
po/arquiteto/dev-lead/infra, which call it conditionally when
`origin == :started`.

### 2. Activation: the GENERIC path, without `USER_STARTED_AGENTS`

`USER_STARTED_AGENTS` (`apps/api/src/domain/sessions/agent-activation.ts`)
is the Criativo's exception — it starts WITHOUT a handoff, by direct user
command. Investigation confirmed the Staff does NOT need to enter that
list: `canActivateAgent` already activates any agent with an `accepted`
handoff addressed to it, the same path already valid for
`dev-lead`/`arquiteto`/`infra` today. No domain change was necessary in
the api for this:

- `assertHandoffTargetAllowed` (`apps/api/src/domain/agents/agent-areas.ts`)
  only REJECTS a handoff addressed to an area SUBAGENT (ADR 0038); the
  Staff has no area — it passes through freely, like Criativo/PO/Arquiteto/Dev Lead.
- `ActivateAgentUseCase`/`ApiToEngineClient.startAgent` are generic over
  `agent: string` — no enum to extend.

The consequence is honest: "triggerable manually" means the domain
MECHANICS allow the handoff and the activation, not that there's today a
dedicated screen for a human to choose "address a handoff to the Staff"
without going through another agent's code or a direct call to the
internal route (`POST .../internal/sessions/:sessionId/handoffs`) — the
generic "manual handoff to an agent of choice" UI remains in the backlog
(`docs/explanation/backlog.md`), as it already was before this change.

### 3. `propose_rfc` — the only tool, with no `proposed_action`

`Engine.Agents.StaffTools.propose_rfc` writes `artifact.rfc_staff`
(problem, options with trade-offs, recommendation, throwaway PoC) and
returns the handoff to the Arquiteto in the SAME tool call — no human
confirmation in between, the same pattern `CriativoServer` uses when
emitting the product_brief and offering the handoff to the PO in the same
response.

Two real precedents decided the mechanism, and because of that NO new use
case was born in the api:

- `Engine.Harness.Tools.EmitInsight` (the Arquiteto's `emit_insight`) is
  the pattern for an artifact WITHOUT derivation: the whole payload comes
  from the tool call, and the event is written directly via
  `EngineApiClient.append_event_returning/3` — no table, no dedicated use
  case.
- `artifact.c4_diagram` (ADR 0068) is the CONTRAST that confirms the
  choice: it has its own use case in the api because the Container level
  is DERIVED from the current `module_map` — only the api has that data.
  The RFC doesn't derive anything from that side.

`propose_rfc` is also NOT a `proposed_action`: recording an architecture
document isn't an external effect (it's not git, terminal, or agent
spend) — the real decision (adopt, adapt, reject) belongs to the
Arquiteto, in the handoff the tool already returns. Same reasoning as
`emit_insight`.

## Consequences

**For**

- The Staff exists end to end in the engine (server, tool, supervisor,
  routing) and is testable today, without waiting for the Anamnese to
  come out of refinement — when it comes back, all that's missing is the
  Anamnese's CODE calling `create_handoff(..., "staff", ...)`; the rest
  is already ready.
- No domain change was needed in the api for activation — the
  investigation proved the generic path already sufficed, avoiding
  opening a new exception (`USER_STARTED_AGENTS`) that would need to be
  revoked later.
- `docs/fluxo.yml` stops being the only source that knows the Staff
  exists: the code matches what the record already declared, with the
  real gap (automatic trigger) precise instead of generic ("awaiting
  trigger").

**Against, declared**

- **The team panel roster (`apps/web/src/lib/agent-status.ts`) and the
  dashboard card (`ProjectCardSummary.roster`, via
  `apps/api/.../projects-summary.repository.ts`) show the Staff when
  active** — `staffActive` was added to both paths, on the same
  criterion as `infraActive`, to avoid repeating the divergence the
  `RosterFacts` comment already warned about ("two rules would diverge at
  the first new agent").
- **The Session screen (`SessionPage.tsx`) was NOT touched.** `staff`
  doesn't enter `AGENTES_DE_CHAT` — the same pattern already accepted for
  `infra` (a REAL, ACTIVE agent, also outside that list: the file's own
  comment documents that the handoff to Infra "is never accepted HERE").
  This isn't a NEW gap for the Staff: it's the pattern the product
  already had for a lead without conversation driven by the session
  composer. Real declared difference: Infra has `kickoff/1` (it runs on
  its own once accepted); the Staff does not — so, without a chat
  surface sending the first `user_message` to it, today's end-to-end
  usage path is the internal route
  (`POST .../agent/message`, `agent: "staff"`), not the screen. Fixing
  this means touching `SessionPage.tsx`, the product's most contested
  file, and wasn't part of this decision — anticipating the code, not
  the chat UI.
- No entry in `Engine.Harness.Agents.identity/1`
  (`apps/engine/lib/engine/harness/agents.ex`) — the same state `dev-lead`
  is in today, which also falls back to the generic fallback ("You are
  the staff agent."). This isn't a NEW gap: it's the real state of an
  active precedent, not fixed in passing.

## Alternatives considered

**Wait for the Anamnese to come out of refinement before building the
Staff.** Rejected — explicit decision of the product owner: anticipating
the code eliminates the "second PR" on the day the Anamnese reconnects,
and the value of MANUAL triggering exists independent of the automatic
trigger.

**Add `staff` to `USER_STARTED_AGENTS`.** Rejected — the investigation
showed it isn't necessary: the standard `canActivateAgent` path already
activates on an accepted handoff, and that list exists for the OPPOSITE
exception (an agent that starts WITHOUT a handoff). Adding it here would
invent a rule the domain doesn't call for.

**Give the Staff a `kickoff/1` with a generic instruction ("investigate
systemic problems").** Rejected — without a real artifact to summarize
(which only the Anamnese will produce), the kickoff would be an empty
invitation; the session stays idle until the first message, and it's
honest that it does.

## References

- `docs/fluxo.yml` — `id: staff` block
- `docs/business-rules.md` — RN-305/RN-306
- [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) — the mold for a
  solo, area-less conversational agent
- [ADR 0068](0068-diagrama-c4-do-arquiteto.md) — the contrast that
  decides "no dedicated use case" for the RFC
- [ADR 0081](0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md) —
  the precedent of "piece ready, real consumer not yet" declared without
  softening it
- `apps/engine/lib/engine/agents/staff_server.ex`, `staff_tools.ex`,
  `staff_supervisor.ex`
- `apps/engine/lib/engine_web/controllers/agent_command_controller.ex`
- `apps/api/src/domain/sessions/agent-activation.ts`,
  `apps/api/src/domain/agents/agent-areas.ts`
- `apps/web/src/lib/agents.ts`, `apps/web/src/lib/agent-status.ts`
