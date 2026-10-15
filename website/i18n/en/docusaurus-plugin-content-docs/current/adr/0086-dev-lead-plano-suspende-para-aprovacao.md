# ADR 0086 — The Dev Lead's plan suspends the turn for approval

- **Status:** Accepted
- **Date:** 2026-08-16
- **Context:** `docs/fluxo.yml` × code audit (finding A2)
- **Revises part of:** [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)
- **Direct precedent:** [ADR 0052](0052-dev-agent-espera-aprovacao-no-meio-do-laco.md),
  [ADR 0057](0057-o-gate-espera-a-aprovacao.md)

## Context

A read-only audit session cross-checked `docs/fluxo.yml` (the target model
declared by ADR 0085) against the real code
(`docs/explanation/auditoria-fluxo-vs-codigo.md`). Finding A2 found a
high-severity divergence: `fluxo.yml` declares the `dev-lead`'s
`plano-de-paralelismo` output as `via: proposed_action`, but the code
only produced a simple event (`execution.plan_proposed`), with no
approval pipeline at all — a deliberate decision, documented in the
`dev_lead_tools.ex` comment itself at the time:

> The plan becomes an EVENT in the log, not a `proposed_action`. The
> distinction isn't cosmetic: proposing a plan has no external effect at
> all — the spend happens when the agents come up, and that's where the
> RN-083 cap requires authorization. Turning the proposal into an action
> to be decided would make the user decide the same thing twice.

That lesson wasn't wrong on 2026-08-07 ([ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md),
PHASE 14d): the `parallelize`-type `proposed_action` that does exist is
triggered by a USER ACTION in the UI requesting reinforcement above the
cap (`POST /sessions/:sessionId/execution/parallelize`), not by the Dev
Lead's initial plan output. They are two genuinely distinct mechanisms,
and `fluxo.yml` merged them into a single output.

Faced with the divergence, the product owner decided that the CODE is
wrong: the Dev Lead's plan is the FIRST real decision about how much the
session will spend on parallelism — today the user only reads it narrated
in the feed and clicks "Activate execution" separately, with no real
approval in between. The plan now becomes a `proposed_action`, and the
user decides by looking at it, not at a log line.

### Why this is structurally new

The four conversational agents (Criativo, PO, Arquiteto, Dev Lead) run a
SYNCHRONOUS turn via `GenServer.call` of up to 180s, mediated by
`Engine.Agents.TurnoAssincrono` (RN-122) — the `handle_call` stays blocked
waiting for the Task to finish, and the caller (the engine's HTTP route)
waits along with it. The suspend-for-approval pattern already existed
twice:

- the dev agent ([ADR 0052](0052-dev-agent-espera-aprovacao-no-meio-do-laco.md)),
  triggered by `cast` (`work/2`, `correct/3`);
- the QA/Infra gates ([ADR 0057](0057-o-gate-espera-a-aprovacao.md)),
  also triggered by `cast` (`run/2`).

Neither of them had to deal with a pending synchronous `from` — `cast`
has no `from` to respond to. The Dev Lead IS `call`: someone is waiting
for an HTTP response when the turn suspends, and that response needs to
come RIGHT AWAY (so as not to block the route for up to 180s), even
though the turn itself remains pending for much longer than that.

## Decision

**The execution plan is born as a `proposed_action` (type
`propose_execution_plan`), and the Dev Lead's turn SUSPENDS — without
finishing — while it is `pending`.**

### The pieces

1. **`decide.ts` gains the `propose_execution_plan` type**
   (`apps/api/src/domain/actions/decide.ts`), minimum role `maintainer`
   (same tier as `parallelize`: a decision about how much the product will
   spend on parallelism). It is DELIBERATELY left OUTSIDE the absolute-cap
   block (protected merge, `instruction_patch`,
   `parallelize`/`raise_max_parallel`) — it can be configured to
   auto-approve, as already holds for `open_adr_pr`/`open_infra_pr`. The
   semantic difference matters: the absolute caps exist because the
   product refuses to let the user automate the DECISION ITSELF even with
   "always allow" on (`parallelize` is an OVERRUN of a cap already
   authorized, `raise_max_parallel` is the product raising its own
   limit). The Dev Lead's plan is the session's FIRST decision, not an
   overrun — and nothing in this feature calls for a fourth absolute cap.
2. **`Engine.Agents.DevLeadTools.run/2` calls `EngineApiClient.propose_action/5`**
   instead of `append_event/3` (the same client `Engine.Dev.AgentIo`
   already uses), and returns a three-outcome contract:
   `{:ok, text}` | `{:pending, action_id}` | `{:error, text}`. `validar/1`
   continues blocking an empty plan or one with a module lacking an agent
   BEFORE any I/O — unchanged.
3. **`Engine.Agents.DevLeadServer.run_turn/2` stops at the first `:pending`.**
   The `Enum.reduce`/boolean from before becomes `Enum.reduce_while`,
   which HALTS without processing further calls or recursing. The
   returned `state` carries the new `:aguardando_aprovacao` key
   (`%{action_id:, tool_call_id:, tool_name:, remaining:}`) — `remaining`
   already decremented, because the suspended iteration counts against
   the cap once resumed. The `role: "tool"` message is NOT added to
   `state.messages` at this point — recording "pending" there would lie
   to the model that the command already answered it (same reasoning as
   the dev agent).
4. **`Engine.Agents.TurnoAssincrono.tratar_resultado/2` gains a branch.**
   `GenServer.reply(from, :ok)` still happens always, at the same time —
   it's what breaks the synchronous block at the right moment, suspended
   or not. When `:aguardando_aprovacao` is present (checked by VALUE,
   `Map.get/2` truthy — not by key presence, because the Dev Lead carries
   it as `nil` since `init/1`), it calls `suspender/1` instead of
   `finalizar/1`: only `agent.status: awaiting_approval`, no
   `agent.done` — the turn hasn't finished.
5. **`Engine.Sessions.LiveBroadcast.agent_status/4` gains the new status**
   in the guard (`["working", "idle", "awaiting_approval"]`) — without
   this, step 4's `agent.status` wouldn't even be persisted (ADR 0021: it
   is the only event that MUST be durable, not just broadcast).
6. **The resumption.** `DevLeadServer` subscribes to `Engine.Dev.Wake.subscribe(project_id,
   "dev-lead")` in `init/1` — the SAME module `Engine.Gates.QaLeadServer`
   already reuses for QA subagents, despite the "dev" name: delivery of
   `{:action_settled, ...}` is by AGENT, routed by the payload's `agentId`
   (`DevAgentWakeWorker`), not by type. On arrival, a `handle_info` builds
   the `role: "tool"` message with the REAL outcome (`texto_do_desfecho/1`,
   the same vocabulary as the dev agent and `QaLeadServer`), clears
   `aguardando_aprovacao`, and resumes with `TurnoAssincrono.iniciar(state, nil,
   fn -> run_turn(state, pendente.remaining) end)`.
7. **A second `user_message` during suspension does not start a new turn.**
   A guard on `handle_call({:user_message, _text}, _from,
   %{aguardando_aprovacao: %{}})`, tested BEFORE the generic clause, emits
   `agent.error` (origin `politica`) and replies `{:reply, :ok, state}` —
   the HTTP response for that route is already discarded by the engine
   controller for every agent.

### `propose_execution_plan` has no dedicated execute-* pipeline

Unlike `parallelize`/`raise_max_parallel` (which actually DO bring agents
up on approval), approving the plan has no effect to apply — bringing the
agents up remains a SEPARATE act, when the user clicks "Activate
execution." That's why manual approval never leaves `status: "approved"`
(the `action-state-machine.ts` state machine models
`approved -> executed | failed` as open, but nothing calls that
transition, and it shouldn't — there's nothing to execute). The engine
treats `"executed"`, `"auto_approved"`, and `"approved"` equally as
success.

## Consequences

**For**

- Behavior now matches what `docs/fluxo.yml` already declared — finding
  A2's divergence closes without editing the flow.
- The user decides the plan by looking at a real approval (phrase in
  pt-BR, verb, payload — RN-096), not at a feed line they might not read.
- `TurnoAssincrono`'s suspension mechanism becomes generic enough that
  the NEXT conversational agent that needs to suspend doesn't have to
  reinvent anything — it just returns the `:aguardando_aprovacao` key.

**Against**

- **Accepted, declared gap: restart during the wait.** Unlike the dev
  agent (which rehydrates `laco_pendente` via `handle_continue` in
  `init/1`), the Dev Lead does NOT rehydrate `aguardando_aprovacao` — only
  in memory. If the engine restarts while it's suspended, the decision
  remains recorded and visible in Approvals (it's durable in the api), but
  the Dev Lead doesn't narrate the outcome automatically: the process
  that subscribed to `Wake` died, and the next restart brings up a new
  Dev Lead, with no subscription for that action. Closing this would
  require the same persistence mechanism as ADR 0052
  (`dev_lead_states`, or equivalent) — out of scope for this change,
  which only fixes the misalignment between the declared flow and the
  code.
- One extra turn of waiting before "Activate execution" becomes
  available, when the plan isn't auto-approved — the same cost any
  `proposed_action` already imposes, now here too.

## Alternatives considered

**Just fix `docs/fluxo.yml` to match the code (`via: evento`).**
Rejected by explicit decision of the product owner: the divergence wasn't
a documentation error, it was the code not yet having the pipeline that
the product decision (making the user really decide the plan) already
called for.

**Add the type to `decide.ts`'s absolute-cap block.** Rejected — see
the "The pieces" section, item 1. The plan is neither a cap overrun nor
the product raising its own limit; it's the INITIAL decision, and the
user can legitimately want to configure "always allow" for it without
that becoming the same hole the three absolute caps exist to close.

**Don't suspend — keep the simple event, and open a second
`proposed_action` in parallel (fire-and-forget).** Rejected: `fluxo.yml`
declares that the output ITSELF is the proposal, not an event
accompanied by an orphan proposal. And letting the turn continue without
waiting would reintroduce the same flaw ADR 0052 closed for the dev
agent — the model would "learn" the plan was accepted before knowing
whether it was.

## References

- `docs/explanation/auditoria-fluxo-vs-codigo.md` — finding A2, the
  origin of this change
- [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) — creates the Dev
  Lead and the parallelism cap (RN-083) that motivates its existence
- [ADR 0052](0052-dev-agent-espera-aprovacao-no-meio-do-laco.md) — the
  precedent: the dev agent suspends mid-loop, via `cast`
- [ADR 0057](0057-o-gate-espera-a-aprovacao.md) — the second precedent:
  the QA/Infra gates suspend, also via `cast`
- [ADR 0021](0021-fechamento-4a-infra-e-painel.md) — why `agent.status`
  needs to be persisted, not just broadcast
- `apps/engine/lib/engine/agents/dev_lead_tools.ex`,
  `dev_lead_server.ex`, `turno_assincrono.ex`
- `apps/engine/lib/engine/sessions/live_broadcast.ex`
- `apps/api/src/domain/actions/decide.ts`
