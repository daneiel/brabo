# ADR 0022 — Closing Phase 4b (session 1): evidence that arrives, cost that shows up, analysis that survives a kill

- Status: accepted
- Date: 2026-07-25
- Phase: 4b (closing session 1 — the real Psychologist itself is ADR 0015)

## Context

ADR 0015 delivered the real Psychologist: a `session.closed` consumer,
assembled context, structured hypotheses via ToolLoop, evidence validated
in the domain, idempotency via a unique partial index, cost triage by
tier. None of that is undone here.

What was missing was the step ADRs 0019/0020/0021 took for Phase 4a: run
the acceptance criterion and find out what only shows up while running it.
An audit of the three apps against the spec found concrete deviations —
three of them broke the acceptance criterion to the letter, and the
criterion had never actually been run (every previous phase has a
`demo:*`; the Psychologist didn't).

## Decisions

### 1. Navigable evidence requires fetching the event by ID

The evidence chip navigated to
`/projects/:id/sessions/:sid?highlightEvent=:eid` and `SessionPage` would
scroll to `#event-<id>`. Two things made that destination not exist:

- `ActivityFeed` hides machine noise (`agent.response`, `tool.call`,
  `tool.result`, `agent.status`, `agent.delta`, `context.compacted`) and
  also applies agent/type filters. These are EXACTLY the events the
  Psychologist cites the most — it's where agent behavior lives. The chip
  would navigate and the screen would show nothing.
- `useSessionEvents` fetches `{ limit: 200, latest: true }`. Evidence
  outside the last 200 events was unreachable — and `activity.ts`'s own
  comment records a real log with 193 events.

Two fixes, deliberately different in nature:

**`GET /projects/:projectId/sessions/:sessionId/events/:eventId`** (new,
`viewer`) over `GetSessionEventUseCase`, which reuses
`SessionEventRepository.findById` with the SAME membership check as
`ProposeHypothesesUseCase.resolveKnownEventIds` (exists AND belongs to
this session; an id from another session is 404). `SessionPage` renders
the cited event **pinned at the top** of the log panel. This is
independent of pagination and of filters — it's the structural guarantee
that the evidence arrives.

**`ActivityFeed` never hides the highlighted event**, even if it's machine
noise, even with an active filter. An invisible highlight is a navigation
that leads nowhere.

Why both and not just one: the pinned event solves the general case; the
filter exception keeps the highlight coherent when the event is ALSO
inside the window — without it the user would see the event at the top and
not see it highlighted in the log.

### 2. Per-analysis cost existed and showed up nowhere

`GetPsychologistAnalysisCostUseCase` was registered in the DI module and
**no controller injected it**. Its docstring claimed to be "the number the
UI shows on the Insight card" — there was no route, no UI, no test.
"Distinct costs between light and heavy triage visible in the metering"
was unverifiable by anyone.

`GET /projects/:projectId/psychologist/analyses` (`viewer`) over
`ListPsychologistAnalysesUseCase`, which combines the current analyses with
the hypothesis count (one grouped query, not N) and the summed cost from
`token_usage`. The UI gained a strip of analyses at the top of the
Insights section: tier, event count, hypotheses, cost, and a link to the
session.

The cost is per ANALYZED session, not per analysis row — `token_usage`
records per session + actor, with no reference to the analysis. In a
re-analyzed session the number is the accumulated total across passes,
which is the right thing for "how much the Psychologist spent on this
session"; hence the field being named `costMicros` and not
`analysisCostMicros`.

### 3. Without Lifeline, "post-restart analysis" was impossible

`config :engine, Oban` had `plugins: [Oban.Plugins.Pruner]`. With
`Oban.Engines.Basic`, a job SIGKILLed while `executing` doesn't come back:
the node died without marking an outcome, the row stays orphaned in
`executing` forever, and the worker's `max_attempts: 5` never gets
exercised. The requirement "kill the engine while generating a
post-restart analysis" had no way to hold.

`{Oban.Plugins.Lifeline, rescue_after: :timer.minutes(5)}` was added to the
plugins. This applies to ALL general-purpose workers (Psychologist,
Anamnesis, outbox drain) — the orphaning is a mechanism-level problem, not
one worker's.

The test that guards this (`Engine.ObanDurabilityTest`) asserts the config,
not the behavior: every worker test calls `perform/1` directly, so the
orphaning scenario only exists when actually running the engine. A config
test is what prevents silent regression; the real scenario stays in the
verification runbook.

### 4. `:ok` on a failure branch was killing the retry

`PsychologistWorker.perform/1` returned `:ok` when the context didn't
come through, with a comment saying "let Oban retry". In Oban, `:ok` marks
the job `completed`. If the api was down at drain time, the analysis
disappeared silently.

It now returns `{:error, reason}`. Deliberately no `analysis_failed`
narration on that branch: the narration path is the api itself, which is
precisely the thing that's down — what records the outcome in the meantime
is the job's row.

`reason_for/1` also started looking at `ctx.last_error`, which the
ToolLoop fills on a provider failure. Without this, a provider timeout was
narrated as "ended without emitting hypotheses" — the same trap already
closed for QA and Dev (ADR 0019), which are newer code than the
Psychologist.

### 5. Termination cause comes from the REASON, not the status

`Monitor.classify/1` deliberately makes `heartbeat_timeout` close as
`"closed"` (nobody being on the other end is a normal way for the session
to end, not an engine failure). But `TerminationClassifier.classify(_,
"closed")` returned `:normal`, so:

- the `:timeout` cause was **unreachable in production**, even though the
  spec names timeout alongside crash and kill;
- a session dead from timeout showed up in the prompt as "normal
  closing" and never got the termination-analysis section;
- the classifier's test was pinning the wrong behavior
  (`classify("heartbeat_timeout", "closed") == :normal`).

The classifier now reads the reason first. We ruled out changing
`Monitor.classify/1` so `heartbeat_timeout` closes as `closed_abnormally`:
it would fix it at the source, but it touches the Phase 1/4a state machine
and its tests, out of scope for this session — and the decision that
timeout is a *non-abnormal close from the engine's point of view* remains
correct. Who needs a different opinion is the Psychologist, and it's the
Psychologist that expresses it.

Contract consequence: the engine now sends `cause` in the
`emit_hypotheses` payload, and the api requires `terminationAnalysis` when
`cause !== 'normal'` (`requiresTerminationAnalysis`) instead of looking at
`session.status === 'closed_abnormally'`. `cause` is optional in the DTO —
without it, it falls back to the previous behavior, so an older engine
doesn't break during a rolling deploy.

An honest cause was also born for `{"normal", "closed_abnormally"}` (the
process exited cleanly but the api wasn't expecting the stop): `:unknown`,
labeled "unexpected stop, no cause identified". Before, it would fall
into `:crash`, which would lie about there being an exception.

### 6. The prompt's log needs a cap — pinned doesn't compact

The entire event log went into a single `:pinned` message, and the
`ContextManager` never compacts pinned content. This is CORRECT (a
summary doesn't preserve the event ids that evidence has to cite), but it
means the cut has to happen before that: with `Event.list/1` having no
`LIMIT` and `inspect(payload)` per event, a long session would overflow
the 128k window and the analysis would die on a provider error.

Three changes:

- `Event.count/1` (a COUNT in the database) and `Event.list_recent/2`.
  Triage now decides based on the real count without loading the log;
  only afterward, already knowing the tier, are the events read up to
  that tier's cap.
- A per-tier event cap (`max_prompt_events`) and a per-event payload size
  cap (`max_payload_chars`). The TAIL is what gets in: that's where the
  session's state at the moment of termination lives, which is exactly
  what the termination section needs to describe. Same reasoning as the
  feed's `latest: true`.
- The cut is **visible to the model**: the prompt says how many events
  were omitted and instructs it to only cite ids that are present.
  Without this, the model would conclude it had read the whole session,
  and would cite ids it never saw — which the api would reject, burning
  an iteration.

### 7. Hypothesis lifecycle becomes compare-and-swap

`updateStatus` had no `WHERE status = 'proposed'` — the protection against
a double accept was only the use case's read-then-write check, so two
simultaneous clicks both passed and the second overwrote the first's
decision. It became `updateStatusIfProposed`, which returns `null` when it
doesn't match and the use case translates into a 400.

The domain check (`assertHypothesisTransition`) still runs before the CAS,
on purpose: it's what gives the good message for the common case
("already accepted"). The CAS is the mutual exclusion, not the
explanation.

`AcceptHypothesisUseCase` also started running in ONE transaction. It used
to be four (update, two events, Anamnesis enqueue): a crash in the middle
would leave a hypothesis `accepted` that never reached the queue —
breaking exactly the closed loop the accept exists to feed.

### 8. Concurrent-analysis race is a conflict, not a 500

`findCurrentBySession` takes no lock, so two simultaneous `auto` runs both
see "no current analysis" and both insert. The unique partial index was
always the right safety net — what was missing was translating the
violation (23505 on the named index) into a `ConflictException` instead of
letting it leak out as a 500. We didn't add `SELECT ... FOR UPDATE`:
whoever loses the race doesn't lose work (the winning analysis is already
recorded), so locking would be cost with no benefit.

`superseded_at` (migration `0020`) answers WHEN an analysis was
superseded. The `supersedes` chain already answered by whom, but
"replaces the previous version, with history" isn't auditable without the
date.

### 9. Triage became an operator knob

Threshold, iteration caps, per-tier budget, and the prompt caps were
module attributes. They moved to `config/runtime.exs` with the ADR 0015
values as defaults, aligned with the other harness knobs — cost control is
something you tune per environment, not by recompiling.

### 10. Cleanup

`ActionPipeline` was registered as `:pre_tool_use` in the Psychologist's
hooks, but the registry has just one tool, `emit_hypotheses`, which is
`:direct` (the Psychologist is read-only, it never proposes an action
with external effect) — a permanent no-op, removed.
`listCurrentByProject`/`listNonDismissedByProject` gained `ORDER BY
created_at DESC` (without it Postgres doesn't guarantee order and the
Insights grouping would swap order between polls). `api-client`'s
`reanalyzeSession` existed with no caller at all: it gained a button on
the analyses strip. And the `internal-sessions.controller` comment that
still talked about the "PsychologistWorker (placeholder, phase 3+ brings
the real analysis)" was corrected.

## Consequences

- **Executable acceptance criterion**: `apps/api/scripts/demo-psicologo.ts`
  (`pnpm --filter api demo:psicologo`) closes 3 sessions — normal with a
  short log (light triage), kill (`closed_abnormally`, cause `kill`), and
  error with a long log (heavy triage) — and verifies structurally: one
  current analysis per session, the expected tier, at least one
  hypothesis, ALL evidence resolving via the by-id endpoint within its own
  session, `terminationAnalysis` on both abnormal ones, the light tier's
  cost below the heavy tier's, and reprocessing that supersedes without
  deleting (with a date). It exits with code 1 and lists failures if
  something doesn't match. The hypotheses' TEXT isn't verified — it comes
  from an LLM.

- **Both ollama models are seeded with ZERO price**, and zero cost in both
  tiers wouldn't prove anything about "distinct costs". The script
  assigns them distinct nominal prices (the seed explicitly says price is
  editable) and binds each tier to one of them. The cost still comes from
  the real path (`RunLlmTurnUseCase` records `token_usage.cost_micros`
  from the model's price) — no parallel cost mechanism at all. When
  running against a paid provider, `DEMO_MODEL_LEVE`/`DEMO_MODEL_PESADO`
  make this unnecessary.

- **The script's "kill" is the Monitor's report**, not a process SIGKILL:
  what the Psychologist consumes is `sessions.termination_reason` +
  status, and that's exactly what a real kill would produce. Killing the
  engine's container mid-analysis is the OTHER scenario (rescue of the
  orphaned job by Lifeline) and is verified by hand: with the job
  `executing`, `docker kill` on the engine, bring it back up, and the
  analysis completes after `rescue_after`.

- **First web tests of Phase 4b**: `HypothesisCard` (confidence, evidence
  navigation pointing to the ANALYZED session, termination section,
  actions only while proposed), `ActivityFeed` (the highlighted one is
  never hidden, neither as machine noise nor under an agent filter), and
  the `psychologist.*` branches of `activity.ts` — which existed with no
  test at all.

- On the engine, end-to-end heavy-triage tests were added (all previous
  ones ran with an empty log, `event_count == 0`), context failure
  returning `{:error, _}`, a successful correction AFTER an api rejection
  (the "up to M attempts" cycle had never been exercised all the way to
  success), timeout classified from `heartbeat_timeout` with status
  `"closed"`, and the log cut. On the api,
  `AcceptHypothesisUseCase`/`DismissHypothesisUseCase` (which had no test
  at all), the CAS blocking a double accept,
  `ListPsychologistAnalysesUseCase` (light < heavy),
  `GetSessionEventUseCase`, and the `cause`-driven termination
  requirement.

## Verification performed

The acceptance criterion RAN on this stack (local Ollama, no paid
provider) and passed all three cases: one current analysis per session,
the expected tier, a hypothesis in each, ALL evidence resolving via the
by-id endpoint within its own session, `terminationAnalysis` on both
abnormal ones, the light tier's cost (US$ 0.000087) below the heavy
tier's (US$ 0.002086), and re-analysis superseding with a dated
`superseded_at`.

Two things only showed up while running, and both became a default/piece
of documentation in the script:

- **`llama3.1:8b` doesn't call the tool.** It burned through the tier's
  iterations and never emitted `emit_hypotheses`; the outcome came out as
  "ended without emitting hypotheses" and NOT as "provider failure" —
  which, incidentally, is decision 4's distinction working: the model
  responded, it just didn't use the tool. On this stack only
  `qwen2.5-coder:7b` sustains tool calling with structured arguments
  (same reason it runs the dev agents), hence the copy in Ollama to give
  the same capable model two PRICES.
- **The light tier's 4-iteration cap is tight for a local 7B.** On the
  first run the kill session died on "iteration limit" after two attempts
  with empty `evidenceEventIds` and two citing a MADE-UP event id
  (`01KYE4B4W25GJ8R6H9Z3FJ8DQX`), each one correctly rejected, with the
  api's message going back to the model. In other words: the evidence
  guardrail caught an id hallucination in production, exactly as
  designed. The right answer is raising the cap per environment (the
  knobs now live in the compose file), never loosening the validation.

**The post-restart kill was verified by hand and works.** A job
`Engine.Workers.PsychologistWorker` `executing`, `docker kill` on the
engine's container, the job was left orphaned in `executing` with no
outcome, engine back up, and ~6 minutes later (5-min rescue_after plus
Lifeline's interval) the analysis COMPLETED, with `supersedes` pointing
to the previous one. Without Lifeline, that job would never leave
`executing`.

## Scope & assumptions

Out of this closing: `SELECT ... FOR UPDATE` in `findCurrentBySession`
(see decision 8); Oban `unique:` at the job level (the constraint + the
pre-check are enough, and Lifeline resolves the case that would motivate
it); batch re-analysis; a cost dashboard beyond the analyses strip; any
change to `Monitor.classify/1` or to the session state machine.

`superseded_at` is additive and nullable — analyses superseded BEFORE
this migration are left with `superseded = true` and a null date, and
that's honest: there's no record of when it happened.
