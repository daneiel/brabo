---
traducao_de: f8d6559d1abb11ac6c9a1b1d79833cbd56906238
---

# ADR 0163 — 点击在**接受**命令时响应，轮次经由通道继续

## 状态 {#status}

**Accepted.** 2026-09-18（AT-089）。把 [ADR 0086](0086-dev-lead-plano-suspende-para-aprovacao.md) 只为挂起的 Dev Lead 所做的打破同步阻塞推广开来。ADR 0086 不被编辑：它所决定的（**挂起**的轮次当场响应 `from`，并发出 `agent.status: awaiting_approval` 而不是 `agent.done`）继续有效——本文档只是把响应的时刻对**每个**轮次提前，由此它的情况不再是唯一的。规则：[RN-578](../business-rules.md#rn-578)。

## Context {#context}

在 v6.1.0 的一次真实安装中（9月14日），三次点击在它们触发的 agent 的**整个**轮次中都悬而未决：

| api 路由 | 请求耗时 |
|---|---|
| `POST …/agents/criativo/structured-question/:id/answer` | 97,3 s |
| `POST …/sessions/:id/readiness` | 97,3 s |
| `POST …/agents/arquiteto/handoff-infra` | 51,8 s |

同一会话的 event log 与这三者精确到十分之一秒吻合（从用户事件到 agent 被持久化的 `agent.status: idle`）：97,2 s、97,3 s 和 51,7 s。原因只有一个：每条与对话型 agent 通信的用户路由都会经过 `EngineWeb.AgentCommandController`，它执行一个同步的 `GenServer.call`（Criativo 为 120 s，其他为 180 s）——而自 RN-122 起，agent 的 `handle_call` 会把响应推迟到轮次的 Task 结束
（`TurnoAssincrono.iniciar/3` 保存 `from` 并在 `tratar_resultado/2` 中响应）。controller 早已返回 **202** 并早已丢弃返回值（*"esta resposta é só o aceite"*），`…/message` 的 OpenAPI 也早已写着 *"the response is just the acknowledgment"*。接受只在轮次结束时才到达。

三个后果，都经过测量：

1. **按钮“不响应”。** 对用户来说，一次耗时 97 s 的点击就是一次失败的点击。
2. **超过上限的轮次会让一个本已成功的命令变成错误。** `GenServer.call` 在 controller 进程中以 `:timeout` 退出，Phoenix 返回 500，api 变成 500，界面显示错误——而轮次仍在运行并成功结束。同一会话的 kickoff（它们是 `cast`，因此不受影响）持续了 7,5 分钟（PO）、6,6 分钟（Arquiteto）和 8,4 分钟（Infra）：超过 120 s 的轮次不是假设。
3. **静默拒绝。** 在已有轮次进行中到达的消息会收到 `{:error, :turno_em_andamento}`，controller 丢弃它并返回 202。在同一会话中，一个在 Arquiteto kickoff 进行到 2,5 分钟时输入的 *"Continue"* 被成功接受却**从未被读取**——之后没有任何 `agent.status:
   working`，没有任何 `agent.error`。更糟的是：界面在那次 kickoff 期间让 composer 保持可用（被接受的 handoff 会在没有 `streaming` 的情况下启动横幅），因此这是自然而然的路径。

## Decision {#decision}

1. **`TurnoAssincrono.iniciar/3` 在**接受**时响应 `from`。** 在 Task 已启动、`agent.status: working` 已持久化之后，`handle_call` 返回 `{:reply, :ok, state}`。`from` 不再在 `state.turno_assincrono` 中传递；`tratar_resultado/2` 和 `cancelar/1` 不再响应任何人。这对六个对话型 agent 是**同一个**机制——没有第二条路径——ADR 0086 成为一个特例：挂起的 Dev Lead 仍然没有 `agent.done`，只是不再是唯一提前响应的那个。
2. **只有等待离开请求；拒绝留在其中。** agent 在启动 Task **之前**拒绝的东西继续是同步的，并开始拥有自己的状态码，而不是沉默的 202：
   - 已有轮次进行中 → **409**（`turno_em_andamento`），并且现在有持久的 `agent.error`（来源 `politica`）说明消息已被记录但未被读取；
   - Dev Lead 在 Aprovações 中有待处理的计划 → **409**
     （`aguardando_aprovacao`，即已存在的 `agent.error`）；
   - Criativo 没有捕获任何业务规则 → **422**
     （`sem_regra_de_negocio`，同上）。
   api 把这两种状态作为 `ConflictException` /
   `UnprocessableEntityException` 转发，附带 engine 的原话。在 api 中本就同步的验证（已回答表单的 409、缺少回答的 400、RN-160 的 400）不改变位置。
3. **api 的 HTTP 状态**不**改变。** 路由继续是 `201 { ok: true }`。正文和状态码一直意味着“已接受”——改变的是它**何时**到达。改为 202 会改变生成的合约而不改变任何含义，并且用户的事件（`chat.message`、`readiness.confirmed`、
   `architecture.readiness_confirmed`）在响应之前就被写入，因此 201 仍然是真的。
4. **轮次的失败仍然是持久的，并且只经由那里。** 一切原本是 `agent.error` 的东西（崩溃、无效格式、取消、由 api 叙述的失败）继续如此，来源相同。消失的是它在 HTTP 中的镜像——而那从来没人读过：controller 把它丢弃了。
5. **界面通过通道跟踪结束，安全网改变了信号。** web 的四个调用者把“调用已解析”当作“轮次已结束”（RN-131 对丢失的 `agent.done` 的安全网）。这个信号不再存在。取而代之的是 `acompanharTurnoPeloLog`（在 `lib/session-turno.ts` 中）：只要横幅开启，每 4 s 读取一次 event log 的尾部，当相关 agent **最新**持久化的 `agent.status` 不是 `working` 时就关闭轮次。由于第 1 项的顺序，它是可靠的：新轮次的 `working` 在接受**之前**就被持久化，因此在它之后，旧的 `idle` 永远不会是最新的。
6. **提供 Dev Lead 仍然在 Arquiteto 的收尾轮次**之后**。** `OfferInfraHandoffUseCase` 先调用 `offerInfraHandoff`，再调用 `offerDevHandoff`，而两个 handoff 在 event log 中的顺序来自那次等待。没有它，Dev 的那个会先于 Infra 的诞生。`ArquitetoServer` 开始**推迟**在轮次进行中到达的 `:offer_dev_handoff`，并在轮次关闭时执行它——无论是成功、失败、崩溃还是取消，即以前提供它的同一组结局。

## Consequences {#consequences}

- 点击的时间变成接受的时间（写入用户事件 + 启动 Task + 持久化 `working`），长轮次不再变成 500。`GenServer.call` 的上限继续存在，但开始衡量的是 `handle_call`，而不是轮次。
- **原本沉默的拒绝变成可见的错误。** 在轮次期间（包括 kickoff）输入的人开始看到带原因的 409，对话中出现 `agent.error`。api 在询问 engine **之前**写入的 `chat.message` 仍留在日志中——像以前一样成为孤儿，但现在有了解释。在写入之前拒绝需要 api 询问 engine 是否有轮次，而答案会在 `POST` 之前就过时；没有这样做。
- 退回故事（`ReturnStoryUseCase`）仍是尽力而为：那里的 409 会被记录并吞掉，与通知 PO 的任何其他失败一样——拒绝已被记录。不同的是 `agent.error` 现在存在。
- 界面的安全网在轮次**期间**每 4 s 读取一次日志尾部——这段时间界面 3 s 的轮询处于暂停状态（发现 2/7）。如果 engine 在轮次中途重启，不会有 `idle` 到达，横幅会一直开着，直到“Parar”（在本地关闭）或刷新：以前，同样的情况会在点击时变成 500。已声明，未解决。
- 通过 composer 发给 `infra` 的消息落入 `AgentCommandController.message/2` 的最后一个子句，被路由到 Criativo。既有问题，在此测量但**未**修正——是另一条战线。
