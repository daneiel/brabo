---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0067 — gate 在重启后存活

- **状态：** 已接受
- **日期：** 2026-08-12
- **背景：** 审查中反复出现的发现——"Dev 审查中的 PR 永远不会结束"
- **扩展：** [ADR 0057](0057-o-gate-espera-a-aprovacao.md)，关系与后者对 [ADR 0052](0052-dev-agent-espera-aprovacao-no-meio-do-laco.md) 的相同

## 背景 {#contexto}

[ADR 0057](0057-o-gate-espera-a-aprovacao.md) 为 gate agent 解决了 0052 早已为 dev agent 解决的问题：在循环中途挂起，而不是带着谎称的 `origin: infra` 死掉。它自己在"本 ADR 不解决的内容"一节中早已声明：**"等待期间重启会丢失循环"**——`QaLeadServer` 的 `pendente`/`em_voo` 只存在于进程的内存中，而该进程是 `restart: :temporary`（与 `SecOpsAgentServer` 相同），创建与 `dev_agent_states`（Fase 12b）等价的持久表被声明为一个独立的范围。

那个独立的范围就是本 ADR——但它覆盖的比原句所暗示的**更多**。重新调查代码（`qa_lead_server.ex`、`secops_agent_server.ex`、`dispatcher.ex`）发现了**第二个**丢失窗口，与在 `{:awaiting, ...}` 中的挂起不同：gate 的中间转换——`DevAgentServer.correct/3`（退回给 dev）和 `Dispatcher.run_secops/2`（QA 批准，调用 SecOps）——是内存中的**直接**调用，发生在 `record_gate_verdict` 已经在 api 中**持久地**推进 task 的 `gate_status` **之后**。如果进程恰好在两者之间倒下（裁决已写入，进程内调用尚未进行），api 认为下一个 gate 正在运行，而 engine 永远不会调用任何人——PR 永远卡在 `awaiting_secops`（或者卡在等待一个永远不会到来的修正的 `awaiting_qa`），engine 的任何重启都修不好，因为没有任何东西知道那一步还待处理。

所以是两个窗口，不是一个：

1. **`in_progress`**——进程在任何裁决被写入**之前**倒下（在周期开始时，或者在某个挂起等待审批的子 agent 中途，即 0057 早已覆盖的情况）。
2. **`dispatch_pending`**——裁决**已经**写入（在 api 中，持久），只是应用下一步的进程内调用（`correct` 或 `run_secops`）丢失了。

第一个 0057 记录了；第二个此前没有被察觉——而它在实践中是最容易发生的：恰恰就是一个 HTTP 响应返回与下一行代码运行之间的间隙。

## 决策 {#decisão}

**gate 获得持久状态，采用与 `dev_agent_states`（ADR 0045）相同的惯用法，以及一个恢复待处理内容的救援者——无需人工干预。**

### 表：`gate_states`（`engine` schema） {#a-tabela-gate_states-schema-engine}

复合键 `{project_id, task_id, gate}`。每一行代表一个**进行中**的 gate 周期，带有一个 `step`：

- `"in_progress"`——本次尝试中尚未写入裁决。`subagent`（可选）只是诊断哪个子专业处于挂起状态——ToolLoop 的 `ctx` **不**被持久化（与 dev agent 的 `laço_pendente` 同样的选择：它在重启后无法存活，假装它能存活比不去尝试更糟）。
- `"dispatch_pending"`——裁决已经写入；`next_action`（`"correct"` | `"run_secops"`），以及当它是 `"correct"` 时的 `correction_reason`/`correction_diagnosis`，保存 `DevAgentServer.correct/3` 在不重读 api 的情况下被再次调用所需的东西。

在 `qa_lead_server.ex`/`secops_agent_server.ex` 早已进行转换的**同一些**位置写入和删除——不存在平行路径。`run_area`/`run_secops` 在任何子 agent/扫描器运行之前写入 `in_progress`；`apply_gate_result`/`apply_verdict` 在 `record_gate_verdict` 返回 `correct`/`run_secops` 之后**立即**、在进行进程内调用**之前**写入 `dispatch_pending`；调用之后（或在任何其他终结结局——`done`、阻塞或错误——时）该行随即被删除。

### 救援者：`Engine.Gates.GateRescuer` {#o-resgatador-enginegatesgaterescuer}

扫描 `gate_states` 中停滞超过 `gate_rescue_stale_after_seconds`（默认 900 秒——**有意宽松**：QA 子 agent 的 ToolLoop 可以正当地运行多达 `TOOL_LOOP_MAX_ITERATIONS_GATE`（60）次迭代，而一个短阈值会救援——并重复——一个只是慢的周期）的行。对每一行：

- `in_progress` → 重新启动整个**区域**（再次 `Dispatcher.run_qa`/`run_secops`）。不可能进行**精确**恢复（`ctx` 没有存活），但这是**安全**的：api 只接受仍然**拥有**当前 `gate_status` 的 gate 的 `record_gate_verdict`（`nextGateStatus`，`pr-gate-state-machine.ts:67-69`）——如果这个周期已经通过其他途径结束，第二次尝试会收到错误（今天是一个未映射的 500——见"后果"），不会损坏任何东西。
- `dispatch_pending` → 精确地重新发送缺失的那次调用（`Dispatcher.run_secops`/`DevAgentServer.correct`）。

从两个地方调用，与 `Engine.Dev.DevRehydrator` 使用的同一对：启动时一次（`Engine.Application`，在两个 gate supervisor 之后），以及通过 `Engine.Workers.GateRescueSchedulerWorker` 周期性地调用——一个自我重新调度的 Oban 节拍（默认 5 分钟），与 `ModelSyncSchedulerWorker`/`AnamneseSchedulerWorker` 同一惯用法。复用 Oban 而不是发明另一种调度机制是有意的决定：engine 早已为此使用 Postgres 队列，只为 gate 再搞第二种机制，就是出于错误的理由重复已有的东西。

### 防止重复工作的两道守卫 {#duas-guardas-contra-duplicar-trabalho}

gate 周期再次运行代价高昂（LLM），在极端情况下可能为同一步产生两个并发的裁决。两道守卫，单独都不完美，合起来足够：

1. **任何救援之前先 `Registry.lookup`。** **本**节点上活着的进程永远不会被打扰——如果它仍在运行（即使很慢），救援不会行动。这**不**覆盖另一个副本：`Engine.Gates.Registry` 是节点本地的，与 `Engine.Dev.Wake` 自 ADR 0045 起早已承担的保留相同（因此 PubSub 投递是至多一次）。
2. **陈旧阈值**正是为守卫 1 不覆盖的情况而设的第二道防线——宽松到足以让远程副本在另一个副本再次尝试之前完成一个真实的周期。

剩余竞争（两道守卫同时失效）的最坏结局是**重复**且**廉价**的工作——SecOps 重新扫描（确定性的，没有 LLM）；QA 重新运行，而第二次 `record_gate_verdict` 被 api 拒绝，不写入任何东西——绝不是不一致的数据。`DevAgentServer.correct/3` 自 ADR 0052 起就通过状态守卫实现幂等（`handle_cast({:correct, _}, state)` 只在 `status == :awaiting_gate` 时行动）；在第一次已经推进 agent 之后到达的第二次 `correct` 是**空操作**，没有代价。

## 后果 {#consequências}

**ADR 0057 的发现被关闭，而且超出了它所声明的范围。** 两个窗口（`in_progress` 和 `dispatch_pending`）都被覆盖；第二个在这次调查之前甚至没有被命名。

**`InvalidGateActionError` 仍然没有映射的过滤器。** 为本 ADR 调查 api 时发现，对已不再拥有 `gate_status` 的 gate 第二次调用 `record_gate_verdict`，会作为 Nest 的通用 500 泄漏出来，而不是一个语义化的 4xx——`DomainTransitionErrorFilter` 只捕获 `InvalidSessionTransitionError`/`InvalidActionTransitionError`。`in_progress` 的救援依赖这一拒绝才不会在剩余竞争中损坏任何东西，而它**有效**（异常在任何 `UPDATE`/`INSERT` 之前中断——`record-gate-verdict.use-case.ts:82-88`，在事务之前），但日志比必要的更难看。映射过滤器是可观测性的改进，不是 bug 修复，不在本 ADR 中——已记录在 backlog。

**`record_gate_verdict` 返回与本地 `dispatch_pending` 的 `upsert!` **提交**之间的剩余窗口没有关闭——它被接受，理由与 ADR 0045 对 `Engine.Dev.Wake` 已接受的相同。** 两次写入（api 中的 `UPDATE`，远程；engine 中的 `INSERT`，本地）在没有 2PC 的情况下不能彼此事务化——不在范围内。它们之间的进程内调用是本地且瞬时的（没有网络 I/O），所以窗口是微秒级而不是秒级；宽松的陈旧阈值让扫描器在现实中永远不会与它相撞。

**多副本仍是已知的限制。** 节点本地的 `Registry`，至多一次的 `Engine.Dev.Wake`——本 ADR 两者都不改变，只是使用了早已存在的同一模式（上面的守卫 1）。彻底关闭它（`:global` 注册）仍是 ADR 0045 的后续工作，不是本 ADR 的。

**X/Z/AD 发现（动词白名单不收敛）仍然不在范围内**——ToolLoop 的策略没有变化，白名单没有变化。本 ADR 只关乎 gate 在周期中途重启后**存活**，不关乎它在周期内部做什么。

## 考虑过的替代方案 {#alternativas-consideradas}

**通过持久化挂起的 `ctx` 来**精确**恢复它。** 被拒绝，理由与 dev agent 早已不对恢复的 `working` 这样做相同：ToolLoop 的消息历史很大，随 harness 改变格式，持久化一种只在救援时读一次的格式，是生来就会腐烂的债务。从零重启区域维护成本更低，并且按照 api 状态检查的论据同样安全。

**只为 gate 设第二种调度机制**，而不是 Oban。被拒绝：engine 早已把 Postgres 队列用于一切（outbox 消费、dev agent 唤醒、Anamnese、目录同步）——只为这个发明另一种机制，就是出于错误的理由重复基础设施。

**把陈旧阈值降到几秒，以便更快救援。** 被拒绝：一个正当地运行到允许的 60 次迭代中第 40 次的 QA 子 agent 会在**中途**被救援，重复本来马上就要自己完成的工作。为一次真正的救援等待最多 15 分钟的代价，小于过早救援一个只是忙碌的周期的代价。
