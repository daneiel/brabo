---
traducao_de: f56f3ba781c30b1696dcf68fb872242008c3a4a8
---

# 0153 — `DEPLOY_ENABLED`: the trigger ten documents cite and none creates

## Status

**Proposed.** Awaiting the product owner's decision on Stage B (below), which is
not an engineering choice. This document does not change the `status` of any
role or gate by itself.

## Context

`DEPLOY_ENABLED` is the declared trigger of everything missing in the platform
layer. It is cited in **ten documents**:

- [ADR 0091](0091-secops-runtime-relatorio-de-abuso.md) and
  [ADR 0092](0092-platform-relatorio-de-telemetria-sob-demanda.md), in the
  Status field itself — *"its activation stays synchronized with
  `DEPLOY_ENABLED`, which doesn't exist"*;
- [ADR 0089](0089-analytics-e-delivery-metricas-como-relatorio.md);
- `docs/fluxo.yml`, in three places — `platform.ativacao` ("sincronizada com
  DEPLOY_ENABLED"), `area-infra.gate_saida` (`deployavel`, `status: planned`,
  with the comment `# DEPLOY_ENABLED`) and BOTH gap deliverables of
  `secops-runtime` (`resposta-a-incidente` and `postmortem-de-seguranca`, both
  with `motivo: exige tráfego de produção real (pós DEPLOY_ENABLED + platform
  ativo)`);
- `docs/gates.yml`, in the `operavel` gate (`backlog: deploy (DEPLOY_ENABLED +
  Environments)`);
- and also `business-rules.md`, `backlog.md`, `modelo-de-time.md`,
  `auditoria-fluxo-vs-codigo.md`, `historico-de-fases.md` and `CLAUDE.md`.

**In the code it appears twice, both as a comment** —
`apps/api/src/domain/actions/external-effect.ts:144` ("Estes não têm ação
tipada ainda (DEPLOY_ENABLED está no backlog)") and
`apps/engine/lib/engine/harness/tools/listar_metricas_de_produto.ex:185`. No
definition, no read, in `apps/`, `docker/`, `deploy/`, `scripts/`,
`.env.example` or `Makefile`.

Ten documents point to a switch that has no wall.

### What is stuck on it

| stuck | where | consequence |
|---|---|---|
| `platform` | `fluxo.yml`, `status: planned` | the owner of the feedback loop does not exist; SLO, dashboard, runbook and postmortem have no author |
| `operavel` gate | `gates.yml:312-321`, `status: planned` | declared, never evaluated |
| `deployavel` gate | `fluxo.yml:247` | **is not in the registry** — see the finding below |
| `resposta-a-incidente` and `postmortem-de-seguranca` | `fluxo.yml:223-226` | the two gap deliverables of `secops-runtime`, which is `status: active` |

### A finding that is not about deploy

The **`deployavel` gate is declared as the `gate_saida` of `area-infra` in
`docs/fluxo.yml:247` and does not exist in `docs/gates.yml`.**
[ADR 0054](0054-gates-como-registro-declarativo.md) defines the registry as the
place where the gates that exist are declared; a gate named by one piece of the
team model and absent from the other is exactly the inconsistency the
cross-check test between `agent-areas.ts`, `gates.yml` and `fluxo.yml` would
catch — and that test is declared backlog in `CLAUDE.md`, not something that
exists today.

This is fixable **without** deciding anything about deploy, and it is the only
part of this document that does not depend on anyone buying a server.

### The tension that orders the decision

Turning on the flag without a production environment with real traffic does
**not** activate the roles: it creates gates that pass empty. A gate that
approves because it has nothing to fail is worse than a gate declared
`planned`, because it teaches whoever reads it that the loop closed. It is the
same reason ADRs 0091 and 0092 refused to create an agent and delivered an
on-demand script — and that refusal remains right.

## Decision

Two stages, with a hard boundary between what is engineering and what is not.

### Stage A — what is decidable today, and is little on purpose

> **What has already been applied in this delivery:** only item 1. It fixes a
> hole in the REGISTRY and does not depend on the deploy decision — it is the
> only part of this document that holds even if Stage B never happens. Items 2
> and 3 describe what acceptance implies; item 3 (the prose of the ten
> documents) was not applied, because changing the wording before the decision
> would be asserting a choice that has not yet been made.

1. **`deployavel` enters `docs/gates.yml`** with `status: planned`, `dono:
   area-infra`, `severidade: warn` and `aprovacao_humana: false`, in the exact
   mold of `operavel` (`gates.yml:312-321`). It closes the registry hole. `warn`
   and not `block` because the registry rule (RN-070/RN-071) requires
   `verificacao: script` to promote, and there is no script.
2. **The two anticipated scripts do not change.**
   `apps/api/scripts/relatorio-telemetria.ts` and
   `apps/api/scripts/relatorio-seguranca-runtime.ts` are already `active`,
   already run on demand and already deliver what ADRs 0091/0092 promised.
3. **The prose stops treating `DEPLOY_ENABLED` as a variable.** Where today one
   reads "synchronized with `DEPLOY_ENABLED`", one now names the **milestone**
   the expression always meant, with an objective criterion: *there is an
   operated target environment, receiving real traffic, whose delivery pipeline
   someone maintains.*

### Stage B — blocked by an operator, not by code

A production environment with traffic. Only after that does `platform` leave
`planned`, `operavel` and `deployavel` stop being `planned`, and the two gap
deliverables of `secops-runtime` become possible.

The infrastructure **is already ready and is not the bottleneck**:
`deploy/k8s/` with `local`/`staging`/`prod` overlays, the four images published
on GHCR by digest since
[ADR 0119](0119-imagens-publicadas-no-ghcr-por-digest.md),
`make imagens-do-release`, `bootstrap.sh`, `smoke.sh`, `rollout-test.sh` and
`test-restore.sh`. What is missing is someone to **run and maintain** it — and
none of this deploys on its own.

### The alternative considered and rejected

**Creating `DEPLOY_ENABLED` now, as an environment variable with default
`false`.** It was the first design, and it pays off badly: a variable no code
reads is the same empty promise this ADR exists to denounce, only now with a
configuration line to sustain it. The repository already has the rule that
solves this — *a capability is only declared when proven by the suite; without
proof, it is declared `false` and degrades* (ADRs 0041/0042). The flag is born
in the PR that has the **first real consumer**, and that PR is Stage B's.

The name `DEPLOY_ENABLED` stays reserved: ten documents already use it, and
renaming the milestone now would only move the debt.

## What this ADR explicitly rejects

- **Creating a `platform` or `secops-runtime` agent in the engine.** It would be
  inventing authority over a loop that does not close — the refusal of ADRs
  0091/0092, repeated here because the question comes back.
- **Promoting `operavel` or `deployavel` to `block`** without a verification
  script (RN-070/RN-071).
- **Marking as "not measured forever"** what only depends on an environment:
  MTTR and change failure rate remain declared as a gap with a reason, not as an
  impossibility.

## Consequences

- The gate registry now contains every gate the team model names —
  `deployavel` stops existing on only one side.
- Nothing changes at runtime. No new variable, no changed default, no gate
  evaluated that was not before.
- The platform layer remains stopped, **and now says honestly why**: what is
  missing is not a flag, it is an environment. Whoever reads `fluxo.yml` stops
  looking in the code for a variable that was never there.
- It is recorded that the distance between "declared" and "existing" has
  already cost once: ten documents agreed among themselves about a mechanism,
  and the agreement survived because nothing cross-checked them with the code.
  The cross-check test between the three pieces of the team model remains in
  the backlog, and this is the second finding it would have caught.
