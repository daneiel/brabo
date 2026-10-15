---
traducao_de: 3b61c3e15ad44f6d269a4dc6745c50bb636a42b7
---

# ADR 0183 — A closed session can be reopened: a dedicated exit from the terminal states, to `active`, with a new event

## Status

**Accepted.** 2026-09-30 (AT-071, story HS-048, epic EP-027, round 30). Revises
part of [RN-001](../business-rules.md#rn-001) — *"terminal states have no
exit"* — and coexists with [ADR 0061](0061-tipo-da-sessao-na-criacao.md) (the
session has an immutable `kind`, and the execution state is the
`execution.activated` event). It edits neither: it **adds a transition** to the
state machine and declares what it does not change.

Three decisions of this ADR are a **PROVISIONAL, CONSERVATIVE DEFAULT, AWAITING
THE OWNER** — the minimum role, the absence of a deadline and the refusal for a
session with execution. They are marked as such below, and changing any of them
does not require a new ADR: it is swapping the indicated line and the RN that
cites it.

## Context

Measured on `origin/dev` (`79e6b1209f`), from the AT-071 survey (2026-09-13,
`b61bc49cd`):

- `session-state-machine.ts` declared `closed: []` and `closed_abnormally: []`,
  with the comment *"Estados terminais: nenhuma transição sai deles"*, and the
  test fixed that. There was no session `reopen`/`reabrir`/`retomar` in api,
  engine, web, ADRs nor RNs.
- The real case (`exp001`, session `fe57b393…`): `closed` by
  `heartbeat_timeout`, 92 events, eleven `artifact.business_rule`, five pairs of
  structured questions. The whole conversation survives in the event log
  (RN-002) and the artifacts are events, but the session had no way to go back
  to accepting conversation — since [RN-581](../business-rules.md#rn-581) the
  api refuses, with 409 `sessao_encerrada`, every conversation event in a
  terminal session.
- "Opening a new session" is no substitute: activating an agent requires an
  `accepted` handoff **in the session itself** (`agent-activation.ts`) and the
  PO's kickoff reads the brief and rules **of the session**. Copying into a new
  session would duplicate artifacts and break the Criativo → PO chain.
- Both dependencies are closed: AT-072 (RN-581 — the heartbeat recognizes an
  ongoing conversation, with an 8h ceiling) and AT-073 (RN-580 — rehydration
  reads the whole conversation). A conversational agent stopped at closing comes
  back through the idempotent `start_agent` on the first message and rebuilds
  the history from the log.
- `session.closed` is not a `session_events` row: it is outbox. The only durable
  record of WHEN and WHY the session closed is the `closed_at` and
  `termination_reason` columns of the `sessions` row.

## Decision

1. **One new transition, only from the terminal states, only to `active`.**
   `canReopen`/`assertReopen` in `session-state-machine.ts`, SEPARATE from
   `canTransition`: `ALLOWED_TRANSITIONS` keeps `closed: []` and
   `closed_abnormally: []`, so the generic route
   `POST .../sessions/:id/transition` keeps answering 409 to
   `closed → active`. **`closing → active` stays forbidden by any path** — the
   adoption in the shutdown drain depends on it (`shutdown.ex`). And a
   `created`/`active` session does not "reopen".

2. **Its own route, `POST projects/:projectId/sessions/:sessionId/reopen`**,
   200, use case `ReopenSessionUseCase`. Same design as
   `TransitionSessionUseCase.activate`: the engine is called (`startSession`)
   BEFORE the transaction, and its failure leaves the session closed as it was;
   under the lock everything is revalidated.

3. **What changes is state, and the previous closing becomes a NEW event.** The
   `sessions` row goes to `active` with `closed_at` and `termination_reason`
   cleared. On the SAME `seq` counter (RN-002), through the usual funnel
   (`AppendSessionEventUseCase`), `session.reopened` goes in, actor `user` (who
   reopened), payload `{from, to, closedAt, terminationReason}` — the copy of
   what the column loses. Nothing is edited, deleted or renumbered; the `kind`
   is not touched (RN-097).

4. **PROVISIONAL DEFAULT — minimum role `maintainer`.** One step above the
   generic transition (`developer`): reopening turns token spending back on in a
   session someone deemed finished. Lowering to `developer` is swapping the
   route's `@RequireRole` and the screen's `roleAtLeast`.

5. **PROVISIONAL DEFAULT — no deadline.** Every closed session is reopenable
   forever. A deadline (e.g. 30 days) is a comparison with `closed_at` in the
   use case.

6. **PROVISIONAL DEFAULT — a session with `execution.activated` does NOT
   reopen.** 409 `sessao_com_execucao`. `findActiveExecutionSession` picks the
   most recent `active` carrying `execution.activated` (RN-139): reopening an
   old execution session would return it to that search, and the next
   reactivation could divert the dev agents to it. The declared path to "execute
   again" remains opening a new session and activating execution in it (the
   "new execution" card).

7. **Engine: the closing that the reopening already undid stops nothing.**
   `SessionLifecycleWorker` reads the session's `status`
   (`ProjectSession.status/1`, a direct read of the api's table, as the Anamnese
   already did) and, if it is no longer terminal, ignores the job with a log — a
   late or retried job would bring down the process and the conversational
   agents of the reopened session. With no row, closing goes on as always.

8. **Web.** On the closed-session strip, "Reopen session" with a sentence about
   what comes back; inert below `maintainer` (`roleAtLeast` on the WORKSPACE
   role, the RN-471 gap already declared on screen), with the reason in TEXT.
   The api's refusal (execution, 403) becomes a toast with its sentence.

## Consequences

- **RN-001 stops being literally true** ("terminal states have no exit"): there
  is ONE exit, through its own route. RN-649 is the address of the new rule;
  RN-001 is not edited, and is pointed to by it.
- **Second Psicólogo analysis: BLOCKED until the owner decides**, with no new
  code. A second closing publishes `session.closed` again, and the
  `PsychologistWorker` short-circuits on the automatic path when a `current`
  analysis of the session already exists (`alreadyAnalyzed`). The post-reopening
  conversation gets NO automatic analysis; manual reprocessing (`triggeredBy:
  "manual"`) remains available and supersedes the previous one. If the owner
  decides the second analysis is legitimate (the conversation grew), the change
  is in the worker. Today the Psicólogo is paused
  (`PSYCHOLOGIST_ENABLED=false`).
- **A second graph consolidation is legitimate and idempotent**: the
  `Interacao` is keyed by `sessionId` and the `seq` window extends
  monotonically (`RecordInteractionUseCase`).
- **Per-session budget and measurement now have more than one active
  interval.** A duration metric computing `closed_at - created_at` lies for a
  reopened session; the previous interval is in the `session.reopened` payload.
  Not measured here; no current script was changed.
- **Heartbeat after reopening**: the screen that reopens is open and connects
  the heartbeat; with no tab, the heartbeat would close it again
  (RN-064/RN-581, an ongoing conversation holds up to 8h). It is the usual
  behaviour of an `active` session.
- **Known race window**: if the transaction fails AFTER the engine brings up
  the `SessionServer` (concurrent reopening, which revalidation under the lock
  refuses), a process is left for a session still closed — the same price
  `TransitionSessionUseCase.activate` already pays. The heartbeat with no client
  ends it, and the report lands in a terminal session.
- **`offered` handoffs stuck in the closed session become acceptable again** on
  reopening (RN-581 refused acceptance only by state). The lifecycle of
  [ADR 0182](0182-ciclo-de-vida-do-handoff.md) still holds: if the destination
  was activated in another session while this one was closed, the offer is
  already `superseded`.
- **Not touched, on purpose**: the "Close" button in `closed_abnormally`
  (AT-155).
