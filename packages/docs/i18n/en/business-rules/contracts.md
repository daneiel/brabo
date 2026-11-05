---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
id: rn-contracts
title: 'Regras de negócio — Contratos'
sidebar_label: Contratos
description: 'As RNs hospedadas na raiz contracts.'
keywords: [regras de negócio, contracts]
---

# Contratos

## Git

### RN-028 — Capability decides, not the provider's name {#rn-028}

An unsupported operation (branch protection on the local provider) is declared in
`capabilities` and rejected with `GitNotSupportedError` — never a silent failure.

There are **four** capabilities: `protectBranch` and `pullRequests` since Phase 2, and
`listTree` and `pullRequestDiff` since PHASE 26 (Code tab, read-only). The rule
didn't change with them — its reach did. And the criterion for declaring is still
proof: a capability is only `true` when the suite exercises it on that provider; without
proof, it's declared `false` and degrades (same criterion as ADRs 0041/0042).

- **Where:** `packages/shared/src/index.ts` (`GitProviderCapabilities`); the
  ceilings of the two read operations in
  `apps/api/src/domain/git/git-read-limits.ts`, outside shared because it's
  100% types
- **Test:** single contract suite, `test/contract/git-provider.contract.ts`,
  run against the three providers
- **Origin:** [ADR 0001](../adr/0001-git-provider-contract-shape.md)

### RN-087 — O Dev Lead é o único endereço externo da execução {#rn-087}

Existe um agente `dev-lead`, conversacional, que recebe o handoff do Arquiteto
(desde a [RN-672](api.md#rn-672), da Infra, com o container do
projeto `running`) e propõe o **plano de execução**: quantos agentes por módulo e por quê. Ele não
escreve código — distribui trabalho e responde por ele.

**Antes dele, a frase "quem decide é o lead" da [RN-083](api.md#rn-083) não tinha
dono.** O Arquiteto terminava e a execução subia por um botão, sem ninguém no
meio para avaliar quanto trabalho havia.

**Os `dev-<modulo>` deixaram de ser endereçáveis por handoff.** Isso não é
exceção nova: é a regra do [ADR 0038](../adr/0038-hierarquia-de-agentes.md) —
handoff externo endereça só lead de área ou agente sem área — passando a valer
para o dev como já valia para QA e Infra. Enquanto não havia Dev Lead, eles
eram agentes SEM área e por isso alvos válidos; virando membros, deixam de ser.

**A área de `dev` é a primeira DINÂMICA**, e é o que forçou o predicado: os
membros são um por módulo do `module_map`, decididos pelo Arquiteto e
diferentes em cada projeto, então não há lista a enumerar. `dev-lead` casa com
o mesmo prefixo `dev-` dos membros, e quem o exclui é a regra genérica **o lead
nunca é membro da própria área** — que vale para qualquer área e vive num lugar
só. A primeira versão repetia essa exclusão em três pontos, e a verificação por
mutação mostrou que nenhuma das cópias era alcançável por teste: cada uma
sobrevivia à mutação da outra.

**O plano é `proposed_action` (revisado pelo [ADR 0086](../adr/0086-dev-lead-plano-suspende-para-aprovacao.md), [RN-284](engine.md#rn-284)).**
Até essa mudança o plano virava EVENTO simples, sem aprovação: o argumento era
que propor não tem efeito externo — o gasto acontece quando os agentes sobem,
e é lá que o teto cobra autorização; transformar a proposta em ação a decidir
faria você decidir duas vezes a mesma coisa. Uma auditoria de
`docs/fluxo.yml` × código encontrou que o fluxo já declarava esta saída como
`via: proposed_action` desde o ADR 0085, e o código nunca foi ajustado para
bater — o dono do produto decidiu que o código errava: o plano é a PRIMEIRA
decisão real de quanto a sessão vai gastar com paralelismo, e o usuário passou
a decidir ativar a execução tendo VISTO uma aprovação de verdade, não só lido
uma linha no fio. A lição antiga não desapareceu — é o motivo pelo qual
`propose_execution_plan` NÃO entrou no bloco de tetos absolutos de
`decide.ts` (ver RN-284).

**O plano BEM-SUCEDIDO encerra o turno — no caminho SEM suspensão.** Na
primeira execução real o Dev Lead registrou **dois** `execution.plan_proposed`
na mesma sessão — textos diferentes, mesmo total —, porque o laço voltava ao
modelo e ele propunha de novo. O event log é imutável: ficaram duas propostas
e nada dizendo qual valia. A instrução "use uma vez" no spec da ferramenta é
pedido, não garantia; quem garante é o laço parar. Desde o ADR 0086, quando a
proposta fica `pending`, quem encerra o turno é a PARADA por suspensão
(RN-284) — o sucesso imediato (`auto_approved`/`executed`/`approved`, ver
RN-284) continua fechando o laço do mesmo jeito de sempre.

**Bem-sucedido, e não "chamou a ferramenta"**: um plano recusado (vazio, ou com
zero agente num módulo) deixa o laço seguir, senão a recusa vira fim de turno e
o modelo nunca chega a corrigir. A primeira versão desta guarda olhava só o
nome da ferramenta e tinha esse defeito — encontrado pelo teste comportamental,
não pela leitura.

Um plano vazio, ou com zero agente num módulo, é recusado **antes de propor
qualquer coisa** — a proposta, uma vez criada, é decisão real do usuário, e um
plano meio proposto não teria como ser retratado.

- **Onde:** `apps/engine/lib/engine/agents/dev_lead_server.ex` e
  `dev_lead_tools.ex`; a regra de endereçamento em
  `apps/api/src/domain/agents/agent-areas.ts`; o handoff em
  `application/use-cases/agents/offer-infra-handoff.use-case.ts`
- **Teste:** `apps/engine/test/engine/agents/dev_lead_tools_test.exs`,
  `dev_lead_server_test.exs` (`o plano ENCERRA o turno`, `o plano recusado NÃO
  encerra o turno`),
  `apps/api/test/domain/agents/agent-areas.spec.ts` (`o dev de módulo DEIXOU de
  ser endereçável`, `` `dev-lead` É endereçável, apesar do prefixo ``) e
  `test/application/use-cases/agents/offer-infra-handoff.use-case.spec.ts`
- **Origem:** [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md), FASE 14d;
  o mecanismo de aprovação revisado pelo [ADR 0086](../adr/0086-dev-lead-plano-suspende-para-aprovacao.md)

### RN-110 — `blame` is the 13th operation of the `GitProviderContract`, with the same absence vocabulary as the other reads {#rn-110}

Foundation of the blame gap declared in FASE 26 (no screen consumes it
yet — it comes in the next wave). `blame(ref, path)` returns `GitBlame | null`,
`null` meaning exactly what it already means in `getFileContent`/
`listTree`: file absent at that ref, or nonexistent ref. Two vocabularies
of "does not exist" for the same tab would make the screen treat the same case in two
ways — the same reason that already held for the two previous operations.

Each provider computes by its OWN means, because there is no common endpoint:
GitHub has no blame in REST (only GraphQL — the only provider operation that
speaks GraphQL), GitLab has `repository/files/:path/blame`, and the local one comes from
`git blame --porcelain`, the only one of the three tested against a real
repository in this session (the other two only against the fake backends of the contract
test — without `GITHUB_TEST_TOKEN`/`GITLAB_TEST_TOKEN` in the environment, what proves
against the real API is the manual smoke). `GIT_BLAME_LINE_LIMIT` (2000) cuts
a genuinely huge file — already cut by bytes on the content route, but
`blame` reads the whole file from the provider before deciding.

- **Where:** `packages/shared/src/index.ts` (`BlameInput`, `GitBlame`,
  `GitBlameLine`, capability `blame`),
  `apps/api/src/infrastructure/git/{github,gitlab,local}-provider.ts`,
  `apps/api/src/domain/git/git-read-limits.ts` (`GIT_BLAME_LINE_LIMIT`),
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (method `blame`), `apps/api/src/interfaces/http/git/code.controller.ts`
  (`GET /projects/:id/code/blame`)
- **Test:** `apps/api/test/contract/git-provider.contract.ts` ("blame" block),
  exercised by the three provider specs — the `local` one against real
  git — and `read-project-code.use-case.spec.ts` ("blame" block)
- **Origin:** FASE 26b (foundation of the declared gaps of FASE 26/
  [ADR 0060](../adr/0060-superficie-de-leitura-de-codigo.md))

### RN-111 — `listPullRequests` is the 14th operation of the `GitProviderContract`; the navigable list opens the same diff by id {#rn-111}

`CodeDiffPanel.tsx` consumes `listPullRequests(state?)` in a clickable list
(id/number/title/author/state/branches, with a filter by state); clicking an
item reuses the SAME diff-by-id flow that already existed — there is no new read
path, only how to REACH the id without knowing it by heart. Whoever already knows the id
(e.g.: came from Approvals) can still paste it directly.

`listPullRequests(state?)` returns a SUMMARY per PR
(`GitPullRequestSummary`: id, number, title, author, state, branches,
`updatedAt`) — not `GitPullRequest`, which is the WRITE type (open/merge) and
never had title or author because neither of the two operations needed them. A
type of its own keeps the write from gaining fields only the read uses.

`local` HAS PRs — the sidecar store of Fase 4a is already the source, and the assumption of the
brief ("PR does not exist in the concept of a pure local repository") did not
hold: the self-contained dev agents have created local PRs since then. The three
capabilities are `true`. `GIT_PR_LIST_LIMIT` (100) is a single page, with no
follow-up pagination — human navigation, not history synchronization.

- **Where:** `packages/shared/src/index.ts` (`ListPullRequestsInput`,
  `GitPullRequestSummary`, `GitPullRequestList`, capability
  `pullRequestsList`), `apps/api/src/infrastructure/git/{github,gitlab,
  local}-provider.ts`, `apps/api/src/domain/git/git-read-limits.ts`
  (`GIT_PR_LIST_LIMIT`), `read-project-code.use-case.ts` (method
  `pullRequests`), `code.controller.ts` (`GET /projects/:id/code/pull-requests`),
  `apps/web/src/routes/code/CodeDiffPanel.tsx` (clickable list, filter by
  state, reuse of the diff-by-id flow)
- **Test:** `git-provider.contract.ts` ("listPullRequests" block),
  `read-project-code.use-case.spec.ts` ("lista de PRs" block),
  `apps/web/src/routes/code/CodeDiffPanel.test.tsx`
- **Origin:** FASE 26b

### RN-112 — `listBranchesDetailed` is an operation of its OWN, separate from `listBranches` {#rn-112}

Foundation of the rich dropdown, now consumed by `CodeBranchPicker.tsx`
(`ahead`/`behind`, PR badge — the wave after FASE 26b closed the
gap that `CodeShell.tsx` declared). The decision was NOT to extend `listBranches` — the
original 13th operation, which the Gitflow bootstrap calls without needing any of
this: enriching costs an extra call to the provider PER BRANCH (two on
GitLab, which has no endpoint returning both sides of a comparison in a
single call, unlike GitHub's `compareCommitsWithBasehead` and `git
rev-list --left-right --count` locally). Attaching that cost to every
branch adoption/creation would turn the bootstrap into an expensive sweep. The
two operations coexist in the contract: `listBranches` for the bootstrap,
`listBranchesDetailed` (the 15th) for the Code tab — `GitBranchDetail` extends
`GitBranch` only in SHAPE, never in the CONTRACT of the caller.

`ahead`/`behind` are always relative to the repository's DEFAULT branch
(`ListBranchesDetailedInput.defaultBranch`, which the caller already knows — asking for it
again from the provider would be one more call just to rediscover what it already
had). `null` in both when the provider cannot compute (orphan branch,
unrelated history) is honest degradation, never an invented number.
`GIT_BRANCH_DETAIL_LIMIT` (30) cuts for the same traffic reasons as item 34
of FASE 26 — without it, a repository with hundreds of branches would become hundreds
of calls per dropdown opening.

- **Where:** `packages/shared/src/index.ts` (`ListBranchesDetailedInput`,
  `GitBranchDetail`, `GitBranchDetailList`, `GitBranchPullRequestRef`,
  capability `branchesDetailed`), `apps/api/src/infrastructure/git/{github,
  gitlab,local}-provider.ts`, `git-read-limits.ts`
  (`GIT_BRANCH_DETAIL_LIMIT`), `read-project-code.use-case.ts` (method
  `branches`), `code.controller.ts` (`GET /projects/:id/code/branches`);
  on the web, `apps/web/src/lib/api-client.ts` (`getCodeBranches`) and
  `apps/web/src/routes/code/CodeBranchPicker.tsx` — the dropdown itself, opened
  from `CodeShell.tsx`
- **Test:** `git-provider.contract.ts` ("listBranchesDetailed" block),
  `read-project-code.use-case.spec.ts` ("branches detalhadas" block),
  `apps/web/src/routes/code/CodeBranchPicker.test.tsx`
- **Edge case:** the `branches()` method lives in the SAME use case as the other six
  reads (`ReadProjectCodeUseCase`), not near the bootstrap — it is a READ
  of the Code tab, with the same credential resolution and the same container
  gate (RN-105) as the others; treating it as a bootstrap operation
  would duplicate both. A ref outside the branch list (tag or sha) remains
  reachable — the dropdown footer has a manual field, because
  `listBranchesDetailed` does not enumerate those two things.
- **Origin:** FASE 26b (foundation); the next wave closed the UI

## The `implementavel` gate activates — QA-strategy as the qa-lead's second moment (RN-340/341, ADR 0090)

### RN-341 — QA-strategy is the qa-lead's second MOMENT, and never suspends {#rn-341}

`docs/fluxo.yml` declared the `qa-estrategia` role as `proposto`, with the
separation criterion written in the registry itself: "it can be the qa-lead
itself in a second MOMENT, not necessarily a new agent — the separation is
by deliverable". [ADR 0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md)
builds exactly that: `Engine.Gates.QaEstrategiaAgent` is a STATELESS module
(not a `GenServer`), triggered by `Engine.Gates.QaLeadServer.run_design/3`
— a NEW and ADDITIVE entry point in the SAME `qa-lead` process, without touching
`run/2` (the usual path, PR review, tied to
`DevAgentState.find_by_task_id`).

**The context is LIGHT, and that's where the deliverable separation shows up.**
`Engine.Gates.QaEstrategiaContext.fetch/3` fetches ONLY the story (from
`EngineApiClient.list_backlog/1`, the tree the PO already reads — [RN-164](engine.md#rn-164))
and the current `module_map` (from `EngineApiClient.get_infra_context/2`, the SAME
`GetInfraContextUseCase` the Infra Lead consumes, here only through the
`moduleMap` field) — NO `dev_state`, NO `worktree_path`: the `implementavel` gate
runs PRE-DEV, before a dev agent, worktree, or `task_id` exists. No new
route in the api — both functions already existed.

**It never suspends.** The tool registry (`ReadFile`, `SearchWorkspace`,
`EmitPlanoDeTeste`) includes neither `terminal` nor `write_file` — the ONLY TWO
tools that `Engine.Harness.Hooks.ActionPipeline` intercepts to create a
`proposed_action`. With no call at all going through the actions pipeline, this
agent's `ToolLoop` never produces `:pending`, and `run_design/3` runs
SYNCHRONOUSLY inside the `handle_cast` itself — with no
suspension/resumption mechanism, unlike the rest of the QA area.

**The iteration ceiling stays at 8 (conversational), not 60 (gate) — on
purpose, not a gap.** This agent runs WITHOUT `token_budget_micros` — there's no
task nor task budget yet. The criterion of [RN-085](engine.md#rn-085) isn't "who
works a lot": it's "what holds spend beyond the iteration ceiling". With no
budget underneath, raising the ceiling would multiply the worst case with nothing to
contain it — the SAME reason why `infra-workflows` stays at 8 even though it uses a
tool. `"qa-estrategia"` did NOT get its own clause in
`Engine.Harness.Iteracoes.tipo/1`: falling into the default is the right decision.

The deliverable — `emit_plano_de_teste` (synthesis, verifiable executable
criteria, a GENERIC automation strategy with no framework — a scope decision
of this front, in the `spec/0` the model reads, not a validation in
code) — becomes the `artifact.plano_de_teste` artifact
(`ArtifactEmitter.emit/5`, validated schema, `criteriosExecutaveis` can't
be empty), in the event log of the SAME session that called `run_design/3` — that's
where `assess_implementability` ([RN-340](api.md#rn-340)) reads it afterwards. Failure
(iteration limit, budget, a model that stops without emitting) is NEVER
silent: a durable `agent.error` with origin, same ruler as
[RN-059](engine.md#rn-059).

**Since [RN-674](engine.md#rn-674) (ADR 0192) the MOMENT changed.** The second moment
still belongs to the `qa-lead`, with no new agent, and still never suspends;
but it runs AFTER the delivery, at the start of the `run/2` cycle, with the
dev's worktree and the diff's files — `run_design/3` and `QaEstrategiaContext` were removed, and
the artifact gained `taskId`. The ceiling is still 8, now WITH the task's budget
underneath.

- **Where:** `apps/engine/lib/engine/gates/qa_estrategia_agent.ex`,
  `qa_lead_server.ex` (`run_area/3`, since [RN-674](engine.md#rn-674)),
  `tools/emit_plano_de_teste.ex`, `hooks/termination_plano_de_teste.ex`;
  `apps/engine/lib/engine/harness/artifact_schemas.ex` (`plano_de_teste`);
  `apps/engine/lib/engine/harness/iteracoes.ex` (NO new clause, see
  above); `docs/fluxo.yml` (`qa-estrategia`, `status: active`)
- **Test:** `apps/engine/test/engine/gates/qa_estrategia_agent_test.exs`,
  `qa_lead_server_test.exs` (describe "plano de teste da entrega (ADR 0192)"), `apps/engine/test/engine/harness/artifact_schemas_test.exs`
  (describe "plano_de_teste"), `iteracoes_test.exs` ("qa-estrategia é
  conversacional DE PROPÓSITO")
- **Origin:** [ADR 0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md)

---

## `secops-runtime` — abuse report over `rate_limit_hits` (RN-375..377, ADR 0091)

### RN-377 — The "not measured" section is permanent, and names the three gaps {#rn-377}

`montarRelatorio` always includes `naoMedido`: automatic incident
detection, incident response, and security postmortem. All three depend
on the same trigger `docs/fluxo.yml` already declared for `secops-runtime` —
real production traffic — and none of them is simulated with a sample
incident or invented number (same principle as ADRs 0041/0042/0077: without the
real data, the gap stays visible instead of faked). The section only leaves the list
when the product has real traffic to measure against it — it isn't a TODO to
delete in the next cleanup.

- **Where:** `apps/api/scripts/relatorio-seguranca-runtime.ts`,
  `apps/api/package.json` (`relatorio:seguranca-runtime`)
- **Test:** `apps/api/test/scripts/relatorio-seguranca-runtime.spec.ts`
- **ADR:** [0091](../adr/0091-secops-runtime-relatorio-de-abuso.md)

---

## `platform` gets a first delivery: on-demand telemetry report (RN-385/386, ADR 0092)

### RN-385 — The `platform` role is born as a one-off read SCRIPT, over the same sources as `DomainGaugesCollector` {#rn-385}

`docs/fluxo.yml` describes `platform` (`camada_plataforma`) as "SRE / Platform
— owner of the feedback loop", `status: planned`, with activation synchronized with
`DEPLOY_ENABLED` — which doesn't exist. The product owner decided to bring forward
the half that already has real data behind it: `pnpm --filter api relatorio:telemetria
[--projeto <uuid>] [--json]` reads, on demand, the SAME questions that
`DomainGaugesCollector` already answers every `METRICS_GAUGE_INTERVAL_MS` for the
Prometheus scrape — active/closing sessions per project, blocked tasks
per project, state of the last backup (age, status, size, always GLOBAL,
never per project, because the product has a single backup). It isn't an LLM agent nor a
`GenServer`: it's a standalone, stateless read that ends after printing.

The SQL queries are REPLICATED, not imported from the collector — its methods
(`collectSessions`/`collectBlockedTasks`/`collectBackup`) are private and
end by writing into a Prometheus gauge (`this.metrics.*.set(...)`); there's no
pure "query only" half to reuse without coupling a standalone script to the
lifecycle of a NestJS `@Injectable`. The script is also NOT a second
collector: it registers no metric, doesn't run on `setInterval`.

The output always brings "where to see more" (the three versioned dashboards in
`deploy/k8s/observability/dashboards/*.json`, the alerts in
`deploy/k8s/observability/alerts/brabo-alerts.yaml`, `docs/runbook.md
#observabilidade`, and `pnpm dev:obs` for local observability) — the script
LINKS to what already exists, never duplicates.

- **Where:** `apps/api/scripts/relatorio-telemetria.ts`; mirrors
  `apps/api/src/infrastructure/observability/domain-gauges.collector.ts`
- **Test:** `apps/api/test/scripts/relatorio-telemetria.spec.ts` (pure
  functions — `parseArgs`, `formatarIdade`, `formatarBytes` — same slice as
  `medir-execucao.spec.ts`: the part that talks to the database is exercised by running
  the script against a real database)
- **ADR:** [0092](../adr/0092-platform-relatorio-de-telemetria-sob-demanda.md)

### RN-386 — The telemetry report declares, without inventing, what it does NOT measure {#rn-386}

The real trigger of the `platform` role (`DEPLOY_ENABLED`) doesn't exist: there's no
production environment with real traffic, no numeric SLO defined anywhere
in the product, and no postmortem possible without a real incident.
`relatorio-telemetria.ts` says so in its OWN output, in a "not measured" section,
instead of pretending coverage it doesn't have — the same discipline as ADR 0042 for a
model's grade and ADR 0077 for code quality: without the real data, the
product DECLARES the gap, never invents the number.

Three gaps, all explicit: **formal numeric SLO** (none is
defined); **postmortem** (depends on a real incident that hasn't happened); and
**telemetry back into the product in a closed loop** (the script is a one-off
on-demand read — observing, deciding, and acting on its own is what would make
`platform` `active` in `docs/fluxo.yml`, and that's why the role's `gate_saida: { id:
operavel, status: planned }` remains `planned`, untouched by this
change).

- **Where:** `apps/api/scripts/relatorio-telemetria.ts` (function `imprimir`,
  "Não medido" section); `docs/fluxo.yml` (`camada_plataforma › platform ›
  saidas_alvo`, artifact `telemetria-consolidada`, field `nota`)
- **Test:** indirect coverage — the section is fixed text verified by reading
  the file; there's no conditional truth to test here (nothing to get wrong between
  "measured" and "not measured" beyond the text itself)
- **ADR:** [0092](../adr/0092-platform-relatorio-de-telemetria-sob-demanda.md)

---

## fluxo.yml × code audit — Wave 2: RN-160 in the backend and Dev Lead → dev delegation (RN-404/405, ADR 0094)

### RN-405 — The Dev Lead → dev delegation becomes data in `delegations`, with `parecerArtifactId` redefined as "what justified the decision" {#rn-405}

ADR 0053 (PHASE 14d) already foresaw the Dev Lead → `dev-<modulo>` delegation as
"the same path as QA and Infra" (`delegations`, `area = 'dev'`), but
declared it out of scope. `dev_lead_server.ex` never wrote to the table —
only QA (`qa_lead_server.ex`) and Infra (`infra_lead_server.ex`) did, both
on the ENGINE side, because that's where the subagent produces an OPINION (a
single-round verdict) that justifies `parecerArtifactId`.

The Dev Lead doesn't have that pattern: activating a `dev-<modulo>` happens on the
API side, in `AcceptParallelizationUseCase.execute` — called both by the
direct path (`RequestParallelizationUseCase`, below the session ceiling of
[RN-083](api.md#rn-083)) and by the approved one (`ExecuteParallelizationUseCase`,
after the user approves the `parallelize`-type `proposed_action`). The
recording went INSIDE that method — it covers both paths for free,
because both already converge there —, with `status: 'completed'` REDEFINED for
this area: it means "the delegation was CARRIED OUT" (the agent came up), not "the
subagent finished and emitted an opinion" as in QA/Infra (decision recorded in
[ADR 0094](../adr/0094-delegacao-dev-lead-vira-dado.md)).

`parecerArtifactId` points to the `id` of the project's most recent and current
`artifact.module_map` event — obtained from
`SessionEventRepository.listByTypeForProject(projectId, 'artifact.module_map')`
(an already existing generic method, used by `computeCoverage` for
`artifact.business_rule`; no new query was written, just one more call to
it — the last item of the list is the most recent, because the function sorts
by `createdAt` ASC) — the artifact that justified the decision to delegate.
`area: 'dev'`, `leadAgent: 'dev-lead'`, `subagent` is the exact id of the
activated agent (`extraDevAgentId(module)`, the SAME function that builds the id in all
the rest of the use case — no new format). With no `artifact.module_map` in the
project (it shouldn't happen — it's a mandatory input of the Dev Lead in
`docs/fluxo.yml`), the delegation is NOT recorded with an invented id: it only logs the
unexpected state, by the same lesson as RN-059 (never a silent failure, but
also never pretending a justification that doesn't exist). And a failure of
`RecordDelegationUseCase.execute` (e.g. database down) is caught and
logged, never propagated — the dev agent's activation is already a success when the
attempt to record the delegation happens, and can't be taken down by an
auxiliary write.

- **Where:** `apps/api/src/application/use-cases/execution/accept-parallelization.use-case.ts`
  (`recordDevDelegation`, called at the end of `execute`)
- **Test:** `apps/api/test/application/use-cases/execution/accept-parallelization.use-case.spec.ts`,
  describe "delegação Dev Lead → dev (área dev, ADR 0094)" — records with
  `area: 'dev'` pointing to the most recent module_map; without a module_map it doesn't
  record (and doesn't throw); `RecordDelegationUseCase` failing doesn't take down the
  activation
- **ADR:** [0094](../adr/0094-delegacao-dev-lead-vira-dado.md)

---

## fluxo.yml × code audit — Wave 6 (last): the `necessidade-validada` gate (RN-406, ADR 0095)

Closes the last finding of the audit plan (section D,
`docs/explanation/auditoria-fluxo-vs-codigo.md`) — B2. The other five
waves had already closed (3, 4, and 5 brought forward out of order by ADRs
0089/0090; 1 and 2 in the previous PRs). `docs/fluxo.yml` (role
`criativo`) declared `gate_saida: { id: necessidade-validada, status:
proposto }` since ADR 0085 with no mechanism at all behind it — and
`modelo-de-time.md` already recorded why: the Criativo (the model) deciding
on its own that the need it produced itself is validated would be
self-validation, not a real gate.

### RN-406 — The `necessidade-validada` gate closes with a SEPARATE click from the user, never with the Criativo validating itself {#rn-406}

> **Revised by [ADR 0185](../adr/0185-estou-pronto-fecha-os-dois-gates.md)
> ([RN-657](api.md#rn-657)), by the owner's decision on 09/30.** The click is no longer
> SEPARATE: "I'm ready — the need is validated" records
> `readiness.confirmed` and `necessity.validated` in the same POST, with the
> `product_brief` produced AFTER the click (`productBriefId: null`). The
> "Confirm validated need" button left the screen. What still holds
> from this rule: whoever validates is always a PERSON, never the Criativo; the gate stays
> `warn`. `POST .../agents/criativo/validate-necessity` remains in the api, with no
> consumer on screen — it's the path for a session whose "I'm ready" predates
> ADR 0185. The text below is the design of ADR 0095, kept as
> history.

`SessionPage.tsx` gains a third confirmation button, in the SAME
interaction pattern as "I'm ready to produce" (RN-142) and "Confirm
architecture ready" ([RN-160](web.md#rn-160)): "Confirm validated need"
(`handleValidateNecessity`) calls `POST
.../agents/criativo/validate-necessity`, which records `necessity.validated`
with `payload.productBriefId` pointing to the session's most recent
`artifact.product_brief`.

The button only enables AFTER `confirm_readiness` has already consolidated the
`product_brief` (`hasProductBrief`, `events.some(e => e.type ===
'artifact.product_brief')`) — it makes no sense to "validate" an executive
summary that hasn't been produced yet, and that's the most
consistent reading with `docs/fluxo.yml`: `necessidade-validada` is the Criativo's EXIT
gate, the moment when its work has already delivered a concrete
artifact. `ValidateNecessityUseCase` revalidates the same precondition in the
BACKEND (`SessionEventRepository.listByTypeInSession(sessionId,
'artifact.product_brief')`, takes the last by `seq`) — the disabled UI
alone wouldn't suffice, same lesson as [RN-404](api.md#rn-404).

Unlike `OfferInfraHandoffUseCase` (RN-160), this confirmation does NOT
signal the engine: the Criativo→PO handoff has already happened inside
`confirm_readiness` itself
(`CriativoServer.executar_confirm_readiness/1`), so there's no agent
waiting for this event — it's only the record that a human
validated the MERIT of what was already delivered. `ValidateNecessityUseCase` doesn't
receive `ApiToEngineClient` in the constructor.

`docs/gates.yml` gains the `necessidade-validada` gate: `status: active`,
`aprovacao_humana: true` (it's literally a human click),
`verificacao: script`, but `severidade: warn` — nothing in the product today
CHECKS the passage of this gate before letting the PO proceed (unlike
`story-promovida`/`plano-de-adocao`, which are `block` because a real
code lock prevents them from being skipped). `docs/fluxo.yml` (role
`criativo`) goes `status: proposto` → `status: ativo`.

- **Where:** `apps/api/src/application/use-cases/agents/validate-necessity.use-case.ts`;
  `apps/api/src/interfaces/http/agents/agents.controller.ts`
  (`validateNecessityHandoff`); `apps/web/src/routes/SessionPage.tsx`
  (`hasProductBrief`, `necessidadeJaValidada`, `handleValidateNecessity`)
- **Test:** `apps/api/test/application/use-cases/agents/validate-necessity.use-case.spec.ts`
  — without `product_brief`, refuses BEFORE recording any event; with one or
  more, records referencing the MOST RECENT;
  `apps/web/src/routes/SessionPage.validar-necessidade.test.tsx` — button
  disabled without `product_brief`, enabled with it, disappears after
  `necessity.validated`
- **ADR:** [0095](../adr/0095-gate-necessidade-validada.md)

---

### RN-407 — The PO reads the delivery funnel and partial DORA, a third read scoped to the project {#rn-407}

The PO gained a THIRD read tool — `listar_metricas_de_produto`
(`:direct`, with no parameter at all) — served by
`GET /internal/projects/:projectId/product-metrics`, the same design as the two
siblings of [RN-164](engine.md#rn-164): scope closed on the project, no search term,
no pagination.

`docs/fluxo.yml` (role `po`, input `metricas-de-produto`) declared
`status: lacuna` since [ADR 0089](../adr/0089-analytics-e-delivery-metricas-como-relatorio.md),
which had already delivered the DATA — the script `pnpm --filter api analise:funil`
measures the real session → commit → PR → merge funnel, the real lead time, and the
real deployment frequency from `proposed_actions`. What was missing was
only the MECHANISM: the PO never had a way to reread that report within the turn.
It closes item B4 of the `fluxo.yml` × code audit
([docs/explanation/auditoria-fluxo-vs-codigo.md](../explanation/auditoria-fluxo-vs-codigo.md)) —
the LAST pending item of the "Team model backlog" table
(docs/explanation/backlog.md), which is empty after this one.

The CALCULATION is the SAME as the script's, never duplicated: the pure functions
(`calcularFunil`/`calcularLeadTimes`/`leadTimeMedioMs`/
`deploymentFrequencyPorDia`) and the query that builds `AcaoGit[]`
(`buscarAcoesGitDoFunil`) were extracted from `apps/api/scripts/analise-funil.ts`
to `apps/api/src/application/services/funil-metrics.ts` — a use case in
`src/` can't import from `scripts/`, and the script now REEXPORTS from there
instead of defining locally, without changing signature or behavior (the
script's regression test stays green without being touched).

The JSON body the route returns **has no field at all** for the three
permanent absences the script already declared in text ("Not measured, on
purpose": complete product funnel ideation → commit, evidence of adoption
per feature, MTTR/change failure rate) — the report's shape never reserved
space for them. The PO's tool names all three in the
TEXT it returns to the model, always, and not only when the number is zero: without that
section the PO would read only the funnel numbers and conclude by omission that there's
no gap at all.

- **Where:** `apps/api/src/application/services/funil-metrics.ts`;
  `apps/api/scripts/analise-funil.ts` (reexports);
  `apps/api/src/application/use-cases/backlog/list-product-metrics.use-case.ts`;
  `apps/api/src/interfaces/http/internal/internal-projects.controller.ts`;
  `apps/api/src/interfaces/http/internal/dto/product-metrics.response.dto.ts`;
  `apps/engine/lib/engine/harness/tools/listar_metricas_de_produto.ex`;
  `apps/engine/lib/engine/agents/po_server.ex`;
  `apps/engine/lib/engine/sessions/engine_api_client.ex`
- **Test:** `apps/api/test/application/use-cases/backlog/list-product-metrics.use-case.spec.ts`;
  `apps/api/test/scripts/analise-funil.spec.ts` (regression — still
  imports from `scripts/analise-funil.ts`, unchanged);
  `apps/engine/test/engine/harness/tools/listar_metricas_de_produto_test.exs`;
  `apps/engine/test/engine/agents/po_server_test.exs`
- **Origin:** same pattern as [RN-164](engine.md#rn-164) (agent read scoped
  to the project, no external effect, no `proposed_action`); the data is from
  [ADR 0089](../adr/0089-analytics-e-delivery-metricas-como-relatorio.md) — this RN only
  closes the read mechanism that was missing.

## The repository is born on accepting the handoff to the Arquiteto, and execution does not start without it (RN-582)

### RN-605 — The image pull is a NAMED step of `start`, under the control ceiling, and the overflow says a big image does not come up {#rn-605}

The Docker port's `start` did not pull: `docker run` did, internally,
under `TIMEOUT_DE_CONTROLE_MS` (30 s). Reproduced in AT-234 with a double of the
daemon (image absent, 45 s pull, without sleeping and without network): the overflow came out
as `ComandoDeDockerFalhouError` — "`docker run …` ended with code -1:
(no error output)" —, became a 502 with `origem: null` in the broker and reached the api
without a name. And killing the CLI CANCELS the pull (measured on Docker 29.8.0, containerd):
the image stayed absent for the following 60 s, so the sentence "the pull may
continue in the daemon" did not hold.

Of the four ways out measured (its own ceiling of ~300 s, asynchronous `start`, pull
in advance at the image decision, only giving a name), the maintainer decided on **D —
only giving a name** (2026-09-27). The rule:

1. **The pull is explicit.** Before the `run`, `image inspect`; a present image
   is not downloaded again (the same `--pull missing` as the `run`). Absent, `docker
   pull` under the SAME 30 s control ceiling — no bigger ceiling.
2. **The overflow has a name.** `PullExcedeuTetoError`, origin `infra`, with the
   image, the ceiling and the whole consequence: the pull was cancelled, the image
   stays absent, a big image does not come up through this path, and the fix is
   downloading it beforehand on the host. Before asserting that, the adapter checks the daemon
   (`docker version`): a daemon down remains `DockerIndisponivelError`.
   A pull that fails for another reason follows the usual path
   (`ComandoDeDockerFalhouError`, without an origin, ADR 0128).
3. **The name crosses over.** The broker answers 504 with `origem: 'infra'`, and the api
   passes it on in `BrokerRecusouError` — `origem` filled in, never `null`. In
   `runner` mode the same adapter runs on the user's machine and the message
   arrives in the `container_start_result`.
4. **The ceilings of whoever waits for the `start` count the whole worst case**: the two
   `ps` of `resolver`, `image inspect`, `pull`, `run` and the diagnostic `docker version`
   — six control calls (`CHAMADAS_DE_CONTROLE_NO_START`).
   The api waits 10 + 6 × 30 + 5 = **195 s** (`TETO_DE_MUTACAO_MS`); the engine,
   in `RunnerRouter`, 6 × 30 + 5 = **185 s** on `start` and 4 × 30 + 5 =
   **125 s** on `stop`/`remove` (it was 60 s, less than the `resolver` plus the
   operation).
5. **The engine's `propose_action` waits for the execution the api does inside
   it.** Auto-approved `container_start`, `container_start_via_runner` and `container_stop`
   are EXECUTED in the same request
   (`ProposeActionUseCase`), and the call fell back to Req's 15 s default — a
   long `start` came back as a transport timeout even without a pull. Now it
   carries a `receive_timeout` of **225 s** (the api's ceiling + 30 s), mirrored in the api
   as `TETO_DO_PROPOSE_ACTION_DE_CONTAINER_NO_ENGINE_MS`; the tests on both
   sides check broker < api < engine and runner < engine. `container_remove`
   stays out: it is never born auto-approved.

No new dependency ([ADR 0128](../adr/0128-porta-de-docker-e-a-prova-de-empacotamento.md)), no field
the caller writes ([ADR 0130](../adr/0130-broker-de-container.md)): the image
keeps coming from the Arquiteto's decision, and `pull` is not a new broker operation
— it is a step of `start`.

**Declared, not closed:**

- **A big image does not come up on the first attempt**, neither through the broker nor through the
  runner — the maintainer's decision D. The outcome is now named; the fix is
  downloading the image beforehand on the host.
- **In the worst failure case, the approval stays stuck for up to ~195 s**:
  `ExecuteContainerStartUseCase` runs inside the approval `POST`, and neither the
  web nor the HTTP server has its own ceiling.
- It was not measured whether the layers downloaded before the cancellation are
  reused on the next attempt.

- **Code:**
  `packages/docker-port/src/docker-cli.ts:192` (`PullExcedeuTetoError`),
  `:553` (`garantirImagem`), `:115` (`CHAMADAS_DE_CONTROLE_NO_START`),
  `:106` (`TIMEOUT_DE_CONTROLE_MS`);
  `apps/broker/src/servidor.ts:199` (`PullExcedeuTetoError`);
  `apps/api/src/infrastructure/http-clients/container-broker.client.ts:205` (`TETO_DE_MUTACAO_MS`),
  `:175` (`CHAMADAS_DE_CONTROLE_NO_START`),
  `:228` (`TETO_DO_PROPOSE_ACTION_DE_CONTAINER_NO_ENGINE_MS`);
  `apps/engine/lib/engine/sessions/engine_api_client.ex:1872` (`opcoes_do_propose_action`),

  `apps/engine/lib/engine/sessions/engine_api_client.ex:1872` (`opcoes_do_propose_action`),
  `:1649` (`@teto_do_propose_action_de_container_ms`);
  `apps/engine/lib/engine/runners/runner_router.ex:52` (`@timeout_do_start_ms`)
- **Test:** `packages/docker-port/src/docker-cli.spec.ts:425` (describe of the
  reproduction, "(AT-234)": the 45 s pull ends NAMED, `:457`; daemon down
  stays daemon down, `:481`; the pull that fits comes up, `:493`; a present image
  is not downloaded, `:508`; the six calls, `:520`);
  `apps/broker/src/servidor.spec.ts:317` (504 with origin `infra`);
  `apps/api/test/infrastructure/http-clients/container-broker.client.spec.ts:144`
  (arrives with `origem`), `:362` and `:377` (the math and the order);
  `apps/runner/src/index-handlers.spec.ts:420` (the name in the
  `container_start_result`);
  `apps/engine/test/engine/sessions/engine_api_client_propose_action_test.exs:67`
  (real HTTP: the api that takes 16 s is waited for), `:82` and `:95` (the actions and the
  order, reading the api's mirror);
  `apps/engine/test/engine/runners/runner_router_test.exs:183`
- **Origin:** AT-234

## Deciding in the chat, where the owner is (RN-626)

### RN-627 — The project container runs as the folder's owner, measured by the api {#rn-627}

Under `--cap-drop ALL` the container's root lacks `CAP_DAC_OVERRIDE` and cannot
write to the project folder, which belongs to the operator's uid: `npm install` gave
`EACCES` for every dev agent (AT-247, [ADR 0180](../adr/0180-container-com-o-dono-da-pasta.md)).

1. **The api measures, the broker composes.** `container-spec` returns `usuarioDaPasta`
   (`stat` of the folder for the `container`/`mounted` modes; `null` if the folder is not
   reached, if the owner is root or if the project is `runner`). The broker copies it
   into `spec.usuario` and the adapter emits `--user uid:gid` and `--env HOME=/tmp`.
2. **It never comes from the requester.** `start` has no body and the `exec` body ignores
   extra fields; `exec` inherits the container's user.
3. **The broker revalidates.** Integers in 1..2^31-1; `0` is refused naming
   `usuario.uid`/`usuario.gid` (root is the absent one, "as always").
4. **It does not loosen containment**: `--cap-drop ALL`, one bind, a two-valued network
   and five operations remain. An already created container only changes when recreated.

- **Where:** `packages/docker-port/src/docker-cli.ts:637` (`argsDeCriacao`),
  `packages/docker-port/src/spec-de-container.ts:141` (`usuarioValidado`),
  `apps/broker/src/operacoes.ts:385` (`especificacaoDoProjeto`),
  `apps/api/src/application/use-cases/containers/obter-spec-de-container.use-case.ts:110`
  (`ObterSpecDeContainerUseCase`)
- **Test:** `packages/docker-port/src/docker-cli.spec.ts` (the `run` carries
  `--user` and still has no free field), `packages/docker-port/src/spec-de-container.spec.ts`
  (`usuario`), `apps/broker/src/operacoes.spec.ts` ("o usuário do container"),
  `apps/api/test/application/use-cases/containers/spec-e-observacao-de-container.use-case.spec.ts`
- **Origin:** AT-247

## The Anamnese does not pay twice for the same window, and gate rescue does not restart a cycle that waits for someone (RN-722)

### RN-738 — Stopping a project container is immediate, and the `/containers` row rereads on deciding {#rn-738}

- **Rule:** every project container starts with `--init` — a CONSTANT of the
  `docker run` composition in `DockerViaCli`, never a spec field (the
  containment is the type, ADR 0130); it applies to the broker and to the runner, which use
  the same port. The wait command (`sleep infinity`) was PID 1 with no
  SIGTERM handler, and the kernel does not deliver a default-action signal to PID 1: `docker
  stop` waited the 10 s and killed (`Exited (137)`). Measured in a disposable
  container: 10.25 s without `--init`, 0.20 s with. On the `/containers` page,
  deciding the pending action (approve, deny, always allow) invalidates
  `['containers-overview']` and `['container-lifecycle', projectId]` in the
  `finally` — also when the call fails or drops —, and returns the promise to the
  card. No new poll (RN-579/632).
- **Where:** `packages/docker-port/src/docker-cli.ts:637` (`argsDeCriacao`),
  `apps/web/src/routes/ContainersPage.tsx:72` (`invalidateContainers`), `:183`
  (`aprovar`)
- **Test:** `packages/docker-port/src/docker-cli.spec.ts` (`run` carries
  `--init` before the command), `apps/broker/src/contencao-do-brabo.spec.ts`
  (both modes start with `--init`), `apps/web/src/routes/ContainersPage.test.tsx`
  (approving rereads overview and lifecycle; a refused approval still rereads)
- **Origin:** AT-422 (local installation, 10/03: three `executed` stops with the
  row in "rodando" and `Exited (137)`)

### RN-807 — An `exec` that exceeds the ceiling comes back as an overflow, and the command dies inside the container {#rn-807}

- **Rule:** the overflow of the `DockerPort`'s `exec` ceiling is decided by the
  CLOCK (elapsed ≥ ceiling) besides `killed`, because the `docker exec` client
  catches the SIGTERM of `execFile`'s `timeout` and exits with code 0 — measured:
  `sleep 30; echo FIM` under a 3s ceiling came back `erro: null`, `stdout: ""`, and the
  adapter returned `exitCode: 0`. An agent command that exceeded the 120s
  came back "exit 0", and QA approved a suite that hangs. The overflow now returns
  `exitCode: -1`, `timedOut: true` and the timeout mark. And killing the client does not
  kill the command: `exec` wraps the command (which stays as ONE argument,
  intact) in an `sh` that records its own PID — group and session leader,
  because the runtime does `setsid` on every `docker exec` — in the container's `/tmp`;
  on overflow the adapter kills the GROUP by that PID (SIGKILL), in an internal
  call, without a new operation on the port (ADR 0130). Measured and refused: busybox's
  `timeout` inside the `sh -c` — the watcher dies with the client and the `sleep`
  survives. If killing fails (`/tmp` not writable, for example), the mark says
  the process may have survived.
- **Where:** `packages/docker-port/src/docker-cli.ts:269` (`estourouOTeto`),
  `packages/docker-port/src/docker-cli.ts:455` (`matarExecEstourado`)
- **Test:** `packages/docker-port/src/docker-cli.spec.ts` ("erro nulo depois do
  teto É estouro"; "no estouro mata o grupo do comando DENTRO do container";
  "o comando que estoura volta timedOut e MORRE dentro do container", against
  real Docker, skipped without a daemon)
- **Origin:** AT-482

### RN-820 — The project container comes back on its own when the daemon restarts {#rn-820}

- **Rule:** the `docker run` composed by `DockerViaCli` carries
  `--restart unless-stopped` as a CONSTANT, next to the `--init` of
  [RN-738](#rn-738) — the spec gains no field, and ADR 0130's containment does not
  change. A restarted daemon (system update) restarts the project
  container; an explicit `docker stop` (the lifecycle's `container_stop`) is NOT
  undone, because `unless-stopped` does not restart what was stopped by hand — never
  `always`. Measured: an `unless-stopped` container stopped with `docker stop` stays
  `exited` with `RestartCount=0`.
- **Where:** `packages/docker-port/src/docker-cli.ts:637` (`argsDeCriacao`)
- **Test:** `packages/docker-port/src/docker-cli.spec.ts` ("cria o container
  com rótulo gerenciado, UM bind e as capabilities derrubadas")
- **Origin:** AT-494 (the restarted daemon left every project container
  `Exited (143)` with the `running` record)
