---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0086 — Dev Lead 的计划挂起轮次以等待审批

- **状态：** 已接受
- **日期：** 2026-08-16
- **背景：** 审计 `docs/fluxo.yml` × 代码（发现 A2）
- **修订以下内容的一部分：** [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)
- **直接先例：** [ADR 0052](0052-dev-agent-espera-aprovacao-no-meio-do-laco.md)，
  [ADR 0057](0057-o-gate-espera-a-aprovacao.md)

## 背景 {#contexto}

一次只读的审计会话把 `docs/fluxo.yml`（ADR 0085 声明的目标模型）与真实代码进行了交叉比对（`docs/explanation/auditoria-fluxo-vs-codigo.md`）。发现 A2 找到了一处高严重度的分歧：`fluxo.yml` 把 `dev-lead` 的输出 `plano-de-paralelismo` 声明为 `via: proposed_action`，但代码只产生一个简单事件（`execution.plan_proposed`），没有任何审批流水线——这是一个有意的决定，当时就记录在 `dev_lead_tools.ex` 自身的注释里：

> O plano vira EVENTO no log, não `proposed_action`. A distinção não é
> cosmética: propor um plano não tem efeito externo nenhum — o gasto
> acontece quando os agentes sobem, e é lá que o teto da RN-083 cobra
> autorização. Transformar a proposta em ação a decidir faria o usuário
> decidir duas vezes a mesma coisa.

这一教训在 2026-08-07（[ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)，FASE 14d）并没有错：实际存在的 `parallelize` 类型 `proposed_action` 是由用户在 UI 中请求超出上限的增援这一**用户操作**触发的（`POST /sessions/:sessionId/execution/parallelize`），而不是由 Dev Lead 计划的初始输出触发的。这是两个真正不同的机制，而 `fluxo.yml` 把它们合并成了一个输出。

产品所有者面对这一分歧，认定是**代码**错了：Dev Lead 的计划是会话在并行度上要花多少钱的**第一个**真正决定——如今用户只是在会话流中读到它的叙述，然后单独点击"Ativar execução"，中间没有真正的审批。计划改为以 `proposed_action` 的形式诞生，用户看着它做决定，而不是看着一行日志。

### 为什么这在结构上是新的 {#por-que-isto-é-estruturalmente-novo}

四个对话式 agent（Criativo、PO、Arquiteto、Dev Lead）通过最长 180 秒的 `GenServer.call` 运行**同步**轮次，由 `Engine.Agents.TurnoAssincrono` 居间（RN-122）——`handle_call` 一直阻塞等待 Task 结束，调用方（engine 的 HTTP 路由）也一起等待。挂起等待审批的模式此前已出现过两次：

- dev agent（[ADR 0052](0052-dev-agent-espera-aprovacao-no-meio-do-laco.md)），由 `cast` 触发（`work/2`、`correct/3`）；
- QA/Infra 的 gate（[ADR 0057](0057-o-gate-espera-a-aprovacao.md)），同样由 `cast` 触发（`run/2`）。

两者都不需要处理一个悬而未决的同步 `from`——`cast` 根本没有需要回复的 `from`。Dev Lead **是** `call`：轮次挂起时，有人正在等待一个 HTTP 响应，而这个响应必须**立即**给出（以免把路由卡住长达 180 秒），即使轮次本身会悬而未决远比这更久。

## 决策 {#decisão}

**执行计划以 `proposed_action`（类型 `propose_execution_plan`）的形式诞生，Dev Lead 的轮次在它处于 `pending` 期间挂起——而不结束。**

### 各个部件 {#as-peças}

1. **`decide.ts` 增加类型 `propose_execution_plan`**（`apps/api/src/domain/actions/decide.ts`），最低角色 `maintainer`（与 `parallelize` 同一量级：决定产品在并行度上要花多少）。它被**有意**排除在绝对上限块（受保护的合并、`instruction_patch`、`parallelize`/`raise_max_parallel`）之外——可以配置为自动批准，就像 `open_adr_pr`/`open_infra_pr` 已经可以的那样。语义差别很重要：绝对上限之所以存在，是因为产品拒绝让用户把**自己的**决定自动化，即使开启了"始终允许"（`parallelize` 是对已授权上限的**突破**，`raise_max_parallel` 是产品提高自身的限制）。Dev Lead 的计划是会话的**第一个**决定，不是突破——这个功能中没有任何东西要求第四个绝对上限。
2. **`Engine.Agents.DevLeadTools.run/2` 调用 `EngineApiClient.propose_action/5`**，而不是 `append_event/3`（与 `Engine.Dev.AgentIo` 已在用的同一个客户端），并返回一个三种结局的契约：`{:ok, texto}` | `{:pending, action_id}` | `{:error, texto}`。`validar/1` 继续在任何 I/O **之前**拦下空计划或含有无 agent 模块的计划——没有改变。
3. **`Engine.Agents.DevLeadServer.run_turn/2` 在第一个 `:pending` 处停下。** 原来的 `Enum.reduce`/布尔值变成 `Enum.reduce_while`，它会**停止**，不再处理更多调用，也不递归。返回的 `state` 带有新键 `:aguardando_aprovacao`（`%{action_id:, tool_call_id:,
   tool_name:, remaining:}`）——`remaining` 已经扣除，因为被挂起的那次迭代在恢复时计入上限。此时 `role: "tool"` 消息**不**进入 `state.messages`：在那里写入"pending"等于对模型撒谎，说命令已经这样回答了（与 dev agent 的推理相同）。
4. **`Engine.Agents.TurnoAssincrono.tratar_resultado/2` 增加一个分支。** `GenServer.reply(from, :ok)` 仍然总是立即发生——正是它在正确的时刻打破同步阻塞，无论是否挂起。当存在 `:aguardando_aprovacao` 时（按**值**检查，`Map.get/2` 为真——而不是按键是否存在，因为 Dev Lead 从 `init/1` 起就带着值为 `nil` 的这个键），调用 `suspender/1` 而不是 `finalizar/1`：只有 `agent.status: awaiting_approval`，没有 `agent.done`——轮次没有结束。
5. **`Engine.Sessions.LiveBroadcast.agent_status/4` 在守卫中加入新状态**（`["working", "idle", "awaiting_approval"]`）——没有这一点，第 4 步的 `agent.status` 根本不会被持久化（ADR 0021：它是唯一**必须**持久化、而不仅仅广播的事件）。
6. **恢复。** `DevLeadServer` 在 `init/1` 中订阅 `Engine.Dev.Wake.subscribe(project_id,
   "dev-lead")`——与 `Engine.Gates.QaLeadServer` 已经为 QA 子 agent 复用的**同一个**模块，尽管名字是"dev"：`{:action_settled, ...}` 的投递是按 **agent** 进行的，由 payload 中的 `agentId` 路由（`DevAgentWakeWorker`），而不是按类型。消息到达时，一个 `handle_info` 用**真实**结果构造 `role: "tool"` 消息（`texto_do_desfecho/1`，与 dev agent 和 `QaLeadServer` 相同的措辞），清空 `aguardando_aprovacao`，并以 `TurnoAssincrono.iniciar(state, nil,
   fn -> run_turn(state, pendente.remaining) end)` 恢复。
7. **挂起期间的第二条 `user_message` 不会开始新的轮次。** 守卫子句 `handle_call({:user_message, _text}, _from,
   %{aguardando_aprovacao: %{}})` 在通用子句**之前**被匹配，发出 `agent.error`（来源 `politica`）并回复 `{:reply, :ok, state}`——这条路由的 HTTP 响应对所有 agent 本来就会被 engine 的 controller 丢弃。

### `propose_execution_plan` 没有自己的 execute-* 流水线 {#propose_execution_plan-não-tem-execute--pipeline-própria}

与 `parallelize`/`raise_max_parallel`（它们在批准时确实会**启动** agent）不同，批准计划没有需要施加的效果——启动 agent 仍然是一个**单独**的动作，在用户点击"Ativar execução"时发生。因此手动批准永远不会离开 `status: "approved"`（`action-state-machine.ts` 的状态机把 `approved -> executed | failed` 建模为开放的，但没有任何东西调用这个转换，也不应该——没有东西要执行）。engine 把 `"executed"`、`"auto_approved"` 和 `"approved"` 同样视为成功。

## 后果 {#consequências}

**有利**

- 行为开始与 `docs/fluxo.yml` 早已声明的一致——发现 A2 的分歧在不编辑流程的情况下关闭。
- 用户看着一个真正的审批（pt-BR 句子、动词、payload——RN-096）来决定计划，而不是看着会话流中一行他可能不会去读的文字。
- `TurnoAssincrono` 的挂起机制变得足够通用，**下一个**需要挂起的对话式 agent 无需重新发明任何东西——只需返回 `:aguardando_aprovacao` 键。

**不利**

- **接受并声明的缺口：等待期间重启。** 与 dev agent（它通过 `init/1` 中的 `handle_continue` 恢复 `laco_pendente`）不同，Dev Lead **不**恢复 `aguardando_aprovacao`——只在内存中。如果 engine 在它挂起时重启，决定仍然被记录并在审批中可见（在 api 中是持久的），但 Dev Lead 不会自动叙述结局：订阅 `Wake` 的进程已经死了，而下一次重启会拉起一个新的 Dev Lead，对那个操作没有订阅。关闭这一点需要与 ADR 0052 相同的持久化机制（`dev_lead_states` 或等价物）——超出本次改动的范围，本次只修正声明的流程与代码之间的错位。
- 当计划不是自动批准时，"Ativar execução"变得可用之前多了一个轮次的等待——与任何 `proposed_action` 已经施加的代价相同，现在这里也有了。

## 考虑过的替代方案 {#alternativas-consideradas}

**只修正 `docs/fluxo.yml` 以匹配代码（`via: evento`）。** 因产品所有者的明确决定被拒绝：分歧不是文档错误，而是代码还没有产品决定（让用户真正决定计划）早已要求的流水线。

**把该类型加入 `decide.ts` 的绝对上限块。** 被拒绝——见"各个部件"一节第 1 项。计划不是对上限的突破，也不是产品提高自身限制；它是**初始**决定，用户可以正当地想为它配置"始终允许"，而这不会变成三个绝对上限所要封住的那种漏洞。

**不挂起——保留简单事件，并并行打开第二个 `proposed_action`（发出即不管）。** 被拒绝：`fluxo.yml` 声明输出**本身**就是提议，而不是一个伴随着孤儿提议的事件。而让轮次不等待就继续，会重新引入 ADR 0052 为 dev agent 关闭的同一个失败——模型会在知道计划是否被接受之前就"学到"它被接受了。

## 参考 {#referências}

- `docs/explanation/auditoria-fluxo-vs-codigo.md` — 发现 A2，本次改动的起源
- [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) — 创建 Dev Lead 以及促成其存在的并行度上限（RN-083）
- [ADR 0052](0052-dev-agent-espera-aprovacao-no-meio-do-laco.md) — 先例：dev agent 在循环中途挂起，通过 `cast`
- [ADR 0057](0057-o-gate-espera-a-aprovacao.md) — 第二个先例：QA/Infra 的 gate 挂起，同样通过 `cast`
- [ADR 0021](0021-fechamento-4a-infra-e-painel.md) — 为什么 `agent.status` 需要被持久化，而不仅仅是广播
- `apps/engine/lib/engine/agents/dev_lead_tools.ex`、`dev_lead_server.ex`、`turno_assincrono.ex`
- `apps/engine/lib/engine/sessions/live_broadcast.ex`
- `apps/api/src/domain/actions/decide.ts`
