---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0045 — dev agent 的按事件重新调度，以及熔断器

## 背景 {#contexto}

dogfooding 的 P1 #10 号发现，原文摘自 `docs/missions/dogfooding-mission.md:659`：

> **Um dev agent processa UMA task e para.** `:work` só é disparado na
> ativação e no aceite de paralelização; o `report_done` abre o gate e
> não se reagenda; nenhum worker do Oban redispara. Teto por módulo: 1
> task, ou 2 com paralelização.

实际后果见同一份收获的 `:396-398`：阶段 10 是**分批**运行的——在每个 task 之间都需要人重新激活执行（或重启
engine），因为系统中没有任何东西能把 agent 从已打开的 PR 带回到“可以领取”的状态。#11 号发现（`:660`，P2）
描述了试图从外部绕过这一点的症状：重新激活不会重新触发 `:work`（supervisor 返回 `:existing`），还会创建一个
孤立的会话。

在设计**之前**于代码中验证过的两个事实，塑造了整个决定：

1. **worktree 是按 agent 的，而不是按 task 的。** `WorktreeManager.add_worktree/3` 在创建下一个 worktree
   之前会删除该 agent 的前一个，而 `QaLeadServer`/`SecOpsAgentServer` 在 gate 运行时通过
   `DevAgentState.find_by_task_id/2` 找到它。PR 一打开就领取下一个 task，会在物理上摧毁 gate 仍在扫描的那个
   worktree。这决定了打开的 PR 不能释放 agent——需要一个在 gate 结束之前**保留** worktree 的状态。
2. **`prod/patches.yaml` 运行 2 个 engine 副本**，而 `Engine.Dev.Registry` 是节点本地的。一个异步 job
   （Oban）可能在任何副本上运行；通过 Registry 解析“这个 agent 的进程在哪里”，在生产中会有一半的情况投递错。

## 决策 {#decisão}

### 信号是 outbox，而不是进程内调用 {#o-sinal-é-outbox-não-uma-chamada-em-processo}

`task.gate_resolved`（只在**终态**结果——`done`/`blocked`——时）和 `task.became_claimable`（story 被晋升、
在已就绪 story 下创建了 task、task 被解除阻塞）是 api 发出的 outbox 行，由已有的 `Engine.Outbox.Drain` 读取
（`aggregate_type` 在 `"session"` 旁边加入了 `"task"`），并路由到新的 `Engine.Workers.DevAgentWakeWorker`——
一贯的机制，新的处理器。

选择 outbox 而不是比如让 gate 像对 `changes_requested` 已经做的那样调用 `DevAgentServer.correct/3`（这个
进程内调用**继续存在**，未改变），关乎**存续**：一条 outbox 行能在裁决与唤醒之间的 engine 重启中保留下来。
进程内调用不能——而这恰恰是阶段 12b-6（重新水合）所需要的属性，用来让重新水合的 `awaiting_gate` 对重启之后
才解决的 gate 做出反应。

### `awaiting_gate` 是联锁，而不是标签 {#awaiting_gate-é-o-interlock-não-um-rótulo}

PR 打开 → agent 进入 `awaiting_gate` 并**保持** `task_id`/`worktree`/`branch`——在 gate 解决之前什么都不领取。
只有终态结果（经由 `task.gate_resolved`）才通过 `finish_task/2` 释放。上面事实 #1 中的 worktree 就是这个状态
存在的全部理由。

### 通过 PubSub 投递，而不是 Registry {#entrega-por-pubsub-não-registry}

`Engine.Dev.Wake` 使用 `Phoenix.PubSub`（已作为 `Engine.PubSub` 受监督，到目前为止在 `lib/` 中未被使用）——
免费获得集群范围，不同于节点本地的 Registry（事实 #2）。`DevAgentServer` 在 `init/1` 中订阅自己的主题；
`DevAgentWakeWorker` 从不直接调用 GenServer，总是经由 `Wake.deliver/3`。

**有意接受的限制：投递是 AT-MOST-ONCE。** 如果在广播发生时 agent 的进程暂时不在，唤醒就会丢失，agent 只会在
**下一个**事件时醒来。要彻底关闭这一点，需要为 dev agent 使用 `:global` 注册——`Engine.Sessions.SessionServer`
已经出于同样原因这样做了——并重写 `AgentIo.via/2`、`DevAgentSupervisor.start_agent` 和 `Monitor`。不在本阶段
范围内；见“留待以后”。

### 熔断器放在 engine 中，而不是 api 中 {#o-circuit-breaker-mora-no-engine-não-na-api}

`backlog.task_blocked` 的 `actor.id` 是**谁阻塞的**（`qa-agent`、`secops-agent`、`qa-lead` 或 dev 自己）——
api 无法据此区分“**这个** agent 的连续序列”。`consecutive_blocked` 存放在 `dev_agent_states` 中，只在一个地方
（`finish_task/2`）递增，因为那是 agent 得知自己 task **所有**结果的唯一点——本地的（ToolLoop）或远程的
（带 `nextAction: "blocked"` 的 `task.gate_resolved`，gate 的修正上限被突破）。RN-047 详细说明了机制和不变量。

上限（`max_consecutive_blocked`）遵循 `task_budget_micros` 的模式——`projects` 中的一列，在激活时解析
（参数 → 项目设置 → 默认值）——但获得了那一项从未有过的东西：PATCH + 设置中的字段。用户的决定：即使要付出更多
表面，熔断器的上限也属于那种希望无需盲目地重新激活执行就能调整的东西。

### 重新武装是离开 `idle_tripped` 的唯一出口 {#rearm-é-a-única-saída-de-idle_tripped}

一次点击（`POST .../agents/:agentId/rearm`）——没有自动解除，与对单个 task 的 `unblock` 是同一原则。api 在
engine 中任何事情的发生能得到保证**之前**记录 `dev.rearmed`，`actor: user`（与 `AcceptParallelizationUseCase`
已在使用的顺序相同——先 engine，后事件——理由也相同：event log 是不可变的，在拒绝之前记录会在其中留下谎言）。
engine **不**发出自己的第二个 `dev.rearmed`：那会是同一事件在同一会话中被不同操作者计数两次。之后发生的事情
（领取了，或回到 idle）已经通过 `dev.working`/`dev.idle` 叙述，由重新武装的 `try_claim/1` 触发。

## 后果 {#consequências}

- **核心需求的验收**：一个在某模块中有 N 个就绪 task 的项目，会由**一个** agent 依次处理全部，无需重启 engine，
  也无需手动重新激活——领取 → PR → gate 批准 → 领取下一个 → 队列为空 → idle → 新 task → 唤醒这条链是确定性的，
  并经过端到端测试（`dev_agent_chain_test.exs`），中间是**真实**的 outbox/drain/worker/PubSub 基础设施，
  而不是模拟。
- **dev↔gate 的修正路径（`changes_requested`）完全保持原样**——进程内，不经 outbox。这是重新调度不会复制该
  路径的机械证明：`task.gate_resolved` 只为终态结果发出，因此不存在让它触发的第二行。
- **重新水合不再是“空白返回”**：`awaiting_gate` 和 `working` 保留或恢复了有意义保留的东西；被中断的 `working`
  会带着关于重启的诚实诊断进入阻塞，而不是悄悄地重新领取，或试图恢复一个已不存在的 ToolLoop。
- **原子领取没有改变**（`FOR UPDATE OF t SKIP LOCKED`，`backlog.repository.ts`）——重新调度增加了**谁**去尝试
  领取（同一个 agent 更多次；模块中的两个 agent 一起醒来），而不改变原有的保证。api 的并发证明（8 个真实的并行
  领取）保持不变；新的证明在 engine 一侧，关于反应逻辑。
- **`NoopDevAgentServer` 完全不在这个机制中**：从不打开 gate，从不被唤醒，`status` 固定为 `"working"`。它是
  基础设施的 smoke test，而不是需要与状态机同步维护的第二个产品。

## 对抗性审查，以及它发现了什么 {#revisão-adversarial-e-o-que-ela-achou}

实现在离开分支**之前**经过了一次独立审计——审计时没有把上面的理由提供给审计者，以免继承作者的盲点。它发现了
**八个缺陷，其中四个能卡住一个 agent 或启动过程**。全部都已修正；记录留在这里，因为教训比清单更有用。

**本 ADR 的决定没有改变。** 改变的是它的实现，它在测试够不着的地方是错的。

**为什么整个测试套件在里面有四处卡死的情况下全绿：** 假对象（`FakeWorktreeManager`、`FakeEngineApiClient`）
立即返回，并且**总是成功**。没有测试路径覆盖失败的 `claim_task`、`init/1` 内部 ToolLoop 的真实开销，也没有
覆盖 gate 在 `RecordGateVerdictUseCase` 之外结束 task 的情况。只走正常路径的测试衡量的是没有拼写错误，而不是
设计的正确性。假对象随修正一起获得了错误分支和可配置的延迟。

四个严重问题，按它们所教的东西：

- **部分状态比错误状态更糟。** `finish_task/2` 把 `task_id` 置零，却不碰 `status`；只要领取时出现一次短暂的
  5xx，agent 就会处于 `task_id` 为 nil 的 `awaiting_gate`——三个守卫**都**不接受的组合。agent 变成了活死人，
  原因是一秒钟的网络故障。
- **`init/1` 是启动路径，不是干活的地方。** 被中断的 `working` 的恢复在里面运行，而由于
  `start_link`/`start_child` 等待 `:infinity`，整个启动会被卡住一个 LLM task 的时长。它被移到了
  `handle_continue`。
- **不是唯一漏斗的漏斗不是漏斗。** 设计说“agent 通过 `finish_task/2` 得知自己 task 的**所有**结果”——但
  `QaLeadServer` 通过直接调用 `MarkTaskBlockedUseCase` 来阻塞，不经过发出事件所在的
  `RecordGateVerdictUseCase`。发出被下移到了真正的漏斗中。
- **我照抄了 outbox 的机制，却没有照抄它的理由。** 四个新的发出点没有使用 `UnitOfWork`，尽管
  `AppendSessionEventUseCase` 使用了——这打破了 `architecture.md` 描述为 outbox 存在原因的那个不变量，而那个
  文件我在同一阶段编辑过。

## 留待以后 {#o-que-fica-para-depois}

- **dev agent 使用 `:global`**——会关闭 PubSub 投递的 at-most-once 缺口。并不紧急：下一个事件（另一个 gate、
  另一个可领取的 task）仍会到达错过一次唤醒的 agent，只是不那么及时。
- **“连续 3 个真实 gate，不重启”作为手动验收，而不是 CI。** QA Lead 和 SecOps 是 LLM 的判断——本质上不具
  确定性，理由与 [ADR 0020](0020-destravar-gates-qa-secops.md) 已为阶段 4a 验收标准记录的相同（“FECHADO, mas
  não determinístico”）。测试套件证明的是裁决**下游**的一切；用真实 gate 进行的 dogfooding 仍是人的演示，记录在
  CHANGELOG 中。
- **ToolLoop 中途被 kill 没有自动恢复，这是决定。** 回合、消息和 worktree 的编辑只存在于内存中——没有可恢复的
  东西。带诊断地阻塞并让人决定，与已经约束本地阻塞的原则相同；完整的自动恢复（在**同一个**已领取的 task 上重新
  派发一个新的 ToolLoop）会是新的自主能力，而 CLAUDE.md 把它标为阶段 12 明确的非目标。
- **worktree 可能在一个待处理的审批之下消失**——审查的 D5 号发现，**有意接受，未修正**。联锁 `awaiting_gate`
  保护的是 **gate** 的窗口，但不保护审批流水线的窗口：当 dev 的自主程度为 `manual`（面板的开关允许）时，
  `git_commit`/`git_push` 保持 `pending`；gate 扫描的是 **worktree** 而不是 PR，因此可能批准，agent 领取下一个
  task，`add_worktree/3` 删除目录——而人的批准到来时，会针对一个已不存在的路径执行。在 12b 之前 agent 会停下，
  worktree 会无限期地存活。

  没有修正，是因为显而易见的修正——只要有来自那个 worktree 的待处理 `proposed_action` 就暂停领取——恰恰会重新
  引入本阶段移除的耦合：agent 会再次依赖外部状态来决定能否工作。这条路径还需要偏离默认值：
  `ActivateExecutionUseCase` 为每个 dev agent 的 `git_commit`/`git_push`/`pr_open` 预置 `auto_approve`，因此
  只有手动改变了自主程度的人才会走到这里。它被记录为已知限制；如果在实践中出现，正确的修正是让 worktree 按
  **task** 而不是按 agent，这是结构性变更，需要独立的 ADR。
- **12b 没有触及同一收获中的 #12 至 #16 号发现**（自由的手动 handoff、story 晋升——那是阶段 12c——、退回给
  PO、面板的共享标签页、审批计数器）。不在范围内。

参考 [ADR 0005](0005-repo-bootstrap-idempotent-steps.md)（本 ADR 为 dev agent 扩展的持久状态 + 重新水合的
模子）和 [ADR 0020](0020-destravar-gates-qa-secops.md)（“绝不悄悄地重新领取”这一原则的来源，以及对不确定性
标准进行手动验收的先例）。
