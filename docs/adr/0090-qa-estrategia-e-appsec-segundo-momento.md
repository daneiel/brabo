# ADR 0090 — QA-strategy and AppSec as a second MOMENT, not a new agent

- **Status:** Accepted
- **Date:** 2026-08-17
- **Context:** conscious decision of the product owner to anticipate the
  trigger — not "the natural trigger" `docs/fluxo.yml` foresaw
  (`hoje_absorvido_por` + `criterio_de_separacao`), but the actual work of
  building the thing that connects the gate
- **Activates:** the `implementavel` gate (`docs/gates.yml`,
  `status: planned` since PHASE 14d)
- **Revises part of:** [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)
  (which declared the `implementavel` gate as `planned`)
- **Direct precedent:** [ADR 0038](0038-hierarquia-de-agentes.md) (the QA
  area — Lead + subspecialties), [ADR 0085](0085-fluxo-como-registro-declarativo.md)
  (`docs/fluxo.yml`, which already foresaw both roles as `proposto`)

## Context

`docs/fluxo.yml` (ADR 0085) registers two target-model roles as
`proposto`, each with the separation criterion written into the file
itself:

> **qa-estrategia** — hoje_absorvido_por: area-qa (which only acts
> AFTER, on the PR). criterio_de_separacao: When the `implementavel` gate
> activates — the test plan is its input. It can be the qa-lead itself in
> a second MOMENT, not necessarily a new agent: the separation is of
> deliverable.
>
> **appsec** — hoje_absorvido_por: secops (which only acts on the PR).
> criterio_de_separacao: Same pattern as QA: two MOMENTS, not two agents
> for now. Threat model at design time activates when the `implementavel`
> gate exists. A separate agent only with real production.

The declared trigger ("when the `implementavel` gate activates") never
fired organically — nothing in the product needed it yet. The product
owner decided to anticipate: the trigger **is** the actual work of
building the mechanism that connects the gate, not a usage symptom
waiting to happen.

This delivery covers **qa-estrategia** in full. **appsec** remains
`proposto`, under the SAME doctrine (two moments, not two agents), with
the implementation in a separate round — the pattern and the decision are
one and the same, described here; `appsec`/`threat-model` code is left
for when that round runs.

## Decision

**QA-strategy is the `qa-lead` in a second MOMENT — the same process, a
separate deliverable.** No new agent, no new GenServer with its own name
on the roster. `Engine.Gates.QaLeadServer` gains an ADDITIVE entry point,
`run_design/3`, alongside the usual `run/2` (PR review):

### The pieces

1. **`Engine.Gates.QaEstrategiaContext.fetch/3`** — LIGHT context: just
   the story (from `EngineApiClient.list_backlog/1`, the tree the PO
   already reads since [RN-164](../business-rules/autenticacao.md#rn-164)) and the
   current `module_map` (from `EngineApiClient.get_infra_context/2`, the
   SAME `GetInfraContextUseCase` the Infra Lead consumes, here only via
   the `moduleMap` field) — NO `dev_state`, NO `worktree_path`. No new
   api route: both functions already existed, and the `implementavel`
   gate runs PRE-DEV — there's no dev agent, worktree, or `task_id` yet.
2. **`Engine.Gates.QaEstrategiaAgent`** — a STATELESS module (not a
   `GenServer`), the same FORM as
   `Engine.Gates.QaPerformanceSegurancaAgent`: a tool registry WITHOUT
   `Terminal` (`ReadFile`, `SearchWorkspace`, `EmitPlanoDeTeste`), running
   the harness's generic `ToolLoop`. None of the three tools go through
   `Engine.Harness.Hooks.ActionPipeline` (only `terminal`/`write_file`
   do) — this agent NEVER suspends, and `run_design/3` runs
   synchronously inside `handle_cast` itself. It emits
   `artifact.plano_de_teste` (schema validated in
   `Engine.Harness.ArtifactSchemas`) into the event log of the session
   that called it.
3. **`Engine.Gates.QaLeadServer.run_design/3`** — `GenServer.cast`, same
   style as `run/2`, WITHOUT `DevAgentState.find_by_task_id`. Called
   through `Engine.Gates.Dispatcher.run_qa_estrategia/3` (the SAME
   test-swappable indirection `run_qa/2`/`run_secops/2` already use — it
   avoids bringing up a real GenServer in a light test).
4. **`Engine.Agents.DevLeadTools.assess_implementability`** — a new Dev
   Lead tool. Reads the most recent `artifact.plano_de_teste` for the
   story from the Dev Lead's OWN session history:
   - **no plan yet** — triggers `Dispatcher.run_qa_estrategia/3` and
     returns `{:error, text}` asking to try again. A tool error is INPUT
     to the loop, not the end of the line
     ([RN-163](../business-rules/autenticacao.md#rn-163)) — the Dev Lead has 14
     iterations to try again once the plan exists;
   - **with plan** — builds the verdict (`implementavel`/`inviavel` +
     justification, with the test plan embedded in the payload) and
     calls `EngineApiClient.propose_action/5` with
     `"assess_implementability"`, the SAME three-outcome pattern as
     `propose_execution_plan` ([RN-284](../business-rules.md#rn-284),
     ADR 0086).
5. **`decide.ts`** gains `assess_implementability`, minimum role
   `maintainer`, DELIBERATELY outside the absolute-cap block — same
   reasoning as `propose_execution_plan`: it's an initial session
   decision, not an overrun of an already-authorized cap.
6. **`docs/gates.yml`**, `implementavel`: `status: planned` → `active`,
   with `evidencia` pointing to the event log
   (`proposed_action.created` filtered by
   `actionType: assess_implementability`). `severidade` remains `warn` —
   untouched; the record already said "born warn even once active."

### Why the iteration cap gained no new clause

`Engine.Harness.Iteracoes.tipo/1` classifies an unknown agent as
`:conversacional` (cap 8). `"qa-estrategia"` falls under that default,
and it's the RIGHT call — not a gap. The criterion in
[RN-085](../business-rules/custo.md#rn-085) isn't "who works a lot": it's
"what holds the spend back beyond the iteration cap." This agent runs
WITHOUT `token_budget_micros` (there's no task, it's PRE-DEV), the same
situation as `infra-workflows` — which also stays at 8 even while using a
tool, because raising the cap without a budget underneath would multiply
the worst case with nothing to contain it.

## Consequences

**For**

- Behavior now matches what `docs/fluxo.yml` already declared — the same
  class of fix as ADR 0086 (closing the divergence between the declared
  flow and the code), except here the "code" had never existed at all.
- The deliverable separation proves itself with no new infrastructure
  cost: zero new GenServer, zero new HTTP route, zero table.
- The `implementavel` gate gains measurable evidence in the event log,
  same spirit as ADR 0054 — the recorded decision is what makes the
  gate's passage measurable.

**Against**

- **The waiting window between "I triggered the evaluation" and "the plan
  exists" is asynchronous and has no callback.** The Dev Lead only finds
  out the plan is ready when the MODEL decides to call
  `assess_implementability` again — there's no automatic resumption
  (unlike ADR 0086's suspend-for-approval, which IS event-driven).
  Accepted because `Engine.Gates.QaEstrategiaAgent` runs in a separate
  process (`qa-lead`) and the Dev Lead can't block a synchronous
  `run_turn/2` waiting on a result from ANOTHER process without coupling
  the two — and the cap of 14 iterations gives enough slack for the model
  to try again within the SAME turn.
- **`appsec` remains `proposto`.** This delivery doesn't resolve the
  second role declared in the same `docs/fluxo.yml` block — a conscious
  scope decision, recorded here so the next round can reuse the SAME
  pattern without reopening the decision.

## Alternatives considered

**A new `qa-estrategia` agent, its own GenServer.** Rejected: `docs/fluxo.yml`
itself already argued against it — "not necessarily a new agent: the
separation is of deliverable." A new GenServer would duplicate the QA
area's `Wake`/`Registry` wiring for no gain, since this path never
suspends and doesn't need the resumption machinery that justifies a
dedicated process.

**`assess_implementability` blocks waiting for the test plan (a fully
synchronous call).** Rejected — it would require the Dev Lead to call
`QaEstrategiaAgent.run/4` directly, in its OWN process, and run the
QA-strategy `ToolLoop` INSIDE the Dev Lead's turn. Technically possible
(neither toolloop suspends), but it couples the two agents — a read
error in QA-strategy would bring down the Dev Lead's whole turn, and one's
iteration cap would start eating into the other's. Keeping the processes
separate, with the result passing through the event log, is the SAME
design all api↔engine communication already uses.

**Reuse `Engine.Dev.ContextBuilder.fetch/3`** (the builder
`QaPerformanceSegurancaAgent` already uses) **instead of a new builder.**
Rejected: that builder is keyed by `task_id` — it assumes a dev agent,
worktree, and code already committed to a branch. Forcing a fictitious
`task_id` for a PRE-DEV evaluation would invert the order the gate exists
to guarantee (evaluate BEFORE burning tokens writing code).

## References

- `docs/fluxo.yml` — roles `qa-estrategia` (now `active`) and `appsec`
  (remains `proposto`)
- `docs/gates.yml` — `implementavel` gate (now `active`)
- [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) — declared the
  `implementavel` gate as `planned`
- [ADR 0038](0038-hierarquia-de-agentes.md) — the QA area (Lead +
  subspecialties), the structural precedent for this design
- [ADR 0086](0086-dev-lead-plano-suspende-para-aprovacao.md) — the
  three-outcome `proposed_action` pattern `assess_implementability`
  repeats
- `apps/engine/lib/engine/gates/qa_estrategia_agent.ex`,
  `qa_estrategia_context.ex`, `qa_lead_server.ex`, `dispatcher.ex`
- `apps/engine/lib/engine/agents/dev_lead_tools.ex`, `dev_lead_server.ex`
- `apps/api/src/domain/actions/decide.ts`
