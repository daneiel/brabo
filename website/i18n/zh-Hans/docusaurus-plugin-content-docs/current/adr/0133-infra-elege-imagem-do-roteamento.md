---
traducao_de: d86b3b6a2e74a54732e147d1e0c053ca5feedc39
---

# 0133 — Infra 在路由的候选项中做出选择，选择结果成为 `artifact.project_image` 的新版本

## Context {#context}

ADR 0131 开启了模块路由缺失的那一半：Arquiteto 为每个模块**提名**一个镜像（`route_modules_to_infra`，写入 `artifact.module_routing`），并明白无误地声明“**选择**的那一半（Infra Lead 读取这份列表并做出决定，带有自己的 `proposed_action`）是一个单独的 PR”。这就是那个 PR。

ADR 0130（容器 broker）也在 `ContainerBrokerPort` 自己的注释中留下了一句悬而未决的话：“启动、停止和移除是**外部效果**，没有 `proposed_action` 就不会发生；提出它们的将是 Infra Lead，由用户拥有最终权限，而那是另一个 PR。”同样是这一个。

两份 ADR 留下的开放问题，只有在试图把两根线**接起来**时才会出现：broker 不接受规格——它读取
`GET /internal/projects/:projectId/container-spec`
（`ObterSpecDeContainerUseCase`），后者又读取 Arquiteto 在 **`artifact.project_image`** 中的当前决定（RN-105，`DecidirImagemDoProjetoUseCase`，
ADR 0065）。它**不**读取 `artifact.module_routing`。那么：如果 Infra 选择了路由中的一个候选项，而这没有变成 `artifact.project_image` 的新版本，那么这次选择在 event log 中可审计却**毫无作用**——启动的容器仍然是 `choose_project_image` 决定的那个，它可能还不存在，也可能是与所选镜像完全不同的镜像。

## Decision {#decision}

**Infra 的选择发出 `artifact.project_image` 的一个**新版本**，完整复用 `DecidirImagemDoProjetoUseCase`——而不是一条并行路径。**

这意味着：`artifact.project_image` 不再只由 Arquiteto（`choose_project_image`）发出。它开始有**两个**可能的发出者——Arquiteto 从零决定，以及 Infra 在 Arquiteto 自己产出的路由候选项中**选择**——每个事件的 `decidedBy` 说明是哪一个（`'arquiteto'` vs. `'infra-lead'`，因为 `DecidirImagemDoProjetoUseCase.execute` 本就接受这个参数，只是从未用其他值调用过）。`project-container.ts` 代码中把镜像称为“ARTEFATO DO ARQUITETO”的注释在重要的意义上仍然正确——它是架构决策，带版本、可审计，绝不是隐藏的配置——但在“只有 Arquiteto 写入它”这个意义上不再正确。CLAUDE.md（约定一节）随之更新以声明这一点。

**为什么复用 `DecidirImagemDoProjetoUseCase`，而不是用一条直接写入 `artifact.project_image` 的并行路径：**

1. **同样的验证，只做一次。** `validarDecisaoDeImagem`
   （显式的 tag/digest、拒绝 `latest`、最低限度的 `rationale`、`RECURSOS_MAXIMOS` 上限）已经是这条规则的唯一来源——在 Infra 的路径中重新实现它，会造成 `module-routing.ts` 的注释在决定复用该函数而不是按模块重写时已经记录过的**同一种**分歧。同样的理由，往上一层。
2. **一个当前值，而不是两个。** `ObterContainerDoProjetoUseCase` 读取 `artifact.project_image` 的“编号最大的版本”——如果 Infra 的选择写入另一种事件类型或一张专属表，产品就会对“这个项目运行哪个镜像”有**两个**可能的答案，而每个现有消费者（`RegistrarTransicaoDeContainerUseCase`、Code 标签页的 RN-105 关口、经由 `ObterSpecDeContainerUseCase` 的 broker）都需要学会在两者之间选择。复用同一个工件才能保住“一个当前值”而不要求任何人改变。
3. **轨迹已经存在。** `rationale` 是自由字段——选择会在其中写明该镜像是从路由候选项中**选出**的（引用 Infra 给出的 `porque`），因此数月后读 `artifact.project_image` 历史的人不会看到一个凭空出现的镜像：他会看到链条——Arquiteto 提名、Infra 选择，以及双方各自的理由。

**被选中的镜像**必须**是当前 `artifact.module_routing` 中的某个 `imagemCandidata`——绝不能凭空编造。** `ExecuteContainerStartUseCase`
在调用 `DecidirImagemDoProjetoUseCase` **之前**验证这一点：如果 Infra 提出列表之外的镜像，动作会失败，并给出一条点名被拒镜像和有效候选项的消息——与 `validarRoteamento`/`validarDecisaoDeImagem` 已使用的解释性拒绝机制相同（RN-061：完整的原因回到要决定如何纠正的人那里）。没有当前路由时
（`status: 'sem_roteamento'`），没有任何候选项，所有选择都被拒绝——Arquiteto 需要先运行 `route_modules_to_infra`。

**明确而非隐藏的张力：** Arquiteto 仍然是**提出者**（通过 `choose_project_image` 或通过 `route_modules_to_infra`）；Infra 在**选择**时开始可以发出**同一**工件的新版本。这不是“Infra 从零决定镜像”——而是“Infra 选择 Arquiteto 的哪个提案成为现实”，写入也反映了这一点：`decidedBy: 'infra-lead'`
以及一条引用来源提名的 `rationale`，绝不是凭空编造得好像是新决定的 `rationale`。

**`container_start` 是新的 `proposed_action`，由用户拥有最终权限——默认绝不可自动批准。** 不同于 `open_infra_pr`
（Infra Lead 可以为自己自动批准，因为它只是开一个仍需人类合并的 PR），启动容器是真正的外部效果——它调用 broker，而 broker 与服务器的 Docker daemon 通信（ADR 0130）。它默认为 `require_approval`（`MIN_ROLE_FOR_ACTION_TYPE: maintainer`，与 `open_infra_pr`/`parallelize` 同一量级），并且**不**进入 Infra Lead 的 `accept-handoff` 所播种的自主权列表——这是刻意的决定，而不是遗漏。

**`container_start` 不在 `decide.ts` 的绝对上限块中**
（受保护分支上的合并、`instruction_patch`、`parallelize`/
`raise_max_parallel`）——与那里已为
`propose_execution_plan`/`assess_implementability` 记录的同一理由：这是该项目的容器为这次选择**第一次**真正启动，而不是越过一个已授权的上限。`maintainer` **可以**配置 `permissions.json` 来自动批准 `container_start`，如果他决定想要这种程度的自动化——产品不会强行关上这扇门，就像它不为 `open_infra_pr` 关上一样。

## Consequences {#consequences}

**RN-105 关口不变。** Code 标签页在 `artifact.project_image` 有决定之前仍然关闭——只是现在这个决定可能来自两个地方。`ObterContainerDoProjetoUseCase` 的现有消费者无一需要改变。

**`container_start` 是 `ContainerBrokerPort.start` 的**第一个**真实调用者。**
在 ADR 0128/0130 的五个操作中，`inspect` 已有调用者（读取，生命周期路由）；`start` 在这里获得它的调用者。`stop`、`remove` 和 `exec` 仍然没有任何 `proposed_action`——这不是缺口被完全修复，而是 FASE 25b 切分的一片在关闭。

**dev agent **仍然**不在启动的容器内工作。** 启动容器与把 dev agent 的 worktree 移进容器是两件不同的事——后者是单独的 PR（1.6）。本 PR 证明 proposed_action → 批准 → broker → `project_containers` 这条路径端到端可行；目前容器内运行的只有 broker 启动的东西（所选镜像，挂载项目文件夹）——还没有消费者。

**`RegistrarTransicaoDeContainerUseCase` 在测试之外获得第一个真实调用者。** 状态机早已存在（ADR 0081）；新鲜之处在于，现在除了测试之外，确实有东西在 broker 确认后触发 `provisioning`/`running`。只有在还没有行，或者该行处于 `failed`/`removed` 时，才可能转换到 `provisioning`——从 `stopped` 开始，正确的转换是直接到 `running`（ADR 0081 的状态机不允许 `stopped -> provisioning`，而为一个只是被停止的容器从零重建该行，会毫无必要地破坏 `imageVersion` 的历史）。

**考虑过并放弃的备选方案：一个与 `artifact.project_image` 分开的新事件（`artifact.container_election` 或类似）。** 它会在“Arquiteto 提出”与“Infra 决定”之间保留更干净的分离，但会恰好造成决策所避免的问题：两个都可能是“该项目当前镜像”的工件，每个消费者（经由 `ObterSpecDeContainerUseCase` 的 broker、`RegistrarTransicaoDeContainerUseCase`、RN-105 关口）都需要知道如何在两者之间选择。被放弃是因为维持两个同步的当前值的成本超过了两个角色之间更“纯粹”分离的价值——**两个**角色仍然存在（Arquiteto 提出、Infra 选择），只是输出工件只有一个。
