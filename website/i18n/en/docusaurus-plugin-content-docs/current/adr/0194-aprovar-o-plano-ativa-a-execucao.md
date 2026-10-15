---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0194 — Approving the Dev Lead's plan activates execution, and the task gains the module it assigns

## Status

**Accepted.** 2026-10-01 (AT-263 and AT-274, epic EP-030, round 36; owner
decisions on 01/10: *"execution activation becomes the APPROVAL of the Dev
Lead's plan; accepting the Dev Lead's handoff only brings it in to plan"* and
*"whoever assigns the task's module is the Dev Lead, when assembling the
execution plan; only that module's dev picks it up"*). Revises, without editing
them, [ADR 0069](0069-fusao-condicional-do-handoff-com-a-ativacao-de-execucao.md)
(the conditional merge of acceptance with activation, RN-161) and the part of
[ADR 0086](0086-dev-lead-plano-suspende-para-aprovacao.md) that said
`propose_execution_plan` has no execution pipeline. Preserves
[ADR 0165](0165-o-repositorio-nasce-no-handoff-ao-arquiteto.md) (the repository
is born on acceptance to the Arquiteto, the Dev Lead's is the second door, and
`execution/activate` without a repository is 409) and
[ADR 0061](0061-tipo-da-sessao-na-criacao.md) (`execution.activated` in a
consultative session is 409).

## Context

Measured on `dev` (d89f777) before changing:

- **Whoever emits `execution.activated`** is only `ActivateExecutionUseCase`,
  and it is only called by the `POST .../execution/activate` route. The
  acceptance backend (`AcceptHandoffUseCase`) never activated anything: it
  provisions the repository when the destination is `arquiteto` or `dev-lead`
  and activates the AGENT. The "activation on acceptance" was the WEB's —
  `handleAcceptHandoff` chained `activateExecution` when the destination was
  `dev-lead` and the workspace role was `maintainer`/`owner` (RN-161).
- **The plan had no consumer.** `propose_execution_plan` is a
  `proposed_action` since ADR 0086 and the Dev Lead suspends waiting for the
  decision, but once approved it stayed `approved` forever:
  `ApproveActionUseCase` had no branch for the type, and the Dev Lead read
  "plan approved and recorded". In the real use of 29/09 execution came up at
  06:45:01, on acceptance; the plan arrived at 06:47:47 and stayed `pending`.
- **The task had no module.** `claimNext` takes the next `todo` task of a
  `ready` story whose `module_ids` (jsonb, several) contains the dev's module.
  With a two-module story, `dev-input-keyboard` took "piece automatic drop loop"
  and `dev-board-engine` took "map keys" (session d7e9, seq 185/187).
- The Dev Lead saw no `task_id`: the kickoff listed only modules and stories,
  taken from its own session's log.

## Decision

1. **The Dev Lead's acceptance does not activate execution**, for any role.
   `handleAcceptHandoff` only accepts; `AcceptHandoffUseCase` does not change
   (it keeps provisioning as the second door). The card's explicit "Activate
   execution" button (RN-137) and the Overview's STAY: they are a gesture of
   their own for whoever decides to skip the plan, and the `execution/activate`
   route keeps all its refusals.
2. **Approving `propose_execution_plan` executes the plan**, in a new executor
   in the api — `ExecuteExecutionPlanUseCase`, in the execution module, next to
   `ExecuteParallelizationUseCase` —, called by manual approval and by
   auto-approval (the type stays OUTSIDE the absolute ceilings of `decide.ts`,
   as ADR 0086 decided). It: rereads the plan against the current `module_map`;
   records the tasks' module; and calls the SAME `ActivateExecutionUseCase` as
   the button, with whoever approved (or, auto-approved, whoever opened the
   session) as the activator. Without `originSessionId`: the Dev Lead's session
   is where it resumes and narrates. The outcome is `executed`
   (`sessaoDeExecucao`, `modulos`, `tarefasAtribuidas`) or `failed` (`motivo`),
   with `execution.plan_applied`/`execution.plan_failed` on the timeline, and it
   is what the Dev Lead reads on resuming.
3. **The task gains a `module` column** (`tasks.module text NULL`, migration
   `0068_modulo_da_tarefa`). The plan carries `tarefas: [{ taskId, modulo }]`,
   validated by a PURE function (`lerPlanoDeExecucao`) against the current
   `module_map` and the project's tasks, TWICE: on proposal (400
   `plano_de_execucao_invalido`, without creating the action — the sentence goes
   back to the Dev Lead as a tool error) and on approval (the map may have
   changed; refusal becomes `failed` without recording anything). The Dev Lead's
   kickoff lists the pending tasks of the PROJECT's backlog (`list_backlog`),
   with `task_id` and the story's modules.
4. **Only the module's dev picks up the task.** `claimNext` and
   `countClaimableByModule` now use a single predicate: `t.module = $modulo`, OR
   a task without a module whose story has exactly ONE module and it is
   `$modulo`.

## Consequences

- **Activation now costs the approval of a valid plan**, and a plan is only
  valid with EVERY cited task assigned to a `module_map` module. A Dev Lead that
  cannot assemble `tarefas` (empty backlog, tasks in another project) activates
  nothing through the new path; the explicit button remains the way out, and is
  declared as such.
- **The bridge for a task without a module is deliberate and narrow.** Without
  it, whoever activates from the Overview without a plan would have no claimable
  task at all; with it restricted to a ONE-module story, the rule "only that
  module's dev" stays true, because there is no other there. A task without a
  module from a multi-module story stays parked until the next plan — and the PO
  does not assign modules, so a task created AFTER the approved plan falls into
  that case. Closing that (the PO assigning, or automatic replanning) is a
  separate decision.
- **The `task.became_claimable` notice is still routed by the STORY's
  modules.** Waking a dev that will pick up nothing costs one query and no model
  spending; routing by the task's module would require touching the notice's
  emitters, out of scope.
- **`agentes` per module stays informative.** Activation brings up one dev per
  `module_map` module, as before; more than one per module still goes through
  `parallelize` (RN-083), with its ceiling.
- **The engine's `propose_action` call stays at Req's default of 15 s** for this
  type. Auto-approved, the api activates execution within the same request
  (seeds instructions and autonomy, calls the engine); a case exceeding 15 s was
  not measured, and if it does the outcome arrives through the timeline even
  with the tool result saying transport error.
- **The screen does not navigate to the execution session** after approving the
  plan (RN-634 did that on the button): the approval is the `ApprovalCard`'s,
  from another front. The Dev Lead says in which session execution came up.
