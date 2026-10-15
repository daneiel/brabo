---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0175 — The Infra Lead converses through the composer, and first its turn goes through `TurnoAssincrono`

## Status

**Accepted.** 2026-09-27 (AT-141). Maintainer decision: **yes** — the Infra
Lead starts conversing through the composer and becomes the SEVENTH
conversational agent. References [ADR 0163](0163-o-clique-responde-ao-aceitar.md)
(the click responds on accept), which this document does NOT edit: what it
decided for the six conversational agents now applies to the seventh, by the
SAME mechanism. Also references [ADR 0038](0038-hierarquia-de-agentes.md) (the
agent hierarchy, lead and subagent) and
[ADR 0086](0086-dev-lead-plano-suspende-para-aprovacao.md) (the Dev Lead
suspension, which the Infra Lead does not have). Rule:
[RN-617](../business-rules.md#rn-617). Closes the open decision that
[RN-584](../business-rules.md#rn-584) left in writing.

## Context

[RN-584](../business-rules.md#rn-584) (AT-098) removed the default recipient of
the chat message and gave `infra` a NAMED refusal (`422 agente_sem_conversa`),
leaving the product question declared: does the Infra Lead converse through the
composer? And it declared the price of answering "yes" without preparation: the
`user_message/2` that `InfraLeadServer` exported ran the ENTIRE turn inside
`handle_call`, with a 180 s ceiling on the `GenServer.call`.

Measured in the code before the change, the Infra Lead was outside ALL the
pieces that [ADR 0163](0163-o-clique-responde-ao-aceitar.md) and the following
RNs gave the other six:

| Piece | The six | The Infra Lead |
|---|---|---|
| Immediate accept, `working` recorded first ([RN-578](../business-rules.md#rn-578)) | `TurnoAssincrono.iniciar/3` | the whole turn in `handle_call`/`handle_cast` |
| Named refusal `409 turno_em_andamento` | yes | the second message waited in the process queue |
| "Stop" ([RN-122](../business-rules.md#rn-122)) | `via_for/2` of `cancel/2` | `via_for/2` did not know it, nor was there a Task to kill |
| Orphan turn on restart ([RN-586](../business-rules.md#rn-586)) | `TurnoOrfao` | "left out — declared in RN-586" |
| Stop on session close ([RN-581](../business-rules.md#rn-581)) | `terminate/2` abandons the Task | killed after 5 s of waiting |
| Narrated iteration ceiling ([RN-166](../business-rules/autenticacao.md#rn-166)) | `toolloop.limit_reached` | the loop ended silently at step 14 |

Also the kickoff: being a `cast`, it held no click, but it occupied the process
for the entire turn — measured on the AT-089 installation, 8.4 min. A message
arriving in the meantime would wait the 8.4 min in the queue and exit with
`:timeout` in the controller (500), and "Stop" would only be served afterwards.

And the ceiling: the `propose_action` of container actions that the api runs
auto-approved waits up to 225 s ([RN-605](../business-rules.md#rn-605)), more
than the 180 s of `user_message/2`. A message leading the model to propose
`container_start` could blow the `GenServer.call` with the proposal still
standing.

## Decision

1. **First the turn, then the clause.** The Infra Lead's THREE turns — kickoff,
   gate correction (`{:correct, _}`) and message — go up through
   `Engine.Agents.TurnoAssincrono`, the SAME module as the six. The kickoff
   stays a `cast`, fired only on the FRESH start of the accepted handoff; what
   changes is where it runs (in a Task). The old `user_message/2`, which ran
   inline, ceased to exist: the name stayed, and now it is the accept — there
   are not two paths.
2. **Consolidation with Workflows runs INSIDE the Task.** The end of the turn
   (`concluir/1`: HALT of `propose_infra_pr` → `WorkflowsAgent` → single PR) is
   part of the turn function and returns the `state`; the end signals
   (`agent.done`, `agent.status: idle`) come only from `TurnoAssincrono`, in
   the server process ([RN-585](../business-rules.md#rn-585)). "Stop" also kills
   the Workflows in progress.
3. **The gate correction is not discarded.** `TurnoAssincrono.iniciar/3`
   without `from` ignores the request when a turn is in progress (the defensive
   kickoff case). For the correction that would lose the gate's request, so it
   enters a QUEUE (`correcoes_pendentes`) and goes up at the turn's close —
   success, failure, crash or "Stop" —, in arrival order. It is the mould of
   the Arquiteto's `handoff_dev_pendente`.
4. **The Infra Lead enters the engine's lists**: `@agentes_de_conversa` and the
   own clause of `message/2` (the RN-584 refusal goes), `via_for("infra")` in
   "Stop", and `TurnoOrfao` (`@agentes`). `Engine.Agents.Conversacionais`
   already listed it.
5. **The iteration ceiling is its own, 14**, the same as Arquiteto, Dev Lead,
   UX Designer and Staff — and step 14 now emits `toolloop.limit_reached`.
6. **The screen offers it by the usual rule.** `infra` enters
   `AGENTES_DE_CHAT` (`apps/web/src/lib/session-readiness.ts`): it is the
   recipient when it is the most recent `agent.activated`, with no default
   recipient ([RN-584](../business-rules.md#rn-584)). The acceptance of ITS
   handoff stays in the own card of [RN-499](../business-rules.md#rn-499), and
   the thread card excludes it by NAME — otherwise the invitation would appear
   twice and, being the oldest, would again hide the Dev Lead's (RN-136).
7. **Conversing does not open external effects.** The tools are the same four;
   the infra PR and the two container start-ups still are born as
   `proposed_action`, with the local refusals of RN-566/RN-577/RN-610 intact.

## Consequences

- **The 180 s ceiling stops mattering for the turn.** The `GenServer.call` of
  `user_message/2` only waits for the accept (milliseconds); the 225 s of the
  container `propose_action` run inside the Task, with nobody waiting
  synchronously. The number 180 000 stayed, equal to the other six, as the
  ACCEPT ceiling.
- **A message during the kickoff is refused by name.** Before it waited; now it
  is 409 `turno_em_andamento`, with the durable `agent.error` — the same rule
  as the other six.
- **The generated list does not change.** `SOLO_CONVERSATIONAL_AGENTS`
  (generated by `pnpm --filter api gerar:areas`) is the list of agents WITHOUT
  an area that a manual handoff addresses; the Infra Lead is an area lead and
  stays out of it. `AGENTES_DE_CHAT` is not generated: it is the list the
  `scripts/ci/destinos-do-composer.spec.ts` guard checks against the clauses.
- **The screen narrates its tools.** The four got a sentence in the activity
  strip (`toolNarration.json`), instead of the fallback.
- **Declared and not closed:** the Infra Lead has no `ask_structured_questions`
  nor backlog reading — conversing with it is conversing with what the kickoff
  gave it and with the usual tools, and widening that is a separate front. The
  message does not rerun the kickoff: an Infra Lead brought back up by a
  message (engine restarted) rehydrates the history and responds, without
  regenerating artifacts.
