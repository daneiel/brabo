# ADR 0015 — Real Psychologist: ToolLoop, evidence-backed hypotheses and cost triage

- Status: accepted
- Date: 2026-07-24
- Phase: 4b (session 1 — replaces the PsychologistStub)

## Context

Phase 1's `PsychologistWorker` was an explicit placeholder: it read the
event log and wrote a fixed-text `psychologist.hypothesis`
(`Engine.Psychologist.Stub.summarize/1`), with no LLM, no evidence, no
idempotency (the docstring itself documented that an Oban retry would
duplicate the event).

This session replaces it with the real Psychologist: a consumer of
`session.closed`/`session.closed_abnormally` (any cause) that assembles
context (the full event log + the project's business rules + previous
undismissed hypotheses) and produces structured hypotheses via the
harness — each one MANDATORILY backed by evidence pointing to real event
ids.

Acceptance criterion: closing 3 sessions (normal, killed, error) generates
hypotheses with navigable evidence in all 3 cases, with distinct costs
between light and heavy triage visible in metering.

## Decisions

### 1. An Oban job calling ToolLoop directly — no GenServer

Unlike QA/SecOps/Dev/Infra (per-project/per-session GenServers that receive
repeated casts throughout the project's lifetime), the Psychologist runs
ONCE per session closure and never needs to be addressed again. Oban
already provides a supervised process with retries (`max_attempts: 5`), so
a GenServer/Supervisor/Registry would be ceremony without purpose.
`PsychologistWorker.perform/1` builds the ctx and calls `ToolLoop.run/1`
synchronously — the same shape as `QaAgentServer.run_qa/2`, without the
wrapper.

### 2. "Up to M attempts" is the ToolLoop's `max_iterations`

There's no new retry subsystem. The mechanism CLAUDE.md asks for ("a
hypothesis without valid evidence is rejected and re-requested from the
model, up to M attempts") is already the harness's normal loop: a tool that
returns `{:error, reason}` has that string injected as the next
`tool`-result, and the model corrects on the following turn. `M` is
literally `Triage.max_iterations(tier)` in the ctx (4 for the light tier, 8
for the heavy one).

`Engine.Psychologist.Tools.EmitHypotheses` is the mandatory tool (same
shape as `EmitArtifact`/`EmitQaVerdict`); `Engine.Psychologist.Hooks.
Termination` is the `:post_tool_use` hook that only halts when validation
passed. Two stages on purpose: the tool validates, the hook terminates.

### 3. Evidence validation lives in the api's domain, atomic per batch

`ProposeHypothesesUseCase` resolves each `evidenceEventId` via
`SessionEventRepository.findById` and requires that the event exist AND
belong to the analyzed session (same pattern as `CreateStoryUseCase` for
`business_rule_id`); `domain/psychologist/hypothesis-evidence.ts`
(`validateHypothesisBatch`, pure) applies the remaining rules (non-empty
evidence, integer confidence 0–100, `terminationAnalysis` mandatory in at
least one hypothesis when the session terminated abnormally).

The WHOLE BATCH is rejected if any hypothesis fails — partial acceptance
would make the model believe part was recorded when the tool-result is
aggregated, breaking the clarity of the correction cycle.

### 4. The lifecycle requires a mutable table (events are immutable)

`session_events` is append-only (CLAUDE.md), so the state that changes
(`proposed → accepted | dismissed`) lives in a dedicated table
`psychologist_hypotheses` — the same pattern as `tasks.gate_status`/
`infra_artifacts.gate_status`. Each transition ALSO emits its own
immutable event (`psychologist.hypothesis_proposed`/`_accepted`/
`_dismissed`, `psychologist.analysis_completed`/`_failed`) for the audit
trail.

`domain/psychologist/hypothesis-lifecycle.ts`
(`assertHypothesisTransition`, pure) only allows leaving `proposed` — this
avoids a double-accept race.

### 5. Idempotency: unique partial index + "a failed run doesn't write a row"

`psychologist_analyses` has
`uniqueIndex('psychologist_analyses_current_idx').on(sessionId).where(superseded = false)`
— at most ONE current analysis per session, always. That IS the
"session_id + already processed unique key".

Two layers: the worker pre-checks `alreadyAnalyzed` (a cheap short-circuit,
so an Oban retry doesn't spend LLM cost) and the index is the safety net
against a real race.

**A row is only born when the analysis CONCLUDES.** A run that exceeds a
limit/budget without emitting valid hypotheses writes nothing — on
purpose: this distinguishes "duplicating a completed analysis" (blocked)
from "retrying one that failed" (allowed, and it's exactly the
engine-kill/post-restart-analysis scenario from the acceptance criterion).
The failed outcome still narrates `psychologist.analysis_failed` — it
never goes without an outcome, the same discipline as DevAgent/QA.

**Explicit reprocessing** (`triggeredBy: "manual"`, via `POST
projects/:id/sessions/:id/psychologist/reanalyze` → the engine enqueues
the job) always runs: it marks the previous analysis `superseded = true`
(NEVER deletes it) and inserts the new one. History is preserved for free
— the old hypotheses stay there, they just aren't "current" anymore.

### 6. Termination cause is a deterministic classification, not an LLM judgment

`Engine.Psychologist.TerminationClassifier.classify/2` is a pure pattern
match over `sessions.termination_reason` — recognizing "heartbeat_timeout"
vs a kill signal vs an exception message is pattern matching, not
semantics (same rationale as ADR 0013's deterministic SecOps). The cause
enters the prompt as a FACT; the model analyzes its CONSEQUENCES.

This required closing a gap: `ReportSessionTerminationUseCase` received
`reason` from the engine but only logged it. It's now threaded through to
a new nullable column `sessions.termination_reason` (null for a
human/graceful close).

### 7. Triage: genuinely different agent bindings

`Engine.Psychologist.Triage.decide/1` — fewer than **20** events →
`:leve` (light), otherwise `:pesada` (heavy). Rationale for the
threshold: below that, the session is typically someone opening it and
exchanging a couple of messages, without enough behavioral signal to
justify a strong model.

The tier picks the agent's **slug** in the ctx (`"psicologo-leve"` vs
`"psicologo"`), not a code-level model override — this way the existing
binding cascade (`session > agent > project > workspace`) resolves on its
own, the operator keeps controlling both tiers through the existing
binding table in `ProjectSettingsTab` with no new screen, and cost
genuinely diverges in the `token_usage` that `RunLlmTurnUseCase` already
writes unconditionally. The seed binds `psicologo → Opus 4.8` and
`psicologo-leve → Haiku 4.5`.

The tier also sets `max_iterations` and `token_budget_micros` (50k vs
300k micro-USD), enforced by the mechanism the ToolLoop already has
(`{:budget_exceeded, ctx}`) — zero new enforcement code.

## Consequences

- UI: a new **Insights** section in `ProjectOverviewTab`, scoped to the
  PROJECT (not the currently open session — the acceptance criterion
  closes 3 different sessions), hypotheses grouped by target agent,
  `HypothesisCard` with confidence, termination analysis and clickable
  evidence chips. Each chip navigates to
  `/projects/:id/sessions/:sessionId?highlightEvent=:eventId` —
  `SessionPage` gained a collapsible "Event log" panel (reusing
  `ActivityFeed`/`EventItem`, which already classify every event type)
  that opens by itself and scrolls to the highlighted event. `activity.ts`
  gained real `psychologist.*` branches — the old `startsWith('hypothesis')`
  branch was dead code (it never matched `psychologist.hypothesis`).
- Tests: domain (`hypothesis-lifecycle`, `hypothesis-evidence` — a
  nonexistent id, an id from another session, missing
  `terminationAnalysis`), `ProposeHypothesesUseCase` (happy path, atomic
  rejection, supersede), `GetPsychologistContextUseCase`,
  `ReportSessionTerminationUseCase` (reason persisted); engine: `Triage`
  (the threshold boundary), `TerminationClassifier` (5 causes),
  `EmitHypotheses` (the api's message preserved verbatim for the model to
  correct), `PsychologistWorker` (idempotency doesn't call the LLM, triage
  picks the right agent, abnormal termination requires
  `terminationAnalysis`, kill→restart concludes).
- The event to the Anamnesis
  (`psychologist.hypothesis_accepted_for_anamnese`) is emitted as a
  DISTINCT TYPE (not a flag in the payload) — filterable by a future
  consumer without inspecting the payload, the same spirit as
  `session.closed` vs `session.closed_abnormally` being separate types. No
  outbox: there's no consumer yet, and routing through the outbox would
  require naming a nonexistent worker in `handlers_for/1`.

## Scope & assumptions

Out of this session: the **Anamnesis** itself (periodic jobs,
`proficiency_profile`, `instruction_patch` as a proposed_action,
agent-file versioning/rollback — Phase 4.6); any prioritization/consumption
logic for the event forwarded to it; a cost dashboard beyond the
per-analysis number; job-level `Oban unique:` (the database constraint +
pre-check are already enough — it stays as a follow-up if flakiness shows
up in practice); batch reanalysis.

The "already analyzed" status is per SESSION, not per project — each closed
session yields at most one current analysis, and reanalyzing one doesn't
affect the others.
