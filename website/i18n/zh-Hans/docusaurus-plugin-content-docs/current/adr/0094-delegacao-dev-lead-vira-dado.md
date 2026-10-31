---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0094 — Dev Lead → dev 的委派成为数据，`parecerArtifactId` 被重新定义

- **状态：** 已接受
- **日期：** 2026-08-17
- **背景：** fluxo.yml × 代码审计（第 2 波，B1 项，
  `docs/explanation/auditoria-fluxo-vs-codigo.md`，D 节）
- **撤销以下 ADR 的切分：** [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)
  （第 5 项，“内部委派”，被声明为 Dev Lead 存在的直接后果，但当时明确**未实现**——另见
  CLAUDE.md，“O que NÃO fazer” / FASE 14d）
- **扩展：** [ADR 0038](0038-hierarquia-de-agentes.md)（`delegations`/`RecordDelegationUseCase` 原始设计的所有者——表、TEXT 类型的 `area`，以及 QA 和 Infra 已在使用的 `completed`/`failed`/`dispensed` 模式）

## 背景 {#contexto}

ADR 0053（FASE 14d）创建了 Dev Lead，并在同一文本中已经预见到 `dev-<modulo>` 的启用将是“区域委派，私有，在
`delegations` 表中，`area = "dev"`——与 QA 和 Infra 相同的路径”。但它把这一点声明为**不在那次交付范围内**，与“Ativar
execução”按钮换主人一起——两者都在 CLAUDE.md 中列为可逆的切分，“执行继续走当前路径”。

对 `docs/fluxo.yml` × 代码的只读审计（发现 B1）确认这个缺口仍然开放：`dev_lead_server.ex` 只有两个工具
（`propose_execution_plan`、`assess_implementability`），并且**从不**写入
`delegations`——只有 QA（`qa_lead_server.ex`）和 Infra（`infra_lead_server.ex`）写入，两者都在 ENGINE 一侧，经由 `EngineApiClient.record_delegation/1`
→ `POST /internal/sessions/:sessionId/delegations` →
`RecordDelegationUseCase`。

### 为什么 Dev Lead 不能简单地模仿 QA/Infra {#por-que-o-dev-lead-não-pode-simplesmente-imitar-qainfra}

QA 和 Infra 在 ENGINE 一侧写入委派，因为子 agent 在那里运行并产出一份**意见（parecer）**——单轮的裁定
（`record_gate_verdict`、`open_infra_pr`），这让 `parecerArtifactId` 指向该意见所产出的工件变得合理。

Dev Lead 没有这种模式。`dev-<modulo>` 的启用发生在 **API** 一侧，在 `AcceptParallelizationUseCase.execute` 中
（`apps/api/src/application/use-cases/execution/accept-parallelization.use-case.ts`），
既由直接路径（上限以下，
`RequestParallelizationUseCase`）调用，也由批准路径（上限以上，用户批准 `parallelize` 类型的 `proposed_action` 后的 `ExecuteParallelizationUseCase`）调用。根本没有“意见”：dev agent 启动时不产出裁定，它只是开始工作。

## 决策 {#decisão}

**写入放在 `AcceptParallelizationUseCase.execute` 内部，在 API 一侧——不触碰 Elixir/engine。** 它顺带覆盖两条路径（直接和批准），因为两者已经汇聚到这个方法。

### `status: 'completed'` 为该区域重新定义 {#status-completed-é-redefinido-para-esta-área}

在 QA 和 Infra 中，`completed` 意味着“子 agent 已完成并给出意见”。对于 dev，`completed` 改为意味着**“委派已生效”**——`dev-<modulo>` agent 确实启动了。这是对同一字段为第三个区域所做的**有意识**的重新定义，不改变 schema：类型（`DelegationStatus`）和数据库约束
（`delegations_completed_tem_parecer`）继续要求 `completed` 时
`parecerArtifactId` 非空，但该 id 所**证明**的东西因区域而异。

`parecerArtifactId` 指向项目最新且有效的 `artifact.module_map` 事件的 `id`——与 engine 一侧的
`QaEstrategiaContext.fetch/3` 和 `AppSecContextBuilder` 已经获取的是同一工件，这里通过 `SessionEventRepository.listByTypeForProject
(projectId, 'artifact.module_map')` 获得（已有的通用方法，`computeCoverage` 用它获取 `artifact.business_rule`——没有编写新查询，只是多调用一次），取**最后**一项（该函数按 `createdAt` ASC 排序）。正是这个工件**证明了委派的决定**：Dev Lead 通过查看
`module_map` 来决定每个模块多少个 agent，赋予委派意义的正是这次读取——而不是子 agent 的意见。

### 没有 module_map：绝不使用假 id {#sem-module_map-nunca-um-id-falso}

如果项目中没有任何 `artifact.module_map`——这本不该发生，因为 Arquiteto 总是在 Dev Lead 运作之前交付 module_map（这是 `docs/fluxo.yml` 中它的必需输入）——委派**不会**以编造的 id 写入。`AcceptParallelizationUseCase` 用 `Logger.error` 记录这一意外状态并返回，出于与
[RN-059](../business-rules/custo.md#rn-059) 相同的教训：绝不静默失败，但也绝不假装存在一个并不存在的理由。

### 记录失败不会推翻启用 {#falha-ao-registrar-não-derruba-a-ativação}

尝试写入委派时，dev agent 的启用已经成功——写入发生在 `engineClient.acceptParallelization`
和 `execution.parallelization_accepted` 事件**之后**。如果
`RecordDelegationUseCase.execute` 抛出（例如违反约束、数据库宕机），错误会被捕获并记录，绝不传播：
`AcceptParallelizationUseCase.execute` 到达这一点时总是解析为 `{ ok: true }`。只有委派的**写入**可以失败/跳过——启用本身不会。

### `area`/`lead_agent`/`subagent` {#arealead_agentsubagent}

`area: 'dev'`，`lead_agent: 'dev-lead'`（字符串字面量，与
`'qa-lead'`/`'infra-lead'` 同一模式），`subagent`：刚启用的
`dev-<modulo>` agent 的确切 id——`extraDevAgentId(module)`，即
`AcceptParallelizationUseCase` 已用于命名 agent 的**同一个**函数（包括额外实例的
`-2` 后缀，与 RN-195..201 在另一上下文中记录的模式相同）。没有发明任何新格式。

`taskId` 保持 `null`（`RecordDelegationUseCase` 的默认值）——与 Infra 相同的选择：委派关乎**会话**/模块，而非某个特定的 backlog task。

## 后果 {#consequências}

**有利**

- 关闭 `docs/fluxo.yml`（自 ADR 0053 起已把
  `delegacao`/`dev` 声明为真实交付）与代码之间的分歧——与 ADR 0086 同一类修正。
- `delegations` 开始有**三个**区域（`qa`、`infra`、`dev`）通过同一机制写入，团队面板以及未来任何关于“lead 委派了谁”的读取都能覆盖 dev 而无需特例。
- 零新 schema，零 migration：表和约束本就支持这种情况，只是缺少 dev 一侧的调用者。

**不利**

- `parecerArtifactId` 在 `delegations` 中不再只表示一件事：在没有区域上下文的情况下读表的人可能会假设“总是子 agent 的意见”，这对 `area = 'dev'` 是错的。由本 ADR 和新的 RN 作为该重新定义的唯一参考来缓解——今天没有任何界面以依赖这一区别的方式解读 `parecerArtifactId`（它是不透明字段，作为 id 显示）。
- 委派的写入可能**静默地**没有发生（module_map 缺失，或 `RecordDelegationUseCase` 失败），用户在界面上看不到——只在进程日志中。出于与 ADR 0053 原第 5 项相同的理由而被接受：agent 的启用才是执行继续所需要的，因为一次辅助写入而阻断已经完成的成功会更糟。

## 考虑过的备选方案 {#alternativas-consideradas}

**在 ENGINE 一侧、在 `dev_lead_server.ex` 中写入委派，逐字模仿 QA/Infra。** 被拒绝：这需要一条仅为此而新增的 engine→api HTTP 调用，而启用已经完全在 API 一侧发生。它还会迫使发明一个 Dev Lead 并不产出的“意见”——并行计划（ADR 0086）已经是独立的 `proposed_action`，把那个事件复用为委派的意见会混淆两个不同的结果（并行授权 vs. 启用生效）。

**只有在 dev agent 产出某样东西之后（例如开出第一个 PR）才 `status: 'completed'`。** 被拒绝：没有自然的触发器，也没有单一事件标记这一点，而把写入推迟到那时会让委派无限期“待定”——schema 刻意没有 `status: 'pending'`
（`record-delegation.use-case.ts` 中的说明：“o lead resolve cada delegação
síncrona, numa rodada só”）。

**委派无法写入时锁住启用。** 被拒绝：这会把优先级颠倒——dev agent 的启用是交付给用户的真实价值；委派是对已发生事实的审计。因为审计而使启用失败，会比本 ADR 关闭的缺口更糟。

## 参考 {#referências}

- `apps/api/src/application/use-cases/execution/accept-parallelization.use-case.ts`
  （`recordDevDelegation`）
- `apps/api/src/application/use-cases/execution/record-delegation.use-case.ts`
- `apps/api/test/application/use-cases/execution/accept-parallelization.use-case.spec.ts`
- [RN-404](../business-rules.md#rn-404)（Dev Lead → dev 委派）
- [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)——第 5 项，此处撤销的切分
- [ADR 0038](0038-hierarquia-de-agentes.md)——
  `delegations`/`RecordDelegationUseCase` 的原始设计
- [ADR 0086](0086-dev-lead-plano-suspende-para-aprovacao.md)——另一次关闭 `docs/fluxo.yml` 声明与 Dev Lead 代码之间分歧的修正
- `docs/fluxo.yml`——`delegacao`/`dev` 条目（不再引用
  `status: lacuna`）
