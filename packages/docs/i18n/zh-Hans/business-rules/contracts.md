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

### RN-028 — 由 capability 决定，而不是提供方的名称 {#rn-028}

不支持的操作（本地提供方上的分支保护）在
`capabilities` 中声明，并以 `GitNotSupportedError` 拒绝——永远不会静默失败。

共有**四种** capability：自第 2 阶段起的 `protectBranch` 和 `pullRequests`，以及自 FASE 26 起的
`listTree` 和 `pullRequestDiff`（Code 标签页，只读）。规则并没有因它们而改变——改变的是覆盖范围。而声明的标准仍然是证明：只有当测试套件在该提供方上执行了它时，capability 才是 `true`；没有证明就声明为 `false` 并降级（与 ADR 0041/0042 的标准相同）。

- **位置：** `packages/shared/src/index.ts`（`GitProviderCapabilities`）；两个读取操作的上限在
  `apps/api/src/domain/git/git-read-limits.ts` 中，不放在 shared 中，因为 shared 100% 是类型
- **测试：** 唯一的契约套件 `test/contract/git-provider.contract.ts`，针对三个提供方运行
- **来源：** [ADR 0001](../adr/0001-git-provider-contract-shape.md)

### RN-087 — Dev Lead 是执行的唯一外部地址 {#rn-087}

存在一个对话型 agent `dev-lead`，它接收 Arquiteto 的 handoff（自 [RN-672](api.md#rn-672) 起，来自 Infra，项目容器处于 `running`），并提议**执行计划**：每个模块多少个 agent 以及为什么。它不写代码——它分配工作并为之负责。

**在它之前，[RN-083](api.md#rn-083) 中"由 lead 决定"这句话没有主人。** Arquiteto 完成后，执行由一个按钮启动，中间没有人评估有多少工作。

**`dev-<modulo>` 不再能通过 handoff 寻址。** 这不是新的例外：这是 [ADR 0038](../adr/0038-hierarquia-de-agentes.md) 的规则——外部 handoff 只寻址区域的 lead 或没有区域的 agent——开始像对 QA 和 Infra 一样对 dev 生效。在没有 Dev Lead 时，它们是*没有*区域的 agent，因此是有效目标；成为成员后，就不再是了。

**`dev` 区域是第一个*动态*区域**，正是它迫使使用谓词：成员是 `module_map` 的每个模块一个，由 Arquiteto 决定，每个项目都不同，因此没有可枚举的列表。`dev-lead` 与成员匹配相同的 `dev-` 前缀，排除它的是通用规则**lead 永远不是自己区域的成员**——它适用于任何区域，只存在于一处。第一个版本在三处重复这个排除，变异检查表明没有一份副本是测试可达的：每一份都能在另一份被变异时存活。

**计划是 `proposed_action`（由 [ADR 0086](../adr/0086-dev-lead-plano-suspende-para-aprovacao.md)、[RN-284](engine.md#rn-284) 修订）。**
在这次变更之前，计划成为简单的*事件*，没有审批：理由是提议没有外部效果——花费发生在 agent 启动时，上限在那里要求授权；把提议变成待决定的动作会让你对同一件事决定两次。对 `docs/fluxo.yml` × 代码的审计发现，自 ADR 0085 起流程就已经把这个输出声明为 `via: proposed_action`，而代码从未被调整为一致——产品所有者判定是代码错了：计划是会话将在并行上花多少钱的*第一个*真实决定，用户开始在*看到*一次真正的审批之后才决定激活执行，而不只是读到消息流中的一行。旧的教训没有消失——它正是
`propose_execution_plan` *没有*进入 `decide.ts` 绝对上限块的原因（见 RN-284）。

***成功*的计划结束回合——在*没有*暂停的路径上。** 在第一次真实执行中，Dev Lead 在同一会话中登记了**两次** `execution.plan_proposed`——文本不同，总数相同——因为循环回到了模型，它又提议了一次。事件日志是不可变的：留下了两份提议，没有任何东西说明哪个有效。工具 spec 中"只用一次"的指示是请求，不是保证；保证的是循环停止。自 ADR 0086 起，当提议处于 `pending` 时，结束回合的是暂停的*停止*（RN-284）——立即成功（`auto_approved`/`executed`/`approved`，见 RN-284）继续以一贯的方式关闭循环。

**是成功，而不是"调用了工具"**：被拒绝的计划（空的，或某个模块零个 agent）让循环继续，否则拒绝会变成回合结束，模型永远没机会修正。这道防护的第一个版本只看工具名称，就有这个缺陷——是由行为测试发现的，而不是靠阅读。

空计划，或某个模块零个 agent 的计划，**在提议任何东西之前**就被拒绝——提议一旦创建，就是用户的真实决定，而一个提议了一半的计划无从撤回。

- **位置：** `apps/engine/lib/engine/agents/dev_lead_server.ex` 和
  `dev_lead_tools.ex`；寻址规则在
  `apps/api/src/domain/agents/agent-areas.ts`；handoff 在
  `application/use-cases/agents/offer-infra-handoff.use-case.ts`
- **测试：** `apps/engine/test/engine/agents/dev_lead_tools_test.exs`,
  `dev_lead_server_test.exs`（`o plano ENCERRA o turno`、`o plano recusado NÃO
  encerra o turno`），
  `apps/api/test/domain/agents/agent-areas.spec.ts`（`o dev de módulo DEIXOU de
  ser endereçável`、`` `dev-lead` É endereçável, apesar do prefixo ``）和
  `test/application/use-cases/agents/offer-infra-handoff.use-case.spec.ts`
- **来源：** [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md)，FASE 14d；
  审批机制由 [ADR 0086](../adr/0086-dev-lead-plano-suspende-para-aprovacao.md) 修订

### RN-110 — `blame` 是 `GitProviderContract` 的第 13 个操作，与其他读取使用相同的缺失词汇 {#rn-110}

FASE 26 中声明的 blame 待办事项的基础（还没有界面使用它——在下一波中到来）。`blame(ref, path)` 返回 `GitBlame | null`，`null` 的含义与在 `getFileContent`/
`listTree` 中完全相同：该 ref 中文件缺失，或 ref 不存在。同一个标签页有两种"不存在"的词汇，会让界面以两种方式处理同一种情形——这与之前两个操作已经适用的理由相同。

每个提供方用*自己*的手段计算，因为没有公共端点：GitHub 的 REST 中没有 blame（只有 GraphQL——这是该提供方唯一使用 GraphQL 的操作），GitLab 有 `repository/files/:path/blame`，本地则来自 `git blame --porcelain`，这是三者中唯一在本次会话中针对真实仓库测试过的（另外两个只针对契约测试的假后端——环境中没有 `GITHUB_TEST_TOKEN`/`GITLAB_TEST_TOKEN`，针对真实 API 的证明由手动 smoke 完成）。`GIT_BLAME_LINE_LIMIT`（2000）截断真正巨大的文件——在内容路由中已经按字节截断，但 `blame` 在决定之前会从提供方读取整个文件。

- **位置：** `packages/shared/src/index.ts`（`BlameInput`、`GitBlame`、
  `GitBlameLine`、能力 `blame`），
  `apps/api/src/infrastructure/git/{github,gitlab,local}-provider.ts`,
  `apps/api/src/domain/git/git-read-limits.ts`（`GIT_BLAME_LINE_LIMIT`），
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  （方法 `blame`），`apps/api/src/interfaces/http/git/code.controller.ts`
  （`GET /projects/:id/code/blame`）
- **测试：** `apps/api/test/contract/git-provider.contract.ts`（"blame" 块），
  由三个提供方 spec 运行——`local` 的那个针对真实 git——以及 `read-project-code.use-case.spec.ts`（"blame" 块）
- **来源：** FASE 26b（FASE 26/
  [ADR 0060](../adr/0060-superficie-de-leitura-de-codigo.md) 声明的待办事项的基础）

### RN-111 — `listPullRequests` 是 `GitProviderContract` 的第 14 个操作；可浏览列表按 id 打开同一个 diff {#rn-111}

`CodeDiffPanel.tsx` 在一个可点击的列表中使用 `listPullRequests(state?)`
（id/编号/标题/作者/状态/分支，带按状态的过滤）；点击一项会复用已经存在的*同一个*按 id 的 diff 流程——没有新的读取路径，只是让人*到达* id 而不必记住它。已经知道 id 的人（例如从审批页来的）仍然可以直接粘贴。

`listPullRequests(state?)` 为每个 PR 返回一个*摘要*
（`GitPullRequestSummary`：id、编号、标题、作者、状态、分支、
`updatedAt`）——而不是 `GitPullRequest`，后者是*写入*（打开/合并）的类型，从未有过标题或作者，因为两个操作都不需要。独立的类型避免写入获得只有读取才使用的字段。

`local` *有* PR——Fase 4a 的 sidecar 存储已经是来源，而题述中的假设（"纯本地仓库的概念中不存在 PR"）站不住：自那以后 dev agent 的自包含模式一直在创建本地 PR。三个能力都是 `true`。`GIT_PR_LIST_LIMIT`（100）只有一页，没有后续分页——这是供人浏览的，而不是历史同步。

- **位置：** `packages/shared/src/index.ts`（`ListPullRequestsInput`、
  `GitPullRequestSummary`、`GitPullRequestList`、能力
  `pullRequestsList`），`apps/api/src/infrastructure/git/{github,gitlab,
  local}-provider.ts`，`apps/api/src/domain/git/git-read-limits.ts`
  （`GIT_PR_LIST_LIMIT`），`read-project-code.use-case.ts`（方法
  `pullRequests`），`code.controller.ts`（`GET /projects/:id/code/pull-requests`），
  `apps/web/src/routes/code/CodeDiffPanel.tsx`（可点击列表、按状态过滤、复用按 id 的 diff 流程）
- **测试：** `git-provider.contract.ts`（"listPullRequests" 块），
  `read-project-code.use-case.spec.ts`（"lista de PRs" 块），
  `apps/web/src/routes/code/CodeDiffPanel.test.tsx`
- **来源：** FASE 26b

### RN-112 — `listBranchesDetailed` 是*独立*的操作，与 `listBranches` 分开 {#rn-112}

丰富下拉菜单的基础，现在由 `CodeBranchPicker.tsx` 使用
（`ahead`/`behind`、PR 徽章——FASE 26b 之后的那一波关闭了 `CodeShell.tsx` 声明的待办事项）。决定是*不*扩展 `listBranches`——最初的第 13 个操作，Gitflow 的 bootstrap 调用它，而不需要这些：丰富信息的代价是*每个分支*多一次对提供方的调用（GitLab 中是两次，它没有一次调用就返回比较两侧的端点，不像 GitHub 的 `compareCommitsWithBasehead` 和本地的 `git
rev-list --left-right --count`）。把这个代价附加到每次分支的采纳/创建上，会把 bootstrap 变成一次昂贵的扫描。两个操作在契约中共存：`listBranches` 给 bootstrap，`listBranchesDetailed`（第 15 个）给代码标签页——`GitBranchDetail` 只在*形式*上扩展 `GitBranch`，从不在调用者的*契约*上扩展。

`ahead`/`behind` 总是相对于仓库的*默认*分支
（`ListBranchesDetailedInput.defaultBranch`，调用者已经知道——再向提供方要一次，就是为了重新发现已经有的东西而多调用一次）。当提供方无法计算时（孤儿分支、无关的历史），两者都为 `null`，这是诚实的降级，绝不是编造的数字。`GIT_BRANCH_DETAIL_LIMIT`（30）出于 FASE 26 第 34 项同样的流量原因进行截断——没有它，一个有数百个分支的仓库每次打开下拉菜单就会变成数百次调用。

- **位置：** `packages/shared/src/index.ts`（`ListBranchesDetailedInput`、
  `GitBranchDetail`、`GitBranchDetailList`、`GitBranchPullRequestRef`、
  能力 `branchesDetailed`），`apps/api/src/infrastructure/git/{github,
  gitlab,local}-provider.ts`，`git-read-limits.ts`
  （`GIT_BRANCH_DETAIL_LIMIT`），`read-project-code.use-case.ts`（方法
  `branches`），`code.controller.ts`（`GET /projects/:id/code/branches`）；
  在 web 中，`apps/web/src/lib/api-client.ts`（`getCodeBranches`）和
  `apps/web/src/routes/code/CodeBranchPicker.tsx`——下拉菜单本身，从 `CodeShell.tsx` 打开
- **测试：** `git-provider.contract.ts`（"listBranchesDetailed" 块），
  `read-project-code.use-case.spec.ts`（"branches detalhadas" 块），
  `apps/web/src/routes/code/CodeBranchPicker.test.tsx`
- **边界情况：** `branches()` 方法位于与其他六个读取*相同*的用例中（`ReadProjectCodeUseCase`），而不是靠近 bootstrap——它是代码标签页的*读取*，具有与其他读取相同的凭据解析和相同的容器闸门（RN-105）；把它当作 bootstrap 的操作会把两者都重复一遍。分支列表之外的 ref（tag 或 sha）仍然可达——下拉菜单的页脚有一个手动输入框，因为 `listBranchesDetailed` 不枚举这两样东西。
- **来源：** FASE 26b（基础）；下一波关闭了 UI

## `implementavel` gate 激活——QA 策略作为 qa-lead 的第二个时刻（RN-340/341，ADR 0090）

### RN-341 — QA 策略是 qa-lead 的第二个**时刻**，并且从不挂起 {#rn-341}

`docs/fluxo.yml` 把 `qa-estrategia` 角色声明为 `proposto`，拆分标准写在注册表本身中：“pode ser o próprio
qa-lead em segundo MOMENTO, não necessariamente agente novo — a separação é
de entregável”。[ADR 0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md)
恰好构建了这一点：`Engine.Gates.QaEstrategiaAgent` 是**无状态**模块（不是 `GenServer`），由 `Engine.Gates.QaLeadServer.run_design/3` 触发——在**同一个** `qa-lead` 进程中一个**新的**、**附加的**入口，不触碰
`run/2`（一贯的路径，PR 评审，绑定到
`DevAgentState.find_by_task_id`）。

**上下文是**轻量的**，交付物的分离正体现在这里。**
`Engine.Gates.QaEstrategiaContext.fetch/3` 只获取用户故事（来自
`EngineApiClient.list_backlog/1`，PO 已经在读的树——[RN-164](engine.md#rn-164)）和当前的 `module_map`（来自 `EngineApiClient.get_infra_context/2`，Infra Lead 消费的**同一个**
`GetInfraContextUseCase`，这里只用 `moduleMap` 字段）——**没有** `dev_state`，**没有** `worktree_path`：`implementavel` gate 在 **dev 之前**运行，那时还不存在 dev agent、worktree 或 `task_id`。api 中没有新路由——这两个函数早已存在。

**从不挂起。** 工具注册表（`ReadFile`、`SearchWorkspace`、
`EmitPlanoDeTeste`）不包含 `terminal` 也不包含 `write_file`——这是 `Engine.Harness.Hooks.ActionPipeline` 拦截以创建
`proposed_action` 的**仅有的两个**工具。没有任何调用经过操作流水线，这个智能体的
`ToolLoop` 永远不会产生 `:pending`，`run_design/3` 在自己的 `handle_cast` 中**同步**运行——没有挂起/恢复机制，与 QA 领域的其余部分不同。

**迭代上限保持 8（对话型），而不是 60（gate）——是有意为之，不是缺口。** 这个智能体在没有 `token_budget_micros` 的情况下运行——还没有任务，也没有任务预算。[RN-085](engine.md#rn-085) 的标准不是“谁工作量大”：而是“在迭代上限之外是什么在约束花费”。下面没有预算，提高上限会放大最坏情况而没有任何东西来遏制——这与 `infra-workflows` 即使使用工具也保持在 8 的原因**相同**。`"qa-estrategia"` **没有**在
`Engine.Harness.Iteracoes.tipo/1` 中获得自己的子句：落入默认值是正确的决定。

交付物——`emit_plano_de_teste`（综述、可验证的可执行标准、**通用**且不绑定框架的自动化策略——这是本战线的范围决定，写在模型读取的 `spec/0` 中，而不是代码中的校验）——变成制品 `artifact.plano_de_teste`
（`ArtifactEmitter.emit/5`，schema 经过校验，`criteriosExecutaveis` 不能为空），位于调用 `run_design/3` 的**同一个**会话的事件日志中——`assess_implementability`（[RN-340](api.md#rn-340)）之后就在那里读取它。失败（迭代上限、预算、模型停下而没有发出）**从不**是沉默的：带来源的持久 `agent.error`，与
[RN-059](engine.md#rn-059) 标准相同。

**自 [RN-674](engine.md#rn-674)（ADR 0192）起，**时刻**变了。** 第二个时刻仍然属于 `qa-lead`，没有新智能体，并且仍然从不挂起；但它在交付**之后**运行，在 `run/2` 循环的开始，带着 dev 的 worktree 和 diff 中的文件——`run_design/3` 和 `QaEstrategiaContext` 被移除，制品获得了 `taskId`。上限仍是 8，现在下面**有**任务的预算。

- **位置：** `apps/engine/lib/engine/gates/qa_estrategia_agent.ex`、
  `qa_lead_server.ex`（`run_area/3`，自 [RN-674](engine.md#rn-674) 起）、
  `tools/emit_plano_de_teste.ex`、`hooks/termination_plano_de_teste.ex`；
  `apps/engine/lib/engine/harness/artifact_schemas.ex`（`plano_de_teste`）；
  `apps/engine/lib/engine/harness/iteracoes.ex`（**没有**新子句，见上文）；`docs/fluxo.yml`（`qa-estrategia`、`status: active`）
- **测试：** `apps/engine/test/engine/gates/qa_estrategia_agent_test.exs`、
  `qa_lead_server_test.exs`（describe "plano de teste da entrega (ADR 0192)"）、`apps/engine/test/engine/harness/artifact_schemas_test.exs`
  （describe "plano_de_teste"）、`iteracoes_test.exs`（"qa-estrategia é
  conversacional DE PROPÓSITO"）
- **来源：** [ADR 0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md)

---

## `secops-runtime`——基于 `rate_limit_hits` 的滥用报告（RN-375..377，ADR 0091）

### RN-377 — “未测量”小节是永久的，并按名称列出三个缺口 {#rn-377}

`montarRelatorio` 总是包含 `naoMedido`：自动事故检测、事故响应和安全事后复盘。三者都依赖于 `docs/fluxo.yml` 早已为 `secops-runtime` 声明的同一个触发条件——真实的生产流量——它们没有一个用示例事故或编造的数字来模拟（与 ADR 0041/0042/0077 相同的原则：没有真实数据，缺口保持可见而不是伪装）。只有当产品有真实流量可供对照测量时，该小节才会离开列表——它不是下次清理时要删除的 TODO。

- **位置：** `apps/api/scripts/relatorio-seguranca-runtime.ts`、
  `apps/api/package.json`（`relatorio:seguranca-runtime`）
- **测试：** `apps/api/test/scripts/relatorio-seguranca-runtime.spec.ts`
- **ADR：** [0091](../adr/0091-secops-runtime-relatorio-de-abuso.md)

---

## `platform` 获得第一个交付：按需的遥测报告（RN-385/386，ADR 0092）

### RN-385 — `platform` 角色以一次性读取的**脚本**诞生，基于与 `DomainGaugesCollector` 相同的数据源 {#rn-385}

`docs/fluxo.yml` 把 `platform`（`camada_plataforma`）描述为“SRE / Platform
— dono do loop de retorno”，`status: planned`，激活与
`DEPLOY_ENABLED` 同步——而后者不存在。产品负责人决定提前实现背后已有真实数据的那一半：`pnpm --filter api relatorio:telemetria
[--projeto <uuid>] [--json]` 按需读取 `DomainGaugesCollector` 早已每隔 `METRICS_GAUGE_INTERVAL_MS` 为 Prometheus 抓取回答的**相同**问题——每个项目的活动/closing 会话、每个项目的阻塞任务、最后一次备份的状态（年龄、状态、大小，总是**全局**的，从不按项目，因为产品只有一个备份）。它不是 LLM 智能体，也不是
`GenServer`：是独立的、无状态的读取，打印后即结束。

SQL 查询是**复制**的，而不是从收集器导入——它的方法
（`collectSessions`/`collectBlockedTasks`/`collectBackup`）是私有的，并以写入 Prometheus gauge 结束（`this.metrics.*.set(...)`）；没有一个纯粹“只有查询”的那一半可以复用，而不把独立脚本耦合到 NestJS 一个 `@Injectable` 的生命周期上。脚本也**不是**第二个收集器：它不注册任何指标，不在 `setInterval` 中运行。

输出总是带有“在哪里看更多”（`deploy/k8s/observability/dashboards/*.json` 中三个版本化的仪表盘、
`deploy/k8s/observability/alerts/brabo-alerts.yaml` 中的告警、`docs/runbook.md
#observabilidade` 以及用于本地可观测性的 `pnpm dev:obs`）——脚本**链接**到已有的东西，从不复制。

- **位置：** `apps/api/scripts/relatorio-telemetria.ts`；镜像
  `apps/api/src/infrastructure/observability/domain-gauges.collector.ts`
- **测试：** `apps/api/test/scripts/relatorio-telemetria.spec.ts`（纯函数——`parseArgs`、`formatarIdade`、`formatarBytes`——与
  `medir-execucao.spec.ts` 相同的切分：与数据库交互的部分通过针对真实数据库运行脚本来检验）
- **ADR：** [0092](../adr/0092-platform-relatorio-de-telemetria-sob-demanda.md)

### RN-386 — 遥测报告不加编造地声明它**不**测量什么 {#rn-386}

`platform` 角色的真实触发条件（`DEPLOY_ENABLED`）不存在：没有带真实流量的生产环境，产品中任何地方都没有定义数值 SLO，没有真实事故就不可能有事后复盘。
`relatorio-telemetria.ts` 在**自己的**输出中，在“未测量”小节里说明这一点，而不是假装有它没有的覆盖——与 ADR 0042 对模型说明、ADR 0077 对代码质量相同的纪律：没有真实数据，产品**声明**缺口，从不编造数字。

三个缺口，全部明确：**正式的数值 SLO**（没有定义任何一个）；**事后复盘**（依赖于尚未发生的真实事故）；以及**闭环地回流到产品的遥测**（脚本是按需的一次性读取——自行观察、决定和行动才是让
`platform` 在 `docs/fluxo.yml` 中变为 `active` 的东西，因此该角色的 `gate_saida: { id:
operavel, status: planned }` 保持 `planned`，未被这次变更触动）。

- **位置：** `apps/api/scripts/relatorio-telemetria.ts`（`imprimir` 函数，
  “Não medido”小节）；`docs/fluxo.yml`（`camada_plataforma › platform ›
  saidas_alvo`，制品 `telemetria-consolidada`，字段 `nota`）
- **测试：** 间接覆盖——该小节是固定文本，通过阅读文件来验证；这里没有需要测试的条件性真值（在“已测量”和“未测量”之间除了文本本身没有什么可出错的）
- **ADR：** [0092](../adr/0092-platform-relatorio-de-telemetria-sob-demanda.md)

---

## 审计 fluxo.yml × 代码——第 2 波：后端中的 RN-160 以及 Dev Lead → dev 的委派（RN-404/405，ADR 0094）

### RN-405 — Dev Lead → dev 的委派变成 `delegations` 中的数据，`parecerArtifactId` 重新定义为“为决定提供依据的东西” {#rn-405}

ADR 0053（FASE 14d）早已预见 Dev Lead → `dev-<modulo>` 的委派是“与 QA 和 Infra 相同的路径”（`delegations`，`area = 'dev'`），但宣布它在范围之外。`dev_lead_server.ex` 从未写入这张表——只有 QA（`qa_lead_server.ex`）和 Infra（`infra_lead_server.ex`）写入，两者都在 **ENGINE** 一侧，因为子智能体正是在那里产生一个为 `parecerArtifactId` 提供依据的**意见**（单轮判定）。

Dev Lead 没有这种模式：`dev-<modulo>` 的激活发生在 API 一侧，在 `AcceptParallelizationUseCase.execute` 中——既由直接路径调用（`RequestParallelizationUseCase`，低于
[RN-083](api.md#rn-083) 的会话上限），也由批准路径调用（`ExecuteParallelizationUseCase`，在用户批准类型为 `parallelize` 的 `proposed_action` 之后）。写入被放在该方法**内部**——免费覆盖两条路径，因为两者本来就汇聚于此——`status: 'completed'` 为这个领域**重新定义**：它意味着“委派已**生效**”（智能体已启动），而不是像 QA/Infra 中那样“子智能体完成并发出了意见”（决定记录在
[ADR 0094](../adr/0094-delegacao-dev-lead-vira-dado.md) 中）。

`parecerArtifactId` 指向项目最近且当前有效的 `artifact.module_map` 事件的 `id`——通过
`SessionEventRepository.listByTypeForProject(projectId, 'artifact.module_map')`
获取（已有的通用方法，`computeCoverage` 用它来获取
`artifact.business_rule`；没有编写新查询，只是多调用一次——列表的最后一项是最新的，因为函数按 `createdAt` 升序排列）——即为委派决定提供依据的制品。`area: 'dev'`、`leadAgent: 'dev-lead'`，`subagent` 是被激活智能体的确切 id（`extraDevAgentId(module)`，在用例其余各处构建 id 的**同一个**函数——没有新格式）。项目中没有 `artifact.module_map` 时（不应发生——它是 `docs/fluxo.yml` 中 Dev Lead 的必需输入），委派**不会**以一个编造的 id 被写入：只记录这一意外状态，依据与 RN-059 相同的教训（从不静默失败，但也从不假装一个不存在的依据）。而 `RecordDelegationUseCase.execute` 的失败（例如数据库宕机）会被捕获并记录，从不传播——当尝试写入委派时，dev agent 的激活已经成功，不能被一次辅助写入搞垮。

- **位置：** `apps/api/src/application/use-cases/execution/accept-parallelization.use-case.ts`
  （`recordDevDelegation`，在 `execute` 末尾调用）
- **测试：** `apps/api/test/application/use-cases/execution/accept-parallelization.use-case.spec.ts`，
  describe "delegação Dev Lead → dev (área dev, ADR 0094)"——以
  `area: 'dev'` 写入并指向最近的 module_map；没有 module_map 时不写入（也不抛出）；`RecordDelegationUseCase` 失败不会搞垮激活
- **ADR：** [0094](../adr/0094-delegacao-dev-lead-vira-dado.md)

---

## 审计 fluxo.yml × 代码——第 6 波（最后一波）：`necessidade-validada` gate（RN-406，ADR 0095）

关闭审计计划的最后一个发现（D 节，
`docs/explanation/auditoria-fluxo-vs-codigo.md`）——B2。其他五波已经关闭（第 3、4、5 波由 ADR
0089/0090 不按顺序提前完成；第 1、2 波在之前的 PR 中）。`docs/fluxo.yml`（`criativo` 角色）自 ADR 0085 起就声明了 `gate_saida: { id: necessidade-validada, status:
proposto }`，背后却没有任何机制——而
`modelo-de-time.md` 早已记录了原因：由 Criativo（模型）自己决定它产出的需求已经通过验证，那是自我验证，不是真正的 gate。

### RN-406 — `necessidade-validada` gate 由用户**单独**的一次点击关闭，从不由 Criativo 自我验证 {#rn-406}

> **由 [ADR 0185](../adr/0185-estou-pronto-fecha-os-dois-gates.md)
> （[RN-657](api.md#rn-657)）修订，依据负责人 9月30日 的决定。** 点击不再是**单独**的：“我准备好了——需求已验证”在同一个 POST 中写入
> `readiness.confirmed` 和 `necessity.validated`，`product_brief` 在点击**之后**产出（`productBriefId: null`）。“确认需求已验证”按钮从屏幕上移除。这条规则仍然有效的部分：验证者总是一个**人**，从不是 Criativo；该 gate 仍是
> `warn`。`POST .../agents/criativo/validate-necessity` 仍保留在 api 中，屏幕上没有消费者——它是“我准备好了”早于 ADR 0185 的会话的路径。下文是 ADR 0095 的设计，作为历史保留。

`SessionPage.tsx` 获得第三个确认按钮，与“我准备好产出了”（RN-142）和“确认架构就绪”（[RN-160](web.md#rn-160)）**相同**的交互模式：“确认需求已验证”
（`handleValidateNecessity`）调用 `POST
.../agents/criativo/validate-necessity`，后者写入 `necessity.validated`，其 `payload.productBriefId` 指向会话中最近的 `artifact.product_brief`。

按钮只在 `confirm_readiness` 已经整合出
`product_brief` **之后**才启用（`hasProductBrief`，`events.some(e => e.type ===
'artifact.product_brief')`）——“验证”一份尚未产出的执行摘要没有意义，这也是与 `docs/fluxo.yml` 最一致的解读：`necessidade-validada` 是 Criativo 的**出口** gate，即它的工作已经交付了具体制品的那一刻。`ValidateNecessityUseCase` 在**后端**重新校验同一前提（`SessionEventRepository.listByTypeInSession(sessionId,
'artifact.product_brief')`，按 `seq` 取最后一个）——仅靠禁用的 UI 不够，与 [RN-404](api.md#rn-404) 相同的教训。

与 `OfferInfraHandoffUseCase`（RN-160）不同，这次确认**不**通知 engine：Criativo→PO 的 handoff 已经在
`confirm_readiness` 内部发生
（`CriativoServer.executar_confirm_readiness/1`），所以没有任何智能体在等待这个事件——它只是一个人验证了已交付内容的**实质**的记录。`ValidateNecessityUseCase` 的构造函数不接收 `ApiToEngineClient`。

`docs/gates.yml` 获得 `necessidade-validada` gate：`status: active`、
`aprovacao_humana: true`（字面上就是一次人的点击）、
`verificacao: script`，但 `severidade: warn`——如今产品中没有任何东西在让 PO 继续之前**查询**这个 gate 是否通过（不同于
`story-promovida`/`plano-de-adocao`，它们是 `block`，因为有真实的代码锁阻止它们被跳过）。`docs/fluxo.yml`（`criativo` 角色）从 `status: proposto` → `status: ativo`。

- **位置：** `apps/api/src/application/use-cases/agents/validate-necessity.use-case.ts`；
  `apps/api/src/interfaces/http/agents/agents.controller.ts`
  （`validateNecessityHandoff`）；`apps/web/src/routes/SessionPage.tsx`
  （`hasProductBrief`、`necessidadeJaValidada`、`handleValidateNecessity`）
- **测试：** `apps/api/test/application/use-cases/agents/validate-necessity.use-case.spec.ts`
  ——没有 `product_brief` 时，在写入任何事件**之前**拒绝；有一个或多个时，写入并引用**最近**的那个；
  `apps/web/src/routes/SessionPage.validar-necessidade.test.tsx`——没有 `product_brief` 时按钮禁用，有时启用，在
  `necessity.validated` 之后消失
- **ADR：** [0095](../adr/0095-gate-necessidade-validada.md)

---

### RN-407 — PO 读取交付漏斗和部分 DORA，第三种限定于项目的读取 {#rn-407}

PO 获得了第**三个**读取工具——`listar_metricas_de_produto`
（`:direct`，没有任何参数）——由
`GET /internal/projects/:projectId/product-metrics` 提供，与 [RN-164](engine.md#rn-164) 的两个兄弟工具设计相同：范围封闭在项目内，没有搜索词，没有分页。

`docs/fluxo.yml`（`po` 角色，输入 `metricas-de-produto`）自 [ADR 0089](../adr/0089-analytics-e-delivery-metricas-como-relatorio.md) 起声明
`status: lacuna`，而该 ADR 早已交付了**数据**——脚本 `pnpm --filter api analise:funil`
从 `proposed_actions` 测量真实的 会话 → commit → PR → merge 漏斗、真实的前置时间和真实的部署频率。缺少的只是**机制**：PO 从来没有办法在轮次内重读这份报告。这关闭了 `fluxo.yml` × 代码审计
（[docs/explanation/auditoria-fluxo-vs-codigo.md](../explanation/auditoria-fluxo-vs-codigo.md)）的 B4 项——“团队模型 backlog”表（docs/explanation/backlog.md）中的**最后**一个待办，此后该表为空。

**计算**与脚本**相同**，从不重复：纯函数
（`calcularFunil`/`calcularLeadTimes`/`leadTimeMedioMs`/
`deploymentFrequencyPorDia`）和组装 `AcaoGit[]` 的查询
（`buscarAcoesGitDoFunil`）从 `apps/api/scripts/analise-funil.ts`
提取到 `apps/api/src/application/services/funil-metrics.ts`——`src/` 中的用例不能从 `scripts/` 导入，脚本改为从那里**重新导出**而不是在本地定义，签名和行为都不变（脚本的回归测试无需改动仍然通过）。

路由返回的 JSON 请求体对脚本早已以文本声明的三个永久缺失项**没有任何字段**（“有意不测量”：完整的产品漏斗 构思 → commit、按功能的采用证据、MTTR/变更失败率）——报告的形状从未为它们预留空间。PO 的工具在返回给模型的**文本**中总是按**名称**列出这三项，而不只是在数字为零时：没有这一节，PO 只会读到漏斗的数字，并通过遗漏得出没有任何缺口的结论。

- **位置：** `apps/api/src/application/services/funil-metrics.ts`；
  `apps/api/scripts/analise-funil.ts`（重新导出）；
  `apps/api/src/application/use-cases/backlog/list-product-metrics.use-case.ts`；
  `apps/api/src/interfaces/http/internal/internal-projects.controller.ts`；
  `apps/api/src/interfaces/http/internal/dto/product-metrics.response.dto.ts`；
  `apps/engine/lib/engine/harness/tools/listar_metricas_de_produto.ex`；
  `apps/engine/lib/engine/agents/po_server.ex`；
  `apps/engine/lib/engine/sessions/engine_api_client.ex`
- **测试：** `apps/api/test/application/use-cases/backlog/list-product-metrics.use-case.spec.ts`；
  `apps/api/test/scripts/analise-funil.spec.ts`（回归——继续从 `scripts/analise-funil.ts` 导入，未作修改）；
  `apps/engine/test/engine/harness/tools/listar_metricas_de_produto_test.exs`；
  `apps/engine/test/engine/agents/po_server_test.exs`
- **来源：** 与 [RN-164](engine.md#rn-164) 相同的模式（限定于项目的智能体读取，没有外部效果，没有 `proposed_action`）；数据来自
  [ADR 0089](../adr/0089-analytics-e-delivery-metricas-como-relatorio.md)——这条 RN 只关闭了缺少的读取机制。

## 仓库在给 Arquiteto 的 handoff 接受时诞生，没有它执行就不开始（RN-582）

### RN-605 — 镜像拉取是 `start` 的一个「具名」步骤，在控制上限之下，超时会说明大镜像启动不了 {#rn-605}

Docker 端口的 `start` 原本不做拉取：是 `docker run` 在内部做的，在 `TIMEOUT_DE_CONTROLE_MS`（30 秒）之下。在 AT-234 中用守护进程替身（镜像缺失、45 秒拉取、不休眠、无网络）复现：超时以 `ComandoDeDockerFalhouError` 发出——「`docker run …` terminou com código -1:
(sem saída de erro)」——，在 broker 中变成 `origem: null` 的 502，到达 api 时没有名字。而杀掉 CLI 会「取消」拉取（在 Docker 29.8.0、containerd 上测得）：在随后的 60 秒内镜像仍然缺失，所以「o pull pode
seguir no daemon」这句话不成立。

在测量过的四种出路中（约 300 秒的自有上限、异步 `start`、在镜像决定时提前拉取、只给名字），维护者决定了 **D——只给名字**（2026-09-27）。规则：

1. **拉取是显式的。** 在 `run` 之前先 `image inspect`；已存在的镜像不会被再次下载（与 `run` 的 `--pull missing` 相同）。缺失时，在「同样」30 秒的控制上限下执行 `docker
   pull`——没有更大的上限。
2. **超时有名字。** `PullExcedeuTetoError`，来源 `infra`，带有镜像、上限和完整的后果：拉取被取消，镜像仍然缺失，大镜像无法经由这条路径启动，修复办法是事先在宿主机上下载。在断言这一点之前，适配器检查守护进程（`docker version`）：守护进程宕机仍是 `DockerIndisponivelError`。因其他原因失败的拉取走一贯的路径（`ComandoDeDockerFalhouError`，没有来源，ADR 0128）。
3. **名字会穿过去。** broker 以 `origem: 'infra'` 回应 504，api 在 `BrokerRecusouError` 中转发它——`origem` 有值，绝不是 `null`。在 `runner` 模式中，同一个适配器在用户机器上运行，消息在 `container_start_result` 中到达。
4. **等待 `start` 的一方的上限计算完整的最坏情况**：`resolver` 的两个 `ps`、`image inspect`、`pull`、`run` 以及诊断用的 `docker version`——六次控制调用（`CHAMADAS_DE_CONTROLE_NO_START`）。api 等待 10 + 6 × 30 + 5 = **195 秒**（`TETO_DE_MUTACAO_MS`）；engine 在 `RunnerRouter` 中，`start` 等待 6 × 30 + 5 = **185 秒**，`stop`/`remove` 等待 4 × 30 + 5 = **125 秒**（以前是 60 秒，少于 `resolver` 加操作）。
5. **engine 的 `propose_action` 等待 api 在其内部进行的执行。** 自动批准的 `container_start`、`container_start_via_runner` 和 `container_stop` 在同一个请求中被「执行」（`ProposeActionUseCase`），而调用落入 Req 的 15 秒默认值——一个长的 `start` 即使没有拉取也会以传输超时返回。现在它带有 **225 秒**的 `receive_timeout`（api 的上限 + 30 秒），在 api 中镜像为 `TETO_DO_PROPOSE_ACTION_DE_CONTAINER_NO_ENGINE_MS`；两边的测试核对 broker < api < engine 以及 runner < engine。`container_remove` 不在其中：它从不以自动批准诞生。

没有新依赖（[ADR 0128](../adr/0128-porta-de-docker-e-a-prova-de-empacotamento.md)），也没有调用方可以写的字段（[ADR 0130](../adr/0130-broker-de-container.md)）：镜像仍然来自 Arquiteto 的决定，`pull` 不是 broker 的新操作——它是 `start` 的一个步骤。

**已声明、未关闭：**

- **大镜像第一次尝试启动不了**，无论通过 broker 还是 runner——维护者的决定 D。结果现在是点名的；修复办法是事先在宿主机上下载镜像。
- **在最坏的失败情况下，审批会被卡住最多约 195 秒**：`ExecuteContainerStartUseCase` 在审批的 `POST` 内运行，web 和 HTTP 服务器都没有自己的上限。
- 没有测量取消之前已下载的层是否会在下一次尝试中复用。

- **代码：**
  `packages/docker-port/src/docker-cli.ts:192`（`PullExcedeuTetoError`）、
  `:553`（`garantirImagem`）、`:115`（`CHAMADAS_DE_CONTROLE_NO_START`）、
  `:106`（`TIMEOUT_DE_CONTROLE_MS`）；
  `apps/broker/src/servidor.ts:199`（`PullExcedeuTetoError`）；
  `apps/api/src/infrastructure/http-clients/container-broker.client.ts:205`（`TETO_DE_MUTACAO_MS`）、
  `:175`（`CHAMADAS_DE_CONTROLE_NO_START`）、
  `:228`（`TETO_DO_PROPOSE_ACTION_DE_CONTAINER_NO_ENGINE_MS`）；
  `apps/engine/lib/engine/sessions/engine_api_client.ex:1872`（`opcoes_do_propose_action`），

  `apps/engine/lib/engine/sessions/engine_api_client.ex:1872`（`opcoes_do_propose_action`）、
  `:1649`（`@teto_do_propose_action_de_container_ms`）；
  `apps/engine/lib/engine/runners/runner_router.ex:52`（`@timeout_do_start_ms`）
- **测试：** `packages/docker-port/src/docker-cli.spec.ts:425`（复现的 describe，「(AT-234)」：45 秒的拉取以「点名」方式结束，`:457`；守护进程宕机仍是守护进程宕机，`:481`；放得下的拉取能启动，`:493`；已存在的镜像不被下载，`:508`；六次调用，`:520`）；
  `apps/broker/src/servidor.spec.ts:317`（带来源 `infra` 的 504）；
  `apps/api/test/infrastructure/http-clients/container-broker.client.spec.ts:144`
  （带 `origem` 到达）、`:362` 和 `:377`（计算和顺序）；
  `apps/runner/src/index-handlers.spec.ts:420`（`container_start_result` 中的名字）；
  `apps/engine/test/engine/sessions/engine_api_client_propose_action_test.exs:67`
  （真实 HTTP：延迟 16 秒的 api 被等到）、`:82` 和 `:95`（操作和顺序，读取 api 的镜像）；
  `apps/engine/test/engine/runners/runner_router_test.exs:183`
- **来源：** AT-234

## 在聊天中决定，就在负责人所在的地方（RN-626）

### RN-627 — 项目的容器以文件夹所有者的身份运行，由 api 测量 {#rn-627}

在 `--cap-drop ALL` 下，容器的 root 没有 `CAP_DAC_OVERRIDE`，无法写入属于操作员 uid 的项目文件夹：`npm install` 对每个 dev agent 都报 `EACCES`（AT-247，[ADR 0180](../adr/0180-container-com-o-dono-da-pasta.md)）。

1. **api 测量，broker 组装。** `container-spec` 返回 `usuarioDaPasta`（`stat` 读取 `container`/`mounted` 模式的文件夹；为 `null` 的情况：文件夹不可达、所有者是 root 或项目是 `runner`）。broker 把它复制到 `spec.usuario`，适配器输出 `--user uid:gid` 和 `--env HOME=/tmp`。
2. **绝不来自请求方。** `start` 没有请求体，`exec` 的请求体忽略多余字段；`exec` 继承容器的用户。
3. **broker 再次校验。** 整数在 1..2^31-1；`0` 被拒绝并点名 `usuario.uid`/`usuario.gid`（root 用「缺省」表示，「一如既往」）。
4. **不放松隔离**：`--cap-drop ALL`、一个 bind、两种取值的网络和五种操作保持不变。已创建的容器只有在重新创建时才会改变。

- **位置：** `packages/docker-port/src/docker-cli.ts:637`（`argsDeCriacao`），
  `packages/docker-port/src/spec-de-container.ts:141`（`usuarioValidado`），
  `apps/broker/src/operacoes.ts:385`（`especificacaoDoProjeto`），
  `apps/api/src/application/use-cases/containers/obter-spec-de-container.use-case.ts:110`
  （`ObterSpecDeContainerUseCase`）
- **测试：** `packages/docker-port/src/docker-cli.spec.ts`（`run` 带 `--user`，仍没有自由字段），`packages/docker-port/src/spec-de-container.spec.ts`
  （`usuario`），`apps/broker/src/operacoes.spec.ts`（"o usuário do container"），
  `apps/api/test/application/use-cases/containers/spec-e-observacao-de-container.use-case.spec.ts`
- **来源：** AT-247

## Anamnese 不为同一窗口付两次钱，gate 救援不重启正在等人的周期（RN-722）

### RN-738 — 停止项目容器是即时的，`/containers` 的行在决定时重新读取 {#rn-738}

- **规则：** 每个项目容器都以 `--init` 启动——这是 `docker run` 组装的「常量」，在 `DockerViaCli` 中，绝不是 spec 的字段（隔离就是类型，ADR 0130）；对 broker 和 runner 都适用，它们使用同一端口。等待命令（`sleep infinity`）是没有 SIGTERM handler 的 PID 1，而内核不会向 PID 1 递送默认动作的信号：`docker
  stop` 会等 10 秒然后杀掉（`Exited (137)`）。在一次性容器中测得：没有 `--init` 时 10.25 秒，有时 0.20 秒。在 `/containers` 页面，决定待处理操作（批准、拒绝、始终允许）会使 `['containers-overview']` 和 `['container-lifecycle', projectId]` 失效，在 `finally` 中——调用失败或掉线时也一样——并把 promise 返回给卡片。没有新的轮询（RN-579/632）。
- **位置：** `packages/docker-port/src/docker-cli.ts:637`（`argsDeCriacao`），
  `apps/web/src/routes/ContainersPage.tsx:72`（`invalidateContainers`），`:183`
  （`aprovar`）
- **测试：** `packages/docker-port/src/docker-cli.spec.ts`（`run` 在命令之前带 `--init`），`apps/broker/src/contencao-do-brabo.spec.ts`
  （两种模式都以 `--init` 启动），`apps/web/src/routes/ContainersPage.test.tsx`
  （批准会重新读取概览和生命周期；被拒绝的批准也会重新读取）
- **来源：** AT-422（本地安装，10月3日：三次停止为 `executed`，行却停在「rodando」且 `Exited (137)`）

### RN-807 — 超出上限的 `exec` 以超时返回，命令在容器内被杀死 {#rn-807}

- **规则：** `exec`（属于 `DockerPort`）是否超出上限，除 `killed` 之外还由「时钟」决定（已用时间 ≥ 上限），因为 `docker exec` 客户端会捕获 SIGTERM（来自 `timeout`，属于 `execFile`） 并以代码 0 退出——测得：上限 3 秒下的 `sleep 30; echo FIM` 返回 `erro: null`、`stdout: ""`，适配器返回 `exitCode: 0`。超出 120 秒的 agent 命令返回「exit 0」，QA 批准了会卡住的测试套件。现在超时返回 `exitCode: -1`、`timedOut: true` 以及超时标记。杀死客户端并不会杀死命令：`exec` 把命令（仍作为「一个」参数，原封不动）包在一个 `sh` 中，该 shell 把自己的 PID——进程组和会话的领导者，因为运行时都做 `setsid`，在每个 `docker exec` 上——写到容器的 `/tmp` 中；超时时，适配器通过这个 PID 杀死整个「进程组」（SIGKILL），在一次内部调用中，端口上没有新操作（ADR 0130）。测量后被否决：使用 busybox 的 `timeout`，在 `sh -c` 内——看守进程随客户端一起死掉，`sleep` 存活。如果杀死失败（例如 `/tmp` 不可写），标记会说明进程可能存活。
- **位置：** `packages/docker-port/src/docker-cli.ts:269`（`estourouOTeto`），
  `packages/docker-port/src/docker-cli.ts:455`（`matarExecEstourado`）
- **测试：** `packages/docker-port/src/docker-cli.spec.ts`（"erro nulo depois do
  teto É estouro"；"no estouro mata o grupo do comando DENTRO do container"；
  "o comando que estoura volta timedOut e MORRE dentro do container"，针对真实 Docker，没有守护进程时跳过）
- **来源：** AT-482

### RN-820 — 守护进程重启时项目容器会自行恢复 {#rn-820}

- **规则：** `docker run`（由 `DockerViaCli` 组装）带有 `--restart unless-stopped` 作为「常量」，与 [RN-738](#rn-738) 的 `--init` 并列——spec 不增加字段，ADR 0130 的隔离不变。重启的守护进程（系统更新）会重新启动项目容器；明确的 `docker stop`（生命周期的 `container_stop`）「不」会被撤销，因为 `unless-stopped` 不会重启手动停止的——绝不用 `always`。测得：`unless-stopped` 容器用 `docker stop` 停止后保持 `exited`，`RestartCount=0`。
- **位置：** `packages/docker-port/src/docker-cli.ts:637`（`argsDeCriacao`）
- **测试：** `packages/docker-port/src/docker-cli.spec.ts`（"cria o container
  com rótulo gerenciado, UM bind e as capabilities derrubadas"）
- **来源：** AT-494（重启的守护进程让所有项目容器都处于 `Exited (143)`，而记录仍是 `running`）
