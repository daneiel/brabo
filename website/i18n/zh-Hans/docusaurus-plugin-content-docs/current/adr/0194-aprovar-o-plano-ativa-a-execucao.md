---
traducao_de: fe6d073c10c82c4a1844c7be6fc497a0a5733af9
---

# 0194 — 批准 Dev Lead 的计划会激活执行，任务获得它所分配的模块

## 状态 {#status}

**已接受。** 2026-10-01（AT-263 和 AT-274，史诗 EP-030，第 36 轮；所有者于 10月1日的决定：*"a ativação da execução passa a ser o APROVAR do plano do
Dev Lead; aceitar o handoff do Dev Lead só o traz para planejar"* 以及 *"quem
atribui o módulo da tarefa é o Dev Lead, ao montar o plano de execução; só o
dev daquele módulo a pega"*）。修订（不编辑）[ADR 0069](0069-fusao-condicional-do-handoff-com-a-ativacao-de-execucao.md)（接受与激活的条件融合，RN-161），以及 [ADR 0086](0086-dev-lead-plano-suspende-para-aprovacao.md) 中说 `propose_execution_plan` 没有执行管道的那一部分。保留 [ADR 0165](0165-o-repositorio-nasce-no-handoff-ao-arquiteto.md)（仓库在接受给 Arquiteto 的 handoff 时诞生，Dev Lead 的是第二道门，没有仓库的 `execution/activate` 是 409）和 [ADR 0061](0061-tipo-da-sessao-na-criacao.md)（咨询会话中的 `execution.activated` 是 409）。

## 背景 {#context}

修改之前在 `dev`（d89f777）中测得：

- **发出 `execution.activated` 的**只有 `ActivateExecutionUseCase`，而它只由路由 `POST .../execution/activate` 调用。接受的后端（`AcceptHandoffUseCase`）从未激活任何东西：当目的地是 `arquiteto` 或 `dev-lead` 时它开通仓库，并激活 **agent**。“接受时激活”是 **WEB** 的——当目的地是 `dev-lead` 且 workspace 角色是 `maintainer`/`owner` 时，`handleAcceptHandoff` 串联 `activateExecution`（RN-161）。
- **计划没有使用者。** 自 ADR 0086 起 `propose_execution_plan` 是 `proposed_action`，Dev Lead 挂起等待决定，但被批准后它就永远停在 `approved`：`ApproveActionUseCase` 没有该类型的分支，而 Dev Lead 读到的是“plano aprovado e registrado”。在 9月29日的真实使用中，执行在 06:45:01 接受时启动；计划在 06:47:47 到达，停在 `pending`。
- **任务没有模块。** `claimNext` 取下一个属于 `ready` 故事、且其 `module_ids`（jsonb，多个）包含该 dev 模块的 `todo` 任务。对于一个有两个模块的故事，`dev-input-keyboard` 拿到了“loop de queda automática da peça”，而 `dev-board-engine` 拿到了“mapear teclas”（会话 d7e9，seq 185/187）。
- Dev Lead 看不到任何 `task_id`：kickoff 只列出模块和故事，取自它自己会话的日志。

## 决策 {#decision}

1. **接受 Dev Lead 不会激活执行**，对任何角色都不会。`handleAcceptHandoff` 只接受；`AcceptHandoffUseCase` 不变（继续作为第二道门开通）。卡片上显式的“Ativar execução”按钮（RN-137）和概览上的**保留**：它们是决定跳过计划的人的独立操作，而路由 `execution/activate` 保留所有拒绝。
2. **批准 `propose_execution_plan` 会执行计划**，在 api 的一个新执行器中——`ExecuteExecutionPlanUseCase`，位于执行模块，紧挨 `ExecuteParallelizationUseCase`——由手动批准和自动批准调用（该类型仍在 `decide.ts` 的绝对上限**之外**，正如 ADR 0086 所决定）。它：针对当前的 `module_map` 重新读取计划；写入任务的模块；并调用与按钮**相同**的 `ActivateExecutionUseCase`，以批准者（或在自动批准时，以打开会话的人）作为激活者。没有 `originSessionId`：Dev Lead 的会话是它恢复和叙述的地方。结局是 `executed`（`sessaoDeExecucao`、`modulos`、`tarefasAtribuidas`）或 `failed`（`motivo`），在时间线上有 `execution.plan_applied`/`execution.plan_failed`，这也是 Dev Lead 恢复时读到的内容。
3. **任务获得 `module` 列**（`tasks.module text NULL`，迁移 `0068_modulo_da_tarefa`）。计划携带 `tarefas: [{ taskId, modulo }]`，由一个**纯**函数（`lerPlanoDeExecucao`）针对当前的 `module_map` 和项目的任务进行验证，**两次**：在提议时（400 `plano_de_execucao_invalido`，不创建动作——这句话作为工具错误返回给 Dev Lead）以及在批准时（映射可能已经改变；拒绝变成 `failed`，不写入任何东西）。Dev Lead 的 kickoff 列出**项目** backlog 中的待处理任务（`list_backlog`），带 `task_id` 和故事的模块。
4. **只有该模块的 dev 才会领取任务。** `claimNext` 和 `countClaimableByModule` 开始使用同一个谓词：`t.module = $modulo`，**或者**没有模块、其故事恰好有**一个**模块且就是 `$modulo` 的任务。

## 后果 {#consequences}

- **激活开始需要批准一个有效的计划**，而只有当被引用的**每个**任务都分配到 `module_map` 的一个模块时，计划才有效。无法组装 `tarefas` 的 Dev Lead（backlog 为空、任务在另一个项目中）不能通过新路径激活任何东西；显式按钮仍然是出路，并被声明为出路。
- **为没有模块的任务搭的桥是有意且狭窄的。** 没有它，从概览不带计划激活的人将没有任何可领取的任务；把它限制在只有**一个**模块的故事上，“只有那个模块的 dev”这条规则仍然成立，因为那里没有别的模块。属于多模块故事、没有模块的任务会停着，直到下一个计划——而 PO 不分配模块，所以计划批准**之后**创建的任务会落入这种情况。关闭这一点（由 PO 分配，或者自动重新规划）是另一项决定。
- **提示 `task.became_claimable` 仍按**故事**的模块路由。** 唤醒一个不会领取任何东西的 dev 只花一次查询，不花任何模型费用；按任务的模块路由需要改动提示的发出者，超出了范围。
- **按模块的 `agentes` 仍然只是信息性的。** 激活按 `module_map` 的每个模块启动一个 dev，和以前一样；每个模块多于一个仍然通过 `parallelize`（RN-083），带它的上限。
- **对这个类型，engine 的 `propose_action` 调用仍使用 Req 默认的 15 秒。** 自动批准时，api 在同一个请求中激活执行（播种指令和自主权，调用 engine）；没有测得超过 15 秒的情况，而如果超过，即使工具结果说是传输错误，结局也会经由时间线到达。
- **批准计划后，界面不会导航到执行会话**（RN-634 在按钮上这样做）：批准属于 `ApprovalCard`，是另一条战线的。Dev Lead 会说执行是在哪个会话中启动的。
