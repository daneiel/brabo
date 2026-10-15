---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0143 — Dev agents only after the container

## Status

Accepted — 2026-09-04

## Context

In a real execution of the `exp001` project (2026-09-04), the thread went far:
Gitflow bootstrap, `product_brief`, `module_map` and, at 18:00, the Arquiteto
(Architect) delivering `project_image`, `module_routing` and the C4 diagram. Two
ADRs became PRs, three merges went through. And then **ten dev tasks hung at
once**, all with the same outcome: the dev agent's working tree had nowhere to
be born.

The finding that matters here is not the cause of that specific folder — it is
that **nothing ordered container before dev agent**. No `container_start` was
proposed, and the ten dev agents started anyway, to hang ten times.

There was a second defect, quieter, in the same line of the flow.
[ADR 0134](0134-dev-agents-executam-dentro-do-container.md) (RN-492) made the dev
agent's terminal command cross engine → api → broker and run INSIDE the real
container — **when there was one**. When there was not,
`Engine.Actions.TerminalExecutor.decisao_de_execucao/1` fell into
`:caminho_de_sempre`, that is, `System.cmd` inside the engine process — the same
process that talks to the database, to the api and to every other project of the
installation. The isolation ADR 0134 exists to create held only on the happy
path, and its absence did not refuse: it degraded, and degraded silently.

This ADR closes both halves.

## Decision

### 1. The guard lives in `try_claim`, not only at the HTTP boundary

`Engine.Dev.AgentIo.try_claim/2` — the SINGLE claim point — queries
`Engine.Containers.ProjectContainerLifecycle.running?/1` **before** calling
`claim_task/1`. Without a REGISTERED `running` row in `project_containers`
([ADR 0081](0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md)), the
agent falls into `:idle`, persists and emits `dev.blocked_by_container` —
without calling the api.

The predicate **already existed**: it is the same one `TerminalExecutor` has
queried since ADR 0134. Nothing new was built to answer the question; what
changed was who asks it, and when.

The equivalent gate in the api (`ActivateExecutionUseCase` refusing with 400
without `ciclo?.status === 'running'`) is the sibling PR's decision, and it is
what gives the **warning to the human** at the moment of the click. It does not
replace this guard, because the claim has a path no route covers:
**rehydration**. `Engine.Dev.DevRehydrator` does not cast `:work`; whoever
claims after an engine restart is `DevAgentServer.init/1` →
`finish_restart_recovery/1` → `try_claim/2`, without going through any
endpoint. A gate only at the HTTP boundary would let every rehydrated agent go
back to work without a container — and the restart is exactly the situation in
which nobody is watching.

The guard comes **before** `claim_task/1`, and not after: claiming only to give
it back right away would leave the task marked and without a living owner, which
is the state `AgentIo.block_task/4` exists to never produce.

### 2. `:idle`, and not a new status

The docblock of the `{:error, reason}` clause of `try_claim/2` itself already
recorded the reason, written when a permanent agent hang was fixed in Phase 12b:
*"`:idle` is the only state from which a wake still rescues"*. All the guards of
`handle_info/2` are matched against it — `{:wake, :became_claimable}` requires
`:idle`, `:rearm` requires `:idle_tripped`, `{:gate_resolved, …}` requires a
matching `task_id`.

A `:blocked_by_container` invented here would be a state from which **nothing**
rescues: the agent would stay stopped forever, recreating the symptom Phase 12b
existed to eliminate. Whoever distinguishes "I stopped because the queue
emptied" from "I stopped because there is no container" is the EVENT
(`dev.idle` × `dev.blocked_by_container`), not the status — and the event is
durable, in the RN-059 pattern.

### 3. The wake comes through the outbox, in its own aggregate

A read warns nobody. An agent already stopped in `:idle` would stay stopped
until an unrelated event passed nearby — which is, in practice, "until someone
reactivates the execution by hand".

So `RegistrarTransicaoDeContainerUseCase` publishes: when recording the arrival
at `running`, it adds, **in the same transaction**, a `container.running` outbox
row. `Engine.Outbox.Drain` now drains a third `aggregate_type` (`"container"`,
next to `"session"` and `"task"`), and `Engine.Workers.DevAgentWakeWorker`
delivers the message to the project's agents.

Three choices within that:

- **`aggregateType: 'container'`, and not `'task'`.** The `task` aggregate was
  already drained, and reusing it would cost zero lines in the drain — but the
  event is not about any task. The `graph_projection` of
  [ADR 0099](0099-neo4j-grafo-de-conhecimento-e-templates.md) already
  established that `aggregate_type` is how different consumers do not race each
  other; lying about it to save a line of query ages badly.
- **`aggregateId` is the PROJECT**, not the `project_containers` row: whoever
  consumes wakes agents by project, and the row may have been recreated.
- **`{:wake, :became_claimable}`, the message that already existed.** Its
  semantics is already "there may be work now" — the comment of
  `EngineWeb.ExecutionCommandController.acordar/4` uses it exactly like that for
  execution reactivation, which is also not about a specific task. A new message
  would require a new `handle_info/2` clause in BOTH servers (real and Noop)
  with a guard identical to the existing one, with no different decision to
  make.

The fan-out is per PROJECT (`DevAgentState.list_by_project/1`), not per module:
the container belongs to the project, and the api has no way of knowing which
modules exist on the engine side.

### 4. The terminal stops degrading silently

`decisao_de_execucao/1` gains `:recusar_container_ausente`, mirroring the
`:recusar_nao_verificado`/`:recusar_runner_desconectado` that the `runner` mode
already had since
[ADR 0104](0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md).
It is the same discipline — "the precondition is missing, so it runs nowhere" —
applied to the mode that did not yet have it.

`mounted` enters the **same branch**: with a `running` container, it crosses to
the broker just like `container`; without one, it refuses. Treating it
differently would be arbitrary after `mounted` started actually bringing up a
container.

And the catch-all `_ -> :caminho_de_sempre` shrinks to what it always should
have been alone: **nonexistent project or malformed `project_id`**. No execution
mode falls into it.

The refusal is a normal `failed_result`, never a crash — the same failure
contract as the module's other two refusals.

## Consequences

**A project without a container up stops working, and says why.** That is what
the decision exists to do, not a side effect. It is also why it can only come in
AFTER the changes that give a container to the `mounted` mode: without them, a
`mounted` project is left with no dev agent at all, with the only way out being
the `container` mode.

**Every previous dev agent spec now needs a `running` container.** There are
nine test files in the engine, and the change was one setup line in each
(`Engine.DataCase.container_running!/1`) — not a module swappable by config. It
was a choice: a production seam that existed only so the suite would not fail
would make the guard inert precisely where it is exercised.

**One question, two places that ask it.** `AgentIo.try_claim/2` and
`TerminalExecutor.decisao_de_execucao/1` both call the same
`ProjectContainerLifecycle.running?/1`. They are not two derivations: it is one
function, with two callers, answering different questions ("can I start?" and
"where does this run?").

**The wake delivery remains at-most-once**, like all of `Engine.Dev.Wake` (its
moduledoc has declared this since Phase 12b). If the agent is momentarily down
when the broadcast happens, it stays `:idle` until the next event — including a
manual reactivation of the execution, which delivers the same
`{:wake, :became_claimable}`.

**REGISTERED `running` is still not OBSERVED `running`**
([RN-486](../business-rules.md#rn-486)). A container that died from outside
still passes this guard; the agent claims, and the failure shows up on the first
call to the broker, as a normal command failure. Merging the two would require a
network call per claim, and RN-486 is explicit about not merging them.

## References

- [ADR 0081](0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md) — the
  `project_containers` table and the state machine
- [ADR 0134](0134-dev-agents-executam-dentro-do-container.md) — the terminal
  command inside the container; this ADR is what makes it land
- [ADR 0135](0135-portao-de-imagem-nos-tres-modos.md) — the image gate now
  applies in all three modes
- [ADR 0137](0137-o-runner-sobe-o-container-do-projeto.md) — `mounted`/`runner`
  bringing up a container on the user's machine
- [RN-502](../business-rules.md#rn-502)
