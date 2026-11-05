---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
id: rn-broker
title: 'Regras de negócio — Broker'
sidebar_label: Broker
description: 'As RNs hospedadas na raiz broker.'
keywords: [regras de negócio, broker]
---

# Broker

## RAG search leaves a trace, and the trace freezes the weights (RN-479..481)

### RN-494 — The image gate (RN-105) applies in the THREE execution modes {#rn-494}

**REVISES [RN-169](api.md#rn-169) (item 1) and
[RN-421](api.md#rn-421)**: the exemption from the RN-105 gate for a `mounted`/
`runner` project — "these modes don't bring up their own container, so the Arquiteto's
decision will never happen" — is REVOKED. `ReadProjectCodeUseCase
.portaoDoContainer` no longer checks `executionMode`: the THREE modes now
require a decided `artifact.project_image` (by the Arquiteto, `choose_project_image`,
or by the Infra electing a candidate, `container_start` — ADR 0133/RN-491)
before releasing the seven read routes of the Code tab.

The original exemption confused two questions: "does this project bring up a container
on the SERVER?" (no, in `mounted`/`runner`, and that doesn't change here) and "does it
make sense to require that SOMEONE has decided the project's image before opening
code reading?" (yes, in the three modes — the decision is about what the
project EXECUTES, not about where the physical container comes up). Keeping the exemption
let the Code tab of `mounted`/`runner` open without anyone having
thought about the project's image; the uniform rule closes that gap.

**Accepted cost, spelled out**: every EXISTING `mounted`/`runner` project
without a decided `artifact.project_image` — including real dogfooding projects
like `exp001`/`exp002` — LOSES access to the Code tab the instant
this PR is deployed, until the Arquiteto (or the Infra) decides an
image for it. That's an OPERATOR ACTION required after deploy, not
a transparent fix — that's why the branch is born `breaking/`, and the version
goes up MAJOR.

**The lifecycle (`project_containers`) also stops refusing by mode**:
`RegistrarTransicaoDeContainerUseCase` no longer answers 400 for
`mounted`/`runner` — the table can register a row for the three modes, the
same `provisioning` funnel (which already read the image decision, now required
for them too). What remains IMPOSSIBLE for `mounted`/`runner` is
REALLY reaching `running`: that's applied in a single place,
`ContainerBrokerPort.start()`, which refuses
(`ModoDeExecucaoNaoSuportadoError`, a deliberate policy — the broker, on the
server, doesn't see the user's folder where the code of `mounted`/
`runner` lives) — and `ExecuteContainerStartUseCase` already handles that refusal
as a normal failure (`container.start_failed`, named reason), never a crash,
never silence. In practice, through the normal path (approval of
`container_start`), NO row ever gets born in `project_containers`
for these two modes, because the broker refuses BEFORE any transition
is called. Duplicating that mode check in `propose-action.use-case.ts`
or in `ExecuteContainerStartUseCase` was considered and DISCARDED: the
broker already fails loud and named, and the duplicated check would only create a
second place to diverge from the first — the same reasoning as the comment on
`ModoDeExecucaoNaoSuportadoError` (`apps/broker/src/operacoes.ts`), which already
pointed to this PR.

The web side stops treating `mounted`/`runner` as a separate case:
`ProjectCodeTab` asked for the project's mode and opened the shell directly,
without even calling `GET /projects/:id/container`, when the mode wasn't
`container`. That SIMPLIFIED the component — the three modes now follow the
same `useQuery`/states path (loading, error, `sem_decisao`,
decided), with no `modoLocal` nor conditional `enabled` per mode.

- **Where:** `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (`portaoDoContainer`, exemption removed),
  `apps/api/src/application/use-cases/containers/registrar-transicao-de-container.use-case.ts`
  (400 by mode removed), `apps/api/src/application/use-cases/iam/convert-project-execution-mode.use-case.ts`
  (ordering comment fixed), `apps/web/src/routes/ProjectCodeTab.tsx`
  (uniform gate, `modoLocal` removed)
- **Test:**
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  ("o portão do container" block: `mounted`/`runner` answer 409 without a
  decision and read normally once decided),
  `apps/api/test/application/use-cases/containers/ciclo-de-vida-do-container.use-case.spec.ts`
  (`mounted`/`runner` register `provisioning` instead of 400),
  `apps/web/src/routes/ProjectCodeTab.test.tsx` (the three modes treated
  equally)
- **Architectural decision:** [ADR 0135](../adr/0135-portao-de-imagem-nos-tres-modos.md)
- **Origin:** the product owner's plan, Part 1 / PR 1.7 — decision #5 of the
  original plan ("The RN-105 gate comes to apply in the THREE modes"), already accepted
  before this PR existed
