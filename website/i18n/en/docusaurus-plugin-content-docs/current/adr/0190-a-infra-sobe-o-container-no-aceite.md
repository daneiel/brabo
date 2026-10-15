---
traducao_de: a6158ee3620a338091376dafb0ce4c4e3b04436c
---

# 0190 — Infra brings up the container on handoff acceptance, as a server step and with seeded autonomy, and it is Infra that hands over to the Dev Lead

## Status

**Accepted.** 2026-10-01 (AT-260, story HS-065, epic EP-030, round 35; owner
decision on 01/10: *"`container_start` is born seeded `auto_approve` on
acceptance of the Infra handoff, and the server triggers the start-up on its own
when there is `module_routing`, without depending on the model"*). Revises the
sentence *"never seeded for auto-approval"* of
[ADR 0133](0133-infra-elege-imagem-do-roteamento.md) (RN-491) and relies on the
containers page of [ADR 0136](0136-pagina-global-de-containers.md) without
editing either: the election path, the ceilings and the refusals they set
remain; what changes is WHO triggers the first start-up and whether it waits for
a click.

In the same round, and by the same 01/10 decision (AT-262, RN-672): *"the Dev
Lead is offered by Infra, only with the container `running`; the Arquiteto's
double handoff goes away"*. That changes the relationship between roles that
[ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) set (the Dev Lead is born
from the Arquiteto) and that [ADR 0085](0085-fluxo-como-registro-declarativo.md)
recorded in `docs/fluxo.yml`, without editing them — decision 7 below.

## Context

Measured in the `dev` code on 2026-10-01, before changing:

- In the real use of 29/09 (session `be70`) Infra wrote that it would bring up
  the container "in parallel" with the infra PR (seq 282) and did not call
  `propose_container_start`; the only attempt was `container_start_via_runner`
  (seq 280), refused by mode (`mounted`). The container only came up at
  06:47:53, by a human on `/containers`.
- The start-up depended entirely on the model: the Infra Lead's kickoff
  (`build_kickoff`) asked for the election in step 4, and nothing in the code did
  it if the model did not. AT-264 (RN-668) had already closed both halves of the
  SILENCE — the whole batch of the response is dispatched before the PR's HALT,
  and the turn's close says, with a server sentence, when the start-up was NOT
  proposed —, but it left declared that the start-up as a server step was this
  activity. What RN-668 promises ("was not proposed") was true, but it was the
  common outcome.
- The card text said the kickoff made the start-up optional ("before, after, or
  never", `infra_lead_server.ex:955-961`). **It no longer reproduces**: RN-668
  rewrote step 4 ("it only happens if it is called BEFORE it or in the SAME
  response"). The rest reproduces.
- Acceptance of the Infra handoff seeded TWO autonomies (`INFRA_AUTONOMY_SEEDS`
  in `accept-handoff.use-case.ts`): `open_infra_pr: auto_approve` and
  `terminal: deny`. `container_start` stayed `require_approval` by default —
  `maintainer` in `decide.ts`, OUTSIDE the absolute ceilings block and PROVEN
  able to reach `auto_approve` through `agent_autonomy` (`decide.spec.ts`,
  "agent_autonomy auto_approve CONSEGUE chegar a auto_approve") —, and
  `ProposeActionUseCase` already executes the start-up on the `auto_approved`
  path (the branch existed for whoever configured `permissions.json`). That is:
  the whole mechanism already existed, the seed and the trigger were missing.
- `/containers` (ADR 0136, RN-521) proposes as a HUMAN (`actor.kind: 'user'`),
  and `agent_autonomy` is only read when the actor is an agent. Seeding for
  Infra changes nothing on that page.

## Decision

1. **The seed.** Acceptance of the handoff addressed to `infra` seeds a THIRD
   autonomy: `container_start: auto_approve`, alongside the usual two. Only it:
   `container_start_via_runner` and `container_stop` remain configurable and
   never seeded, and `container_remove` remains in the absolute ceiling of
   `decide.ts` (RN-495), which no autonomy crosses.
2. **The trigger is a SERVER step, not a new tool.** In the Infra Lead's kickoff
   — the turn born from the accepted handoff —, BEFORE the first trip to the
   model, the server reads the infra context (one read, the same as the kickoff
   text) and, if there is CURRENT routing (`artifact.module_routing` with
   `status: roteado` and at least one candidate) and the project comes up
   through the broker (`container`/`mounted`), proposes `container_start` by the
   SAME path as the tool (`propor_container_start/2`): the local refusals by
   mode and state (RN-566, RN-610) first, then `propose_action`, where the api
   refuses without a broker (RN-591), resolves autonomy and — `auto_approved` —
   executes `ExecuteContainerStartUseCase`, which elects the image through
   `DecidirImagemDoProjetoUseCase` with `decidedBy: 'infra-lead'` (RN-491). No
   parallel election path is born.
3. **The server's election is deterministic.** The candidate of the LARGEST
   number of modules in the routing; on a tie, the one that appears first.
   Network `none` and default resources — the same defaults as the tool. The
   `rationale` says it was the server and why ("the Arquiteto's candidate for N
   of M modules"). It is always one of the candidates, and the api refuses any
   other.
4. **The trail is a tool's, without lying about who called.** The step records
   durable `tool.call` (with `origem: "servidor"`) and `tool.result`, and does
   NOT put a `role: "tool"` message in the model's history: there was no call
   from it, and a tool response without the call is refused by providers. The
   model learns about the start-up through the kickoff TEXT, which now says what
   ALREADY happened (proposal and the returned status, or the refusal and the
   reason) instead of asking for the election.
5. **`runner` stays as it is.** The `container_start_via_runner` path (brings up
   the already decided image, on the user's machine) gets no server step nor
   seed: the owner's decision did not touch it. The kickoff of a `runner` project
   keeps the usual steps, and the start-up stays proposed by the model and
   decided by a human.
6. **RN-668 remains coherent.** The server step marks the turn through the SAME
   `registrar_subida/3` as the tool: a start-up proposed by the server does not
   get the "was not proposed" sentence at the close; a server start-up REFUSED
   (and not corrected by the model) gets the refusal sentence, which is true.
   The close still speaks in the cases where the start-up was not the server's
   (no routing, `runner`) and the model did not propose it.

7. **The Dev Lead is offered by Infra, with the container `running`
   (RN-672).** "Confirm architecture ready" now offers only to Infra: the
   `offerDevHandoff`, the engine's `offer-dev-handoff` route and the Arquiteto's
   `:offer_dev_handoff`/`handoff_dev_pendente` go away. The Infra Lead's server
   offers `infra → dev-lead` (`if_absent` mode, ADR 0182) when the project's
   container is REGISTERED `running`, asking at the end of each of its turns and
   when the outbox's `container.running` arrives — the second consumer of that
   event, alongside the dev agents' wake (RN-502). The repository's second door
   on acceptance to the Dev Lead (RN-582) remains: the acceptance is the same,
   only who offers changed.

## Consequences

- **The promise becomes true by construction in the common case.** A
  `container`/`mounted` project with routing has the start-up proposed — and,
  with the seed, executed — before the model says anything.
- **"Never seeded" stops being true, and it is the ONLY rule that changes.** The
  minimum role remains `maintainer`, read as the EFFECTIVE role of whoever
  opened the session (`resolveEffectiveRole.forProject(session.createdBy)`): a
  session opened by a `developer` gets `deny`, as before, and the kickoff states
  the refusal. A `deny` in `permissions.json` still wins over autonomy.
- **Turning it off means touching the SPECIFIC rule.** The agent card's
  manual/auto toggle writes the wildcard (`*`, RN-153), and a specific rule wins
  over the wildcard: putting Infra on "manual" does NOT turn this seed off — the
  same situation that already held for `open_infra_pr` since Phase 4a. Whoever
  wants the start-up with a click needs to change Infra's `container_start`
  rule. Declared, not resolved here.
- **Re-accepting Infra re-seeds.** Acceptance does an `upsert`, as it already did
  with the two previous seeds: a new handoff to Infra in a new session puts
  `auto_approve` back. Same behaviour as the existing seeds.
- **The kickoff may wait for the start-up.** The auto-approved container
  `propose_action` answers after the broker's `start` (225 s ceiling in the
  engine, RN-605), and the step runs before the first trip to the model: the
  kickoff turn stays `working` for that time, in a Task, with "Stop" served as
  always. A large image that blows the pull ceiling (RN-605) arrives as
  `failed`, and the kickoff tells the model.
- **An infra context that fails brings up nothing.** Without the context read
  there is no routing to elect; the kickoff degrades as before and the start-up
  goes back to depending on the model in that turn. The server's start-up also
  only happens at the kickoff: gate correction and composer messages do not
  repeat it.
- **The Dev Lead stops being acceptable without a container.** The chain becomes
  Arquiteto → Infra → (container `running`) → Dev Lead → execution, and
  `docs/fluxo.yml` says so: the Arquiteto's `handoff-duplo` exit becomes a single
  handoff, to Infra, and Infra gains two exits to the Dev Lead (the container and
  the handoff). A project whose container never comes up does not reach the Dev
  Lead by this path; the manual handoff to an agent of choice (ADR 0109) still
  exists.
- **The outbox notice is at-most-once**, like `Engine.Dev.Wake`: with no Infra
  Lead up when `container.running` arrives (session closed, engine restarting),
  the offer waits for the end of Infra's next turn. A `runner` project depends on
  that notice, because its start-up never happens inside an Infra turn.
- **The `decide.ts` comment** saying *"não está semeado em
  `INFRA_AUTONOMY_SEEDS`"* becomes outdated with this change, because the file
  belongs to another front in progress in the same round; the rule itself
  (`container_start` outside the ceilings, able to reach `auto_approve`) does
  not change.
