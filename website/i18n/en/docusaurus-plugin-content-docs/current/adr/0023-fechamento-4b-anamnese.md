# ADR 0023 — Closing Phase 4b (session 2): a catalog that works, a dedup that distinguishes who denied, and a queue that survives the run

- Status: accepted
- Date: 2026-07-26
- Phase: 4b (closing session 2 — the Anamnesis itself is ADR 0016)

## Context

ADR 0016 delivered the Anamnesis: a per-project scheduler,
`proficiency_profiles` with evidence, a catalog derived from `module_map`,
`instruction_patch` as a `proposed_action` with an LCS diff, append-only
versioning with forward rollback, a queue closing the loop, and the two UI
sections. None of that is undone.

What was missing was the step session 1 received in ADR 0022: run the
acceptance criterion and close what only shows up while running it. The
audit of the three apps found ~28 deviations — seven broke the criterion,
one item from the spec had never been implemented, and the criterion
**had never been run** (there was no `demo:anamnese`, nor any way to run a
round on demand).

## Decisions

### 1. The catalog has to tokenize a compound stack — this is what was blocking everything

`deriveCatalog` put the ENTIRE `module_map` `stack` in as ONE competency.
The problem: `ModuleMapModule.stack` is ONE free-text string written by the
Architect (via LLM), and in practice it lists several technologies. With
`stack: "NestJS + Drizzle + Postgres"`, the catalog got the competency
`"nestjs + drizzle + postgres"` and the natural emission (`"nestjs"`) fell
outside it — and since `validateProficiencyBatch` rejects the ENTIRE
BATCH, the round never saved a single profile.

The consequence was worse than "one profile short": only
`emit_proficiency` halts the ToolLoop, so the round never concluded, never
recorded `anamnese_runs`, and the window was reprocessed indefinitely.
**The Anamnesis didn't work on any realistic project.** The existing test
only exercised the idealized single-token case (`deriveCatalog(['NestJS'])`),
which is exactly what a human would write and an LLM wouldn't.

`deriveCatalog` now splits on `+`, `,`, `/`, and `&`, adding both each
token AND the whole phrase (whoever wrote `"Node.js"` — a token with a
dot — can't be left out). A 1-character token is discarded: widening the
catalog with noise is exactly what the guardrail must not do, and there's
an explicit test that tokenizing does **not** loosen the rejection of
sensitive attributes.

Two neighboring defects, from the same write path:

- the competency was recorded RAW, and the unique constraint is
  `(project, user, competency)` — `"NestJS"` and `"nestjs "` created two
  rows for the same thing. It now records normalized.
- two entries for the same `(userId, competency)` in the batch hit
  `ON CONFLICT DO UPDATE command cannot affect row a second time` (the
  upsert is a single command), turning into an opaque 500 instead of a
  fixable tool result. It's now a rejection with a message telling the
  model what to do.

### 2. A POLICY denial isn't a user denial

"a denial is recorded so as not to re-propose the same thing" refers to
the **user's** decision. But the dedup only filtered `status === 'denied'`,
and `ProposeActionUseCase` writes that same status **with no decider**
when `decide` rejects it due to a role below `maintainer` or via
`permissions.json`. Result: a patch blocked by policy stayed condemned
forever — the human never saw the diff, and even fixing the role, there
was no way to propose it again.

It now requires `decidedBy !== null`. It's one line, and it's the
difference between "the user said no" and "the system didn't even let it
be shown".

### 3. Consuming the queue is a consequence of the patch existing

`emit_proficiency` unconditionally sent `consumedQueueIds: ctx.queued_ids`
alongside the profiles. A round that read the accepted hypothesis and did
**not** propose a patch would burn the queue entry, and nothing
re-enqueued it: the criterion "I accept a hypothesis and see the next
patch reference it" would fail silently and never recover.

We inverted the responsibility: the engine no longer touches queue ids,
and `ProposeInstructionPatchUseCase` marks the entry consumed when the
patch that references it is BORN, in the same transaction. A hypothesis
that was read and not used stays pending for the next round.

Why consume on the PROPOSAL and not on approval: the hypothesis fulfilled
its role once it became a patch the human can evaluate. If the user
denies the patch, what prevents repetition is the dedup (decision 2);
re-enqueuing would lead to proposing the same patch forever.

Contract consequence: `consumedQueueIds` left the internal DTO, and
`markConsumed(ids)` became
`markConsumedByHypothesis(projectId, hypothesisId)`. The `projectId` in
the filter closes, along the way, a cross-tenant hole: the old version was
`inArray(id, ids)` with no scope, so a call could mark another project's
queue as consumed.

### 4. `hypothesisId` is validated on both ends

Neither the engine (against the round's hypotheses) nor the api (against
the project) validated the id. A hallucinated id would flow all the way to
`agent_instruction_versions.source_hypothesis_id` and the
hypothesis→patch→version traceability would point at nothing.

The engine rejects `hypothesisId` outside `ctx.queued_hypothesis_ids`,
with the message going back to the model to correct on the next turn
(same idiom as the Psychologist's evidence rejection); the api revalidates
that the hypothesis exists and belongs to the project. Note that the ctx
now carries HYPOTHESIS ids, not queue-row ids — what's offered to the
model in the prompt and what the patch needs to carry are the same thing.

### 5. "commands it approves/denies" enters the window — reverting the deferral from 0016

Item 1 of the spec lists four signals: language, corrections to agents,
**commands it approves/denies**, and the level of the questions. The first
three are in the event log; the fourth lives in
`proposed_actions.decided_at`, and ADR 0016:170-174 deferred reading it
("natural evolution of the context"). One of four signals left out, by
design.

New `listDecidedInWindow(projectId, from, to)` — only decisions with a
human decider, in the same window the engine uses for the log — feeds a
`decisions[]` field in the context, and the prompt gained its own section
with `rejectionReason`. **The reason for a denial is the richest signal in
the window**: it says what the person thought was wrong, in their own
words ("never use push --force, generate a migration" is worth more than
ten chat messages).

`Triage.should_run?` now counts decisions along with events: a window
where the user only approved and denied actions IS material, and it was
being discarded as empty.

### 6. Profile evidence is PROJECT-scoped — the UI needed to resolve the session

The evidence chip always navigated to `useLatestSession(projectId)`. But
the Anamnesis's window spans several sessions (ADR 0016 decision 10), so
any evidence from an older session fell into "event not found in this
session". It's the SAME defect ADR 0022 decision 1 closed for the
Psychologist, repeated here — and `ProficiencyProfile` has no `sessionId`
to fix it on the client.

New `GET /projects/:projectId/events/:eventId` over
`GetProjectEventUseCase`: unlike session 1's per-session endpoint, here the
session is the **answer**, not the validation. The chip resolves it and
then navigates. The event pinned label on `SessionPage` no longer says
"cited by the hypothesis" — now it arrives from two origins.

### 7. Privacy: everyone sees their own; whoever administers sees the team's

`GET /proficiency` was `viewer` and returned the profile of ALL members
(competency, level, the reasons, evidence). Worse: the delete required
`developer`, so a `viewer` would be profiled and get **403 trying to
delete their own profile** — breaking "the entire profile visible and
deletable by the user".

A competency profile is data about a person, so the default is that they
see their own: `owner`/`maintainer` get the aggregated view (useful for
allocating work), any other role gets only their own, via the `listByUser`
that already existed and was dead code. Delete and opt-in now only require
`viewer` — being a member. We ruled out "nobody sees anybody's": it would
leave the screen empty for whoever administers, with no real privacy gain
inside a project the person chose to join.

Two smaller holes in the same guardrail: the evidence wasn't project
scoped (`findById` without checking the project, while the message
promised "of this project"), and `delete` + `opt-out` were two loose
awaits — a crash between them would leave the profile deleted and
re-derivable, i.e. the delete would have been cosmetic anyway. It's now a
transaction.

### 8. On-demand round, because 15 minutes isn't testable

The only way for a round to happen was the scheduler's tick. `POST
/projects/:projectId/anamnese/run` (engine + api, `maintainer` for the
same reason as the Psychologist's re-analysis: it runs the ToolLoop and
spends budget) closes the asymmetry and is what makes the acceptance
criterion executable. A project with no session responds 409 — there's no
log to analyze and nowhere to narrate, same as the periodic path.

### 9. Parity with what session 1 hardened

The Anamnesis had, one by one, the same defects ADR 0022 closed in the
Psychologist:

- `perform` returned `:ok` on context failure, with a comment saying it
  left it to Oban to retry — `:ok` marks `completed`, so the project's
  round would disappear silently and `max_attempts: 3` was dead weight.
- `reason_for({:ok, ctx})` ignored `ctx.last_error`. It was the **only**
  one of the four call sites (QA, Dev, Psychologist, Anamnesis) out of
  pattern: a downed provider turned into "ended without emitting
  profiles".
- the window went into one `:pinned` message (which `ContextManager`
  can't compact, on purpose — the evidence's event ids have to survive)
  with 500 events and `inspect(payload)` with no truncation, against a
  fixed `context_window`. It gained a per-config event cap, truncated
  payload, and a VISIBLE omission note for the model (it can only cite
  ids it sees). Along the way, `created_at` — which was collected and
  discarded — entered the event line: "level of the questions" is trend
  analysis, and trend needs time.
- every cap was a module attribute. They moved to `runtime.exs` and to
  the compose file, with the current values as defaults.
- `ActionPipeline` was registered on `:pre_tool_use` while being a
  permanent no-op (none of the Anamnesis's tools are `terminal`/`write_file`).

### 10. One diff, one appearance

`--diff-add`/`--diff-del` are specified in `design/COMPONENTS.md:127` and
**did not exist** in `design/tokens.css`. `ApprovalCard` used
`var(--diff-add, #0e2e24)` and therefore always fell back to the
hard-coded hex; the version history, written later, invented a TEXT color
instead of a background one. The same patch had two different appearances
depending on where you looked. The tokens were defined in both themes (the
spec's pair is calibrated for dark) and both places now use the same
language.

Also: deleting the profile gained confirmation via the existing `ui/Modal`
(it's irreversible and a raw click was too much), rollback and opt-in
gained a pending state (a double click would create two versions), opt-in
now invalidates the query, and the patch card renders all files — not just
`files[0]`, while the `git_commit` branch next to it always used to loop.

## Verification performed

`pnpm --filter api demo:anamnese` — the script explicitly separates what's
deterministic (tokenized catalog, guardrail, queue only consumed with a
patch, patch→approval→version with `sourceHypothesisId`→rollback that
restores content by creating another version, dedup by human decision,
opt-out preventing re-derivation) from what depends on the model (the
round recording a profile with resolvable evidence and proposing the
patch). It exits with code 1 listing what failed.

Suites: engine 250, api 500, web 105 — all green. The missing tests
included the first web tests for the Anamnesis (session 1 got its own in
ADR 0022; this one had none) and two that guarded assurances with no
coverage: the cap that "`instruction_patch` is never auto-approvable" in
`decide.ts` — same class as the merge lock, which has four tests — and
`ExecuteInstructionPatchUseCase`, the only executor with no spec, passed
as `undefined as never` in neighboring tests.

### The window was truncated to the second — and the round was skipped silently

This only showed up while actually running `demo:anamnese`, and it was the
REAL cause of "profile doesn't come through" that I had been attributing
to local-7B flakiness. `token_usage` for the `anamnese` actor was at ZERO:
the model was never called.

`session_events.created_at` was declared `:utc_datetime` in the Ecto
schema (SECOND precision) against a `timestamptz(6)` column. Ecto
truncates the parameter in the comparison, so `created_at < window_to`
became `< 15:39:32` instead of `< 15:39:32.931` and **discarded everything
that happened within the current second**. Measured in the database: 0
events in the truncated window against 9 without truncation, with the
first event at `15:39:32.363`.

Since the script does everything in under a second, the window was ALWAYS
empty. In production the 15-min tick almost always escapes this (the
events are already from previous seconds), which is why it slipped past
the audit — which had even recorded it as "minor, hedged". It was not
minor.

Two changes:

- `:utc_datetime_usec` on the field, aligning with the column. The
  regression test (`event_window_test.exs` — the per-project window had
  none at all) was verified FAILING without the fix: a test that would
  pass either way wouldn't prove anything.
- A skipped round now leaves a trace (`Logger.info` with the counts and
  the threshold). Deliberately NOT an event in the log: a tick every 15
  min per project would turn into noise. But total silence was exactly
  what hid this — a round that does nothing and says nothing is
  undiagnosable.

With the fix, `demo:anamnese` passed IN FULL: "Phase 4b acceptance
criterion (session 2) MET".

### The visual pass found three things no test would have caught

`demo:*` proves data; it doesn't prove the screen shows the data. Opening
the UI on the guinea-pig project:

1. **The instruction history was invisible for the agents that actually
   exist.** The section fanned out over `AGENT_LIST` (a static roster,
   with `dev-backend`/`dev-frontend`), but Phase 4a instantiates a dev
   agent PER MODULE (`dev-api`, `dev-web`). With 3 versions of `dev-api`
   in the database, the screen said "No agent has had its instruction
   changed yet" — meaning item 5 of the spec (history with diff and
   rollback) was dead precisely for the agents the Anamnesis patches. New
   `GET /projects/:projectId/instruction-versions` returns who HAS
   history, and the UI stopped guessing the slug.
2. **The patch and rollback narrations lost the version.** `payloadField`
   only returned `string`, and `toVersion`/`restoredFrom` arrive as a
   number — so the feed said "dev-api's instruction updated" (with no
   version) and "reverted to **v?**". It now accepts numbers too.
3. **"Always allow" showed up on an `instruction_patch`.** The
   `decide.ts` cap forces `require_approval` always, so writing the rule
   into `permissions.json` changes nothing: the button was promising an
   effect that doesn't exist. Hidden for this type.

Also verified on screen: level/reasons/chips of the profile; the evidence
chip resolving to the RIGHT session (it went to the session that contains
the event, not to the most recent one) with the event pinned at the top
of the log; the `hypothesis <id>` badge on the version and on the
approval card; the diff with the new tokens in both places; and —
closing what ADR 0022 claimed without verifying — the Psychologist's
analyses strip with cost actually diverging (heavy US$ 0.0068 vs. light
US$ 0.0001) and an evidence chip pointing to an `agent.response`, the
type the feed hides, successfully reaching the event.

## Scope & assumptions

Out of this closing: syncing the web's `ActionType` union with the
backend's 12 types (pre-existing debt, ADR 0016); prompt rebuild in a
live conversational GenServer; an index on `session_events` for the
per-project window; manual instruction editing via the UI; an index on
`source_hypothesis_id` and the reverse query (hypothesis → versions),
which nobody is asking for yet.

The patch's `apply` still runs outside the transaction that updates the
action (`ExecuteInstructionPatchUseCase`): a crash exactly between the two
leaves the instruction patched with the action `approved`. This is
recorded because it's real, but fixing it calls for rethinking the
transactional boundary of ALL the executors (the infra one and the git one
have the same shape), and doing it only here would create inconsistency
between siblings.
