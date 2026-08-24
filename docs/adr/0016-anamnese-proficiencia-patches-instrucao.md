# ADR 0016 — Anamnesis: proficiency profile, instruction patches and closed loop

- Status: accepted
- Date: 2026-07-24
- Phase: 4b (session 2 — closes Phase 4)

## Context

The Psychologist (ADR 0015) already produces evidence-backed hypotheses and
emits `psychologist.hypothesis_accepted_for_anamnese` — an event
deliberately left without a consumer, documented there as a "hook for
4.6". This session builds that consumer: the **Anamnesis**, a periodic
per-project Oban job that derives a `proficiency_profile` per
user+competency from windows of the event log, proposes an
`instruction_patch` on agent files (with diff, approval and rollback) and
closes the loop hypothesis→patch→version.

Acceptance criterion: the Anamnesis proposes 1 patch with an understandable
diff; accepting a hypothesis makes the next patch reference it; rollback
makes the agent go back to its previous behavior.

## Decisions

### 1. The guardrail is STRUCTURAL, not a prompt instruction

`domain/anamnese/competency-catalog.ts` deterministically derives the
allowed catalog: stacks from the current `module_map` (normalized) + a
**hard-coded** list of process competencies (`git`, `agile`,
`arquitetura`, `testes`, `seguranca`, `infra`). `validateProficiencyBatch`
rejects the WHOLE BATCH if any entry cites something outside the catalog.

The point: a model that tried to emit "anxiety", "mental health" or
"personality" **has no write path that accepts it** — the prohibition
doesn't depend on the prompt being obeyed. The prompt reinforces it, the
domain guarantees it. There's an explicit test with 8 sensitive
attributes.

### 2. Deleting the profile really deletes it — and opt-out prevents re-derivation

`DELETE` of the rows + a row in `anamnese_opt_outs`. Without the opt-out,
the next round would re-derive exactly the same profile and the "delete"
button would be cosmetic. The user only gets profiled again with explicit
opt-in. An opted-out user is filtered at TWO points (the context that goes
into the prompt and the batch validation), so they neither enter the
prompt nor can become a row.

### 3. Instruction history in a separate append-only table

`agent_instructions` had `unique(project_id, agent)` and destructively
bumped `version` — the previous content was lost, rollback was
impossible.

Instead of reworking that table, `agent_instruction_versions` (new,
append-only) holds the history and **`agent_instructions` remains
untouched as the "current" pointer** — which is exactly what the engine
reads via read-only Ecto. Result: no change to the engine's schema nor to
its test fixture.

**Retroactive backfill**: everything seeded before this phase has an
instruction but no version in the history. `ApplyInstructionVersionService`
captures the current content as a version BEFORE overwriting, when the
history is empty — without this, the first rollback would have nowhere to
return to.

### 4. Rollback is a FORWARD operation

Reverting to v2 writes a NEW version with v2's content. Nothing is deleted
or rewritten: you can "undo the undo", and the audit trail shows when
each reversion happened. The restored version preserves the original
`sourceHypothesisId`, so traceability survives the rollback.

`ApplyInstructionVersionService` is the SINGLE point through which content
changes (both an approved patch and a rollback go through it), which
guarantees no path ever forgets to write the version or invalidate the
cache.

### 5. Instruction cache: match-delete across ALL roots

Discovery of this session: `InstructionFiles.invalidate/3` existed but
**was never called in production** — only in tests. Worse, the cache key
is `{project_id, agent, root}` and `root` varies (nil for the shared
workspace, the worktree path for dev agents), so invalidating one key
would leave the dev serving the stale instruction.

New `Cache.delete_agent/2` (`:ets.match_delete` by
`{{project_id, agent, :_}, :_}`) + `InstructionFiles.invalidate_all/2` +
internal endpoint
`POST /internal/projects/:id/agents/:agent/instructions/invalidate`,
called by the api after every patch/rollback.

**Known and accepted limitation**: agents that rebuild the system prompt
on every `run` (dev-*, QA, SecOps, Psychologist, Anamnesis — the typical
targets of a patch) pick up the change on the NEXT execution; the
conversational ones (Creative/PO/Architect/Infra) freeze the prompt at
`init` and only pick it up on restart. Rebuilding the prompt in a live
GenServer was deliberately dropped: it would touch 4 GenServers from
Phase 3 that CLAUDE.md asks not to refactor without necessity, and the
acceptance criterion closes without it. Invalidation is **best-effort** —
failing it doesn't fail the patch (the content is already in the
database).

### 6. Hand-written LCS diff, no new dependency

`domain/instructions/text-diff.ts`, ~60 pure lines. Justification
(CLAUDE.md requires justifying libraries): the output format was already
dictated by the renderer that ALREADY exists in `ApprovalCard.tsx`
(`{kind: 'add'|'del'|'ctx', content, lineNo}`), instructions are files of
tens to a few hundred lines (n·m is trivial, no need for Myers), and the
repo favors pure, tested domain functions. `ProposeInstructionPatchUseCase`
already delivers `files[].lines` in the renderer's format — the UI didn't
get its own differ.

### 7. "Don't re-propose a denied patch" without a new table

`isDuplicateOfRejected` compares against the contents of `denied`-status
`proposed_actions` of type `instruction_patch` — derived from data that
already exists, with no new structure to keep in sync. The normalization
looks through CRLF, trailing whitespace and blank-line padding
(formatting noise), but **preserves leading indentation** (it can change
meaning in markdown), so a re-indentation counts as a different patch.

### 8. An instruction patch is NEVER auto-approvable

A ceiling in `decide.ts`, in the same spirit as the merge lock: neither
`agent_autonomy` nor `permissions.json` can promote `instruction_patch` to
`auto_approve`. The feature's value is in the human seeing the diff first;
auto-approving would be the agent rewriting itself.

### 9. Closed loop via an explicit queue, not the outbox

`AcceptHypothesisUseCase` enqueues into `anamnese_queue` (unique per
`hypothesisId`, idempotent) alongside the events it already emitted.
Enqueuing here is deterministic — it doesn't depend on routing the outbox
nor on the consumer being up. `Engine.Anamnese.Triage.should_run?/2` makes
a hypothesis in the queue **always force** the round (even during a silent
window): ignoring it would break the loop the user just requested.

The full chain: hypothesis accepted → `anamnese_queue` → the round's
prompt as "PRIORITIZED input" → `propose_instruction_patch` with
`hypothesisId` → the proposed_action's payload → `sourceHypothesisId` on
the written version → origin badge in the UI.

### 10. Periodic round: a global scheduler with per-project fan-out

`AnamneseSchedulerWorker` reuses the exact idiom of `OutboxDrainWorker`
(no `:unique` in the `use` — the running job would collide with itself and
kill the chain; `unique:` only on `kickoff/0` with
`states: [:available, :scheduled, :retryable]`). A 15-minute tick; the
CHILD jobs have `unique` per `project_id`, so a slow project doesn't pile
up rounds.

The Anamnesis is project-scoped but `append_event`/`token_usage` are
session-scoped by FK — the scheduler picks the project's most recent
session as the narration's address (precedent: `repo_bootstraps` uses a
dedicated session). A project with no session at all doesn't run.

A round that doesn't conclude **writes nothing** to `anamnese_runs`, so
the window is reprocessed on the next one (the same discipline as the
Psychologist); a round with no new material and no queue is **skipped
without spending LLM cost**.

## Consequences

- New `SessionEventRepository.listForProjectInWindow` (api) and
  `Engine.SessionEvents.Event.list_for_project_window/4` (engine) — no
  window-based query existed before. The engine reads the window directly
  from Postgres (cheaper than shipping the log over HTTP), joining on
  `sessions` because `session_events` doesn't carry `project_id`.
- New `Engine.Sessions.ProjectSession` (read-only) and
  `Engine.Projects.Project.list_ids/0` — the engine didn't know how to
  list projects nor find a project's session.
- "Commands that approve/deny" aren't session_events (only the outbox +
  the `proposed_actions` table, where the free-text `rejectionReason`
  lives). In this session the window covers user events from the log;
  reading decisions from `proposed_actions` remains a natural evolution of
  the context.
- UI: two new sections in `ProjectSettingsTab` (a profile with clickable
  evidence and a delete button; a version history with diff and rollback),
  an `instruction_patch` branch in `ApprovalCard` with the origin
  hypothesis's badge, and `instruction.*`/`anamnese.*` branches in
  `activity.ts`.
- `Engine.Harness.Agents` — the `"anamnese"` identity described project
  onboarding; rewritten for the real role (evidence-backed profiling and
  an explicit prohibition on sensitive attributes).

## Scope & assumptions

Out of scope: syncing the web's `ActionType` union with the backend's 12
types (pre-existing debt — only `instruction_patch` was added, since it
has its own rendering); rebuilding the prompt in a live conversational
GenServer; a new index on `session_events` for the per-project window (if
the scan becomes a bottleneck, it becomes a follow-up); manual instruction
editing via the UI (only proposed patch + rollback).

The proficiency level is a three-point scale (`iniciante`/`intermediario`/
`avancado` — beginner/intermediate/advanced) — deliberately coarse: the
precision of a finer scale wouldn't be sustainable from observational
evidence.
