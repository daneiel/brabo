---
traducao_de: 51f6ee68bba3a758faecd802cc3b04861656fdc6
---

# 0191 — A message arriving during a turn enters a persisted queue and is read at the end of the turn

## Status

**Accepted.** 2026-10-01 (AT-267, owner decision of 01/10). Revises, only for
the user's MESSAGE, the synchronous `turno_em_andamento` refusal of
[ADR 0163](0163-o-clique-responde-ao-aceitar.md). ADR 0163 is not edited: the
immediate acceptance it decided still holds, and the named refusal still holds
for commands that are not speech (the PO's story review, the Criativo's
readiness, the Arquiteto's handoff offer). Rule:
[RN-673](../business-rules.md#rn-673).

## Context

Since ADR 0163 a message arriving at a conversational agent in the middle of a
turn was refused with 409 `turno_em_andamento` and a durable `agent.error`. That
closed the silence — before, the 409 was a silent 202 —, but not the defect: the
api records the `chat.message` BEFORE talking to the engine
(`SendAgentMessageUseCase`), so the message stayed in the thread looking said and
never reached the model. The screen asked "send it again when it finishes".

The real use of 2026-09-29 (session `be70`) measured three of these on the same
day, one per agent: seq 100 (PO, 06:28), seq 268 (Infra Lead, 06:39 — "infra
ainda está executando") and seq 312 (Dev Lead, 06:46 — "ok"). All three are
recorded as `chat.message` and none was read. Reproduced in this tree's code:
`TurnoAssincrono.iniciar/3` answered `{:error, :turno_em_andamento}` with `from`
and a turn in progress, and `AgentCommandController.responder_ao_aceite/2`
converted it into 409 — the `agent_command_controller_test.exs` test ("turno já
em curso: 409 nomeado") pinned exactly that outcome.

The only queue precedent was the Infra Lead's (`correcoes_pendentes`, RN-617):
IN MEMORY, for gate correction, never for user speech — and lost on an engine
restart.

The owner's decision (01/10), which is the requirement:

1. a message arriving during a turn enters a **persisted** queue that survives
   restart;
2. **N messages = 1 turn**: at the end of the turn in progress, the pending ones
   are read together, in order, in a single turn;
3. **each one can be cancelled** while pending, by whoever sent it, with the
   minimum role the message route already requires;
4. **ceiling of 10** pending per agent and session, and above that a named
   refusal;
5. it applies to the SEVEN conversational agents through the same path
   (`TurnoAssincrono`), never per server.

## Decision

**The queue lives in `TurnoAssincrono`, and its state lives in the event log.**

- `TurnoAssincrono.receber_mensagem/4` replaces the direct `iniciar/3` in the
  seven `handle_call({:user_message, …})`. With no turn and no queue, it starts
  the turn as always (`:ok`, 202). With a turn in progress and the queue below
  10, it enqueues, records `chat.message_queued` and answers
  `{:ok, :enfileirada, posicao}` — 202 too, with the body
  `{entrega: "enfileirada", posicao}`. With the queue at the ceiling,
  `{:error, :fila_de_mensagens_cheia}`: named 409 and durable `agent.error` (the
  message is recorded and will NOT be read — the same honesty ADR 0163 required
  of the old refusal).
- **The server only says how speech becomes a turn.** Each of the seven now has
  `turno_de_mensagem/2` (the same assembly the `handle_call` did inline) and the
  guard in the state (`:montar_turno_de_mensagem`). `TurnoAssincrono` decides
  WHEN; the server, HOW. No server got its own queue.
- **At the end of the turn — `finalizar/1`, never `suspender/1` — the queue
  becomes ONE turn.** Delivery is a message to itself
  (`:entregar_fila_de_mensagens`), not a call inside the close, because the
  server still has its own close in the same `handle_info` (the Infra Lead
  drains the gate correction, the Arquiteto the handoff to the Dev Lead) and must
  not find a queue turn already up. The pending ones become a single text
  (`FilaDeMensagens.texto_do_turno/1`: one is itself; several, numbered in
  order, with a line saying they are several), and `chat.message_delivered`
  lists the ids. The turn's language is that of the author of the MOST RECENT
  message (RN-622). The queue that matters is the CURRENT state's, never the
  Task result's, which captured the state at the start of the turn.
- **A message arriving between the end of the turn and delivery goes to the END
  of the queue**, and the whole queue is delivered at once — the newest never
  jumps ahead of those waiting.
- **Three immutable events, all with the `chat.message` id.**
  `chat.message_queued` (agent; `mensagemId`, `texto`, `idioma`, `posicao` — the
  text goes along because it is what the queue needs to reread after a
  restart), `chat.message_delivered` (agent; `mensagemIds`) and
  `chat.message_cancelled` (actor `user`, who cancelled; `mensagemId`,
  `agente`). Pending is enqueued and neither delivered nor cancelled — the same
  derivation in the engine (`FilaDeMensagens.pendentes/2`) and on screen
  (`estadosNaFila`). No table.
- **Restart.** The seven's `init/1` rebuilds the queue from the log
  (`TurnoAssincrono.fila_ao_subir/3`) and schedules delivery; `Reidratacao`
  removes from history the cancelled one (it was never said) and this agent's
  pending one (it will arrive via the queue turn — otherwise it would come in
  twice). At boot, after closing the orphan turn (RN-586), the `Rehydrator` wakes
  the agent that has a pending queue (`FilaDeMensagens.acordar_pendentes/2`):
  without this the queue of whoever was mid-turn when the engine went down would
  wait for someone to write again. The interrupted turn is still NEVER redone —
  what is read is the message no turn read.
- **Cancelling.** `POST …/agents/:agent/messages/:messageId/cancel`
  (`developer`, the same as the message route). The api checks that the message
  is a `chat.message` of this session, that its actor is the caller (403
  `mensagem_de_outra_pessoa` otherwise) and that the session accepts
  conversation (RN-581). Whoever decides whether it is still in the queue is the
  agent's process, which serializes the race with delivery: 409
  `mensagem_fora_da_fila` when it was already read or cancelled. With the agent
  down there is no in-memory queue — the queue is the log — and the engine
  records the cancellation directly.
- **A turn suspended on approval (Dev Lead, RN-284) keeps refusing**, with
  `aguardando_aprovacao`. Using the same queue was considered and refused: the
  suspended turn has no foreseeable end (it depends on a human deciding in
  Approvals), and enqueueing would promise reading "at the end of the turn" with
  no end in sight. A message already in the queue when the turn suspended waits
  for the RESUMPTION to finish — delivery skips the suspended state.
- **The screen.** The composer stops locking during the turn when the message
  goes to an agent: the button becomes "Queue", the message does not arm a new
  turn (the one in progress stays the one followed) and appears in the thread
  with the badge "in <agente>'s queue" and, for whoever sent it, the cancel
  button. A cancelled one is struck through. Chat without an agent (SSE) keeps
  locking: there is no queue there.

## Consequences

- **The `turno_em_andamento` refusal did not go away.** It remains for story
  review, readiness and handoff offer, which call `iniciar/3` with `from`.
  Whoever reads ADR 0163 alone will think the message is still refused; RN-578
  points here.
- **The message text is in the log twice** when it enters the queue (in the
  `chat.message` and in the `chat.message_queued`). Accepted cost: without it, a
  queue whose `chat.message` left the 200-event window could not be rebuilt.
- **Reading the queue in `init/1` is one more query per agent start-up** (by
  type, with ADR 0060's ceiling of 200). More than 200 queue events in a session
  would make the rebuild see only the most recent ones — declared, not measured;
  the ceiling of 10 pending makes it unlikely, not impossible.
- **Waking at boot spends tokens without anyone clicking** — on behalf of
  messages the user sent and no turn read. It is the deliberate difference from
  RN-586, which does not redo the turn: the interrupted turn may have had an
  effect; the pending message, none.
- **Cancelling with the agent down has a window:** the agent may be starting
  (reading the queue from the log) at the same instant the cancellation is
  recorded. There is no lock; the message may be read. Declared.
- **Messages to another agent with a turn in progress on screen.** The screen
  follows one turn at a time; sending to an IDLE agent while another works starts
  its turn (`entrega: lida`) and the screen starts following it through the log.
  The recipient selector stays locked during the turn, as before.
- **Closed session.** The agents stop (RN-581) and the queue dies with them; the
  message that was pending stays "in the queue" in the log forever, and the
  screen does not offer cancelling in an inactive session. If the session is
  reopened (ADR 0183) and the agent starts again, its `init/1` delivers the queue
  — an accepted consequence, not designed separately.
- **Only CI proves the engine.** In this tree `repo.hex.pm` answers 403 and the
  ExUnit suite does not run locally; the new tests
  (`fila_de_mensagens_test.exs`) and the adjusted ones were written against the
  existing fakes and verified only by parser and formatter.
