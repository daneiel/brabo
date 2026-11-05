---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
id: rn-engine
title: 'Regras de negócio — Engine'
sidebar_label: Engine
description: 'As RNs hospedadas na raiz engine.'
keywords: [regras de negócio, engine]
---

# Engine

## PR Gates

### RN-016 — gate 的判定优先于任务的陈述 {#rn-016}

如果任务描述说的是一回事，而 gate 的判定说的是另一回事，判定胜出。

自第 8b 阶段起，“判定”可以来自两个专业——规则不变：每一个都在**其评估范围内**优先于任务（Automação 针对测试覆盖；Performance/Segurança 针对性能 NFR 和代码发现）。`QaLead.consolidar/1` 不在它们与任务之间仲裁：任何一方的任何 `changes_requested` 都已使整体失败（见 [RN-036](#rn-036)）。

- **位置：** 每个专业的提示词，位于
  `apps/engine/lib/engine/gates/qa_automacao_agent.ex` 和
  `qa_performance_seguranca_agent.ex`
- **来源：** [ADR 0020](../adr/0020-destravar-gates-qa-secops.md) §9

## Psicólogo 与 Anamnese

### RN-023 — 终止原因是确定性分类 {#rn-023}

它来自记录的**理由**，从不来自 LLM 的判断，也从不靠排除法。每次失败都记录来源：`infra | modelo | código | política`。

- **位置：** `apps/engine/lib/engine/psychologist/termination_classifier.ex`
- **来源：** [ADR 0022](../adr/0022-fechamento-4b-psicologo.md) §5 和
  [ADR 0020](../adr/0020-destravar-gates-qa-secops.md) §6

## PR Gates

### RN-036 — QA 成为一个领域：Lead 进行整合而不改变 gate 的契约 {#rn-036}

Automação 专业（第 4a 阶段的 `QAAgent`）总是被委派；Performance/Segurança 只在用户故事有相关性能 NFR 时被委派（`Engine.Gates.QaLead.rnf_de_performance?/1`——关键词启发式，不是 NLP）。**不**委派的决定也总是被记录——一个带理由的 `dispensed` 委派，永远不是沉默。

整合：只有当**所有**运行过的委派都批准时才 `approved`；任何
`changes_requested` 都使整体失败，并带上请求修改的专业的 `itens`（条目），每个条目都以提出者的标签为前缀（`"[QA de Automação] ..."`）——这就是在**不**把 `itens` 从 `string[]` 改为其他形状的情况下追溯来源的方式。委派失败（任何来源——`infra`、`modelo`、`codigo`、
`politica`）**永远不会**变成 `changes_requested`：Lead 以真实来源阻塞任务（RN-015）。

到达 api 的 `qa_verdict` 是**同一个**制品，并经过与往常**相同**的路由（`RecordGateVerdictUseCase`、
`nextGateStatus`）——两者都没有改变。api 关于该领域所了解的只存在于 `delegation.completed`/`delegation.failed`/
`delegation.dispensed` 事件中，由专业和 Lead 分别记录。

- **位置：** `apps/engine/lib/engine/gates/qa_lead.ex`（`consolidar/1`、
  `rnf_de_performance?/1`）、`qa_lead_server.ex`（接线）；
  `apps/api/src/application/use-cases/execution/record-delegation.use-case.ts`；
  `apps/api/src/db/schema/agents.ts`（表 `delegations`，枚举 `failure_origin`）
- **测试：** `apps/engine/test/engine/gates/qa_lead_test.exs`（纯决策树）、`qa_lead_server_test.exs`（接线：决定 →
  委派 → 记录 → 整合 → 与往常**相同**的调用），以及——契约未改变的证明——
  `record-gate-verdict.use-case.spec.ts`、`pr-gate-state-machine.spec.ts`
  和 `record-infra-gate-verdict.use-case.spec.ts` **完全不修改**即通过
- **来源：** [ADR 0038](../adr/0038-hierarquia-de-agentes.md)

在 `apps/web` 一侧（第 8d 阶段）：团队面板把 `qa`/
`qa-automacao`/`qa-performance-seguranca` 分组为 lead + 可折叠的专业，PR 时间线把整合后的判定展开为其内部细节（`ProjectApprovalsTab.tsx`、`PrGateTimeline.tsx`），信息流叙述 `delegation.*`——见 `apps/web/src/lib/agents.ts`
（`AREAS`/`areaFor`）。

---

### RN-047 — dev agent 的熔断器：连续 N 次阻塞让它停下，而不在循环中烧掉预算 {#rn-047}

每个 dev agent 维护一个计数器（`dev_agent_states.consecutive_blocked`），记录有多少个任务连续以 `blocked` *结束*——在本地（ToolLoop 中）或远程（gate 的修正次数上限用尽）。达到按项目设置的上限（`max_consecutive_blocked`，默认 3）时，agent 停在 `idle_tripped`，**不再尝试领取下一个任务**。一个获得批准的终止结果会把计数器归零；单独一个被阻塞的任务走正常流程（带诊断退回，可供人解除阻塞）——熔断器处理的是*序列*，而不是任务。

离开 `idle_tripped` 的唯一途径是显式重新武装（`POST .../agents/:agentId/rearm`，角色 `developer`）：它把计数器归零，agent 重新尝试领取任务。没有自动解锁——与 `MarkTaskBlockedUseCase`/`unblock` 的原则相同，只是应用于序列而不是任务。重新武装一个**没有**被熔断的 agent 是 **409**，而不是静默成功：`dev.rearmed` 事件是不可变的，为没有发生的重新武装记录它，就是在事件日志中撒谎。

来自 agent *外部*的阻塞（例如 `QaLeadServer` 内部失败）也需要唤醒它——这就是 `task.gate_resolved` 的发出位于 `MarkTaskBlockedUseCase`（所有阻塞都要经过的漏斗）而不是只能看到其中一部分的 `RecordGateVerdictUseCase` 中的原因。没有这一点，agent 会永远停在 `awaiting_gate`，任务已死，熔断器的计数器永不增加。

在 agent 处于 `working` 时重启 engine **不**计入计数器：被扣留的任务会带着重启诊断被阻塞，但这种阻塞不是 agent "烧穿上限"——而是基础设施倒下了。只有当 dev↔gate 循环本身产生真正的 `blocked` 时，计数器才会上升。

- **位置：** `apps/engine/lib/engine/dev/dev_agent_server.ex`（`finish_task/2`、
  `resume_state/2`），`apps/api/src/application/use-cases/execution/rearm-dev-agent.use-case.ts`,
  `apps/api/src/db/schema/iam.ts`（`projects.max_consecutive_blocked`）
- **测试：** `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  （describe `circuit breaker`），`apps/engine/test/engine/dev/dev_rehydrator_test.exs`
  （describe `the four rehydrated states`），`test/application/use-cases/execution/rearm-dev-agent.use-case.spec.ts`
- **来源：** [ADR 0045](../adr/0045-reagendamento-por-evento-do-dev-agent.md)

### RN-050 — 没有打开的 PR，就不打开任何 gate {#rn-050}

dev agent 提议 commit、push 和 PR，并**读取每一项的结果**。只有三项都执行了，它才打开 gate。如果有一项停在 `pending`——agent 的自主权处于 `require_approval`——它进入 `awaiting_approval`，**持有 worktree**，不打开任何 gate。

没有这一点，gate 无论如何都会打开，而损害是无声的：QA 扫描的是**worktree**，而不是 PR；找到文件，批准；SecOps 批准；任务以完成告终——**一行都没有提交，也没有任何 PR**。直到之后批准 commit 时，用户才会看到动作失败（诊断为空，因为在已删除的目录中 `System.cmd` 返回 `{"", 2}`）。

释放 agent 的是 `task.pr_settled`，当 `pr_open` 达到终止结果时由 api 发出：`opened: true` 打开 gate；`opened: false`（被拒绝或失败）带诊断退回任务，而不是让 agent 永远等待一个没有人会打开的 gate。

被拒绝的 PR **不计入** [RN-047](#rn-047) 的熔断器：决定是用户作出的，而不是 agent 烧穿上限——与重启恢复的原则相同。

这条规则也顺带消除了 D5（待批准时 worktree 被回收）：worktree 只在 `gate_resolved` 时释放，gate 只在 PR 之后打开，PR 只在 commit 和 push 之后打开。

- **位置：** `apps/engine/lib/engine/dev/agent_io.ex`（`propose/3`），
  `apps/engine/lib/engine/dev/dev_agent_server.ex`（`abrir_gate/1`、
  `aguardar_aprovacao/2`），
  `apps/api/src/application/use-cases/actions/execute-git-action.use-case.ts`
  (`settlePrOpen`)
- **测试：** `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  （describe `pending approval doesn't open a gate`）
- **来源：** [ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md)

### RN-059 — 回合失败是带来源的持久事件，而且 agent 会说话 {#rn-059}

当 LLM 回合失败时，agent 在事件日志中写入 **`agent.error`**，带三个字段：`origem`（ADR 0020 的词汇）、葡萄牙语的 `mensagem` 以及原始的 `reason`。并且消息出现在**对话的消息流中**，而不只是在日志中。

过去正好相反，结果是最坏的：四个对话型 agent 写入内容为**空**的 `agent.response`——在不可变日志中与成功无法区分——并通过短暂的 `broadcast` 发送原因。那一秒没有打开标签页的人永远不会知道发生了错误；打开的人则看到一个空白气泡。

还有第二条路径，更糟：当 api 在它*自己*的最后一帧中叙述失败（预算、缺少凭据、缺少 binding）时，回合不会落入错误分支，**根本不发出任何事件**——绝对的沉默。

这个分支一旦被修正，又付出了第二轮代价：在 PO、Arquiteto 和 Dev Lead 中，它返回 `{state, ""}`——一个*元组*，而 `run_turn` 的其他所有分支都返回 `state`（一个 map）。`TurnoAssincrono.tratar_resultado/2` 中的 `Map.put/3` 在 `handle_info` 中抛出 `BadMapError`，由于四个对话型 agent 都是 `restart: :temporary`，agent 会*死掉*且不再回来。失败不再是无声的，却变成了崩溃——而触发条件是最常见的那些。规则完整适用：agent 叙述失败**并保持运行**。因此 `tratar_resultado/2` 在四者共享的位置有第二道屏障：不是 map 的回合结果会成为来源为 `codigo` 的 `agent.error`，绝不会成为一个死掉的进程。

来源*绝不*靠猜：`FalhaDeTurno.origem/1` 中的每个模式都有书面的理由，不匹配任何模式的以 **`codigo`** 输出——缺口属于我们的分类器，而这是指向正确行动的来源（ADR 0020）。

已经写入的事件不会被删除——界面把它们*点名*为这条规则之前的空响应，而不是显示空白。

- **位置：** `apps/engine/lib/engine/agents/falha_de_turno.ex`,
  `criativo_server.ex`, `po_server.ex`, `arquiteto_server.ex`,
  `dev_lead_server.ex`, `infra_lead_server.ex`（`emit_falha/2`），
  `turno_assincrono.ex`（`tratar_resultado/2`，第二道屏障），
  `apps/web/src/lib/session-falha.ts`
- **测试：** `apps/engine/test/engine/agents/criativo_server_test.exs`
  （带来源的持久事件；从不写入空响应；在最后一帧中叙述的错误也会成为事件）；`po_server_test.exs`（带错误的最后一帧不会让 agent 倒下——*真正*的 GenServer，使用 `Process.alive?/1`）；
  `arquiteto_server_test.exs` 和 `dev_lead_server_test.exs`（同一路径，完整周期）；`turno_assincrono_test.exs`（第二道屏障叙述而不是崩溃）；`apps/web/src/lib/session-falha.test.ts`
- **来源：** FASE 13b 的真实执行

### RN-061 — *工具*失败也是事件，并回到模型 {#rn-061}

工具调用的结果从不被丢弃。它在事件日志中成为 `tool.result`（`ok`，失败时还有 `erro`），agent 在消息流中**说出**发生了什么，原因以 `tool` 角色**回到模型**——让它在下一回合修正并重新发出。工具错误是循环的输入，而不是终点。

Criativo agent 是唯一丢弃它的
（`_ = EmitArtifact.run(args, state)`）——PO 和 Arquiteto 已经在回馈它。在一次真实执行中，模型针对要求 `title`/`description`/`origin` 的 schema 发出了 `titulo`/`descricao`：**对话中的四条业务规则全部被拒绝**，没有记录任何事件，而它继续说"我已登记规则"，面板却是空的。

工具描述现在*点名*每种类型的必填字段，用英文并附一个填好的示例——包括 `business_rule.origin` 是产生该规则的消息的 `seq` 的**非空列表**，而不是自由文本。没有这一点，模型就会猜，而且是用对话的语言猜。

这是把 [RN-059](#rn-059) 的同一规则应用到另一条失败路径上：同一个问题有两种策略，就是两次吞掉错误的机会。

- **位置：** `apps/engine/lib/engine/agents/criativo_server.ex`（`dispatch_tool`、
  `realimentar`），`apps/engine/lib/engine/harness/tools/emit_artifact.ex`
  （`descricao/0`），`apps/engine/lib/engine/harness/artifact_schemas.ex`
  (`required/1`)
- **测试：** `apps/engine/test/engine/agents/criativo_server_test.exs`
  (`a refused tool becomes a tool.result with an error, and the agent speaks`)
- **来源：** FASE 13b 的真实执行

### RN-062 — 发给对话型 agent 的消息会*重新水合*进程 {#rn-062}

发给 Criativo、PO 或 Arquiteto 的消息，如果进程没有在运行，会在投递之前启动它。每个服务器的 `init` 本来就会从事件日志重建历史；缺的是调用它的人。

以前，engine 重启会悄无声息地杀死对话：会话以 `active` 存活下来，agent 的进程却没有，下一条消息以 `GenServer.call ... exited` 死掉——没有事件，界面上没有错误，什么都没有。用户看到自己的消息出现，却永远没有回复到来。

`revise/2` 的注释说，这条路由上的 agent 死掉"是一个 bug"。确实是——而 engine 只要重启就会发生。这是 Fase 12b 给 dev agent 的同一保证，应用于对话型 agent。

- **位置：** `apps/engine/lib/engine_web/controllers/agent_command_controller.ex`
  （`message/2`）
- **测试：** 由 agent 测试套件覆盖；执行证明在
  docs/explanation/validacao-real.md
- **来源：** FASE 13b 的真实执行

### RN-063 — 不产出而结束是结果，不是失败 {#rn-063}

Anamnese 有一个工具用来说**"没有什么要发出，原因如下"**（`skip_proficiency`）。这一轮以 `anamnese.run_skipped` 结束，原因放在 payload 中——绝不以 `anamnese.run_failed` 结束。

之前它没有这个动词。唯一的工具是 `emit_proficiency`，它拒绝空列表（有道理：空档案不是档案）。在没有合格成员的窗口中，Anamnese 在*第一次*迭代就发现了这一点，用散文写下"没有合格成员"，以 `profiles: []` 调用 `emit_proficiency`，被拒绝——然后重复直到迭代上限。每一圈都会重新发送历史，而历史每圈都在增长。

在一次真实执行中，这花费了 **14.5 万输入 token，是 Criativo 和 PO 花费总和的 4 倍**，什么都没产出。而且它会在调度器的每次 tick 时回来，每 15 分钟一次，永远如此。

迭代上限是有效的——这不是无限循环。浪费是**每一轮的，无限重复**，这更糟：循环会卡住，有人会注意到；这个是慢慢流血。

为一个做了正确事情的轮次叙述 `run_failed` 也是缺陷：读日志的人会学会忽略失败事件。

- **位置：** `apps/engine/lib/engine/anamnese/tools/skip_proficiency.ex`,
  `apps/engine/lib/engine/anamnese/hooks/termination.ex`,
  `apps/engine/lib/engine/workers/anamnese_worker.ex`（`handle_outcome`）
- **测试：** `apps/engine/test/engine/workers/anamnese_worker_test.exs`
  (`encerrar sem perfis é DESFECHO: narra run_skipped com o motivo, não falha`)
- **来源：** FASE 13b 的真实执行

### RN-069 — 重试任务会重建分支，而不是失败 {#rn-069}

`WorktreeManager.add_worktree/3` 使用 `git worktree add -B`（创建**或**重置），而不是 `-b`。它原本就会移除前一个 worktree 的目录，却把分支留了下来——而由于分支名来自任务的 slug，对*同一*任务的第二次尝试总是落入 `fatal: a branch named
'feature/<slug>' already exists`。

效果是永久性的：解除任务阻塞没用，重新激活执行没用，熔断器跳闸后无路可走。在一次真实执行中，唯一的出路是在项目的 workspace 中手动执行 `git worktree prune`。

重置是正确的选择：前一个 worktree 已经被移除，那次尝试的工作毫无价值（任务已回到队列），分支从 `work_dir` 的当前位置重新诞生。

- **位置：** `apps/engine/lib/engine/dev/worktree_manager.ex`
- **测试：** `apps/engine/test/engine/dev/worktree_manager_test.exs`
  (`retrying the SAME task recreates the worktree instead of failing`)
- **来源：** FASE 13b 的真实执行

### RN-073 — 待定的审批*暂停*循环，而不是烧掉它 {#rn-073}

当流水线工具返回 `pending` 时，ToolLoop **停止**，dev agent 进入 `:awaiting_approval`，持有任务、worktree 和循环的历史。用户的决定发出 `task.action_settled`，唤醒它：真实结果占据原本会是 "pending" 一词的位置，循环从中断处继续。

测试锁定的两个性质：

- **等待期间什么都不记录。** 工具消息的位置保持为空。在那里写 "pending" 会告诉模型这就是命令的回答——而这正是缺陷所在。
- **拒绝也是一个回答。** 原因占据结果的位置，agent 得知那条路已经关闭，而不是永远等待没有人会批准的东西。这与 `opened: false` 的 `pr_settled`（[RN-047](#rn-047)）是同一原则，低一个层级。
- **wake 必须*到达*。** `task.action_settled` 诞生于 `task` 聚合，而不是表名所暗示的 `proposed_action`：engine 的 drain 读取一个封闭的聚合列表（`session` 和 `task`）。在这个列表之外发出时，事件被成功写入，`processed_at` 保持为空，甚至不会被读取——没有 job，没有错误，没有日志，agent 永远等待。契约跨越两种语言，这就是它在两侧都被锁定的原因。

如果 engine 在等待期间**重启**，这条规则对该任务不再适用：暂停的循环只存在于内存中，因此任务以来源 `infra` 被阻塞地回到队列，之后作出的决定无处可用。带诊断地阻塞是刻意的——另一种选择是永恒而无声的等待，而这正是这条规则要终结的。

这修复的是：`pending` 过去作为工具的*结果*返回，循环继续前进。模型把它读作命令的回答，什么也没学到，尝试别的东西——每次尝试都烧掉一次迭代，直到 `toolloop.limit_reached {iteration: 8, max_iterations: 8}`，任务因"达到迭代上限"而被阻塞，一行都没写。授予的批准在循环耗尽之后才到达，毫无用处。

终端允许列表（[RN-068](api.md#rn-068)）仍然有效，但不再是唯一的防线：它是预期命令的列表，而模型会发明命令。

- **位置：** `apps/engine/lib/engine/harness/hooks/action_pipeline.ex`,
  `harness/tool_loop.ex`, `dev/dev_agent_server.ex`,
  `workers/dev_agent_wake_worker.ex`；发出在
  `apps/api/src/application/use-cases/actions/{approve,deny}-action.use-case.ts`
- **测试：** `apps/engine/test/engine/dev/dev_agent_awaiting_approval_test.exs`
  （`pending action STOPS the agent`；`approved: resumes the loop with
  the REAL output`；`restart during the wait BLOCKS the task`）和
  `apps/engine/test/engine/dev/wake_do_outbox_ao_agente_test.exs`，它走完整条链——outbox、drain、队列和进程——因为逐环节的测试在投递损坏时全都是绿的；聚合在 api 一侧锁定于
  `apps/api/test/application/use-cases/actions/approve-deny-action.use-case.spec.ts`
- **来源：** [ADR 0052](../adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md)，
  分诊的阶段 A

### RN-074 — 终端输出有字节上限 {#rn-074}

命令的输出在成为工具结果之前被截断到 `TERMINAL_OUTPUT_MAX_BYTES`（默认 32 KiB），截断会留下一个**标记**，说明两个大小以及该怎么做：

```
[saída truncada: 32768 de 1048576 bytes. Refine o comando (head, grep,
-maxdepth) para ver o que falta.]
```

测试锁定的三个性质：

- **上限是 `>`，不是 `>=`。** 恰好等于限制的输出原样通过——标记它会让模型去细化一个已经给出全部内容的命令。
- **截断不会切开多字节字符。** `binary_part/3` 按字节截断；落在一个 `é` 中间会产生无效二进制，在结果到达模型之前就破坏 JSON 序列化。
- **`raw_bytes` 仍然是产生的*真实*大小**，而不是截断后的。这是测量，在这里撒谎恰恰会隐藏促成这个上限的行为。想检测截断的人比较 `byte_size(stdout)` 与 `raw_bytes`。

这修复的是：每个命令的输出都留在循环的历史中，并在之后的**每一个**回合中传输。没有上限时，一个在大目录树上的 `find` 就足够了——`hello-limpo` 的执行在第 18 回合以 `{413, "request entity too large"}` 死掉，一行都没写。溢出的是**请求的字节**，而不是上下文窗口：最大的成功调用有 28,993 个输入 token。

标记是写给**模型**的，而不是给人的——不说该怎么做，它往往会重复同一个命令。

- **位置：** `apps/engine/lib/engine/actions/terminal_executor.ex`
  （`truncate/2`），上限在 `apps/engine/config/runtime.exs`
- **测试：** `apps/engine/test/engine/actions/terminal_executor_test.exs`
  （describe `teto de bytes da saída`）
- **来源：**
  [achados-execucao-real.md](../explanation/achados-execucao-real.md) 的发现 S，
  [backlog](../explanation/backlog.md) 的 Fase F

### RN-076 — git 凭据从不写入文件 {#rn-076}

engine 在远程仓库上工作，方式是向 api 请求**工作远程**（`GET /internal/projects/:projectId/git-remote`），后者返回**干净的**来源，并单独返回 owner 的 token。token 通过**子进程的环境**进入 git 调用，别无他处：

- **不在 `origin` 中**——写入 `.git/config` 的是干净的 URL；
- **不在 argv 中**——`ps` 会显示任何进程的命令行；
- **不在文件中**——既没有持久化的 helper，也没有 `~/.git-credentials`。

凭据 helper 通过 `-c` 传入，只对那个进程有效，并且位于一个空的 `credential.helper=` 之后：helper 是累加的，第一个响应的胜出，因此不先清零的话，主机上的 helper 会抢先响应。

**为什么这是规则而不是偏好。** 把
`https://x-access-token:TOKEN@github.com/…` 写进 `origin`——几乎每个教程都这么教——会以明文把凭据写进**项目文件夹内部**，正是 [RN-075](api.md#rn-075) 给予 dev agent **自动批准**读取权限的地方。一个 `cat .git/config` 就会在不经任何审批的情况下返回 token，而它会在循环的历史中传到 LLM 提供方。路径范围防止 agent 读取项目*之外*的东西；它无法防止产品自己放在*内部*的秘密。

凭据是 **workspace owner** 的，通过 [RN-058](api.md#rn-058) 的同一个解析器——两条"凭据属于谁"的规则会分歧。`local` 提供方没有 token，也不询问 api：它直接从数据库解析，这是 `pnpm dev` 和整个测试套件所走的路径。

- **位置：** `apps/engine/lib/engine/actions/git_auth.ex`,
  `engine/projects/project_repository.ex`（`remoto_de_trabalho/1`），
  `apps/api/src/application/use-cases/git/get-project-git-remote.use-case.ts`
- **测试：** `apps/engine/test/engine/actions/git_auth_test.exs`（token 不出现在 argv 中，也不在 helper 中）和
  `apps/api/test/application/use-cases/git/get-project-git-remote.use-case.spec.ts`
  （返回的来源不包含 token，也不包含 `@`）
- **来源：** [ADR 0056](../adr/0056-o-engine-trabalha-em-repositorio-remoto.md)，
  发现 N，[backlog](../explanation/backlog.md) 的 Fase B

### RN-077 — 失败的来源总是四者之一 {#rn-077}

每个失败结果都以 [ADR 0020](../adr/0020-destravar-gates-qa-secops.md) 的**封闭**词汇点名*来源*——
`infra | modelo | codigo | politica`。没有第五个值：`null` 和
`"indeterminada"` 已不再可能。

两项结构性保证，没有一项依赖某人记得：

- **`AgentIo.block_task/4` 没有来源的默认值。** 它原来"在精神上是必需的"，默认值是 `"indeterminada"`——而真实执行中代价最高的结果正是这样产生的，因为调用点什么都没传。没有默认值，忘记就成了编译错误。
- **`FalhaDeTurno.origem/1` 总是返回四者之一**，并有一个表格测试，只要任何条目——包括从未见过的形式——产生别的东西就会失败。

**为什么去掉 `indeterminada`。** 它的存在有一个合理的论点：不瞎猜比在黑暗中选择更诚实。实际效果恰恰相反——`indeterminada` **不指向任何行动**，分诊下一轮的人要从零开始调查。它实际的意思是*分类器没有识别出这种形式*，这是我们代码的缺口：`codigo` 才是指向正确行动的来源（补上缺失的子句）。诊断仍然原样传递，因此什么都没丢。

**来源不是瞎猜。** ToolLoop 的每个结果都说明是谁决定停下的：`report_blocked` 和迭代上限属于**模型**（它作出了决定，或用完了它所拥有的）；预算和未批准的 PR 属于**策略**（是一个决定，没有东西坏掉）；重启和装配上下文失败属于**基础设施**；当存在 `last_error` 时，来源出自诊断所叙述的*同一个*错误——原先自相矛盾的正是这一对，`diagnosis` 说 `{413, …}`，同一行中 `origem` 却说 "indeterminada"。

- **位置：** `apps/engine/lib/engine/agents/falha_de_turno.ex`,
  `engine/dev/agent_io.ex`（`block_task/4`，没有默认值），
  `engine/dev/dev_agent_server.ex`（`origem_da_parada/1`）
- **测试：** `apps/engine/test/engine/agents/falha_de_turno_test.exs`
  （`o vocabulário é fechado`）和
  `apps/engine/test/engine/dev/dev_agent_server_test.exs`，它断言发出事件中的来源
- **来源：**
  [achados-execucao-real.md](../explanation/achados-execucao-real.md) 的发现 P、Q 和 T，[backlog](../explanation/backlog.md) 的 Fase G

### RN-079 — Psicólogo 不分析没有可分析事件的会话 {#rn-079}

在花费一个模型回合之前，分析会先问有没有可分析的东西。没有的话，它**不运行**，结果成为 `psychologist.analysis_skipped`。

**"可分析"排除两样东西，原因不同：**

- **分析者自身的痕迹。** Psicólogo 把它的回合写进它所分析的会话日志（`agent.response`、`tool.call`、`tool.result`、假设）。把这些计算在内，会让一个空会话**从第一次分析起**就显得充实，每次重试都会让它更满——标准将再也不会失败。Anamnese 同理；
- **`bootstrap.*`**，即独自运行的仓库部署：九个机器步骤对这个人什么也说明不了。

其他一切都算，包括 `proposed_action.*`——用户不写任何消息地批准和拒绝**就是**行为，这是 Anamnese 已经学到的教训（[RN-063](#rn-063)）。

**这是两个计数，它们不能互相替代。** 原始计数衡量工作量（要读多少日志，进而用哪个分诊层级，轻还是重）；可分析计数决定是否有工作。混淆它们就是缺陷：一个只有 bootstrap 的会话被当作"20 个事件"，实际上一个都没有，于是获得了分析，而模型——没有任何东西可以引用——会编造不存在的 `seq`，直到证据校验拒绝它、它放弃为止，而预算已经花掉了。

**跳过同样适用于手动重新处理。** 重新处理不会制造材料：点击的人会在日志中收到原因，而不是关于一份不存在的日志的编造假设。

跳过会成为**事件**，这与 Anamnese 的跳过不同，后者只是日志——那个每 15 分钟运行一次，会变成噪音；这个每次会话关闭运行一次，而一个没有任何叙述的缺席分析是无法诊断的。

- **位置：** `apps/engine/lib/engine/session_events/event.ex`（`count_analisaveis/1`），
  `apps/engine/lib/engine/psychologist/triage.ex`（`should_run?/1`），
  `apps/engine/lib/engine/workers/psychologist_worker.ex`
- **测试：** `apps/engine/test/engine/session_events/event_analisaveis_test.exs`
  （包括对发现中那个会话的复现：14 个事件，没有一个可分析），
  `apps/engine/test/engine/workers/psychologist_worker_test.exs`
- **来源：** 发现 J，[backlog](../explanation/backlog.md) 的 Fase E

### RN-080 — 重复的业务规则在入口被拒绝 {#rn-080}

标题已经存在于**项目中**的 `business_rule` 不会被写入。拒绝通过与无效 payload 相同的路径回到模型，它会继续处理下一条规则，而不是停下。

**在入口，因为没有别的地方。** 没有规则表：工件*就是* `artifact.business_rule` 事件，而领域事件既不能删除也不能编辑。放它进来就意味着永远与重复共存。

**范围是项目，而不是会话**——重复是在会话之间产生的。再次运行 Criativo 会打开新会话，按会话的检查看不到上一轮，而这正是发现中的情形。

比较会规范化大小写、重音和多余空格；标点保留。**语义重复仍会通过，这是声明的，而不是遗忘：**
"Saudação com nome" 和 "Quem chama pode se identificar" 仍是两条规则，因为区分它们需要判断，放不进一个 `if`。
自 [RN-681](api.md#rn-681) 起，*标题*的语义重复会在写入后通过 embedding **发出警告**——仍然通过，在这里从不被拒绝。

- **位置：** `apps/engine/lib/engine/harness/artifact_dedupe.ex`,
  `apps/engine/lib/engine/harness/tools/emit_artifact.ex`,
  `apps/engine/lib/engine/session_events/event.ex`（`titulos_de_regras/1`）
- **测试：** `apps/engine/test/engine/harness/artifact_dedupe_test.exs`,
  `apps/engine/test/engine/harness/emit_artifact_dedupe_test.exs`
- **来源：** 发现 K，[backlog](../explanation/backlog.md) 的 Fase E

### RN-085 — 迭代上限按 agent *类型*设置 {#rn-085}

一个 agent 在工具循环中可以转多少圈，取决于它所做的工作：对话者为 **8**，dev agent 和 QA 子 agent 为 **60**。不再有单一的数字。

**8 的上限诞生于对话型 agent，被做工作的 agent 继承了。** 在 13b 的真实验证中，这表现为阻塞：dev agent 把八圈都花在探索一个新部署的仓库上，**从未写过一个文件**；改为 25 后，它写了三个并运行了测试。记录的结果是 `limite de iterações atingido`，来源 `modelo`——技术上正确，实际上毫无用处，因为模型从未来得及判断任何东西。

**提高全局默认值是错误的修正**，而这正是规则所保护的：Criativo 对话不需要 60 圈，上限也是防止无限循环的锁。

**能提高的不是"工作多的"，而是下面有花费锁的。** 迭代上限防止无限循环；保护*钱包*的是 `token_budget_micros`。dev agent 和 QA 子 agent 带着任务的 `task_budget_micros` 运行，因此放宽圈数不会放宽账单。`infra-workflows` 使用重型工具，却仍然**保持 8**：它在没有预算的情况下运行，对它来说上限是唯一存在的锁。

两个有专门测试的边界情况：

- **`dev-lead` 是对话型的**，尽管有识别 dev agent 的 `dev-` 前缀（`dev-<modulo>`、`dev-<modulo>-2`）。lead 负责决定和委派，没有显式子句的话，它会因命名的偶然而以重型工作的上限诞生。
- **未知 agent 落到最低上限。** 向便宜的一侧犯错：需要更多圈数的会以 `limite de iterações atingido` 出现并被修正；错误地获得 60 的会悄无声息地花钱。

- **位置：** `apps/engine/lib/engine/harness/iteracoes.ex`，应用于
  `apps/engine/lib/engine/harness/tool_loop.ex`（`init/1`）
- **测试：** `apps/engine/test/engine/harness/iteracoes_test.exs` 和
  `apps/engine/test/engine/harness/tool_loop_test.exs`
  （`o teto vem do TIPO do agente quando o chamador não passa um`、
  `teto explícito do chamador VENCE o do tipo`）
- **来源：** 发现 X，[13b 的真实验证](../explanation/validacao-real.md)；
  [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md)，FASE 14d

### RN-115 — Anamnese 可以被全局暂停；暂停属于*产品*，从不删除数据 {#rn-115}

`ANAMNESE_ENABLED`（engine 的环境变量，布尔，自这条规则起默认 `false`）决定 Anamnese 的*新*一轮是否可以发生——周期性的（`AnamneseSchedulerWorker`）或按需的（`AnamneseCommandController`）。这是用户在 2026-08-10 作出的*产品*决定（"hoje ele não está trazendo
dados de muito valor"），不是 bug——见 docs/explanation/backlog.md。停用时，*没有*任何现有数据被触碰：已经写入的假设、熟练度档案和指令补丁保持完好且可见，*按成员*的退出（RN-025）仍然是一个独立的概念——暂停属于*系统*，而不是个人画像。

`AnamneseSchedulerWorker.kickoff/0`（在启动时调用一次）在停用时*不*安排周期性 job，而不是安排后让 `perform/1` 在每个 tick 空转——更便宜（Oban 队列不会每隔 `ANAMNESE_INTERVAL_SECONDS` 收到一个只为什么都不做的 job），对检查队列的人也更清楚。**2026-08-10 的更正**（执行中的真实发现，而非假设）：这条规则的原始版本刻意让 `perform/1` 无条件执行，使轮次之间的链条不携带开启/关闭的决定——但这意味着在 flag 存在*之前*（或在有人停用它之前）已经安排好的链条会永远自我重新安排，在 flag 为 `false` 的情况下真正运行 Anamnese。这正是在一个比原始 PR 更老的开发 Postgres 中发生的事，通过手动取消已安排的 job 得到补救。`perform/1` 现在在每个 tick 都检查 `enabled?/0`，与 `kickoff/0` 一样：停用时，既不执行 `enqueue_projects/0` 也不重新安排，链条就此终止——这也能*自愈*仍会触发一次的旧 job 的情形，无需人工干预。

`AnamneseCommandController.run/2`（按需路由，设置中的"立即重新分析"）在停用时响应 **503**，正文为 `{"error": "anamnese_desativada"}`——刻意区别于已有的表示"项目没有会话"的空 409（两者在纯 409 中很容易混淆，而它们是截然不同的原因）。api 一侧的 `RunAnamneseUseCase` 把 engine 的 503 转换为正文中带 `reason: "anamnese_disabled"` 的 `ServiceUnavailableException`——绝不是通用的 500，也不是复用的 409。web（`ProjectSettingsTab.tsx`）在第一次点击"立即运行"时发现这个状态（目前没有对全局状态的预先读取），从那以后禁用按钮并在界面上保持解释*可见*——而不只是一个会消失的 toast（RN-088：绝不是无声或令人困惑的失败）。

- **位置：** `apps/engine/lib/engine/workers/anamnese_scheduler_worker.ex`
  （`enabled?/0`、`kickoff/0`），
  `apps/engine/lib/engine_web/controllers/anamnese_command_controller.ex`,
  `apps/engine/config/runtime.exs`,
  `apps/api/src/domain/anamnese/anamnese-disabled.error.ts`,
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  （`runAnamnese`），`apps/api/src/application/use-cases/anamnese/run-anamnese.use-case.ts`,
  `apps/web/src/routes/settings/ProficiencySection.tsx`
- **测试：**
  `apps/engine/test/engine/workers/anamnese_scheduler_worker_test.exs`
  （停用时 `kickoff/0` 不安排，启用时安排，默认关闭；在链条中途停用时 `perform/1` 不扇出也不重新安排），
  `apps/engine/test/engine_web/controllers/anamnese_command_controller_test.exs`
  （503 区别于 409，有会话和没有会话），
  `apps/api/test/application/use-cases/anamnese/run-anamnese.use-case.spec.ts`,
  `apps/web/src/routes/ProjectSettingsTab.test.tsx`（`ProficiencySection`）
- **边界情况：** flag 是*全局*的（所有项目/workspace），而不是按项目——与并行上限（RN-083）或按区域可继承的模型（RN-102）这些按范围的决定不同。重新开启是
  `ANAMNESE_ENABLED=true` 并重启 engine；UI 中没有这个按钮（这是运维操作，而不是项目偏好）。
- **来源：** 没有 ADR——可逆的产品决定，不是结构性的架构变更。见 docs/explanation/backlog.md。

### RN-116 — *创建* handoff 失败不会让 agent 倒下 {#rn-116}

`confirm_readiness`（Criativo → PO）和 `offer_infra_handoff`（Arquiteto → Infra；
`offer_dev_handoff`，即 Arquiteto → Dev Lead，已在
[RN-672](api.md#rn-672) 中移除，而 Infra 提供的给 Dev Lead 的 handoff 遵循同一把尺子）在回合已经运行*之后*调用 api 创建 handoff——在 Criativo 的情形中，是在 `product_brief` 已经写入事件日志之后。如果这次调用失败（api 宕机、5xx 等），handoff 不存在，但这*绝不*会让 agent 的 GenServer 倒下：失败成为持久的 `agent.error`，带 `origem`（`FalhaDeTurno.origem/1`），以及一条说明*已经*保存了什么（product_brief、规则）、什么没有保存（handoff）的消息——让用户知道再次确认是安全的，不会重复工作。

过去正好相反：三个调用都使用 `{:ok, _handoff} = EngineApiClient.create_handoff(...)`
——一个严格匹配。`{:error, _}` 变成 `MatchError`，而由于三个 agent 都以 `restart: :temporary` 在 `:one_for_one` 的 `DynamicSupervisor` 中启动，进程就这么*消失*了——没有 `agent.error`，消息流中没有回复，只有沉默。从观察者的角度看：信息（规则、product brief）似乎已经"通过"（已写入），但下一个 agent 那边什么都没开始，因为 handoff 从未存在过。重新打开对话本身不能解决问题——只有*新*消息会重新激活进程（从事件日志重新水合），只有新的就绪确认会再次尝试 handoff。

消息*不*复用 `FalhaDeTurno.mensagem/1`（`RN-059` 的那句"não consegui
completar este turno... nada foi gasto"）：在三个调用点上，工作都已经运行过（或者在 `offer_dev_handoff` 的情形中根本不需要运行）——当整合回合中已经花费了 token 时，说"什么都没花"是假的。只复用 `FalhaDeTurno.origem/1`，它按原因的*形式*（HTTP 状态、传输异常）分类，而不是按是否是 LLM 回合。

`Engine.Harness.Tools.OfferHandoff`（PO 通过 ToolLoop 中的工具调用使用的工具）本来就会在不崩溃的情况下处理 `{:error, reason}`——缺陷只存在于这三个服务器驱动的 handler 中，它们*直接*调用 `EngineApiClient.create_handoff/5`，而不是经过工具。

- **位置：** `apps/engine/lib/engine/agents/criativo_server.ex`
  （`handle_call(:confirm_readiness, ...)`、`emit_falha_handoff/3`），
  `apps/engine/lib/engine/agents/arquiteto_server.ex`
  （`handle_call(:offer_infra_handoff, ...)`、`emit_falha_handoff/3`）；
  `apps/engine/lib/engine/infra/infra_lead_server.ex`
  （`emit_falha_do_handoff_ao_dev_lead/2`，RN-672）
- **测试：** `apps/engine/test/engine/agents/criativo_server_test.exs`
  （"prontidão: falha ao criar o handoff NÃO derruba o processo, e vira
  agent.error durável"）；`apps/engine/test/engine/agents/arquiteto_server_test.exs`
  （`offer_infra_handoff`，成功和失败）；
  `apps/engine/test/engine/infra/infra_lead_server_test.exs`（Infra 提供的给 Dev Lead 的 handoff，被 500 拒绝）
- **来源：** `exp-001` 项目（Criativo → PO）中的真实使用报告；同样的结构性失败通过阅读代码在 Arquiteto 的两个 handoff 中被发现，没有为它们单独复现

### RN-117 — Psicólogo 可以被全局暂停；暂停属于*产品*，从不删除数据 {#rn-117}

`PSYCHOLOGIST_ENABLED`（engine 的环境变量，布尔，默认 `false`）决定 Psicólogo 的*新*一轮是否可以发生——自动的（会话关闭，由 `Engine.Outbox.Drain` 路由）或按需的
（`PsychologistCommandController.reanalyze/2`）。这与用户在 2026-08-10 已经应用于 Anamnese 的*产品*决定相同（RN-115，"hoje ele não está
trazendo dados de muito valor"）——不是 bug，见 docs/explanation/backlog.md。停用时，*没有*任何现有数据被触碰：已经发出的分析和假设保持完好且可见。

与 Anamnese 不同（其自动触发器是由 flag 自己决定是否重新安排的周期性 *TICK*），Psicólogo 的自动触发器是会话关闭——`Engine.Outbox.Drain` 只在 `PsychologistWorker.enabled?/0` 为 true 时（`Drain.handlers_for/1`）才把
`session.closed`/`session.closed_abnormally` 路由给 `PsychologistWorker`；停用时只运行 `SessionLifecycleWorker`，Psicólogo 的 job 根本不会诞生。`PsychologistWorker.perform/1` 刻意保持无条件——但它*不再*是与 `AnamneseSchedulerWorker` "相同的模式"（见上面 RN-115 中 2026-08-10 的更正）：在那里 `perform/1` 开始检查 flag，是因为它*自己*在每个 tick 重新安排链条，而一个无条件触发的旧 job 会在 flag 关闭时重新打开 Anamnese。Psicólogo 没有任何会自我重新安排的链条——每个 job 都诞生于*一个*事件（`session.closed`），作决定的是 `Drain` 在*接收*事件的时刻，而不是 worker 在*运行*的时刻；在关闭 flag 之前已经入队的 Psicólogo job 至多是最后一轮待处理的，绝不是无限的链条。这就是为什么 `PsychologistWorker` 已有的测试套件（直接调用 `perform/1`）不需要改动。

`PsychologistCommandController.reanalyze/2`（按需路由，洞察标签页中的"重新分析"）在停用时响应 **503**，正文为
`{"error": "psicologo_desativado"}`，甚至不创建 job。api 一侧的 `ReanalyzeSessionUseCase` 把 engine 的 503 转换为正文中带 `reason: "psychologist_disabled"` 的 `ServiceUnavailableException`——绝不是通用的 500。这在已经存在可重新处理的分析时发现暂停；*没有任何*假设的界面有自己的预先读取，这里原来没有——见 [RN-454](#rn-454)。

- **位置：** `apps/engine/lib/engine/workers/psychologist_worker.ex`
  （`enabled?/0`），`apps/engine/lib/engine/outbox/drain.ex`
  （`handlers_for/1`），
  `apps/engine/lib/engine_web/controllers/psychologist_command_controller.ex`,
  `apps/engine/config/runtime.exs`,
  `apps/api/src/domain/psychologist/psychologist-disabled.error.ts`,
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  （`reanalyzeSession`），
  `apps/api/src/application/use-cases/execution/reanalyze-session.use-case.ts`,
  `apps/web/src/routes/ProjectInsightsTab.tsx`
- **测试：**
  `apps/engine/test/engine/outbox/drain_test.exs`（`session.closed` 只在启用时把 Psicólogo 入队），
  `apps/engine/test/engine_web/controllers/psychologist_command_controller_test.exs`
  （503 且不创建 job，启用时 202 并有入队的 job），
  `apps/api/test/application/use-cases/execution/reanalyze-session.use-case.spec.ts`,
  `apps/web/src/routes/ProjectInsightsTab.test.tsx`
- **边界情况：** flag 是*全局*的（所有项目/workspace），与 Anamnese 的一样。重新开启是 `PSYCHOLOGIST_ENABLED=true` 并重启 engine；UI 中没有这个按钮。
- **来源：** 没有 ADR——可逆的产品决定，不是结构性的架构变更。见 docs/explanation/backlog.md。

## 会话

### RN-122 — “停止”按钮真正取消轮次，杀死持有 LLM 调用的任务 {#rn-122}

在此之前，任何地方都没有取消。根源是结构性的：
`agent_command_controller.ex` 用
`GenServer.call(pid, {:user_message, texto}, ...)`——**同步**——处理用户的消息，整个轮次（工具循环 + 对 LLM 的 SSE 调用）都在 `handle_call` **内部**运行。智能体的进程一直阻塞到轮次结束，期间不处理任何其他消息——连未来的取消命令也不处理。

修复：四个对话型智能体（Criativo、PO、Arquiteto、Dev Lead）的轮次 `handle_call`/`handle_cast` 派生一个
`Task.Supervisor.async_nolink/2`（`Engine.Agents.TurnoAssincrono`，新增，四者共享）来承担繁重工作，并返回 `{:noreply, state}`——对原始 `GenServer.call` 的回复被**推迟**到任务完成（`GenServer.reply/2`，在 `{ref, resultado}` 到达
`handle_info` 时触发）。由于智能体进程**不再**阻塞，新的
`handle_cast(:cancel, state)` 会在轮次运行时到达并被处理：
`:brutal_kill` 模式的 `Task.shutdown/2` 杀死任务，从而断开它与 api 之间持有的 HTTP（SSE）连接——正是这一点让取消真正节省 token，而不只是在客户端停止渲染。原始的
`from` 收到 `{:error, :cancelado}`，并记录一个**终止性**的 `agent.error`，来源为 `"politica"`（策略——与预算/凭据/绑定相同的来源——取消是用户停止花费 token 的决定，而不是 ADR 0020 封闭词汇中的第五个值）——没有它，
`GetSessionPendingWorkUseCase` 会看到 `agent.activated` 之后没有
`agent.response`/`agent.error`，会话就会一直挂在待处理工作信号上。

发给同一智能体的两条相互竞争的消息（用户在轮次已在运行时再次发送）永远不会派生第二个任务：
`TurnoAssincrono.iniciar/3` 立即回复 `{:error, :turno_em_andamento}`（轮次进行中）。

> **由 [RN-578](#rn-578)（ADR 0163）修订：** 对原始
> `GenServer.call` 的回复不再推迟到任务完成——它在**接受**时、任务一启动就发出，而取消不再回复任何人（调用方已经拿到 `:ok`）。`{:error, :turno_em_andamento}` 不再被控制器丢弃：它是一个具名的 409 和一个持久的 `agent.error`。

- **位置：** `apps/engine/lib/engine/agents/turno_assincrono.ex`（机制）、`apps/engine/lib/engine/agents/{criativo,po,arquiteto,dev_lead}_server.ex`
  （四个轮次 `handle_call`/`handle_cast`）、`apps/engine/lib/engine_web/controllers/agent_command_controller.ex:361`
  （`cancel/2`）、`apps/engine/lib/engine_web/router.ex`（`POST
  /internal/sessions/:sessionId/agent/cancel`）、
  `apps/api/src/application/use-cases/agents/cancel-agent-turn.use-case.ts`、
  `apps/api/src/interfaces/http/agents/agents.controller.ts`（`POST
  /projects/:projectId/sessions/:sessionId/agents/:agent/cancel`）、
  `apps/web/src/routes/SessionPage.tsx`（`handleCancel`，输入框中的“停止”按钮）
- **测试：** `apps/engine/test/engine/agents/turno_assincrono_test.exs`（任务**真正**死亡——前后都检查 `Process.alive?/1`——而不只是“不再导入结果”）、`apps/api/test/application/use-cases/agents/cancel-agent-turn.use-case.spec.ts`
- **边界情况：** 没有进行中轮次时取消是幂等的**空操作**——没有任务可杀，也没有待回复的 `from`。取消**不会**撤销在任务死亡**之前**已经运行的副作用（例如，一个已经分派并记录了其事件的工具）——它只中断尚未发生的事。
- **来源：** 本次会话的调查；没有专门的 ADR（是 harness **内部**并发模式的变化，而不是层/数据库边界的变化）。

### RN-129 — ToolLoop 从不写入空的 `agent.response`；传输失败成为持久的 `agent.error` {#rn-129}

[RN-059](#rn-059) 为四个对话型 agent 堵住了空气泡，但它们不经过 `Engine.Harness.ToolLoop`——每个都在自己的模块中调用 `EngineApiClient.llm_turn_stream/6`。`ToolLoop`（由 dev agent、QA Automação/Performance-Segurança、Infra-Workflows、Anamnese 和 Psicólogo 使用）在另一条路径上有*同样*的缺陷：它在每次迭代时发出 `agent.response`，即使模型只调用了工具而没有文本，或者结束回合而什么都没产生——而传输失败（提供方宕机、超时）会变成缺少 `content` 的 `agent.response`，同样与成功无法区分。

在一次真实执行会话（dev agent）中实时发现：两个带有 RN-059 兼容文本（"resposta vazia — evento anterior..."）的气泡出现在几分钟前创建的会话中——它们不是旧事件，而是同一缺陷再次发生，只是在执行标签页中。

两项修正，位于每个 `ToolLoop` 消费者共有的*结构性*位置，而不是逐个模块：

1. **空内容绝不会变成 `agent.response`。** 只调用了工具的迭代已经由 `tool.call`/`tool.result` 叙述；什么都没产生的迭代（既没有文本也没有工具调用）把结果留给调用循环的人决定——`ctx.last_error`/`{:ok, ctx}` 携带信息，消费者（例如 `DevAgentServer.handle_outcome/4`）已经写入*自己*领域的持久事件（`dev.blocked`，带 `origem`）。
2. **传输失败成为持久的 `agent.error`**，带 `origem`（`Engine.Agents.FalhaDeTurno.origem/1`——四个对话型 agent 使用的*同一个*辅助函数，不重复分类）和葡萄牙语的 `mensagem`——再也不会有缺少 `content` 的 `agent.response`。

- **位置：** `apps/engine/lib/engine/harness/tool_loop.ex`（`loop/1`、
  `emit_falha/2`）
- **测试：** `apps/engine/test/engine/harness/tool_loop_test.exs`
  （"iteração só com tool call (sem texto) não grava agent.response vazio"、
  "modelo termina o turno sem texto e sem tool call..."、"falha de
  transporte... grava agent.error durável com origem"）
- **来源：** RN-059（本规则扩展的规则）——在有 dev agent 的真实执行会话中实时发现

## PR Gates

### RN-140 — 中途死掉的 gate 循环会自行恢复，无需人工干预 {#rn-140}

`QaLeadServer`/`SecOpsAgentServer` 是 `restart: :temporary`，而 gate 的中间转换（`DevAgentServer.correct/3`、
`Dispatcher.run_secops/2`）是直接的内存调用——在
`record_gate_verdict` 已经在 api 上持久推进了 `gate_status` **之后**进行。两者之间的崩溃过去会把 PR 永远困在
`awaiting_qa`/`awaiting_secops`：没有任何东西知道那一步被搁置了，engine 重启也修复不了——[ADR 0057](../adr/0057-o-gate-espera-a-aprovacao.md)
本身就已声明在 `{:awaiting, ...}` 中挂起是已知限制，而再次调查发现，已记录的判定与分派调用之间的窗口在实践中更容易撞上。

`gate_states`（schema `engine`，键 `{project_id, task_id, gate}`）在转换原本就发生的**相同**位置记录进行中的循环——在任何子智能体/扫描器运行前记 `"in_progress"`，在 `record_gate_verdict` 返回
`correct`/`run_secops` 之后、进程内调用之前记 `"dispatch_pending"`。
`Engine.Gates.GateRescuer` 扫描卡住超过 15 分钟的行
（可配置，`GATE_RESCUE_STALE_AFTER_SECONDS`）——故意宽松，因为 QA 子智能体的 ToolLoop 合法地最多运行
`TOOL_LOOP_MAX_ITERATIONS_GATE`（60）次迭代，而短阈值会救援（并重复）一个只是慢的循环——然后恢复：
`"in_progress"` 重启整个领域（不对 `ctx` 做外科式恢复，它在重启后无法存活，与 dev agent 的选择相同）；`"dispatch_pending"` 恰好重发丢失的那次调用。在启动时以及由每 5 分钟自我重新调度的 Oban tick 调用
（`GATE_RESCUE_INTERVAL_SECONDS`），
即 `Engine.Workers.GateRescueSchedulerWorker`——与
`ModelSyncSchedulerWorker`/`AnamneseSchedulerWorker` 相同的惯用法。

两个防止重复工作的守卫：**同一**节点上存活的进程
（`Registry.lookup`）永远不会被打扰，而陈旧阈值覆盖本地守卫够不到的情况（远程副本——`Registry`
是节点本地的，与 `Engine.Dev.Wake` 自
[ADR 0045](../adr/0045-reagendamento-por-evento-do-dev-agent.md) 以来的注意事项相同）。残余竞争的最坏结果是重复的、廉价的工作——api 会拒绝针对不再拥有
`gate_status` 的 gate 的第二次 `record_gate_verdict`（`nextGateStatus`），而 `DevAgentServer.correct/3` 自 ADR 0052 起已通过状态守卫实现幂等——永远不会是不一致的数据。

- **位置：** `apps/engine/lib/engine/gates/gate_state.ex`、
  `gate_rescuer.ex`、`qa_lead_server.ex` 中的写入点
  （`run_area/3`、`apply_gate_result/6`）和 `secops_agent_server.ex`
  （`run_secops/3`、`apply_verdict/6`），以及
  `apps/engine/lib/engine/workers/gate_rescue_scheduler_worker.ex`
- **测试：** `apps/engine/test/engine/gates/gate_rescuer_test.exs`——在循环进行中杀死一个真实的 `QaLeadServer`
  （`DynamicSupervisor.terminate_child/2`，持久行在进程死后存活），并证明 `GateRescuer.run/0` 自行重新接上该领域直到得到真实结果；陈述中的场景（丢失的
  `run_secops`）和丢失的 `correct` 返回，两者都使用**真实**进程和分派，没有 `FakeGateDispatcher`；以及两个守卫（存活的本地进程不被打扰；最近的行不被触碰）
- **来源：** [ADR 0067](../adr/0067-o-gate-sobrevive-ao-restart.md)，它扩展了 [ADR 0057](../adr/0057-o-gate-espera-a-aprovacao.md)

---

### RN-141 — `read_file` 读取的内容同样有字节上限 {#rn-141}

[RN-074](#rn-074) 让*终端*的输出免于
`{413, "request entity too large"}`，却通过 `read_file` 留下了同一扇门：它读取*整个*文件，没有上限，这些内容进入循环的历史并在之后的每个回合中传输。一个带有大文件（lockfile、bundle、生成的文件）的 PR 就足以卡住 dev agent *和* Performance/Segurança 的 QA——后者只有 `ReadFile`/`SearchWorkspace`（刻意没有 `Terminal`）来调查 PR，因此当文件太大时它没有任何出路。

内容在成为工具结果之前被截断到 `READ_FILE_MAX_BYTES`（默认 32 KiB，与 RN-074 的值相同是出于上下文的巧合，而不是耦合——两个变量是独立的），并带有说明文件和两个大小的标记：

```
[arquivo package-lock.json truncado: mostrando 32768 de 1048576 bytes. Use
search_workspace para localizar um trecho específico em vez de reler o
arquivo inteiro.]
```

与 RN-074 相同的三个性质（上限是 `>` 而不是 `>=`；截断不切开多字节字符；标记是写给模型的，说明该怎么做）。截断位于*工具*中（`Engine.Harness.Tools.ReadFile`），而不在
`Engine.Harness.WorkspaceFiles.read_file/2` 中——后者是通用的文件访问基础，由 `write_file`/`search_workspace` 共享，在那里截断会切掉不需要这个上限的调用者的内容。

`search_workspace` 没有得到同样的处理：它只返回匹配的*路径*（`matched_content` 是布尔值），从不返回文件内容——促成这条 RN 的溢出向量不适用于它。

- **位置：** `apps/engine/lib/engine/harness/tools/read_file.ex`
  （`truncate/2`），上限在 `apps/engine/config/runtime.exs`
  （`read_file_max_bytes`）
- **测试：** `apps/engine/test/engine/harness/tools/read_file_test.exs`
  （describe `teto de bytes do conteúdo`）
- **来源：** 在一次真实执行的事件日志中实时发现——一个项目的 4 个 dev agent 和 Automação/Performance-Segurança 的 QA 都被 `{413, "request entity too large"}` 阻塞，与 RN-074 同一根因，不同的门

## 会话

### RN-142 — 在完全没有业务规则时确认就绪会被 engine 拒绝，而不只是在 UI 中隐藏 {#rn-142}

以前，点击“我准备好产出了”——或直接调用该路由——**总是**会创建 `product_brief` 并向 PO 提供 handoff，即使在一个捕获了零条业务规则的对话中也是如此。
`business_rule_refs(state)` 在 `criativo_server.ex` 中早已存在，但只用于**填充** brief 的 `"rules"` 字段——从未作为阻断条件。在 UI 中，`SessionPage.tsx` 只在
`streaming` 期间禁用按钮，不检查规则数量。

真正的保证必须存在于服务端，而不是屏幕上：直接调用路由的人（或未来某个不是这个前端的客户端）不能仅仅因为按钮被画成禁用状态就击穿护栏。`CriativoServer.handle_call(:confirm_readiness, ...)` 现在在派生
`Engine.Agents.TurnoAssincrono` 的 `Task`（[RN-122](#rn-122)）**之前**检查
`business_rule_refs(state)`——为空就当场拒绝，不运行整合轮次，没有
`product_brief`，没有 handoff。

拒绝不会变成 HTTP 4xx：
`agent_command_controller.ex#readiness/2` **忽略**这个 `GenServer.call` 的返回值，总是回答 202，这与 `message/2` 自 RN-122 起已使用的模式相同（“此响应只是确认”——真正的结果存在于事件日志中）。因此拒绝被叙述为一个**持久的** `agent.error`（RN-059），来源为 `"politica"`（策略——这是产品决定，不是 infra/模型/轮次失败）——并附带解释原因的消息；会话线程已经知道如何渲染这种事件类型（`lerFalhaDeTurno`，与任何其他轮次失败相同的红色气泡）。

补充性的 UX，在 `SessionPage.tsx` 中：当 `events` 中没有
`artifact.business_rule` 时，按钮生来就是 `disabled`（带有解释原因的 `title`）——与已经为“业务规则”面板（`ContextAside`）供数的是**同一个**来源，没有可能与第一次读取产生分歧的第二次读取。

- **位置：** `apps/engine/lib/engine/agents/criativo_server.ex`
  （`handle_call(:confirm_readiness, ...)`、`emit_falha_sem_regra/1`）、
  `apps/web/src/routes/SessionPage.tsx`（`hasBusinessRule`，“我准备好产出了”按钮）
- **测试：**
  `apps/engine/test/engine/agents/criativo_server_test.exs`（"readiness:
  refuses when NO business rule was captured"——没有轮次、没有 brief、没有 handoff；拒绝以来源 `"politica"` 叙述）、
  `apps/web/src/routes/SessionPage.readiness-exige-regra.test.tsx`（没有规则时按钮禁用，有 1 条以上时启用）
- **边界情况：** 会话在通知 engine **之前**就已经由 api 记录了 `readiness.confirmed`（`ConfirmReadinessUseCase`）——这一点不变：它是用户**点击**的记录，是一个独立于 engine 之后接受或拒绝而发生的事实。
- **来源：** 确认用户报告的代码调查——没有 ADR（在已有流程上的新护栏，没有层/数据库边界的变化）。

---

### RN-150 — `search_workspace` 有命中*数量*上限和*字节*上限，各自带有标记 {#rn-150}

在一次 PR 审查中发现：`search_workspace`（dev agent 以及两个 QA/gate agent，`qa_tools.ex` 和 `qa_performance_seguranca_agent.ex`——后者只有 `read_file`/`search_workspace`，刻意没有 `Terminal`）返回*全部*搜索结果，没有任何上限——与发现 S（`Engine.Actions.TerminalExecutor.truncate/2`）以及 `read_file` 的修正（`Engine.Harness.Tools.ReadFile.truncate/2`）同类：结果留在循环的历史中并在之后的每个回合中传输，一棵大目录树就足以触发提供方的 `{413, "request entity too large"}`。

两个独立的上限，因为搜索会以两种不同方式溢出：

1. **命中数量**——一棵有数千个文件匹配搜索词的树会产生数千行 `- caminho`，即使没有任何单个文件很大。只在最后按*字节*截断，仍然要付出扫描并读取每个文件内容然后再组装字符串的代价。因此数量上限（`SEARCH_WORKSPACE_MAX_HITS`，默认 500）位于 `WorkspaceFiles.search/3` 中，它一旦找到足够的命中就*停止*消费搜索——流水线运行在 `Stream` 上，`Enum.take(stream, max_hits + 1)` 只从源头读取产生前 `max_hits + 1` 个结果所需的东西。"+1"使得可以说明*还有*更多，而不必继续扫描其余部分来计算准确总数——计算总数会再次付出上限要避免的 I/O，因此标记说"显示前 N 个"，从不编造总数。
2. **最终文本的字节数**——即使命中受限，非常长的路径也可能产生大字符串。字节上限（`SEARCH_WORKSPACE_MAX_BYTES`，默认 32,768），与 `terminal_output_max_bytes`/`read_file_max_bytes` 同一模式——*独立*的变量，不复用另外两个：同一类溢出，改动其中一个不应该需要触碰其他的。

截断标记是写给*模型*的，而不是给人的：它说明截断了什么（命中和/或字节），并指示细化搜索词——与 `TerminalExecutor`/`ReadFile` 标记的精神相同。

- **位置：** `apps/engine/lib/engine/harness/workspace_files.ex`
  （`search/3`、`take_capped/2`），
  `apps/engine/lib/engine/harness/tools/search_workspace.ex`
  （`truncate/3`、`marca_de_truncagem/5`），
  `apps/engine/config/runtime.exs`（`search_workspace_max_hits`、
  `search_workspace_max_bytes`）
- **测试：** `apps/engine/test/engine/harness/workspace_files_test.exs`
  （带 `max_hits` 的 `search/3` 截断*数量*，只有在多于上限时才标记截断），
  `apps/engine/test/engine/harness/search_workspace_test.exs`（结果少的搜索不被改变；命中多于上限的搜索被截断并给出清楚的提示；大于字节上限的最终文本也被截断）
- **来源：** PR 审查中的发现——审查中 413 的第二个真实原因，在 `read_file` 修正之后

---

### RN-162 — Criativo 的结构化问题 {#rn-162}

当 Criativo 在同一个回答中提出*多个*问题时，它可以以*结构化*格式发出列表，而不是让用户用自由文本逐项回答——新工具 `ask_structured_questions`
（`apps/engine/lib/engine/harness/tools/ask_structured_questions.ex`，
`:direct`），与 `emit_artifact` 并列注册。Schema：
`{ questions: [{ id, label, type?, options? }] }`——`id` 唯一且非空，`label` 非空，`type` ∈ `text|textarea|select`（默认 `text`），当 `type: select` 时 `options` 必填且非空。写入 `chat.structured_question`。

前端（`StructuredQuestionCard`，`SessionPage.tsx`）渲染一个每个问题一个字段的表单——根据 `type` 使用设计系统的 `Input`/`Textarea`/`Select`。`POST .../agents/:agent/structured-
question/:questionSetId/answer`（`AnswerStructuredQuestionUseCase`）校验每个问题都有非空回答，写入
`chat.structured_question_answered`（引用 `questionSetId` = 问题事件的 id），并*复用* `SendAgentMessageUseCase`——回答变成一条拼接的消息（"1. {label}: {resposta}\n2. ..."），就像用户在消息流中输入的一样；没有"agent 读取结构化回答"的新通道。一组问题只能被回答*一次*：重新提交以 409 被拒绝，表单甚至不会再出现——一旦存在之后带相同 `questionSetId` 的 `chat.structured_question_answered`，卡片就变为只读。

- **位置：** `apps/engine/lib/engine/harness/tools/ask_structured_questions.ex`,
  `apps/engine/lib/engine/agents/criativo_server.ex`,
  `apps/api/src/application/use-cases/agents/answer-structured-question.use-case.ts`,
  `apps/api/src/interfaces/http/agents/agents.controller.ts`,
  `apps/web/src/routes/SessionPage.tsx`（`StructuredQuestionCard`）
- **测试：** `apps/engine/test/engine/harness/tools/ask_structured_questions_test.exs`,
  `apps/engine/test/engine/agents/criativo_server_test.exs`,
  `apps/api/test/application/use-cases/agents/answer-structured-question.use-case.spec.ts`,
  `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx`
- **来源：** 用户的请求——聊天中没有结构化输入的先例

### RN-163 — Criativo 兑现重试的承诺 {#rn-163}

Criativo 的每个回合都运行一个**有界的工具使用循环**，上限为 **12** 次模型调用——与 PO 和 Arquiteto 已有的设计相同。以前每个回合只调用模型*一次*：工具结果被附加到内存中的历史，再也没有人读它，因此*"vou corrigir e tentar de novo"*这句话——代码中的字面量——只有在用户再发一条消息时才会兑现。对使用者来说，Criativo 在说它要修正之后就干脆不再回应了。

四个后果，每一个都是规则：

1. **工具错误是输入，而不是终点。** 原因作为 `tool` 消息回到模型，循环再次调用模型，模型在同一回合*之内*发出修正后的结果。
2. **不宣布代码不会执行的东西。** 重试的句子在派发工具之后、在知道还剩多少圈的情况下决定：有剩余的圈数时，agent 说它会修正；没有时，它不作承诺。
3. **工具失败变成了带来源的持久 `agent.error`**（[RN-059](#rn-059)）——原来是 `agent.response`，在事件日志中与正常回答无法区分。api 拒绝 `append_event` 时为 `origem: infra`；对于模型写出的 payload（错误的键、不是列表的 `origin`、重复的规则、系统发出的类型）为 `origem: modelo`。payload 携带 `tool` 和 `retentativa`。
4. **上限耗尽不会以沉默结束。** 它变成带 `reason: "limite_de_iteracoes"` 和 `origem: modelo` 的 `agent.error`，与 `ToolLoop` 的 `toolloop.limit_reached` 相同的解读。事件名*不*被复用：这个 agent 不在 `ToolLoop` 内运行，那个事件会就谁产生了它撒谎。

循环的两个边界，都是刻意的：成功的 `ask_structured_questions` **结束**回合（球在用户那边，回答会在未来的回合中返回——[RN-162](#rn-162)）；某一圈失败过的回合在消息流中以*汇总*的结果收尾，使最后一句话不是一圈之后已经被修正的错误。

- **位置：** `apps/engine/lib/engine/agents/criativo_server.ex`
  （`run_turn_capturing/3`、`continuar/4`、`emit_falha_de_ferramenta/4`、
  `emit_falha_limite/2`）
- **测试：** `apps/engine/test/engine/agents/criativo_server_test.exs`
  （真正修正的循环、叙述出的上限耗尽、来源 `infra` 与 `modelo`、结束回合的结构化问题）
- **来源：** `exp001` 项目中的真实使用——"o Criativo não respondeu depois
  de dizer que iria corrigir e tentar de novo"

### RN-164 — PO *读取*已存在的东西，范围限定在项目 {#rn-164}

PO 获得了两个*读取*工具——`listar_regras_de_negocio` 和
`listar_backlog`（`:direct`，没有任何参数）——由两条范围限定在**项目**的内部路由提供：`GET /internal/projects/:projectId/business-rules`
和 `GET /internal/projects/:projectId/backlog`。

第一个返回项目各会话中的每个 `artifact.business_rule`，带完整的 `description`、哪些故事已经引用了每条规则，以及
`uncoveredCount`；第二个返回与 Backlog 标签页*相同*的史诗 → 故事 → 任务树，通过同一个 `ListBacklogUseCase`（每个项目三次读取，绝不是 N+1）。返回给模型的文本把*未覆盖*的规则放在最前，把*孤立*的史诗放在树之前——这正是产生工作的东西。

规则修正的是：在此之前 PO 有**四个工具，全部是写入的**。它的上下文在 kickoff 时一次性组装，来自**会话**最近的 200 个事件——从那以后它不知道存在哪些规则、已经覆盖了哪些，也不知道已经创建了什么。范围刻意是项目而不是会话：在之前的会话中捕获的规则，正是按会话读取所隐藏的东西。

读取**不**会变成 `proposed_action`（不是外部效果），但它在 ADR 0060 的意义上是*受约束*的：两条路由除项目 id 外都不接受参数——没有搜索、没有分页、没有过滤器——，每次调用的成本是常数，交给模型的文本有行数上限，截断时说明真实总数。

- **位置：** `apps/engine/lib/engine/harness/tools/listar_regras_de_negocio.ex`,
  `apps/engine/lib/engine/harness/tools/listar_backlog.ex`,
  `apps/engine/lib/engine/agents/po_server.ex`,
  `apps/engine/lib/engine/sessions/engine_api_client.ex`,
  `apps/api/src/application/use-cases/backlog/list-business-rules.use-case.ts`,
  `apps/api/src/interfaces/http/internal/internal-projects.controller.ts`
- **测试：** `apps/engine/test/engine/harness/tools/listar_regras_de_negocio_test.exs`,
  `apps/engine/test/engine/harness/tools/listar_backlog_test.exs`,
  `apps/engine/test/engine/agents/po_server_test.exs`,
  `apps/api/test/application/use-cases/backlog/list-business-rules.use-case.spec.ts`
- **来源：** `exp001` 项目中的真实使用——"crie ferramenta para o PO
  conseguir listar as regras de negócio"

---

### RN-165 — 没有故事的史诗会被追究，PO 在不知道时提问 {#rn-165}

当 PO 结束一个回合时创建了一个史诗却**没有为它创建任何故事**，这会成为*显式*的结果：持久事件
`backlog.epic_without_story`（带 `origem: "modelo"`、史诗的 id 和标题以及消息）外加 `agent.error` 广播——[RN-059](#rn-059) 的模式：日志是留存下来的东西，广播是 agent 在消息流中说话。追究按*发生*计：报告一次后，待办列表会被清空，不会变成每个回合都重复的警报。

算数的是*成功*的创建：被 api 拒绝的 `create_story`（例如不存在的 `business_rule_id`）不会结清史诗。把它当作结清，就是用一种沉默换另一种沉默。待处理的史诗存在于 `PoServer` 的 state 中，*不*会被重新水合：追究的是回合中承担的义务，从事件日志重建它会重新打开用户已经用别的方式解决了的旧史诗。

同时到来的还有 PO 除了停下之外拥有另一条出路所缺少的两样东西：
`ask_structured_questions`——与 Criativo（[RN-162](#rn-162)）*相同*的工具，只是在 `po_server` 中开始声明——以及明确写明没有故事的史诗会卡住执行、并且**缺少信息时要*提问***、绝不停下也绝不编造的 kickoff 指令。之前的指令对面对缺口时该怎么做只字未提，而面对没有指令的缺口，模型会在编造与停下之间选择。

- **位置：** `apps/engine/lib/engine/agents/po_server.ex`
  （`anotar_obrigacao/4`、`encerrar_turno/1`、`obrigacoes/0`），
  `apps/engine/lib/engine/harness/tools/create_epic.ex`（`id_no_resultado/1`），
  `apps/web/src/lib/activity.ts`
- **测试：** `apps/engine/test/engine/agents/po_server_test.exs`
  （describe "RN-165"），`apps/web/src/lib/activity.test.ts`
- **来源：** `exp001` 项目中的真实使用——没有故事的 backlog，因而没有任务，因而执行卡住而没有可见的错误

---

### RN-166 — PO 的迭代上限会留下痕迹 {#rn-166}

`PoServer` 工具循环的迭代上限（12）耗尽时，回合发出带 `{iteration, max_iterations}` 的 `toolloop.limit_reached`——与 `Engine.Harness.ToolLoop` 自 Fase 3 起就发出的*相同*类型和相同 payload。以前，该子句返回 state 就结束了：从外部看，耗尽的循环与一个只是结束了的回合无法区分。

复用这个标识符而不是创建 `po.*` 是刻意的：这是同一个事实（循环撞到了上限），阅读事件日志的人不应该因为对话型 agent 有自己的循环而不使用 `ToolLoop`，就需要学习第二个名称。

- **位置：** `apps/engine/lib/engine/agents/po_server.ex`（`run_turn/2`，
  `remaining <= 0` 子句）
- **测试：** `apps/engine/test/engine/agents/po_server_test.exs`
  （"teto de iterações emite toolloop.limit_reached"）
- **来源：** 对 `exp001` 卡住的调查——循环在沉默中结束

---

### RN-171 — 列表问题默认有自由文本的出口 {#rn-171}

`ask_structured_questions`（RN-162）的 `type: "select"` 问题接受**列表之外**的回答。字段是 `allowOther`，**默认为 `true`**：什么都不声明的人会提供这个出口。关闭列表需要显式的 `allowOther: false`，并且只在列表真正封闭时（"是"/"否"）才有意义。

开放的默认值不是风格偏好。因模型*遗忘*而关闭的列表会卡住整个对话，而用户无法从外部解开它——这正是真实使用中遇到的：模型提供了一个"自己填写"之类的选项，表单却没有地方可写，因为工具的 schema 不知道如何表达"除了这些，你想要什么都行"。被错误打开的列表，最坏情况下多提供一个字段。两种错误的代价不同。出于同样的原因，工具描述**禁止**在 `options` 中创建"其他"选项：表单会自己提供它，同一列表中的两个出口会造成困惑。

`allowOther` 只存在于 `select` 中——在 `text`/`textarea` 中字段本来就是自由文本，engine 把这两者规范化为 `false`，而不是在事件日志中写入没有意义的状态。在界面上，选择"其他（填写）"会把 `Select` 换成 `Input`：界面哨兵（`__outra__`）**绝不**传到后端，传的是输入的*文本*。提交按钮仍然要求*所有*问题都已填写——`AnswerStructuredQuestion
UseCase` 以 400 拒绝并列出缺少的内容，因此在字段为空时启用只会产生一个服务器错误——，而处于"其他"且文本仍为空白*不*算已填写。

卡片也不再是消息流中唯一一个不与任何东西对齐的项：它与 `chat` 变体中的 `ApprovalCard`（[RN-173](web.md#rn-173)）一样以 560px 上限居中，并获得 agent 的头像和颜色，正是这一点让它读起来像某人的*话*，而不是孤立的表单。以前它贴着左边诞生，上限 480px，而气泡从 45px 处开始。

- **位置：** `apps/engine/lib/engine/harness/tools/ask_structured_questions.ex`
  （schema、校验和 `normalizar/1`），`apps/web/src/lib/api-types.ts`
  （`StructuredQuestion.allowOther`），`apps/web/src/routes/SessionPage.tsx`
  （`StructuredQuestionCard`、`OUTRA_RESPOSTA`、`permiteOutra`），
  `apps/web/src/routes/SessionPage.module.css`（`.structuredQuestionCard`、
  `.structuredQuestionCabecalho`）
- **测试：** `apps/engine/test/engine/harness/tools/ask_structured_questions_test.exs`
  （默认开放、显式 `false`、拒绝非布尔的 `allowOther`），
  `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx`
  （describe "saída por texto livre no select"）
- **来源：** `exp001` 中的真实使用——"sempre dê a opção de input do usuário
  quando ele seleciona Escreva"

### RN-175 — 每个 agent 回复都说明它是用哪个模型生成的 {#rn-175}

`agent.response` 在该事件的**三个**生产者中都携带 `modelName`，而不只是在四个对话型 agent 中：

| 生产者 | 谁经过那里 | 之前 |
|---|---|---|
| 四个对话型 agent（`criativo`/`po`/`arquiteto`/`dev_lead`） | 聊天 | 自 [RN-146](api.md#rn-146) 起已经写入 |
| `Engine.Harness.ToolLoop` | *所有*执行和 gate agent——`dev-*`、QA、SecOps、Infra-Workflows、Psicólogo、Anamnese | **从未写入** |
| `SendChatMessageUseCase`（api） | 没有活跃 agent 的聊天，回答的是模型 | **从未写入** |

没有新的调用：`RunLlmTurnUseCase` 已经在响应体中返回 `modelName`，`StreamLlmTurnUseCase` 已经把它放在 `final` 帧中——值是**已解析 binding** 的模型名称（`model.name`），而不是提供方的回声。当回合在解析 binding 之前失败时为 `null`，在这条规则之前写入的事件中则缺失。

在界面上，模型不再是 agent 名称旁边以 10px 等宽 `--text-muted` 显示的孤零零的词 `modelo`——那读起来像模型*叫做*"modelo"，而且不满足阅读文本的对比度。它变成了一个带模型图标的**芯片**，`--surface-2` 上的 `--text-secondary`，未知时的标签变为"modelo não registrado"。数据缺失时，界面**不会**根据 agent 的*当前* binding 猜测模型：把一个可能在它生成时根本不存在的模型归于一个旧回复，就是编造来源，而编造的来源比缺失更糟——与 `token_usage` 中冻结价格（[RN-044](api.md#rn-044)）的论点相同。

已声明不在范围内：在四个服务器中，`agent.error` 仍然不带模型，即使 api 在错误帧中发送了它（例如预算超支）。那是另一个事件的变更，要回答的是另一个问题。

- **位置：** `apps/engine/lib/engine/harness/tool_loop.ex`,
  `apps/api/src/application/use-cases/llm/send-chat-message.use-case.ts`,
  `apps/web/src/routes/SessionPage.tsx`（`agent.response` 中的芯片），
  `apps/web/src/routes/SessionPage.module.css`（`.messageModelo`）
- **测试：** `apps/engine/test/engine/harness/tool_loop_test.exs`,
  `apps/api/test/application/use-cases/llm/send-chat-message.use-case.spec.ts`,
  `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`,
  `apps/web/src/design-contraste.test.ts`（芯片的颜色对）
- **来源：** `exp001` 中的真实使用——"PO não mostrou o modelo que estava
  utilizando; todos os agentes devem apresentar o seu modelo ao lado do nome"

## 审计 fluxo.yml × 代码——Dev Lead 的计划变成真正的审批（RN-284，ADR 0086）

这不是计划中的阶段：它是对 `docs/fluxo.yml` × 代码审计所发现的一处分歧的修正（`docs/explanation/auditoria-fluxo-vs-codigo.md`，发现 A2）——流程早已把 `dev-lead` 的输出 `plano-de-paralelismo` 声明为 `via: proposed_action`，而代码从未调整到与之一致。

### RN-284 — 对话型智能体的轮次可以**挂起**以等待人工审批 {#rn-284}

> **由 [RN-677](api.md#rn-677)（ADR 0194）修订：** `propose_execution_plan`
> 获得了执行流水线——批准计划会记录任务的模块
> （[RN-678](api.md#rn-678)）并**激活**执行；操作以 `executed` 或
> `failed` 结束，Dev Lead 在恢复时读取的正是这个结果。下面第 1 项
> （“没有 execute-* 流水线”）对这种类型不再成立。

> **由 [RN-578](#rn-578)（ADR 0163）修订：** **所有**对话型智能体的轮次都不再占住 `GenServer.call`——`from` 在接受时就被回复，这里描述的挂起只改变轮次的**收尾**
> （`awaiting_approval` 而不是 `agent.done`），不再改变回复的时机。挂起期间被拒绝的 `user_message` 在点击时变成 409。

这是对话型智能体（Criativo、PO、Arquiteto、Dev Lead——都通过最长 180 秒的 `GenServer.call` 运行同步轮次，由
`Engine.Agents.TurnoAssincrono` 中介）第一次挂起以等待人的决定。这种模式在 dev agent（[RN-073](#rn-073)，ADR 0052）和 QA/Infra 的 gate（ADR 0057）中已经存在，但两者都由 `cast` 触发，从不等待同步响应——这正是本机制解决的点，而促使 Dev Lead 诞生的并行上限（[RN-083](api.md#rn-083)）就是第一个挂起的审批属于它的原因。

**机制分四个部件：**

1. `Engine.Agents.DevLeadTools.run/2`
   （`apps/engine/lib/engine/agents/dev_lead_tools.ex:81-107`）调用
   `EngineApiClient.propose_action/5` 而不是 `append_event/3`，并返回
   `{:ok, texto}`（状态 `executed`/`auto_approved`/`approved`——三者都算成功，因为 `propose_execution_plan` 没有自己的 execute-*
   流水线，手动批准会永远停在 `"approved"`）、
   `{:pending, action_id}` 或 `{:error, texto}`。
2. `Engine.Agents.DevLeadServer.run_turn/2`
   （`apps/engine/lib/engine/agents/dev_lead_server.ex`，`tool_calls` 的分派块）使用 `Enum.reduce_while` 在第一个 `:pending` 处**停止**，不处理后续调用也不递归——并返回设置了 `:aguardando_aprovacao` 键的 `state`
   （`%{action_id:, tool_call_id:, tool_name:, remaining:}`，`remaining`
   已针对上限扣除挂起的那次迭代）。`role:
   "tool"` 消息此时**不**进入 `state.messages`——在那里写入“pending”就是在对模型撒谎说命令已经这样回答了（与 dev agent 相同的推理，`Engine.Harness.Hooks.ActionPipeline`）。
3. `Engine.Agents.TurnoAssincrono.tratar_resultado/2`
   （`apps/engine/lib/engine/agents/turno_assincrono.ex`）以与往常相同的方式、在相同的时刻回复 `from`——这正是在正确时刻打破同步阻塞的东西——但不是调用 `finalizar/1`（它发出
   `agent.done` 和 `agent.status: idle`），而是调用 `suspender/1`：只有
   `agent.status: awaiting_approval`，没有 `agent.done`，因为轮次还没结束。检查依据的是键的**值**（`Map.get/2`，真值），从不是键是否存在——Dev Lead 从
   `init/1` 起就带着 `aguardando_aprovacao: nil`，所以键本身总是存在的。
4. `Engine.Sessions.LiveBroadcast.agent_status/4`
   （`apps/engine/lib/engine/sessions/live_broadcast.ex:38-39`）把守卫从 `["working", "idle"]` 扩展为包含 `"awaiting_approval"`——没有这一点，第 3 步的 `agent.status` 甚至不会被持久化。

**恢复。** `Engine.Agents.DevLeadServer` 在 `init/1` 中订阅
`Engine.Dev.Wake.subscribe(project_id, "dev-lead")`——与
`Engine.Gates.QaLeadServer` 已经为 QA 子智能体复用的是**同一个**模块，尽管名字是“dev”：`{:action_settled, ...}` 的投递是按**智能体**的，由 payload 的 `agentId` 路由（`apps/engine/lib/engine/workers/dev_agent_wake_worker.ex`），而不是按智能体类型。决定到达时，一个 `handle_info` 用**真实**结果组装 `role: "tool"` 消息（`texto_do_desfecho/1`，与 dev agent 和 `QaLeadServer` 相同的词汇），清空 `aguardando_aprovacao`，并以 `TurnoAssincrono.iniciar(state, nil, fn -> run_turn(state,
pendente.remaining) end)` 恢复。

**挂起期间，第二条 `user_message` 不会开启新轮次**——一个在通用子句**之前**测试的
`handle_call({:user_message, _text}, _from, %{aguardando_aprovacao:
%{}})` 守卫发出 `agent.error`（来源
`politica`），解释审批中有一个待处理的决定，不启动任何任务。

**被接受并声明的缺口——等待期间重启。** 与 dev agent（在 `init/1` 中通过 `handle_continue` 重新水合 `laco_pendente`，ADR
0052）不同，Dev Lead **不**重新水合 `aguardando_aprovacao`——它只在内存中。如果 engine 在它挂起时重启，决定仍然被记录并在审批中可见（在 api 中是持久的），但 Dev Lead 不会自动叙述结果：订阅了 `Wake` 的进程已经死了，下一次重启会启动一个新的 Dev Lead，没有对那个操作的订阅。关闭这个缺口需要与 ADR 0052 相同的机制——超出本次变更的范围，本次变更只是让行为与 `docs/fluxo.yml` 已经声明的一致。

- **位置：** `apps/engine/lib/engine/agents/dev_lead_tools.ex`、
  `dev_lead_server.ex`；`apps/engine/lib/engine/agents/turno_assincrono.ex`
  （四个对话型智能体共享）；`apps/engine/lib/engine/sessions/live_broadcast.ex`；
  `apps/api/src/domain/actions/decide.ts`（`propose_execution_plan`）
- **测试：** `apps/engine/test/engine/agents/dev_lead_tools_test.exs`、
  `dev_lead_server_test.exs`（describe "suspensão em aprovação"）、
  `turno_assincrono_test.exs`（describe "resultado com :aguardando_aprovacao"）、
  `live_broadcast_test.exs`、`wake_do_outbox_ao_dev_lead_test.exs`（**整条**链——outbox → drain → worker → `Engine.Dev.Wake` → Dev Lead 的进程，与 `Engine.Dev.WakeDoOutboxAoAgenteTest` 相同的模式）、
  `apps/api/test/domain/actions/decide.spec.ts`（describe "plano de
  execução do Dev Lead"）
- **ADR：** [0086](../adr/0086-dev-lead-plano-suspende-para-aprovacao.md)
  （修订 [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md) 的一部分；直接先例：[ADR 0052](../adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md)
  和 [ADR 0057](../adr/0057-o-gate-espera-a-aprovacao.md)）

---

## UX Designer——第五个对话型智能体（RN-285..287，ADR 0087）

这不是被触发的拆分条件（`docs/fluxo.yml` 一直把“当**被管理的**项目有自己的界面要设计时”声明为标准）——而是产品负责人有意识地决定提前设立这个角色。`teste-de-
usabilidade`（需要真实的人类用户）不在能力范围内；`metricas-de-
uso` 仍是缺口，因为它依赖于 `analytics` 角色，而该角色仍是
`proposto`。

### RN-285 — UX Designer 是**独立**的对话型智能体，没有领域 {#rn-285}

`Engine.Agents.UxDesignerServer`（`apps/engine/lib/engine/agents/ux_designer_server.ex:40`）
镜像 `Engine.Agents.ArquitetoServer`/`DevLeadServer`：每个会话一个 GenServer，自有的有界工具使用循环，上限 14（与 Arquiteto/Dev
Lead 同一量级——推理型智能体，不是 Criativo/PO 那样的轻量对话）。由指向“ux-designer”的 `accepted` handoff 激活——这是早已存在的**通用**机制（api 中的 `ActivateAgentUseCase`/`canActivateAgent` 没有增加任何一行：任何有已接受 handoff 的智能体都已经可以被激活）。

启动（`build_kickoff/1`，`ux_designer_server.ex:222`）读取会话中最近的
`artifact.product_brief`——Criativo 产出的**同一份**“业务需求”，没有新制品。设计系统
（`design/tokens.css`、`design/COMPONENTS.md`）在身份中被**描述**
（`Engine.Harness.Agents`，条目 `"ux-designer"`），是静态文本，因为对话型智能体没有读取仓库文件的工具——它是提示词中**每一**轮都存在的唯一一层，而不只在启动时。

没有领域，没有子智能体：`docs/fluxo.yml` 早已把该角色归类为
`camada_produto`，与 Criativo 和 PO 并列，它们都没有领域。

### RN-286 — `propose_prototype` 记录没有表也没有专门用例的制品，并在**同一个**制品上提供**两个** handoff {#rn-286}

`artifact.prototipo_navegavel` 沿用
`artifact.project_image`/`artifact.c4_diagram` 无表的设计（[RN-149](api.md#rn-149)）——事件日志就是记录——但走的是与这两者**不同**的路径。
`choose_project_image`/`create_c4_diagram` 需要**在 API 中**的用例
（`DecidirImagemDoProjetoUseCase`/`CreateC4DiagramUseCase`），因为它们有从另一个制品**派生**的内容（Container 层来自当前的 `module_map`），或有多个消费者共享的领域拒绝（镜像的资源上限）。`propose_prototype`
（`Engine.Agents.UxDesignerTools.run/2`，
`apps/engine/lib/engine/agents/ux_designer_tools.ex:122`）两个理由都没有——它是**自包含**的内容，只有 UX Designer 自己写、也只有它自己读回——所以**形式**校验位于 engine
（`Engine.Harness.ArtifactSchemas`，类型 `"prototipo_navegavel"`，
`artifact_schemas.ex:49/135`——人物角色和旅程非空，至少一个屏幕），而记录使用 api 已经为任何事件类型暴露的**通用**路径（`EngineApiClient.append_event_returning/3`），与 Criativo 的 `artifact.product_brief` 相同的机制。api 中没有新路由。

记录之后，`gravar_e_ofertar_handoffs/2`（`ux_designer_tools.ex:149`）在**同一个**制品上提供**两个** handoff——给“po”和给“dev-lead”的 `create_handoff`，两者都带原型的 `artifactId`。从不为“spec-visual”（`docs/fluxo.yml`）建第二个制品：PO 读取 `resumo`/`prototipo` 来设计 backlog，Dev Lead 读取**同样的** `telas`/`anotacoes` 作为实现的视觉参考——复制内容会冒两份副本在下次修订中产生分歧的风险，这与 C4 不重新输入 `module_map` 背后的论点相同。

提供两个 handoff 中的**一个**失败，不会撤销已记录的制品，也不会撤销另一个 handoff（RN-116）——原因作为工具结果的文本返回，是循环的输入而不是终点（RN-163）：模型读到后可以在下一次回复中报告给用户。

一次**成功**的 `propose_prototype` 会结束轮次
（`ux_designer_server.ex:120`，与 Dev Lead 中 `propose_execution_plan` 相同的守卫）——没有它，循环会回到模型，模型可能再次提议，产生两个总数相同的原型。这里只有**一个**工具（不像 Arquiteto 那样有第二个工具调用要串联），所以“第一次成功即停止”不会损失任何东西。

## Staff：代码就绪，对自动触发保持休眠（RN-305/RN-306，ADR 0088）

这不是计划中的阶段：`docs/fluxo.yml` 自 ADR 0085 起就把 Staff/Principal Engineer 声明为
`status: planned`（“契约就绪，激活已决定，等待触发条件”）。产品负责人决定提前写好**代码**，尽管知道自动触发条件（Anamnese 注意到一个**反复出现**的系统性问题）不会触发——Anamnese 已暂停
（`ANAMNESE_ENABLED=false`，2026-08-10 的产品决定）。见 RN-086 中已记录的待办：让 Anamnese 提议提高并行上限的那个信号，正是会让它提议向 Staff 发起 handoff 的信号，而只要它暂停，两者都不会触发。

### RN-305 — Staff 通过**通用** handoff 路径激活，没有 `USER_STARTED_AGENTS`，也没有 `kickoff/1` {#rn-305}

`USER_STARTED_AGENTS`（`apps/api/src/domain/sessions/agent-activation.ts`）是 Criativo 的例外（没有 handoff，由用户命令启动）——Staff **不**在其中。调查确认 `canActivateAgent` 早已能激活任何有指向它的 `accepted` handoff 的智能体，这是对 `dev-lead`/`arquiteto`/`infra` 早已适用的同一路径；而 `assertHandoffTargetAllowed`
（`apps/api/src/domain/agents/agent-areas.ts`）只拒绝指向领域**子智能体**的 handoff——Staff 没有领域，因此 api 中不需要任何领域改动。“可手动触发”意味着领域**机制**允许（任何智能体都可以调用
`EngineApiClient.create_handoff(..., "staff", ...)`，人通过已有路由接受），而不是如今存在一个专门用来选择“向 Staff 发起 handoff”的屏幕——向任选智能体发起 handoff 的通用 UI 仍在 backlog 中（`docs/explanation/backlog.md`），与这次变更之前一样。

`Engine.Agents.StaffServer`（`apps/engine/lib/engine/agents/staff_server.ex`）
是第五个独立对话型智能体（与 Criativo、PO、Arquiteto、Dev
Lead 一起），镜像 Arquiteto——每个会话一个 `GenServer`，从事件日志重新水合，有界工具使用循环上限 14（`staff_server.ex:49`）——但**没有
`kickoff/1`**：其他 lead 从会话事件日志中先前的制品（product_brief、module_map、backlog）合成开场指令；Staff 没有这样的来源，因为系统性问题产生于会话之外。`StaffSupervisor.start_agent/2` 启动进程（重新水合历史），它保持空闲直到第一条 `user_message`
（`staff_server.ex:60`）——这就是发起 handoff 的人解释问题的方式。`apps/engine/lib/engine_web/controllers/agent_command_controller.ex:60`
（`"staff"` 的 `start/2` 子句）从不调用 `kickoff`（这个函数甚至不存在），与 po/arquiteto/dev-lead/infra 不同。

- **位置：** `apps/api/src/domain/sessions/agent-activation.ts`
  （`canActivateAgent`、`USER_STARTED_AGENTS`——未改动）、
  `apps/api/src/domain/agents/agent-areas.ts`
  （`assertHandoffTargetAllowed`——未改动）、
  `apps/engine/lib/engine/agents/staff_server.ex`、
  `staff_supervisor.ex`、
  `apps/engine/lib/engine_web/controllers/agent_command_controller.ex`
  （`"staff"` 的 `start/2`/`message/2`/`via_for/2` 子句）、
  `apps/engine/lib/engine/application.ex`（监督树中的 `Engine.Agents.StaffSupervisor`）
- **测试：** `apps/engine/test/engine/agents/staff_server_test.exs`
  （重新水合、没有自动启动——轮次只由 `user_message` 运行）
- **ADR：** [0088](../adr/0088-staff-agente-dormente-para-disparo-automatico.md)

### RN-306 — `propose_rfc` 直接记录制品，并在**同一个**工具调用中返回 handoff，没有 `proposed_action` {#rn-306}

`Engine.Agents.StaffTools.propose_rfc`
（`apps/engine/lib/engine/agents/staff_tools.ex:41`）是 Staff 唯一的工具：问题、带权衡的选项、建议，以及一个**可丢弃** PoC 的范围（`descartavel: true` 是**固定的**——从不由模型写入）。`run/2`
（`staff_tools.ex:89`）通过
`EngineApiClient.append_event_returning/3` 记录 `artifact.rfc_staff`——与 `Engine.Harness.Tools.EmitInsight`（Arquiteto 的 `emit_insight`）相同的**无表**、**无专门用例**模式，而不是 `artifact.c4_diagram`（ADR 0068）的模式，后者在 api 中有自己的用例，因为它从当前的 `module_map` **派生** Container 层——RFC 不从那边派生任何东西，整个 payload 都来自工具调用。

记录之后，**同一个** `run/2` 调用
`EngineApiClient.create_handoff(..., "staff", "arquiteto", artifact_id)`——中间没有人工确认，与
`CriativoServer.executar_confirm_readiness/1` 在同一次响应中发出 product_brief 并向 PO 提供 handoff 的模式相同。`propose_rfc` **不是**
`proposed_action`：记录一份架构文档不是外部效果（不是 git、终端，也不是智能体花费）——真正的决定（采纳、调整、拒绝建议）属于 Arquiteto，在工具已经返回的 handoff 中做出。创建 handoff 失败**不会**搞垮进程，也不会丢失已记录的 RFC（RN-116）——原因进入工具结果，模型知道只需要重试 handoff，而不是重写 RFC。

- **位置：** `apps/engine/lib/engine/agents/staff_tools.ex`
- **测试：** `apps/engine/test/engine/agents/staff_server_test.exs`
  （"propõe o RFC, grava o artefato e devolve o handoff ao arquiteto"；
  "propose_rfc com opções vazias vira tool-result de erro"；"falha ao
  devolver o handoff ao arquiteto NÃO derruba o processo"）
- **ADR：** [0088](../adr/0088-staff-agente-dormente-para-disparo-automatico.md)

**声明而非隐藏**：团队面板的名册
（`apps/web/src/lib/agent-status.ts`，`staffActive`）和仪表盘卡片
（`ProjectCardSummary.roster`，`apps/api/.../projects-summary.repository.ts`）在 Staff 活动时显示它，与 `infraActive` 标准相同——避免了 `RosterFacts` 的注释早已警告过的分歧。`SessionPage.tsx`
**没有**被改动：`staff` 不在 `AGENTES_DE_CHAT` 中，与早已为 `infra` 接受的模式相同（一个**真实**且**活动**的 lead 也不在该列表中——对它的 handoff“从不在**这里**被接受”，正如该文件自己的注释所说）。如今端到端的使用路径是内部路由
（`POST .../agent/message`，`agent: "staff"`），而不是会话屏幕。

---

## appsec 获得 secops 的第二个时刻（RN-360/361，ADR 0090）

`docs/fluxo.yml` 早已把 `id: appsec` 声明为 `proposto`，拆分标准是预先写好的：“mesmo padrão do QA: dois MOMENTOS, não
dois agentes por ora”。这次变更构建了这个第二时刻——**设计**阶段的威胁建模，在代码/PR 存在**之前**——这是产品负责人提前激活的有意识决定，没有等待注册表本身列为触发条件的 `implementavel` gate。

### RN-360 — **设计**阶段的威胁建模基于用户故事 + module_map 运行，没有 worktree/task_id，在 secops 的**同一个**进程中 {#rn-360}

运行 appsec 的是早已为确定性 PR 判定而存在的**同一个** `Engine.Gates.SecOpsAgentServer`——不是新进程。`run_design/2`
（`apps/engine/lib/engine/gates/secops_agent_server.ex:76`）是一个 `GenServer.cast`，发往 `run/2` 已在使用的同一个 `Registry` 键（`{project_id, "secops"}`）；`handle_cast({:run_design, story_id}, state)`
（`secops_agent_server.ex:93`）通过
`Engine.Gates.AppSecContextBuilder.fetch/2`
（`apps/engine/lib/engine/gates/appsec_context_builder.ex:31`）获取上下文——项目 backlog 中的用户故事（`EngineApiClient.list_backlog/1`，RN-164 给 PO 的**同一次**读取）和创建该用户故事的会话的当前 `module_map`
（`EngineApiClient.get_infra_context/2`，Infra 领域早已进行的、不带 task/story 的**同一次**读取）——然后调用 `Engine.Gates.AppSecAgent.run/3`
（`apps/engine/lib/engine/gates/appsec_agent.ex:47`）。

`AppSecAgent` 是**无状态**模块（不是 GenServer，与
`QaPerformanceSegurancaAgent` 形式相同），工具注册表中**没有** `Terminal`——
`[ReadFile, SearchWorkspace, EmitThreatModel]`——通过 `Engine.Harness.ToolLoop.run/1` 运行一份 STRIDE-lite 检查清单（Spoofing/Tampering/Repudiation/Information disclosure/Denial of
service/Elevation of privilege）。“没有 Terminal、没有 task_id 的第二时刻”与之前 gate 模式的结构性区别：没有任何 `dev_state`/`worktree_path` 进入 `ctx`——
`ReadFile`/`SearchWorkspace` 降级为
`Engine.Actions.Workspace.workspace_dir/1` 的后备（项目的**共享**检出，而不是智能体的 worktree），`session_id` 来自
`story["sessionId"]`，从不来自 `dev_state`。`EmitThreatModel`
（`apps/engine/lib/engine/gates/tools/emit_threat_model.ex`）没有
`approved`/`changes_requested` 判定——appsec 总是以记录威胁模型**结束**，从不批准/否决任何东西——因此不复用
`Engine.Gates.Hooks.Termination`（提取的形状不同）：它有**自己的** hook，`Engine.Gates.Hooks.AppSecTermination`。

成功结束后，`run_appsec_design/3`
（`secops_agent_server.ex:234`）发出 `artifact.threat_model`
（`storyId`/`threatModel`/`requisitosDeSeguranca`/`riscos`，schema 在
`apps/engine/lib/engine/harness/artifact_schemas.ex:71`——`riscos` 不在必填键中，因为空列表是有效的回答）。失败（迭代上限、预算，或模型停下而没有调用
`emit_threat_model`）变成带来源的持久 `agent.error`
（`modelo`/`politica`/`infra`），与 RN-059 标准相同——从不是空响应，也不是只在广播中的沉默。

**自 [RN-539](#rn-539) 起存在自动触发**。这次交付被有意保持自包含（没有触碰其他战线的任何文件：
`decide.ts`、`docs/gates.yml` 和 `dev_lead_tools.ex` 未动），并声明了缺口：`run_design/2` 是**可触发的**，但没有任何东西会自行触发它。它点名的触发点——Dev Lead 的 `assess_implementability`，`qa-estrategia` 战线，`implementavel` gate，同一个 ADR 0090——已成为真正的调用方，并行地、每个用户故事只调用一次。

- **位置：** `apps/engine/lib/engine/gates/secops_agent_server.ex`（`run_design/2`、
  `handle_cast/2`、`run_appsec_design/3`、`emit_threat_model/3`、
  `emit_bloqueio_appsec/3`）；`apps/engine/lib/engine/gates/appsec_agent.ex`；
  `apps/engine/lib/engine/gates/appsec_context_builder.ex`；
  `apps/engine/lib/engine/gates/tools/emit_threat_model.ex`；
  `apps/engine/lib/engine/gates/hooks/appsec_termination.ex`；
  `apps/engine/lib/engine/harness/artifact_schemas.ex`（schema `threat_model`）
- **测试：** `apps/engine/test/engine/gates/appsec_agent_test.exs`、
  `apps/engine/test/engine/gates/appsec_context_builder_test.exs`、
  `apps/engine/test/engine/gates/secops_agent_server_test.exs`（`run_design` 的三个测试）
- **来源：** [ADR 0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md)

### RN-361 — 完成的威胁模型创建**三个** handoff，总是指向 **LEAD** {#rn-361}

`criar_handoffs_appsec/3`（`secops_agent_server.ex:326`）为 `docs/fluxo.yml` 中声明的每个目标（`appsec` 的 `saidas`）创建一个 handoff：arquiteto、
dev-lead 和 infra——与
`OfferInfraHandoffUseCase`/`ArquitetoServer.executar_offer_infra_handoff/1` 相同的模式（**分开的**调用，每个目标一次，这样一个 handoff 的失败不会撤销已创建的另外两个）。流程中的 id 是 `area-infra`，但可寻址的**智能体**是 `"infra"`（`apps/api/src/domain/agents/agent-areas.ts`——
`lead: 'infra'`），从不是 `area-infra`：外部 handoff 只指向领域的 LEAD（ADR 0038），而 `CreateHandoffUseCase.assertHandoffTargetAllowed`
会拒绝无法解析为 lead/无领域智能体的 `toAgent`。**一个**目标的失败变成按目标叙述的 `agent.error`（RN-116）——已创建的另外两个 handoff 不会被撤销。

**自 [RN-636](#rn-636) 起，这三个是**询问**之后才创建，而不再总是创建：** 已经有待处理提议或已在项目中活动的目标不会再收到一个，这不是失败。

- **位置：** `apps/engine/lib/engine/gates/secops_agent_server.ex:55`
  （`@appsec_handoff_targets`）、`:362`（`criar_handoffs_appsec/3`）
- **测试：** `apps/engine/test/engine/gates/secops_agent_server_test.exs`
  （"run_design: threat model concluído emite artifact.threat_model e cria
  os TRÊS handoffs"）
- **来源：** [ADR 0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md)

---

## 仪表盘上的“N 个智能体在线”——**实时**状态，从不是历史在场（RN-409，ADR 0097）

### RN-414 — `rag_search`：智能体获得了产品从未暴露过的工具 {#rn-414}

在这次交付之前，`grep -rn "rag" apps/engine/lib` 的结果是**零**——完整的 RAG（pgvector、混合检索）只被 web 的“Chat RAG”标签页消费。新工具 `rag_search`
（`apps/engine/lib/engine/harness/tools/rag_search.ex`，类别
`:direct`，读取不是外部效果）调用 `POST /internal/rag/search`
——一个**复用** `HybridSearchUseCase` 而不复制检索逻辑的新路由——并返回带引用（`path` + 片段）格式化的命中结果，当 embedding 不可用时，总是在文本**开头**可见地标出 `degraded: true`（从不被上限截断藏起来）。

自有上限，遵循 RN-150 的精神：`top_k` 在工具内部被限制为 10（不信任 api 会接受什么），格式化文本上限 16 KiB（小于 `search_workspace`/`read_file` 的 32 KiB——每个 RAG 命中本身已是完整的分块 + 摘录）。网络故障变成模型可读的错误，从不让 `ToolLoop` 崩溃（RN-163）。

注册在 `Engine.Harness.Tools`（PO/Arquiteto/对话型）和
`Engine.Dev.Tools`（dev agent）中；也扩展到已经引用索引过的 ADR/约定的读取型 gate（QA-automação、QA-estratégia、AppSec、
QA-performance/segurança）——不扩展到 `Infra.WorkflowsAgent`，也不扩展到 Psicólogo/Anamnese，它们推理的是事件日志，而不是项目的文档/代码。

- **位置：** `apps/engine/lib/engine/harness/tools/rag_search.ex`；
  `apps/engine/lib/engine/sessions/engine_api_client.ex`（`rag_search/4`）；
  `apps/api/src/interfaces/http/internal/internal-rag.controller.ts`
- **测试：** `rag_search_test.exs`（带引用格式化的命中；可见的降级；网络故障不崩溃；字节上限截断并有清晰标记；`top_k` 的限制）；`engine_api_client_rag_test.exs`
- **来源：** 见 [ADR 0100](../adr/0100-rag-search-e-modelos-garantidos-no-boot.md)

---

### RN-417 — Psicólogo 和 Anamnese 按相关性查询，并声明降级为按新近度 {#rn-417}

`Psychologist.ContextBuilder`/`Anamnese.ContextBuilder` 继续读取它们一贯读取的内容（近期事件/时间窗口），并获得**第二个**来源 `EngineApiClient.rag_search/4`，其查询由分析的**触发条件**推导——在 Psicólogo 中是已经分类的终止原因；在 Anamnese 中是目录中尚无 `current_profile` 的能力（**从不**是假设/理由的自由文本，依据早已确立的禁令：Anamnese 永远不推断健康/性格/年龄/性别——查询只包含能力/成员/项目的名称）。命中进入 `Triage` **现有**的预算（`max_prompt_events`/`max_payload_chars`）——从近期窗口中扣除名额，从不在其之外额外相加。

对 RAG 的调用严格是**附加**的：没有命中（RAG 不可用、出错，或只是没有结果）时，行为与这条 RN 之前**完全相同**——没有任何既有测试需要修改。`degraded: true`
（RAG 因缺少 embedding 降为仅词法）在两个智能体的最终上下文中都**明确**出现——从不被上限截断藏起来。

Psicólogo（`psychologist-kickoff`）和 Anamnese
（`anamnese-kickoff`）的启动在 `graph_templates_enabled?` 开启时（`GRAPH_TEMPLATES_ENABLED`，默认 `false`）解析为图中的**模板**
（`EngineApiClient.get_prompt_template/2`）——在任何失败（api 宕机、模板未播种、开关关闭）时必须回退到内联文本。`:pinned => true` 在两条路径中保持不变。

同一开关的**第三个**消费者是 `ContextManager` 的摘要提示词（`context-manager-summarize`，[RN-413](infra.md#rn-413) 那批中的第四个也是最后一个模板——它是唯一仍没有消费者的，这个缺口由
[ADR 0101](../adr/0101-memoria-relacional-como-projecao-do-event-log.md)
声明为开放，在此关闭）。标准逐字节相同：开关开启时尝试模板，并用内联路径已经组装的**同一个** `<role>:
<content>` 正文替换 `{{turnos}}`；任何不是带非空二进制正文的 `{"body" => corpo}` 的结果都落回内联——**没有**错误，也**没有**错误日志，因为开关关闭、模板尚未播种和图的 api 宕机是**同一条**降级路径。开关关闭时（默认），api 甚至不会被调用。渲染是**自己的**私有函数，而不是共享的辅助函数：占位符集合属于模板，而不属于机制——三个消费者各有自己的。而**模型**失败时的确定性后备（`"(N turnos anteriores
omitidos)"`）是另一回事，**不**经过任何模板：它是代码行为，不是提示词文本，模板自己的 `.md` 也声明了这一点。

> **自 [RN-621](#rn-621) 起**，摘要提示词在两条路径中都要求每一轮保持原始语言，引用和代码不翻译；版本化模板已升至版本 `"2"`。

**对图其余部分的消费（`query_user_context`——直接从 Neo4j 读取带证据的假设和画像）被**声明**为不在这次交付中**：api 一侧尚没有暴露的 HTTP 路由；如今 Psicólogo/Anamnese 只通过 `rag_search` 查询 RAG（pgvector），而不查询关系图本身。

- **位置：** `apps/engine/lib/engine/psychologist/context_builder.ex`、
  `apps/engine/lib/engine/workers/psychologist_worker.ex`；
  `apps/engine/lib/engine/anamnese/context_builder.ex`、
  `apps/engine/lib/engine/workers/anamnese_worker.ex`；
  `apps/engine/lib/engine/harness/context_manager.ex`（`prompt/1`、
  `render_template/2`、`prompt_inline/1`）
- **测试：** 两个智能体的 `context_builder_test.exs`（存在命中；RAG 失败时无错误降级；`degraded: true` 可见；`top_k` 的限制；由触发条件推导的查询）；`psychologist_worker_test.exs`/
  `anamnese_worker_test.exs`（模板成功和回退；两条路径中 `:pinned` 相同；开关关闭时从不调用 api）；
  `context_manager_test.exs`（`{{turnos}}` 被替换的模板；`{:error, :not_found}` 落回内联，压缩正常结束；开关关闭时从不调用 `get_prompt_template`）
- **来源：** 见 [ADR 0101](../adr/0101-memoria-relacional-como-projecao-do-event-log.md)

---

### RN-419 — 本地 runner 通过一次性 ticket 认证，范围限定于项目和角色 {#rn-419}

**由 [RN-421](api.md#rn-421)（ADR 0104）修订**：下面引用的 ticket 拒绝条件（`workspaceMode !== 'local'`）变成了 `executionMode
!== 'runner'`——同一标准，新名称。本条目的其余部分照旧有效。

`terminal:<projectId>` 频道（新的 Phoenix socket，`/runner`）接收两种不同的角色——`:runner`（用户机器上的 CLI，每个项目最多**一个**，由
`:global.register_name/3` 保证独占）和 `:web`（终端标签页，可多个同时存在）——两者都通过**一次性 ticket** 认证进入，与 RN-108（会话 socket 的 ticket）的安全模式相同，但所有权反转：ticket 由 **ENGINE 签发**
（`runner_socket_tickets`，schema `"engine"`，自己的 Ecto 迁移——不是对属于 api 的会话 ticket 表的扩展），而 API 通过新的内部 HTTP 路由（`POST /internal/projects/:projectId/runner-tickets`）请求它——与会话 ticket 的流程相反，在那里 api 直接写入自己的表。

`POST /projects/:projectId/runner-ticket`（角色 `developer`+，若
`workspaceMode !== 'local'` 则拒绝）和 `POST /projects/:projectId/terminal-ticket`
（角色 `viewer`+，任何模式）是为正确的客户端签发 ticket 的两个公开路由——runner 请求第一个，web 请求第二个。ticket 在频道的 `join` 时被消费（校验 + 一次性的条件 `UPDATE`）；**其他**项目的或重复使用的 ticket 永远不会打开该主题。

- **位置：** `apps/engine/lib/engine/runners/socket_ticket.ex`、
  `apps/engine/lib/engine/runners/registry.ex`、
  `apps/engine/lib/engine_web/channels/{runner_socket,terminal_channel}.ex`；
  `apps/api/src/interfaces/http/runner/runner-tickets.controller.ts`、
  `apps/api/src/application/use-cases/runner/request-runner-ticket.use-case.ts`
- **测试：** `runner_socket_test.exs`/`terminal_channel_test.exs`（带有效 ticket 的 join 成功；重复使用的 ticket 被拒绝；其他项目的 ticket 不会打开错误的主题；同一项目的第二个 `:runner` 被拒绝；第一个掉线后第二个 runner 可以连接）；`request-runner-ticket.use-case.spec.ts`/
  `runner-tickets.controller.spec.ts`（runner ticket 对非 `local` 项目拒绝；终端 ticket 对任何模式都可用）
- **来源：** 见 [ADR 0103](../adr/0103-runner-local-execucao-na-maquina-do-usuario.md)

---

### RN-420 — 路由到 runner 的智能体命令经过**相同**的审批流水线；PTY 是用户的操作，并被审计 {#rn-420}

**由 [RN-423](runner.md#rn-423)（ADR 0104）修订**：路由条件不再是二元的。`workspace_mode == "local"` 变成了 `execution_mode ==
"runner"` **且** `workspace_verified_at` 非空 **且** runner 已连接——缺少**三者**中的任何一个，命令都会被明确**拒绝**，永远不会落入 `mounted` 的 `System.cmd`/bind-mount（对于 `runner` 项目它不存在，根本没有 bind-mount）。本条目的其余部分——一贯的审批流水线、PTY 作为用户操作——照旧有效。

`Engine.Actions.TerminalExecutor` 在正常流水线（`decide()`/`proposed_action`）已经批准**之后**，才决定把命令路由到 runner（而不是一贯的、在容器内的 `System.cmd`）——路由只是为同一个已授权命令选择**目的地**，从来不是绕开策略的第二条执行路径（策略中 RN-418 的绝对上限照样有效，包括 sudo/git）。路由条件（历史，见上面的修订）：`workspace_mode == "local"` 且 runner 已连接（`Engine.Runners.Registry.connected?/1`）——两者缺一，就继续一贯的行为（通过 bind-mount 在容器中执行 `System.cmd`，ADR 0072 变成**后备**，从不移除）。

交互式 PTY 是**不同**的：它是经过认证的**用户**在自己机器的终端中输入的操作，而不是智能体的——因此它**不**经过
`proposed_action`。但它需要留下痕迹：来自 web 的 `pty_open`/`pty_close` 在事件日志中发出 `terminal.session.started`/`terminal.session.ended`（发往项目最近的会话，`ProjectSession.latest_id/1`，与 Anamnese 已经用来叙述项目范围内事情的机制相同）。整合时的真实发现：没有已连接的 runner 时，web 需要返回一个**显式**的 `pty_error`——只在服务器上记一条日志就丢弃请求，会让标签页永远卡在“加载中”，永远到不了屏幕早已知道如何显示的“没有 runner”状态。

- **位置：** `apps/engine/lib/engine/actions/terminal_executor.ex`、
  `apps/engine/lib/engine/runners/runner_router.ex`、
  `apps/engine/lib/engine_web/channels/terminal_channel.ex`
- **测试：** `terminal_executor_test.exs`（在 `local` 模式 + runner 已连接时路由到 runner；`cwd` 向下传递；没有已连接 runner 时落入当前路径；在 `container` 模式下从不路由）；
  `terminal_channel_test.exs`（没有已连接 runner 时 `pty_open` 向 web 返回 `pty_error`，从不没有回应）
- **来源：** 见 [ADR 0103](../adr/0103-runner-local-execucao-na-maquina-do-usuario.md)

## Runner 的文件夹浏览器变成三列，`runner` 项目的创建不再等待最后一步（RN-436/436）

### RN-454 — Insights 标签页在用户撞上 503 **之前**就知道 Psicólogo 已暂停 {#rn-454}

通过**使用**发现：零个假设时，Insights 标签页显示“Sem hipóteses
ainda — o Psicólogo analisa cada sessão encerrada”，即使在
`PSYCHOLOGIST_ENABLED=false` 时也是如此——与 Psicólogo **活动**但只是还没运行时出现的是同一句话。两种情况从文本上无法区分，这与 RN-088/RN-107 已为其他屏幕关闭的缺陷同类：一个存在且产品知道、却没有显示的状态。

[RN-117](#rn-117) 早已涵盖暂停的发现，但只在点击“重新分析”时（503 → `PsychologistDisabledError`）——而这个按钮只存在于分析条中，后者只在 `runs.length > 0` 时出现。一个没有任何假设的会话永远不会接近它，所以暂停恰恰在空屏幕上不可见。

`GET /internal/psychologist/status`（engine，`PsychologistCommandController.status/2`）
是对 `PsychologistWorker.enabled?/0` 的纯读取——**没有**副作用，不同于启用时会创建任务的 `/reanalyze`。api 在其之上暴露
`GET /projects/:projectId/psychologist/status`（`GetPsychologistStatusUseCase`，
`role:viewer`）——URL 中带项目只是为了与兄弟路由（`hypotheses`、`psychologist/analyses`）保持一致；标志本身是**全局**的，正如 RN-117 已记录的。`ProjectInsightsTab.tsx` 消费这一读取（`usePsychologistStatus`），并据此选择空状态的句子：暂停时显示“O Psicólogo está pausado — nenhuma sessão é analisada até ser
reativado”（`insights.projectInsightsTab.emptyPaused`）；否则保留原句，当功能确实活动时它**是**诚实的。持久提示（`pausedNotice`）和“重新分析”按钮也改为反映这一主动读取，而不只是由 503 发现的 `useState`——后者作为加强仍然存在，用于标志在状态读取和点击之间**飞行中**改变的罕见情况。

- **位置：** `apps/engine/lib/engine_web/controllers/psychologist_command_controller.ex`
  （`status/2`）、`apps/engine/lib/engine_web/router.ex`
  （`GET /internal/psychologist/status`）、
  `apps/api/src/application/ports/api-to-engine-client.port.ts`
  （`getPsychologistStatus`）、
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`、
  `apps/api/src/application/use-cases/execution/get-psychologist-status.use-case.ts`、
  `apps/api/src/interfaces/http/psychologist/psychologist.controller.ts`
  （`status`）、`apps/web/src/lib/api-client.ts`（`getPsychologistStatus`）、
  `apps/web/src/lib/hooks.ts`（`usePsychologistStatus`）、
  `apps/web/src/routes/ProjectInsightsTab.tsx`
- **测试：**
  `apps/engine/test/engine_web/controllers/psychologist_command_controller_test.exs`
  （`status/2`，`enabled: true`/`false`）、
  `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts`
  （`getPsychologistStatus`）、
  `apps/api/test/application/use-cases/execution/get-psychologist-status.use-case.spec.ts`、
  `apps/web/src/routes/ProjectInsightsTab.test.tsx`
- **边界情况：** 标志仍然是**全局**的（见 RN-117）——api 路由在 URL 中接受
  `projectId` 只是为了与控制器的兄弟路由模式一致，而不是因为响应按项目变化。
- **来源：** 在 `PSYCHOLOGIST_ENABLED=false` 下浏览 Insights 标签页时通过真实**使用**发现，而不是按脚本。没有 ADR——RN-117 已有读取机制的点状扩展，与 RN-088/
  RN-107 对产品其余部分采用的模式相同。

---

## 附加的本地文件夹成为 RAG 索引的第四个范围，由**浏览器**读取（RN-455..457，ADR 0113）

### RN-459 — 在六个对话型智能体中的四个里，迭代上限不再静默结束 {#rn-459}

在调查轮次活动条（RN-460）期间发现：
`arquiteto_server.ex`、`dev_lead_server.ex`、`ux_designer_server.ex` 和
`staff_server.ex` 在迭代上限溢出时**静默**结束
（`defp run_turn(state, remaining) when remaining <= 0, do: state`，没有任何事件）——违反了“智能体循环不静默结束”这一永久规则。只有 PO 已经发出 `toolloop.limit_reached`
（RN-166）；Criativo 有意以 `agent.error` 分道扬镳（`reason:
"limite_de_iteracoes"`，决定记录在代码本身中——复用 `ToolLoop` 的名称会对谁产生了该事件撒谎），没有被改动。修正后的四个在返回之前改为发出 `toolloop.limit_reached`（与 PO 相同的事件，相同的 payload `iteration`/`max_iterations`）——每个的 `dispatch_tool` 结构都没有任何变化。

- **位置：** `apps/engine/lib/engine/agents/arquiteto_server.ex:195`、
  `dev_lead_server.ex:244`、`ux_designer_server.ex:121`、
  `staff_server.ex:113`
- **测试：** `apps/engine/test/engine/agents/{arquiteto,dev_lead,
  ux_designer,staff}_server_test.exs`（"teto de iterações emite
  toolloop.limit_reached"）
- **来源：** 在实现 RN-460 期间完整阅读六个 server 时发现；范围依产品负责人的决定扩展

## RAG 检索留下痕迹，痕迹冻结权重（RN-479..481）

### RN-492 — 当存在真实容器时，dev agent 的终端命令在其**内部**运行 {#rn-492}

`Engine.Actions.TerminalExecutor.decisao_de_execucao/1` 获得**第五个**出口
（`:executar_no_container`）：`execution_mode: container` 的项目在 `project_containers` 中有一行**记录**为 `running`
（`Engine.Containers.ProjectContainerLifecycle.running?/1`，对该表的直接只读读取，与 `Engine.Projects.Project` 相同的模式）。在这条规则之前，即使有一个容器在运行（RN-491），**所有**终端命令都通过 engine 进程中的 `System.cmd` 针对共享文件夹运行——容器闲置着。

命令穿过 engine → api → broker
（`POST internal/projects/:projectId/container-exec`、
`ExecutarComandoNoContainerUseCase`、`ContainerBrokerPort.exec`），通过
`docker exec` 运行。`cwd` 存在时，会从**宿主机**路径（在 `PROJECT_WORKSPACES_ROOT` 内）**转换**到 `/work` 内——容器唯一能看到的目录——把前缀 `<project_workspaces_root>/
<workspace_dir_name>` 替换为 `/work` 并保留后缀（包括单个 dev agent 的工作树 `.worktrees/<agent_id>`）。工作树本身的位置和创建机制都不变：`Workspace.ensure!/4`
继续写入 broker 挂载到 `/work` 的**同一个**物理目录（在代码中验证：broker 的 `raizDoProjeto` 和 engine 的 `PROJECT_WORKSPACES_ROOT` 经由 `workspace_dir_name`（RN-109）解析到同一个文件夹）——容器只是它的又一个观察者。

**记录的 `running` 从不确认容器此刻**真的**在运行（RN-486）。** 如果它在记录与这次调用之间死掉或被外部移除，`broker.exec` 会失败并变成**普通**的 `failed_result`——exit_code
`nil`，消息点名原因——从不崩溃，也从不静默回退到容器之外的 `System.cmd`（那会重新打开这条规则要关闭的隔离漏洞）。`mounted` 从不落入这个出口：broker 拒绝为该模式启动容器
（`ModoDeExecucaoNaoSuportadoError`）。

- **位置：** `apps/engine/lib/engine/actions/terminal_executor.ex`
  （`decisao_de_execucao/1`、`run_no_container/4`、`cwd_para_container/2`）、
  `apps/engine/lib/engine/containers/project_container_lifecycle.ex`、
  `apps/engine/lib/engine/sessions/engine_api_client.ex`
  （`executar_comando_no_container/4`）、
  `apps/api/src/interfaces/http/internal/internal-projects.controller.ts`
  （`POST :projectId/container-exec`）、
  `apps/api/src/application/use-cases/containers/executar-comando-no-container.use-case.ts`、
  `apps/api/src/application/ports/container-broker.port.ts`（`exec`、
  `timeoutMs`）
- **测试：** `apps/engine/test/engine/actions/terminal_executor_test.exs`
  （`decisao_de_execucao/1` 的五个出口；在根目录和工作树中的 `cwd` 转换；`sucesso: false` 和传输失败变成 `failed_result`；没有 `running` 行/处于 `stopped` 的容器落入一贯的路径）、
  `apps/api/test/application/use-cases/containers/executar-comando-no-container.use-case.spec.ts`
  （`BrokerRecusouError`/`BrokerIndisponivelError` 从不传播；其他错误传播）、
  `apps/api/test/infrastructure/http-clients/container-broker.client.spec.ts`
- **ADR：** [0130](../adr/0130-broker-de-container.md)、[0134](../adr/0134-dev-agents-executam-dentro-do-container.md)
- **来源：** 产品负责人的计划，第 1 部分 / PR 1.6

### RN-502 — dev agent 只在容器 `running` 时认领任务，终端不再落到容器之外 {#rn-502}

同一条规则的两半：**没有执行环境，dev agent 不开始**，以及**没有执行环境，命令在任何地方都不运行**。

**认领的守卫。** `Engine.Dev.AgentIo.try_claim/2`——认领的**唯一**位置——在调用 `claim_task/1` **之前**查询
`Engine.Containers.ProjectContainerLifecycle.running?/1`。在 `project_containers` 中没有**记录**为 `running` 的行时（[RN-243](api.md#rn-243)/ADR 0081），智能体落入 `:idle`，持久化，发出 `dev.blocked_by_container`，并且**不调用 api**。守卫有意放在认领之前：认领后立刻归还，会让任务被标记却没有活着的主人，而这正是 `block_task/4` 存在要防止产生的状态。

**是 `:idle`，而不是新状态。** 它是唯一一个仍能被唤醒救回的状态——`handle_info/2` 的守卫都与它匹配（`{:wake, :became_claimable}` 要求 `:idle`，`:rearm` 要求 `:idle_tripped`，`gate_resolved` 要求 `task_id` 一致，[RN-047](#rn-047)）。编造一个 `:blocked_by_container` 会是一个没有任何东西能救回的状态。

**在 ENGINE 中而不只在 api 的 `activate-execution` 中**，因为认领有一条任何路由都不覆盖的路径：**重新水合**。`Engine.Dev.DevRehydrator` 不做 cast `:work`；重启后进行认领的是 `DevAgentServer.init/1`
→ `finish_restart_recovery/1` → `try_claim/2`。只在 HTTP 边界设 gate，会让每个重新水合的智能体在没有容器的情况下重新开始工作。

**唤醒。** 读取不会通知任何人：一个已经停下的智能体会继续停着，直到某个不相关的事件碰巧经过。所以到达 `running` 时会**发布**——`RegistrarTransicaoDeContainerUseCase` 在**同一个**事务中写入行和事件，`aggregateType: 'container'`（`Engine.Outbox.Drain` 开始排空的第三个聚合，与 `session` 和 `task` 并列），`aggregateId` = **项目**。`Engine.Workers.DevAgentWakeWorker` 把 `{:wake, :became_claimable}` 投递给项目的**所有**智能体
（`DevAgentState.list_by_project/1`——容器属于项目，而不是某个模块）。这是早已存在的**同一条**消息，而不是新消息：它的语义本就是“现在可能有工作了”，而自己的消息会需要在两个 server 中增加带有与现有完全相同守卫的新 `handle_info/2` 子句。只有 `running` 发布；`provisioning`/`stopped`/`failed`/`removed` 不放出任何人。

**第二半：终端。** `Engine.Actions.TerminalExecutor` 过去会静默降级——没有 `running` 容器的 `container` 落入 `:caminho_de_sempre`，也就是在 engine 进程**内部**执行 `System.cmd`，而这个进程同时与数据库、api 以及所有其他项目交互。ADR
0134（[RN-492](#rn-492)）只在正常路径上关闭了隔离。现在它会拒绝（`:recusar_container_ausente`），与 `runner` 模式早已有的 `:recusar_nao_verificado`/`:recusar_runner_desconectado` 相对应（[RN-423](runner.md#rn-423)），作为普通的 `failed_result`——从不崩溃。`mounted` 进入**同一个**分支：有 `running` 容器时与 `container` 一样穿过到 broker；没有时拒绝。兜底的 `:caminho_de_sempre` 缩小为它本该单独承担的情况——**不存在的项目或格式错误的 `project_id`**。没有任何执行模式会落入其中。

**声明的后果：** 没有运行中容器的项目会停止工作，并说出原因。这是有意的——这正是规则存在要做的——也正因为如此，它只能在给 `mounted` 模式提供容器的变更**之后**进入。

- **位置：** `apps/engine/lib/engine/dev/agent_io.ex`（`try_claim/2`）、
  `apps/engine/lib/engine/actions/terminal_executor.ex`
  （`decisao_de_execucao/1`）、
  `apps/engine/lib/engine/outbox/drain.ex`、
  `apps/engine/lib/engine/workers/dev_agent_wake_worker.ex`、
  `apps/api/src/application/use-cases/containers/registrar-transicao-de-container.use-case.ts`
- **测试：** `apps/engine/test/engine/dev/claim_com_container_test.exs`——
  没有容器时初始的 `:work` 落入 `:idle`，持久化，发出事件，并且**不**调用 api；Noop 经过同一个守卫；**重新水合**的智能体停在 `:idle` 而不认领；outbox 中的 `container.running` 走过 drain → worker → wake → 智能体，智能体重新认领；容器 `running` 时一贯的路径保持完好。
  `apps/engine/test/engine/actions/terminal_executor_test.exs`——对 `container`（没有行以及 `stopped`）和 `mounted` 拒绝；`running` 的 `mounted` 穿过到 broker；只有不存在的项目落入
  `:caminho_de_sempre`。
  `apps/api/test/application/use-cases/containers/ciclo-de-vida-do-container.use-case.spec.ts`
  ——`running` 在 `container` 聚合中发布 `container.running`；其他目标状态和行的创建都不发布任何东西
- **ADR：** [0143](../adr/0143-agentes-de-dev-so-depois-do-container.md)
- **来源：** “Nome e local na mesma tela, e container antes dos dev
  agents”计划（PR 7）——`exp001` 的十个任务一下子全部卡住，因为没有任何东西让容器排在 dev agent 之前

---

## 对话型智能体的决策制品（RN-505）

### RN-505 — `decision_record` 复用 `emit_artifact` 的**通用**模式，而不是专用模式 {#rn-505}

在对话中做出相关决定（为什么选 X 而不选 Y、考虑了什么、接受了失去什么）的对话型智能体，用 `emit_artifact` 和 `type: decision_record` 记录它——payload 带 `context`、
`options`（列表）、`choice` 和 `consequences`，这四个键在 `Engine.Harness.ArtifactSchemas`（`artifact_schemas.ex:82`）中是必需的，自进入 `@tool_emittable`（`artifact_schemas.ex:98`）起可由工具发出。**有意不做交叉校验：** `choice` 不需要与 `options` 中的某一项一致——自由文本更健壮，通用 schema 只校验键是否存在（与 `note`/`business_rule` 的标准相同）。

**为什么复用**通用**模式而不是专用模式。** `artifact.project_image`
和 `artifact.c4_diagram`（与本条相邻的 RN）是**版本化**制品——每次发出都会取代前一次成为“当前”，在 api 中有自己的 HTTP 读取路由和专用的 TypeScript schema。决定不是这样：它天然是只追加的记录，而不是会被取代的“当前”——与 `note`/`business_rule` 已经适用的推理相同。为一个只需要存在并能在会话事件日志中被检索的日志付出专用模式的代价（TS schema、版本化、新路由），会耗费决定并不需要的结构。

**与 `open_adr_pr`（只有 Arquiteto 有）的声明区分。** 两者**共存**，目的不同：`decision_record` 用于六个对话型智能体中任何一个的**每个**相关决定，没有任何摩擦——从不提交文件，从不打开 PR，从不等待人工批准。`open_adr_pr` 用于决定大到值得成为 `docs/adr/*.md` 中真正的**文档**时，带真正的 PR 和必需的人工批准。一个项目在一个会话中可以有十个 `decision_record` 而零个 ADR——后者不是前者的“严肃”版本，而是用于另一种决策规模的另一种工具。

**在尚无 `emit_artifact` 的五个对话型智能体中接线**——PO（`po_server.ex:115`）、Arquiteto（`arquiteto_server.ex:103`）、Dev Lead
（`dev_lead_server.ex:153`）、UX Designer（`ux_designer_server.ex:94`）和 Staff
（`staff_server.ex:94`）；Criativo 自第 3b 阶段起就有该工具，只是获得了新类型（决定的是共享的 `known/0`，`CriativoServer` 没有改动）。在每一个中，通用的 `run_tool/3` 获得了子句
`"emit_artifact" -> EmitArtifact.run/2`（例如 `po_server.ex:279`）——**没有特殊处理**：不同于 Dev Lead 中的 `propose_execution_plan`/
`assess_implementability`（它们挂起轮次等待批准，ADR 0086），`emit_artifact` 从不返回 `{:pending, _}`，因此进入通用分派，不需要那两个工具所要求的 `reduce_while`。五者在 `system_prompt/1` 中获得了**同一句**话（例如 `po_server.ex:463`），解释何时使用 `type: decision_record`——放在身份文本（`Engine.Harness.Agents`）之外，因为它不关乎智能体**是谁**，而是关于一个工具的操作指令。

**范围之外，已声明。** 执行型智能体（QA、SecOps、模块 Dev Agent）运行在 `ToolLoop` 上，没有六个对话型智能体共用的 harness——它们不在这一切片中，扩展之前需要逐模块单独调查。与同一计划第 1 战线的衔接（Infra Lead 的分派在经由 runner 提议启动容器时发出一个服务端发出的 `decision_record`）也不在范围内：它依赖于另一个 PR 正在并行创建的工具（`propose_container_start_via_runner`）——见这次变更 PR 中的 TODO。

- **位置：** `apps/engine/lib/engine/harness/artifact_schemas.ex`（schema +
  `@tool_emittable`）；`apps/engine/lib/engine/agents/po_server.ex`、
  `arquiteto_server.ex`、`dev_lead_server.ex`、`ux_designer_server.ex`、
  `staff_server.ex`（alias + `tool_specs` + `run_tool/3` +
  `system_prompt/1`）
- **测试：** `apps/engine/test/engine/harness/artifact_schemas_test.exs`
  （`describe("decision_record …")`）；
  `apps/engine/test/engine/agents/po_server_test.exs` 和
  `arquiteto_server_test.exs`
  （`describe("Frente 3 do plano de decision_record — emit_artifact")`）
- **来源：** 产品负责人的计划，第 3 战线（“Artefato de decisão”）

---

## 本地智能体的 `join` 不再沉默（RN-514）

### RN-514 — runner 在 `join` 中「声明」自己会做什么，服务器在 `socket.assigns` 中「授予」交集，缺少能力的消息被「拒绝」而不是消失 {#rn-514}

在此之前，频道 `terminal:<projectId>` 的 `join` **两边都是沉默的**：
runner 发送 `socket.channel(\`terminal:${projectId}\`, {})`，服务器则字面意义上忽略它们（`def join("terminal:" <> project_id, _params,
socket)`）。全部身份都来自票据——角色（`:runner`/`:web`）取自 `kind`——，服务器**无从得知**另一端的二进制是否属于能理解某条新消息的版本。

这造成的缺陷是最糟糕的一种，也正是本规则要关闭的：消息到达，另一端没有对应的处理器，于是**什么都没发生**——没有错误，没有日志，没有人知道该功能从未运行过。

**三种能力，且只声明 runner 会做的。** 服务器的词汇表是 `exec`（已批准的命令，ADR 0104）、`pty`（交互式终端，ADR 0103）和 `espelho`（把工作复制到挂载基目录之外的文件夹）。runner 声明 **`exec` 和 `pty`**，`espelho` **有意**不在其中：声明未实现的东西，恰恰是协商机制要防止的缺陷——服务器会授予、会投递消息，而消息照样会消失。`espelho` 只作为**词汇表中的名字**诞生，没有任何行为；实现它的是 FASE 28 的第 6 次会话。

**没有 params 就是「遗留」，这是事实——不是宽容。** 本次变更之前的每个二进制都发送空 params，而本次变更之前的每个二进制都会做 `exec` 和 `pty`：这是 runner 诞生时就有的两个功能。给什么都不声明的一方授予 `{exec, pty}`，就是正确解读那个二进制唯一可能说出的话。反过来做会让**所有已安装的 runner 都无法再连接**，这是要求运维在部署前采取行动的变更——按仓库约定属于 `breaking/` 和 MAJOR，而本次交付不是这种性质。缺少 params、缺少 `capacidades`、**空**列表以及不是列表的值，全部落入遗留：这些都是「此二进制不会声明任何东西」在网络路径上呈现的形式。

**未知的被「忽略」，绝不成为拒绝的理由。** 授予的集合是所声明内容与**本**服务器所知词汇表的交集——比 engine 更**新**的 runner 必须能够连接。而**只**声明未知名字，则是空声明，不是遗留：会声明的一方已经说了它会做什么。

**每种模式「要求」什么。** `runner` 要求 `exec`——这正是让该模式运作的东西，没有它，`TerminalExecutor` 会把已批准的命令路由给一个不会执行它的二进制，失败表现为*超时*而不是拒绝。`container` 和 `mounted` 什么都不要求（runner 甚至不是它们的执行路径）。**目前还没有任何东西要求 `espelho`**——拒绝机制在实现并测试后诞生，今天在实践中不会触发。这是设计，不是遗留事项。无法读取的模式（项目不存在、id 格式错误、查询失败）要求**无**：因未确认的前置条件而拒绝，会把「不知道」和「没有」混为一谈（[RN-088](web.md#rn-088)）。

**授予的集合存在于 `socket.assigns`，绝不在表中。** 能力是**那条连接**的属性——表可能会断言某个 runner 知道某件事，而现在连接着的进程并不知道。这与让 `Engine.Runners.Registry` 的 `:global` 条目随 pid 一同消亡的推理相同。只有 `:runner` 角色获得集合：`:web` 套接字**不获得 `:capacidades`**，也不对它进行任何能力检查——标签页不执行任何东西，它只是请求。

**join 的拒绝会点名缺少的能力。** `{:error, %{reason: ...}}` 说明项目要求哪项能力，以及二进制需要更新。该拒绝在 **runner 一侧是致命的**，不重试（`JoinRecusadoError`，这是已有且未改变的行为）——因此它是唯一的解释机会，只说「被拒绝」而不点名缺什么，就只能让人去猜。检查发生在 `Registry.register/2` **之前**：先注册再拒绝，会让 `Registry` 断言一个并未进入的 runner。

**今天就产生价值的那一半：缺少被授予能力的消息会以点名的回应「拒绝」，绝不被吞掉。** 发给没有 `exec` 的 runner 的 `exec`，会以 runner 本会发送的**同样的 `exec_result` 格式**回应调用方（`exitCode` 126——「找到了，但不可执行」——，原因放在 `output` 中），而不是让 `RunnerRouter` 一直阻塞到 `receive ...
after`、让用户看到*超时*而非原因。发给没有 `pty` 的 runner 的 `pty_*` 不会被转发，发起它的 `:web` 会收到点名的 `pty_error`，通过与 runner 报告 PTY 错误相同的过滤广播——否则标签页会永远停在「加载中」，这正是 `handle_in("pty_open", ...)` 的 `whereis` 已经为「没有 runner」的情况关闭的缺陷。由于遗留具有两项能力，**今天对任何人都没有变化**。

**这不是安全边界。** 能力是**协议**协商；负责授权的仍然是一次性票据（[RN-108](web.md#rn-108)）和 `proposed_action` 流水线。runner 通过声明获得的，是该类型的消息会被**投递**给它，绝不是对任何事情的许可。

- **位置：** `apps/engine/lib/engine/runners/capacidades.ex`（新增——词汇表、遗留、每种模式的要求以及两条消息）；
  `apps/engine/lib/engine_web/channels/terminal_channel.ex:208`
  （`join/3` 开始接收 `params`）、`:215`（`autorizar_por_papel/3`）、
  `:251`（`entrar_como_runner/3`，在 `Registry` 之前授予）、`:305`
  （`exigencias_do_projeto/1`，在 RN-516 让同一查询也回答镜像目标之前它叫 `modo_de_execucao/1`）、`:595`（`handle_info({:dispatch_exec, ...})` 中 `exec` 的闸门）以及 `:762`（`handle_info({:relay, "pty_" <> _, ...})` 中 `pty` 的闸门）；
  `apps/runner/src/channel.ts`（`CAPACIDADES_DO_RUNNER` 以及 `socket.channel/2` 的 params）
- **测试：** `apps/engine/test/engine/runners/capacidades_test.exs`（新增——纯词汇表：遗留、空列表、忽略未知、每种模式的要求，以及没有任何东西要求 `espelho`）；
  `apps/engine/test/engine_web/channels/terminal_channel_test.exs`
  （`describe "capacidades declaradas no join (ADR 0147 ponto 1, RN-514)"`——在 `assigns` 中授予、无 params 的 join、忽略未知、`:web` 无集合、在 `runner` 项目中点名 `exec` 的拒绝，以及两条以回应而非沉默被拒绝的消息）；
  `apps/runner/src/channel.spec.ts`（join params 的「内容」、`espelho` 不在列表中，以及拒绝变成带有可读服务器消息的 `JoinRecusadoError`）
- **ADR：** [0147](../adr/0147-agente-local-com-capacidades.md)，第 1 点
- **来源：** FASE 28，第 5 次会话

---

## 代理的产物变成文件，放在 `docs/` 中（RN-523）

### RN-523 — `docs/` 文件夹是 event log 的「投影」：派生的、按代理划分的，绝不是真相来源 {#rn-523}

代理产生的每个产物都**只存在于 event log 中**——
`apps/engine/lib/engine/harness/tools/emit_artifact.ex:3-5` 字面上说 *"não há tabela de artefatos"*。对「来源」而言这仍然正确，本 RN 不改动这一点。它关闭的是另一个漏洞：这份记忆从未到达任何一个人会打开的地方。在编辑器中打开项目文件夹的人，找不到任何产生代码的推理过程。（**推迟的配置**——创建项目不再创建仓库，git 在给 Dev Lead 的 handoff 接受时诞生——会打开一整段项目连仓库都没有的间隔，使这个文件夹更加必要；它在自己的 PR 中到来，本 RN 不依赖它。）

每个允许类型的 `artifact.*` 事件都变成项目 workspace 内 `docs/<agente>/` 中的一个 Markdown。这是**派生投影**，与 ADR 0101 赋予 Neo4j 图的严格意义相同：来源是事件，文件夹可以整个删除并重建——自 [RN-590](api.md#rn-590) 起通过 `artefatos:reprojetar`——，并且**产品中没有任何东西从它读取**来决定任何事情。

**机制是 `GraphProjector` 的，逐件复制**——自己的轮询器、公开的 `drainOnce()`、防止周期重叠的标志、50 条一批，并且只在成功后才 `markProcessed`。outbox 行是「第三」行，与事件在同一事务中写入，使用「自己的」`aggregate_type`（`artifact_projection`）：`Engine.Outbox.Drain` 只排空 `session`、`task` 和 `container`，争抢 `'session'` 行几乎总会输掉与它的竞争。与图的一处有意差异：`aggregateId` 是**项目**，而不是会话——文件夹属于项目，把它写在那里可以让投影器省去每个产物一次查询。

**列表是「允许」列表。** 新的产物类型诞生时不在投影中，当有人决定它是文档时才进入，而不是自己出现在用户阅读的文件夹里。排除在外的有 `qa_verdict`、`secops_verdict`、`task_blocked` 和 `infra_delegation_files`：它们是「运营」结果，每个 task 一个 gate 裁决会用没人打开的文件塞满 `docs/qa-lead/`，让文件夹失去使它有用的那个属性——一眼就能看完。

**版本化的覆盖；append-only 的带上 `seq`。** 通过取最大 `version` 来读取的四种类型（`module_map`、`module_routing`、`project_image`、`c4_diagram`）总是写同一个文件，文件夹显示当前有效的那个——历史仍完整保存在 event log 中。其余的变成各自的文件，名称中带有事件的 `seq`，**没有它**的话，同类型同标题的两个产物会生成同一个文件，第二个会抹掉第一个：这是这个投影丢失来源中所有信息的唯一方式。

**针对文件系统的两道屏障，第二道并不多余。** 名称来自「模型」写的标题。`slugDeArquivo` 从一个封闭字母表**推导**出名称（没有任何返回路径能让分隔符幸存；什么都不剩时返回 `null`），`FsArtifactFileStore` 在打开之前用 `relative()` 再核对一次。两者回答不同的问题——「我从中推导出什么名称」和「我实际要打开的是什么」——，只信任第一道，就会让写入的安全性依赖于未来任何 slug 改动都绝不放过一个分隔符，而这正是 ADR 0130 原则上拒绝的约束方式。

**投影绝不拖垮来源。** 没有任何 throw 逃出周期：每一项单独失败，被记录日志，并保持 `processed_at IS NULL` 等待下一个周期。与图不同，**这里没有会让整批停下的错误**——写入失败通常属于「单项」，停下整批会阻塞它后面的所有项。从 event log 中消失的事件被标记为已处理，不会永远重试。

**在 `runner` 模式下文件夹改到托管根目录**，与 `permissions.json` 的物理原因相同（[RN-478](api.md#rn-478)）：写入的是 api，在它自己的容器内，而 runner 的频道只传输命令，没有写入内容的原语。已声明的代价：那里的 `docs/` 不在代码旁边。

**写入「不」经过 `proposed_action`**，这不是遗漏：那条流水线是「代理请求行动」的一切外部效果的源头，而这里产物已经发出、已经在 event log 中。让投影经过队列会用例行决定塞满审批——每个产物一个——，侵蚀那道赋予点击意义的上限，而点击针对的是真正具有外部效果的操作。

- **位置：** `apps/api/src/domain/artifacts/artifact-projection-events.ts`（词汇和命名规则，纯函数）；
  `apps/api/src/application/artifact-projection/artifact-projector.ts`（轮询器）；`apps/api/src/application/ports/artifact-file-store.port.ts` 和
  `apps/api/src/infrastructure/filesystem/fs-artifact-file-store.ts`（写入，带第二道屏障）；
  `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  （`pastaDeArtefatosDoProjeto`，`permissionsFilePath` 的姊妹）；
  `apps/api/src/application/use-cases/sessions/append-session-event.use-case.ts`
  （第三行 outbox）
- **测试：** `apps/api/test/domain/artifacts/artifact-projection-events.spec.ts`
  （命名规则、路径穿越以及按 `seq` 的冲突）和
  `apps/api/test/application/artifact-projection/artifact-projector.spec.ts`
  （正常路径、版本化的覆盖，以及降级：失败让行保持未处理、下一个周期重试、一次失败不阻塞整批、消失的事件不会永远重试、重新处理是幂等的）
- **ADR：** [0148](../adr/0148-artefatos-projetados-em-arquivo.md)
- **来源：** 产品负责人的要求——*"criar apenas uma pasta por ora
  chamada docs, onde os artefatos estarão de cada um dos agentes"*

## 设备密钥的吊销不再是盲目的，并能到达活动连接（RN-519..520）

### RN-539 — `assess_implementability` 「并行」触发「设计」阶段的威胁模型，每个 story 只触发一次 {#rn-539}

appsec（`Engine.Gates.SecOpsAgentServer.run_design/2`，[RN-360](#rn-360)）诞生时已实现、已测试，却**没有任何生产调用方**：测试之外唯一提到它的是 `artifact_schemas.ex` 中的一条注释。[RN-360](#rn-360) 本身声明了这个缺口，而 `docs/fluxo.yml`（角色 `appsec`，字段 `acionamento`）早已「点名」缺失的触发器——Dev Lead 的 `assess_implementability`，gate `implementavel`，同一个 [ADR 0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md)。就是它。`run_assessment/2` 开始通过 `Engine.Gates.Dispatcher.run_appsec_design/2` 调用它——behaviour 的第六个回调，`run_qa_estrategia/3` 的结构性「拷贝」，出于与五个邻居相同的原因可在测试中替换（调用方由一个轻量测试覆盖，不使用 Ecto sandbox，不应该为了证明它「请求」了而启动一个真实的 GenServer）。

**并行，意见不等待。** 触发发生在 `run_assessment/2` 的「两个」出口——有测试计划和没有——每个出口的结果都逐字节保持原样。让意见依赖威胁模型，会让 gate `implementavel` 依赖「两个」异步产出而不是一个，并在今天只消耗一个 Dev Lead 回合的地方消耗两个：`:sem_plano` 分支已经返回 `{:error, ...}` 要求模型再次调用（[RN-163](#rn-163)），在它上面再叠一次等待会成倍拉长窗口。威胁模型通过 [RN-361](#rn-361) 已定义的路径到达需要它的人——向 `arquiteto`、`dev-lead` 和 `infra` 的 handoff——绝不通过这个返回值；`:sem_plano` 的消息甚至不提 appsec，因为向模型承诺它在那里不会收到的东西，正是 [RN-163](#rn-163) 所关闭的缺陷。

**自 [RN-674](#rn-674) 起不再有 `:sem_plano`**：意见在第一次调用时就产出，appsec 的触发随提议一起，而历史读取只服务于下面的守卫。appsec 仍然在「设计」阶段——把测试计划从 pre-dev 中拿掉的负责人决定是关于 QA 的。

**每个 story 只触发一次。** 在测试计划不存在时，模型被「指示」再次调用 `assess_implementability`：没有守卫的话，每次重新调用都会让 appsec 多跑一轮 LLM，并在「同一个」story 上多出三个 handoff。`disparar_appsec_se_preciso/3` 只在历史中没有该 `storyId` 的 `artifact.threat_model` 时触发。这里的问题是「是否存在」，不是「哪一个」——与测试计划相反，那里最新的胜出，因为一个 story 可能被重新评估。

event log 的读取每次调用**一次**：两个问题（「已经有测试计划了吗？」「已经有威胁模型了吗？」）在同一个列表上回答。同一次调用中的两个 `list_events/2` 就是 [ADR 0060](../adr/0060-superficie-de-leitura-de-codigo.md) 所拒绝的流量放大器，而这条路径之所以热，正是因为重试。「不可读」的历史不触发任何东西：没有答案不是没有产物的证据，在那里触发会从另一扇门重新打开重复调用。无效参数的子句也不触发——它不知道是哪个 story。

- **位置：** `apps/engine/lib/engine/agents/dev_lead_tools.ex:457`
  （`run_assessment/2`，单次历史读取）和 `:519`
  （`disparar_appsec_se_preciso/3`，幂等守卫）；
  `apps/engine/lib/engine/gates/dispatcher.ex:29`（回调）和 `:86`
  （`Engine.Gates.Dispatcher.Live.run_appsec_design/2`）；
  `apps/engine/test/support/fake_gate_dispatcher.ex:23`
- **测试：** `apps/engine/test/engine/agents/dev_lead_tools_test.exs`，
  describe "assess_implementability dispara o appsec (RN-539)"——没有威胁模型的 story 触发，有威胁模型的 story「不」触发（幂等），另一个 story 的威胁模型不算，`:sem_plano` 的结果不变，意见与触发并行正常提议，无效参数和不可读的历史不触发
- **ADR：** [0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md)
  （它曾把自动触发声明为不在范围内）
- **来源：** `docs/fluxo.yml`，角色 `appsec`。已声明且「未」做：`artifact.threat_model` 在「STORY」的会话中发出（`emit_threat_model/3` 读取 `story["sessionId"]`），而守卫读取的是「DEV LEAD」会话的历史。在常见路径中它们是同一个会话——Dev Lead 评估的是执行会话自己创建的 story。不是的话，守卫看不到威胁模型，appsec 会再运行一次：代价是重复一轮 LLM，绝不是错误的数据（产物是 append-only 的，消费它的是 handoff）。要关闭这一点，需要 api 接受「跨会话」按 story 查找产物，而这目前不存在

## 启用代理的标志必须「到达」进程（RN-540）

### RN-540 — `runtime.exs` 读取的布尔标志在两个 compose 的 `engine` 服务的 `environment:` 中映射，并使用代码的默认值 {#rn-540}

暂停只有在存在开启路径时才是可逆的。Anamnese 和 Psicólogo 的暂停（[RN-115](#rn-115)，[RN-117](#rn-117)）在「三个」地方被声明为可逆——`AnamneseSchedulerWorker.enabled?/0` 的 docblock（"Ligar de
volta é `ANAMNESE_ENABLED=true` e reiniciar o engine"）、`PsychologistWorker.enabled?/0` 的 docblock 以及[配置](../reference/configuration.md)表——而这条路径**在任何环境中都不存在**。

**是测量，不是假设。** 在开发 compose 运行时：

```
$ docker compose … exec -T engine sh -lc \
    'echo "[$START_ANAMNESE] [$ANAMNESE_ENABLED] [$PSYCHOLOGIST_ENABLED]"'
[true] [] []
```

原因在于只有 Compose 才有的那一层：**它不会把宿主机的环境传给容器**。一个变量到达进程，当且仅当它写在该服务的 `environment:`（或某个 `env_file`）中。`engine` 映射了十三个 Anamnese/Psicólogo 变量——全部是成本「上限」（`ANAMNESE_INTERVAL_SECONDS`、`ANAMNESE_BUDGET_MICROS`、
`PSYCHOLOGIST_TRIAGE_THRESHOLD`、…）——却没有映射决定代理是否运行的那两个。`.env` 中的 `ANAMNESE_ENABLED=true` 是无效的：`apps/engine/config/runtime.exs` 落入默认值 `"false"`，两者继续关闭，**悄无声息，没有错误**。

缺陷的可能来源：当代码默认值变成 `false`（2026-08-10）时，没有人需要这个变量来「关闭」。只有试图「开启」的人才会发现这根线不存在——而这个人，按构造，会在几个月后才出现。

**规则。** `runtime.exs` 读取的每个「布尔」标志——形如 `System.get_env("X", "true"|"false") == "true"`——都必须在两个 compose 的 `engine` 服务的 `environment:` 中映射。范围是布尔量，而不是文件中的全部 58 个变量，因为标志恰恰是为了被切换而存在的，而切换通过环境进行：在 compose 中没有一行的标志就是没接线的开关。默认值合理的数值上限（`READ_FILE_MAX_BYTES`）和发布变量（`SECRET_KEY_BASE`、`POOL_SIZE`）理所当然地排除在外，这就是为什么列表从 `runtime.exs`「推导」而不是手工维护。

默认值因文件而异，而差异就是决定：

- 在 `docker/docker-compose.yml`（开发）中，这一行重复「代码」的默认值。开发环境是 docblock 的承诺被兑现的地方，那里的默认值若不同，就会让 compose 在 `runtime.exs` 底下决定产品行为。
- 在 `docker/docker-compose.prod.yml` 中只需映射即可。该文件有意关闭后台代理（`START_ANAMNESE:-false`，而代码中是 `true`），原因写在旁边——要求相等会否决一个有意识的决定。

**这「不」改变任何产品决定。** 两个标志在两个 compose 中的默认值仍然是 `false`：2026-08-10 的暂停逐字节继续有效。新出现的是开关。

**而仅有 `ANAMNESE_ENABLED=true` 是不够的。** `START_ANAMNESE`（「启动」开关，`apps/engine/lib/engine/application.ex:82,106-108`）决定是否调用「安排」周期性 tick 的 `kickoff/0`；`ANAMNESE_ENABLED`（「产品」标志）决定是否可以进行「新」一轮。这是不同的问题，周期性 Anamnese 要求两者都为 `true`。Psicólogo 只有后者——它的自动触发是会话关闭，而不是 tick。

**`deploy/k8s/` 不在范围内，出于决定。** 那里不存在出问题的那一层：Deployment/ConfigMap 不会拦截任何东西，变量写在所有变量都写的地方。`brabo-config` 有「四个」字面量（服务地址和 web 的日志级别），没有 13 个上限中的任何一个，也没有 `START_ANAMNESE`——engine 一致地以代码默认值运行。那里没有需要修复的未接线开关。

- **位置：** `docker/docker-compose.yml:406-425`（四个启动开关和四个产品标志，在各代理的块中）；
  `docker/docker-compose.prod.yml:308-315`；
  `apps/engine/config/runtime.exs:157,158,162,168,185,229,238,264`（八个标志）；`.env.example`（两个问题，并排）
- **测试：** `scripts/ci/flags-do-engine-no-compose.spec.ts`——从 `runtime.exs` 推导标志，并在两个 compose 中任何一个缺失时点名否决，开发环境中与代码默认值不同时也否决。没有 `warn`：真的否决，在 `test-packages` 作业中
- **来源：** 在 engine 容器中直接测量发现，2026-09-08。已声明：例外列表 `FLAGS_FORA_DO_COMPOSE` 诞生时为「空」——它存在是为了让「出于决定而排除」有地方说出来，而不会与「因遗忘而排除」无法区分
---

## 设备密钥获得界面，界面说明吊销的范围（RN-561）

### RN-566 — Infra Lead 在提议之前按「模式」拒绝 `container_start`：RN-494 的缺口在声明它的工具中关闭 {#rn-566}

`propose_container_start` 曾是盲目提议的。`dispatch_container_start/2` 组装 payload 并直接调用 `EngineApiClient.propose_action(...)`——两者之间没有任何项目读取，整个工具中 `execution_mode` 的出现次数为**零**。在 `runner` 项目中，提议只能以失败告终：自 [RN-507](runner.md#rn-507)/[ADR 0145](../adr/0145-docker-pre-requisito-do-runner.md) 起，`container_start` **不服务**这种模式，因为它的 payload 从 Arquiteto 的路由中「选定」一个候选（[ADR 0131](../adr/0131-roteamento-de-modulos-para-infra.md)），而在 `runner` 中没有可以用来选择的路由——那个模式的类型是 [`container_start_via_runner`](api.md#rn-508)。

**尺子不是新的，也没有诞生第二把。** 姊妹工具早已在本地拒绝（[RN-508](api.md#rn-508)），`/containers` 页面早已按「目标」分支（[RN-521](api.md#rn-521)，`acaoDeSubidaDoModo`）：`container` 和 `mounted` 通过 BROKER 启动，`runner` 通过本地代理启动（[ADR 0144](../adr/0144-a-segunda-raiz-do-broker.md)/[RN-503](api.md#rn-503)）。本规则做的是给缺少它的工具「同一把」尺子——一次项目读取（`recusa_local_de_subida/2`，返回 `nil` 或原因）以及每个工具一个「子句」（`recusa_por_modo/3`）。两把平行的尺子会在枚举的第一个新模式上分歧。

**`container_start` 的拒绝是「允许」列表**，与 broker 本身的一样：`container`/`mounted` 通过，`runner` 被拒绝并「点名」姊妹工具，枚举中的新模式诞生时就被拒绝并附消息，而不是因遗漏而被提议。不存在的项目也会被拒绝——两个工具的同一子句。

**拒绝是循环的「输入」**（[RN-163](#rn-163)）：工具「结果」的文字，模型读取它并用来调用正确的工具。绝不是 `agent.error`，绝不是回合结束，绝不是 `proposed_action`——不调用 api。而且**不是沉默**：`tool.call` 的 `emit` 在「两个」工具中都改为在拒绝「之前」发生（在姊妹工具中它原本位于提议的分支内），就像同一模块的通用 `dispatch_tool/2` 那样——在 event log 中没有痕迹的拒绝，就是这次调用从人的时间线上消失。

**读取是「本地」的，这就是决定。** `Project.get/1` 和 `Engine.Runners.Registry.connected?/1` 与 Infra Lead 在「同一个」BEAM 进程中运行；在这里向 api 发 HTTP，会在代理的循环中放入一次网络调用。`CLAUDE.md` 中声明的代价——*"corrigir exigiria tocar o
prompt/instrução do Infra Lead"*——**没有得到证实**：没有改动任何一行提示词，拒绝的文字就是模型作为结果读到的东西。

**本规则「不」关闭的，也是缺口的一半：** 因「缺少镜像」而盲目提议在 `container`/`mounted` 中仍然可能。这里的拒绝是关于「模式」的，要求已决定的镜像会颠倒顺序——选定镜像恰恰是这个提议「所做」的事（[RN-491](web.md#rn-491)）。`/containers` 检查「三」样东西（已决定的镜像、模式、已确认的文件夹），因为有人在点击；代理开始检查「一」样。`GetInfraContextUseCase` 仍然没有 `executionMode`——丰富 Infra Lead 的上下文是另一条战线。`container_stop`/`container_remove` 不在其中：它们由界面提议，绝不由代理（[RN-495](api.md#rn-495)）。

没有任何上限改变：`container_start` 仍然是真正的 `proposed_action`，`maintainer`，从不被播种进自动批准（直到 [RN-671](api.md#rn-671)，它在 Infra 的 handoff 接受时播种它），`container_remove` 仍处于 git push/特权命令的绝对上限（[RN-418](api.md#rn-418)）。

- **代码：** `apps/engine/lib/engine/infra/infra_lead_server.ex:599`（`container_start` 的分派在提议之前查询）、`:902`
  （`recusa_local_de_subida/2`——「唯一」的项目读取）、`:474`（`container_start` 的子句：允许列表）、`:477`（点名 `container_start_via_runner` 的拒绝）、`:492`（姊妹工具的子句，带第二个问题——runner 已连接）、`:409`（`tool.call` 的 `emit` 移到拒绝之前）；
  `apps/engine/lib/engine/infra/tools/propose_container_start.ex`
  （moduledoc——该工具不再盲目提议）
- **测试：** `apps/engine/test/engine/infra/infra_lead_server_test.exs:422`
  （`mounted` 中的正常路径——broker 服务两者）、`:448`（失败用例：`runner` 「点名」拒绝，`propose_action` 从未被调用，`tool.call` 照样被叙述）、`:538`（不存在的项目）、`:380`（`container` 的正常路径，现在需要数据库中的那一行）
- **ADR：** [0144](../adr/0144-a-segunda-raiz-do-broker.md)，
  [0145](../adr/0145-docker-pre-requisito-do-runner.md)
- **来源：** AT-048（EP-020/HS-032）——自 [RN-494](broker.md#rn-494) 起在 `CLAUDE.md` 中声明的缺口

## 安装中的容器 broker，经同意开启（RN-575）

### RN-577 — 当项目没有仓库时，`open_adr_pr` 和 `open_infra_pr` 在提议之前就被代理拒绝 {#rn-577}

在一次真实安装中（AT-088，2026-09-14），一个没有仓库的项目——`project_repositories`、`project_git_connections` 和 `repo_bootstraps` 都为空——收到了 Arquiteto 的三个 `open_adr_pr` 和 Infra Lead 的一个 `open_infra_pr`。人批准了这四个，四个都以 *"Projeto sem
repositório provisionado"* 结束为 `failed`（`ExecuteAdrPrUseCase`、`ExecuteInfraPrUseCase`）。这个人批准了四个只可能失败的操作。

**这不是边界情况，而是常见情况。** 自 [RN-541](web.md#rn-541) 起，创建项目不创建仓库，而仓库的触发器是 Arquiteto 给 Dev Lead 的 handoff 的接受（[RN-522](api.md#rn-522)）。Arquiteto 在这个 handoff 「之前」工作——所以在新项目中，**每一个** `open_adr_pr` 按构造都会失败。

**规则：** 两个工具在提议「之前」询问项目是否有仓库，没有的话就以「点名」的原因「拒绝」——缺什么，以及何时开始存在。`proposed_action` 不会诞生，审批队列不会收到不可能成功的东西。

**模式与 [RN-566](#rn-566) 相同，没有新尺子，不触碰提示词。** 拒绝是工具的结果（[RN-163](#rn-163)），是循环的输入——绝不是 `agent.error`，绝不是回合结束——，模型读到原因后继续回合。

**读取是「本地」的，谓词与执行时的「相同」。** engine 本来就直接从 Postgres 读取 `project_repositories`（`Engine.Projects.ProjectRepository`，`default_branch/1` 和 `remoto_de_trabalho/1` 的消费者），所以代理循环中没有需要测量或辩护的 HTTP：新问题 `recusa_de_pr_sem_repositorio/2` 与两个用例中 `ProvisionedRepositoryRepository.findByProjectId` 所问的「相同」——项目是否有一行。如果两者分歧，工具会放过执行会拒绝的东西，或拒绝执行会接受的东西。两个工具使用「同一个」函数，同样的文字。

**在 Infra Lead 中，问题在 HALT 之前提出。** `propose_infra_pr` 不会立即提议：它中断回合，让 `finalize/3` 运行 `WorkflowsAgent` 并合并为一个 PR。在那之后（在 `abrir_pr/3` 中）才拒绝，会浪费一整个 LLM 循环，并为一个不可能存在的 PR 记录两个 `completed` 委派。拒绝发生在拦截时，回合「继续」。

**两者都有持久的痕迹。** AT-048 发现本地拒绝不会在 event log 中留下痕迹；RN-566 通过在拒绝之前发出 `tool.call` 解决了这个问题，这里同样适用——在 Arquiteto 中 `dispatch_tool/2` 已经发出它；在 Infra Lead 中，对 `propose_infra_pr` 的拦截原本什么都不发出，现在在拒绝分支中发出，带有标题和「路径」（绝不包括文件内容）。「原因」也随之而来：一个带 `ok: false` 和 `erro`（原因）的 `tool.result`——Criativo 已经使用的形式——，因为只有 `tool.call` 只能说明调用存在过，而不能说明它为什么没有变成提议。在提议的路径上什么都不变：它的痕迹仍然是 `proposed_action` 本身。

**执行用例仍像以前一样拒绝**——纵深防御：代理的拒绝是「之前」的一层，绝不取而代之。

**本规则「不」决定的：** 仓库「应该」在哪里诞生。拒绝的文字描述当前的触发器，而它已经「改变」：AT-092 在 [RN-582](api.md#rn-582)（ADR 0165）中做出了决定——仓库在给 Arquiteto 的 handoff 接受时诞生，在它的第一个回合之前，给 Dev Lead 的接受作为第二道门。文字也随之改变，正如本规则所承诺的：它点名新的触发器，并且由于 Arquiteto 只在这次接受之后工作，它说明拒绝意味着配置「失败」（`repository.provision_failed`）或项目早于本规则，并给出两条出路。它不再是常见情况；拒绝仍然存在，因为这两种情况存在。`open_infra_pr` 在新项目中也会以另一种方式受到影响（Infra Lead 由 Arquiteto 的 handoff 触发，这可能发生在给 Dev Lead 的 handoff 之前）；本规则只让提议不诞生，不重排 handoff 的顺序。

- **代码：** `apps/engine/lib/engine/projects/project_repository.ex:74`
  （`recusa_de_pr_sem_repositorio/2`——谓词和文字，两个工具唯一的）；`apps/engine/lib/engine/harness/tools/propose_adr.ex:54`（提议之前的拒绝）、`:61`（带原因的 `tool.result`）；
  `apps/engine/lib/engine/infra/infra_lead_server.ex:251`（对 `propose_infra_pr` 的拦截在 HALT 之前询问）、`:594`
  （`recusa_de_infra_pr/4`）、`:309`（带路径的 `tool.call`）、`:314`（`tool.result`）
- **测试：** `apps/engine/test/engine/agents/arquiteto_server_test.exs:107`
  （失败用例：没有仓库，`open_adr_pr` 从未被提议，原因作为工具结果，event log 中有 `tool.call` 和 `tool.result`）、`:80`
  （正常路径：有仓库时提议）；
  `apps/engine/test/engine/infra/infra_lead_server_test.exs:491`（失败用例：没有仓库，既没有 `propose_action` 也没有 Workflows 的委派，回合继续，持久的痕迹）、`:89`（正常路径：有仓库时提议合并的 PR）
- **来源：** AT-088——2026-09-14 的真实安装

### RN-578 — 触发代理回合的点击在「接受」时回应，拒绝不再沉默 {#rn-578}

在一次 v6.1.0 的真实安装中（2026-09-14），回答 Criativo 的问题表单花了 **97.3 秒**，确认就绪 **97.3 秒**，确认架构就绪 **51.8 秒**——每次点击都被代理的「整个」回合拖住，因为对话型代理的 `handle_call` 只在回合的 Task 结束时才回应 engine controller 的 `GenServer.call`。超过上限（Criativo 120 秒，其他 180 秒）的回合会在一个本已成功的命令上变成 500。而在回合进行中对第二条消息的拒绝（`{:error, :turno_em_andamento}`）被 controller 丢弃，它回应 202：在 Arquiteto 的 kickoff 期间输入的 *"Continue"* 被接受却从未被读取，没有任何痕迹。

**规则（[ADR 0163](../adr/0163-o-clique-responde-ao-aceitar.md)，它推广了 [ADR 0086](../adr/0086-dev-lead-plano-suspende-para-aprovacao.md)）：**

1. **接受立即发出。** `TurnoAssincrono.iniciar/3` 在 Task 启动后立即向 `from` 回应 `:ok`——在持久化 `agent.status: working` 之后，绝不在之前。这适用于六个对话型代理，适用于触发回合的四个用户路由（`…/agents/:agent/message` 以及经由它的 `…/structured-question/:id/answer`；`…/readiness`；
   `…/agents/arquiteto/handoff-infra`），也适用于 story 的退回（`ReturnStoryUseCase`）。api 的状态码和正文「不」变（`201 { ok: true }`）：它们一直表示「已接受」；改变的是它们何时到达。
2. **回合启动「之前」的拒绝是同步且点名的。** engine 以 `{error, motivo}` 回应 409（`turno_em_andamento`、`aguardando_aprovacao`）或 422（`sem_regra_de_negocio`），api 以「同样」的语句转发「同样」的状态码。`turno_em_andamento` 获得持久的 `agent.error`（来源 `politica`）；另外两个本来就有。
3. **回合的结果经由频道和日志传递，绝不经由 HTTP。** 失败仍是持久的 `agent.error`，来源与以前相同。
4. **界面不再把「调用已返回」当作回合结束。** 接受之后，它通过频道（`agent.done`）跟踪结束，并作为安全网每 4 秒读取一次日志尾部：当该代理最近持久化的 `agent.status` 不是 `working` 时结束。窗口中没有该代理的任何 `agent.status` 时，不结束——不知道不等于「结束了」。
5. **给 Dev Lead 的 handoff 仍然在 Infra 的「之后」诞生。** 在 Arquiteto 的收尾回合进行中到达的 `:offer_dev_handoff` 会保持待处理，并在回合结束时运行——成功、失败、崩溃或取消。*（已被 [RN-672](api.md#rn-672) 取代：Arquiteto 不再向 Dev Lead 提议，这一待处理不复存在。）*

**本规则「不」关闭的：** api 在询问 engine 之前写入的 `chat.message`，在 engine 拒绝时仍留在日志中（现在由 `agent.error` 解释，以前是孤立且沉默的）；在回合中途重启的 engine 不会写入 `idle`，状态条会一直保留，直到「Parar」或重新加载；而通过输入框发给 `infra` 的消息会因 `AgentCommandController.message/2` 的最后一个子句落到 Criativo——这是先前就有的问题，在这里测得，之后由 [RN-584](#rn-584) 关闭，它去掉了默认收件人。

**由 [RN-673](#rn-673) 针对「消息」修订**（ADR 0191）：回合进行中到达的用户消息不再收到 `turno_em_andamento`——它进入代理的队列，在回合结束时被读取。第 2 项的拒绝仍适用于不是发言的命令（审阅、就绪、handoff 提议）。

- **代码：** `apps/engine/lib/engine/agents/turno_assincrono.ex:120`（接受）、`:130` 和 `:314`（持久的拒绝）；
  `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:241`
  （202）、`:243`/`:253`/`:263`（409/409/422）；
  `apps/engine/lib/engine/agents/dev_lead_server.ex:211`；
  `apps/engine/lib/engine/agents/arquiteto_server.ex:160`（推迟）、`:202`
  （排空）；`apps/api/src/infrastructure/http-clients/api-to-engine-client.ts:591`，
  `:612`；`apps/web/src/lib/session-turno.ts:33`（`turnoTerminouNoLog`）、
  `:349`（`acompanharTurnoPeloLog`）、`:316`；
  `apps/web/src/routes/SessionPage.tsx:491`、`:517`、`:578`；
  `apps/web/src/lib/session-promocao.ts:141`；
  `apps/web/src/lib/recusa-do-agente.ts:17`
- **测试：** `apps/engine/test/engine/agents/turno_assincrono_test.exs:66`
  （task 存活时的接受）、`:84`（`working` 在接受之前写入）、`:178`
  （持久的拒绝——失败用例）；
  `apps/engine/test/engine_web/controllers/agent_command_controller_test.exs:35`，
  `:66`（409）、`:107`（422）；
  `apps/engine/test/engine/agents/arquiteto_server_test.exs:209`（handoff 的顺序）、`:237`（取消）；
  `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts:520`，
  `:538`、`:580`（500 仍是通用的）；
  `apps/web/src/routes/SessionPage.turno-preso.test.tsx:181`、`:252`（409）；
  `apps/web/src/routes/SessionPage.readiness-turno-preso.test.tsx:172`、`:210`
  （422）；`apps/web/src/lib/fim-do-turno-pelo-log.test.ts:29`、`:76`
- **来源：** AT-089——2026-09-14 v6.1.0 的真实安装

### RN-579 — 会话频道存活时，会话界面把短轮询换成失效通知加长回退；空正文的回应带 `ETag` {#rn-579}

AT-093 测量的安装（v6.1.0，9月14日）显示「一个」浏览器在 56 分钟内发出 7,088 个请求——中位数 118/分钟，峰值 263/分钟——对照 `RATE_LIMIT_USER` 的 300/分钟。峰值时两个可见的标签页就会超过上限，429 落在账户所有者的浏览器上。几乎全部是会话界面对很少变化的数据每 3–5 秒一次的轮询（操作、handoff 和 backlog 99% 的时间返回 304），而界面早已与 engine 保持着 `session:<id>` 频道的连接。上限「不」变：减少的是请求。

**规则：**

1. **engine 通知每一次已确认的写入。** 外观 `Engine.Sessions.EngineApiClient` 在 api 「确认」`append_event`、`append_event_returning`、`propose_action`（`proposed_action.created`）、`create_handoff`（`handoff.offered`）和 `create_epic/story/task`（`backlog.*_created`）之后发出 `event.appended`（只有 `type` 和 `actorId`，绝不包括 `payload`）。被拒绝的写入不通知。以前只有 `ArtifactEmitter` 和 Infra Lead 手工通知——即使 api 拒绝了追加也会通知。**自 AT-157 起，api 自行进行的写入也会通知**——另一个标签页中人的决定、会话的转换、由 api 自己的模型回复的聊天。`AppendSessionEventUseCase` 和 `SendChatMessageUseCase`（不经过 engine 而写入 `session_events` 的仅有两个点）调用 `SessionChannelNotifier.eventAppended`，它请求 engine 的 `POST /internal/sessions/:id/event-appended`；engine 发出「同样」的 `event.appended`（只有 `type` 和 `actorId`）。通知在最外层事务提交「之后」发出（`DrizzleUnitOfWork` 中的 `aposCommit`）：被回滚的事务不通知，而在事务内部通知会让 web 在事件存在之前就去获取。来自 engine 的写入（`/internal/*` 路由，由 `OrigemEngineMiddleware` 标记）「不」再由 api 通知——外观已经通知过了。这是尽力而为且不被等待的：丢失的通知绝不让写入失败，15 秒的回退会覆盖它。只有这两个点：另一个不经过 `AppendSessionEventUseCase` 而开始写入 `session_events` 的用例，也需要调用 notifier。
2. **「频道存活」是「已确认」的 join。** `connectSessionHeartbeat` 在 join 的 `ok` 时把会话标记为存活，在频道或套接字出错/关闭时以及在清理时取消标记。状态是按会话、按标签页的，位于 React 之外，因为间隔属于每个「观察者」，而三个观察者（Shell、`SessionPage`、`ContextAside`）读取同一个事件键。
3. **频道存活时，轮询变成回退。** 事件、操作、handoff、backlog 以及会话本身从 3–5 秒变为 15 秒；预算从 5 秒变为 30 秒。`intervaloDaSessao` 是 `Math.max`：已经轮询更慢的不会加速。频道断开会「立即」恢复短间隔——界面绝不会比以前更差。
4. **通知的「类型」决定使什么失效，并带窗口。** 每个通知都会使事件和预算失效；`proposed_action.*`/`action.*` 还会使操作失效，`handoff.*` 使 handoff 失效，`backlog.*` 使 backlog 失效。每个目标在两次获取之间都有最小窗口（事件 3 秒，操作/handoff/backlog 2 秒，预算 10 秒）：第一次立即发出，窗口内的后续请求在窗口结束时合并为「一次」。没有这一点，一连串 `tool.result` 会变成每个事件一次获取。发现 C 的规则仍然有效，且只针对「事件」：在流式回合期间它们不会被提前；操作会。
5. **隐藏的标签页不轮询。** `refetchIntervalInBackground: false`（TanStack v5 的默认值，现在写在 `OPCOES_PADRAO_DAS_QUERIES` 中）——由测试测量，而不是假设。
6. **空正文有校验器。** 返回 `null` 的处理器发出的是空正文且「没有」`ETag`（Express 的 `res.send` 只在有正文时生成 `ETag`），所以 304 是不可能的：`sessions/:id/budget` 在测量的 483 次调用中 0% 返回 304，`execution/session` 为 22%（有活动执行的时间）。当 `send` 不带正文发出时，api 写入空正文的 `ETag`——依据发到线路上的东西决定，而不是依据处理器的值，这样一个带 `@Res()`、之后才写入的处理器绝不会继承空值的校验器。304「不」减少速率限制的计数（守卫在处理器之前计数）；它减少的是带宽。
7. **与通过日志尾部跟踪回合（[RN-578](#rn-578)）相组合。** 「已接受」的回合仍然通过每 4 秒读取尾部来跟踪（`acompanharTurnoPeloLog`）——这是防止 `agent.done` 丢失的网，而频道的通知可能与它一起丢失，所以这个节拍「不」变成 15 秒的回退。改变的是：被跟踪代理的 `agent.status` 的 `event.appended` 会「立即」触发读取（`avisoPedeVerificacaoDoTurno`），回合一旦被日志说明已结束就结束，不必等节拍。来自其他代理、其他类型或没有被跟踪回合的通知，不会多读任何东西。而事件的 3 秒轮询在流式期间仍「暂停」（发现 2/7）：`intervaloDaSessao` 只在暂停不适用时才有效，频道的失效通知遵循发现 C 的同一规则。

**数字**（预算测试，会话界面上的一个标签页，每分钟）：频道断开时 **123**（以前的行为，作为回退保持不变），频道存活时 **46**——其中 24 来自 Shell（项目摘要和执行会话，它们不属于会话，仍为 5 秒）。两个标签页：246 → 92。自 [RN-632](web.md#rn-632)（AT-278）起，「项目」的读取以项目节奏（15 秒）轮询，执行者和概览标签页也经过「同一个」`criarInvalidadorDoCanal`——用真实界面和两个标签页的测量住在那里。

**本规则「不」关闭的：** api 自行写入的通知（第 1 项，AT-157）是尽力而为——如果 engine 宕机或通知丢失，界面通过回退到达，最多 15 秒（以前是 3 秒）；通知发给接收调用的 engine 节点，Phoenix PubSub 的广播会把它投递给集群中任何节点上的订阅者（未在集群中测量）。名册的 `working` 状态仍依赖 `agent.status` 的 `event.appended`，它在 api 写入之后发出。`projects-summary` 和 `execution/session`（Shell）仍为 5 秒。在已接受的回合期间，RN-578 的 4 秒尾部读取最多增加 15 次请求/分钟，仅在回合持续期间。这不是一致性模型的改变（没有 ADR）：来源仍然是 GET，频道仍只是触发器——自 Fase 4a 起就是如此——，改变的是没有通知的写入的最大延迟。
- **代码：** `apps/engine/lib/engine/sessions/engine_api_client.ex:581`、
  `:607`、`:630`、`:1034`（`avisar_canal`）；

  `:607`、`:630`、`:953`（`avisar_canal`）；
  `apps/engine/lib/engine/sessions/live_broadcast.ex`（`event_appended/3`）；
  `apps/engine/lib/engine_web/controllers/session_command_controller.ex:46`
  （`event_appended`，api 通知的路由）；
  `apps/api/src/application/use-cases/sessions/append-session-event.use-case.ts:225`
  （`eventAppended`）；
  `apps/api/src/infrastructure/persistence/drizzle/drizzle-context.ts:39`
  （`aposCommit`）、`:53`（`veioDoEngine`）；
  `apps/web/src/lib/canal-vivo.ts:35`（回退）、`:66`（状态）、`:108`
  （`intervaloDaSessao`）、`:134`（`alvosDoEvento`）、`:150`（窗口）、`:207`
  （`criarInvalidadorDoCanal`）；`apps/web/src/lib/session-channel.ts:161`、
  `:165`、`:131`、`:229`；`apps/web/src/lib/session-turno.ts:414`
  （通知：使失效，并对被跟踪的代理提前读取）、`:86`
  （`avisoPedeVerificacaoDoTurno`）、`:344`（立即读取）；
  `apps/web/src/lib/hooks.ts`（`useSessionEvents`、`usePendingActions`、
  `useHandoffs`、`useBacklog`）；`apps/web/src/lib/query-policy.ts:86`；
  `apps/api/src/interfaces/http/shared/etag-do-corpo-vazio.ts:40`；
  `apps/api/src/main.ts:80`
- **测试：** `apps/web/src/lib/canal-vivo.orcamento.test.tsx:138`（之前，123）、
  `:155`（之后，46）、`:176`（频道断开——失败用例）、`:186`（突发）、
  `:214`（隐藏的标签页）；`apps/web/src/lib/session-channel.test.ts:237`、`:253`
  （断开——失败用例）、`:267`；
  `apps/engine/test/engine/sessions/engine_api_client_aviso_no_canal_test.exs:29`，
  `:57`（被拒绝的追加不通知——失败用例）、`:71`；
  `apps/api/test/application/use-cases/sessions/aviso-ao-canal-da-sessao.spec.ts`
  （AT-157：带类型和执行者的通知；被拒绝的不通知，回滚的事务不通知——失败用例；engine 宕机不会让写入失败；来自 engine 的写入不会被重复通知），
  `apps/api/test/infrastructure/http-clients/origem-engine.middleware.spec.ts`，
  `apps/engine/test/engine_web/controllers/session_command_controller_event_appended_test.exs`；
  `apps/api/test/interfaces/http/shared/etag-do-corpo-vazio.spec.ts:56`（原因）、`:69`、`:98`（迟到的 `@Res()`——失败用例）；
  `apps/api/test/interfaces/rate-limit.guard.spec.ts:183`（2 × 263 超出，2 × 118 不超出）；`apps/web/src/routes/SessionPage.canal-e-acompanhamento.test.tsx:166`
  （谓词）、`:203`（被跟踪代理的通知不等节拍就结束回合）、`:221`（另一个代理的通知不读取，4 秒节拍仍是那张网——失败用例）、`:244`（回合已结束：通知和节拍都不读取）
- **来源：** AT-093——已安装 api 的日志（v6.1.0），2026-09-14；AT-157——api 自身写入的通知

### RN-580 — 在一段对话之上启动的对话型代理收到它的「结尾」，含问题和工具，放不下的开头被概括并写明数量 {#rn-580}

六个对话型代理（Criativo、PO、Arquiteto、Dev Lead、UX Designer 和 Staff）在 `init/1` 中从 event log 重建历史——在重启时，以及在已有对话的会话中启动时（在 Criativo 的 handoff 中的 PO）。在 9月13日测得（AT-073，针对 `b61bc49cd`），六者都有「同一份」`rehydrate/2` 拷贝，带有三个缺陷：
1. **它们读取的是开头。** `EngineApiClient.list_events/2` 请求 `limit=200` 而不带 `latest`，内部路由——它甚至不接受 `latest`——返回的是「最前」的 200 个。在一个 201 个事件的对话中，代理醒来时缺少它正在回复的那条消息。界面早已用 `latest: true` 和截断提示解决了这个问题（[RN-180](web.md#rn-180)）；engine 没有继承。
2. **只重建 `chat.message` 和 `agent.response`。** 通过表单提出的问题（`chat.structured_question`）以及调用的工具（`tool.call`/`tool.result`）都消失了。
3. **静默截断。** kickoff 的读取（PO、Arquiteto、Dev Lead、UX Designer）以及 product_brief 的规则读取（Criativo）在内存中过滤的是同样的「最前」200 个所有类型的事件：在与 Criativo 的长对话中，brief 在第 200 个事件之后诞生，PO 收到「(sem product
   brief disponível)」。

**规则：**

1. **只有一条路径。** `Engine.Agents.Reidratacao` 取代六份拷贝；六个服务器在 `init/1` 中调用 `historico/3`。
2. **尾部，带 ADR 0060 的上限。** 读取是 `latest=true&limit=200`——路由的 `MAX_LIMIT`，不多（api 会截断）也不少（会漏掉它免费提供的东西）。上限「没有」变成无限。
3. **纳入什么。** `chat.message` 和 `agent.response` 照旧（来自会话中任何代理——这就是 PO 从 Criativo 继承的东西）；`chat.structured_question` 作为代理的发言，带标签和选项；「本」代理的 `tool.call`/`tool.result` 作为文本说明，含工具、参数（截断为 1,500 个字符）和结果——绝不作为 `role: "tool"` 消息，因为事件不保存调用的 id，而没有对应 `tool_use` 的 `tool_result` 会被 provider 拒绝。`chat.structured_question_answered` 有意「排除」：api 紧接着在一个 `chat.message` 中写入同样的回答（`AnswerStructuredQuestionUseCase` 复用 `SendAgentMessageUseCase`），两者都重新水合会让回答重复。
4. **放不下的开头会被说出来，附带数量。** `seq` 无间隙且从 1 开始，所以省略的事件数等于尾部第一个的 `seq` 减一——「减法」，不多一次请求。当它大于零时，历史以「一条」系统消息开头，写出这个数字，并带上代理最近一次上下文压缩的摘要（如果已记录）以及对话的开场（前 40 个事件中的前六条消息，截断为 500 个字符）。这是另外两次带上限的读取——总共三次，对话放得下时只有一次。
5. **`context.compacted` 从现在起记录摘要**——`summary`、`agent` 和 `messagesSummarized`，与一贯的计数并列。在此之前被压缩的对话会被「声明」（「compactada N vez(es) antes de o resumo passar a
   ser gravado; aquele resumo se perdeu」），绝不重建；旧事件不变。
6. **不可读的历史不会变成空对话。** 如果读取失败，代理会收到一条说明它无法读取历史的系统消息。
7. **kickoff 和 brief 的引用「按类型」读取，从尾部读。** 内部路由获得了 `types`（最多 20 个，经校验；格式错误为 400）——契约的「增量」变更：没有 `latest`/`types` 时回应与之前相同。当按类型的读取碰到上限时，kickoff 会说明可能还有更早的条目。

**按代理测量：** 六个在重新水合（`init/1`）中都有变化。在 kickoff 中，PO、Arquiteto、Dev Lead 和 UX Designer 有变化；Criativo 在 product_brief 的引用和零规则护栏中有变化；Staff 没有 kickoff（ADR 0088）。

**本规则「不」关闭的：** 工具返回的文本不在日志中——由 [RN-589](#rn-589) 从现在起关闭（旧会话仍然没有）。`InfraLeadServer`（自 AT-150 起通过 `Reidratacao.historico/3` 重新水合，没有自己的拷贝）和 `DevLeadTools.run_assessment/2`（读取「尾部」，`latest`，同样 200 的上限）也走公共路径；`apps/engine/lib` 中不再剩下不带 `latest` 的 `list_events/2` 读取者。重新水合可能比活动上下文拥有的「更多」（整个尾部，即使已被压缩过的部分）；`ContextManager` 会在下一个回合再次压缩。

- **代码：** `apps/engine/lib/engine/agents/reidratacao.ex:71`（`historico/3`）、
  `:46`（上限）、`:104`（`eventos_do_tipo/3`）、`:152`（`mensagens/2`）、`:167`
  （结构化问题）、`:170`（工具）、`:271`（通过减法得出的省略数）、`:274`（开头的摘要）、`:294`（压缩）、`:328`（开场）；`apps/engine/lib/engine/harness/context_manager.ex:138`（记录的摘要）；`apps/engine/lib/engine/sessions/engine_api_client.ex:1066`

  记录的摘要）；`apps/engine/lib/engine/sessions/engine_api_client.ex:1146`
  （`list_events/3`）；六个 `init/1`——
  `apps/engine/lib/engine/agents/criativo_server.ex:89`、`po_server.ex:93`、
  `arquiteto_server.ex:87`、`dev_lead_server.ex:132`、`ux_designer_server.ex:85`、
  `staff_server.ex:86`；按类型的读取——`criativo_server.ex:435`、
  `po_server.ex:352`、`arquiteto_server.ex:313`、`dev_lead_server.ex:431`、
  `ux_designer_server.ex:246`；
  `apps/api/src/interfaces/http/internal/leitura-interna-de-eventos.ts:24`，
  `apps/api/src/interfaces/http/internal/internal-sessions.controller.ts:306`，
  `apps/api/src/infrastructure/persistence/drizzle/session-event.repository.ts:56`
- **测试：** `apps/engine/test/engine/agents/reidratacao_test.exs:57`（结构化问题）、`:92`（回答只进入「一次」）、`:108`（带结果的工具）、`:128`（没有 `tool.result`）、`:136`（另一个代理的工具被排除）、`:157`（以 200 上限请求尾部）、`:176`（结尾进入，开头变成带数量的摘要）、`:194`（压缩的摘要）、`:233`
  （声明的旧压缩）、`:248`（不可读的历史——失败用例）、
  `:255`（开场失败不会抹掉数字）、`:270`（按类型读取和上限提示）；`apps/engine/test/engine/agents/reidratacao_dos_seis_test.exs:59`
  （六个 `init/1`）、`:84`（第 200 个事件之后的 brief 到达 PO）、`:118`
  （第 200 个事件之后的规则进入 Criativo 的 brief）、`:135`（Arquiteto、Dev Lead 和 UX 按类型读取）；`apps/engine/test/engine/harness/context_manager_test.exs:74`
  （记录的摘要）、`:101`（摘要器的回退）；
  `apps/api/test/interfaces/http/internal/leitura-interna-de-eventos.spec.ts:13`
  （没有参数时，选项与之前相同）、`:40`（格式错误的类型为 400）；
  `apps/api/test/infrastructure/persistence/session-event-latest.repository.spec.ts:129`
  （`types` 过滤，`limit` 只计算它们）、`:143`（`types` 与 `latest`）
- **来源：** AT-073，于 2026-09-13 提出

## 仓库在给 Arquiteto 的 handoff 接受时诞生，没有它执行就不开始（RN-582）

### RN-584 — 聊天消息没有默认收件人：每个对话型代理有自己的子句，其余是点名的拒绝 {#rn-584}

`EngineWeb.AgentCommandController.message/2` 的最后一个子句不看代理：它匹配上面的子句没有捕获的「任何」名字，并把消息交给 **Criativo**。写给 `infra` 的消息被另一个代理读取，点击回应 202，Criativo 在线程中回复——什么都没坏，也没人看见。作为 [RN-578](#rn-578)（AT-089）的相邻问题被发现，并在这里修正（AT-098）。

**修复之前的测量**（三个方面，在 `dev` 的 `72ee8cdcf` 上）：

| 目标 | 界面提供吗？ | api 接受吗？ | engine 原本有子句吗？ |
|---|---|---|---|
| `criativo` | 是（输入框：创意会话的回退以及 `AGENTES_DE_CHAT`） | 是 | 「没有」——它是最后的子句，没有守卫 |
| `po`、`arquiteto`、`dev-lead`、`ux-designer`、`staff` | 是（`AGENTES_DE_CHAT`，最近的 `agent.activated`） | 是 | 有，各一个 |
| `infra` | 输入框中没有（自发现 9-fix 和 [RN-499](web.md#rn-499) 起不在 `AGENTES_DE_CHAT` 中） | 是 | 没有——落到 Criativo |
| 名册中的任何其他名字（`qa`、子代理、`secops`、`psicologo`…） | 只通过结构化问题表单，它回复提问的「执行者」（`agent={event.actor.id}`）；目前只有 Criativo 和 PO 提问 | 是 | 没有——落到 Criativo |
| 未知名字，或没有名字 | 否 | 是（api 不校验 `agent`；只有 `sessionId` 会成为经检查的 URL 段，RN-128） | 没有——落到 Criativo |

**规则：**

1. **每个对话型代理有「自己的」子句**，包括 Criativo（`"agent" => "criativo"`）。最后的子句不再作为投递存在：它是「拒绝」。
2. **没有子句的名字是「点名」的 422**，按 [RN-578](#rn-578) 的模式为 `{error, motivo}`：`agente_sem_conversa`，语句点名该代理，并说明消息已记录而没有代理读取它。api 以带「同样」语句的 `UnprocessableEntityException` 转发 422（RN-578 的 `postComandoDeTurno`，没有新代码），界面通过已有的 `mensagemDaRecusaDoAgente` 显示它。请求体中没有 `"agent"` 是 `agente_ausente`，对话型代理没有文字是 `mensagem_sem_texto`——三个原因，因为对会对话者说「不对话」就是撒谎。
3. **`infra` 有「自己的」拒绝**，语句说明它做什么：它通过提议工作（infra 的 PR、容器的启动），需要决定的东西会出现在审批中。这不是缺代码，而是与 [RN-499](web.md#rn-499) 相同的解读——Infra Lead 是提议型的。而 `InfraLeadServer` 仍然导出的 `user_message/2` **不适合**作为一个子句：它在 `handle_call` 内运行「整个」回合（最多 180 秒），没有 ADR 0163 的接受，也没有「Parar」（`via_for/2` 不认识它）。接上它会把 [RN-578](#rn-578) 去掉的等待还给点击。
4. **「Parar」也不猜。** 没有 `"agent"` 的 `cancel/2` 原本会停止 Criativo 的回合；现在是 422 `agente_ausente`。api 在两个路由中总是发送代理，所以这两个拒绝只会到达损坏的调用方。
5. **界面仍不在输入框中提供 `infra`**——没有 UI 改变：`AGENTES_DE_CHAT` 本来就排除了它，改变的是，如果有一天有人把它放在那里，engine 会点名拒绝而不是交给别人，而 CI 的守卫会更早失败。

> **自 [RN-617](#rn-617)（ADR 0175）起，第 3 和第 5 项不再有效：** Infra Lead 的回合迁移到 `TurnoAssincrono`，此后它才获得 `message/2` 的自己的子句、「Parar」的 `via_for/2` 以及在 `AGENTES_DE_CHAT` 中的位置。它的 `agente_sem_conversa` 拒绝已移除；本 RN 的底层规则——没有默认收件人，每个没有子句的名字都被点名拒绝——不变。

**关闭这一类问题的守卫**住在 `scripts/ci/destinos-do-composer.spec.ts`，因为目标诞生在 TypeScript 中而子句住在 Elixir 中——两个套件都不读另一种语言。它从来源「推导」目标（`AGENTES_DE_CHAT`、`SessionPage.tsx` 中的 `agentParaEnviar = '…'` 字面量以及名册的 `AgentKey`）并要求：输入框的每个目标都有自己的对话子句和「Parar」的 `via_for/2`；没有任何头部不带固定代理的子句会把消息交给某个代理；`message/2` 的最后一个子句是拒绝；`infra` 不在输入框中并有自己的拒绝；以及 `@agentes_de_conversa` 等于对话子句的集合。测量了五个变异，全部被杀死（旧的兜底子句回来、`infra` 进入 `AGENTES_DE_CHAT`、Criativo 的子句被重命名、Staff 的 `via_for` 被移除、`infra` 的子句被重命名）。

**本规则「不」关闭的，已声明：**

- **Infra Lead 是否通过输入框对话曾是产品决定，无人负责**——在 [RN-617](#rn-617)（AT-141）中做出：是。给它一个子句之前，需要先把它的回合迁移到 `TurnoAssincrono`（[RN-578](#rn-578) 的接受和 `turno_em_andamento` 拒绝），并把它注册到「Parar」；还需要决定对话对一个契约是提议的代理做什么。它的 `user_message/2` 仍被导出且没有调用方。
- **api 在拒绝之前写入的 `chat.message` 仍在日志中**——自 [RN-587](#rn-587) 起，engine 在旁边写入拒绝的 `agent.error`，所以线程能自我解释。
- **api 不校验 `agent`。** 在那里、在写入之前拒绝，需要在 TypeScript 一侧有第二份「谁在对话」的列表——而它与子句的分歧正是本规则所关闭的缺陷。做决定的是拥有子句的一方（在 [RN-587](#rn-587) 中维持该决定）。

- **代码：**
  `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:42`
  （`@agentes_de_conversa`）、`:177`（Criativo 的子句）、`:192`（`infra` 的拒绝）、`:283`（`mensagem_sem_texto`）、`:249`（`agente_sem_conversa`）、
  `:312`（`agente_ausente`）、`:310`（没有代理的「Parar」）；
  `apps/api/src/interfaces/http/agents/agents.controller.ts:115` 和 `:174`
  （文档化的 422 回应）；`apps/web/src/lib/session-readiness.ts:37`
  （`AGENTES_DE_CHAT`，守卫读取的来源）
- **测试：** `scripts/ci/destinos-do-composer.spec.ts`（这一类的守卫）；
  `apps/engine/test/engine_web/controllers/agent_command_controller_test.exs:124`
  （正常路径：通过自己子句的 Criativo）、`:231`（`infra`：422，两者都不启动——失败用例）、`:258`（区域目录和名册中每个不对话的名字）、`:286`、`:302`、`:317`；
  `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts:575`
  （目标按所选传输，422 带语句到达）
- **来源：** AT-098——在 PR #594（AT-089）中测得的相邻问题

### RN-585 — 回合的结束只在回合在代理中关闭之后才可见 {#rn-585}

自 [ADR 0163](../adr/0163-o-clique-responde-ao-aceitar.md)（[RN-578](#rn-578)）起，六个对话型代理的回合在一个 Task 中运行，而 Task 写入的结果——`agent.response`，或当 api 在最终帧中叙述预算、凭据或 binding 时的 `agent.error`——在结果到达代理的 GenServer 并清零 `turno_assincrono` 「之前」发出。一个在 `agent.error` 之后立即读取 state 的测试在约 4 次中失败 1 次（AT-099：30 次测量中 8 次）。问题是「同一个」窗口是否对用户存在：界面看到回合结束，而下一条消息听到 409 `turno_em_andamento`？

不存在，而规则正是让它不存在的东西：

1. **回合结束的两个信号只来自 `finalizar/1`**，它在 GenServer 的进程中、在「已经」清零 `turno_assincrono` 的 `handle_info` 内运行：频道中的 `agent.done` 以及持久化的 `agent.status: idle`。界面用来结束回合的就是这两个，也只有这两个（`onAgentDone` 和 `turnoTerminouNoLog`，[RN-578](#rn-578) 第 4 项）。
2. **看到其中一个信号的人的消息在这个 `handle_info` 之后才被处理**——GenServer 一次处理一条消息——，所以它会发现代理是空闲的并被接受。
3. **Task 写入的东西不是结束信号。** `agent.response` 和 `agent.error` 出现在线程中时，回合在代理中仍然打开。
   改为凭它们结束回合的界面或客户端会重新打开这个窗口；从 Task 内部发出 `agent.done` 或 `idle` 也会。

行为没有改变：自 RN-578 起顺序就是这样。本 RN 增加的是在六个对话型代理中「写下」并由测试锁定的顺序——测试在 Task 已结束时停住 GenServer，证明两个信号都没有发出，没有超时——以及对 PO 测试的修正，它改为等待持久化的 `idle` 而不是 `agent.error`。

- **代码：** `apps/engine/lib/engine/agents/turno_assincrono.ex:158`（在 `handle_info` 中清零回合）、`:442`（`finalizar/1`，两个信号的唯一发出者）；`apps/web/src/lib/session-turno.ts:30`（`turnoTerminouNoLog`）
- **测试：** `apps/engine/test/engine/agents/turno_assincrono_test.exs:434`
  （六个对话型代理：GenServer 挂起且 Task 已结束时，`agent.response` 已在日志中，而 `agent.done` 和 `idle` 都没有发出；`idle` 之后，下一条消息被接受——失败用例是 `turno_em_andamento` 拒绝，测试否定它）；
  `apps/engine/test/engine/agents/po_server_test.exs:478`（读取 state 前等待 `idle`）
- **来源：** AT-099——`PoServerTest` 的间歇性测试，于 2026-09-19 测量

### RN-586 — 被 engine 重启中断的回合以持久的结果关闭，绝不重做 {#rn-586}

自 [RN-578](#rn-578) 起，`agent.status: working` 在接受「之前」写入，而回合的结束（`agent.status: idle` 和 `agent.done`）只来自代理进程内的 `finalizar/1`（[RN-585](#rn-585)）。如果 engine 在回合中途宕机，进程和 Task 一起死去，没有人写入结束：代理的最后一个 `agent.status` **永远**停在 `working`（AT-156，已复现——在这个日志之上重新启动服务器不写入任何东西，六个都是）。这个信号的两个读取者都把它当作进行中的回合：界面（`turnoTerminouNoLog`，[RN-578](#rn-578) 第 4 项）保留活动条，而 `GetSessionPendingWorkUseCase` 将其计为「没有」上限的待办工作（[RN-064](web.md#rn-064) 的第三个信号），所以会话不会因心跳而关闭。只有用户的下一条消息才能解锁，而且只是因为它会启动代理。

1. **没有存活回合的 `working` 由「新」事件关闭**，绝不改写（事件不可变）：一个来源为 `infra`、`reason: turno_interrompido_por_reinicio` 的 `agent.error`——语句说明 engine 已重启、回合未完成、由用户决定是否重试（[RN-059](#rn-059)：失败绝不变成空回应）——随后是持久化的 `agent.status: idle`。频道收到 `agent.error` 和 `agent.done`，让打开界面的人无需重新加载状态条就会消失。适用于共享 `TurnoAssincrono` 的代理——最初六个，自 [RN-617](#rn-617) 起七个。
2. **回合「绝不」重新执行。** 重做会以用户可能已经忘记的消息的名义花费 token，而且基于重建的历史；关闭时不会调用任何模型。
3. **只有每个代理的「最后」一个 `agent.status` 才算数**，且只有 `working`：`idle` 已经关闭，`awaiting_approval`（挂起的 Dev Lead，[RN-284](#rn-284)）是待定的决定，不是死掉的回合。
4. **「没有存活回合」看的是集群，有疑问时不关闭。** 代理的注册表是本地的；在滚动发布中旧 pod 可能正在运行这个回合，从这里关闭它会杀死一个健康的回合。不回应的节点算作存活。drain 的会话转交（[RN-588](#rn-588)，`Monitor.expect_handoff/1`）属于 `SessionServer`，而不属于对话型代理：旧 pod 运行期间它的代理仍在那里注册，新 pod 的扫描能看到它；`Adopter` 不扫描——旧 pod 死后到达孤儿 `working` 的是代理的 `init/1`。
5. **两个入口，一个函数**（`Engine.Agents.TurnoOrfao`）：每个重新水合的会话的启动扫描（`Rehydrator`，不在就绪检查的路径上——启动不等待 api），即使没人发消息也会关闭回合；以及每个服务器的 `init/1`，作为启动无法写入时（api 仍然宕机）的安全网。读取或写入失败会记录日志，代理照常启动。

已声明但未关闭：~~Infra Lead（`infra`）在 `handle_call` 中运行回合，没有 `TurnoAssincrono`，被排除在外~~——已在 [RN-617](#rn-617) 中关闭，它把 Infra Lead 放进了 `TurnoAssincrono` 和 `TurnoOrfao`；读取窗口是会话中最近 200 个 `agent.status`；如果启动时 api 宕机「且」没有人唤醒代理，`working` 会一直保留到它下一次启动；关闭也不会恢复回合在宕机前已经写入的东西。

- **代码：** `apps/engine/lib/engine/agents/turno_orfao.ex:71`（`varrer/2`）、
  `:81`（`fechar_ao_subir/3`）、`:134`（`encerrar/3`）；
  `apps/engine/lib/engine/sessions/rehydrator.ex:75`（启动时的扫描）；六个 `*_server.ex` 的 `init/1` 调用 `TurnoOrfao.fechar_ao_subir/3`
- **测试：** `apps/engine/test/engine/agents/turno_orfao_test.exs:72`（六个中：没有存活回合的 `working` 变成 `infra` 的 `agent.error` + `idle`，且不调用 LLM）、`:108`（`awaiting_approval` 不是孤儿；`idle` 和另一个代理的 `working` 不被关闭）、`:124`（`varrer/2` 跳过在「本」节点或集群中真实 `:peer` 节点上有存活进程的代理；失败的读取和写入不会拖垮启动）；
  `apps/engine/test/engine/sessions/rehydration_test.exs:46`（启动触发扫描）
- **来源：** AT-156，继承自 AT-089（RN-578）——于 2026-09-19 复现

### RN-587 — 没有代理读过的消息留在线程中并说明这一点：engine 写入拒绝的 `agent.error` {#rn-587}

api 在询问 engine「之前」写入 `chat.message`（engine 通过读取日志重建对话，消息即使在它宕机时也必须是持久的）。当 engine 拒绝时，消息在用户的线程中看起来像已投递，而原因只存在于 toast 中——界面断言了来源所否认的东西。两个源头 RN 把这一点留作声明（[RN-578](#rn-578)、[RN-584](#rn-584)）；本 RN 关闭它（AT-132）。

**修复之前的测量**，按拒绝：

| 拒绝 | 由谁产生 | `chat.message` 旁边有持久的 `agent.error` 吗？ |
|---|---|---|
| 409 `turno_em_andamento` | `TurnoAssincrono`（RN-578） | 早就有——`emitir_recusa_por_turno_em_andamento/1`，带测试 |
| 409 `aguardando_aprovacao` | `DevLeadServer.handle_call`（RN-578） | 早就有——`reason: "aguardando_aprovacao_de_plano"` |
| 422 `agente_sem_conversa`、`mensagem_sem_texto`、`agente_ausente` | controller（RN-584），没有 `*Server` | 没有——解释只存在于 toast 中 |

**规则：**

1. **engine 是拒绝「以及」记录的来源。** 三个 422 拒绝写入 `agent.error`（来源 `politica`，`mensagem` 等于 422 的语句，`reason` 等于 `motivo`），并在会话频道中广播——与两个 409 相同的持久/临时组合。线程已经绘制 `agent.error`（`SessionPage.tsx`、`lerFalhaDeTurno`），所以没有界面改变。
2. **只有点名的会话才有东西可写。** 请求体中没有 `projectId`/`sessionId`（损坏的调用方）时，拒绝仍只作为回应。
3. **执行者不来自路由。** `infra` 和六个对话者作为 `agent` 进入；任何其他名字（公共路由会放行）是 `system` `engine`——输入的名字绝不会成为日志中的执行者。
4. **不删除也不推迟 `chat.message`。** 事件不可变，而只在接受之后才写入会重排日志：回合在 Task 中运行，`agent.response` 可能先于它所回复的消息（而接受与追加之间的失败会让回合在未写入的消息上运行）。

**api 仍不校验 `agent`，现在这是决定而不是缺口。** AT-098 所要求的校验就是 engine 的 422 拒绝，它是「唯一」机制：api 转发它（`postComandoDeTurno`），engine 记录它。TypeScript 一侧的列表会是在第一个新代理上就分歧的第二份拷贝，而从子句「生成」的列表需要解析 Elixir——对已经在线程中看到消息和解释的用户没有收益。

- **代码：** `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:547`
  （`recusar_mensagem/5`）和 `:552`（`registrar_recusa_de_mensagem/3`）
- **测试：** `apps/engine/test/engine_web/controllers/agent_command_controller_test.exs:164`
  （`qa`，名册中仍然不对话的代理——在 RN-617 之前，这个用例是 `infra`，它开始对话了：带语句和原因的 `agent.error`）、`:178`（未知名字不成为执行者）、`:194`、`:209`、`:224`（没有会话：什么都不写入——失败用例）；测得的变异：移除记录后，5 个中有 4 个失败；
  `scripts/ci/destinos-do-composer.spec.ts`（`message/2` 的拒绝是 `recusar_mensagem/5`，它写入 `agent.error`；六个变异被杀死）
- **来源：** AT-132——在 RN-578（AT-089）和 RN-584（AT-098）中声明为开放

### RN-588 — 转交会话不会让旧 pod 删除接手方的行 {#rn-588}

在滚动发布中，旧 pod 的 drain 停止 `SessionServer` 并请一个接手方接管会话（`Engine.Shutdown`）；接手方的 `init` 重写 `engine.session_states` 的行。然而，被停止进程的 `:DOWN` 以消息形式到达旧 pod 的 `Engine.Sessions.Monitor`——而 Monitor 是单一的 GenServer，它对每个会话的 `:DOWN` 串行执行一次到数据库的 DELETE，不等待随后的转交。当 `:DOWN` 在接手方的 upsert「之后」才被处理时，`DELETE ... WHERE session_id`——它不看所有者也不看代——会带走「接手方」的行：会话有所有者却没有行，对 `Adopter`、`Rehydrator` 和接手方 drain 的 `local_sessions/0` 不可见。如果接手方是「另一个」旧 pod（`.33 → .28 → novo`），它在 drain 时看不到它，而它的 SIGTERM 会杀死它：在 api 中是 `active` 却没有所有者（AT-078，`propriedades.yml` 的 `rollout-test`，13 轮中约 3 个孤儿）。

规则：drain 用 `Monitor.expect_handoff/1` 标记停止（一贯的 `expect_stop/1` 「加上」「这一行不是我的」），Monitor「不」删除已转交会话的行——在 `Logger.info` 中记录它保留了该行。没有接管时，删除的是 drain 本身（`terminate_unadopted`），与以前一样；Monitor 继续删除因其他原因死去的每个会话的行，以及 `SessionLifecycleWorker` 的 `expect_stop/1` 的行（api 已经结束了会话）。没有迁移：行没有获得所有者列，标记存在于 Monitor 的状态中，按会话。Monitor 的每次删除现在都会留下「一」行日志，带有会话、节点和删除的行——drain 的日志永远到不了 pod 的日志（`preStop` 会丢弃它），Monitor 的日志能到。

**仍然存在的推断：** 行消失的那一刻从未在 k3d 中测量过；解读来自 `35452845830` 那一轮的产物（没有行 + 第二个旧 pod）以及代码，竞态在 ExUnit 中被证明，而不是被观察到。k3d 的下一次失败（如果有）会带来 Monitor 的那一行。

- **代码：** `apps/engine/lib/engine/sessions/monitor.ex:45`
  （`expect_handoff/1`）、`:119`（`apagar_linha/1`）；
  `apps/engine/lib/engine/shutdown.ex:130`（`release/1`，drain 标记转交）
- **测试：** `apps/engine/test/engine/sessions/monitor_repasse_test.exs:52`
  （Monitor 挂起：迟到的 `:DOWN` 不会删除接手方重写的行）、
  `:67`（旧 → 旧 → 新的链条：第二个 drain 仍能看到会话）、
  `:87`（没有接管时，行仍由 drain 移除）、`:100`
  （`Shutdown.release/1` 标记转交——把调用换回 `expect_stop/1` 「只」会让这个测试失败）
- **来源：** AT-078——engine 滚动发布中间歇性的孤儿会话

### RN-589 — 工具返回的文本进入 `tool.result`，截断时说明总量 {#rn-589}

RN-580 声明为开放：只有 Criativo 写入 `tool.result`，而且不带文本——在另外五个中，重新水合的说明说日志不记录结果，重新水合的代理知道自己「调用了」`create_epic`，却不知道它返回的 epic 的 id。

**规则：**

1. **六个都写入。** Criativo、PO、Arquiteto、Dev Lead、UX Designer 和 Staff 在「每次」返回文本的调用之后发出 `tool.result`。payload 来自「一个」地方，`Engine.Agents.ResultadoDeFerramenta.payload/2`：`tool`、`ok`，以及——成功时——`resultado`；失败时为 `erro`（与 Criativo 已经做的一样）。
2. **有上限，上限说明总量。** 文本截断为 2,000 个字符；截断时，`resultadoTotal` 带上「真实」长度（ADR 0060）。上限的原因：日志被项目的每个成员读取并进入备份，而一个列表（`listar_backlog`）可能很大。
3. **增量。** 现有类型中的新字段，没有迁移；`tool`/`ok`/`erro` 照旧。事件不可变：之前的会话仍然没有文本，重新水合的说明对没有 `tool.result` 的调用继续这样说。
4. **重新水合使用这个文本。** `desfecho: ok, devolveu: <texto>`（有 `resultadoTotal` 时带提示 `[cortado; o total real tinha N caracteres]`）。仍然是文本说明，绝不是 `role: tool`——事件不保存调用的 id。
5. `propose_adr` 不再写入自己的拒绝 `tool.result`：Arquiteto 的服务器为每个工具写入它，两者会重复该事件。

**仍然开放的：** (a) 和 (b) 已在 [RN-593](#rn-593) 中关闭——(a) 「挂起」的 Dev Lead（`{:pending, _}`，`propose_execution_plan`/`assess_implementability`）在挂起时和 `action_settled` 时都不写入 `tool.result`；(b) `InfraLeadServer` 有自己的 `tool.result`，不经过这个模块；(c) 2,000 的上限是「选择」，不是对存量的测量——没有抽样任何真实结果；(d) **待定的产品决定（AT-151 的 TODO humano）：** 六个代理的工具返回 id、规则/backlog/指标列表和错误消息——没有一个读取仓库文件或命令输出——，但如果诞生了这样的工具，它会把其中的内容写入日志；截断是唯一的约束。

- **代码：** `apps/engine/lib/engine/agents/resultado_de_ferramenta.ex:24`
  （`payload/2`）、`criativo_server.ex:382`、`po_server.ex:259`、
  `arquiteto_server.ex:336`、`dev_lead_server.ex:407`、
  `ux_designer_server.ex:232`、`staff_server.ex:198`；
  `apps/engine/lib/engine/agents/reidratacao.ex:224`（`desfecho/1`）
- **测试：** `apps/engine/test/engine/agents/reidratacao_test.exs:128`（说明中的文本和截断提示；`:145` 没有 `tool.result` 的旧会话）、
  `apps/engine/test/engine/agents/po_server_test.exs:252`（写入的事件，截断，带 `resultadoTotal`）
- **来源：** AT-151——在 RN-580（AT-073）中声明为开放

### RN-593 — 挂起的 Dev Lead 和 Infra Lead 通过公共模块写入 `tool.result` {#rn-593}

[RN-589](#rn-589) 声明了两个开放项：在审批中挂起的 Dev Lead 在任何时刻都不写入 `tool.result`，而 `InfraLeadServer` 只写入 `propose_infra_pr` 拒绝的那一个，payload 是手工组装的。在两种情况下，重新水合的代理（[RN-580](#rn-580)）都会读到「o log não registra o
desfecho desta chamada」，针对的是用户已经决定的计划，或者 `validate_infra_file` 和容器启动的每一次调用。

**规则：**

1. **Dev Lead：`tool.result` 在「恢复」时诞生，绝不在挂起时。** 当 `propose_execution_plan`/`assess_implementability` 挂起（`{:pending, _}`）时，日志只有 `tool.call`：没有结果，在那里写入「pending」就是对模型说的同一个谎言。当「同一」操作的 `{:action_settled, …}` 到达时，服务器写入 `tool.result`，其文字与进入 `role: "tool"` 消息的「相同」。`ok` 遵循 `texto_do_desfecho/1` 的划分：`executed`/`auto_approved`/`approved` 为 `true`；拒绝、失败以及模块不认识的状态为 `false`——对没人分类过的结果给出 `ok: true` 就是在不知道的情况下断言成功。「另一个」操作的结果仍被忽略，不写入任何东西。
2. **Infra Lead：每个内联分派的工具都写入。** `validate_infra_file`、`propose_container_start` 和 `container_start_via_runner` 通过 `Engine.Agents.ResultadoDeFerramenta.payload/2` 写入 `tool.result`——被 api 接受的提议为 `ok: true`；按模式的本地拒绝（[RN-566](#rn-566)）、api 的拒绝（[RN-591](api.md#rn-591)）以及缺少 runner 为 `ok: false` 并附原因。没有仓库时 `propose_infra_pr` 的拒绝（[RN-577](#rn-577)）经过同一模块，payload 与以前相同（`tool`、`ok: false`、`erro`）并有截断。
3. **被接受的 `propose_infra_pr` 仍「没有」`tool.result`**，这是有意的：它不发出 `tool.call`（它的痕迹是 `proposed_action`），没有调用的结果会在重新水合中成为孤立的说明。

**仍然开放的：** 被 engine 重启穿过的挂起仍会丢失在 `Wake` 中的订阅（ADR 0086）——在那里 `tool.result` 永远不会诞生，重新水合会说日志没有结果，这是真的；2,000 字符的上限仍是「选择」，不是测量：本次改动没有抽样任何真实存量（[RN-589](#rn-589) 的 (c) 项）；`validate_infra_file` 的输出（hadolint/actionlint）可能引用代理「自己」写的文件片段，截断是唯一的约束——这是 [RN-589](#rn-589) 的 (d) 项的第一个具体案例。

- **代码：** `apps/engine/lib/engine/agents/dev_lead_server.ex:313`
  （`action_settled` 的 `handle_info/2`，`tool.result` 在 `:271`）、`:719`
  （`sentido_do_desfecho/1`）；
  `apps/engine/lib/engine/infra/infra_lead_server.ex:1042`
  （`registrar_resultado/4`）、`:317`（`propose_infra_pr` 的拒绝）
- **测试：** `apps/engine/test/engine/agents/dev_lead_server_test.exs:292`（挂起不写入）、`:364`（恢复写入模型读到的文字）、
  `:488`（被拒绝的为 `ok: false` 并附原因）；
  `apps/engine/test/engine/infra/infra_lead_server_test.exs:253`
  （`validate_infra_file` 的结果）、`:409`（被接受的提议）、`:485`（按模式拒绝）、
  `:863` 和 `:910`（有和没有 runner 的 `container_start_via_runner`）
- **来源：** AT-190——在 [RN-589](#rn-589)（AT-151）中声明为开放

### RN-601 — engine 和 broker 对两个服务 token 应用 api 的尺子 {#rn-601}

比较服务 token 的三个进程都使用 [RN-598](api.md#rn-598) 的同一把尺子，各用自己的语言。周围的空格被丢弃，只由空格组成的值视为缺失。在生产环境中，`BRABO_SERVICE_TOKEN` 缺失、公开的开发字面量（`dev-service-token-change-me`）或 trim 后少于 16 个字符的值会让启动*失败*，消息中点名该变量。后两种拒绝在 `BRABO_SERVICE_TOKEN_PREVIOUS` 被定义时也适用于它。等于当前值的之前值不算轮换。在生产环境之外只应用 trim，空的当前值落到开发默认值。

以前，engine 在 `config/runtime.exs` 中原样读取两者：没有 trim，没有下限，在生产环境中变量缺失时以公开默认值启动（compose 传空值时则以空字符串启动）。只有 api 拒绝启动才保护了安装。broker 已经对当前值应用这把尺子，但对之前值只做 trim。

形式上的两处分歧，已声明。在 engine 中，"生产"是
`config_env() == :prod`（release），而不是它不读取的 `NODE_ENV`；生产镜像总是 `:prod` release。并且尺子内联在 `runtime.exs` 中，而不在 `lib/` 的某个模块中，因为在 release 中这个文件在应用代码加载之前就在 config provider 中运行。

后果：在 `:prod` release 中评估这个 `runtime.exs` 的每个进程都需要 token，包括迁移（`bin/engine eval
Engine.Release.migrate()`）。因此，生产和安装 compose 中的 `migrate-engine` 服务开始接收 `BRABO_SERVICE_TOKEN` 和
`BRABO_SERVICE_TOKEN_PREVIOUS`，没有默认值。CI 的 smoke 显示了这一点：没有它们，迁移会在迁移之前就死掉。Kubernetes 的迁移 Job 本来就通过 `brabo-secrets` 的 `envFrom` 接收它们。

- **位置：** `apps/engine/config/runtime.exs:85`
  （`exigir_token_de_servico_de_producao`），`:105`（`service_token`），`:121`
  （`service_token_previous`）；`apps/broker/src/config.ts:89`（`anterior`），
  `:125`（`exigirTokenDeProducao`）
- **测试：** `apps/engine/test/engine/runtime_service_token_test.exs`（通过 `Config.Reader.read!/2` 真正评估 `runtime.exs`，带 `env: :prod` 和
  `:dev`）；`apps/broker/src/config.spec.ts`（describe "lerConfiguracao —
  produção, o token ANTERIOR (RN-601)"）
- **边界情况：** 尺子在三个进程中是复制的，而不是共享的：它们是三种语言或运行时，没有测试核对三份副本是否保持一致。下限计算字符数（Elixir 中是 `String.length`，TS 中是 `.length`），这只对非 ASCII 的 token 有区别。
- **来源：** AT-216（AT-205 的发现）

### RN-610 — Infra Lead 按「状态」拒绝启动，顺序与 `/containers` 相同：已在运行、没有镜像、文件夹从未确认 {#rn-610}

[RN-566](#rn-566) 给了 Infra Lead 的两个启动工具按「模式」的拒绝，并声明了其余部分：`/containers` 在提供按钮之前检查三样东西（已决定的镜像、模式、已确认的文件夹），而代理只检查一样。维护者的决定（AT-142，2026-09-27）是通过**分派时的本地拒绝**来缩小这个差距，仿照 RN-566/[RN-577](#rn-577)，而「不」通过丰富上下文——`GetInfraContextUseCase` 不变。

`recusa_local_de_subida/2` 仍然只读取项目「一次」。先是「模式」（`recusa_por_modo/2`，RN-566 的尺子，文字不变）——是它说明该用哪个工具，而对调用了错误工具的人回答「缺镜像」会指错门。然后是「状态」（`recusa_por_estado/3`），每个原因一个子句，顺序与 `decidirSubida`（`apps/web/src/routes/containers-subida.ts`）「相同」，只评估到第一个拒绝为止：

| 子句 | `propose_container_start` | `container_start_via_runner` | 本地读取 |
|---|---|---|---|
| 容器已「登记」为 `running`/`provisioning`（`ja_esta_de_pe`） | 拒绝 | 拒绝 | `project_containers.status` |
| 没有已决定的镜像（`sem_imagem_decidida`） | **不**拒绝 | 拒绝 | 项目的某个会话中存在 `artifact.project_image` |
| 文件夹从未确认（`runner_nunca_confirmou`） | —— | 拒绝 | `projects.workspace_verified_at` 为空 |
| 现在没有连接任何 runner | —— | 拒绝（已有，RN-508） | `Engine.Runners.Registry` |

**为什么 `propose_container_start` 不按镜像拒绝。** 选定镜像就是这个提议「所做」的事（[RN-491](web.md#rn-491)）：要求先有决定会颠倒顺序。界面在两种模式中都检查镜像，因为它的按钮不选定任何东西。`container_start_via_runner` 不选定——它启动「已经」决定的镜像，没有它 `ExecuteContainerStartViaRunnerUseCase` 会失败——，所以那里这个子句有效。谓词与 api 的「相同」（`ObterContainerDoProjetoUseCase`）：事件的「存在」，绝不是 payload 的有效性，因为 api 把不可读的 payload 降级为默认值，而不是把它当作缺失。

**为什么「已在运行」会拒绝，即使执行不会失败。** `SubirCicloDeVidaDoContainerUseCase` 在 `provisioning`/`running` 上是幂等的，所以被批准的提议会是一个浪费了一次人类决定的空操作——在 `container`/`mounted` 中比空操作更糟：它会选定一个新版本的 `artifact.project_image`，而运行中的容器（版本冻结在行中，[RN-245](api.md#rn-245)）不会使用它。登记不等于观察（[RN-486](api.md#rn-486)）：文字不断言容器活着，而是说明当它在外部死掉时该怎么做。`stopped`、`failed` 和 `removed` 不拒绝。查询错误返回 `nil` 并落入一贯的路径——「无法查看」绝不变成拒绝。

**文字，即模型读到的工具结果**（[RN-163](#rn-163)）——绝不是 `agent.error`，绝不是回合结束，event log 中通过 [RN-593](#rn-593) 的同一个 `registrar_resultado/4` 留有 `tool.call`/`tool.result`（`ok: false`）：

- 已在运行：*"o container deste projeto já está REGISTRADO como `<status>` —
  subir não é a próxima ação, e `<tool>` não foi proposta. O registro não é
  observação (RN-486): se o container morreu por fora, ou se a imagem precisa
  mudar, diga ao usuário que parar ou remover é pela página `/containers`; só
  depois disso uma nova subida faz sentido. Não repita a chamada agora."*
- 没有镜像：*"nenhuma imagem de container foi decidida para este projeto
  (`artifact.project_image`, RN-105) — `container_start_via_runner` sobe a
  imagem JÁ decidida e não elege nenhuma, então aprovada ela só poderia falhar,
  e não foi proposta. Quem decide a imagem é o Arquiteto
  (`choose_project_image`): diga isso ao usuário e não repita a chamada até
  haver decisão."*
- 文件夹从未确认：*"a pasta deste projeto nunca foi confirmada por um
  agente local (`workspace_verified_at` vazio, RN-423) — nenhum `brabo-runner`
  jamais conectou a ele, e `container_start_via_runner` não foi proposta. Peça
  ao usuário para rodar `brabo-runner --project <id> --dir <pasta>` na máquina
  dele: a confirmação acontece quando o runner conecta."*

没有改动任何一行提示词，本规则中也没有用真实模型进行测量：模型能理解拒绝这一前提来自 RN-566。

**没有「任何」子句检查的，已声明：** 没有 broker 的安装（engine 不读取 `BROKER_URL`；拒绝的是提议时的 api，返回 409 `sem_broker_na_instalacao`，[RN-591](api.md#rn-591)）以及角色/会话（代理不是点击的人）。文件夹子句使用时间戳，它不是心跳（[RN-468](web.md#rn-468)）——这就是为什么「runner 已连接」子句仍在它之后。

- **代码：** `apps/engine/lib/engine/infra/infra_lead_server.ex:902`
  （`recusa_local_de_subida`）、`:955`（`recusa_por_estado`）、`:956`
  （`recusa_ja_de_pe`）、`:964`（`recusa_sem_imagem_decidida`）、`:1014`
  （`recusa_pasta_nunca_confirmada`）、`:1025`（`recusa_runner_desconectado`）；
  `apps/engine/lib/engine/containers/project_container_lifecycle.ex:83`
  （`status_registrado`）；
  `apps/engine/lib/engine/session_events/event.ex:120`（`imagem_decidida?`）
- **测试：** `apps/engine/test/engine/infra/infra_lead_server_test.exs:742`
  （经由 runner，`running` 拒绝）、`:804`（`provisioning` 拒绝）、`:814`
  （`stopped` 不拒绝）、`:779`（没有镜像）、`:790`（文件夹从未确认）、`:850`（容器 `running` 时的 `propose_container_start`）、
  `:850`（没有镜像时 `propose_container_start` 「提议」）、`:863`（经由 runner 的正常路径）、`:901`（没有连接的 runner）
- **来源：** AT-142

---

### RN-617 — Infra Lead 通过输入框对话，其回合经过 `TurnoAssincrono`：立即接受、「Parar」、关闭孤儿回合 {#rn-617}

[RN-584](#rn-584) 留下的决定——*"se o Infra Lead passa a
conversar pelo composer"*——已由维护者做出（AT-141，2026-09-27）：**是**，它成为「第七个」对话型代理（[ADR 0175](../adr/0175-infra-lead-conversa-pelo-composer.md)）。RN-584 写下的条件先到：它的回合不再在 `handle_call`/`handle_cast` 「之内」运行，而是经过与其他六个「相同」的 `Engine.Agents.TurnoAssincrono`；之后 `message/2` 的子句才诞生。

**第 1 阶段——回合。**

1. **Infra Lead 的三种回合在 Task 中启动**——kickoff（仍是 `cast`，只在已接受 handoff 的「全新」启动时）、gate 修正（`{:correct, _}`）以及输入框的消息。消息在「接受」时回应，`agent.status: working` 在之前写入（[RN-578](#rn-578)）；结果经由频道传递，失败时还经由持久的 `agent.error`。原本内联运行回合的 `user_message/2` 「已移除」：名字保留，它就是接受。
2. **回合进行中的第二条消息是 `409 turno_em_andamento`**，线程中有来源为 `politica` 的 `agent.error`——包括 kickoff 期间，以前在那里消息会在进程队列中被卡住整个回合。
3. **「Parar」能到达 Infra Lead**（`cancel/2` 中的 `via_for("infra")`）：杀死 Task——以及在合并中运行的 `WorkflowsAgent`——，写入 `agent.error` `cancelado_pelo_usuario` 并恢复 `idle`。
4. **与 Workflows 的合并是回合函数的一部分**，返回 `state`；结束信号（`agent.done`、`agent.status: idle`）只来自服务器进程中的 `TurnoAssincrono`（[RN-585](#rn-585)）。
5. **回合进行中到达的 gate 修正进入一个「队列」**（`correcoes_pendentes`），在回合收尾时按到达顺序启动——没有 `from` 的 `TurnoAssincrono` 会「丢弃」遇到进行中回合的请求，gate 就会向无人请求修改。
6. **重启造成的孤儿回合会关闭**，按 [RN-586](#rn-586)：`infra` 进入了 `TurnoOrfao`（`@agentes`），在启动时和 `init/1` 中。
7. **历史来自 `Engine.Agents.Reidratacao`**（[RN-580](#rn-580)），一如既往，`tool.result` 来自 `ResultadoDeFerramenta`（[RN-593](#rn-593)）。
8. **迭代上限是它自己的，14**（与 Arquiteto、Dev Lead、UX Designer 和 Staff 相同），耗尽时开始发出 `toolloop.limit_reached`（[RN-166](#rn-166)）——以前第 14 步会沉默地结束。

**第 2 阶段——输入框。**

9. **`message/2` 为 `infra` 提供「自己的」子句**，它的 `agente_sem_conversa` 拒绝已移除——一个名字，一条路径。`@agentes_de_conversa` 包含它；发给未在运行（engine 已重启）的 Infra Lead 的消息会在「不」进行 kickoff 的情况下重新拉起它，它在 `init/1` 中重新水合。
10. **界面按一贯的规则提供它**：`infra` 进入了 `AGENTES_DE_CHAT`，所以当它是最近的 `agent.activated` 时就是收件人——没有默认收件人（RN-584）。「它的」handoff 的接受仍在 [RN-499](web.md#rn-499) 自己的卡片中；线程的卡片按「名称」排除它（`offeredHandoff`），否则邀请会出现两次，而且作为较早的那个，会重新隐藏 Dev Lead 的（[RN-136](web.md#rn-136)）。活动条为它的四个工具获得了语句。
11. **对话不会打开外部效果。** 工具还是同样的四个；infra 的 PR 和两种容器启动仍以 `proposed_action` 诞生，[RN-566](#rn-566)、[RN-577](#rn-577) 和 [RN-610](#rn-610) 的本地拒绝保持不变。

**180 秒的上限对回合不再重要。** 它小于容器 `propose_action` 的 225 秒（[RN-605](contracts.md#rn-605)），一条让模型提议 `container_start` 的消息可能在提议仍在进行时让 `GenServer.call` 超时。有了立即接受，`GenServer.call` 只等待接受；`propose_action` 在 Task 内运行，没有人同步等待。180 000 保留下来，与其他六个相同，作为「接受」的上限。

**不变的，已声明：** `SOLO_CONVERSATIONAL_AGENTS`（由 `pnpm --filter api gerar:areas` 生成）是手动 handoff 所寻址的、「没有」区域的代理列表；Infra Lead 是区域 lead，仍不在其中，而 `AGENTES_DE_CHAT` 不是生成的。Infra Lead 没有获得结构化问题，也没有 backlog 读取——与它对话就是与 kickoff 给它的东西和四个工具对话。

- **代码：** `apps/engine/lib/engine/infra/infra_lead_server.ex:187`
  （`user_message`）、`:211`（`TurnoOrfao.fechar_ao_subir`）、`:248`
  （`handle_cast(:kickoff`）、`:270`（`handle_cast({:correct`，队列）、`:280`
  （`handle_cast(:cancel`）、`:296`（`handle_call({:user_message`）、`:355`
  （`handle_info`）、`:373`（`drenar_correcao_pendente`）、`:420`
  （`toolloop.limit_reached`）、`:1085`（`concluir`）；

  （`toolloop.limit_reached`）、`:1057`（`concluir`）；
  `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:44`
  （`@agentes_de_conversa`）、`:192`（`infra` 的子句）、`:592`
  （`via_for`）；`apps/engine/lib/engine/agents/turno_orfao.ex:57`（`@agentes`）；
  `apps/web/src/lib/session-readiness.ts:37`（`AGENTES_DE_CHAT`）；
  `apps/web/src/lib/session-handoffs.ts:120`（`ofertasAcionaveis`）
- **测试：** `apps/engine/test/engine/infra/infra_lead_server_test.exs:1033`
  （立即接受，之前写入 `working`）、`:1048`（回合进行中的 409——失败用例）、`:1077`（「Parar」）、`:1103`（没有回合时的「Parar」）、`:1107`（队列中的 gate 修正）、`:1788`（`toolloop.limit_reached`）；
  `apps/engine/test/engine/agents/turno_orfao_test.exs:76`（孤儿，现在是七个）；`apps/engine/test/engine/agents/reidratacao_dos_seis_test.exs:62`（重新水合，七个）；
  `apps/engine/test/engine_web/controllers/agent_command_controller_test.exs:236`
  （经由路由的 202、409 和「Parar」）、`:283`（不带 kickoff 重新拉起）；
  `apps/web/src/routes/SessionPage.cancelar-turno.test.tsx:256`（输入框发送给 Infra Lead，「Parar」属于它）；
  `apps/web/src/lib/session-readiness.test.ts:123`；
  `scripts/ci/destinos-do-composer.spec.ts:174`（守卫：`infra` 是目标，带「一个」对话子句）
- **来源：** AT-141（维护者的决定），由 AT-098 开启

### RN-621 — 压缩的摘要保持每个回合的原始语言，不翻译引文和代码 {#rn-621}

当代理的上下文超过阈值时，`ContextManager` 把旧回合换成「一个」摘要，由另一次 LLM 调用写出（执行者 `context-manager`），并作为 `system` 消息重新插入。这次调用的提示词是 pt-BR，且对语言只字未提：在英语对话或双语对话中，摘要会被翻译，下一个模型以摘要提示词的语言读取自己的记忆——这正是语言史诗所追查的语言偏移，诞生于用户回合之外。回合的语言指引保护不了这一点：它从不在 `messages` 中，所以从不被概括，但也从不被摘要器看到。

规则是摘要提示词中的一句话，在「两条」轨道上（内联文本以及版本化模板 `prompts/context-manager-summarize.md`，后者升到版本 `"2"`）：

> Mantenha cada turno no idioma original; não traduza citações nem código.

1. **语言是「按回合」的**，绝不是会话的语言：在有两位不同语言作者的会话中，两种语言都在摘要中保留下来。
2. **引文和代码是字面文本**，不翻译——在摘要中被翻译的标识符或错误消息就再也找不到了。
3. **这句话在回合「之前」**，这样位于提示词末尾的某个回合的文字不会被当作它的延续。
4. **代价：** 增加了 76 字节——按 engine 的启发式（字节/4）是 19 个 token，按每 2 字节 1 个 token 的悲观尺子最多 38 个——，在维护者为语言指引决定的每次调用 50 个输入 token 上限之内（AT-169，回答 8）。测试会否决按两把尺子超出上限的语句。
5. **不是 `agent_instructions`：** 它是代码和版本化模板中的文字，不在 `instruction_patch` 的上限之内（[RN-007](api.md#rn-007)），因为摘要器不是项目代理，没有按项目的指令。

**在没有基线的情况下决定，已声明：** 维护者决定现在就改提示词，不等付费验证显示 pt-BR 摘要会偏移（AT-169，回答 4）。后果是 AT-167 的验证测量的是「组合」（指引 + 新摘要），没有单独测量旧摘要。

**本规则「不」关闭的，已声明：**

- **开启 `graph_templates_enabled?` 时，有效的是图中「激活」的版本。** 播种了版本 `"1"` 的安装会继续发送旧提示词，直到再次运行 `scripts/dev/seed-prompts.ts`——正文的哈希变了，所以播种器会创建新版本。关闭该标志时（默认）有效的是内联的，它已经有这句话。再次播种还会从正文中移除那一节文档，它曾让摘要器收到两遍回合（AT-244，见 [RN-413](infra.md#rn-413)）；模板处于版本 `"3"`。
- **摘要器失败时的回退**（`"(N turnos anteriores
  omitidos)"`）不是摘要，不加这句话：其中没有回合文字。
- **这句话是 pt-BR。** 它要求的是每个回合的语言，而不是提示词的语言；模型在其他语言的对话中是否遵守它，是 AT-167 的验证所测量的。

- **代码：** `apps/engine/lib/engine/harness/context_manager.ex:214`
  （`@instrucao_de_idioma`）、`:276`（`prompt_inline`）、`:233`（`prompt`，模板与内联之间的选择）；`prompts/context-manager-summarize.md`
- **测试：** `apps/engine/test/engine/harness/context_manager_test.exs:417`
  （正常路径：发给摘要器的提示词带有这句话，位于回合之前）、`:433`（50 个 token 的上限，按两把尺子）、`:443`（版本化模板带着「同一」句话）、`:453`（摘要器失败：回退不假装是摘要，也不加这句话）
- **来源：** AT-166，在 AT-081 中规定，由 AT-169 解锁（维护者 2026-09-28 的决定）

## 代理回复的语言（RN-618..620、RN-622..624、ADR 0177）

### RN-622 — 语言作为该轮每次调用的「最后一条」消息到达模型，且是临时的：有作者时用「作者」的语言，没有时用「项目」的语言 {#rn-622}

RN-618..620 决定了 agent 用「哪种」语言回复，并在界面上显示出来；但这些都没有传到模型。本规则就是这条传输通道（AT-164，基于 AT-081 的规格以及 AT-161 中按 provider 验证过的机制）。

1. **在该轮的每次 LLM 调用中，于列表「末尾」加一条 `role: "system"` 消息**——包括工具迭代——且「绝不」进入历史：它不进入 `state.messages`，因此不会在轮与轮之间累积，不会被压缩摘要（[RN-621](#rn-621)），并随该轮一起消失。在 OpenAI 兼容格式中它放在对话末尾；在 Anthropic 中它被提升到顶部 `system` 的末尾（AT-161）。它不是 `agent_instructions`：它是代码中的文本，不受 `instruction_patch` 上限约束（[RN-007](api.md#rn-007)）。
2. **只有一个地方。** 负责追加的是门面 `EngineApiClient`（`llm_turn/5` 和 `llm_turn_stream/6`），engine 的「所有」LLM 调用都经过它——七个对话型 agent、`ToolLoop`（dev agents 和 gates）以及 Infra Lead。没有任何服务器自行组装这条指引。
3. **「有」人类作者的轮次**（某人输入给某个 agent 的消息）：api 解析出「该」人在该会话中的语言（`ResolverIdiomaDaRespostaUseCase`，[RN-618](api.md#rn-618)——会话覆盖 > 账户 > 已确认的检测结果 > 界面），并在 `agent/message` 命令中以 `idiomaDaResposta` 发送，这是一个「可选」字段。agent 的服务器在 `handle_call` 期间把它放入「该轮」的状态，该轮的 Task 从进程字典继承它（`TurnoAssincrono`）；GenServer 不会为下一轮保存它。同一会话中的两位作者各自收到自己的语言。
4. **「没有」人类作者的轮次**（kickoff、dev agents、gates、commit、PR 正文、Dev Lead 在审批后的恢复）：使用「项目」的语言（[RN-619](api.md#rn-619)），每次调用时从 `projects.language` 读取（维护者的决定，AT-169 第 1 条答复）。
5. **压缩摘要器（`context-manager`）不在此列**：「用 X 回复」会把摘要翻译掉，而在摘要中保留每一轮的语言是 [RN-621](#rn-621) 的职责。
6. **失败绝不中断该轮。** api 中解析失败会记入日志，消息继续发送但「不带」`idiomaDaResposta`；有作者但没有语言的轮次继续进行且「不带」指引——绝不用项目的语言代替该人的语言。engine 中读取项目语言失败会变成 `warning`，调用继续进行且不带指引。不具备 BCP-47 代码形式的值也不会变成指引：任何不是代码的东西都不会被插入提示词。
7. **文本**是代码常量，每种语言一条：`pt-BR`（"Responda em português brasileiro (pt-BR), salvo pedido explícito do usuário por outro idioma nesta mensagem."）、`en`，以及一条英文通用文本，为开放列表中的任何其他语言写明其 BCP-47 代码（AT-168 第 2 条答复）。文本不依赖模型：在会话中途切换模型不会改变任何东西，也没有按模型的级联或针对 DeepSeek 的特殊情况。
8. **成本**——已决定的上限是每次调用 50 个「输入」token（AT-169 第 8 条答复）。用 `gpt-tokenizer` 测量，只算内容，cl100k / o200k：`pt-BR` 29 / 23，`en` 18 / 18，通用 `es-MX` 26 / 26，「最坏」情况（通用文本配上被接受形式中最长的代码）42 / 42；消息框架约加 4，因此最坏情况约为 46。测试把文本锁定在 160 个字符，作为上限的看守。
9. **测量：** api 记录的 `chat.message` 在解析成功时带有 `idiomaAlvo` 和 `origem`——事件不可变，永远说明该轮向模型要求了什么（AT-082）。

**本规则「不」覆盖的内容，已声明：**

- **没有 agent 的人类聊天**（`SendChatMessageUseCase`）不在此列，依维护者的决定（AT-169 第 3 条答复）。
- **只有发给 agent 的「消息」带有作者**（以及复用它的结构化提问表单的回答）。一个人触发的其他命令——向 Criativo 确认就绪、接受 handoff——发起的是没有作者的轮次，落到「项目」的语言：`confirmReadiness` 的 product brief 以项目的语言输出。
- **有作者的轮次中的产物**：本规则原先声明它跟随书写者的语言；自 [RN-623](#rn-623) 起，同一条消息增加了产物子句，使用项目的语言。
- **未测量：** DeepSeek 和 Anthropic 的分词器；指引能否压过 pt-BR 的系统提示词，由 AT-167 的付费验证来测量。在 Anthropic 中，提升到顶部的指引会在每次更换作者或语言时改变缓存前缀——缓存目前不可观测。

- **代码：** `apps/engine/lib/engine/harness/idioma_da_resposta.ex:294`
  （`anexar`），`:253`（`com_idioma_do_autor`），`:161`（`orientacao`），`:94`
  （`@sem_orientacao`），`:301`（`texto_do_turno`），`:326`
  （`idioma_do_projeto`）；
  `apps/engine/lib/engine/sessions/engine_api_client.ex:685`
  （`IdiomaDaResposta`），`:783`（`IdiomaDaResposta`）；

  `apps/engine/lib/engine/sessions/engine_api_client.ex:685`
  （`IdiomaDaResposta`），`:783`（`IdiomaDaResposta`）；
  `apps/engine/lib/engine/projects/project.ex:64`（`idioma`）；
  `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:515`
  （`idioma_da_resposta`）；
  `apps/engine/lib/engine/agents/criativo_server.ex:136`（`handle_call`，其余六个中也是「同一」子句）；
  `apps/engine/lib/engine/agents/turno_assincrono.ex:134`
  （`copiar_dicionario`）；
  `apps/api/src/application/use-cases/agents/send-agent-message.use-case.ts:168`
  （`resolverIdioma`），`:74`（`idiomaAlvo`）；
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts:203`
  （`idiomaDaResposta`）
- **测试：** `apps/engine/test/engine/harness/idioma_da_resposta_test.exs:78`
  （无作者：项目的语言，位于末尾），`:123`（有作者：作者的语言胜过项目的语言），`:134`（作者语言未解析：无指引），`:98`（查询失败——失败情形：列表完好并记日志），`:93`（摘要器不在此列），`:67`（50 token 上限的看守），`:340`（端到端：作者的语言位于每次调用末尾且不在历史中），`:370`（门面在 `llm_turn/5` 中同样追加）；
  `apps/engine/test/engine_web/controllers/agent_command_controller_test.exs:402`
  （命令把语言带到模型），`:414`（字段无效：被接受，无指引）；
  `apps/api/test/application/use-cases/agents/send-agent-message.use-case.spec.ts:109`
  （按作者和会话解析——会话覆盖胜出），`:125`（解析失败不会中断消息——失败情形）；
  `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts:528`
  （字段只在解析成功时传递）
- **来源：** AT-164，规格见 AT-081，由 AT-168 和 AT-169 的决定解锁（维护者，2026-09-28）；机制在 AT-161 中验证

### RN-623 — 在「有」作者的轮次中，回复使用该人的语言，而共享的「产物」使用「项目」的语言 {#rn-623}

[RN-619](api.md#rn-619) 承诺共享产物使用项目的语言，而 [RN-622](#rn-622) 在每个有作者的轮次中放入了「作者」的语言——于是 agent 在与某人对话「期间」写下的东西都以该人的语言输出。维护者的决定（AT-168 第 8 条答复，AT-245）：**产物跟随「项目」**；聊天回复仍使用作者的语言。

1. **机制就是 RN-622 的同一条消息，加上第二个子句。** 在有作者的轮次中，当调用至少携带一个写入共享产物的工具，且项目的语言（`projects.language`）与作者的语言「不同」时，指引变为「Responda em português brasileiro (pt-BR), salvo pedido… **Artefatos do projeto: em en.**」——使用基础文本的语言：`pt-BR` 的子句是葡萄牙语，其余的是英语（"Write project artifacts in X."）。它仍是末尾的「一条」临时 `system` 消息，由门面组装；决定因素是「同一」次调用带给模型的工具集合，门面已经掌握它。
2. **为什么用指引，而不是工具描述。** 描述在「每次」调用中、随每个工具传递，无论语言是否相同；子句只在两者不同时存在，并且位于唯一已经决定语言的地方。语言相同时、调用不含产物工具时、以及在「没有」作者的轮次中（它已经收到项目的语言），不追加任何东西。
3. **什么是共享产物**——工具「持久化」的内容会被其他人和后续 agent 阅读：
   - `emit_artifact`（`business_rule`、`note`、`decision_record`）——Criativo、PO、Arquiteto、Dev Lead、UX Designer、Staff；
   - `create_epic`、`create_story`、`create_task`——PO；
   - `create_module_map`、`assign_story_modules`、`choose_project_image`、
     `create_c4_diagram`、`route_modules_to_infra`、`propose_adr`（`open_adr_pr` 的 ADR）、`emit_insight`——Arquiteto；
   - `propose_execution_plan`、`assess_implementability`——Dev Lead；
   - `propose_prototype`——UX Designer；`propose_rfc`——Staff；
   - `propose_infra_pr`——Infra Lead。
   product brief「不」经过这里：它由「服务器」在 `confirmReadiness` 中发出，那是没有作者的轮次，已经以项目的语言输出（handoff 和 revise 也一样，本规则不改变它们）。
4. **「不」属于产物的：** `ask_structured_questions`（是向该轮的「人」提问）、`offer_handoff`（不带文本）、读取类工具（`listar_*`、`rag_*`、`read_file`、`search_workspace`）、`validate_infra_file`（只做校验）以及启动容器的提议（要求决定，不写产物）。dev agents 和 gates 没有有作者的轮次。
5. **失败绝不中断该轮。** 读取项目语言失败会变成 `warning`，并「只」保留作者的指引——绝不是没有指引，也绝不用项目的语言代替该人的语言。作者语言未解析时不带指引，同 RN-622。
6. **成本**——AT-169 的 50 个输入 token 上限适用于整条消息。用 `gpt-tokenizer` 测量，只算内容，cl100k / o200k，覆盖 `pt-BR`、`en`、`es`、`es-MX` 和 `zh-Hant-TW` 的所有组合：最坏情况 `pt-BR` → `zh-Hant-TW` 42 / 36；`en` → `pt-BR` 26 / 26；通用 `es-MX` → `zh-Hant-TW` 36 / 36。只有「两个」代码都是简短规范形式（`idioma[-Escrita][-Região]`，例如 `pt-BR`、`zh-Hant-TW`、`es-419`）时才加入该子句，因为正是这种「形式」守住了上限：其最坏情况（`pt-BR` → 12 个字符的代码）为 44 / 37，加上消息框架约 48。不符合这种形式的代码只保留作者的指引，并记入日志。测试把每一对锁定在 165 个字符，作为看守。

**本规则「不」覆盖的内容，已声明：** 列表按工具「名称」——写入产物的新工具要在同一个 PR 中加入列表（测试把每个名称绑定到一个存在的 spec，但不会发现新工具）。模型是否「遵循」同一消息中的两个子句，由 AT-167 的付费验证来测量；DeepSeek 和 Anthropic 的分词器仍未测量。

- **代码：** `apps/engine/lib/engine/harness/idioma_da_resposta.ex:174`
  （`orientacao`），`:127`（`@ferramentas_de_artefato`），`:118`
  （`@forma_curta`），`:301`（`texto_do_turno`），`:319`（`grava_artefato?`），
  `:320`（`idioma_do_projeto_para_o_artefato`）；
  `apps/engine/lib/engine/sessions/engine_api_client.ex:685`
  （`IdiomaDaResposta`），`:783`（`IdiomaDaResposta`）；

  `apps/engine/lib/engine/sessions/engine_api_client.ex:685`
  （`IdiomaDaResposta`），`:783`（`IdiomaDaResposta`）；
  `apps/web/src/routes/settings/ProjectLanguageSection.tsx`
- **测试：** `apps/engine/test/engine/harness/idioma_da_resposta_test.exs:157`
  （语言不同：指引说明两者），`:168`（相同：只有一个），`:175`（代码不符合简短形式：只用作者的，并记日志），`:190`（上限的看守），`:204`（列表中的每个名称都是存在的 spec），`:235`（作者 pt-BR、项目 en，在同一条消息中），`:259`（没有产物工具：只用作者的），`:290`（项目语言不可读——失败情形：只用作者的，并记日志），`:316`（无作者：没有变化），`:340`（经由 Criativo 的端到端）；`apps/web/src/routes/settings/idioma-do-projeto.test.tsx:84`
- **来源：** AT-245，基于 AT-168 的决定（第 8 条答复）以及维护者 2026-09-29 的决定

### RN-625 — 循环向 Jev 询问用哪个工具，用户的模型只看到剩下的菜单；Jev 只做限制，从不决定 {#rn-625}

维护者的决定（AT-236，2026-09-28），以及关于标准的决定（2026-09-29）：在 agent 的每次聊天调用之前，api 先问 Jev（`typesafe/jev-1.13`，OpenRouter 的 Decisions API）该步骤适合哪个工具，聊天 provider 只收到 P3 策略从该回答中得出的**菜单**。机制见 [ADR 0179](../adr/0179-o-laco-pergunta-ao-jev-qual-ferramenta.md)；采用决定及其数字也在其中。

1. **何时。** 仅当该轮模型的 provider 为 `openrouter`、请求中有两个或更多工具、该轮有 agent（Anamnese 和压缩摘要器除外）、engine 没有请求 `catalogoCompleto`，且工作区已开启（`workspaces.tool_router_enabled`，默认开启，`PUT workspaces/:workspaceId/tool-router`，`owner`）。任一条件不满足：不调用，也不产生事件。provider ≠ `openrouter` 时连工作区都不读取。所用密钥是工作区持有人的，与聊天相同（RN-058）。
2. **策略是 P3，只做限制。** 菜单 = {Jev 的选择，「同一」次执行中的上一个工具}。Jev 返回 `responder_sem_ferramenta`，或该步骤的目录中没有上一个工具，则保留「完整」目录。没有 `tool_choice`（模型仍可以用文本回答），v1 中也没有置信度阈值：置信度会被记录，由 AT-239 提出一个阈值。采用标准：**80%**，负责人 2026-09-29 的决定——Jev 的 top-1 为 73%（66–79），P3 的菜单覆盖率 91%（85.1–94），top-2 为 90%；覆盖率是端到端准确率的「上限」（回放中 62%–91%），真实验证是 AT-239。
3. **`state`** 是产品在该步骤之前已有的内容，从 engine 已发送的 `messages` 中截取，不读数据库：`agente` = `agentId`；`contexto` = 放在最前面的 `system` 消息的开头（1,500 个字符），该消息由 `ToolLoop` 放置（`apps/engine/lib/engine/harness/tool_loop.ex:98`，`system_msg`，由 `system_prompt/1` 在 `:316` 处组装）；`pedido` = 最后一条 `user` 消息——在执行型 agent 中是循环的初始消息（`apps/engine/lib/engine/dev/dev_agent_server.ex:484`，`initial_message/2`，或 `:523` 处的修正消息），在对话型 agent 中是该人的发言；`passos_recentes` = 该消息之后最近 6 次工具调用，每次调用一条，参数和结果截断到 500 个字符——结果来自循环附加的 `tool` 消息（`tool_loop.ex:293`，`concluir_despacho/5`，带 `toolCallId`）。当前执行指「最后一条 `user` 之后」，因为 `ctx.messages` 在每次 `ToolLoop.run` 时重新开始。上限 8 千 token；超出则回退 `estado_grande`。
4. **该轮绝不因 Jev 而失败。** HTTP 错误、超时（2,000 ms，`TOOL_ROUTER_TIMEOUT_MS`）、网络错误、意外的 JSON、选项之外的选择、状态过大以及与保留名称冲突：provider 收到完整目录，事件带上 `motivoDaQueda` 和 `origemDaQueda`（`infra`、`modelo` 或 `codigo`——RN-059），绝不静默。
5. **策略不变。** Jev 不批准、不拒绝，也不选择模型。被选中的工具若需要审批仍需审批；调用菜单之外的工具照常派发，事件只记录 `foraDoCardapio`。迭代上限与之前相同（对 Jev 的调用不算一次迭代）。
6. **按步骤记录。** engine 记录 `tool_router.decided`，位置在门面 `EngineApiClient` 中，适用于所有 agent，包含前后的菜单、选择、置信度、第二选项、`aplicado`、回退、延迟、实际成本和 `foraDoCardapio`。api 为 Jev 记录「一行」`token_usage`：角色 = agent 本身（花费计入区域预算，ADR 0110），`modelName =
   typesafe/jev-1.13`，`modelId` 为空，`estimated = false`，`costMicros` = 响应中的 `usage.cost`，每百万的价格是「隐含」的（`custo ÷ tokens`），带 `price_implicit = true`——保持 RN-044 的 `tokens × preço = custo`，而不捏造目录价格。响应中没有 `usage.cost` 就没有这一行。在 Jev 和聊天之间不会重新查询预算 gate。
7. **走出死胡同。** 菜单被限制后，模型回答时没有调用工具（也没有可恢复的文本形式），且 provider 没有报错：门面以 `catalogoCompleto: true` 把该步骤重做「一次」，跳过 Jev。在流式中，只有当还没有向该人写出任何内容时才这样做。它要求的是更多工具，绝不是 agent 原本没有的工具。

**本规则「不」覆盖的内容，已声明：** 界面（显示该步骤经过了路由、显示置信度，以及通过 `tool_routing_started` 帧显示「正在选择工具」条）属于 `apps/web`；收益属于 AT-239；OpenRouter 收了费但没有返回 `usage.cost` 的超时不进入 `token_usage`；该端点是 ALPHA，由手动 smoke（`jev-tool-router.smoke.spec.ts`，上限 0.05 美元）发现变化。

- **代码：** `apps/api/src/domain/llm/tool-router.ts:27`（`MODELO_DO_JEV`），
  `:109`（`montarPedidoAoJev`），`:166`（`lerRespostaDoJev`），`:216`
  （`recortarEstado`），`:268`（`menuP3`）；
  `apps/api/src/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.ts:118`
  （`preparar`），`:143`（`executar`），`:305`（`registrarGasto`）；
  `apps/api/src/application/use-cases/llm/run-llm-turn.use-case.ts:152`
  （`decisaoDoJev`）；`apps/api/src/application/use-cases/llm/stream-llm-turn.use-case.ts:167`
  （`preparar`）；`apps/api/src/infrastructure/llm/jev-tool-router.ts:32`
  （`decidir`）；`apps/api/src/db/schema/iam.ts:169`（`toolRouterEnabled`）；
  `apps/api/src/db/schema/llm.ts:356`（`priceImplicit`）；
  `apps/engine/lib/engine/harness/roteamento_de_ferramenta.ex:60`（`registrar`），
  `:112`（`custo_micros`），`:123`（`repetir_com_catalogo_inteiro?`），`:146`
  （`mesclar_repeticao`）；`apps/engine/lib/engine/sessions/engine_api_client.ex:700`
  （`llm_turn`），`:773`（`llm_turn_stream`）；

  （`mesclar_repeticao`）；`apps/engine/lib/engine/sessions/engine_api_client.ex:700`
  （`llm_turn`），`:773`（`llm_turn_stream`）；
  `apps/engine/lib/engine/harness/tool_loop.ex:132`（Jev 的成本计入本地预算）
- **测试：** `apps/api/test/domain/llm/tool-router.spec.ts:25`（`questions` 是对象），`:86`（意外的形式变为回退——失败情形），`:138`（`state`），`:210`（P3）；
  `apps/api/test/infrastructure/llm/jev-tool-router.contract.spec.ts:60`（录制的响应），`:121`（HTTP 错误），`:130`（超时），`:142`（网络），
  `:149` 和 `:154`（意外的 JSON），`:163`（选项之外的选择）；
  `apps/api/test/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.spec.ts:186`
  （provider ≠ openrouter 不调用），`:222`（工作区关闭），`:255`
  （状态过大），`:277`（P3），`:318`（无工具 = 完整目录），
  `:331`（无上一个 = 完整），`:352`（策略不变），`:369`（各种回退），`:456`（计量，计入区域预算）；
  `apps/engine/test/engine/harness/roteamento_de_ferramenta_test.exs:67`（事件），`:103`（事件中的回退），`:180`（走出死胡同），`:288`（循环中的成本），`:299`（审批仍然必需），`:325`（路由不知道策略）
- **来源：** AT-238，基于 AT-235 的规格、AT-236 的十六项决定、AT-237/AT-280 的测量以及负责人 2026-09-29 的决定（80% 标准）

## 在聊天中决定，就在负责人所在的地方（RN-626）

### RN-629 — QA Lead 对在恢复时「再次」挂起的子 agent 与第一次一样处理，未知的结果变为命名的阻塞 {#rn-629}

`qa-automacao` 会运行多个命令，每个都可能请求人工审批。`QaLeadServer` 在 `run/5` 返回 `{:awaiting, _}` 时已经会停下该区域（发现 AB，ADR 0052），但「恢复」（`retomar/3`，决定到达时）返回的是一个可能「再次」挂起的循环的结果——而这第二个 `{:awaiting, _}` 进入了已收集结果的列表，仿佛是一份意见。合并时，`registrar_resultado/5` 没有针对它的子句，GenServer 崩溃（`FunctionClauseError`，测于 2026/09/29：06:55:01 和 07:00:10），使三个已交付的 task 永远停在 `awaiting_qa`，没有裁决，也没有命名的结局。

1. **只有一个地方决定如何处理子 agent 的结果**（`tratar_resultado/6`），无论结果来自 `run/5` 还是 `retomar/3`。`{:awaiting, _}` 保存进行中的状态（以新操作为键），让 `gate_states` 那一行和子 agent 保持在 `in_progress`，并「停下」该区域：没有裁决，不阻塞 task，不记录委派。负责恢复的仍是 `{:action_settled, _}`（来自 `Engine.Dev.Wake`，ADR 0086），需要多少次就多少次。
2. **lead 不认识的结果绝不导致崩溃，也绝不消失**（RN-059）：它变成 `{:blocked, …}`，来源为 `codigo`（这里缺了一个子句，不是 infra、模型或策略问题），`registrar_resultado/5` 把它记录为 `failed` 的委派，`QaLead.consolidar/1` 把它变为带来源的 task 阻塞。

**已声明，未解决：** lead 挂起时 engine 重启会丢失在 Wake 中的订阅（ADR 0086 已接受的缺口）；`GateRescuer` 重启整个区域（ADR 0067），不恢复 `ctx`。本规则不改变 ADR 0090（QA 策略的时机），也不改变子 agent 的迭代上限。

- **代码：** `apps/engine/lib/engine/gates/qa_lead_server.ex:127`
  （`handle_info`），`:233`（`tratar_resultado`），`:230`（未知结果）
- **测试：** `apps/engine/test/engine/gates/qa_lead_server_test.exs:325`
  （恢复时的第二次挂起：保持挂起，不作任何决定，第二个决定完成该区域）；`:278`（一次挂起，正常路径）
- **来源：** AT-248，基于 2026-09-29 真实使用分析的发现 E2

### RN-636 — AppSec 只向尚未收到提议且未激活的一方提供 threat model {#rn-636}

AppSec 原先对每个带 `run_design` 的故事创建三个提议，发往同样的三个目标——N 个故事，3N 个待处理提议（AT-292，依负责人的决定合并了 vault 中的 AT-273；[ADR 0182](../adr/0182-ciclo-de-vida-do-handoff.md)）。

1. **以 `seAusente` 模式询问。** `criar_handoffs_appsec/3` 调用 `EngineApiClient.create_handoff_if_absent/5`，它向「同一个」内部路由发送 `seAusente: true`。api 在目标的锁下决定（[RN-635](api.md#rn-635)）：项目「任何」会话中有待处理提议时，返回现有的（`desfecho: ja_oferecido`），不取代它；目标已激活时，409 `agente_ja_ativo`。由 engine 事先询问会与另一个提议产生竞争。
2. **「已处理」不是失败。** 上述两种回应都不产生 `agent.error`。真正的失败（5xx、网络）仍按目标叙述，并带来源（[RN-116](#rn-116)，[RN-361](#rn-361)）。
3. **产物保留。** `artifact.threat_model` 在「之前」写入，而且无论如何都写入；不再产生的是重复的提议。

- **位置：** `apps/engine/lib/engine/gates/secops_agent_server.ex:362`
  （`criar_handoffs_appsec/3`）；
  `apps/engine/lib/engine/sessions/engine_api_client.ex:1131`

  `apps/engine/lib/engine/sessions/engine_api_client.ex:1211`
  （`create_handoff_if_absent`）；
  `apps/api/src/domain/sessions/ciclo-de-vida-do-handoff.ts:71`
  （`decidirOferta`）
- **测试：** `apps/engine/test/engine/gates/secops_agent_server_test.exs`
  （"run_design (RN-636): destino com oferta pendente ou já ativo não recebe
  outra, e isso não é erro"，"run_design (RN-636): falha de verdade ao
  oferecer segue narrada, só para aquele destino"）；
  `apps/api/test/application/use-cases/agents/ciclo-de-vida-do-handoff.spec.ts`
  （"`seAusente` (AppSec, RN-636)…"）
- **来源：** AT-292，AT-273

## dev agent 的 PR 指向 `dev`，gate 评判该 PR 的 diff（RN-664）

### RN-664 — agent 的工作从 `dev` 产生，它们的 PR 指向 `dev`，gate 针对 `dev` 评判 diff——三者一起 {#rn-664}

产品的分支策略要求工作从 `dev` 产生（bootstrap 创建 `dev` 和 `qa`，基于 `main`，[RN-582](api.md#rn-582)），但此前没有人把 agent 指向它：dev agent 的 `pr_open` 不带 `targetBranch`，api 用 `repo.defaultBranch`（`main`）补全；Arquiteto 的 ADR PR 从 `main` 产生并指向 `main`；项目的工作树打开 `default_branch`；gate 针对它计算 diff；QA 的上下文写着「Repositório · branch main」（AT-250，9月29日真实使用的 A4 项）。每个 agent 的 PR 都跳过了 `dev → qa → main` 流水线。

负责人的决定（9月30日）：「三者」一起改用 `dev`——只改一个会让 gate 评判一个不是该 PR 的 diff。「工作」分支是 `dev`，而「不」是 provider 的 `default_branch`（后者仍是提升最后到达的分支，在它就是问题本身的地方继续被读取）：

- 项目的工作树打开 `dev`（`ensure_remoto/2` 在选择基准时忽略远程的 `default_branch`），每个 dev agent 的 worktree「显式」从 `dev` 产生，而不是从 HEAD——本规则之前初始化的工作区停在 `default_branch` 上（就绪标记阻止重新初始化），它会得到本地的 `dev`，来自 `origin/dev`，无需新的 `fetch`；
- dev agent 的 `pr_open` 在 payload 中带 `targetBranch: "dev"`，api 在没有该字段时（之前提议的操作）用 `dev` 补全，而不再用 `defaultBranch`；ADR PR 从 `dev` 产生并指向 `dev`；
- gate 的 diff 是 `dev...HEAD`，项目的上下文行写着「Repositório · branch de trabalho dev」。

**「没有」`dev` 的仓库**（未经 bootstrap 接管的，或 bootstrap 没走到 `create_dev_branch` 的）：「不」回落到 `default_branch`——那将是 agent 在一个不是该 PR 基准的基础上工作、gate 在其上评判。每个点都以「命名」的方式失败，沿用它对缺失分支已有的行为，只有一个新的例外：工作树原先什么也不拒绝，创建一个「空的本地」`dev`（从未收到推送的 bare 的路径），标记就绪后再也不重新初始化。现在这条路径只适用于「没有任何」分支的远程；有分支但没有 `origin/dev` 时，初始化以命名的消息抛出（`mensagem_sem_branch_de_trabalho/1`，「o repositório do projeto não tem a branch `dev`… crie a branch… e tente de novo」），并撤销 `.git`（AT-112），因此下一次尝试在 `dev` 创建后会正常初始化。没有 `dev` 也没有 `origin/dev` 时，worktree 以同样的消息拒绝；diff 以点名该修订的 git 错误失败；provider 拒绝 PR（以及 ADR 分支的创建）并点名该 ref。`infra`（`open_infra_pr`）「没有」改变：仍从 `defaultBranch` 产生并指向它。

该值有意存放在「两个」地方，每种语言一个，并一起改变：api 中的 `BRANCH_DE_TRABALHO` 和 engine 中的 `branch_de_trabalho/0`。

- **代码：** `apps/engine/lib/engine/projects/project_repository.ex:165`
  （`branch_de_trabalho`），`:176`（`branch_de_trabalho`），`:190`
  （`mensagem_sem_branch_de_trabalho`）；
  `apps/engine/lib/engine/actions/workspace.ex:70`（`ensure_remoto`），`:224`
  （`init_from_bare!`），`:272`（`remoto_vazio?`）；
  `apps/engine/lib/engine/actions/workspace/runner_git.ex:158`（`add_worktree`），
  `:183`（`garantir_base`），`:308`（`remoto_vazio?`）；
  `apps/engine/lib/engine/dev/worktree_manager.ex:36`（`create`），`:138`
  （`add_worktree`），`:201`（`garantir_base`）；
  `apps/engine/lib/engine/dev/agent_io.ex:427`（`propose_pr`）；
  `apps/engine/lib/engine/gates/diff.ex:29`（`compute`）；
  `apps/engine/lib/engine/harness/project_context.ex:29`（`repo_line`）；
  `apps/api/src/domain/actions/protected-branches.ts:26`（`BRANCH_DE_TRABALHO`）；
  `apps/api/src/application/use-cases/actions/execute-git-action.use-case.ts:208`
  （`targetBranch`）；`apps/api/src/application/use-cases/actions/execute-adr-pr.use-case.ts:86`
  （`fromRef`），`:99`（`targetBranch`）
- **测试：** `apps/engine/test/engine/gates/diff_test.exs:64`（diff 只是 agent 的改动，不含 `main` 的任何内容——正常路径），`:73`（没有 `dev` 时 diff 失败并点名修订——失败情形），`:91`（上下文说明工作分支）；`apps/engine/test/engine/actions/workspace_test.exs:87`，`:98`，
  `:110`（接管的仓库没有 `dev`：命名的拒绝，撤销 `.git`，创建分支后通过——失败情形），`:130`；
  `apps/engine/test/engine/dev/worktree_manager_test.exs:119`，`:127`
  （本规则之前的工作区），`:147`（没有 `dev` 也没有 `origin/dev`）；
  `apps/engine/test/engine/dev/dev_agent_server_test.exs:114`；
  `apps/api/test/application/use-cases/actions/execute-git-action.use-case.spec.ts:184`，
  `:213`；`apps/api/test/application/use-cases/actions/execute-adr-pr.use-case.spec.ts:143`，
  `:151`（没有 `dev`，`failed` 并附 provider 的原因）
- **来源：** AT-250（9月29日真实使用分析的 A4 项），负责人 9月30日的决定

## 代理回复的语言（RN-618..620、RN-622..624、ADR 0177）

### RN-667 — 结构化表单跟随回复的语言：工具描述不固定任何语言 {#rn-667}

AT-167 的付费验证发现，对于偏好 `en` 的作者（C06/C12），`ask_structured_questions` 调用的**正文是英语，而表单中的问题是葡萄牙语**——在处理组的 DeepSeek 上，C06+C12 的 15 个回答中有 8 个如此。原因在产品内部，且只在一个地方：工具描述写着 `label` 是「问题的文本，**用 pt-BR**」。这是「第二条」语言指引，固定不变，位于 [RN-622](#rn-622) 的门面之外，在 Criativo 和 PO 的每次调用中与之竞争（两者使用「同一个」spec）。

1. **机制是去掉竞争的指引，而不是再加一条。** 描述改为「问题的文本，**使用你回复的语言**（`options` 同样适用）」，而示例仍是葡萄牙语，并标注「文本跟随你回复的语言」。它不点名「任何」语言：「哪种」语言仍只由 `Engine.Harness.IdiomaDaResposta` 的临时消息决定，门面 `EngineApiClient` 不变。
2. **RN-622/623 的指引逐字节保持不变。** 50 的上限中没有多出一个 token。`ask_structured_questions` 仍在 `@ferramentas_de_artefato` 之「外」（它是向该轮的人提问，[RN-623](#rn-623) 第 4 项），因此 `en` 作者在 `pt-BR` 项目中会收到英语的问题——这正是想要的结果。
3. **成本落在哪里。** 描述随每次携带该工具的调用传递，无论作者是谁：用 `gpt-tokenizer` 测量，只算改变的文本，cl100k 多 23 个 token，o200k 多 19 个（`label` 那一行 18/17 → 29/27；示例那一行 8/6 → 20/15）。这不是把指引搬进描述——这句话指向指引而不说出语言，被删掉的恰恰是说出一种语言的那句话。
4. **守护。** harness 的任何工具描述（`Engine.Harness.Tools.*` 的 22 个）都不能提到 `pt-BR`、`(en)`、"in English"、"em português" 或 "em inglês"——`emit_artifact` 的描述要求 payload 的「键」"em INGLÊS"，它不在此列，因为它讲的是契约，不是给人看的文本。

**本规则「不」覆盖的内容，已声明：** 付费的前后对比测量**没有运行**（做这次改动的机器上没有 OpenRouter 的密钥）——「之前」是 AT-167 的结果（处理组 DeepSeek：C06+C12 的 15 个回答中有 8 个表单是葡萄牙语），「之后」是**负责人的待办**：
`pnpm --filter @brabo/scripts idioma:validar --arquivo-de-chave ~/.config/brabo/openrouter-test.env --bracos tratamento --casos C06,C12 --rodadas 5 --teto-usd 0.5 --saida ~/.cache/brabo/validacao-idioma/at-282`，
随后在同一文件夹中执行 `idioma:validar --relatorio --saida`，并审查表单（标签 `formulario`，来自 `idioma:revisar`）。建议上限 0.50 美元：整个处理组在 17 个用例上花费 0.21 美元（DeepSeek）和 0.94 美元（Haiku），而这里只有 2 个。脚本从产品文件中读取描述，因此测量的是新文本，无需复制。如果描述中立后表单仍是葡萄牙语，下一步是在指引中加一个条件子句（只在调用携带 `ask_structured_questions` 时），而它必须装进 RN-623 的最坏情况（44 / 37），加上框架后已经约为 48。

- **代码：** `apps/engine/lib/engine/harness/tools/ask_structured_questions.ex:193`
  （`descricao`），`:44`（`spec`）
- **测试：** `apps/engine/test/engine/harness/tools/ask_structured_questions_test.exs:199`
  （描述要求跟随回复的语言），`:207`（不点名语言——失败情形：旧形式 "em pt-BR" 被同一标准拒绝），`:214`（harness 的工具都不固定语言）；
  `scripts/idioma/validacao.spec.ts:60`（测量读取新描述）
- **来源：** AT-282，来自对 AT-167 的人工审查（PR #750，9月29日）；在维护者于 2026-09-30 批准的轮次中加入

## Infra Lead 不宣布它没有做的启动（RN-668）

### RN-668 — Infra Lead 的轮次关于容器启动宣布什么，由代码决定，而不是模型的文本 {#rn-668}

这是把 [RN-163](#rn-163)（「不宣布代码不会执行的任何东西」）应用于 Infra Lead。在 9月29日的真实使用中（会话 `be70`，seq 282），它写道会与 infra PR「并行」启动容器，之后没有任何启动的 `tool.call`（AT-264）。代码中有两个原因，都在这里关闭：

1. **回应的整个批次在结束前都会被派发。** 被接受的 `propose_infra_pr` 会结束该轮，不再回到模型——这是「代码」在模型想继续时切断循环的唯一地方——但它会在批次「中途」停止派发：在「同一」回应中、PR 之后请求的 `propose_container_start`（或 `container_start_via_runner`）会消失，没有 `tool.call`，没有 `tool.result`，也没有提示。现在采用 Dev Lead 的形式（`propose_execution_plan`）：回应中的所有调用都运行，之后被接受的 PR 才结束该轮。同一回应中的第二个 `propose_infra_pr` 会带原因被拒绝（`tool.call` + `tool.result`，带 `ok: false`）——只有第一个会与 Workflows 合并。
2. **当启动「没有」被提议时，轮次的收尾用「服务器」的句子说明**——Criativo 合并结局的形式（`encerrar/2`）。决定依据的是循环执行了什么（本轮是否有被 api「接受」的启动提议？），绝不是模型写了什么；不读取它的文本。只在两种情况下说明：轮次因 PR 结束且没有提议任何启动；或尝试过启动、被拒绝，之后没有被接受的提议。从未涉及启动的轮次（一个问题、一次 gate 修正）不加任何句子，已「登记」为 `running`/`provisioning` 的容器也不加（与 `recusa_ja_de_pe/2` 相同的本地读取，没有 HTTP）。

kickoff 和 `propose_infra_pr` 的描述改为说明代码所做的：启动在 PR「之前」或在「同一」回应中，因为 PR 会结束该轮。这是对模型的帮助，不是保证——保证是第 2 项的收尾。

这里没有任何东西启动容器或提议启动，按模式和状态的拒绝保持不变（RN-566/RN-610）。自 [RN-671](api.md#rn-671)（AT-260）起，第一次启动是 kickoff 中「服务器」的步骤，由「同一个」`registrar_subida` 标记：在常见情况下它已被提议，第 2 项的收尾无话可说；当服务器的启动被拒绝（或被策略「拒绝」，此后也算作拒绝）以及启动不归服务器负责（没有路由，`runner`）而模型也没有提议时，它仍会说明。

- **代码：** `apps/engine/lib/engine/infra/infra_lead_server.ex:464`
  （`dispatch_calls`），`:560`（`recusa_pr_repetida_no_lote`），`:1173`
  （`registrar_subida`），`:1183`（`fechar_subida`），`:1155`

  （`dispatch_calls`），`:539`（`recusa_pr_repetida_no_lote`），`:1140`
  （`registrar_subida`），`:1150`（`fechar_subida`），`:1154`
  （`desfecho_da_subida`）；`apps/engine/lib/engine/infra/tools/propose_infra_pr.ex`
  （工具的描述）
- **测试：** `apps/engine/test/engine/infra/infra_lead_server_test.exs:1075`
  （在同一回应中 PR 之后请求的启动被派发——正常路径），
  `:1107`（PR 结束该轮且没有启动，消息流说明——失败情形），
  `:1147`（启动被拒绝且有承诺，没有提议：收尾说明），`:1132`
  （容器已在运行：无话可说），`:1169`（拒绝在轮次中被纠正：没有句子），`:1190`（没有启动的轮次：没有句子），`:1199`（批次中的第二个 `propose_infra_pr` 被拒绝）
- **来源：** AT-264（2026-09-29 的真实使用，分析的 A18 项）

## 带凭据的 git 在 runner 的宿主机上运行（RN-676）

### RN-673 — 在轮次进行中到达的消息进入持久化在日志中的队列，在轮次结束时读取，N 条消息合为一轮 {#rn-673}

此前在轮次中途到达对话型 agent 的消息是 409 `turno_em_andamento`（[RN-578](#rn-578)）：以 `chat.message` 记录（api 在与 engine 通信之前记录）却从未被读取。9月29日的真实使用在一个会话中测得三次——PO、Infra Lead 和 Dev Lead。负责人的决定（10月1日），「七个」对话型 agent 走同一路径：

1. **排队，而不是拒绝。** 有轮次进行中时，消息进入 agent 的队列（`TurnoAssincrono.receber_mensagem/4`），agent 写入 `chat.message_queued`（`mensagemId`、`texto`、`idioma`、`posicao`），点击收到 202 和 `{entrega: "enfileirada", posicao}`。没有轮次时，照常立即开始轮次（`entrega: "lida"`）。api 的路由还会返回 `mensagemId`——`chat.message` 的 id。
2. **N 条消息 = 1 轮。** 在轮次「结束」时（`finalizar/1`，绝不是 `suspender/1`），待处理的消息按到达顺序合成「一」轮，放在一段文本中（`FilaDeMensagens.texto_do_turno/1`：一条就是它本身；多条则编号），agent 写入带这些 id 的 `chat.message_delivered`。交付是发给自己的一条消息，在服务器收尾之后（Infra Lead 的 gate 修正和 Arquiteto 的 handoff 先来）。在轮次结束和交付之间到达的消息进入队列「末尾」，队列被立即交付。
3. **每个 agent 和会话最多 10 条**待处理。第 11 条为 409 `fila_de_mensagens_cheia`，带持久的 `agent.error`，来源 `politica`——它已被记录，不会被读取。
4. **取消。** `POST …/agents/:agent/messages/:messageId/cancel`（`developer`，消息路由的最低要求）：只有「发送者」可以（403 `mensagem_de_outra_pessoa`），只在接受对话的会话中（[RN-581](api.md#rn-581)）。判断它是否仍在队列中的是 agent 的进程，它把与交付之间的竞争串行化：已被读取或取消时为 409 `mensagem_fora_da_fila`。engine 以取消者的名义写入 `chat.message_cancelled`；agent 不在线时直接写入（队列就是日志）。
5. **持久化在日志中，绝不在表中。** 待处理 = 已入队且既未交付也未取消——engine 和界面使用相同的推导。七个 agent 的 `init/1` 重建队列并安排交付；[RN-580](#rn-580) 从历史中去掉已取消的和 agent 自己的待处理消息；启动时，在关闭孤儿轮次（[RN-586](#rn-586)）之后，唤醒有待处理队列的 agent。被中断的轮次仍然绝不重做。
6. **因审批挂起的轮次**（Dev Lead，RN-284）仍以 `aguardando_aprovacao` 拒绝——没有可预见的结束，排队就是承诺一个没有日期的读取。已存在的队列等待恢复结束。
7. **界面。** 有轮次进行中时，composer 不再因发给 agent 的消息而锁住：按钮变为「Pôr na fila」，消息不会触发新轮次。在消息流中显示「na fila de <agente>」，作者可「Cancelar」，「cancelada」显示为删除线。没有 agent 的聊天仍会锁住。

`turno_em_andamento` 拒绝对非发言内容仍然有效：PO 的故事审查、Criativo 的就绪、Arquiteto 的 handoff 提议。

- **代码：** `apps/engine/lib/engine/agents/turno_assincrono.ex:301`
  （`receber_mensagem`），`:245`（`tratar_resultado`），`:461`（`entregar_fila`），
  `:346`（`cancelar_mensagem`），`:392`（`fila_ao_subir`），`:497`
  （`emitir_recusa_por_fila_cheia`）；
  `apps/engine/lib/engine/agents/fila_de_mensagens.ex:71`（`pendentes`），`:97`
  （`fora_do_historico`），`:143`（`texto_do_turno`），`:164`
  （`acordar_pendentes`）；
  `apps/engine/lib/engine/agents/reidratacao.ex:160`（`fora_do_historico`）；
  `apps/engine/lib/engine/agents/dev_lead_server.ex:245`（`_mensagem_id`）；
  `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:393`
  （`cancel_queued_message`），`:461`（`responder_ao_aceite`）；
  `apps/api/src/application/use-cases/agents/cancel-queued-agent-message.use-case.ts:35`
  （`CancelQueuedAgentMessageUseCase`）；
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts:65`
  （`entregaDaResposta`）；
  `apps/api/src/domain/sessions/conversa-em-sessao-encerrada.ts:72`；
  `apps/web/src/lib/fila-de-mensagens.ts:27`（`estadosNaFila`）；
  `apps/web/src/lib/enfileirar-mensagem.ts:25`（`useEnfileirarMensagem`）；
  `apps/web/src/routes/PainelDaFila.tsx:20`（`PainelDaFila`，RN-978）
- **测试：** `apps/engine/test/engine/agents/fila_de_mensagens_test.exs:156`
  （进入队列——正常路径），`:181`（N 条消息 = 1 轮），`:223`（在窗口中到达的放到末尾），`:246`（10 条上限——失败情形），`:276`
  和 `:306`（取消以及在队列外取消），`:322`（重启），`:349`（Dev Lead 挂起），`:78`/`:120`（推导和重新水合）；
  `apps/engine/test/engine_web/controllers/agent_command_controller_test.exs:70`；
  `apps/api/test/application/use-cases/agents/cancel-queued-agent-message.use-case.spec.ts:40`，
  `:61`（另一个人——失败情形），`:95`，`:106`；
  `apps/api/test/application/use-cases/agents/send-agent-message.use-case.spec.ts:74`；
  `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts:531`；
  `apps/web/src/routes/SessionPage.fila-de-mensagens.test.tsx:163`，`:189`
  （队列已满），`:207`，`:233`；`apps/web/src/lib/fila-de-mensagens.test.ts:17`
- **来源：** AT-267（2026-09-29 真实使用分析的 A21 项），负责人 10月1日的决定；[ADR 0191](../adr/0191-a-mensagem-com-turno-em-curso-entra-numa-fila.md)

## 测试计划在 dev 交付之后产生（RN-674，ADR 0192）

### RN-674 — QA 策略在 `qa-verificada` 周期开始时，基于「已交付」的代码编写计划，`implementavel` 不依赖它来评判 {#rn-674}

在 9月29日的真实使用中，PRE-DEV 测试计划（[RN-341](contracts.md#rn-341)）两次以 `toolloop.limit_reached` 8/8 结束，没有 `emit_plano_de_teste`：循环读了文档、空的 RAG 和文件夹，直到得出「代码还不存在」的结论。负责人（10月1日）选择了出路 (b)：计划在交付「之后」产生。[ADR 0192](../adr/0192-plano-de-teste-depois-da-entrega.md) 在这一点上修订了 0090，规则有四部分：

1. **计划是审查周期的第一步。** `run_area/3`（属于 `QaLeadServer`）在各子专业「之前」获取交付的计划（`plano_de_teste_da_entrega/5`）：在会话尾部（重新水合的上限，[RN-580](#rn-580)）中找回 `artifact.plano_de_teste`，属于「同一」`taskId`——修正轮次不再为另一个循环付费——否则运行 `QaEstrategiaAgent.run/6`，以 dev 的 worktree 作为 `workspace_root`，带上 task 的业务规则以及交付所触及的文件列表（`git diff dev...HEAD`，最多 40 个名称）。失败的 diff 变成文字（「não consegui listar: motivo」），绝不是空列表。
2. **计划是「输入」，绝不是裁决。** 它出现在 Automação 消息的「末尾」，用于找出哪个测试覆盖每条规则这一步；裁决的标准不变（故事的每条规则一行 `coverageMatrix`，只有套件全绿且每条规则都被覆盖才是 `approved`），外部契约仍是每个周期「一个」`qa_verdict`。「失败」的计划不会挡住审查：QA 策略写入带来源的 `agent.error`（[RN-059](#rn-059)），Automação 收到常规消息，逐字节不变。
3. **`implementavel` 基于故事和 `module_map` 评判。** `run_assessment/2` 不读取也不触发计划：它在「第一次」调用中提出意见，基于 Dev Lead 的 kickoff 已提供的内容，payload 为 `storyId`/`parecer`/`justificativa`。gate、所有者、严重度 `warn` 和人工审批不变；只有 `entrada` 变了（`[story-ready, module_map]`）。appsec（[RN-539](#rn-539)）仍在那里、在设计阶段触发。
4. **上限仍是 8。** `"qa-estrategia"` 在 `Iteracoes.tipo/1` 中不加子句；改变的是输入。该 agent 改为在各子专业共享的 `task_budget_micros` 之下运行（[RN-036](#rn-036)）。

`run_design/3`、`Dispatcher.run_qa_estrategia/3` 和 `QaEstrategiaContext` 被移除，`artifact.plano_de_teste` 改为要求 `taskId`。已声明、此处未决定：计划中可执行的标准是否应成为 `coverageMatrix` 的「必需」行（从而导致交付被否决）。

- **位置：** `apps/engine/lib/engine/gates/qa_lead_server.ex:190`（`plano_de_teste_da_entrega`），
  `:715`（`plano_de_teste_da_entrega`），`:716`（`plano_ja_emitido`），
  `:721`（`arquivos_alterados`）；
  `apps/engine/lib/engine/gates/qa_estrategia_agent.ex:86`（`run`），
  `:104`（`token_budget_micros`），`:188`（`descrever_arquivos`）；
  `apps/engine/lib/engine/gates/qa_automacao_agent.ex:207`（`com_o_plano`）；
  `apps/engine/lib/engine/agents/dev_lead_tools.ex:457`（`run_assessment`），
  `:538`（`propor_parecer`）；
  `apps/engine/lib/engine/harness/artifact_schemas.ex:59`（`taskId`）；
  `docs/gates.yml`（`qa-verificada`，`implementavel`）；`docs/fluxo.yml`
  （`qa-estrategia`，`area-qa`，`dev-lead`）
- **测试：** `apps/engine/test/engine/gates/qa_lead_server_test.exs`，describe
  "plano de teste da entrega (ADR 0192)"——计划在 Automação 之前并位于其消息中（正常路径）、按 `taskId` 复用、另一个 task 的计划不计入，以及失败的计划不会挡住审查（失败情形）；`apps/engine/test/engine/gates/qa_estrategia_agent_test.exs`（消息中交付的文件、失败的 diff、产物中的 `taskId`）；
  `apps/engine/test/engine/agents/dev_lead_tools_test.exs`，describe
  "assess_implementability (ADR 0090, insumo do ADR 0192)"（第一次调用即给出意见，payload 不含计划）；`dev_lead_server_test.exs`
  （"assess_implementability pending TAMBÉM suspende"）；`apps/engine/test/engine/harness/artifact_schemas_test.exs`
  （"sem taskId é rejeitado"）。ExUnit：只在 CI 中证明（本轮环境中 `repo.hex.pm` 返回 403）。
- **来源：** AT-269（9月29日真实使用分析的 A23 项）；负责人 10月1日的决定

## 重新启用的 Anamnese：合格的对象与档案事实（RN-680）

### RN-680 — 没有合格对象时 Anamnese 不运行，本人接受的假设成为其在图中的档案事实，并进入与其对话的 agent 的上下文 {#rn-680}

负责人 10月1日的决定（AT-277）：**带修正地重新启用 Anamnese**。在 9月29日的真实使用中，它运行了六次，六次都以 `anamnese.run_skipped`（「nenhum membro elegível」）结束，由「模型」在一次付费调用之后写下（8 933 micros），三个已接受的假设停在队列中无处可去。见 [ADR 0196](../adr/0196-anamnese-religada-com-sujeito-e-fato-do-perfil.md)。

1. **没有合格对象，轮次就不运行。** 对象是项目的「有效」成员（`projectRole ?? workspaceRole`，[RN-471](web.md#rn-471) 的标准），未退出，并在轮次展示给模型的内容中有「自己」的互动——窗口中他的、带 `actor_kind: "user"` 的事件，或他的决定。守卫在分诊「之前」，即使队列中的假设也无法越过它。没有对象时：不调用 LLM，也不搜索 RAG；原因被「命名」写入 engine 日志（`sem_sujeito_elegivel`，带 `nenhum_membro` 或 `nenhuma_interacao_propria` 以及数字），在手动请求的轮次中也写入 event log（`anamnese.run_skipped`，带 `causa: "sem_sujeito_elegivel"`）。通过 tick 时只记日志——否则每个项目每 15 分钟就是一条通知。提示词改为只列出对象。
2. **项目成员是「有效」成员。** 创建项目不写入 `project_members`，而 Anamnese 只读取这张表——工作区的所有者从来不是成员。Anamnese 的三个用例改为读取 `listEffectiveMembers`；`listMembers` 仍只读 `project_members`。
3. **由「本人」「接受」的假设成为档案事实。** `psychologist.hypothesis_accepted` 带有 `projectId`、`sujeito`（被分析会话的作者）、`hipotese`、`sugestao` 和 `fatoDoPerfil`，而 `GraphEventTranslator`——与投影器和 `grafo:reprojetar` 相同——把它转换为 `(:FatoDoPerfil {hypothesisId})`，连接到该人（`SOBRE`）和项目（`NO_PROJETO`）。只有当接受者就是对象时 `fatoDoPerfil` 才为 `true`：关于一个人的事实绝不由另一个人的点击产生，payload 说明原因（`motivoSemFato`）。被拒绝的照旧只被记录。本 RN 之前记录的接受没有这些字段，不会变成事实。
4. **事实进入与该人对话的 agent 的上下文。** 作者发给对话型 agent 的消息带上「他」在本项目中的事实——由 `QueryUserContextUseCase` 读取，限定在项目内，最近 5 条，旁边附总数并说明截取——engine 把它们作为「临时」`system` 消息放入该轮，走与语言相同的路径（[RN-622](#rn-622)）：绝不进入历史，在语言指引之前，上限 2 000 个字符。图不可用时记日志，该轮在没有事实的情况下继续。没有作者的轮次不接收事实。
5. **重新启用。** `ANAMNESE_ENABLED` 恢复默认值 `true`，在 `runtime.exs` 和三个 compose 中；`START_ANAMNESE` 不变（生产环境的仍为 `false`，分歧已声明）。Psicólogo 仍处于暂停。

- **代码：** `apps/engine/lib/engine/anamnese/elegibilidade.ex:59`（`avaliar`）；
  `apps/engine/lib/engine/workers/anamnese_worker.ex:63`（`maybe_analyze`），
  `:97`（`narrar_sem_sujeito`）；
  `apps/api/src/domain/iam/membros-efetivos.ts:16`（`membrosEfetivos`）；
  `apps/api/src/infrastructure/persistence/drizzle/project.repository.ts:209`（`listEffectiveMembers`）；
  `apps/api/src/application/use-cases/execution/accept-hypothesis.use-case.ts:75`（`fatoDoPerfil`）；
  `apps/api/src/application/graph-projection/graph-event-translator.ts:171`（`projectProfileFact`）；
  `apps/api/src/application/use-cases/graph/query-user-context.use-case.ts:68`（`fatos`）；
  `apps/api/src/domain/graph/perfil-do-autor.ts:30`（`textoDoPerfilDoAutor`）；
  `apps/api/src/application/use-cases/agents/send-agent-message.use-case.ts:111`（`resolverPerfil`）；
  `apps/engine/lib/engine/harness/perfil_do_autor.ex:68`（`anexar`）；
  `apps/engine/lib/engine/harness/idioma_da_resposta.ex:253`（`com_idioma_do_autor`）；
  `apps/engine/config/runtime.exs:315`（`anamnese_enabled?`）
- **测试：** `apps/engine/test/engine/anamnese/elegibilidade_test.exs:17`
  （正常路径），`:35` 和 `:46`（没有对象——失败情形）；
  `apps/engine/test/engine/workers/anamnese_worker_test.exs:305`（没有成员，即使有队列，也不调用 LLM），`:324`，`:343`（手动轮次会叙述），`:360`；
  `apps/engine/test/engine/anamnese/context_builder_test.exs:82`；
  `apps/api/test/infrastructure/persistence/drizzle/project-effective-members.repository.spec.ts:69`；
  `apps/api/test/application/use-cases/execution/accept-dismiss-hypothesis.use-case.spec.ts:136`，
  `:156`（第三方的接受不会变成事实）；
  `apps/api/test/application/graph-projection/graph-projector.spec.ts:361`，`:386`；
  `apps/api/test/application/use-cases/agents/send-agent-message.use-case.spec.ts:181`，
  `:207`（图不可用）；
  `apps/engine/test/engine/harness/perfil_do_autor_test.exs:14`；
  `apps/engine/test/engine_web/controllers/agent_command_controller_test.exs:428`
- **来源：** AT-277（9月29日真实使用分析的 A31 项；负责人 10月1日的决定）

## 类型化入口同样适用 RN-418 的上限（RN-689）

### RN-690 — 助手保存回应中的 `toolCalls`：工具结果不会以孤儿形式到达 provider {#rn-690}

带自己循环的对话型 agent（Criativo、PO、Arquiteto、Dev Lead、UX Designer、Staff 和 Infra Lead）在历史中保存的助手消息「不带」回应中的 `toolCalls`，紧接着是 `role: "tool"` 消息，带 `toolCallId`。在传输中，provider 收到一个不回应任何调用的结果并把它丢弃：模型从未看到工具返回了什么，于是重复同一调用直到循环上限（在 v7.0.0 中测得：PO 在两个轮次中 12 次里有 12 次调用 `listar_regras_de_negocio`）。

助手消息在有原生 `toolCalls` 时改为带上它们——与 `ToolLoop` 已经保存、`ContextManager` 在压缩时分组的格式相同——在一个地方组装。没有 `toolCalls` 的回应不加这个键。从文本中恢复的调用（`ToolCallRecovery`，id 为空）被排除：没有可匹配的 id。api 本来就把该字段传给 provider（OpenAI 兼容中的 `toWireMessage`，Anthropic 中的 `tool_use`）；重新水合仍以文本形式带回工具。

- **位置：** `apps/engine/lib/engine/agents/mensagem_do_assistente.ex:17`（`de`）；
  `apps/engine/lib/engine/agents/po_server.ex:280`，以及其他六个服务器中的同一位置
- **测试：** `apps/engine/test/engine/agents/po_server_test.exs:93`（第二次调用带有 `assistant`，含 `toolCalls`，紧接在回应它的 `tool` 之前；不带工具的最终回应不加该键——失败情形）
- **来源：** AT-350

### RN-695 — Anamnese 的分析不进入会话消息流 {#rn-695}

在 v7.0.0 的真实使用中测得：Anamnese 的模型在轮次中写下的文本（「Analisando a janela do log… usuário (09824667-…)… Decisão de proficiência」）以「气泡」形式出现在构思会话的消息流中，位于 Criativo 和 PO 之间，带着用户的原始 UUID。Anamnese 不与任何人对话：它分析的是「人」，它产出的是档案（[RN-680](#rn-680)）。

**规则：** 轮次的文本记录为 `anamnese.analysis`，绝不是 `agent.response`。`ToolLoop` 在上下文中接受 `response_event`（默认 `agent.response`，对所有其他消费者不变），由 Anamnese 设置它。会话消息流不绘制角色为 agent `anamnese` 的「任何」事件——包括修正前记录的 `agent.response`。会话的日志面板仍显示它的事件；结果位于「配置 › 熟练度档案」，没有原始 id。消息流中不加入任何「档案已更新」标记：在有人要求之前不做。

- **位置：** `apps/engine/lib/engine/harness/tool_loop.ex:124`（`loop`）；
  `apps/engine/lib/engine/workers/anamnese_worker.ex:157`（`build_ctx`）；
  `apps/web/src/routes/session-timeline-montagem.tsx:115`（`ehDaAnamnese`）
- **测试：** `apps/engine/test/engine/workers/anamnese_worker_test.exs:253`
  （文本以 `anamnese.analysis` 输出；`agent.response` 从不被记录——失败情形）；`apps/web/src/routes/session-timeline-montagem.falha-de-turno.test.tsx:86`
  （Anamnese 的回答从消息流中消失，Criativo 的保留）
- **来源：** AT-355

### RN-697 — Criativo 的就绪轮次只做综合：不带工具 {#rn-697}

`confirm_readiness` 触发的轮次把规则整合成一份摘要并写入 `product_brief`。在真实使用中（v7.0.0，Haiku 4.5），它花了 25 秒，又多写了四条 `artifact.business_rule` 和一个没人会回答的 `chat.structured_question`：PO 已经通过隐含接受加入了（RN-658）。该轮改为「不带」工具目录发给模型，其中不响应任何调用——包括模型从历史中照抄的调用。目录在下一轮原样恢复；普通轮次仍带有 `emit_artifact` 和 `ask_structured_questions`。

- **位置：** `apps/engine/lib/engine/agents/criativo_server.ex:218`（`executar_confirm_readiness`）；
  `:263`（`ferramentas_da_prontidao`）
- **测试：** `apps/engine/test/engine/agents/criativo_server_test.exs:172`（该轮带 `tools: []`，不写规则也不写问题）和 `:192`（回归：普通轮次保留两个工具）
- **来源：** AT-352

### RN-698 — 轮次的文本变成「一个」回应，迭代上限出现在消息流中 {#rn-698}

带工具时，模型分段书写——调用前一段，下一轮又一段，经常是在续写同一句话。每一轮都变成自己的 `agent.response`，消息流把前面的折叠进「Passos do turno」：可见的只有最后一段（" histórias e tarefas que cubram tudo."，以空格开头）。传输没有丢失任何东西——api 的 `final` 帧带有该「轮」的完整文本——被拆开的是「轮次」。在七个对话型 agent 中，带工具那一轮的文本累积在轮次进程中，只在轮次结束时（无工具、上限、失败、Dev Lead 挂起、Infra 的 PR）写入一个 `agent.response`。以空格开头或结尾的片段按原样进入；粘在一起的两段变成段落。

对话型 agent 的 `toolloop.limit_reached`（RN-166）改为消息流中的一行，位于失败气泡中，来源 `modelo`，说明上限（「parou no teto de N
passos sem terminar o turno」）；payload 中没有数字时，该行显示 `?`。

轮次的 `agent.response` 在「所有」结局中都带有 `modelName`（RN-146），而不仅在无工具的收尾中：当轮次结束时没有带它的最终调用（交付了一个 `ask_structured_questions` 表单、用尽上限、失败），取累积的最后一轮的模型。没有任何返回了模型的 LLM 调用时，该字段为 `nil`——绝不是捏造的模型（AT-384；Infra Lead 在任何结局中都不写 `modelName`，仍不在此列）。

**修订（负责人的决定，10月3日，AT-395）：气泡中只有轮次的收尾。** 在真实使用中（loja-teste-2，10月2日），单一回应把「所有」轮的文本拼在一起（「Vou registrar… Excelente! Registrei…」，PO 中连续两段摘要）。轮次的 `agent.response` 仍是「一个」，但 `content` 改为只有「收尾」——最后一个写了内容的轮次的文本（以表单结束、最后一轮没有文本的轮次，取前一轮）——前面各轮的文本按顺序放入 `passos` 字段，没有时不出现。没有任何东西消失：消息流把每个步骤绘制为同一轮次+作者在收尾之前的叙述，已有的「Passos do turno」折叠把它们收起，默认关闭；步骤不计入消息流的消息截断（RN-644）。重新水合（RN-580）把 `passos` 放在 `content`「之前」返回，在同一个 `assistant` 中，这样模型不会丢失它在轮次中途说过的话。适用于七个对话型 agent（Infra Lead 也是，没有 `modelName`）。`passos` 没有专门的上限：修订之前累积的内容本来就被完整写入。

- **位置：** `apps/engine/lib/engine/agents/texto_do_turno.ex:83`（`descarregar`）；
  `:111`（`juntar`）；`:51`（`descarregar_com_modelo`）；`:65`（`payload_do_turno`）；
  `apps/engine/lib/engine/agents/reidratacao.ex:177`（`acumular`）；
  `apps/web/src/routes/session-timeline-montagem.tsx:809`（`passos`）
- **测试：** `apps/engine/test/engine/agents/texto_do_turno_test.exs:43`（三轮：收尾和两个步骤），`:56`（一轮，没有 `passos`），`:60`（以表单结束）；`apps/engine/test/engine/agents/reidratacao_test.exs`
  （步骤在收尾之前）；`apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx:502`
  （只显示收尾，展开后显示步骤）和 `:524`（没有步骤，没有额外内容）；
  `apps/engine/test/engine/agents/criativo_server_test.exs:209`（两轮，一个完整回应；没有第二个），`apps/engine/test/engine/agents/texto_do_turno_test.exs`
  和 `apps/web/src/routes/session-timeline-montagem.falha-de-turno.test.tsx:85`
  （上限那一行；没有数字时不捏造）；表单中的模型见
  `apps/engine/test/engine/agents/criativo_server_test.exs:703`（有模型）和
  `:724`（没有模型，`nil`）
- **来源：** AT-354，AT-384，AT-395

### RN-699 — Dev Lead 读取当前的 module_map 和「项目」的 backlog，并在计划被拒绝时重新读取两者 {#rn-699}

在真实使用中测得（10月2日）：Dev Lead 被接受后，回答说缺少 module_map——而映射是存在的。kickoff 查找的是事件 `architecture.module_map_created`，「没有」任何代码会发出它（Arquiteto 通过 api 写入映射），因此总是落到「(sem module_map)」。现在映射来自 AppSec 所用的「同一」项目读取（`get_infra_context`，api 的当前版本），绝不来自会话事件；没有映射时，kickoff 说明没有。

在同一次使用中，任务在 kickoff「之后」才产生，Dev Lead 捏造了一个 `task_id`，api 拒绝了计划，轮次结束且没有再次尝试。它获得了 `read_backlog`：「受控」读取，没有参数，限定在项目内（待处理任务经由与 PO 的 `listar_backlog` 相同的路由，上限 200 行并说明真实总数，以及当前的 module_map）。api 的拒绝回到循环中，要求调用 `read_backlog` 并修正；只有成功的 `propose_execution_plan` 才结束轮次——此前，最后一次调用中任何成功的工具（一次读取、一次 `emit_artifact`）都会结束轮次。kickoff 的指令禁止捏造 `task_id`，并要求它只说自己评估过调用了 `assess_implementability` 的那些故事。

- **位置：** `apps/engine/lib/engine/agents/dev_lead_tools.ex:339`（`module_map_vigente`）；
  `:324`（`spec_read_backlog`）；`:340`（`tarefas_do_backlog`）；
  `apps/engine/lib/engine/agents/dev_lead_server.ex:557`（`kickoff_instruction`）；

- **位置：** `apps/engine/lib/engine/agents/dev_lead_tools.ex:339`（`module_map_vigente`）；
  `:324`（`spec_read_backlog`）；`:372`（`tarefas_do_backlog`）；
  `apps/engine/lib/engine/agents/dev_lead_server.ex:557`（`kickoff_instruction`）；
  `:393`（`run_turn`）
- **测试：** `apps/engine/test/engine/agents/dev_lead_server_test.exs:164`（当前映射到达 kickoff，旧类型不被读取），下一个测试（没有映射时说明没有——失败情形）以及 `:202`（计划被 api 拒绝 → 同一轮次中 `read_backlog`，带真实任务）
- **来源：** AT-362，AT-363

### RN-700 — PO 不会只宣布而不实际做出给 Arquiteto 的 handoff，没有任务的故事不予交付 {#rn-700}

在真实使用中，PO 写了「Handoff ao Arquiteto」却没有调用 `offer_handoff` 就结束了轮次（违反 RN-163），并交付了五个 `ready` 故事而任务为零——Dev Lead 没有东西可分配。在 PO 每一轮结束时，如果服务器在该进程中尚未记录给 Arquiteto 的提议，它会读取项目的规则（`uncoveredCount`，与 RN-660 自动接受相同的覆盖率）和 backlog：所有规则都已覆盖且每个故事都有 ≥ 1 个任务时，由「服务器」提出 handoff（仿照 Infra 自行提议的方式，ADR 0190，RN-671/672），由 RN-660 继续决定接受。规则已覆盖但有故事没有任务时，不提出，并写入 `backlog.handoff_not_offered`（来源 `modelo`），点名这些故事；读取或提议失败时写入同一事件，来源 `infra`。规则未覆盖，或 backlog 没有规则/故事时，不作评判。PO 的指令改为要求每个故事都有任务。创建任务的是 PO（AT-364 中主 agent 的决定：它已有 `create_task`）。

- **位置：** `apps/engine/lib/engine/agents/po_server.ex:475`（`fechar_handoff`）；
  `:502`（`oferecer_handoff`）
- **测试：** `apps/engine/test/engine/agents/po_server_test.exs:592`（提出且不重复），`:610`（没有任务的故事：不提出，并点名）
- **来源：** AT-364

## 安装程序提供本地模型，并且不把 dev 环境误认为一次安装（RN-691，RN-692）

### RN-702 — 上下文压缩遵守 128k 的默认窗口，绝不用空标记替换轮次 {#rn-702}

- **规则：** 上下文中没有 `context_window` 时（对话型 agent 不声明它），压缩窗口为 `DEFAULT_CONTEXT_WINDOW`，其默认值从 8 192 改为 128 000，与 gate 和 dev 的 agent 所声明的值相同。当摘要器（`context-manager`）失败或返回空文本时，摘要是「确定性」的（每个被替换的轮次取最多 300 个字符的片段），`context.compacted` 记录 `summaryOrigin:
  "deterministico"` 以及 `falha`，带 `origem` 和 `motivo`（RN-059）。摘要器有响应时，`summaryOrigin: "modelo"` 且 `falha: null`。
- **测量（AT-366）：** 会话 17d41c20，Arquiteto 使用 `anthropic/claude-haiku-4.5`（200k 窗口）：6 799 个 token 超过了 `0,7 × 8 192 = 5 734`，压缩了 35 个轮次；摘要器失败，写入的摘要是标记 `"(35 turnos anteriores omitidos)"`。下一轮中，Arquiteto 再次要求一个它已经收到的确认。
- **位置：** `apps/engine/lib/engine/harness/context_manager.ex:157`（`summarize`），
  `apps/engine/lib/engine/harness/context_manager.ex:188`（`resumo_deterministico`），
  `apps/engine/config/runtime.exs`（`default_context_window`）
- **测试：** `apps/engine/test/engine/harness/context_manager_test.exs`
  （"sem context_window declarado: 6,8k tokens NÃO compactam"；"sumarizador
  respondendo: summaryOrigin modelo, sem falha"；失败情形："sumarizador
  falhando: falha NOMEADA com origem e resumo determinístico com o conteúdo"）
- **声明的缺口：** 窗口仍不是按模型从目录中读取的（engine 收不到 binding 的 `context_window`）；128k 是安装的默认值，可通过 `DEFAULT_CONTEXT_WINDOW` 调整。
- **来源：** AT-366

### RN-706 — 执行型 agent 知道自己在哪里：文件夹、镜像、网络、类型化 git 和自己的模块 {#rn-706}

- **规则：** dev agents（`dev-*`）和 QA 子 agent（`qa-*`）在每次 LLM 调用中都收到一条「临时」的环境 `system` 消息，走与语言（RN-622）和作者档案（RN-680）相同的路径——绝不进入 `state.messages`，绝不由服务器组装。它说明 `terminal` 运行的真实文件夹（循环的 `workspace_root`，转换为 `/work`，按 `TerminalExecutor` 的同一规则，当有已「登记」的 `running` 容器时），最近一个 `artifact.project_image` 的镜像和网络，`git` 不在终端中运行（使用 `git_commit`/`git_push`/`pr_open`），以及对 dev agent 而言，它的「模块」：它从其他模块消费的内容来自契约（`listar_contratos_de_modulos`），通过 stub/mock 使用，绝不重新实现，`dev` 中已存在的根目录文件（`package.json`、lockfile）不重新创建。没有 `running` 容器时，消息「说明」这一点，不断言 `/work`。上限 1 200 个字符；读取失败时消息缺省，绝不中断轮次。
- **测量（AT-379/AT-378，10月2日，loja-teste）：** `dev-api` 和 `qa-automacao` 运行了 `cd /workspace`（没有任何提示词提到这个文件夹）；`git status` 在没有 git 的镜像中返回 exit 127；`dev-api`（模块 `api`）创建了 `src/catalog.js` 和 `package.json`，与 `dev-catalog` 的相同，合并冲突了。
- **位置：** `apps/engine/lib/engine/harness/ambiente_do_agente.ex:102`（`montar`），
  `:48`（`com_ambiente`），`:65`（`anexar`），
  `apps/engine/lib/engine/harness/tool_loop.ex:87`（`com_ambiente`）
- **测试：** `apps/engine/test/engine/harness/ambiente_do_agente_test.exs`
  （"caminho feliz: com container running, a pasta é /work/.worktrees/<agente>"；
  失败情形："sem container running, não afirma /work"）
- **声明的缺口：** 对其他模块的文件，`git_commit` 的结果中没有任何提示（`module_map` 不说明哪些路径属于哪个模块，因此提示不会是确定性的），也没有任何 commit 阻断，依负责人的决定。
- **来源：** AT-379，AT-378

### RN-707 — SecOps gate 的 semgrep 有可写的 `$HOME`，无输出的失败被命名 {#rn-707}

- **规则：** 在生产和安装的 compose 中，engine 的 tmpfs `/home/engine` 以镜像用户为所有者创建（`/home/engine:uid=1000,gid=1000,mode=0700`）。`SemgrepDetector.Live` 区分带 JSON 的 exit `1`（发现）与 stdout 为空的 exit `0`/`1`，后者变为 `{:error, {:sem_saida, exit_code}}`，而不是 `:invalid_output`。gate 的裁决「不」变：没有运行的扫描器在意见摘要中仍是「pulado」。
- **测量（AT-380）：** 在 `brabo-engine-1`（生产镜像，`read_only: true`）内部，tmpfs `/home/engine` 以 `root` `2755` 创建；gate 的 `semgrep scan` 以 `1` 退出，stdout 为空，stderr 中是 `PermissionError: '/home/engine/.semgrep'`，解析器把这称为 `:invalid_output`。tmpfs 为 `uid=1000` 时，同一命令返回 JSON（exit 0）。Kubernetes 没有这个缺陷（`fsGroup: 1000`，位于 `emptyDir`）。
- **位置：** `apps/engine/lib/engine/actions/semgrep_detector.ex:73`
  （`interpretar`），`docker/docker-compose.prod.yml`，
  `docker/docker-compose.install.yml`
- **测试：** `apps/engine/test/engine/actions/semgrep_detector_test.exs`
  （"JSON com results vira findings, inclusive com exit 1 (achou algo)"；失败情形："exit 1 com stdout vazio é falha de execução nomeada, não
  :invalid_output"）
- **决定（由 [RN-714](#rn-714) 修订）：** 「o veredito do gate
  NÃO muda」这句话不再有效：负责人决定（10月2日）没有运行的 SAST 让 gate 保持「待处理」并阻塞。
- **来源：** AT-380

### RN-710 — 没有可运行的 CI 时不委派 Workflows，它也不向任何人提问 {#rn-710}

在接受 Infra 时，`infra-workflows` 以一个没有人会收到的问题回应（「qual é o provider do repositório do projeto?」）——子 agent 不对话——委派以 `failed` 结束，来源 `modelo`，消息流中只有一个泛泛的 `dev.error`（在 loja-teste 中测得，10月2日）。项目是 `local`：服务器上的 bare 仓库，没有 CI runner。

- provider 为 `local` 或缺失：对 Workflows 的委派被**免除**（`delegation` 为 `dispensed`，带命名的理由——「repositório local
  … não tem CI que rode」），infra 的 PR 只包含 Lead 产出的内容。只有 `github` 和 `gitlab` 会委派。
- 委派时，提示词说明收到的 provider「就是」项目的，并禁止提问。
- 以「文本」停下而不调用工具的子 agent 仍是报告给 lead 的命名失败，但诊断会说明它请求了什么：「pediu
  informação que não recebeu, em vez de chamar emit_infra_delegation_result:
  <texto>」（最多 300 个字符）。
- infra PR 的标题只在模型的摘要尚未以 `infra: ` 开头时（不区分大小写）才加上这个前缀——此前会输出「infra: infra: Dockerfile…」（AT-396）。

- **位置：** `apps/engine/lib/engine/infra/workflows_agent.ex:61`（`dispensa`），
  `apps/engine/lib/engine/infra/infra_lead.ex:69`（`com_prefixo`），
  `apps/engine/lib/engine/infra/workflows_agent.ex:184`（`parada_sem_ferramenta`），
  `apps/engine/lib/engine/infra/infra_lead_server.ex:1217`（`finalize`）

  `apps/engine/lib/engine/infra/infra_lead_server.ex:1217`（`finalize`）
- **测试：** `apps/engine/test/engine/infra/workflows_agent_test.exs`（"RN-710: …"）
  和 `apps/engine/test/engine/infra/infra_lead_server_test.exs`（"RN-710:
  repositório local dispensa o Workflows …"）以及
  `apps/engine/test/engine/infra/infra_lead_test.exs`（"com_prefixo/1 (AT-396)"）
- **来源：** AT-368，AT-396

### RN-711 — 对话型 agent 知道自己在流程中的位置，用户的技术约束变成 decision_record {#rn-711}

- **规则：** 七个对话型 agent（Criativo、PO、Arquiteto、Infra、Dev Lead、UX Designer、Staff）在每次 LLM 调用中都收到一条「临时」`system` 消息，带有交付流程——按顺序的七个阶段（Criativo → PO → Arquiteto → Infra → Dev Lead → dev agents → QA/SecOps → 手动合并），agent 所在的「位置」，真实的「下一步」以及由「谁」触发（人 × 系统）——经由门面 `EngineApiClient`，在环境（RN-706）之后、档案（RN-680）和语言（RN-622，始终是最后一条）之前。来源只有「一个」，`Engine.Harness.FluxoDoTime`，由测试对照 `docs/fluxo.yml` 校验：提到的每个角色在那里都以 `active` 存在，文本不提及其中没有的阶段（deploy、pipeline、Dockerfile、InfraAgent）。Criativo 把用户「明确」的技术约束（语言、「nenhuma dependência」、「sem rede」、「um módulo só」）记录为 `decision_record`（`emit_artifact`，RN-505），不说教；Arquiteto 的 kickoff 读取会话的 `artifact.decision_record`（同样按类型读取，RN-580），要求遵守它们，违背时说明「哪个」以及「为什么」。Arquiteto 的收尾不再要求已经给出的确认，Infra 不把文件粘贴到聊天中，也不承诺 deploy。
- **测量（AT-369/AT-370，10月2日，loja-teste）：** Criativo 宣布下一步是 Arquiteto（实际是 PO）；PO 说 Arquiteto 将「implementar」；Arquiteto 说 ADR 之后「dev agents começam」，并在确认之后要求「Confirme:
  Arquitetura pronta」；Infra 在消息流中倾倒了约 80 行 compose。「Node puro, nenhuma dependência, sem rede, um módulo
  só」的要求没有变成产物，Arquiteto 创建了三个模块。
- **位置：** `apps/engine/lib/engine/harness/fluxo_do_time.ex:107`（`texto`），
  `:97`（`anexar`），`apps/engine/lib/engine/sessions/engine_api_client.ex:647`

  `:97`（`anexar`），`apps/engine/lib/engine/sessions/engine_api_client.ex:700`
  （`llm_turn`），`apps/engine/lib/engine/harness/agents.ex:23`（`identity`），
  `apps/engine/lib/engine/agents/arquiteto_server.ex:388`（`build_kickoff`）
- **测试：** `apps/engine/test/engine/harness/fluxo_do_time_test.exs`
  （"todo papel citado existe no fluxo.yml como ativo"；失败情形："nenhum
  texto cita etapa/agente fora do fluxo"），
  `apps/engine/test/engine/agents/arquiteto_server_test.exs`（"kickoff lê os
  decision_record e manda respeitar \"um módulo só\""），
  `apps/engine/test/engine/harness/agents_test.exs`
- **声明的缺口：** Arquiteto 对 `decision_record` 的读取是「会话」级的（与 kickoff 的规则和故事一样），不是整个项目的；并且没有任何东西会「拒绝」违背约束的 `create_module_map`——指令要求说明理由，而不强制执行。
- **来源：** AT-369，AT-370

### RN-714 — 没有运行的 SAST 让 SecOps 的 gate 保持待处理，绝不是已批准 {#rn-714}

- **规则：** 当 SecOps gate 的 semgrep 没有运行时——二进制缺失、输出无效（`:invalid_output`）、`:sem_saida`、异常或时间上限——不写入任何裁决：PR 仍处于 `awaiting_secops`，gate 保持「待处理」并阻塞，PR 不会以 SecOps 已批准的状态到达用户。原因以 `agent.error` 进入消息流，来源 `infra`（「SAST não rodou: <motivo> — … reexecute o gate depois de corrigir」）。外部契约不变：仍是那两种裁决（`approved`/`changes_requested`），每个 gate 一个。缺少 gitleaks 仍只在摘要中显示为「pulado」。
- **重新执行：** 周期保持 `in_progress`，在 `gate_states` 中，`GateRescuer` 在 engine 启动时以及超过陈旧阈值（`gate_rescue_stale_after_seconds`，15 分钟）后重新执行它。界面上没有重新执行 gate 的按钮。
- **不重复（AT-386）：** 再次遇到「同一」原因的救援不会写入另一个 `agent.error`：如果该 task 的 SecOps 最后一个事件（`agent.error` 或 `artifact.secops_verdict`，按类型读取，带上限的尾部）已经是这个带相同 `reason` 的错误，就只留下服务器的 Logger 行。原因不同、中间有裁决或读取失败时会再次写入；`agent.error` 改为带上 `taskId`。
- **位置：** `apps/engine/lib/engine/gates/secops_agent_server.ex:116`
  （`run_secops`），`apps/engine/lib/engine/gates/secops_agent_server.ex:144`
  （`sast_nao_rodou`），`apps/engine/lib/engine/gates/secops_agent_server.ex:194`
  （`erro_ja_registrado?`）
- **测试：** `apps/engine/test/engine/gates/secops_agent_server_test.exs`
  （"sem achados (gitleaks e semgrep limpos): approved"；失败情形："semgrep com saída inválida: gate pendente, sem veredito, motivo nomeado" 和
  "semgrep com binário ausente: gate pendente, sem veredito, motivo nomeado"；
  AT-386："primeiro resgate grava; o segundo, com o mesmo motivo, não"，
  "motivo diferente, ou veredito depois do erro, grava de novo"，"o SAST que
  volta a rodar aprova como sempre"）
- **修订：** [RN-707](#rn-707)（「o veredito do gate NÃO muda」）
- **来源：** AT-380

### RN-717 — Anamnese 观察到的 agent 偏差变成产品信号，不含个人数据 {#rn-717}

- **规则：** agent 的循环、被用户取消的轮次以及修复 agent 失败的用户消息，由 Anamnese 记录为 `anamnese.agent_deviation`（工具 `report_agent_deviation`），绝不记录为该人的档案。payload 在 engine 中按允许列表组装——`agente`、`tipo`（`laco` | `cancelamento_pelo_usuario` |
  `reparo_pelo_usuario`）和 `evidenceEventIds`（去重，上限 20）——没有自由文本，也没有用户的 id、姓名、电子邮件或特征；额外字段被丢弃。该类型不投影到用户的图中。词汇表之外或没有证据的类型被拒绝，不写入。
- **位置：** `apps/engine/lib/engine/anamnese/tools/report_agent_deviation.ex:73`
  （`payload`），`apps/engine/lib/engine/anamnese/tools/report_agent_deviation.ex:52`
  （`run`），`apps/engine/lib/engine/anamnese/tools.ex`，kickoff 中的规则
  （`prompts/anamnese-kickoff.md` v4）
- **测试：** `apps/engine/test/engine/anamnese/report_agent_deviation_test.exs`
  （"reparo do usuário vira anamnese.agent_deviation do AGENTE, só com agente,
  tipo e evidência"；失败："tipo fora do vocabulário é recusado e nada é
  gravado"，"sem evidência é recusado"），
  `apps/api/test/application/graph-projection/desvio-do-agente-fora-do-grafo.spec.ts`
- **声明的缺口：** api 不校验证据是否存在；读取通过查询 event log 进行，没有界面（[ADR 0205](../adr/0205-desvio-do-agente-como-sinal-do-produto.md)）。
- **来源：** AT-356（第 2 部分），负责人 10月2日的决定

## 一个缓存键，一个问题（RN-718）

### RN-719 — agent 工具接受以 JSON 文本发送的列表，工具内部的异常回到循环 {#rn-719}

**背景：** 实时测得（10月2日，经由 OpenRouter 的 Haiku 4.5），模型把列表和对象作为 JSON「字符串」发送（`"business_rule_ids": "[\"01M…\"]"`）。三种结果：`create_story` 静默丢弃 id（故事停在 `draft`），其他工具拒绝并多花轮次，`create_c4_diagram` 对字符串执行 `Enum.map`，以 `agent.error` 中断了 Arquiteto 的轮次。

**规则：** 七个对话型 agent 和 `ToolLoop` 的每个工具都经过「一个」入口 `Engine.Harness.ArgumentosDeFerramenta.executar/4`。schema 声明为 `array`/`object` 而以该类型的有效 JSON 字符串到达的参数，变为其值；不是的字符串在工具运行之前是「命名」的拒绝（「o campo X precisa ser uma lista」）。声明为 `string` 的字段绝不被触碰。工具内部抛出的异常变为 `tool.result` `ok: false`，带 `origem: "codigo"`，错误像其他错误一样进入循环（RN-163）：轮次继续。

- **位置：** `apps/engine/lib/engine/harness/argumentos_de_ferramenta.ex:26`
  （`executar`），`:73`（`coagir`），`:52`（`falha_interna?`）；
  `apps/engine/lib/engine/agents/resultado_de_ferramenta.ex:29`（`payload`）；
  `apps/engine/lib/engine/harness/tool_loop.ex:348`（`run_direct`）；
  `apps/engine/lib/engine/agents/arquiteto_server.ex:331`
  （`executar_ferramenta`，其他六个服务器中是同一个 helper）
- **测试：** `apps/engine/test/engine/harness/argumentos_de_ferramenta_test.exs`
  （以 JSON 字符串传 id 的 `create_story` 写入 id；`create_c4_diagram` 在 `actors` 为 JSON 字符串时能正常工作；数组字段中的非 JSON 字符串是命名的拒绝；抛出异常的工具不会结束 `ToolLoop` 的轮次，并写入 `tool.result` `ok: false`）
- **来源：** AT-387

### RN-721 — 故事或任务的缩短 id 在项目内解析 {#rn-721}

Arquiteto 向 `assign_story_modules` 传入故事 id 的前 8 个字符，api 回应 400「storyId must be a UUID」，经过八次尝试，没有一个故事获得模块（loja-teste-2，10月2日）。每个接收故事或任务 id 的 agent 工具——`assign_story_modules` 和 `create_task`（`story_id`）、`assess_implementability`（`storyId`）以及 `propose_execution_plan`（`tarefas[].taskId`）——在调用 api 之前把 id 交给 `Engine.Harness.IdDoBacklog`：

- 完整 UUID 不查询，直接通过。
- 至少 8 个十六进制字符的前缀在「项目」backlog（`list_backlog`）中解析：只有一个以它开头的 id 时变为该 UUID；没有时是命名的拒绝（「nenhuma história do projeto tem id começando com
  …」）；多于一个时是命名的拒绝（「o prefixo … é ambíguo」）。拒绝作为工具结果回到模型（RN-163）。
- 既不是 UUID 也不是前缀的按原样传递，由 api 拒绝。

- **位置：** `apps/engine/lib/engine/harness/id_do_backlog.ex:21`（`resolver`），
  `:43`（`resolver_em`）；`apps/engine/lib/engine/agents/dev_lead_tools.ex:176`
  （`resolver_tarefas`）
- **测试：** `apps/engine/test/engine/harness/id_do_backlog_test.exs`（唯一前缀可解析；有歧义和不存在的以命名方式拒绝）
- **来源：** AT-390

## Anamnese 不为同一窗口付两次钱，gate 救援不重启正在等人的周期（RN-722）

### RN-722 — Anamnese 关闭已评估的窗口，只在有新互动时运行；gate 救援按 task 询问，尊重待定的人工决定，并把旧周期停放 {#rn-722}

- **规则（Anamnese）：** (1) 「评估」了窗口并以无档案结束（`skip_proficiency`）的轮次以零档案写入 `anamnese_runs`，下一轮从 `window_to` 开始——修订 RN-680/moduledoc 中「未完成的轮次不写入」的条款：「失败」的轮次（上限、预算、provider）仍不写入，而根本没到 LLM 的轮次（没有对象、分诊、每日上限）什么也不关闭；(2) Anamnese 自己写的事件（`anamnese.*` 以及所有角色为 `agent`/`anamnese` 的事件）和角色为 `system` 的事件不计入窗口，也不计入分诊的计数；(3) 负责人 10月2日的决定：对象是至少有 **5** 次自己的「新」互动的人（`actor_kind: "user"` 的事件加上决定，在从上次尝试结束时开始的窗口中）——修订 RN-680 的「至少一次」——项目每个 UTC 日最多 **4** 次付费轮次（完成的、失败的或由模型写下 `run_skipped` 的；没有对象的跳过不计）。低于任一条件，都不调用 LLM 也不调用 RAG；原因记入日志，只有在手动请求的轮次中才写入 `anamnese.run_skipped`（`causa:
  "teto_diario"` 或 `"sem_sujeito_elegivel"`）。
- **规则（gate 救援，修订 RN-140）：** `GateRescuer` (a) 通过询问 lead（`{:em_voo?, task_id}`），把其 TASK 正在 lead 中进行的周期视为活的，而不再看项目的进程——空闲的 lead 不会挡住救援；忙得无法回应的 lead 算作活的；(b) 不重启这样的周期：其会话中有「待处理」的 `proposed_action`，来自 gate 角色（`qa*`、`secops*`、`appsec`）——只记入日志；(c) 负责人 10月2日的决定：自「最后一次活动」（`updated_at`）起停滞超过 2 小时的周期被「停放」（`parked_at`），并在会话日志中记录 `gate.rescue_parked`（task、gate、时长、原因），无论启动时还是 tick 时都不会恢复，恢复需要人的动作（`GateRescuer.retomar_estacionado/3`）。
- **位置：** `apps/engine/lib/engine/workers/anamnese_worker.ex:189`
  （`fechar_janela`），`apps/engine/lib/engine/workers/anamnese_worker.ex:104`
  （`dentro_do_teto_diario?`），
  `apps/engine/lib/engine/session_events/event.ex:194`
  （`project_window_query`），`apps/engine/lib/engine/session_events/event.ex:202`
  （`count_anamnese_rounds_since`），
  `apps/engine/lib/engine/anamnese/elegibilidade.ex:67`
  （`min_interacoes_proprias`），
  `apps/api/src/application/use-cases/anamnese/record-proficiency.use-case.ts:160`
  （`fecharJanelaSemPerfil`），`apps/engine/lib/engine/gates/gate_rescuer.ex:336`
  （`task_em_voo?`），`apps/engine/lib/engine/gates/gate_rescuer.ex:360`
  （`aguardando_humano?`），`apps/engine/lib/engine/gates/gate_rescuer.ex:283`
  （`estacionar`），`apps/engine/lib/engine/gates/gate_rescuer.ex:320`
  （`retomar_estacionado`），`apps/engine/lib/engine/gates/qa_lead_server.ex:95`
  （`handle_call`）
- **测试：** `apps/engine/test/engine/workers/anamnese_worker_test.exs`
  （describe "a janela avaliada fecha (RN-722)"："skip_proficiency grava a
  rodada vazia; a segunda começa em window_to e, sem interação nova, não chama
  o LLM"；失败："falha ao fechar a janela não vira falha da rodada"，"rodada
  que FALHA não fecha a janela"；describe "piso de interações e teto diário
  (RN-722)"），`apps/engine/test/engine/anamnese/elegibilidade_test.exs`，
  `apps/engine/test/engine/session_events/event_window_test.exs`（"dez
  eventos da Anamnese sozinhos não passam a triagem"），
  `apps/engine/test/engine/gates/gate_rescuer_test.exs`（"lead do projeto vivo
  e OCIOSO não segura o resgate de uma task perdida"，"ciclo com ação PENDENTE
  de ator do gate espera o humano"，"ação pendente de OUTRO ator não segura o
  resgate"，"ciclo parado há mais de 2 h é ESTACIONADO"，"ciclo parado há
  MENOS de 2 h segue sendo resgatado"），
  `apps/api/test/application/use-cases/anamnese/record-proficiency.use-case.spec.ts`
  （describe "fecharJanelaSemPerfil (RN-722)"）
- **声明的缺口：** 恢复已停放的周期没有界面也没有路由——那是操作员的调用（`bin/engine rpc`）；已在 [RN-724](#rn-724) 中关闭（`gate.rescue_parked` 事件上的路由和按钮）。人工待处理项按周期的「会话」读取（`proposed_action` 没有 `task_id`）（[ADR 0207](../adr/0207-ciclo-de-gate-velho-estaciona.md)）。
- **来源：** AT-391（10月2日的真实使用：没有人请求的一天中 Anamnese 花了约 8.90 美元；有待处理操作的 gate 周期被重启，另一个 8 小时没有被救援），负责人 10月2日的决定

## 一个缓存键，一个问题（RN-718）

### RN-723 — Infra 继承 Arquiteto 为项目声明的网络 {#rn-723}

负责人 10月2日的决定（[ADR 0208](../adr/0208-a-infra-herda-a-rede-do-arquiteto.md)），修订 [RN-671](api.md#rn-671) 接受时启动所用的字面网络 `none`。Infra 的选择使用 `network`，取自 Arquiteto 发出的最近一个 `artifact.project_image`（`actor_id: "arquiteto"`，项目的任何会话），由 engine 在本地读取；没有它的决定，或值不在 `none`/`egress` 之内时，仍为 `none`。适用于接受时服务器的启动以及工具 `propose_container_start`（不带 `network` 时）。预置的自主权不变：`egress` 无需点击即可启动，其代价（`egress` 网络能到达本机已发布的端口，ADR 0189）已在 ADR 中声明。

- **代码：** `apps/engine/lib/engine/session_events/event.ex:139`（`rede_do_arquiteto`），
  `apps/engine/lib/engine/infra/infra_lead_server.ex:740`（`rede_herdada`）
- **测试：** `apps/engine/test/engine/infra/infra_lead_server_test.exs`——
  "RN-723: a subida herda a rede `egress` que o Arquiteto declarou" 和
  "RN-723: rede do Arquiteto fora do vocabulário — a subida segue `none`"
- **来源：** AT-392

## Anamnese 不为同一窗口付两次钱，gate 救援不重启正在等人的周期（RN-722）

### RN-724 — 停放的 gate 周期通过消息流中的按钮恢复，而不只是通过操作员的终端 {#rn-724}

- **规则：** 被救援「停放」的 gate 周期（[RN-722](#rn-722)，[ADR 0207](../adr/0207-ciclo-de-gate-velho-estaciona.md)）通过 `POST /projects/:projectId/tasks/:taskId/gates/:gate/resume` 恢复，最低角色与决定 PR 的人「相同」（`developer`）。api 只做授权并请求 engine（`POST /internal/projects/:id/tasks/:taskId/gates/:gate/resume`），后者委托给 `GateRescuer.retomar_estacionado/3`：周期不存在、未停放或 gate 不在 `qa`/`secops` 之内时为 409 `gate_nao_estacionado`，不派发任何东西。在会话消息流中，`gate.rescue_parked` 事件变成带「Retomar gate」按钮的提示，角色达不到 `developer` 时按钮不可操作并以文字说明原因；拒绝时显示 api 的句子。没有新的轮询：恢复后 gate 的进展通过会话日志到达。
- **位置：** `apps/engine/lib/engine_web/controllers/gate_command_controller.ex:15`
  （`resume`），
  `apps/api/src/application/use-cases/gates/resume-parked-gate.use-case.ts:18`
  （`execute`），
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts:351`
  （`resumeParkedGate`），
  `apps/api/src/interfaces/http/gates/gate-resume.controller.ts:40`
  （`resume`），`apps/web/src/routes/RetomarGateEstacionado.tsx:59`
  （`RetomarGateEstacionado`）
- **测试：** `apps/engine/test/engine_web/controllers/gate_command_controller_test.exs`
  （"ciclo estacionado: 202 e despacha o gate de novo"；失败："ciclo NÃO
  estacionado: 409 nomeado e nada despachado"），
  `apps/api/test/interfaces/http/gates/gate-resume.controller.spec.ts`
  （正常、409 `gate_nao_estacionado`、低于 `developer` 的角色），
  `apps/web/src/routes/RetomarGateEstacionado.test.tsx`（点击调用路由；拒绝变为带 api 句子的 toast；角色不足让按钮不可操作）
- **来源：** AT-397，关闭了 RN-722 中声明的缺口

### RN-725 — 带字面转义的文本会被解码，参数拒绝会说明收到了什么 {#rn-725}

**背景：** 在 TP-01 中（10月3日，Claude Haiku 4.5），PO 写下的故事标题带有「字面」的 unicode 转义（`código`）：RN-719 的规范化只解码 `array`/`object` 字段。以正确标题重新创建后，这些故事又经过了重复拒绝（RN-720/RN-081），它没有把转义形式与正常形式匹配起来。而「exige X」类的拒绝不说明收到了什么：PO 花了 28 步以上（测试成本的 48%）直到上限，`complete_story` 回应「ainda faltam RF, DoD, DoR ou business_rule_ids」却不说是哪个。

**规则：**

1. 在 RN-719 的同一位置，带「字面」`\uXXXX` 的字符串（包括代理对）会被解码，同时解码「同一」字符串中的 `\n`、`\t`、`\"` 和 `\\`。不含 `\uXXXX` 的字符串逐字节原样返回——`content` 中带字面 `"\n"` 的代码不会改变。这只在这种情况下修订 RN-719 的「`string` 字段绝不被触碰」。
2. 故事（api）和规则（engine）的「精确」重复比较的是解码转义后的标题，在照常的大小写和 NFD 处理之前。
3. 说「exige `X`」的工具拒绝，在同一位置加上收到的「键」（名称，绝不是值），或者说明收到的是字符串/列表而不是对象。`emit_artifact` 若 `payload` 中缺少键，会说明缺失的键和收到的键，而不是 `{:missing_keys, …}`。
4. `complete_story` 准确点名缺少什么（`falta: business_rule_ids`），使用与 api 的 `missingForReady` 相同的标准，从返回的故事中读取。

- **位置：** `apps/engine/lib/engine/harness/argumentos_de_ferramenta.ex:88`
  （`decodificar_escapes`），`:135`（`chaves_recebidas`），`:152`
  （`com_chaves_recebidas`）；`apps/engine/lib/engine/harness/tools/complete_story.ex:80`
  （`faltam`）；`apps/api/src/domain/backlog/story-overlap.ts:39`
  （`decodificarEscapesLiterais`），`:25`（`normalizarTitulo`）；
  `apps/engine/lib/engine/harness/artifact_dedupe.ex`（`normalizar`）
- **测试：** `apps/engine/test/engine/harness/argumentos_de_ferramenta_test.exs`
  （describe "RN-725"：转义被解码，不含 `\u` 的文本和列表保持不变；拒绝带键而不带值；`complete_story` 点名字段）；
  `apps/api/test/domain/backlog/story-overlap.spec.ts`（转义的标题与正常标题匹配；不同的标题仍不同）
- **来源：** AT-405，AT-408

### RN-726 — provider 额度耗尽会暂停 dev agent，来源为 `infra`，不会烧掉后续任务 {#rn-726}

- **规则：** 当模型的 provider 因缺少「额度」而拒绝时（HTTP 402，或 OpenRouter 的文本「available credits」/「add credits」），dev agent 的轮次不是「停下而未完成」：任务以原因「crédito do provider esgotado」和来源 `infra`（绝不是 `codigo`）被阻塞，自动停止（RN-047）的计数器「不」前进，agent 也「不」领取下一个任务——它保持 `idle_tripped` 并发出 `dev.credit_exhausted`（`motivo: credito_esgotado`），绝不是 `dev.idle_tripped`。恢复方式是团队面板中已有的「Rearmar」，在充值额度之后；被阻塞的任务通过常规的解除阻塞回来。「执行者」界面把 agent 显示为 `travado`，带「crédito do provedor do modelo esgotado —
  recarregue e rearme para retomar」，通知铃也这样说。同样的识别让 `FalhaDeTurno.origem/1` 对额度的最终帧返回 `infra`（适用于 gate 的 agent，例如 QA）。会话把 `dev.credit_exhausted` 计为待处理工作，与 `dev.idle_tripped` 一样。自 RN-730 起，402 带有自己的 `code`（`insufficient_credit`），由它来决定；按文本识别只作为兜底。
- **位置：** `apps/engine/lib/engine/agents/falha_de_turno.ex:134`
  （`credito_esgotado?`），
  `apps/engine/lib/engine/dev/dev_agent_server.ex:906`（`handle_outcome`），
  `apps/engine/lib/engine/dev/agent_io.ex:271`（`pausar_por_credito`），
  `apps/web/src/lib/agent-status.ts:198`（`breakerReasonFor`），
  `apps/api/src/application/use-cases/sessions/get-session-pending-work.use-case.ts`
- **测试：** `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  （"402 do provider: origem infra, pausa sem idle_tripped e sem queimar a
  próxima task"；失败："erro que não é de crédito segue como antes: parou sem
  concluir, conta no disjuntor"），
  `apps/engine/test/engine/agents/falha_de_turno_test.exs`（"402 do provider
  é infra e é reconhecido"），`apps/web/src/lib/agent-status.test.ts`
  （"RN-726: dev.credit_exhausted é travado com motivo de crédito…"）
- **来源：** AT-407（10月3日的 TP-01：OpenRouter 的 402 变成了三个来源为 `codigo` 的被阻塞任务以及自动停止）

### RN-731 — 轮次收尾用服务器的数字说明写入了什么 {#rn-731}

- **规则：** 对话型 agent 在一个轮次中写入了多少，是服务器的「事实」，绝不是模型的文本（RN-163）。Criativo、PO 和 Arquiteto 在轮次进程中统计每个返回 `ok` 的写入工具（`emit_artifact` 按类型——业务规则、决定、笔记、其他——以及 `create_epic`、`create_story`、`update_story`、`archive_story`、`create_task`），`agent.response` 的收尾在模型文本「之后」、不改写它地加上一行「Gravado neste turno: N …」。被拒绝的工具和读取不计；没有写入的轮次不加这一行；计数随轮次结束。这一行使用轮次的语言（RN-622）：作者的，否则是项目的；`pt*` 用葡萄牙语（「Gravado neste turno: 1 regra de
  negócio」），任何其他语言——或没有解析出语言——用英语（「Recorded this turn: 2 business rules」），两种语言都有单复数。
- **位置：** `apps/engine/lib/engine/agents/gravado_no_turno.ex:62`（`anotar`），
  `:95`（`descarregar`），
  `apps/engine/lib/engine/harness/idioma_da_resposta.ex:272`（`idioma_do_turno`），
  `apps/engine/lib/engine/agents/texto_do_turno.ex:65`（`payload_do_turno`）
- **测试：** `apps/engine/test/engine/agents/gravado_no_turno_test.exs`（正常：写入了六条规则和一项决定，一个被拒绝——模型的收尾「8 regras」保留，旁边加上「6 regras de negócio, 1 decisão」；没有写入：什么也不追加；pt-BR 和 en，单复数；两者之外的语言落到 en），
  `apps/engine/test/engine/agents/criativo_server_test.exs`
- **来源：** AT-414（10月3日的 TP-01：Criativo 以「Registrei as 8
  regras de negócio」收尾，而面板上有 6 条）

### RN-732 — 轮次的文本经过与参数相同的转义标准 {#rn-732}

- **规则：** 模型在对话型 agent 轮次中写的文本——`content`（收尾）和每个 `passos`（属于 `agent.response`）——在写入之前经过 RN-725 的「同一个」`decodificar_escapes/1`：字面的 `\u00e3` 变成 `ã`。只有一套标准，没有副本，限制也相同：只在有字面 `\uXXXX` 时起作用，因此没有转义的文本——包括围栏代码块中带字面 `"\n"` 的代码——逐字节原样返回。流式的 `agent.delta`「不」解码：一个转义可能被拆在两个 delta 之间，而写入的气泡会在轮次结束时替换进行中的文本。这是一条独立规则，而不是 RN-725 的一个条款，因为作用面不同（模型的回答，不是工具参数），关于 delta 的决定属于这一条。
- **位置：** `apps/engine/lib/engine/agents/texto_do_turno.ex:65`（`payload_do_turno`），
  `apps/engine/lib/engine/harness/argumentos_de_ferramenta.ex:88`（`decodificar_escapes`）
- **测试：** `apps/engine/test/engine/agents/texto_do_turno_test.exs`（正常：测得的五个转义，在收尾和一个步骤中；不变：没有转义的文本以及带字面 `\n` 的代码块）
- **来源：** AT-417（10月3日的 TP-01，第 2 轮：Criativo 的最终回答被写入时带有「colis\u00e3o」、「usu\u00e1rio」以及另外三个转义出现在气泡中）

### RN-733 — 额度失败会说明该怎么做，`reason` 绝不是元组 {#rn-733}

- **规则：** `reason`，写在 `agent.error` 中，属于对话型 agent、Infra Lead 和 `ToolLoop`（dev agent），在有最终帧时是它的「文本」——绝不是被 inspect 的元组 `{:final, …}`；其他形式仍用 `inspect/1`。provider 额度耗尽时（`errorCode:
  insufficient_credit`，RN-730，或 RN-726 的按文本识别），气泡的 `mensagem` 简短且可操作，使用轮次的语言（RN-622）：pt 为「Crédito do provedor do modelo esgotado — recarregue a chave e tente de
  novo.」，其他任何语言为「The model provider's credit is exhausted —
  top up the key and try again.」；没有解析出语言时用 pt-BR。provider 的 JSON 只留在 `reason` 中（诊断）。其他错误保留常规句子。
- **位置：** `apps/engine/lib/engine/agents/falha_de_turno.ex:158`（`mensagem`），
  `:181`（`diagnostico`）
- **测试：** `apps/engine/test/engine/agents/dev_lead_server_test.exs`（pt-BR 和 en 下的 402：简短句子，`reason` 不含 `{:final`；`upstream` 错误：常规句子），`apps/engine/test/engine/agents/falha_de_turno_test.exs`
- **来源：** AT-421（10月3日的 TP-01，第 2 轮：Dev Lead 写入了 `reason: "{:final, …"`，气泡倾倒了 402 的 JSON）

### RN-735 — Arquiteto 镜像的 `none` 网络会说明它不会安装依赖 {#rn-735}

- **规则：** `choose_project_image` 的描述及其「结果」说明，在 `none` 网络下，任何包管理器（npm、pnpm、pip、mix、cargo、go mod...）都不会在容器中安装依赖，并且 Infra 会继承这个网络（RN-723）。为 `none` 时，结果要求模型在技术栈需要安装依赖时以 `egress` 再次调用该工具。这是「提示」，绝不是拒绝：api 不猜测技术栈，broker 的隔离（ADR 0130）不变。
- **代码：** `apps/engine/lib/engine/harness/tools/choose_project_image.ex:96`
  （`mensagem_de_fixada`），`apps/engine/lib/engine/harness/tools/choose_project_image.ex:23`
  （`spec`）
- **测试：** `apps/engine/test/engine/harness/tools/choose_project_image_test.exs`
- **来源：** AT-420（10月3日的 TP-01：`node:22-bookworm-slim` 使用 `none` 网络，dev agent 无法 `npm install`）

### RN-742 — dev agent 不会静默死亡，迟到的 HTTP 回应不会留在它的信箱中 {#rn-742}

- **规则：** engine 对 api 的每个非流式 HTTP 调用（`post_returning/3` 以及 `EngineApiClient.Live` 的 GET）都在一个一次性的 `Task` 中运行；在 `receive_timeout` 之后到达的回应会落到一个已经结束的进程中，绝不会进入调用方的信箱，请求内部的异常以 `{:error, _}` 返回。并且「崩溃」的 dev agent（退出原因既不是 `:normal` 也不是 `:shutdown`）不被当作已结束：`Engine.Dev.Monitor` 写入「持久」的 `agent.error`，来源为 `infra`（`reason: processo_do_dev_caiu`、`religado`、`taskId`），并从它自己在 `dev_agent_states` 中的那一行「重新启动」它，每个 agent 最多 3 次；`resume` 经过已有的 `handle_continue({:restart_recovery, _})`，它以诊断（来源 `infra`）阻塞被中断的 task，并尝试下一次领取。没有那一行，或达到上限时，该行被移除，错误说明没有重启。`llm_turn_stream/6` 不在隔离之内（`into:` 写入调用方的字典）；对话型 agent 已经在轮次的 Task 内部调用它（`TurnoAssincrono`），因此「GenServer 内的 HTTP」模式触及不到它们——已声明。web 没有改变：「执行者」标签页开始能看到恢复过程中的 `agent.error` 和 `dev.blocked`。
- **位置：** `apps/engine/lib/engine/sessions/engine_api_client.ex:2073`
  （`isolado`），`apps/engine/lib/engine/dev/monitor.ex:69`（`ao_terminar`），
  `:107`（`registrar_e_religar`）
- **测试：** `apps/engine/test/engine/sessions/engine_api_client_isolado_test.exs`
  （迟到的消息不到达调用方；异常变为 `{:error, _}`），
  `apps/engine/test/engine/dev/monitor_test.exs`（崩溃写入 infra 的 `agent.error` 并重启；`:normal` 删除该行；没有该行时不重启）
- **来源：** AT-428（10月8日：`CaseClauseError`，位于 `Finch.HTTP1.Conn.receive_response/8`，发生在 `npm install` 超时之后）

### RN-743 — 阻塞 task 会保留 worktree 中的工作，下一个 task 从它出发 {#rn-743}

- **规则：** 在阻塞一个 task 之前（任何来源，包括预算上限 `taskBudgetMicros`，其「值」在此不变），dev agent 留在 worktree 中的内容会变成 task 自身分支上的一个 commit，身份为 `<agente>[bot]`（`git add -A` + `commit --no-verify`）。`dev.blocked` 带有 `trabalhoPreservado`（`{branch, commit}` 或 `null`），诊断「说明」工作留在了哪里——或者说明无法保留它，并给出原因；保留失败绝不阻止阻塞。「同一」agent（因而是同一模块）的下一个 task 从这个分支产生（`create_from/4`），而不是从 `dev`，只此一次。干净的 worktree 不产生 commit。已声明：指针只存在内存中（engine 重启会丢失指针，而不是 commit），在 `runner` 模式下 worktree 在用户的机器上，engine 不保留任何东西。
- **位置：** `apps/engine/lib/engine/dev/worktree_manager.ex:72`
  （`preservar_em`），`:55`（`create_from`），
  `apps/engine/lib/engine/dev/agent_io.ex:491`（`preservar_trabalho`），
  `apps/engine/lib/engine/dev/agent_io.ex:321`（`base_preservada`）
- **测试：** `apps/engine/test/engine/dev/worktree_manager_test.exs`
  （`preservar_em/3 e create_from/4`：以 `dev-api[bot]` commit，下一个 task 能看到文件；干净时为 `:nada`；没有仓库的文件夹是错误），
  `apps/engine/test/engine/dev/bloqueio_preserva_trabalho_test.exs`（`dev.blocked` 说明分支；保留失败不阻止阻塞）
- **来源：** AT-429（10月8日：`feature/task-86dade03` 没有 commit，`package.json` 和 `src` 在因预算阻塞后丢失）

### RN-744 — dev 知道 shell 是 `sh`，并从查看自己的 worktree 开始 {#rn-744}

- **规则：** `terminal` 工具的描述说明容器的 shell 是 `sh`（dash），不是 bash——没有大括号展开，没有 `[[ ]]`，没有数组，没有 `source`——并给出可行的写法。dev agent 每个 task 的 kickoff 增加第二条固定消息，带 worktree 的「快照」：分支以及已存在的文件（已跟踪 + 未跟踪且未忽略），上限 80 行，截断时给出真实总数（ADR 0060）；由服务器组装，没有模型参数。engine 无法到达的文件夹（`runner` 模式）会说明快照不可用，并要求通过 `terminal` 列出。已声明且「未」修正：dev 的 worktree 可能在 infra PR 合并之前产生，因此 Infra 通过 PR 交付的内容可能不在它出发的 `dev` 中。
- **位置：** `apps/engine/lib/engine/harness/tools/terminal.ex:12`（`spec`），
  `apps/engine/lib/engine/dev/worktree_manager.ex:108`（`retrato`），
  `apps/engine/lib/engine/dev/dev_agent_server.ex:595`（`retrato_do_worktree`）
- **测试：** `apps/engine/test/engine/dev/worktree_manager_test.exs`
  （`retrato/2`：分支和文件；无法到达的文件夹说明不可用；terminal 的描述写明 `sh`）
- **来源：** AT-444（10月8日的 TP-01：dash 中的 `mkdir -p src/{a,b}`，以及 dev 重新创建已经存在的东西）

### RN-745 — 在被截断的回答中，只有不完整的调用被拒绝 {#rn-745}

- **规则：** 当模型的回答被输出上限截断时（`truncated: true`，[RN-737](api.md#rn-737)），只有回答中「最后」一个工具调用被视为不完整，并以命名的错误拒绝（现在它说明是「a última da resposta」，前面的已经执行，并要求「uma
  por chamada」）。同一回答中前面的调用正常执行——在代码中测得：OpenAI 兼容的流按顺序组装调用，截断落在最后一个上，api 的 `parseArgumentos` 对断开的 JSON 返回 `{}`。调用按名称和参数识别。没有已知调用的被截断回答仍拒绝所有工具（RN-737 的标准）。`propose_adr` 的描述引导每个回答一个 ADR。
- **位置：** `apps/engine/lib/engine/harness/resposta_cortada.ex:44`
  （`registrar`），`:64`（`incompleta?`），
  `apps/engine/lib/engine/harness/argumentos_de_ferramenta.ex:26`（`executar`），
  `apps/engine/lib/engine/harness/tools/propose_adr.ex:27`（`spec`）
- **测试：** `apps/engine/test/engine/harness/resposta_cortada_test.exs`（"só
  a última chamada da resposta cortada é recusada; as completas executam"；
  "ferramenta de resposta cortada NÃO executa"，没有已知调用）
- **来源：** AT-430（10月8日：Arquiteto 在一个被截断的回答中发送了 5 个 `propose_adr`，五个全部被拒绝；0 个 ADR）

### RN-746 — Arquiteto 的收尾说明它写入了什么，被拒绝的写入会被计数 {#rn-746}

- **规则：** [RN-731](#rn-731) 的事实行「Gravado neste turno: …」改为也计入 Arquiteto 的写入（提议的 ADR、模块映射、模块指派、决定的镜像、C4 图、给 infra 的路由、模块契约、insight）、Staff 的 RFC 和 UX Designer 的原型，并单独计数该轮中被拒绝的「写入」调用（`{:error, _}`）：「…; N chamadas de escrita recusadas」。尝试写入却什么也没写成的轮次以「Gravado neste turno: nada; N
  chamadas de escrita recusadas.」收尾（en："Recorded this turn: nothing; N write
  calls refused."）。Criativo 改为也记录拒绝；Staff 和 UX Designer 开始记录。读取从不计入。模型的文本不被改写（RN-163：agent 不把服务器拒绝的东西宣布为已完成——读者会在旁边看到事实）。已声明排除在外：Dev Lead（计划会挂起轮次，RN-284）和 Infra Lead。
- **位置：** `apps/engine/lib/engine/agents/gravado_no_turno.ex:77`（`anotar`），
  `:96`（`descarregar`），`:141`（`classe`），
  `apps/engine/lib/engine/agents/arquiteto_server.ex:323`（`dispatch_tool`）
- **测试：** `apps/engine/test/engine/agents/gravado_no_turno_test.exs`
  （"Arquiteto com as cinco propose_adr recusadas fecha com nada gravado"；
  "escritas do Arquiteto contadas, leitura e ferramenta desconhecida não"）
- **来源：** AT-431（10月8日：5 个 `propose_adr` 都是 `ok: false`，Arquiteto 却以「✅ ADRs Propostas (5 decisões críticas)」收尾，没有事实行）

### RN-756 — Anamnese 只在对象有技术内容的互动时运行；批准不算 {#rn-756}

- **规则：** 修订 RN-680/RN-722 中「自己的互动」的计数。只有以下内容能让某人成为轮次的对象：(a) 该成员自己的 `actor_kind: "user"` 事件，且类型在 `tipos_de_evento_com_conteudo/0` 中——`chat.message`（他写的消息）和 `chat.structured_question_answered`——以及 (b) 带书面拒绝原因的操作决定（非空的 `rejectionReason`，即一次修正）。批准、接受 handoff、点击以及任何其他用户事件都「不」算：它们不是能力的证据。5 次的下限（RN-722）、每日上限以及没有对象时的结局（原因记日志；`anamnese.run_skipped` 只在手动请求的轮次中）不变，分诊仍是「本地」的，在 LLM 和 RAG 之前。
- **代码：** `apps/engine/lib/engine/anamnese/elegibilidade.ex:61`
  （`avaliar`），`:102`（`recusa_com_motivo?`），`:108`
  （`tipos_de_evento_com_conteudo`）
- **测试：** `apps/engine/test/engine/anamnese/elegibilidade_test.exs`
  （`só interação com conteúdo técnico conta (RN-756, AT-439)`：消息和结构化回答使人成为对象；只有批准、handoff 和不带原因的拒绝则不会）
- **来源：** AT-439（TP-01，10月8日，项目 `c1dc053d`：执行期间两次轮次，0.20 美元，都以「o usuário apenas
  aprovou propostas」为由 `skip_proficiency`）

### RN-757 — 自动批准的 `terminal` 会等待命令，命令的上限是 2 分钟 {#rn-757}

- **规则：** api 自动批准的 `terminal` 操作在 `propose_action` 的同一请求中「执行」（api → engine `/internal/actions/execute` → api `container-exec` → broker），engine 等待该请求 `TERMINAL_ACTION_TIMEOUT_MS` + 120 秒——而不是 `Req` 的默认 15 秒。命令的上限（`TERMINAL_ACTION_TIMEOUT_MS`）在三个 compose 和 `runtime.exs` 中从 15 秒改为 120 秒。链条变为 broker (T) < api → broker（T + 最多 45 秒，[RN-604](api.md#rn-604)）< engine → `container-exec`（T + 90 秒）< engine → `propose_action`（T + 120 秒），T = 120 秒时最外层（240 秒）仍低于 Node `fetch` 的 300 秒头部超时。如果等待仍然超时，模型收到「命名」的文本——以秒计的上限、进程可能仍在运行，以及带日志的 `nohup … &` 建议——绝不是原始的 `%Req.TransportError{reason: :timeout}`。考虑过异步/流式 exec 但没有做：能让常见 `npm install` 放得下的最小改动就是上限。
- **位置：** `apps/engine/lib/engine/sessions/engine_api_client.ex:1919`
  （`opcoes_do_propose_action`）以及
  `apps/engine/lib/engine/harness/hooks/action_pipeline.ex:80`
  （`resultado_de_teto_do_terminal`）
- **测试：** `apps/engine/test/engine/sessions/engine_api_client_propose_terminal_test.exs`
  （耗时 16 秒的假 api 仍被等待；各上限的顺序低于 300 秒；超时文本点明上限）
- **来源：** AT-440（10月8日的 TP-01：`npm install 2>&1 | tail -50` 在 `node:22-bookworm-slim` 容器中返回「falha no pipeline:
  %Req.TransportError{reason: :timeout}」；在这台机器上测得，同样的 `npm install`（`bcrypt`+`sqlite3`+`express`） 在镜像已缓存且有预编译包时耗时 5.3 秒——在 15 秒处截断的是链条，不是命令）

### RN-760 — dev agent 的下一个 task 从它最后一个尚未合并的分支出发 {#rn-760}

- **规则：** 推广 [RN-743](#rn-743)。结束一个 task 时——在 gates 中获批（`nextAction: "done"`）或因「任何」原因被阻塞，包括由 api 决定、只以 `gate_resolved` 到达 engine 的「ciclo de correção esgotado (gate)」——dev agent 保存它的分支，「同一」agent（因而是同一模块）的下一个 task 从这个分支产生，而不是从 `dev`。worktree 中未提交的剩余内容会先被保留，与 RN-743 一样；`block_task/4` 写下的指针不被覆盖。当前一个分支已经是本地 `dev` 的祖先（已合并）时，下一个从已经包含它的 `dev` 出发。队列「何时」前进不变：下一个 task 仍在 gates 结束时、用户合并之前领取（负责人的决定）。已声明：远程的 squash 合并不会让分支成为 `dev` 的祖先，因此下一个仍从它出发；指针仍只在内存中，在 `runner` 模式下合并检查不运行。
- **位置：** `apps/engine/lib/engine/dev/agent_io.ex:296`
  （`levar_branch_para_a_proxima`），`:324`（`criar_worktree`），
  `apps/engine/lib/engine/dev/worktree_manager.ex:199`
  （`ja_mergeada_volta_ao_trabalho`）
- **测试：** `apps/engine/test/engine/dev/bloqueio_preserva_trabalho_test.exs`
  （`levar_branch_para_a_proxima/1 e criar_worktree/2`：获批的把分支带给下一个；阻塞的指针不被覆盖），
  `apps/engine/test/engine/dev/worktree_manager_test.exs`（`add_worktree/4
  com a branch da task anterior`：未合并时从它出发，已合并时从 `dev` 出发）
- **来源：** AT-447（10月9日的 TP-01：task `762833bd` 和 `5ebad64b`——第二个从 `dev` 产生，没有第一个的登录路由，QA 否决了）

### RN-763 — 结束执行会话会停止 dev agents 和 gates，「执行者」标签页中有「Parar execução」 {#rn-763}

- **规则：** 会话的关闭（`session.closed`/`closed_abnormally`，由 `SessionLifecycleWorker` 进行，所有关闭都经过这一点）在所有节点上「停止」它的 dev agents，并停止项目的 gates（QA lead 和 SecOps）——即对话型 agent 早已适用的标准（[RN-581](api.md#rn-581)）。进程立即被终止，不写入进行中的轮次，`Engine.Dev.Monitor` 事先被通知（`esquecer/1`）：持久行被移除，agent「不」被重启（[RN-742](#rn-742)）。对每个有进行中 task 的 dev（`working`、`awaiting_approval` 或 `awaiting_gate`），worktree 中的工作变成 task 分支上的 commit（[RN-743](#rn-743)），task 以原因「sessão de execução encerrada」、来源 `politica` 被「阻塞」，诊断说明工作留在了哪里——人解除后回到队列，绝不丢失。会话的 `gate_states` 行被移除，这样 `GateRescuer` 不会重开已结束会话的周期。「执行者」标签页增加「Parar execução」（角色 `developer`，即结束会话的角色），其机制就是「同一个」关闭（`closing` → `closed`），没有新状态；确认在点击之前说明会留下什么：进行中的任务（带计数）、打开的 PR、待处理的审批，以及会话不能重新打开。已声明：dev agent 的待处理操作仍是待处理；打开的 PR 仍是打开的；带 `execution.activated` 的会话不能重新打开（[RN-650](api.md#rn-650)），所以恢复就是在新会话中激活执行；确认中的任务计数来自标签页的事件窗口。会话栏「Encerrar」上的确认属于另一项活动（AT-452）。
- **位置：** `apps/engine/lib/engine/dev/encerramento_da_sessao.ex:40`
  （`parar_da_sessao`），`:74`（`parar_processos`），`:104`（`devolver_task`），
  `apps/engine/lib/engine/dev/monitor.ex:34`（`esquecer`），
  `apps/engine/lib/engine/workers/session_lifecycle_worker.ex:94`
  （`parar_execucao`），`apps/web/src/components/PararExecucao.tsx`
- **测试：** `apps/engine/test/engine/dev/encerramento_da_sessao_test.exs`
  （dev 死亡且不被重启，行被移除，task 以来源 `politica` 被阻塞；没有 dev 的会话为空操作，其他会话的 dev 保持运行），
  `apps/web/src/components/PararExecucao.test.tsx`（确认说明会留下什么并关闭 `closing` → `closed`；api 的拒绝留在确认中；没有角色时按钮不可操作并说明原因）
- **来源：** AT-456（10月9日的 TP-01：执行会话结束后，`dev-encurtador-api` 阻塞了任务 3，领取了任务 4 并打开了 PR；唯一的刹车是停止容器）

### RN-765 — QA 的 gate 评判「任务」，兄弟任务的 RF 只是观察 {#rn-765}

- **规则：** QA 策略（测试计划，[RN-674](#rn-674)）和 QA 自动化除了故事之外，还收到任务的「截取」：标题和描述、故事的业务规则，以及同一故事的「其他」任务及其状态（`siblingTasks`，位于 `GET .../dev-context`）。裁决针对的是「本」任务的内容：属于兄弟任务（已完成或待处理）的需求不导致否决——它作为观察进入 `resumo`，不在 `itens` 中，不妨碍 `approved`。这是「提示词」标准，不是代码：`emit_qa_verdict` 仍只要求测试套件全绿即可批准。自 AT-479 起，当任务描述或某条规则「按项」量化时（「por
  X」、「cada」、「de todos os」——「por exemplo」/「por padrão」不算），截取增加「Forma da resposta」一节：检查回答带有「每一项」的值，而不只是总数（只带 `{totalCliques}` 就被批准的面板，对应「a contagem… de todos os links」），以及输入拒绝会点名字段——后者是 `resumo` 中的「观察」，不在 `itens` 中，除非有规则要求。仍是提示词标准：代码中没有新的否决。
- **位置：** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:18`（`texto`），
  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:82`（`secao_da_forma`），
  `apps/api/src/application/use-cases/execution/get-dev-task-context.use-case.ts:195`
  （`tarefasIrmas`）和 `apps/engine/lib/engine/gates/qa_automacao_agent.ex:170`

  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:82`（`secao_da_forma`），
  `apps/api/src/application/use-cases/execution/get-dev-task-context.use-case.ts:195`
  （`tarefasIrmas`）和 `apps/engine/lib/engine/gates/qa_automacao_agent.ex:204`
  （`com_o_recorte`）
- **测试：** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`（自 AT-479 起还有「regra que quantifica por item pede a conferência da forma da
  resposta」以及没有量词的情形）和
  `apps/api/test/application/use-cases/execution/get-dev-task-context.use-case.spec.ts`
  （兄弟任务不含任务本身）。QA 的 golden-set（ADR 0168）「没有」增加用例：它运行真实模型，不付费调用就无法证明裁决——已声明。
- **来源：** AT-448（10月9日的 TP-01：任务「Modelar tabela
  de usuários e hash bcrypt」的 QA gate 三次以「RF01: login HTTP com
  JWT não existe nesta entrega」否决，那属于另一个任务，任务被阻塞；`artifact.qa_verdict`，属于 task `42bea901` 和 `762833bd`）

### RN-772 — Arquiteto 读取它提议的 ADR 的「当前」状态 {#rn-772}

- **规则：** Arquiteto 拥有读取工具 `listar_adrs_propostas`：「项目」的 `open_adr_pr` 操作，现在从 `proposed_actions` 读取（同一个 Postgres，循环中没有 HTTP），带每一个的状态——待处理、已批准、自动批准、已执行（带 PR 的 URL）、已拒绝（带原因）或失败。受控（ADR 0060，[RN-164](#rn-164)）：没有参数，范围限定在上下文的项目中，每次调用一次计数和一次查询，最近 20 个，截断时说明真实总数。读取失败是带原因的 `tool.result` `ok: false`，绝不是空文本。自 [RN-784](api.md#rn-784) 起它「在」Jev 的下限之中。
- **位置：** `apps/engine/lib/engine/harness/tools/listar_adrs_propostas.ex:37`
  （`run`），`:40`（`ler`），`apps/engine/lib/engine/agents/arquiteto_server.ex:124`
  （`ListarAdrsPropostas`）
- **测试：** `apps/engine/test/engine/harness/tools/listar_adrs_propostas_test.exs`
  （已批准的显示为已批准，已执行的带 PR，已拒绝的带原因，只有本项目的；上限带真实总数；没有提议；读取失败变为命名的错误）
- **来源：** AT-454（10月9日的 TP-01，会话 `771131f4`：3 个 ADR 已批准，下一个收尾却说「As 3 ADRs seguem pendentes de aprovação」）

### RN-773 — Arquiteto 读取 backlog，并在断言状态之前先查询 {#rn-773}

- **规则：** Arquiteto 获得与 PO 相同的 `listar_backlog`（[RN-164](#rn-164)），带每个故事的任务数。它的 kickoff 和 `propose_adr` 的结果说明 ADR 的状态和任务会在对话之外变化，并要求在断言它们之前查询这两个读取，而不是依赖之前某个结果的快照。这里不叙述任何团队流程（[RN-711](#rn-711)）。
- **位置：** `apps/engine/lib/engine/agents/arquiteto_server.ex:125`
  （`ListarBacklog`），`apps/engine/lib/engine/harness/tools/propose_adr.ex:94`
  （`propor`）
- **测试：** `apps/engine/test/engine/harness/tools/listar_backlog_test.exs`
  （每个故事的任务数），`apps/engine/test/engine/agents/arquiteto_server_test.exs`
  （两个读取都在 Arquiteto 的目录中）
- **来源：** AT-454（10月9日的 TP-01：backlog 中有 17 个任务，Arquiteto 却说「faltam as tarefas」和「não consigo verificá-las daqui」）

### RN-774 — 每个模块的第一个任务拥有两倍的单任务上限 {#rn-774}

模块的第一个任务搭建整个骨架（清单、应用、数据库、测试），比后续任务花费更多：在 10月8日的 TP-01 中，它使用 Haiku 4.5 花费了 US$ 0.53，被 US$ 0.50 的固定上限（`taskBudgetMicros: 500000`）阻塞。根据所有者的决定（10月9日），它获得**2 倍的单任务上限**（默认为 US$ 1.00）；其余任务沿用配置的上限。倍数是 engine 中的命名常量，而不是配置。

"第一个"由日志衡量，绝不由任务状态衡量：它是其 `backlog.task_claimed` 在项目中针对该模块*最早*的任务。阻塞会清空 `assigned_to`，重启 engine 会丢失进程的记忆；日志不变，因此同一任务在被释放后再次被领取时仍然是第一个，gate 要求的修正也会获得 2 倍。api 在 dev 的上下文中返回 `task.primeiraDoModulo`（没有 `module` 时为 `false`，该模块没有任何领取时也为 `false`——正常上限是保守的），*有效*上限在 engine 的单一位置解析。因预算而阻塞时会说明对该任务生效的上限（"teto da primeira tarefa do módulo: 1000000 micro-USD,
US$ 1.00"）。QA 的 gate 仍使用基础的 `task_budget_micros`——不在卡片的范围之内。

- **位置：** `apps/engine/lib/engine/dev/teto_da_tarefa.ex:32` (`efetivo`);
  `apps/engine/lib/engine/dev/dev_agent_server.ex:669` (`diagnostico_de_orcamento`);
  `apps/api/src/application/use-cases/execution/get-dev-task-context.use-case.ts:182`
  (`ehPrimeiraTarefaDoModulo`)
- **测试：** `apps/engine/test/engine/dev/dev_agent_server_test.exs`（describe
  "RN-774"：花费 US$ 0.53 的第一个不阻塞，同一模块的第二个阻塞——失败用例——，另一个模块的第一个也获得 2 倍）；
  `apps/engine/test/engine/dev/teto_da_tarefa_test.exs`;
  `apps/api/test/application/use-cases/execution/get-dev-task-context.use-case.spec.ts`
  （describe "RN-774"）
- **来源：** AT-433

### RN-778 — 孤儿 dev agent 在启动时以新事件关闭 {#rn-778}

- **规则：** 启动时，对每个非终止会话，最后一个 `dev.*` 是等待类（`dev.working`、`dev.blocked`、`dev.idle_tripped` 以及 `GetSessionPendingWorkUseCase` 计入的其他事件）且在「本」会话的 `dev_agent_states` 中「没有」行的 dev agent，获得 `dev.error`，来源为 `infra`（`reason: dev_agent_sem_processo`），随后是 `dev.idle`，后者把它从待处理工作的标准中移除（[RN-064](web.md#rn-064)）。这是 [RN-586](#rn-586) 套用于 `dev.*` 词汇：绝不重新执行，绝不改写事件，持久行是所有权的证明——有它时 `DevRehydrator` 会重启 agent，关闭它就是杀死一个健康的 agent。不触碰任务：被阻塞或 PR 等待合并的任务仍按 RN-776（AT-457）保住当前执行会话，它有人类所有者。
- **位置：** `apps/engine/lib/engine/dev/dev_orfao.ex:49`（`varrer`），
  `apps/engine/lib/engine/sessions/rehydrator.ex:81`（`varrer`）
- **测试：** `apps/engine/test/engine/dev/dev_orfao_test.exs`（孤儿以 infra 的 `dev.error` + `dev.idle` 关闭；有持久行的和已经 `idle` 的不关闭；读取失败时什么也不关闭）
- **来源：** AT-465（10月9日的 TP-01：会话 `63a4e1aa` 因一个没有进程的 `dev.working` 被心跳每 30 秒重新调度）

### RN-779 — （重新）领取的 task 的 worktree 从「当前」的 `dev` 出发并整合它 {#rn-779}

- **规则：** 在创建 task 的 worktree 之前（第一次或恢复时），engine 在项目的工作树中执行 `git fetch origin`（按项目串行化）——PR 是在远程合并的，而本地的 `dev` 只在初始化的 checkout 时前进。当本地落后时，`dev` 的末端是 `origin/dev`。task 产生自：(1) 未合并的前一个 task 的分支（RN-760），(2) 当它自己的分支有 `dev` 不包含的工作时，产生自「它自己」的分支——在新进程中恢复的 task，丢失了内存中的指针（RN-743）——或 (3) `dev` 的当前末端。在情况 (1) 和 (2) 中，worktree 在第一步之前「整合」`dev` 的末端（`merge --no-ff`，身份 `<agente>[bot]`）。这次整合中的冲突是「命名」的拒绝（「conflito ao
  integrar a `dev` atual」，附文件），合并被中止，源分支保持不变，task 以专门的原因和来源 `codigo` 阻塞。失败的 `fetch` 以 git 的原因阻塞 task，绝不落到旧的 `dev`。合并冲突后的重新接管（RN-715）不会自行整合。在 TP-01 中测得：AT-447 在第 1 次领取时「触发」了（reflog：`Created from
  feature/task-b3cc92b8`）；丢失基准的是重新领取，它把分支重置到停在 infra 合并处的「本地」`dev`（`Reset to dev`）。已声明：在 `runner` 模式下这些都不运行（git 属于用户的机器）。
- **位置：** `apps/engine/lib/engine/dev/worktree_manager.ex:151`
  （`atualizar_remoto`），`:195`（`add_worktree`），`:227`
  （`ponta_do_trabalho`），`:225`（`retomada`），`:300`（`integrar_trabalho`）
- **测试：** `apps/engine/test/engine/dev/worktree_manager_test.exs`
  （`integração da dev atual (RN-779)`：带旧分支的恢复从远程的新 dev 出发；保留的工作整合新的 dev；处于 `awaiting_user` 的前一个是整合了 dev 的基准；冲突是命名的拒绝）
- **来源：** AT-458（10月9日的 TP-01：`feature/task-c80daf6c` 从 `1fa2241` 产生，没有之后合并的 12 个任务，合并冲突了）

### RN-780 — 被上限截断、只有推理的回答是截断，不是放弃 {#rn-780}

- **规则：** 在 `ToolLoop` 中（所有执行型和 gate agent 的路径），没有文本也没有工具调用、被 api 标记为 `truncated: true`（RN-737 的 `finish_reason: length`）的回答，是推理吃掉了输出上限。这一轮重试「一次」，不把空回答放入历史，并计入迭代——迭代上限和任务预算仍然有效。如果再次发生，循环以 `corte_pelo_teto` 标记停止，dev agent 以原因「resposta só de raciocínio, cortada
  pelo teto」和来源 `modelo` 阻塞 task，而不是「parou sem concluir nem reportar
  bloqueio」。中间出现一次工具调用会把重试清零。已声明：engine 从 api 收到 `truncated` 和 `usage.outputTokens`，但「没有」`reasoningTokens`（它们只在 `token_usage` 中），因此碰到上限却没有 `finish_reason: length` 的空回答不会被识别。
- **位置：** `apps/engine/lib/engine/harness/tool_loop.ex:219`
  （`parada_sem_chamada`），`apps/engine/lib/engine/dev/dev_agent_server.ex:1116`
  （`motivo_da_parada`），`:1119`（`stop_diagnosis`）
- **测试：** `apps/engine/test/engine/harness/tool_loop_test.exs`（`corte só
  de raciocínio`：重试一次后继续；重复时以 `corte_pelo_teto` 停止），`apps/engine/test/engine/dev/dev_agent_server_test.exs`
  （`resposta só de raciocínio cortada pelo teto bloqueia com motivo nomeado`）
- **来源：** AT-459（10月9日的 TP-01：任务 `c80daf6c` 在 40 秒内被阻塞，输出 8,192 个 token，全部是推理）

### RN-781 — dev 的 commit 消息不写入属于系统的待办 {#rn-781}

- **规则：** `report_done` 的摘要是 dev agent 的 commit 消息，commit、push 和 PR 由系统在它之后完成。在提议 `git_commit` 之前，engine 从待办标记（「Pendente」、「Pendência」、「Pending」）处截掉到末尾的内容，前提是其余部分谈论的是 commit、push 或 PR，并去掉括号「(ainda sem commit…)」；不涉及这些的待办保留。`summary` 字段的描述说明它会成为 commit 消息，不要叙述 commit、push 或 PR。变为空的摘要回落到默认消息 `<agente>: <task>`。
- **位置：** `apps/engine/lib/engine/dev/agent_io.ex:374`
  （`mensagem_de_commit`），`:373`（`propose_commit`），
  `apps/engine/lib/engine/dev/tools/report_done.ex:27`（`summary`）
- **测试：** `apps/engine/test/engine/dev/mensagem_de_commit_test.exs`
  （截掉叙述；去掉括号；与系统无关的待办保留）
- **来源：** AT-464 第 2 项（10月9日的 TP-01：`git log feature/task-9d6dcd53` 中有「Pendente: commit… as ações git_commit, git_push e pr_open não estavam
  disponíveis neste passo」）

### RN-787 — gate 针对来源的 `dev` 计算 PR 的 diff，QA 意见以列表写入 {#rn-787}

- **规则：** (1) QA 和 SecOps 评判的 diff（`dev...HEAD`，[RN-664](#rn-664)）使用工作树能看到的「最新」`dev`：来源为本地（磁盘上的路径）时，gate 先执行 `git fetch origin dev`，尽力而为，在 `origin/dev` 和本地 `dev` 之间取包含另一方的那个。PR 在来源处合并时，克隆的本地 `dev` 不会前进，SecOps 的意见会计入已合并任务的累计内容。来源为远程时 gate 中没有 fetch（凭据属于 `Workspace`）——已声明。semgrep 和 gitleaks 仍扫描整个 worktree，而不仅是 diff：收窄扫描器看到的范围会改变 gate 否决的内容，这留给负责人决定。(2) QA 意见的 `itens` 和 `coverageMatrix` 到达 `artifact.qa_verdict` 时总是「列表」：列表的 JSON 字符串会被解码（仿照 [RN-719](#rn-719)），不是列表的字符串变为 `[]`。
- **位置：** `apps/engine/lib/engine/gates/diff.ex:44`（`base_mais_nova`），
  `apps/engine/lib/engine/gates/hooks/termination.ex:46`（`lista`）
- **测试：** `apps/engine/test/engine/gates/diff_test.exs`（任务 B 从 A 产生，A 已在来源处合并：diff 只有 B）和
  `apps/engine/test/engine/gates/hooks/termination_test.exs`（JSON 字符串变为列表；列表不变；无效字符串变为 `[]`）
- **来源：** AT-464 第 1 和第 3 项（10月9日的 TP-01，会话 `80e3ce09`：一个针对 `dev` 只有 3 个文件的 PR 显示「17
  arquivo(s) alterado(s) nesta PR」，最近几份意见中 `coverageMatrix`/`itens` 被写成 `"[]"`）

### RN-790 — 说明如何启动交付物的 README 是 PO 编写的 DoD 标准 {#rn-790}

- **规则：** PO 的 kickoff 指令要求在创建应用入口（服务器、CLI、配置或持久化）的故事的 DoD 中——或在一个专门的故事中——加入标准「README diz como instalar, configurar
  (variáveis de ambiente obrigatórias e opcionais, com o padrão) e subir a
  aplicação, e como criar o primeiro acesso, quando houver」。dev agent 满足故事的 DoD，gate 据此评判。「提示词」标准，与 [RN-765](#rn-765) 相同：没有任何工具会拒绝缺少此标准的故事。另一种方案——dev agent 在每个涉及配置/入口的任务中更新 README——「没有」做：那需要在 `AmbienteDoAgente` 或 `report_done` 中对任务分类，是新的代码规则——已声明。
- **位置：** `apps/engine/lib/engine/agents/po_server.ex:560`（`kickoff_instruction`）
- **测试：** `apps/engine/test/engine/agents/po_server_test.exs:438`（kickoff 指令带有 README 标准）
- **来源：** AT-466（10月9日的 TP-01：`encurtador-api` 交付的 README 只有 `npm test`，没有必需的 `JWT_SECRET`、`DB_PATH`/`PORT`、`npm start`，也没有如何创建第一个成员）

### RN-792 — 声明契约时，Arquiteto 会收到故事中有而契约未声明的路由 {#rn-792}

- **规则：** 在 `declare_module_contracts` 写入版本（[RN-684](api.md#rn-684)）之后，该工具读取项目的 backlog，以确定性方式、不用 LLM，从未归档故事的标题、描述、RF 和 DoD 中提取每个 `MÉTODO /caminho`（GET、POST、PUT、PATCH、DELETE），并从契约的 `assinatura` 中提取同样的模式。被故事引用却不在契约路由「并集」中的路由（前端的故事引用后端的路由）作为「分歧」在结果中返回，附上契约在同一方法下声明的内容——循环的输入（[RN-163](#rn-163)），让 Arquiteto 修正契约或记录决定。参数（`:id`、`{id}`）、末尾斜杠和查询字符串被规范化；上限 10 行，附总数。读取 backlog 失败「不」拒绝声明（已写入）：结果说明没有核对。已声明排除在外：只有契约声明的路由（不是分歧）、声明「之后」编辑的故事（只在下一次核对），以及契约跟随 dev 改名的路由（QA 在意见中点明分歧，[RN-786](api.md#rn-786)，但没有任何东西把它带回 Arquiteto）。
- **位置：** `apps/engine/lib/engine/harness/rotas_do_contrato.ex:37`
  （`divergencias`），`apps/engine/lib/engine/harness/tools/declare_module_contracts.ex:119`
  （`conferencia_com_historias`）
- **测试：** `apps/engine/test/engine/harness/tools/declare_module_contracts_test.exs`
  （故事中的 `GET /painel` × 契约中的 `GET /panel` 会被指出；参数和斜杠规范化后相同的路由不被指出；backlog 不可读时说明没有核对）
- **来源：** AT-468（10月9日的 TP-01：故事要求 `GET /painel`，契约声明了 `GET /panel`，在架构阶段没有人指出）

### RN-796 — gitleaks 的条目说明规则以及掩码后的密钥片段 {#rn-796}

- **规则：** `gitleaks` 放入 SecOps 意见的条目，除了路径和行号之外，还带有触发的规则（`RuleID`）以及被指出的片段（`Match`），其中的密钥（`Secret`）被替换为 `***`——绝不是明文密钥。没有可供掩码的 `Secret` 时，片段不加入。并且执行型 agent 的环境（[RN-706](#rn-706)）用一行说明测试用的密码、token 或密钥在运行时生成，绝不是字面量。没有新的 allowlist。
- **位置：** `apps/engine/lib/engine/actions/gitleaks_detector.ex:121`
  （`mensagem`），`apps/engine/lib/engine/harness/ambiente_do_agente.ex:102`
  （`montar`）
- **测试：** `apps/engine/test/engine/actions/gitleaks_relatorio_test.exs`，
  `apps/engine/test/engine/harness/ambiente_do_agente_test.exs`
- **来源：** AT-470

### RN-797 — 分支与 `dev` 没有 diff 的 task 以「已在 dev 中」关闭 {#rn-797}

- **规则：** 在 `report_done` 中，在提议 commit、push 和 PR 之前，dev agent 询问 worktree 的分支是否带有 `dev` 没有的东西：工作树干净且 `git diff --quiet <ponta da dev>...HEAD` 没有差异。这是被重新整合的 task（[RN-779](#rn-779)）的情形，其代码已经通过另一个 PR 进入。没有 diff 时，task 以 `done` 关闭，带事件 `dev.task_already_in_dev`（agent、task、分支、原因）——没有 commit、没有 PR、没有 gates，也不需要点击。任何疑问（engine 到达不了的文件夹，如 `runner` 模式；git 失败；`dev` 的 ref 缺失）都视为「有 diff」：task 走向 gates，绝不自行关闭。测量的是 DIFF 而不是祖先关系，因此也覆盖了 [RN-760](#rn-760) 声明看不到的 squash 合并。已声明：该分支的旧 PR（如果存在）不会在 provider 中被关闭。
- **位置：** `apps/engine/lib/engine/dev/worktree_manager.ex:246`
  （`sem_diff_contra_a_dev?`），`apps/engine/lib/engine/dev/dev_agent_server.ex:1048`
  （`ja_na_dev`）
- **测试：** `apps/engine/test/engine/dev/tarefa_ja_na_dev_test.exs`
- **来源：** AT-474

### RN-798 — QA 对照 scripts 检查交付所触及 README 中的命令 {#rn-798}

- **规则：** 当交付相对 `dev` 的 diff 触及 README 时，QA 不用 LLM 检查其中引用的每个 `npm run <s>`、`npm test`、`npm start`、`pnpm [run] <s>` 和 `yarn [run] <s>` 是否存在于 `scripts` 中，属于同一文件夹（否则是 worktree 根目录）的 `package.json`。检查作为又一份意见（「Conferência do README」）进入合并：分歧为 `changes_requested`，每个命令一条，点名缺少的 script；没有分歧时批准。diff 中没有 README、diff 失败或 `package.json` 无法到达时，不作任何断言。已声明排除在外：包管理器内置的子命令（`pnpm install`、`pnpm dlx`…）、在 script 之前带标志的命令（`pnpm --filter x test`）、项目自身 CLI 的标志以及非 Node 的命令。
- **位置：** `apps/engine/lib/engine/gates/conferencia_do_readme.ex:28`
  （`conferir`），`apps/engine/lib/engine/gates/qa_lead_server.ex:776`
  （`conferencia_do_readme`）
- **测试：** `apps/engine/test/engine/gates/conferencia_do_readme_test.exs`
- **来源：** AT-475

### RN-805 — 写入的测试计划就是工具所接受的那个 {#rn-805}

- **规则：** `emit_plano_de_teste` 校验「已经」规范化的参数（[RN-719](#rn-719)：JSON 字符串形式的 `criteriosExecutaveis` 变为列表），结束 QA 策略循环的 hook 通过「同一」规范化读取 `criteriosExecutaveis`（`Termination.lista/1`，即 [RN-787](#rn-787) 的那个）。此前工具说「plano registrado: 9 critérios」，hook 拿到的是原始字符串，产物被拒绝（`:criterios_vazios`），agent 仍返回 `{:ok, plano}`，Automação 在对字符串的 `Enum` 上出错——QA Lead 崩溃，gate 一直停着直到救援（真实使用中 18 分钟）。现在被拒绝的产物是 QA 策略的「命名」失败（`agent.error`，来源 `codigo`），审查在没有计划的情况下继续，就像计划失败时一样；Automação 也会规范化它收到的标准。
- **位置：** `apps/engine/lib/engine/gates/hooks/termination_plano_de_teste.ex:23`
  （`criterios_executaveis`），`apps/engine/lib/engine/gates/qa_estrategia_agent.ex:231`
  （`emit_returning`）
- **测试：** `apps/engine/test/engine/gates/qa_estrategia_agent_test.exs`
  （"critérios em string JSON viram lista: o plano é gravado e devolvido como lista"）
- **来源：** AT-478（10月10日的 TP-01）

### RN-806 — 每个任务一个 QA 周期：裁决之前的请求被丢弃 {#rn-806}

- **规则：** QA Lead 每个 task 运行「一个」周期。对其周期正挂起等待决定的 task 发出的 `{:run, task}` 请求被忽略，并且在一个周期结束时（裁决或阻塞），所有在进程信箱中等待的 `{:run, task}` 都被丢弃——它们是在裁决存在之前请求的，而 dev 的合法修正只在裁决之后产生。在真实使用中，救援（[RN-722](#rn-722)）在同一时刻触发了两次周期，第二次在批准之后运行，对已经合并的任务写下了相反的意见。已声明排除在外：engine 的两个副本（信箱是按进程的，与 `GateRescuer` 的保留意见相同）以及救援双重扫描的原因，此处没有修正。
- **位置：** `apps/engine/lib/engine/gates/qa_lead_server.ex:106`（`handle_cast`），
  `apps/engine/lib/engine/gates/qa_lead_server.ex:157`（`descartar_pedidos_obsoletos`）
- **测试：** `apps/engine/test/engine/gates/qa_lead_server_test.exs`（"pedido
  repetido que esperava na caixa é descartado ao fim do ciclo"；"pedido para a
  task com ciclo suspenso não abre um segundo"）
- **来源：** AT-478（10月10日的 TP-01）

### RN-810 — provider 短暂的网络故障会被重试，由此导致的阻塞是 `infra`，不计入断路器 {#rn-810}

- **规则：** 当对模型的调用返回 provider 的「网络」错误时——api 规范化的 `code` `connection`/`timeout`（ADR 0041），或者没有代码时传输层的文本（`EAI_AGAIN`、`ECONNRESET`、`ETIMEDOUT`、`ECONNREFUSED`、`ENOTFOUND`）——`ToolLoop` 最多重试两次，分别等待 1 秒和 3 秒，每次都写入 `toolloop.network_retry`。适用于 `ToolLoop` 的所有消费者（dev agents 和 gate 子 agent）。用尽上限后，结局的来源是 `infra`，绝不是 `codigo`，dev agent 的 task 因此被阻塞时「不」增加连续阻塞计数器（[RN-047](#rn-047)）：agent 继续领取。在真实使用中，一次持续 17 秒的 `getaddrinfo EAI_AGAIN openrouter.ai` 把两个任务以 `codigo` 阻塞，并使 dev 解除了武装。
- **位置：** `apps/engine/lib/engine/harness/tool_loop.ex:246`
  （`llm_turn_com_retentativa`），`apps/engine/lib/engine/agents/falha_de_turno.ex:112`
  （`falha_de_rede?`），`apps/engine/lib/engine/dev/dev_agent_server.ex:952`
  （`bloquear_parada`），`apps/engine/lib/engine/dev/agent_io.ex:228`
  （`finish_task`）
- **测试：** `apps/engine/test/engine/harness/tool_loop_test.exs`（"falha de
  rede do provider: retenta e segue quando a rede volta"；"falha de rede que
  persiste esgota o teto"），`apps/engine/test/engine/dev/dev_agent_server_test.exs`
  （"erro de rede do provider: origem infra e o disjuntor não conta"），
  `apps/engine/test/engine/agents/falha_de_turno_test.exs`
- **来源：** AT-484（10月10日的 TP-01）

### RN-811 — 「已在 dev 中」与更新后的远程 `dev` 比较 {#rn-811}

- **规则：** 在 `report_done` 中进行「已在 dev 中」检查（[RN-797](#rn-797)）之前，dev agent 更新远程的 `dev`，通过与 [RN-779](#rn-779) 在领取时所做的「同一个」`fetch`，按项目串行化。没有它时，比较使用的是 worktree 产生那天的 `dev`：其 commit 已经通过另一个 task 的 PR 进入远程 `dev` 的 task 分支，以 0 个文件通过了 QA 和 SecOps。失败的 `fetch` 不决定任何事——与现有的比较，有疑问时 task 走向 gates。
- **位置：** `apps/engine/lib/engine/dev/worktree_manager.ex:267`
  （`sem_diff_contra_a_dev?`），`apps/engine/lib/engine/dev/worktree_manager.ex:277`
  （`sem_diff_atualizado?`），`apps/engine/lib/engine/dev/dev_agent_server.ex:892`
  （`handle_outcome`）
- **测试：** `apps/engine/test/engine/dev/tarefa_ja_na_dev_test.exs`（"caminho
  feliz: com a dev atualizada, a branch não tem diff"；"falha: remoto
  inalcançável não fecha a task sozinha"）
- **来源：** AT-486（10月10日的 TP-01）

### RN-813 — 涉及入口点的任务要求证明它能启动 {#rn-813}

- **规则：** [RN-765](#rn-765) 截取的扩展。当任务的标题或描述涉及入口点、连接（路由、迁移、注册）或运行用的 README 时，QA gate 的截取增加「Ponto de entrada」一节：要求证明「真实」的入口能启动（运行项目的 `start`/`main`，或一个导入真实入口的测试，而不是在测试中自行组装的应用），并在某条路由或命令上响应。没有这种证据时，缺口进入 `itens`。这是「提示词」标准：gates 的外部契约（`docs/gates.yml`）和 `emit_qa_verdict` 的代码不变，没有新的 gate 产生。不涉及这些的任务不加这一节。
- **位置：** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:121`
  （`secao_do_ponto_de_entrada`）
- **测试：** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  （"tarefa que toca a fiação exige evidência do ponto de entrada real" 和 "tarefa
  que não toca entrypoint nem fiação não ganha a seção"）
- **来源：** AT-483（10月10日的 TP-01：`server.ts` 从未调用 `links` 表的迁移，`/:code` 遮蔽了 `GET /links`；53 个测试都通过，因为每个都组装了自己的数据库和应用）

### RN-814 — QA 的意见在一轮中列出所有缺口 {#rn-814}

- **规则：** [RN-765](#rn-765) 截取的扩展：QA gate 在 `itens` 中一次列出它在本轮发现的该任务的「所有」缺口，绝不是每轮一个——每一轮都是一次付费修正，也是周期上限中的一步。之前的提示词只要求列出「quais regras faltam」，不是未覆盖规则的缺口被留到下一轮。提示词标准。
- **位置：** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:20`（`texto`）
- **测试：** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`（"o
  recorte pede todas as lacunas numa volta só"）
- **来源：** AT-487（10月10日的 TP-01，任务 `c7ced5a2`：两次否决，针对原始交付中早已存在的两个缺口）

### RN-817 — QA 在干净状态下运行测试套件，跳过的测试不算绿 {#rn-817}

- **规则：** [RN-765](#rn-765) 截取的扩展，适用于所有任务。在运行套件之前，QA gate 结束项目「自己」留下的运行中进程（`start` 的服务器在项目端口上监听），只限该文件夹的进程，绝不触及外部。启动进程的测试应结束整个「进程组」（或直接启动 `node`，而不是通过 `npm`）；不结束的会在干净克隆中卡住套件，是 `itens` 中的缺口。因环境（端口被占用、工具缺失）而「跳过」的测试不算绿：作为观察进入 `resumo`。这是截取中的指令，不是 harness 的步骤：运行套件的是 QA 自己，通过 `terminal`，它已经经过策略以及三种模式的容器路由——harness 中的 `pkill` 需要按模式的第二条执行路径。提示词标准；gates 的契约不变。
- **位置：** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:178`
  （`secao_do_ambiente_limpo`）
- **测试：** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  （"RN-817: pede ambiente limpo, encerrar o grupo e pulado como observação"）
- **来源：** AT-496（10月10日的 TP-01：`npm test` 在干净克隆中卡住——测试杀死了 `npm`，孙进程 `node` 留在 3000 端口——而在容器中 QA 看到 exit 0，因为测试在端口被一个孤儿服务器占用时跳过了）

### RN-818 — 入口点的证据是 dev 的环境能产生的那种 {#rn-818}

- **规则：** [RN-813](#rn-813) 的扩展。「Ponto de entrada」一节说明在 dev 的环境中什么「算作」证据——在项目文件夹中启动入口进程、在项目容器中运行脚本、请求运行中进程的某条路由——以及什么在那里「不」可行：构建 Docker 镜像、`docker compose`、外部网络。第二类要求绝不进入 `itens`；它作为观察进入 `resumo`。提示词标准。
- **位置：** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:121`
  （`secao_do_ponto_de_entrada`）
- **测试：** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  （"RN-818: com ponto de entrada diz o que conta e o que não cabe" 和 "RN-818:
  sem ponto de entrada não traz a régua de evidência"）
- **来源：** AT-492（10月10日的 TP-01，task `c708f8b2`：第 4 轮要求从 Dockerfile 构建镜像，项目容器没有 Docker，周期以 `politica` 阻塞耗尽）

### RN-819 — QA 在发出意见之前逐条规则扫描 {#rn-819}

- **规则：** [RN-814](#rn-814) 的扩展。除了列出所有缺口，截取还要求在发出之前进行「逐条规则扫描」：一条一条地过任务的每条业务规则和每个标准，指出证据在哪里或说明缺失，只有全部过完才发出。单独的「Liste todas」没能防止既有缺口在下一轮出现。提示词标准。
- **位置：** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:20`（`texto`）
- **测试：** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  （"RN-819: pede varredura por regra antes de emitir"）
- **来源：** AT-490（10月10日的 TP-01：任务 2 和 11 在第 2 轮带出了交付中早已存在的缺口）

### RN-823 — engine 重启杀死的 gate 周期在启动时被恢复，消息流会说明 {#rn-823}

- **规则：** 在 engine「启动」时，「最近」的 `in_progress` 行（`gate_states` 中）（低于 `gate_rescue_stale_after_seconds`，15 分钟，因而 tick 看不到），如果在「本」节点和集群的「其他」节点上都没有活着的进程，就是重启造成的孤儿，而不是慢周期：启动会立即恢复它（`Dispatcher.run_qa`/`run_secops`），不等阈值。「活着」是 [RN-722](#rn-722) 的标准（task 正在 lead 中进行），也通过 `:erpc.multicall` 询问其他节点——不回应的节点算作「活着」，即 `TurnoOrfao` 的标准（[RN-586](#rn-586)）。常规的守护仍然有效：有 gate 角色的待处理操作时不重启，所属 dev 缺失时只删除该行。在重新派发之前，启动在会话日志中写入 `gate.interrupted`（`taskId`、`gate`、`ultimaAtividadeEm`、`retomadoEm`），消息流以提示的形式显示它，两种语言。周期性的 tick「不」变：启动之外，最近的行就是进行中的周期。声明的残余：启动那一刻尚未加入集群的节点不会被询问，最坏的结局仍是常规的（重复且廉价的工作；第二个裁决会被 api 拒绝）。
- **位置：** `apps/engine/lib/engine/gates/gate_rescuer.ex:191`（`run_boot`），
  `:209`（`interrompido_no_boot`），
  `apps/web/src/routes/RetomarGateEstacionado.tsx:33`（`cicloInterrompido`）
- **测试：** `apps/engine/test/engine/gates/gate_rescuer_test.exs`（"boot com
  ciclo RECENTE órfão do reinício: grava gate.interrupted e retoma já
  (RN-823)"；失败："boot com ciclo recente esperando ação PENDENTE do gate:
  não reinicia nem grava (RN-823)" 以及本地活着的进程不受影响），
  `apps/web/src/routes/RetomarGateEstacionado.test.tsx`（"cicloInterrompido
  (RN-823)"）
- **来源：** AT-495（10月10日的 TP-01：18:51 的重启杀死了任务 10 的 QA 周期，dev 停在 `awaiting_gate` 15 分钟，没有任何界面说明）

### RN-832 — dev agent 知道 `report_done` 会做 commit、push 和 PR，新测试要加入 `test` 脚本 {#rn-832}

- **规则：** dev agent 没有也不需要 `git_commit`、`git_push` 或 `pr_open`：commit、push 和 PR 在它调用 `report_done` 时发生。`report_done` 的描述、`report_blocked` 的描述（「falta ferramenta de git」不是阻塞的理由）、dev agent 的 kickoff 以及环境消息（[RN-706](#rn-706)）都说明这一点——此前环境消息要求使用类型化的 git 操作，而 dev 并没有它们。kickoff 和环境还说明，如果 `test` 脚本（`package.json` 的）逐个列出文件，每个新的测试文件都要加入其中。只有文本：没有新的代码规则，Jev 对 dev agents 仍没有下限（[RN-758](api.md#rn-758)）——直到 [RN-839](api.md#rn-839) 把 `report_done`/`report_blocked` 放入它们的下限。
- **位置：** `apps/engine/lib/engine/dev/tools/report_done.ex:16`（`spec`），
  `apps/engine/lib/engine/dev/tools/report_blocked.ex:12`（`spec`），
  `apps/engine/lib/engine/dev/dev_agent_server.ex:604`（`initial_message`），
  `apps/engine/lib/engine/harness/ambiente_do_agente.ex:102`（`montar`）
- **测试：** `apps/engine/test/engine/dev/report_done_instrucao_test.exs`
  （"caminho feliz: report_done, kickoff e ambiente carregam as duas
  instruções"；失败："o ambiente não manda mais usar as ações tipadas de git"）
- **来源：** AT-499（TP-01，第 11 次：任务在套件全绿的情况下因「git_commit não existe」被阻塞；因测试不在 `test` 脚本中，QA 进行了四轮）

### RN-845 — 对提议 ADR 的读取说明 PR 是否已合并 {#rn-845}

- **规则：** 在 `executed` 的 ADR 那一行中，`listar_adrs_propostas`（[RN-772](#rn-772)）不再按「操作」状态断言「PR aberta」：它把结果中的 `pullRequestId` 与同一项目中「已执行」的 `git_merge`（所有合并都经过的操作，[RN-418](api.md#rn-418)）交叉比对，并说明「PR MERGEADA em
  <data da decisão>」或「PR aberta (nenhum merge dela registrado no Brabo)」。没有 PR id 的结果，或合并查询失败，变为「estado da PR:
  NÃO CONSEGUI LER」——绝不是「aberta」。受控（ADR 0060）：多一次查询，只针对列出的 id，在同一个 Postgres 中。声明的限制：在 Brabo「之外」（远程 provider 上）未合并就关闭的 PR 看不到，仍被读作打开——询问 provider 将是 agent 循环中的 HTTP。
- **位置：** `apps/engine/lib/engine/harness/tools/listar_adrs_propostas.ex:88`
  （`cruzar_com_merges`），`:102`（`merges_por_pr`），`:155`（`estado_da_pr`）。
- **测试：** `apps/engine/test/engine/harness/tools/listar_adrs_propostas_test.exs`
  （"PR mergeada aparece como mergeada…"，"estado da PR ilegível diz que não
  leu, nunca aberta"）。
- **来源：** AT-514（TP-01，10月11日：合并 30 秒后 Arquiteto 说「aberta como PR」）。

### RN-846 — HTTP 路由进入 README，输入错误属于项目自己 {#rn-846}

- **规则：** [RN-819](#rn-819) 的扩展。执行型 dev agent 的 kickoff 要求新建或修改的 HTTP 路由进入 README（方法、路径、请求体、响应和状态码），输入错误（格式错误的 JSON、无效字段）以项目格式的专属消息回应，绝不是库的原始消息。QA 的截取在逐条规则扫描中检查这两点，缺失的进入 `itens`。提示词标准。
- **位置：** `apps/engine/lib/engine/dev/dev_agent_server.ex:604`
  （`initial_message`）和 `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:20`
  （`texto`）
- **测试：** `apps/engine/test/engine/dev/report_done_instrucao_test.exs`
  （"RN-846: kickoff pede a rota no README e erro de entrada próprio"）和
  `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`（"RN-846: confere
  rota no README e erro de entrada próprio"）
- **来源：** AT-515（TP-01，第 12 次：README 没有记录 API，格式错误的 JSON 以 400 和解析器的「Expected property name…」回应）

### RN-849 — 架构就绪轮次以 ADR 的当前状态开场 {#rn-849}

- **规则：** [RN-845](#rn-845) 的扩展。当用户确认架构已就绪时，Arquiteto 的服务器通过与 `listar_adrs_propostas` 相同的代码「读取」ADR 的状态（本地 Postgres，没有 HTTP，相同的 20 行上限），并把它放入该轮的开场消息中，附上不要断言不同 ADR 状态的指令。读取失败时说明「NÃO CONSEGUI LER」，并要求说不知道——绝不是「pendente」。
- **位置：** `apps/engine/lib/engine/harness/tools/listar_adrs_propostas.ex:50`
  （`contexto_de_prontidao`），`apps/engine/lib/engine/agents/arquiteto_server.ex:225`
  （`contexto_de_prontidao`）。
- **测试：** `apps/engine/test/engine/harness/tools/listar_adrs_propostas_test.exs`
  （"contexto_de_prontidao/2 (RN-849)"）。
- **来源：** AT-519（TP-01：在就绪轮次中，Arquiteto 对已合并的 ADR 说「pendente
  de aprovação」，重复了上一轮的读取）。

### RN-850 — 路由进入「Rotas HTTP」一节，README 不带流程说明 {#rn-850}

- **规则：** [RN-846](#rn-846) 的扩展。dev agent 的 kickoff 要求路由进入 README 中「Rotas HTTP」一节「之内」（缺失时在「Testes」之前创建），绝不放在文件末尾，并且属于用户的 README 不加流程说明，也不加给 agent 的指令。QA 的截取检查这两点。提示词标准。
- **位置：** `apps/engine/lib/engine/dev/dev_agent_server.ex:604`
  （`initial_message`）和 `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:20`
  （`texto`）
- **测试：** `apps/engine/test/engine/dev/report_done_instrucao_test.exs`
  （"RN-850: a rota vai dentro de Rotas HTTP e o README não leva nota de
  processo"）和 `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  （"RN-850: confere a seção Rotas HTTP e a ausência de nota de processo"）
- **来源：** AT-520（TP-01：每个任务都在 README 末尾、「Testes」之后追加路由，还剩下一段给 agent 的流程说明）

### RN-851 — Infra 的 compose 在用户机器上启动「应用」，PR 声明如何运行它 {#rn-851}

- **规则：** Infra Lead 的 kickoff 要求「启动应用」的 compose（而不只是开发环境）：每个模块的 Dockerfile 的 `build`，`FROM` = 已决定的镜像（Infra 上下文中的 `projectImage`；没有时用路由的候选，在 README 中说明），端口 `${APP_PORT:-8080}:<porta interna>`，持久数据的卷，提交的 `.env.example`（绝不是 `.env`），以及 README 中的「Rodar na sua máquina」一节。agents 的「工作」容器仍通过 broker 启动，没有 deploy。`propose_infra_pr` 增加「必填」字段 `run`（`command` 最多 300 个字符；`urls` 1 到 5 个，`label` 最多 60，`kind` 取值于 `api_docs | web`，`url` 以 `http://localhost:` 或 `http://127.0.0.1:` 开头；`envExample` 布尔值），在 HALT「之前」由 engine 校验，命名的拒绝进入循环（RN-163），并转交到 `open_infra_pr` 的 payload 中。决定见 [ADR 0213](../adr/0213-o-entregavel-roda-na-maquina-pelo-compose-da-infra.md)。
- **位置：** `apps/engine/lib/engine/infra/instrucoes_de_execucao.ex:20`
  （`validar`），`apps/engine/lib/engine/infra/infra_lead_server.ex:1398`
  （`build_kickoff`）和 `:1256`（`abrir_pr`），以及
  `apps/engine/lib/engine/infra/tools/propose_infra_pr.ex:24`（`spec`）
- **测试：** `apps/engine/test/engine/infra/infra_lead_server_test.exs`
  （describe "o compose sobe o app e a PR leva `run` (RN-851)"）
- **来源：** AT-517（交付物没有办法由用户运行）

### RN-853 — 当任务涉及路由时，dev 暴露 OpenAPI 和 Swagger {#rn-853}

- **规则：** ADR 0213 的一部分。当任务涉及入口点或路由时（与 QA 截取「相同」的标准，`toca_ponto_de_entrada?`，绝不是副本），dev 的 kickoff 增加条款：暴露 HTTP 的模块提供 `/openapi.json`（OpenAPI 3）和 `/docs`（Swagger UI）；没有网络或没有包时，`/docs` 是从 CDN 加载 swagger-ui 的 HTML 页面；web 模块提供首页；URL 进入 README 的「Rodar na sua máquina」一节。不涉及路由的任务不承担这一条款（该消息是固定的，每次迭代都会重发）。
- **位置：** `apps/engine/lib/engine/dev/dev_agent_server.ex:636`
  （`clausula_de_openapi`），
  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:113`
  （`toca_ponto_de_entrada?`）
- **测试：** `apps/engine/test/engine/dev/report_done_instrucao_test.exs`
  （"RN-853: tarefa que toca rotas pede /openapi.json e /docs"；失败："RN-853
  falha: tarefa sem rota nem entrypoint não paga a cláusula"）
- **来源：** AT-517

### RN-854 — QA 在容器内证明 `/openapi.json` 和 `/docs` {#rn-854}

- **规则：** ADR 0213 的一部分。在截取的入口点一节（[RN-813](#rn-813)）中，QA 在容器「内」以后台方式通过 README 的命令启动应用，请求 `localhost:<porta interna>/openapi.json` 和 `/docs`（`curl`、`wget` 或 `node -e fetch`），然后结束进程组（[RN-817](#rn-817)）。失败进入 `itens`；真实的 `docker compose up` 留在 `resumo` 中，作为「provado só
  na máquina do usuário」。
- **位置：** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:121`
  （`secao_do_ponto_de_entrada`）
- **测试：** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  （"tarefa que toca rotas pede /openapi.json e /docs, compose em resumo"；
  失败："falha: tarefa sem rota não recebe a seção"）
- **来源：** AT-517

### RN-862 — engine 一侧的未决问题：工具、裁决以及上下文中的决定 {#rn-862}

- **规则：** Criativo、PO、Arquiteto 和 Dev Lead 用 `declare_open_question` 声明留给用户的每个疑问（`pergunta` 最多 500，`sugestao` 最多 300 可选，`afeta: {regras, historias, tarefas}`），它写入 `artifact.open_question`，带 `questionId`（uuid）、`autor` 和 `sessionId`；无效的 payload 是命名的拒绝，不写入。指令是「一」句核心句子，位于这四个 agent 的流程文本中（RN-711），绝不按服务器分别写。在 QA gate 中，「não confirmado pelo usuário」（或与当前决定相矛盾）的需求是 `needs_user_decision`，绝不是 `changes_requested`：`emit_qa_verdict` 只在带 `pergunta` 或 `openQuestionId` 时接受它，QA Lead 把它合并在 `approved` 之上，裁决连同问题发给 api，周期保持「停放」（ADR 0207，`gate.rescue_parked`，没有自动救援），直到 api 通过 RN-724 的路由请求恢复。dev-context 的 `decisoes` 以「Decisões do usuário —
  vencem RF/DoR quando conflitam」（`pergunta → decisao`）进入 dev 的 kickoff 和 QA 的截取；为空时什么也不写。写入的问题计入轮次收尾（RN-731），PO 根据回答修正故事时传入 `question_id`，在 `update_story`/`complete_story` 中（[ADR 0214](../adr/0214-pergunta-em-aberto-vira-pendencia.md)）。
- **位置：** `apps/engine/lib/engine/harness/tools/declare_open_question.ex:54`（`run`），
  `apps/engine/lib/engine/harness/fluxo_do_time.ex:113`（`frase_da_pergunta`），
  `apps/engine/lib/engine/gates/tools/emit_qa_verdict.ex:77`（`run`），
  `apps/engine/lib/engine/gates/qa_lead.ex:89`（`consolidar_decisao`），
  `apps/engine/lib/engine/gates/qa_lead_server.ex:569`（`estacionar_por_decisao`），
  `apps/engine/lib/engine/dev/context_builder.ex:121`（`secao_de_decisoes`）
- **测试：** `apps/engine/test/engine/harness/perguntas_em_aberto_test.exs`
  （"válida grava artifact.open_question…"；"inválida é recusa nomeada…"；
  "consolidação: needs_user_decision vence approved"；"o recorte diz a régua…"；
  "ContextBuilder: a história leva as decisões…"），
  `apps/engine/test/engine/gates/qa_lead_server_test.exs`（"grava a pergunta
  na api, estaciona o ciclo e só o gesto humano o retoma"）
- **来源：** AT-521，[ADR 0214](../adr/0214-pergunta-em-aberto-vira-pendencia.md)

### RN-863 — `api_docs` 总是 `/docs`，每条路由都进入 OpenAPI，QA 否决缺失的 {#rn-863}

- **规则：** HTTP 模块在 `run.urls` 中「总是」声明 `/docs`（Swagger UI，`kind: "api_docs"`），即使它尚不存在，web 模块声明首页——绝不是业务路由；Infra 的 kickoff 在 README 步骤中说明这一点（扩展 RN-851）。`run` 的校验以命名的方式拒绝 `api_docs`，若其 URL 不以 `/docs` 结尾，两侧使用「相同」标准（扩展 RN-852）。dev 的条款说明任务中新建或修改的「每条」HTTP 路由都进入 `/openapi.json`——带方法、请求体和响应的 path（扩展 RN-853）。在 QA 的截取中，README「Rotas HTTP」一节中的每条路由都必须出现在 `paths` 中（所提供的 `/openapi.json`）；缺失的路由是导致否决的条目，绝不是观察（扩展 RN-854）。
- **位置：** `apps/engine/lib/engine/infra/instrucoes_de_execucao.ex:52`（`url`），
  `apps/api/src/domain/infra/run-instructions.ts:44`（`recusaDoRun`），
  `apps/engine/lib/engine/infra/infra_lead_server.ex:1398`（`build_kickoff`），
  `apps/engine/lib/engine/dev/dev_agent_server.ex:636`（`clausula_de_openapi`），
  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:20`（`texto`）
- **测试：** `apps/engine/test/engine/infra/infra_lead_server_test.exs`
  （"run api_docs em rota de negócio é recusado com motivo, sem propor"），
  `apps/api/test/application/use-cases/execution/get-run-instructions.use-case.spec.ts`
  （"recusaDoRun (RN-852)"），
  `apps/engine/test/engine/dev/report_done_instrucao_test.exs`（"RN-853: …"），
  `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`（"RN-854: …"）
- **来源：** AT-524，[ADR 0213](../adr/0213-o-entregavel-roda-na-maquina-pelo-compose-da-infra.md)

### RN-864 — 短暂的网络故障最多 3 次自行恢复，dev 暂停 {#rn-864}

- **规则：** dev agent 因「短暂」的网络/provider 故障以来源 `infra` 阻塞的 task——明确的允许列表：DNS（`EAI_AGAIN`、`ENOTFOUND`、`getaddrinfo`）、`ECONNRESET`、`ETIMEDOUT`、`aborted`、provider 的 HTTP 5xx/429（代码 `rate_limit`/`upstream`、`connection`/`timeout`）——会自行「恢复」最多 3 次，分别在 1、3 和 10 分钟之后（负责人的决定），由一个 Oban job 调用与人工「相同」的解除阻塞（`UnblockTaskUseCase`，经由内部路由 `.../tasks/:taskId/unblock`，角色 `system`，如果 task 已不再被阻塞则为空操作）。阻塞原因说明安排了哪一次恢复；第 3 次恢复之后，下一次失败照旧保持阻塞，原因说明 3 次都已尝试。并且 agent「暂停」1 分钟，而不是领取下一个 task（暂停期间忽略唤醒）。额度耗尽（402，RN-726/730）和代码错误「不」在此列：立即阻塞。恢复计数器只在内存中：重启 engine 会清零。
- **位置：** `apps/engine/lib/engine/agents/falha_de_turno.ex:133`
  （`passageira?`），`apps/engine/lib/engine/dev/dev_agent_server.ex:982`
  （`bloquear_passageira`），`apps/engine/lib/engine/dev/agent_io.ex:293`
  （`pausar_por_rede`），`apps/engine/lib/engine/workers/retomada_de_tarefa_worker.ex:33`
  （`agendar`），`apps/api/src/application/use-cases/execution/unblock-task.use-case.ts:33`
  （`ator`）
- **测试：** `apps/engine/test/engine/dev/dev_agent_server_test.exs`（"falha
  passageira: agenda a retomada, pausa e não queima a fila"，"fim da pausa
  volta a reivindicar"；失败："falha passageira depois de 3 retomadas fica
  bloqueada pedindo o clique"，"402 não agenda retomada"），
  `apps/engine/test/engine/workers/retomada_de_tarefa_worker_test.exs`
- **来源：** AT-525

### RN-865 — 端点以及带路径的 HTTP 动词也会开启 OpenAPI 检查，检查覆盖代码中的路由 {#rn-865}

- **规则：** 「任务涉及入口点/路由」的唯一标准（`toca_ponto_de_entrada?`，由 QA 的截取和 RN-853 的 dev 条款使用）也匹配「endpoint」以及后跟路径的 HTTP 动词（`POST /links`）。没有这一点，描述为「Endpoint protegido…」的任务既得不到 OpenAPI 条款（dev），也得不到对 `/openapi.json` 的检查（QA）——在 TP-01 中，`POST /links` 和 `GET /panel` 就是这样在两个任务都获批的情况下没有进入 OpenAPI。QA 的检查改为要求 `paths` 中（所提供的 `/openapi.json`），除了 README「Rotas HTTP」一节的路由之外，还包含「代码」注册的每条路由；缺失的是导致否决的条目（扩展 RN-863）。
- **位置：** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:103`
  （`@ponto_de_entrada`），`apps/engine/lib/engine/gates/recorte_da_tarefa.ex:114`
  （`toca_ponto_de_entrada?`）
- **测试：** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  （"RN-865: tarefa que diz só endpoint ou verbo com caminho recebe a seção"；
  失败："falha: tarefa sem rota não recebe a seção"）
- **来源：** AT-527

### RN-868 — gate 救援的 tick 只有一条链 {#rn-868}

- **规则：** `GateRescueSchedulerWorker` 以与 `kickoff/0`「相同」的唯一性重新调度自己的后继（状态 `available`/`scheduled`/`retryable`，不含 `executing`，两个间隔的窗口）。此前只有 `kickoff/0` 是唯一的：执行中的 job 不计入，因此启动时的 kickoff 在前一个 tick 进行中时，或重新运行 `perform/1` 的重试，会开出「第二条」链，而它们从不合并。在真实使用中测得（10月14日）：同时调度了 11 个 job，RN-722 的「espera decisão humana」那一行对「一」行 `gate_states` 每个 tick 出现 11 次。这不是数据缺陷。重新调度带上唯一性后，重复的链在下一个 tick 合并为一条。
- **位置：** `apps/engine/lib/engine/workers/gate_rescue_scheduler_worker.ex:42`
  （`unicidade`）
- **测试：** `apps/engine/test/engine/workers/gate_rescue_scheduler_worker_test.exs`
  （"o tick se reagenda e mantém a corrente viva"；失败："com um sucessor já
  agendado, o tick não abre uma segunda corrente"）
- **来源：** AT-529

### RN-874 — PO 在轮次中收到用户的决定和项目的未决问题 {#rn-874}

- **规则：** PO 的每一轮都带有一条「临时」`system` 消息，由门面 `EngineApiClient` 紧接在团队流程（RN-711）之后追加——绝不在 `state.messages` 中，也不在服务器的提示词中——内容是用户的决定（`artifact.decision_record`，`choice` 和 `context`）以及项目中「仍然」未决的问题（`artifact.open_question`，没有 `open_question.answered` 带同一 `questionId`），来自「所有」会话。文本要求把已决定的「回答」写入故事、规则、DoR、DoD 和任务，绝不写「pergunta em aberto N」；仍未决的问题按 `questionId` 引用，不捏造回答。读取是「本地」的（直接 Postgres，循环中没有 HTTP），取这些类型最近的 200 个事件，上限为 10 个决定、10 个问题、每项 240 个字符、文本 3 000 个字符。没有决定也没有未决问题，或读取失败时，轮次在没有这条消息的情况下继续，绝不中断。只有 `po` 收到。
- **位置：** `apps/engine/lib/engine/harness/decisoes_do_projeto.ex:34`
  （`anexar`），`:49`（`texto`），
  `apps/engine/lib/engine/session_events/event.ex:224`
  （`list_types_for_project`），
  `apps/engine/lib/engine/sessions/engine_api_client.ex:707`
  （`DecisoesDoProjeto`）
- **测试：** `apps/engine/test/engine/harness/decisoes_do_projeto_test.exs`
  （"o turno do PO leva a decisão e só a pergunta AINDA aberta"，"custo de
  entrada tem teto"；失败："sem decisões nem perguntas não acrescenta nada"，
  "leitura que falha deixa o turno sem a mensagem, sem queda"）

### RN-876 — 被 api 拒绝的 `needs_user_decision` 回到 QA，只有接受才会停放 gate {#rn-876}

- **规则：** QA gate 只有在一种情况下才「停放」（`gate.rescue_parked`）：api 接受裁决 `needs_user_decision` 并给出 `nextAction: "await_user"`。如果 api「拒绝」（400、404 或 409 `pergunta_ja_respondida`），拒绝作为新消息回到 QA de Automação 的循环（RN-163：错误是循环的输入），恢复它发出时的「同一」上下文——在 409 时，附上已经作出的决定，让 QA 应用它而不是再次提问。其他委派不会重新运行。这次回送计入该循环自身的迭代上限；用尽时，任务以原因和来源 `modelo` 被阻塞（RN-059），绝不静默停放。此前 api 的返回被丢弃，gate 在消息流中没有问题的情况下停放（测得：`openQuestionId: "1"`，来自 `@IsUUID` 的 400）。工具 `emit_qa_verdict` 在循环「内部」、在 api 之前拒绝不是 uuid 的 `openQuestionId`。
- **位置：** `apps/engine/lib/engine/gates/qa_lead_server.ex:575`
  （`devolver_ao_qa`），`apps/engine/lib/engine/gates/qa_lead_server.ex:308`
  （`devolver_ao_qa`），`apps/engine/lib/engine/gates/qa_lead_server.ex:671`
  （`texto_da_recusa`），`apps/engine/lib/engine/gates/qa_automacao_agent.ex:77`
  （`devolver`），`apps/engine/lib/engine/gates/tools/emit_qa_verdict.ex:75`
  （`uuid`）
- **测试：** `apps/engine/test/engine/gates/qa_lead_server_test.exs`（"400:
  nada estaciona, o QA recebe o motivo e uma nova volta acontece"；"409 no
  laço: a volta seguinte do QA lê a decisão"；失败："teto esgotado depois da
  recusa: bloqueio narrado, nunca estacionamento"），
  `apps/engine/test/engine/harness/perguntas_em_aberto_test.exs`（"AT-526
  (RN-876): openQuestionId que não é uuid é recusa nomeada; uuid passa"）
- **来源：** AT-526

### RN-877 — QA 的截取要求在请求决定之前先核对已有决定 {#rn-877}

- **规则：** QA 截取的指令说明，在 `needs_user_decision` 之前，它要核对列出的决定；已被其中某个回答的需求不是问题，应用该决定即可。`openQuestionId` 只用于「未决」问题的 uuid；没有它时，新问题放在 `pergunta`/`sugestao` 中。这是阅读提醒：不改变裁决的标准。
- **位置：** `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:20`（`texto`）
- **测试：** `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  （"AT-526 (RN-877): manda conferir as decisões antes de needs_user_decision"；
  指令的失败由 RN-876 对工具的测试覆盖）
- **来源：** AT-526

### RN-878 — 执行型 agent 的语言从第一句话起生效 {#rn-878}

- **规则：** 在执行型 agent（`dev-*`、`qa-*`）「没有」人类作者的轮次中，RN-622 的语言指引说明它从「第一」句话起生效，包括每个工具之前的叙述，并去掉「salvo pedido do usuário」的保留（该轮没有用户）。在会话 `6c68fbc0` 中测得（pt-BR 项目，`anthropic/claude-haiku-5.5`）：指引到达了，但 `qa-automacao` 和 `dev-encurtador-api` 的第 0 次迭代仍以英语开头（「I'll start by running…」）。路径仍只有「一条」（门面，RN-622）：不放在服务器提示词、`agent_instructions` 或工具描述中（RN-667）。50 token 的上限（AT-169）仍然有效：用 `gpt-tokenizer` 测得，`pt-BR` 32/26，`en` 19/19，简短形式代码的通用文本最坏情况 30/30（cl100k/o200k）；不是简短形式的代码落到常规指引，它本来就放得下。有作者的轮次和对话型 agent 不变。没有解析出语言时，什么也不追加。效果在下一次 TP-01 中测量。
- **位置：** `apps/engine/lib/engine/harness/idioma_da_resposta.ex:164`
  （`orientacao_de_execucao`），`:154`（`agente_de_execucao?`）
- **测试：** `apps/engine/test/engine/harness/idioma_da_resposta_test.exs`
  （"agente de execução: vale desde a primeira frase, dentro do teto"；失败：
  "agente de execução sem idioma resolvido: nada é acrescentado"）
- **来源：** AT-530

### RN-879 — 交付物的绝对 URL 带端口，同一错误使用同一 `code` {#rn-879}

- **规则：** 当任务涉及入口点或路由时，dev 的条款要求交付物 API 返回的绝对 URL（例如短链接）来自 `PUBLIC_BASE_URL` 或请求的 `Host`，「带」端口——绝不是固定的 `http://localhost`，也不是没有端口的主机名——并且同一错误情形在所有路由中返回同一个 `code`。QA 的截取检查这两点，把分歧（例如 `not_found` × `link_not_found`）当作「条目」。负责人 10月14日的决定：通用规则。
- **位置：** `apps/engine/lib/engine/dev/dev_agent_server.ex:644`（`clausula_de_openapi`）；
  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:122`（`secao_do_ponto_de_entrada`）
- **测试：** `apps/engine/test/engine/dev/report_done_instrucao_test.exs`
  （"RN-879/880: tarefa que toca rotas leva URL com porta, code único e CORS" 以及
  失败 "RN-879/880 falha: tarefa sem rota não recebe CORS nem PUBLIC_BASE_URL"）；
  `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`（"RN-879/880: URL,
  code de erro e CORS"）
- **来源：** AT-531

### RN-880 — 交付物以可配置的 CORS 回应，`servers` 为相对路径，swagger-ui 固定版本 {#rn-880}

- **规则：** 在同一条款中，交付物的 API 以 `CORS_ORIGINS` 中的来源回应 CORS（默认 `http://localhost:<porta>` 和 `http://127.0.0.1:<porta>`），`OPTIONS` 返回 204，`Access-Control-Allow-*` 带 `Authorization` 和 `Content-Type`；`/openapi.json` 只声明相对的 `servers`（`/`）——绝对 URL 会在页面从另一个主机打开时造成 CORS 错误——CDN 的 swagger-ui 使用精确版本，绝不是 `@5`。QA 用另一来源的预检（`curl -X OPTIONS`）证明，在没有这些头、`servers` 为绝对 URL 或 CDN 浮动时否决。
- **位置：** `apps/engine/lib/engine/dev/dev_agent_server.ex:644`（`clausula_de_openapi`）；
  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:122`（`secao_do_ponto_de_entrada`）
- **测试：** 与 RN-879 相同（两个文件中的正常路径和失败）
- **来源：** AT-532

### RN-881 — engine 为 dev 和 QA 打印项目的其他决定 {#rn-881}

- **规则：** `decisoesDoProjeto`（api 在 `dev-context` 中返回；RN-872，ADR 0215，已带上限）在 dev 的 story 单元和 QA 的截取中变成「Outras decisões do projeto」一节，独立且排在任务的决定「之后」。为空或缺失时什么也不写；engine 不施加自己的上限。
- **位置：** `apps/engine/lib/engine/dev/context_builder.ex:133`（`secao_de_decisoes_do_projeto`）；
  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:20`（`texto`）
- **测试：** `apps/engine/test/engine/dev/context_builder_test.exs`（"RN-881:
  decisoesDoProjeto vira a seção..." 和 "RN-881 falha: sem decisoesDoProjeto a
  seção some"）；`apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  （"RN-881: outras decisões do projeto"）
- **来源：** AT-526（F4 切片，engine 一侧）

### RN-885 — 交付物的 CORS 使用「发布」的端口，QA 在两个来源上核对该头 {#rn-885}

- **规则：** 修订 RN-880（其余部分仍然有效）。交付物 `CORS_ORIGINS` 的默认值使用「发布」的端口——`APP_PORT`，由 compose 传给应用——绝不是内部的 `PORT`：在 TP-01（第 16 次）中，默认值以 `PORT=3000` 输出，而 compose 发布的是 8080，没有任何真实来源收到 `Access-Control-Allow-Origin`（用 curl 测得：`:3000` 收到，`:8080` 没有；在 Chrome 中，`Failed to fetch`）。QA 针对「发布」的端口做预检，一次针对 `http://localhost:<APP_PORT>`，另一次针对 `http://127.0.0.1:<APP_PORT>`，没有 `Access-Control-Allow-Origin` 头时否决——单单 204 不够，只在内部端口上的 CORS 是「条目」。
- **位置：** `apps/engine/lib/engine/dev/dev_agent_server.ex:644`（`clausula_de_openapi`）；
  `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:122`（`secao_do_ponto_de_entrada`）
- **测试：** `apps/engine/test/engine/dev/report_done_instrucao_test.exs`
  （"RN-885: o padrão do CORS usa a porta PUBLICADA, nunca a interna"；失败：
  "RN-879/880 falha: tarefa sem rota não recebe CORS nem PUBLIC_BASE_URL"）；
  `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`（"RN-885: o
  preflight é na porta PUBLICADA, nas duas origens, e confere o header"）
- **来源：** AT-535

### RN-890 — QA 要求命令行命令的退出码，拒绝时也一样 {#rn-890}

- **规则：** QA de Automação 的指令要求，在证明交付中某个命令行命令（CLI、`package.json` 的脚本）的测试中，核对正常路径的退出码为 0，命令拒绝输入时不为 0；拒绝时没有这项核对的测试就是没有覆盖的规则，进入 `itens`。QA 策略的指令要求在 `criteriosExecutaveis` 中为每个会拒绝输入的命令写出这两个标准。这是 agent 指令：没有新的 gate，裁决或结构都不改变。
- **位置：** `apps/engine/lib/engine/gates/qa_automacao_agent.ex:142`
  （`instrucao_de_codigo_de_saida`），
  `apps/engine/lib/engine/gates/qa_estrategia_agent.ex:129`
  （`instrucao_de_codigo_de_saida`）
- **测试：** `apps/engine/test/engine/gates/qa_automacao_agent_test.exs`（"a
  instrução cobra código de saída 0 no feliz e diferente de 0 na recusa"）；
  `apps/engine/test/engine/gates/qa_estrategia_agent_test.exs`（"os arquivos
  da entrega entram na mensagem"）
- **来源：** AT-542（TP-01，第 17 次：`npm run user:create` 拒绝了密码，却以 0 退出）

### RN-893 — PO 在 RF 和 DoD 中声明所提供值的边界 {#rn-893}

- **规则：** PO 的 kickoff 指令（无论有无事件日志）带有第三项义务：每个接收用户所提供值（日期、数字、文本、列表、限制）的 RF，都要在 RF 和 DoD 中声明边界——过去/未来、零、空、负数、限制本身——是被接受还是被拒绝（附 HTTP 状态/错误）；示例是过去的过期时间。不确定时，PO 调用 `declare_open_question`，带上 `afeta.historias` 和一条建议，绝不编造或省略。这是一条提示词规则，仿照 [RN-790](#rn-790)：没有工具会拒绝没有边界的故事。PO 不会开始重写 `business_rule`；创意、QA、schema 和 gate 均不变。
- **位置：** `apps/engine/lib/engine/agents/po_server.ex:649` (`obrigacoes`)
- **测试：** `apps/engine/test/engine/agents/po_server_test.exs:438`（kickoff 指令带有边界义务）和 `:460`（没有事件日志时，kickoff 仍带有它）
- **来源：** AT-541（10/14 的 TP-01：交付物接受了过去的 `expiresAt`，链接一创建就已过期，410；故事的 RF 只说过期时间是可选的），所有者 10/15 的决定

### RN-895 — 参数拒绝说明收到了什么以及期望的格式 {#rn-895}

- **规则：** 修订 [RN-719](#rn-719) 和 [RN-725](#rn-725)。声明为 `array`/`object` 的字段若以非 JSON 文本、数字、布尔或错误类型到达，会在工具运行前被拒绝，信息为"字段 X 以 <类型> 到达；请发送 <格式>"，并附示例（`["item 1","item 2"]`、`{"chave":"valor"}`），绝不回显取值。`emit_plano_de_teste` 的句子现在用反引号包住键名，因此拒绝会带上收到的键。
- **位置：** `apps/engine/lib/engine/harness/argumentos_de_ferramenta.ex:80`（`coagir`）；`apps/engine/lib/engine/gates/tools/emit_plano_de_teste.ex:73`（`run`）
- **测试：** `apps/engine/test/engine/harness/argumentos_de_ferramenta_test.exs:193` 与 `:201`（格式与收到的类型）以及 `:210`（收到的键）
- **来源：** AT-583（TP-01 第 18、19 次：`dod` 以 markdown 清单到达，测试计划被拒 4 次却未说明收到了什么）

### RN-896 — `epic_id` 在到达 api 之前被校验 {#rn-896}

- **规则：** `create_story` 拒绝不是 UUID 的 `epic_id`（"epic_id inválido; …"）。当 PO 已在本进程中创建史诗（`epicos_conhecidos`）且该 id 不在其中时，只重读一次 backlog（`list_backlog`）：id 在其中则接受；否则拒绝并列出 backlog 的 `id=标题`（最多 20 行，截断时说明总数，ADR 0060）。空映射或 backlog 读取失败表示“未知”，不拒绝——由 api 决定。
- **位置：** `apps/engine/lib/engine/harness/tools/create_story.ex:57`（`epico_valido`）
- **测试：** `apps/engine/test/engine/harness/argumentos_de_ferramenta_test.exs:224` 与 `:233`
- **来源：** AT-584（qwen 发送了 `EPIC_ID_PLACEHOLDER_NAO_USAR_AQUI`，api 以 DTO 名称回应）

### RN-897 — 门中因 `max_tokens` 造成的提供方截断，来源为 `modelo` {#rn-897}

- **规则：** 门 `qa-estrategia`、`qa-automacao`、`qa-performance-seguranca` 和 `appsec` 的 `agent.error` 将"Tool calls cutoff by max_tokens"归类为 `modelo`（推理耗尽了上限，RN-059）；其他 LLM 错误仍为 `infra`。
- **位置：** `apps/engine/lib/engine/gates/origem_do_erro.ex:10`（`de_llm`）
- **测试：** `apps/engine/test/engine/gates/origem_do_erro_test.exs:7`
- **来源：** AT-586（BaseTen 502 被记为 `infra`）

### RN-898 — A response cut by the cap with no text closes the turn, stated {#rn-898}

- **Rule:** a conversational agent turn whose last LLM response was cut by the output cap ([RN-737](api.md#rn-737)) and wrote no text in any round does NOT close silently: the line "Response cut off by the length limit." becomes the closing `agent.response` with `modelName`, and the bubble shows "Continue where it left off" ([RN-749](web.md#rn-749)). It covers the seven conversational agents.
- **Where:** `apps/engine/lib/engine/agents/texto_do_turno.ex:65` (`payload_do_turno`)
- **Test:** `apps/engine/test/engine/harness/resposta_cortada_test.exs:104`
- **Origin:** AT-570 (TP-01 18th)

### RN-899 — An empty response without a cut becomes an agent.error of origin model {#rn-899}

- **Rule:** a conversational loop closing with no text, no tool and no cut records `agent.error` with origin `modelo` and "the model returned no response" (`FalhaDeTurno`), in the seven servers. It is an agent utterance for the heartbeat ([RN-581](api.md#rn-581)); per-tab project presence does NOT enter ([RN-064](web.md#rn-064)).
- **Where:** `apps/engine/lib/engine/agents/falha_de_turno.ex:63` (`origem`), `apps/engine/lib/engine/agents/po_server.ex:303` (`gravar_texto_do_turno`)
- **Test:** `apps/engine/test/engine/agents/po_server_test.exs:194` and `apps/engine/test/engine/agents/texto_do_turno_test.exs:96`
- **Origin:** AT-572 (TP-01 18th, finding 4)

### RN-900 — `write_file` 拒绝重写 README 而丢失 Infra 的使用章节 {#rn-900}

- **规则：** `write_file` 整体替换文件。当 `path` 是 README（`README*`），当前文件有 `## Rodar na sua máquina` 章节而新内容没有时，该工具以具名错误拒绝，且不写入任何内容。要修改某一段，必须整体重写 README 并保留该章节。标题只有一个常量（`titulo_secao_de_uso/0`），Infra 和 dev 的提示词也使用它，使拒绝与指令不至于分歧。这不是 gate：拒绝属于工具本身，且不覆盖通过 `terminal`（`cat >`、`sed -i`）的写入。
- **位置：** `apps/engine/lib/engine/harness/tools/write_file.ex:62`（`recusa_de_secao_perdida`）
- **测试：** `apps/engine/test/engine/harness/tools/write_file_test.exs:41`（不带该章节的重写被拒绝且文件保持不变）；正常路径由同一文件的前两个测试覆盖
- **来源：** AT-571（10/19 的 TP-01 第 18 轮：dev 代理在修正 QA 意见时重写了 README，Infra 写的使用章节丢失；没有任何 gate 发现）

### RN-903 — 提供方的 429 是模型的使用限额，而非网络故障 {#rn-903}

- **规则：** dev agent 因模型返回 429（代码 `rate_limit`，或文本含 `(429)` / "limite de uso"）而阻塞的任务，其原因写作"limite de uso do modelo atingido (429)"，自动重试会说明若再次出现，应更换 dev agent 的模型。绝不写"falha passageira de rede"（短暂网络故障）。来源仍为 `infra`，RN-864 的重试不变（最多 3 次，分别在 1、3、10 分钟后；暂停 60 秒，`dev.idle` 将其称为"depois de limite de uso do modelo"）。网络故障保留原有文本。
- **位置：** `apps/engine/lib/engine/dev/dev_agent_server.ex:1136`（`limite_de_uso?`），`apps/engine/lib/engine/dev/dev_agent_server.ex:1127`（`motivo_da_parada`），`apps/engine/lib/engine/dev/dev_agent_server.ex:997`（`bloquear_passageira`），`apps/engine/lib/engine/dev/agent_io.ex:293`（`pausar_por_rede`）
- **测试：** `apps/engine/test/engine/dev/dev_agent_server_test.exs`（"429 do provider: o motivo diz limite de uso do modelo, não rede"；失败情形："falha de rede continua com o texto de rede, não de limite"）
- **来源：** AT-594（TP-01 第 20 次，10/19：`laguna-s-2.1:free` 的 429 将任务阻塞为"falha passageira de rede"，而诊断却写的是使用限额）

### RN-904 — 输出上限截断的响应不以完整目录重试 {#rn-904}

- **规则：** 当 Jev 限制菜单且模型未调用工具作答时，按 RN-625 以完整目录重试一次——但响应被输出上限截断（`truncated`）时除外。截断不是菜单错误：以完整目录重试只会加大提示并再次消耗输出上限。两个入口（`llm_turn` 与 `llm_turn_stream`，后者仅限尚未交付文本时）均适用。处理截断的是 `ToolLoop` 中的 RN-780 重试，保持不变。
- **位置：** `apps/engine/lib/engine/harness/roteamento_de_ferramenta.ex:126`（`repetir_com_catalogo_inteiro?`）
- **测试：** `apps/engine/test/engine/harness/roteamento_de_ferramenta_test.exs:274`（被截断的空响应两条路径都不重试；无截断则重试）
- **来源：** AT-578（EP-026，10/21 调研）：PO 在第 18 轮的第一回合花费了两次 8192 输出 token。

### RN-905 — 步数上限会说明已记录什么、还缺什么，并提供继续 {#rn-905}

- **规则：** 对话式代理停在步数上限时，上限事件（`toolloop.limit_reached`；创意代理为带
  `reason: "limite_de_iteracoes"` 的 `agent.error`）携带 `gravado`，即在写入本轮文本之前读取的
  RN-731 那一行（它出现在这里，而不在 `agent.response` 里，绝不两处都有）。PO 还携带
  `regrasSemHistoria`，即 `fechar_handoff` 已在读取的 `uncoveredCount`；读取失败则该键缺失，不报错。
  时间线用不带行话的话说明原因，显示已记录的那一行、没有用户故事的规则，以及“从中断处继续”按钮
  （RN-749，用户消息，轮次进行时由 RN-673 的队列接收），仅对会话处于活动状态的七个对话式代理显示；
  `dev-*`/`qa-*` 只有文本，没有按钮。按钮绝不会自行继续。
- **位置：** `apps/engine/lib/engine/agents/po_server.ex:257`（`run_turn`）；
  `apps/web/src/routes/session-timeline-montagem.tsx:976`（`conversacional`）
- **测试：** `apps/engine/test/engine/agents/po_server_test.exs:548`；
  `apps/web/src/routes/session-timeline-montagem.falha-de-turno.test.tsx:108`
- **来源：** AT-590（EP-031）。

### RN-908 — PO 的 kickoff 在读取之后按层分批索要 backlog {#rn-908}

- **规则：** PO 的 kickoff 按以下顺序告诉模型：在同一个响应中读取 `listar_regras_de_negocio` 和 `listar_backlog`，且不与任何写入同时进行；然后在一个响应中提交全部史诗；然后用返回的 `epic_id` 提交全部用户故事；然后用返回的 `story_id` 提交全部任务。绝不重建已存在的史诗，每个响应最多约 10 次工具调用。实测依据：不要求分批时，nemotron 每个响应 1 个工具、qwen 为 3 个；要求后两者都是 9 个（`parallel_tool_calls` 没有任何影响）。先读取，是为了防止 qwen 在未读 backlog 时就创建史诗。不改变 `@max_iterations` 上限（RN-166）。
- **位置：** `apps/engine/lib/engine/agents/po_server.ex:614`（`build_kickoff`）
- **测试：** `apps/engine/test/engine/agents/po_server_test.exs:518`（先读后写；按层分批：史诗 → 用户故事 → 任务）
- **来源：** AT-591 的探测（21/10），在 AT-596（EP-026）中实现。
