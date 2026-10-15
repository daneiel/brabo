---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0090 — QA 策略和 AppSec 作为第二个**时刻**，而不是新 agent

- **状态：** 已接受
- **日期：** 2026-08-17
- **背景：** 产品所有者有意识地提前触发条件——不是 `docs/fluxo.yml` 所预期的"自然触发"（`hoje_absorvido_por` + `criterio_de_separacao`），而是构建连接该 gate 之物这项工作本身
- **激活：** gate `implementavel`（`docs/gates.yml`，自 FASE 14d 起为 `status: planned`）
- **修订以下内容的一部分：** [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)（它把 gate `implementavel` 声明为 `planned`）
- **直接先例：** [ADR 0038](0038-hierarquia-de-agentes.md)（QA 区域——Lead + 子专业）、[ADR 0085](0085-fluxo-como-registro-declarativo.md)（`docs/fluxo.yml`，早已把这两个角色预期为 `proposto`）

## 背景 {#contexto}

`docs/fluxo.yml`（ADR 0085）把目标模型中的两个角色记录为 `proposto`，每个都在文件本身中写明了分离标准：

> **qa-estrategia** — hoje_absorvido_por: area-qa (que só atua DEPOIS, na
> PR). criterio_de_separacao: Quando o gate implementavel ativar — o
> plano-de-teste é entrada dele. Pode ser o próprio qa-lead em segundo
> MOMENTO, não necessariamente agente novo: a separação é de entregável.
>
> **appsec** — hoje_absorvido_por: secops (que só atua na PR).
> criterio_de_separacao: Mesmo padrão do QA: dois MOMENTOS, não dois
> agentes por ora. Threat model no design ativa quando o gate implementavel
> existir. Agente separado só com produção real.

声明的触发条件（"当 gate `implementavel` 激活时"）从未自然触发——产品中还没有任何东西需要它。产品所有者决定提前：触发条件**就是**构建连接该 gate 的机制这项工作本身，而不是等待发生的使用症状。

本次交付完整覆盖 **qa-estrategia**。**appsec** 仍为 `proposto`，遵循**同一**原则（两个时刻，不是两个 agent），实现放在另一条工作线中——模式和决定是同一个，在此描述；`appsec`/`threat-model` 的代码留到那条工作线运行时再写。

## 决策 {#decisão}

**QA 策略就是处于第二个**时刻**的 `qa-lead`——同一个进程，独立的可交付物。** 没有新 agent，名册中也没有自带名字的新 GenServer。`Engine.Gates.QaLeadServer` 在一贯的 `run/2`（PR 审查）旁边增加一个**追加式**入口 `run_design/3`：

### 各个部件 {#as-peças}

1. **`Engine.Gates.QaEstrategiaContext.fetch/3`**——**轻量**上下文：只有 story（来自 `EngineApiClient.list_backlog/1`，PO 自 [RN-164](../business-rules/autenticacao.md#rn-164) 起就在读的那棵树）和当前 `module_map`（来自 `EngineApiClient.get_infra_context/2`，Infra Lead 所消费的**同一个** `GetInfraContextUseCase`，这里只用 `moduleMap` 字段）——**没有** `dev_state`，**没有** `worktree_path`。api 中没有新路由：这两个函数早已存在，而 gate `implementavel` 在 PRE-DEV 运行——还没有 dev agent、worktree 或 `task_id`。
2. **`Engine.Gates.QaEstrategiaAgent`**——**无状态**模块（不是 `GenServer`），与 `Engine.Gates.QaPerformanceSegurancaAgent` 形式相同：**没有** `Terminal` 的工具注册表（`ReadFile`、`SearchWorkspace`、`EmitPlanoDeTeste`），运行 harness 的通用 `ToolLoop`。三个工具都不经过 `Engine.Harness.Hooks.ActionPipeline`（只有 `terminal`/`write_file` 经过）——这个 agent **从不**挂起，`run_design/3` 在自己的 `handle_cast` 内同步运行。它在调用它的会话的 event log 中发出 `artifact.plano_de_teste`（schema 在 `Engine.Harness.ArtifactSchemas` 中校验）。
3. **`Engine.Gates.QaLeadServer.run_design/3`**——`GenServer.cast`，与 `run/2` 同一风格，**没有** `DevAgentState.find_by_task_id`。通过 `Engine.Gates.Dispatcher.run_qa_estrategia/3` 调用（与 `run_qa/2`/`run_secops/2` 早已使用的、在测试中可替换的**同一**间接层——避免在轻量测试中启动真实的 GenServer）。
4. **`Engine.Agents.DevLeadTools.assess_implementability`**——Dev Lead 的新工具。在 Dev Lead **自己**会话的历史中读取该 story 最新的 `artifact.plano_de_teste`：
   - **还没有计划**——触发 `Dispatcher.run_qa_estrategia/3` 并返回 `{:error, texto}`，请求再试一次。工具错误是循环的**输入**，不是终点（[RN-163](../business-rules/autenticacao.md#rn-163)）——Dev Lead 有 14 次迭代可以在计划存在之后再试；
   - **有计划**——组装意见（`implementavel`/`inviavel` + 理由，测试计划嵌入 payload），并以 `"assess_implementability"` 调用 `EngineApiClient.propose_action/5`，与 `propose_execution_plan` 相同的三结局模式（[RN-284](../business-rules.md#rn-284)，ADR 0086）。
5. **`decide.ts`** 增加 `assess_implementability`，最低角色 `maintainer`，**有意**放在绝对上限块之外——与 `propose_execution_plan` 同样的推理：它是会话的初始决定，不是对已授权上限的突破。
6. **`docs/gates.yml`**，`implementavel`：`status: planned` → `active`，`evidencia` 指向 event log（按 `actionType: assess_implementability` 过滤的 `proposed_action.created`）。`severidade` 仍然是 `warn`——没有被触碰；登记早已写着"即使激活也以 warn 诞生"。

### 为什么迭代上限**没有**增加新子句 {#por-que-o-teto-de-iterações-não-ganhou-cláusula-nova}

`Engine.Harness.Iteracoes.tipo/1` 把未知 agent 归类为 `:conversacional`（上限 8）。`"qa-estrategia"` 落入这个默认值，这是**正确**的决定——不是缺口。[RN-085](../business-rules/custo.md#rn-085) 的标准不是"谁干得多"：而是"在迭代上限之外是什么拦住花费"。这个 agent 在**没有** `token_budget_micros` 的情况下运行（没有 task，PRE-DEV），与 `infra-workflows` 的情况相同——后者即使使用工具也保持在 8，因为在底下没有预算的情况下提高上限，会把最坏情况成倍放大而没有任何东西来约束。

## 后果 {#consequências}

**有利**

- 行为开始与 `docs/fluxo.yml` 早已声明的一致——与 ADR 0086 同一类修正（关闭声明的流程与代码之间的分歧），只是这里的"代码"从未存在过。
- 可交付物的分离在没有新基础设施成本的情况下得到证明：零 GenServer、零新 HTTP 路由、零表。
- gate `implementavel` 在 event log 中获得可测量的证据，与 ADR 0054 同一精神——记录下来的决定正是让通过 gate 变得可测量的东西。

**不利**

- **"我触发了评估"与"计划已存在"之间的等待窗口是异步且没有回调的。** Dev Lead 只有在**模型**决定再次调用 `assess_implementability` 时才会发现计划已就绪——没有自动恢复（与 ADR 0086 中由事件驱动的审批挂起不同）。之所以接受，是因为 `Engine.Gates.QaEstrategiaAgent` 在一个独立的进程（`qa-lead`）中运行，而 Dev Lead 不能在不耦合两者的情况下，阻塞一个同步的 `run_turn/2` 去等待**另一个**进程的结果——而 14 次迭代的上限给了模型足够的余量在**同一个**轮次内再试。
- **`appsec` 仍为 `proposto`。** 本次交付没有解决 `docs/fluxo.yml` 同一段中声明的第二个角色——有意识的范围决定，记录在此，以便下一条工作线复用**同一**模式而无需重新打开决定。

## 考虑过的替代方案 {#alternativas-consideradas}

**新的 `qa-estrategia` agent，自己的 GenServer。** 被拒绝：`docs/fluxo.yml` 本身早已反对——"不一定是新 agent：分离的是可交付物"。一个新 GenServer 会复制 QA 区域的 `Wake`/`Registry` 连线而毫无收益，因为这条路径从不挂起，也不需要那套证明独立进程合理的恢复机制。

**`assess_implementability` 阻塞等待测试计划（端到端同步调用）。** 被拒绝——这需要 Dev Lead 在**自己的**进程中直接调用 `QaEstrategiaAgent.run/4`，并在 Dev Lead 的轮次**内部**运行 QA 策略的 `ToolLoop`。技术上可行（两个工具循环都不挂起），但会耦合两个 agent——QA 策略中的一次读取错误会拖垮 Dev Lead 的整个轮次，而一方的迭代上限会开始吃掉另一方的。保持进程分离、让结果经由 event log 传递，是 api↔engine 之间一切通信早已采用的**同一**设计。

**复用 `Engine.Dev.ContextBuilder.fetch/3`**（`QaPerformanceSegurancaAgent` 早已使用的构建器）**而不是新的构建器。** 被拒绝：那个构建器按 `task_id` 工作——它假定已有 dev agent、worktree 以及已提交到某个分支的代码。为 PRE-DEV 的评估强塞一个虚构的 `task_id`，会颠倒 gate 存在所要保证的顺序（在花 token 写代码**之前**评估）。

## 参考 {#referências}

- `docs/fluxo.yml` — 角色 `qa-estrategia`（现为 `active`）和 `appsec`（仍为 `proposto`）
- `docs/gates.yml` — gate `implementavel`（现为 `active`）
- [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) — 把 gate `implementavel` 声明为 `planned`
- [ADR 0038](0038-hierarquia-de-agentes.md) — QA 区域（Lead + 子专业），本设计的结构先例
- [ADR 0086](0086-dev-lead-plano-suspende-para-aprovacao.md) — `assess_implementability` 所重复的三结局 `proposed_action` 模式
- `apps/engine/lib/engine/gates/qa_estrategia_agent.ex`、`qa_estrategia_context.ex`、`qa_lead_server.ex`、`dispatcher.ex`
- `apps/engine/lib/engine/agents/dev_lead_tools.ex`、`dev_lead_server.ex`
- `apps/api/src/domain/actions/decide.ts`
