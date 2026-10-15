---
traducao_de: 26aa218023eb19bf5313e2303545808e0b972a08
---

# 0143 — dev agent 只在容器之后

## 状态 {#status}

已接受——2026-09-04

## Context {#context}

在项目 `exp001` 的一次真实执行中（2026-09-04），流程走得很远：Gitflow bootstrap、`product_brief`、`module_map`，以及 18:00 Arquiteto 交付 `project_image`、`module_routing` 和 C4 图。两份 ADR 变成了 PR，三次合并通过。然后**十个 dev task 一下子全部卡住**，结果都一样：dev agent 的工作树没有地方诞生。

这里重要的发现不是那个特定文件夹的原因——而是**没有任何东西让容器先于 dev agent**。没有提出任何 `container_start`，十个 dev agent 照样开始了，然后卡住十次。

在流程的同一行上还有第二个更隐蔽的缺陷。
[ADR 0134](0134-dev-agents-executam-dentro-do-container.md)（RN-492）让 dev agent 的终端命令穿过 engine → api → broker，并在真实容器**内部**运行——**当有容器时**。没有时，
`Engine.Actions.TerminalExecutor.decisao_de_execucao/1` 落入
`:caminho_de_sempre`，也就是在 engine 进程内的 `System.cmd`——这个进程与数据库、api 以及安装中所有其他项目通信。ADR 0134 存在所要创造的隔离只在正常路径上有效，而它的缺失并不拒绝：它降级，而且是静默降级。

本 ADR 关闭这两半。

## Decision {#decision}

### 1. 守卫住在 `try_claim` 中，而不只是在 HTTP 边界 {#1-a-guarda-mora-no-try_claim-não-só-na-fronteira-http}

`Engine.Dev.AgentIo.try_claim/2`——**唯一**的 claim 入口——在调用 `claim_task/1` **之前**查询 `Engine.Containers.ProjectContainerLifecycle.running?/1`。如果 `project_containers` 中没有**已登记**为 `running` 的行
（[ADR 0081](0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md)），agent 落入
`:idle`，持久化并发出 `dev.blocked_by_container`——不调用 api。

这个谓词**早已存在**：它与 `TerminalExecutor` 自 ADR 0134 起查询的是同一个。没有为回答这个问题构建任何新东西；改变的是谁来问、何时问。

api 中的等价 gate（`ActivateExecutionUseCase` 在没有
`ciclo?.status === 'running'` 时以 400 拒绝）是姊妹 PR 的决定，正是它在点击时给**人**提醒。它不能取代这里的守卫，因为 claim 有一条任何路由都覆盖不到的路径：**重建（rehydration）**。
`Engine.Dev.DevRehydrator` 不会 cast `:work`；engine 重启后执行 claim 的是 `DevAgentServer.init/1` → `finish_restart_recovery/1` →
`try_claim/2`，不经过任何端点。只放在 HTTP 边界的 gate 会让每个重建的 agent 在没有容器的情况下重新开始工作——而重启恰恰是没人在看的时刻。

守卫在 `claim_task/1` **之前**，而不是之后：先声明再立即归还，会让 task 被标记却没有活着的主人，而这正是 `AgentIo.block_task/4` 存在所要永不产生的状态。

### 2. `:idle`，而不是新状态 {#2-idle-e-não-um-status-novo}

`try_claim/2` 自身 `{:error, reason}` 子句的 docblock 早已记录了原因，写于第 12b 阶段修复 agent 永久卡死时：*"`:idle` é o único estado do qual um wake ainda
resgata"*。`handle_info/2` 的所有守卫都与之匹配——
`{:wake, :became_claimable}` 要求 `:idle`，`:rearm` 要求 `:idle_tripped`，
`{:gate_resolved, …}` 要求 `task_id` 匹配。

在这里发明一个 `:blocked_by_container` 将是一个**没有任何东西**能救回的状态：agent 会永远停住，重现第 12b 阶段为消除它而存在的症状。区分“因为队列空了而停”与“因为没有容器而停”的是**事件**（`dev.idle` ×
`dev.blocked_by_container`），而不是状态——而事件是持久的，遵循 RN-059 的模式。

### 3. 唤醒经由 outbox，在专属聚合中 {#3-o-wake-vem-pelo-outbox-num-agregado-próprio}

读取不会通知任何人。一个已经停在 `:idle` 的 agent 会一直停着，直到某个无关事件经过——实际上就是“直到有人手动重新启用执行”。

因此 `RegistrarTransicaoDeContainerUseCase` 进行发布：在写入到达 `running` 时，它在**同一个事务**中追加一行 outbox
`container.running`。`Engine.Outbox.Drain` 开始排空第三种 `aggregate_type`（`"container"`，与 `"session"` 和 `"task"` 并列），`Engine.Workers.DevAgentWakeWorker` 把消息投递给项目的 agent。

其中有三个选择：

- **`aggregateType: 'container'`，而不是 `'task'`。** `task` 聚合本已被排空，复用它在 drain 中零行代码成本——但这个事件与任何 task 无关。[ADR 0099](0099-neo4j-grafo-de-conhecimento-e-templates.md) 的 `graph_projection` 已经确立 `aggregate_type` 是不同消费者互不竞争的方式；为了省一行查询而在这上面撒谎会老得很难看。
- **`aggregateId` 是**项目**，而不是 `project_containers` 的那一行：消费者按项目唤醒 agent，而那一行可能已被重建。
- **`{:wake, :became_claimable}`，已经存在的消息。** 它的语义已经是“现在可能有活干了”——
  `EngineWeb.ExecutionCommandController.acordar/4` 的注释正是这样把它用于重新启用执行，那同样与特定 task 无关。新消息需要在**两个**服务器（真实的和 Noop）中新增 `handle_info/2` 子句，守卫与已有的相同，却没有任何不同的决定要做。

扇出按**项目**（`DevAgentState.list_by_project/1`），而不是按模块：容器属于项目，而 api 无从知道 engine 一侧存在哪些模块。

### 4. 终端不再静默降级 {#4-o-terminal-para-de-degradar-calado}

`decisao_de_execucao/1` 增加 `:recusar_container_ausente`，镜像 `runner` 模式自
[ADR 0104](0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md) 起就有的
`:recusar_nao_verificado`/`:recusar_runner_desconectado`。这是同一纪律——“缺少前置条件，就不在任何地方执行”——应用到尚未拥有它的模式上。

`mounted` 进入**同一个分支**：有 `running` 容器时，像 `container` 一样穿到 broker；没有时，拒绝。在 `mounted` 开始真正启动容器之后再区别对待它将是任意的。

兜底的 `_ -> :caminho_de_sempre` 收缩为它本应独自承担的情况：**不存在的项目或格式错误的 `project_id`**。没有任何执行模式会落入其中。

拒绝是普通的 `failed_result`，绝不是崩溃——与该模块其他两种拒绝的失败合约相同。

## Consequences {#consequences}

**没有运行中容器的项目停止工作，并说明原因。** 这正是该决定存在的目的，不是副作用。这也是它只能在**之后**——在为 `mounted` 模式提供容器的改动之后——进入的原因：没有那些改动，`mounted` 项目将完全没有 dev agent，唯一的出路是 `container` 模式。

**之前的每个 dev agent spec 都开始需要一个 `running` 容器。** engine 中有九个测试文件，每个的改动都是一行 setup（`Engine.DataCase.container_running!/1`）——而不是一个可通过配置替换的模块。这是选择：一个只为让测试套件通过而存在的生产接缝，会让守卫恰恰在被演练的地方失效。

**一个问题，两个提问的地方。** `AgentIo.try_claim/2` 和
`TerminalExecutor.decisao_de_execucao/1` 都调用同一个
`ProjectContainerLifecycle.running?/1`。这不是两种推导：是一个函数，有两个调用者，回答不同的问题（“我可以开始吗？”和“这在哪里运行？”）。

**唤醒的投递仍然是至多一次**，与所有 `Engine.Dev.Wake` 一样（它的 moduledoc 自第 12b 阶段起就声明了这一点）。如果广播发生时 agent 暂时不在线，它会保持 `:idle` 直到下一个事件——包括手动重新启用执行，后者投递同一个 `{:wake, :became_claimable}`。

**已登记的 `running` 仍然不是观测到的 `running`**
（[RN-486](../business-rules.md#rn-486)）。一个在外部死掉的容器仍会通过这个守卫；agent 执行 claim，失败出现在对 broker 的第一次调用中，作为普通的命令失败。合并两者需要每次 claim 一次网络调用，而 RN-486 明确不合并它们。

## 参考 {#referências}

- [ADR 0081](0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md)——
  `project_containers` 表和状态机
- [ADR 0134](0134-dev-agents-executam-dentro-do-container.md)——容器内的终端命令；本 ADR 让它落地
- [ADR 0135](0135-portao-de-imagem-nos-tres-modos.md)——镜像关口开始在三种模式下有效
- [ADR 0137](0137-o-runner-sobe-o-container-do-projeto.md)——`mounted`/`runner`
  在用户机器上启动容器
- [RN-502](../business-rules.md#rn-502)
