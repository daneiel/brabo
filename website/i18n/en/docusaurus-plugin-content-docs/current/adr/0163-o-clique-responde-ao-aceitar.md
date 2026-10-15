---
traducao_de: f8d6559d1abb11ac6c9a1b1d79833cbd56906238
---

# ADR 0163 — The click answers on ACCEPTING the command, and the turn continues through the channel

## Status

**Accepted.** 2026-09-18 (AT-089). It generalizes the breaking of the synchronous
block that [ADR 0086](0086-dev-lead-plano-suspende-para-aprovacao.md) did only
for the suspended Dev Lead. ADR 0086 is not edited: what it decided (the turn
that SUSPENDS answers the `from` right away and emits
`agent.status: awaiting_approval` instead of `agent.done`) remains valid — this
document only moves the answer's moment earlier for EVERY turn, and with that its
case stops being the only one. Rule: [RN-578](../business-rules.md#rn-578).

## Context

In a real v6.1.0 installation (09/14), three clicks hung for the ENTIRE turn of
the agent they triggered:

| api route | request time |
|---|---|
| `POST …/agents/criativo/structured-question/:id/answer` | 97.3 s |
| `POST …/sessions/:id/readiness` | 97.3 s |
| `POST …/agents/arquiteto/handoff-infra` | 51.8 s |

The event log of the same session matches all three to the tenth of a second
(from the user's event to the agent's persisted `agent.status: idle`): 97.2 s,
97.3 s and 51.7 s. The reason is a single one: every user route that talks to a
conversational agent goes through `EngineWeb.AgentCommandController`, which does
a synchronous `GenServer.call` (120 s on the Criativo (Creative), 180 s on the
others) — and the agent's `handle_call`, since RN-122, deferred the answer until
the turn's Task ended (`TurnoAssincrono.iniciar/3` kept the `from` and answered
in `tratar_resultado/2`). The controller already returned **202** and already
discarded the return (*"esta resposta é só o aceite"*), and the OpenAPI of
`…/message` already said *"the response is just the acknowledgment"*. The
acknowledgment only arrived at the end of the turn.

Three consequences, all measured:

1. **The button "does not respond".** For the person, a click that takes 97 s is
   a click that failed.
2. **A turn above the ceiling becomes an error in a command that worked.** The
   `GenServer.call` exits by `:timeout` in the controller's process, Phoenix
   returns 500, the api becomes 500, and the screen shows an error — while the
   turn keeps running and ends successfully. The kickoffs of the same session
   (which are `cast`, and therefore do not suffer) lasted 7.5 min (PO), 6.6 min
   (Arquiteto) and 8.4 min (Infra): a turn above 120 s is not a hypothesis.
3. **Silent refusal.** A message that arrives with a turn already running
   receives `{:error, :turno_em_andamento}`, which the controller discarded and
   answered 202. In the same session, a *"Continue"* typed 2.5 min into the
   Arquiteto's kickoff was accepted successfully and **never read** — no
   `agent.status: working` after it, no `agent.error`. Worse: the screen left the
   composer free during that kickoff (the accepted handoff arms the strip without
   `streaming`), so it was the natural path.

## Decision

1. **`TurnoAssincrono.iniciar/3` answers the `from` ON ACCEPTING.** With the Task
   up and `agent.status: working` already persisted, `handle_call` returns
   `{:reply, :ok, state}`. The `from` stops traveling in
   `state.turno_assincrono`; `tratar_resultado/2` and `cancelar/1` no longer
   answer anyone. It is the SAME mechanism for the six conversational agents —
   no second path —, and ADR 0086 becomes a particular case: the suspended Dev
   Lead still has no `agent.done`, it is just no longer the only one to answer
   early.
2. **Only the wait leaves the request; the refusal stays in it.** What the agent
   refuses BEFORE bringing up the Task remains synchronous, and now has its own
   status instead of the silent 202:
   - turn already running → **409** (`turno_em_andamento`), and now with a
     durable `agent.error` (origin `politica`) saying the message was recorded
     and not read;
   - Dev Lead with a pending plan in Approvals → **409**
     (`aguardando_aprovacao`, the `agent.error` that already existed);
   - Criativo without a captured business rule → **422**
     (`sem_regra_de_negocio`, idem).
   The api passes those two statuses on as `ConflictException` /
   `UnprocessableEntityException` with the engine's sentence. Validation that was
   already synchronous in the api (409 for an already answered form, 400 for a
   missing answer, 400 of RN-160) does not move.
3. **The api's HTTP status does NOT change.** The routes keep `201 { ok: true }`.
   The body and status always meant "accepted" — what changed is WHEN it
   arrives. Switching to 202 would change the generated contract without changing
   any meaning, and the user's event (`chat.message`, `readiness.confirmed`,
   `architecture.readiness_confirmed`) is written before the answer, so the 201
   remains true.
4. **The turn's failure remains durable, and only there.** Everything that was
   already `agent.error` (crash, invalid format, cancellation, failure narrated by
   the api) still is, with the same origin. What disappears is its mirror in HTTP
   — which was never read: the controller discarded it.
5. **The screen follows the end through the channel, and the safety net changes
   signal.** The web's four callers treated "the call resolved" as "the turn
   ended" (RN-131's safety net against a lost `agent.done`). That signal ceased to
   exist. In its place, `acompanharTurnoPeloLog` (in `lib/session-turno.ts`):
   while the strip is on, every 4 s it reads the tail of the event log and closes
   the turn when the MOST RECENT persisted `agent.status` of the agent in question
   is not `working`. It is reliable because of the ordering of item 1: the new
   turn's `working` is persisted BEFORE the acknowledgment, so an old `idle` is
   never the most recent after it.
6. **Offering the Dev Lead still comes AFTER the Arquiteto's closing turn.**
   `OfferInfraHandoffUseCase` calls `offerInfraHandoff` and then
   `offerDevHandoff`, and the order of the two handoffs in the event log came
   from the wait. Without it, the Dev one would be born before the Infra one.
   `ArquitetoServer` now DEFERS the `:offer_dev_handoff` that arrives with a turn
   running and executes it when the turn closes — by success, failure, crash or
   cancellation, the same set of outcomes in which it was offered before.

## Consequences

- The click's time becomes that of the acknowledgment (record the user's event +
  bring up the Task + persist `working`), and a long turn stops becoming a 500.
  The `GenServer.call` ceiling still exists, but now measures the `handle_call`,
  not the turn.
- **A refusal that was silent becomes a visible error.** Whoever types during a
  turn (including a kickoff) now sees 409 with the reason, and the thread gains
  the `agent.error`. The `chat.message` the api recorded BEFORE asking the engine
  remains in the log — orphaned as before, but now explained. Refusing before
  recording would require the api to ask the engine whether there is a turn, and
  the answer would age before the `POST`; it was not done.
- Story return (`ReturnStoryUseCase`) remains best-effort: a 409 there is logged
  and swallowed like any other failure to notify the PO — the refusal is already
  recorded. The difference is that the `agent.error` now exists.
- The screen's safety net costs one read of the log's tail every 4 s DURING the
  turn — a period in which the screen's 3 s poll is paused (findings 2/7). If the
  engine restarts in the middle of the turn, no `idle` arrives and the strip stays
  on until "Stop" (which closes locally) or a reload: before, the same scenario
  became a 500 on the click. Declared, not solved.
- A message to `infra` through the composer falls into the final clause of
  `AgentCommandController.message/2`, which routes to the Criativo.
  Pre-existing, measured here and NOT fixed — it is another front.
