---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# 0038 — agent 的层级：领域、lead 与委派

## 背景 {#contexto}

自阶段 3b 起，handoff 可以直接寻址名册中的任何 agent：`CreateHandoffUseCase` 接收 `toAgent`，创建
记录时不校验谁可以作为目标——`Handoff { fromAgent, toAgent, artifactId, status }`，其中 `toAgent`
是自由的（`apps/api/src/domain/sessions/handoff.entity.ts`）。如今唯一的激活规则是
`canActivateAgent`（`domain/sessions/agent-activation.ts`）：一个 agent 只有在有一个发给它的
`accepted` handoff 时才会登场，Criativo 除外，它由用户的命令启动。

这在阶段 4 之前行得通，因为每个 agent 都是单一单元：一个 handoff，一个 agent，一份意见书。阶段 8
引入了**领域内的子专长**——第一个实例是 QA（8b），它开始拥有 QA de Automação 和 QA de
Performance/Segurança——而在这种设计中，一个直接寻址子专长的 handoff 会打破系统其余部分都假定的
前提：**一个 handoff，一个回应**。如果 Arquiteto 可以直接寻址 `qa-performance`，谁来把它的意见书与
`qa-automacao` 的合并？答案不能是“没有人”——gate 期望每个领域**一个**裁决
（`pr-gate-state-machine.ts:nextGateStatus`，它只接收一个 `GateVerdict`）。

本 ADR 在任何子专长存在**之前**固定了通用模型——领域、lead、委派、合并、预算、失败。QA（8b）和
Infra 中的 Workflows subagent（8c）是同一模型的实例，而不是各自的设计。

### 为什么失败的**来源**现在就需要类型化 {#por-que-a-origem-da-falha-precisa-ser-tipada-agora}

自 ADR 0020 起，CLAUDE.md 要求每个失败结果都记录来源——`infra | modelo | código | política`——并
禁止排除法诊断。实际上，来源如今是 `reason`/`diagnosis` 中的**自由文本**：在
`qa_agent_server.ex:176-183` 中，`falha_do_qa({:limit_reached, _})` 返回句子
*"limite de iterações atingido sem emit_qa_verdict"*——正确，但不是其他代码可以据以分支的值。

本阶段的第 4 项要求**lead 根据来源做决定**（重新分配 | 部分合并 | 阻塞），而自动决策不能基于散文
分支。因此本 ADR 类型化了 `failure_origin`，并**回溯改造**已经非正式地对失败分类的地方——
`task_blocked`、`dev.error`、QA 和 SecOps 的意见书——而不是只为委派引入这个类型，让系统其余部分
两套失败词汇并存。

## 决策 {#decisão}

### 1. 领域属于项目，并且恰好有一个 lead {#1-área-é-de-projeto-e-tem-exatamente-um-lead}

`agent_areas`（每个项目每个领域一行）和 `agent_area_members`（谁属于它，带一个布尔值 `is_lead`）。
两个不变量在**数据库中**得到保证，而不只是在应用中——本仓库把约束视为业务规则
（`docs/.docmap.yml`，规则 `schema-e-migrations`）：

- `agent_area_members` 上的 `unique(project_id, agent)`——一个 agent **最多**属于一个领域，lead
  也受同一规则约束：它不能同时是另一个领域的普通成员。
- `unique(area_id) where is_lead`——每个领域**最多一个** lead。lead 的**存在**（至少一个）是创建时
  的不变量，在组建领域时于领域层中校验，而不是数据库约束——一个逐个成员组建的领域，会经过一个没有
  lead 的过渡状态，而数据库无法把它与错误区分开来。

没有领域的 agent——Criativo、PO、Arquiteto、Psicólogo、Anamnese——不进入 `agent_area_members`，
并与今天完全一样：可以通过直接 handoff 寻址。本 ADR 不改变它们的流程。

**Dev 在本阶段被排除在外。** `dev-<modulo>` 按模块动态实例化（阶段 4 的 ADR），不会变成领域——
目前还没有 “Dev Lead”。作为未来的扩展记录下来，没有实现（见“后果”）。

### 2. 外部 handoff 只寻址 lead 或没有领域的 agent {#2-handoff-externo-só-endereça-lead-ou-agente-sem-área}

`CreateHandoffUseCase`——系统中如今唯一不经校验就写入 `toAgent` 的地方——在创建记录之前开始调用
`assertHandoffTargetAllowed(toAgent, membrosDaÁrea)`。作为某个领域的 subagent（成员，而非 lead）
的目标会以类型化的错误被拒绝（`HandoffToSubagentError`，错误中带有 agent 和领域），既不会被悄悄过滤，
也不会被误提升为 lead。

`OfferInfraHandoffUseCase`（发出信号让 engine 向 InfraAgent 提供 handoff 的就绪确认）**不**写入
`toAgent`——它只触发 engine，之后由 engine 调用 `CreateHandoffUseCase`。校验只放在一个地方，就是
实际决定目标的那个点上。

这是 `agent-activation.ts` 先例的扩展：那个文件决定“谁可以**激活**”；这个决定“谁可以成为**外部**
handoff 的**目标**”——第二个问题以前不存在，因为到目前为止，每个 agent 按定义都是外部的。

### 3. 委派是内部机制，并且是领域私有的 {#3-delegação-é-o-mecanismo-interno-e-é-privado-da-área}

`delegations`：一个 lead 把一项任务委派给**同一**领域的 subagent。
`assertDelegationAllowed(lead, subagent, membros)` 拒绝不是该领域 lead 的人，以及委派到领域之外的
人。委派**永远不会**以 handoff 的形式出现——它们是不同的表和不同的生命周期，而这一区分正是保住
“lead 是唯一的外部联系人”这一属性的东西：领域之外没有任何东西观察到单个委派，只观察到合并后的结果。

### 4. 合并：只有一个 artifact，外部契约不变 {#4-consolidação-um-artefato-só-contrato-externo-intocado}

lead 用**一个** `consolidated_verdict` artifact 关闭它收到的 handoff——这是 `ArtifactSchemas`
（engine）中的新类型，像 `task_blocked` 和各种 `*_verdict` 一样**由服务器发出**：三者都不是模型通过
tool call 选择发出的东西，它们是对服务器所确定的结果的记录。payload：`área`、`veredito`、`resumo`
以及 `delegações`——按 id 引用、而不是复制的内部意见书列表（可追溯而不重复内容）。

`ArtifactSchemas` 校验**形式**（每个 `completed` 的委派都有 `parecerArtifactId`；每个 `failed` 的
都有 `failureOrigin`）——这与 `check_extra/2` 如今为 `qa_verdict`/`secops_verdict` 回答的是同一个
问题。api 的领域层校验**规则**——只有在**所有**委派都已解决时才能合并（`assertConsolidatable`，
拒绝时附上缺少的项列表）——因为只有 api 拥有该领域委派的完整列表；engine 在发出 artifact 的时刻，
只知道它已经收到的东西。

**gate 的外部契约不变。** `nextGateStatus` 仍然为每个 gate 接收一个 `GateVerdict`
（`approved | changes_requested`）——`consolidated_verdict` 是 QA Lead **用来决定**那个唯一裁决
的东西；调用 gate 的一方从不会看到委派。这是本 ADR 的核心保证：层级在领域之外是不可见的。

### 5. 级联的预算，必须带来源的失败 {#5-orçamento-em-cascata-falha-com-origem-obrigatória}

领域上的上限（`agent_areas.budget_micros`），每个委派的子上限（`delegations.budget_micros`，可选——
并不是每个委派都需要）。超出子上限会变成 `failed`，`failure_origin = politica`——这与会话/项目的
预算在 `budget-threshold.ts` 中已经使用的分类相同，扩展到了委派。

**阶段 1 的 `budgets` 没有被触碰。** 它的 `budgets_scope_check` 恰好限定为两种作用域（`project`
XOR `session`）；在那里容纳第三种作用域，会为了领域的局部需要而修改一张核心表。领域的上限和委派的
子上限放在新表中。

subagent 的每一次失败——超出预算、等价于 `task_blocked` 的情况、无论什么——到达 lead 时都带有填好的
`failure_origin`。lead 决定三种结果之一，而这个决定**就是**一个事件（`area.decision`），绝不是无声
的副作用：

- **重新分配**：诞生一个新的委派，覆盖失败留下的待办部分；
- **部分合并**：`consolidated_verdict` 用现有的东西关闭，引用 `failed` 的委派及其来源——外部消费者
  看到的是一个完整的裁决，即使内部有一部分失败了；
- **阻塞**：整个领域被阻塞，并传播真实的来源——绝不是泛泛的 `changes_requested`，正如阶段 4a 对
  没有意见书的 QA 的情形已经修正过的那样（见 `qa_agent_server.ex:148-153` 中的注释，本 ADR 把它
  推而广之）。

### 6. 失败的来源：新类型，在系统中所有已对失败分类的地方回溯改造 {#6-origem-da-falha-tipo-novo-retrofit-em-todo-o-sistema-que-já-classifica-falha}

`failure_origin`：`infra | modelo | codigo | politica`（Postgres 枚举，像 `schema.ts` 中的其他枚举
一样不带重音）。回溯改造——明确的决定，而不是模型只对委派做出的承诺：

- `tasks.blocked_origin` 和 `stories.blocked_origin`（新列，与已有的 `blocked`/`blocked_reason`
  并列——**新字段，而不是替换**）；
- `Engine.Dev.AgentIo.block_task/3` 获得第 4 个参数；`dev_agent_server.ex`/`noop_dev_agent_server.ex`
  中约 18 个调用点被逐一分类（worktree 失败是 `infra`；畸形的上下文是 `codigo`；迭代上限是
  `modelo`；预算是 `politica`）；
- `falha_do_qa/1`（`qa_agent_server.ex`）以及 SecOps 中的等价物，开始在 `reason`/`diagnosis` 之外
  一并返回来源；
- `ArtifactSchemas` 中的 `task_blocked` 在必需键中加入 `origin`。

没有任何现有消息被删除或改写——来源是与自由文本并列的**新**字段，自由文本继续存在，供人阅读。

## 后果 {#consequências}

### 变得可用的东西 {#o-que-fica-disponível}

- 向 subagent 发出 handoff 在创建时就是错误，而不是只有在有人尝试时才会出现的潜伏 bug。
- QA 的 gate（8b）和 Infra 中的 Workflows subagent（8c）都有现成的机制——两者都不需要重新发明委派
  或合并。
- 每个部分失败的决定都变成可审计的事件（`area.decision`），关闭了 CLAUDE.md 在理论上早已禁止、在实践
  中却无法阻止的缺口——来源曾是文本，而文本拦不住一个靠猜的 `if`。

### 记录为未来扩展、尚未实现的东西 {#o-que-fica-registrado-como-extensão-futura-não-implementado}

- **Dev Lead。** `dev-<modulo>` 仍按模块动态实例化，没有 lead。如果有一天需要领域，这个模型已经
  适用——领域既不预设固定数量的成员，也不预设每个 subagent 的固定指令。
- **由 Arquiteto 经由 `module_map` 提议的领域。** 如今领域由每个阶段的范围隐式创建（8b 中的 QA，
  8c 中的 Infra）；让 Arquiteto 根据它已经产出的模块图动态提议新领域的想法不在范围内——那需要一个
  独立的审批流程。

### 承担的风险 {#riscos-assumidos}

- **来源的回溯改造触及了阶段 4 中经过真实执行验证的代码**（ADR 0020）。约 18 个点中的每一个都被单独
  分类，没有任何现有消息改变——风险在于漏掉一个点，而不是弄坏一个已经正常工作的点；测试覆盖的是这些
  点，而不是一个样本。
- **`delegation_status` 诞生时带着一个没有用途的值**（`dispensed`，为 8b 预留——“没有性能方面的
  非功能需求，委派被豁免”）。在写入之后再修改 Postgres 枚举是一个会锁表的 migration；现在就让它诞生，
  免得付两次代价。
- **没有孤立委派的扫描。** 如果 engine 在启动委派和报告结果之间死掉，它在本阶段会永远处于 `pending`——
  lead 不会合并（正确的行为：不会悄悄关闭不完整的意见书），但也没有自动告警。留到有真实情况时再说，
  而不是假想的情况。

## 收尾（阶段 8d） {#fechamento-fase-8d}

本 ADR 中预见的两个实例都已构建——QA（8b）和 Infra 中的 Workflows subagent（8c）——再加上展示层
（8d：按领域分组的团队面板、展开内部意见书的 PR 时间线、按领域分组的洞察、叙述委派的动态）。下面
收尾，区分已决定的与仍待处理的：

### `consolidated_verdict` 没有实现——这一决定在实践中得到了验证 {#consolidated_verdict-não-foi-implementado--decisão-validada-na-prática}

上面的决策 #4 设计了一个通用的 `consolidated_verdict` artifact。QA 和 Infra 都没有使用它：两者都已经
有一个**自己的**、**早于**本 ADR 的契约——`qa_verdict`（QA）和 `open_infra_pr`（Infra）——而改变这个
契约会弄坏 `RecordGateVerdictUseCase`/`ExecuteInfraPrUseCase`，以及那些在没有层级时已经证明了正常
路径的演示。`Engine.Gates.QaLead.
consolidar/1` 恰好产出 `qa_verdict` 的形式；`Engine.Infra.InfraLead.consolidar/2` 产出
`open_infra_pr` 已经期望的文件并集。消费者从来不知道背后有不止一个 agent——本 ADR 的核心保证（上文
第 118 行）在不需要通用 artifact 的情况下得到了证明。

`consolidated_verdict` 仍以**设计**而非代码的形式存在于 `ArtifactSchemas` 中——一个没有自己的
artifact 可复用的未来领域（不同于 QA/Infra，它们在变成领域之前就已经有了一个）是真正实现它的自然候选。
在那之前，已确立的模式是：**优先复用领域在变成领域之前就已发出的 artifact**；只有在没有的情况下才实现
通用的那个。

### Dev Lead 与动态领域——仍未实现，种子已记录 {#dev-lead-e-áreas-dinâmicas--ainda-não-implementados-e-a-semente-registrada}

“未来扩展”一节已经记录的两项仍被排除在外，这在模型的三个真实实例（QA、Infra，以及展示它们的 UI）
之后得到了确认。按要求记录第二项的种子：

**`module_map` 已经决定了有**多少**个 dev agent**——每个模块一个（`devAgentId`/`Engine.Dev.*` 如今
由此推导，没有自己的表：dev 的存在是 module_map 的一个**函数**，而不是一条平行的记录）。自然的下一步——
这里没有实现——是让 Arquiteto 不仅提议模块，还提议把它们**分组**为领域：例如 `payments-api` 和
`payments-worker` 归入一个 “payments” 领域，由两者之一（或一个专门的 lead）作为外部联系人。这会变成
“领域之所以存在，是因为 module_map 说它存在”的同一种动态，而如今这只对单个 dev 成立——领域将不再是
固定的目录（QA、Infra），而会成为 Arquiteto 的**提议**，经用户批准，就像 module_map 已经是的那样。

要让这变成代码而不只是想法的前提：真正的 `agent_areas`/`agent_area_members`（8b/8c 有意从范围中
砍掉的装置——如今 `delegations` 中的 `area`/`subagent`/`leadAgent` 是 TEXT，没有关联表，因为当时只
存在两个事先已知的固定领域）；一个创建领域的审批流程（与 handoff/module_map 相同的模式，由用户决定）；
以及当领域由提议而不是固定目录诞生时，对“谁成为 lead”的回答——Dev Lead 和动态领域是**同一个**悬而
未决的问题，而不是两个。
