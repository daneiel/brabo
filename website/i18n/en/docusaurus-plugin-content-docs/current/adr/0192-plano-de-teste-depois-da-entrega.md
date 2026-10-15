---
traducao_de: 89cbb17db55cf80033647930d80fa91cf9fecfd6
---

# ADR 0192 — The test plan is born after the dev's delivery, and the `implementavel` gate starts judging itself on the story and the `module_map`

## Status

**Accepted.** 2026-10-01 (AT-269, story HS-069, epic EP-030, round 35; owner
decision on 01/10: *"QA only after the dev's delivery"* — the activity's exit
(b), chosen knowing it contradicts ADR 0090). Revises part of
[ADR 0090](0090-qa-estrategia-e-appsec-segundo-momento.md) without editing it:
QA-strategy is still the `qa-lead` at a second MOMENT, without a new agent, but
the moment moves — it leaves design (PRE-DEV) and goes to the start of the
delivery review cycle. Appsec, the other half of 0090, does NOT change.

## Context

### The symptom

Real use of 29/09 (analysis `analise-uso-real.md`, item A23): two rounds of
`toolloop.limit_reached` 8/8 followed by `agent.error` origin `modelo`,
"limite de iterações atingido sem emit_plano_de_teste" (session `be70`,
seq 373/374 and 463/464). The loop spent the eight iterations reading docs, an
empty RAG and folders (seq 375–463), and seq 454 states the reason in text:
*"O código ainda não existe"*. The Dev Lead never got an assessment.

### What the code did (measured on `dev`, 2026-10-01)

- **Who opens the gate.** `implementavel` (`docs/gates.yml`) belongs to
  `dev-lead`, `fluxo: pre-dev`, `severidade: warn`, `aprovacao_humana: true`,
  evidence in the event log (`proposed_action.*` filtered by
  `actionType: assess_implementability`). It is opened by the
  `assess_implementability` tool (`Engine.Agents.DevLeadTools.run_assessment/2`),
  which the Dev Lead's kickoff presents as OPTIONAL ("use judgment").
- **What it judged.** `run_assessment/2` read the session tail; without the
  story's `artifact.plano_de_teste`, it called
  `Dispatcher.run_qa_estrategia/3` → `QaLeadServer.run_design/3` →
  `QaEstrategiaAgent.run/4` and returned `{:error, "chame de novo em
  instantes"}`; with a plan, it proposed the assessment (`implementavel`/
  `inviavel` + justification) with `planoDeTeste` and `criteriosExecutaveis`
  embedded in the payload. The input was the plan; the JUDGMENT was already the
  Dev Lead's.
- **QA-strategy's context.** `QaEstrategiaContext.fetch/3` gave story +
  `module_map`, no worktree; `ReadFile`/`SearchWorkspace` fell into the
  project's shared checkout. `EmitPlanoDeTeste` only accepts after a read — so,
  with no code to read, the model searches until the ceiling.
- **The ceiling.** `"qa-estrategia"` falls into the `:conversacional` default
  (8) of `Engine.Harness.Iteracoes`, on purpose (ADR 0090: without
  `token_budget_micros` underneath, raising the ceiling would multiply the worst
  case).
- **Who depends on the verdict.** Nobody in the code. No api use case nor engine
  module reads the `assess_implementability` decision: execution activation does
  not check it, no other gate has it as `entrada`, and the only consumer is the
  screen (the sentence in `apps/web/src/lib/aprovacoes.ts`). The gate is `warn`:
  passing is evidence, not a lock.
- **The later gate.** `qa-verificada` (`block`, owner `area-qa`) runs in
  `QaLeadServer.run/2` over the dev's worktree: `ContextBuilder.fetch/3`,
  delegations (Automation always, Performance/Security per NFR) and ONE
  consolidated `qa_verdict`. Automation builds the `coverageMatrix` from the
  story's rules (FR + NFR) and only approves with a green suite and every rule
  covered.

## Decision

1. **The test plan is the first step of the `qa-verificada` cycle.**
   `QaLeadServer.run_area/3`, after `ContextBuilder.fetch/3` and before the
   delegations, gets the DELIVERY's plan:
   - it finds again in the session tail (rehydration ceiling, RN-580) the
     `artifact.plano_de_teste` of the SAME `taskId` — the correction round
     (RN-015) does not pay another loop;
   - if there is none, it runs `QaEstrategiaAgent.run/6` synchronously, in its
     own process (the agent never suspends), with the
     `dev_state`/`dev_context` the subspecialties receive: `workspace_root` =
     the dev's worktree, the business rule units, and the list of files the
     delivery touched (`Engine.Gates.Diff`, `git diff dev...HEAD`, up to 40
     names) in the first message. A diff that fails becomes text ("couldn't
     list: reason"), never an empty list.

   The plan enters the `dev_context` as `:plano_de_teste`, and Automation
   receives it AT THE END of its message, as input to step 2 ("which test covers
   each rule"). **The verdict's rule does not change**: one `coverageMatrix` row
   per story rule, `approved` only with a green suite and every rule covered.
   The external contract is still ONE `qa_verdict` per cycle.

2. **A plan that fails does not hold the review.** QA-strategy already records
   `agent.error` with origin (RN-059); the Lead goes on without a plan, and
   Automation's message is the previous one, byte for byte. Making the plan's
   failure block the task would be a new lock in a `block` gate because of a new
   input — that was not decided, and the owner's decision is about WHEN the plan
   is born, not about it failing deliveries.

3. **`implementavel` judges itself on the story and the `module_map`.**
   `assess_implementability` neither reads nor triggers a plan: the input becomes
   what the Dev Lead ALREADY has in the turn's context — its kickoff lists the
   modules of the current `module_map` and the backlog stories (FR, NFR, DoD) —,
   and the judgment goes in the `justificativa`. The assessment comes out on the
   FIRST call; the payload loses `planoDeTeste`/`criteriosExecutaveis`. The gate
   still exists, with the same owner, severity, human approval and evidence —
   only the `entrada` changes (`[story-ready, module_map]`). No new gate.

4. **What goes away.** `QaLeadServer.run_design/3`,
   `Dispatcher.run_qa_estrategia/3` (and the callback) and `QaEstrategiaContext`
   — without a caller after item 3, they would remain triggerable for a moment
   the owner's decision retired.

5. **The artifact changes shape.** `artifact.plano_de_teste` now requires
   `taskId` (`Engine.Harness.ArtifactSchemas`): it is the plan of ONE delivery,
   and it is through it that the Lead finds it again.

6. **The ceiling STAYS 8.** `"qa-estrategia"` gets no clause in
   `Iteracoes.tipo/1`. What was missing was input, not slack: with the code
   existing and the delivery's files in the message, two or three reads suffice.
   What changed on the spending side is that there is a task now, and the agent
   runs under the `task_budget_micros` the subspecialties share (RN-036) —
   RN-085's criterion would even allow the gate ceiling with that budget
   underneath, and the decision is NOT to use that door for the plan to pass.

7. **`docs/gates.yml` and `docs/fluxo.yml` change because who delivers what to
   whom changed**: `qa-verificada` gains `plano-de-teste` in its `entrada`;
   `implementavel` swaps `plano-de-teste` for `module_map`; in `fluxo.yml`,
   `qa-estrategia` now receives the delivery from `dev` and delivers to
   `area-qa`, with `gate_saida` `qa-verificada` (input, not its own verdict), and
   `dev-lead` stops receiving the test plan.

## Consequences

**For**

- The real-use symptom loses its cause: the plan is no longer asked of an agent
  at a moment when what it needs to read does not exist.
- The Dev Lead has the assessment on the first call, without the asynchronous
  callback-less window ADR 0090 declared as its price (it depended on the MODEL
  deciding to call again).
- The plan is now written over the real code, with worktree and diff, and is
  consumed by whoever verifies — `qa-verificada` —, in the same process and the
  same cycle. Zero routes, zero tables, zero new GenServers; three fewer pieces.
- The plan now has a budget underneath (the task's).

**Against**

- **`implementavel` becomes shallower.** Before there was a second look (QA) at
  the story before spending tokens writing code; now the assessment is only the
  Dev Lead's, on the story and the `module_map`. It is the direct price of the
  owner's decision, and the gate was `warn` and optional — but the QA
  "shift-left" ADR 0090 bought ceases to exist for QA (appsec stays in design).
- **One more LLM loop per DELIVERY**, on the review's critical path: Automation
  only starts after the plan. Per task, not per round (reuse by `taskId`); in a
  long session the plan may have left the 200-event window and is written again
  — cost, never wrong data.
- **The plan competes for the same task budget** the review uses: an expensive
  delivery may reach Automation with less slack.
- **The plan is input, not a rule.** Whether the plan's executable criteria
  should become mandatory `coverageMatrix` rows (and therefore fail deliveries)
  is a product decision this ADR does NOT take.
- **Ceiling 8 can still blow** on a large delivery; then the outcome is the
  narrated `agent.error` and the review goes on without a plan. Measuring this in
  the next real use is what would say whether 8 is enough.
- The translated pt-BR of `docs/fluxo.yml` (`website/i18n/…`) was already behind
  the original before this change, and stays behind (AT-209).

## Alternatives considered

**Exit (a): keep the plan in design, from story, rules and `module_map`, without
exploring code, with `emit_plano_de_teste` required early.** It did not
contradict 0090 and was the cheapest fix of the symptom. Refused by the owner
(01/10) in favour of (b).

**Raise the `qa-estrategia` ceiling to 60.** Refused by the activity and by this
ADR: it would make the plan pass by spending more, at a moment when there is
nothing to read.

**A new gate for the plan (`plano-de-teste-pronto`) after delivery.** Refused: a
new gate is a product decision with its own ADR, it would change the external
contract (one more verdict per PR) and the plan has nothing to veto alone — the
coverage verdict already belongs to `qa-verificada`.

**Trigger QA-strategy asynchronously on delivery (`cast` from
`DevAgentServer`), in parallel with the review.** Refused: Automation would start
before the plan existed, which is the race this design exists to avoid; and the
result would again depend on an event nobody waits for.

**Retire `implementavel`.** Refused: nobody asked; the gate still has something
to judge (the story and the `module_map`) and is still the measurable record
that someone thought about the story before the code.

## References

- [ADR 0090](0090-qa-estrategia-e-appsec-segundo-momento.md) — the second moment
  of `qa-lead` and secops; this ADR changes the first one's moment
- [ADR 0054](0054-gates-como-registro-declarativo.md) — the gates' external
  contract
- [ADR 0085](0085-fluxo-como-registro-declarativo.md) — `docs/fluxo.yml`
- RN-674 (`docs/business-rules.md`), RN-340/341 (revised by it), RN-085,
  RN-036, RN-163, RN-580
- `apps/engine/lib/engine/gates/qa_lead_server.ex`,
  `qa_estrategia_agent.ex`, `qa_automacao_agent.ex`, `dispatcher.ex`;
  `apps/engine/lib/engine/agents/dev_lead_tools.ex`;
  `apps/engine/lib/engine/harness/artifact_schemas.ex`
