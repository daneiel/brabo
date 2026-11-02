---
traducao_de: 23e727d97992c1974a3df731360a293b67fd669c
---

# ADR 0053 — Dev Lead 作为区域，以及由用户授权的并行

- **状态：** 已接受（在 FASE 14d 中实现，2026-08-07）
- **日期：** 2026-08-05
- **背景：** FASE 14d
- **撤销以下 ADR 的切分：** [ADR 0038](0038-hierarquia-de-agentes.md)（通用区域机制，以及通过 `module_map` 的动态区域）

## 背景 {#contexto}

今天 dev agent 的并行是：`activate` 时每个模块一个 agent，再通过一次点击接受（`AcceptParallelizationUseCase`）为每个模块加一个额外的（`dev-<modulo>-2`）。没有会话上限。没有任何东西阻止一个项目为每个模块启动一个 agent 再各加一个额外的，花费随之上涨而无人授权。

FASE 14d 决定**由 lead 来评估多少个 agent 是值得的**，而在会话中超过两个需要用户授权。

### 本 ADR 解决的张力 {#a-tensão-que-este-adr-resolve}

所讨论的并行是 **dev** 的，而 **Dev Lead 不存在**。现有区域有两个，成员固定、手写在
`apps/web/src/lib/agents.ts` 中：`qa`（lead `qa`，成员 `qa-automacao` 和
`qa-performance-seguranca`）和 `infra`。

更糟的是：CLAUDE.md 明确禁止了所需的两件事——
“不要实现 Dev Lead，也不要通过 `module_map` 实现动态区域”以及“不要实现通用区域机制（`agent_areas`/按区域预算）”。

用户的决定是解除这两项禁令，真正实现 Dev Lead。本 ADR 记录这一点及其原因。

### 为什么 dev 区域不能硬编码 {#por-que-a-área-de-dev-não-pode-ser-hardcoded}

`qa` 和 `infra` 的成员在编写时就已知。dev 区域不是：其成员是 **`module_map` 中每个模块一个**，由 Arquiteto 决定，每个项目不同，并在架构被修订时变化。

这正是第 8 阶段的切分所推迟的情况。当所有区域都是静态时，它是诚实的；当第一个动态区域进入时就不再如此。没有这个机制就做不出 Dev Lead——这就是两项切分一起取消的原因，而不是出于方便。

## 决策 {#decisão}

### 1. 区域变成按项目的数据 {#1-as-áreas-viram-dado-por-projeto}

引入 `agent_areas` 和 `agent_area_members`，按项目限定作用域：

- `agent_areas`：`project_id`、`key`（今天为 `dev`、`qa`、`infra`）、
  `lead_agent_id`、`max_parallel`（默认 **2**）
- `agent_area_members`：`area_id`、`agent_id`

`qa` 和 `infra` 继续带着已有成员诞生——机制成为来源，硬编码的列表从 `agents.ts` 中消失。**gate 的外部合约不变**：消费者看到的是每个 gate 一个裁定，与今天完全相同，而第 4 阶段的测试套件必须不经修改保持绿色。这就是来源的替换没有泄漏到区域之外的证据。

`dev` 区域在 `activate-execution` 中诞生，当前 `module_map` 中每个模块一个成员。

### 2. lead 决定，超过 2 时由用户授权 {#2-o-lead-decide-o-usuário-autoriza-acima-de-2}

lead 评估手头的工作值得多少个 agent——它不再是代码中的一个数字。但他的决定对花费没有最高主权：

- 在 `max_parallel`（默认 2）以内，lead 启动 agent 并继续；
- **超过这个数**，就变成 `parallelize` 类型的 `proposed_action`，经由所有带外部效果的动作所走的同一审批流水线。用户决定，决定留在 event log 中。

上限是**会话**的，不是模块的。按模块计数会允许 N 个模块 × 2 个 agent 而无需任何授权，这就是换了个名字的今天的漏洞。

`AcceptParallelizationUseCase`（一次点击接受）被吸收：它变成这个 `proposed_action` 的批准路径，而不是与流水线并行的一个按钮。

### 3. `max_parallel` 可按 lead 配置 {#3-max_parallel-é-configurável-por-lead}

在设置界面中，每个 lead 有自己的值，默认 **2**。这是 lead 无需询问就能使用的上限——而不是用户可以批准的上限。

### 4. 当授权反复出现时，Anamnese 提议提高 {#4-a-anamnese-propõe-subir-quando-a-autorização-é-recorrente}

当它察觉用户一再批准同样的请求时，会提议提高该 lead 的 `max_parallel`——采用它已在使用的同一假设机制，以真实 event id 为证据，由用户决定。

它**不**会自行提高。把这件事自动化就是产品在提高自己的花费上限，而这恰恰是审批流水线存在所要阻止的。

### 5. Dev Lead 是对话型 agent，接收来自 Arquiteto 的 handoff {#5-o-dev-lead-é-agente-conversacional-e-recebe-o-handoff-do-arquiteto}

这不是 Arquiteto 在启用时的角色：它是自己的 agent（`dev-lead`），有指令、模型 binding 和在对话中的位置，与 Criativo、PO 和 Arquiteto 一样。

链条变为 **Arquiteto → Dev Lead → 执行**。今天 Arquiteto 结束后，执行由用户的一个按钮启用，中间没有人评估工作；有了 Dev Lead 就有了关于并行的对话者——这正是 14d 的要点，也是“由 lead 决定”不沦为一句空话所需要的。

这**契合已有的 handoff 规则**，而不是开一个例外：外部 handoff 只指向区域 lead 或没有区域的 agent。今天 `dev-<modulo>` 是没有区域的 agent，因此可以被指向；一旦成为 dev 区域的成员，它们就不再可以——执行唯一的外部地址变成 Dev Lead。ADR 0038 的层级对 dev 适用，无需特例。

直接后果：

- **内部委派。** Dev Lead → `dev-<modulo>` 是区域委派，私有，在 `delegations` 表中，`area = "dev"`——与 QA 和 Infra 相同的路径。子 agent 的失败把来源报告给 lead，由 lead 决定并记录事件。
- **“Ativar execução”按钮换主人。** 它不再是触发器，而成为对 Dev Lead 计划的接受：他说明想要多少个 agent 以及原因，用户批准——在上限内无需仪式，超过上限则通过第 2 项的 `proposed_action`。
- **专属指令。** Dev Lead 需要知道的是 `module_map`、可领取的 backlog 和当前上限。他不写代码：他分配工作并为之负责。

> **已于 2026-08-07 答复：** gate 之后的修正继续**直接**交给开出 PR 的 `dev-<modulo>`。这保持第 4 阶段测试套件和当前内部合约不变；与层级的一致性较弱，但可逆——以后在 lead 存在并被证明之后，可以改为经过 lead。在 Dev Lead 尚未实现的现在就做决定，将是在黑暗中选择。

## 后果 {#consequências}

**有利**

- 并行的花费开始有上限也有主人。今天两者都没有。
- 区域机制不再是声明过的债务，而成为机制，第一个动态区域证明它适用于困难的情况。
- `budget por área`（第 8 阶段切分中的另一项）只差一步：缺失的那张表开始存在。

**不利**

- 这是自第 8 阶段以来最大的结构性变化，并触及 handoff 流程：Arquiteto 改为交给 Dev Lead，而不是交给用户的手动启用。
- 多一个对话型 agent，就是每次执行在写任何代码之前多一个 LLM 轮次。它换来的是花费上限有了主人；如果他的计划在上限之内，他的成本就是请求本身的成本。
- `delegations.area` 今天是带有 "qa" 和 "infra" 的 TEXT；它会增加 "dev"，并开始有一个在表中的事实来源。迁移需要保持历史可读。
- 替换 `qa`/`infra` 成员的来源对它们来说是纯粹的风险，没有直接收益——通过保持第 4 阶段测试套件不变作为验收标准来缓解。

## 考虑过的备选方案 {#alternativas-consideradas}

**没有 Dev Lead 的会话上限。** 它会交付核心价值——带授权的花费上限——而不违反任何切分，这也曾是推荐方案。被拒绝，因为它让“由 lead 决定”没有主人：上限会存在，但没有人评估多少个 agent 值得，而那是 14d 所要求的一半。

**只应用于 QA 和 Infra。** 忠实于文本，今天就能实现，但价值很低：这两个区域成员固定，几乎没什么可决定的，也不触及 dev 的并行——那才是花费发生的地方。

**代码中更大的固定数字。** 这就是今天存在的东西换了个值。什么也解决不了：没有授权，任何数字都是任意的。

## 参考 {#referências}

- [ADR 0038](0038-hierarquia-de-agentes.md)——按区域的层级，以及本 ADR 撤销的切分
- [ADR 0045](0045-reagendamento-por-evento-do-dev-agent.md)——dev agent 的状态机，额外 agent 从这里进入
- `apps/api/src/db/schema.ts`（`delegations` 中的说明）——切分被写明的地方
- `apps/api/src/application/use-cases/execution/accept-parallelization.use-case.ts`
  ——今天的机制，被第 2 项吸收
