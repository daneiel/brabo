---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0135 — The Arquiteto's image gate (RN-105) now applies in all three execution modes

## Context

Since PHASE 25 (ADR 0065/RN-105), a project's Code tab answers 409 while nobody
has decided which container image it runs — `artifact.project_image`, emitted
by the Arquiteto (Architect) (`choose_project_image`) and, since ADR 0133
(RN-491), also by Infra electing among candidates from the Arquiteto's own
routing. The order is the user's: the container is what gives meaning to
reading the code there, and releasing the read before there is somewhere to
execute would teach that the gate is decorative.

ADR 0072 (RN-169), revised by ADR 0104 (RN-421), exempted `mounted`/`runner`
projects from that gate: since those two modes do not bring up their OWN
container — the code lives in a user folder, mounted into the containers that
already exist (`mounted`) or confirmed by a CLI running outside them (`runner`)
— the original rule answered 409 forever in a project where the Arquiteto's
decision was never going to happen. The exemption avoided closing the tab as a
side effect.

The original plan of this delivery ("Execution in a real container", Part 1)
declared that exemption as decision #5 to reopen, already accepted before this
PR existed: *"RN-105 gate now applies in all THREE modes, container and Code
tab. Accepted cost: exp001/exp002 lose the Code tab until the Arquiteto
decides."* This ADR executes that decision and records what it costs and what
it does NOT change.

The original exemption confused two questions that ADR 0130 (container broker)
and ADR 0133 (Infra's election) separated, without the api having kept up: "does
this project bring up a container on the SERVER?" (no, in `mounted`/`runner` —
a question about MECHANISM) and "does it make sense to require that someone has
decided the project's image before opening the code read?" (yes, in all three
modes — a question about POLICY). The exemption answered the second question
using the answer to the first.

## Decision

**All THREE execution modes (`container`/`mounted`/`runner`) now require
`artifact.project_image` decided before the Code tab opens.**
`ReadProjectCodeUseCase.portaoDoContainer` stops checking `executionMode` — the
gate becomes unconditional, just as it already was unconditional within the
`container` mode. `ProjectCodeTab` (web) stops treating `mounted`/`runner` as a
special case: the three modes follow the same `useQuery`
loading/error/`sem_decisao`/decided, which SIMPLIFIES the component — the
`modoLocal` branch and the mode-conditional `enabled` disappear.

**Accepted cost, in so many words**: every EXISTING `mounted`/`runner` project
without a decided `artifact.project_image` — which includes real dogfooding
projects of this repository, `exp001` and `exp002` — LOSES access to the Code
tab the instant this PR is deployed, until the Arquiteto (or Infra) decides an
image for it. That is an OPERATOR ACTION required AFTER the deploy, not a
transparent fix users do not even notice — which is why the branch is born
`breaking/`, not `bugfix/`, even though the content is a gap fix: the
repository convention (CLAUDE.md) is explicit that content does not decide the
prefix when the change requires operator action. The version goes up MAJOR as
a mechanical consequence of `scripts/ci/version.ts`, not by manual decision —
the number is not corrected afterwards.

**The container lifecycle (`project_containers`) also stops refusing by mode,
but for a narrower reason.** `RegistrarTransicaoDeContainerUseCase` answered 400
for any project outside the `container` mode — a check that actually belonged
to the broker (which already refuses for its OWN, more specific reason), not to
this use case. The 400 goes away; the table can now record a row for all three
modes, through the SAME `provisioning` funnel that already read the image
decision (now also required for `mounted`/`runner`).

**What remains IMPOSSIBLE, by deliberate decision, is `mounted`/`runner`
actually reaching `running`.** That is applied in a single place —
`ContainerBrokerPort.start()` refuses with `ModoDeExecucaoNaoSuportadoError`
(`apps/broker/src/operacoes.ts`): the broker runs on the SERVER and does not
see the user folder where the code of `mounted`/`runner` lives, so composing a
container there would be composing from an empty folder. That policy does NOT
change in this PR — the error class's comment already pointed to this ADR ("o
PR do portão nos três modos (1.7) revisita as duas ao mesmo tempo") and the
review confirms it is right as it is.

Investigated and decided, without a code change: `ExecuteContainerStartUseCase`
calls `ContainerBrokerPort.start()` BEFORE any
`RegistrarTransicaoDeContainerUseCase.execute(..., 'provisioning')` — if the
broker refuses (the normal case for `mounted`/`runner`), the failure becomes
`container.start_failed` with the reason named (`BrokerRecusouError`, NEVER a
crash or a silent fallback) and the lifecycle transition is never called. That
is: through the real approval path (`container_start`), no
`project_containers` row is born for `mounted`/`runner` even with the per-mode
400 removed — the broker is already the effective gate, more precise than the
old 400 (it knows WHETHER IT CAN compose the container; the use case only knew
the MODE). That is why this PR does NOT add a second mode check in
`propose-action.use-case.ts` nor in `ExecuteContainerStartUseCase`: duplicating
it would create a second place to diverge from the first — the same lesson the
broker's own comment already recorded.

Also investigated: neither `propose_container_start` (the Infra Lead's tool,
`apps/engine/lib/engine/infra/tools/propose_container_start.ex`) nor
`GetInfraContextUseCase` restrict by `executionMode` today — the Infra Lead CAN
propose `container_start` for a `mounted`/`runner` project, and the proposal
only fails when someone approves and the broker refuses. That is a PRE-EXISTING
gap (not introduced by this PR) that spends a human approval cycle on an action
bound to fail — but it fails clearly, named, never silently. Fixing it would
require touching the Infra Lead's prompt/instruction in the engine, outside the
scope of this slice (API/domain); it is declared below, not fixed in passing.

## Consequences

**`exp001`/`exp002` and any other `mounted`/`runner` project without a decided
image lose the Code tab until someone runs the Arquiteto (or Infra's election)
for them.** This is the accepted cost of decision #5 of the original plan, not
a side effect discovered later.

**The real containment against `mounted`/`runner` bringing up a container on
the server did not change.** It remains the broker
(`ModoDeExecucaoNaoSuportadoError`), not a 400 from the api — in fact it BECAME
more precise, because now a single place decides it instead of two.

**`project_containers` can, in theory, record a `provisioning` row for
`mounted`/`runner`** — but no production path today calls
`RegistrarTransicaoDeContainerUseCase.execute(..., 'provisioning')` for those
modes without first going through the broker, which refuses. If a new path
some day bypasses `ExecuteContainerStartUseCase` (calling the use case
directly), it inherits the same protection: `obterImagem.execute` still
requires a decision, and nothing else changes here.

**The Infra Lead can propose `container_start` for a `mounted`/`runner` project
knowing it will fail** — a pre-existing gap, neither introduced nor closed by
this PR, declared in CLAUDE.md ("Estado atual e aberto") so it is not lost.

**Alternative considered and discarded: adding the mode check in
`propose-action.use-case.ts` or in `ExecuteContainerStartUseCase`, to refuse
`container_start` for `mounted`/`runner` BEFORE calling the broker.** It would
avoid the wasted approval cycle cited above — but it would move knowledge about
WHO can compose a container (today only the broker knows, via
`PROJECT_WORKSPACES_HOST_ROOT`) into the api, which lacks that context and would
replicate a rule that already exists elsewhere. Discarded for now: the cost is
an avoidable approval cycle, not incorrectness — and the failure message already
names the cause. It stays recorded as a UX candidate, not as a bug fix, if the
volume of futile proposals justifies it.
