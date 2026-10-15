---
traducao_de: 51f6ee68bba3a758faecd802cc3b04861656fdc6
---

# 0191 — 在轮次进行中到达的消息进入持久化队列，并在轮次结束时被读取

## 状态 {#status}

**Accepted.** 2026-10-01（AT-267，负责人 10月1日的决定）。仅针对用户的**消息**，修订
[ADR 0163](0163-o-clique-responde-ao-aceitar.md) 的同步拒绝 `turno_em_andamento`。ADR 0163 不被编辑：它所决定的立即接受继续有效，带名称的拒绝对非对话类命令继续有效（PO 的故事评审、Criativo 的就绪确认、Arquiteto 的 handoff 提议）。规则：
[RN-673](../business-rules.md#rn-673)。

## Context {#context}

自 ADR 0163 起，在轮次进行中到达对话型 agent 的消息会被 409 `turno_em_andamento` 和一个持久的 `agent.error` 拒绝。这结束了沉默——之前 409 是一个沉默的 202——但没有修复缺陷：api 在与 engine 通信**之前**就写入了 `chat.message`
（`SendAgentMessageUseCase`），因此消息留在对话中看起来像已经说出，却从未到达模型。界面会要求“等它结束后再发一次”。

2026-09-29 的真实使用（会话 `be70`）在同一天测到三次这样的情况，每个 agent 一次：seq 100（PO，06:28）、seq 268（Infra Lead，06:39——"infra ainda
está executando"）和 seq 312（Dev Lead，06:46——"ok"）。三条都被记录为 `chat.message`，没有一条被读取。在本代码树中复现：
`TurnoAssincrono.iniciar/3` 在有 `from` 且轮次进行中时回复 `{:error, :turno_em_andamento}`，而 `AgentCommandController.responder_ao_aceite/2` 把它转换为 409——测试 `agent_command_controller_test.exs`（"turno já em
curso: 409 nomeado"）固定的正是这一结果。

队列的唯一先例是 Infra Lead 的（`correcoes_pendentes`，RN-617）：在**内存**中，用于 gate 修正，从不用于用户的话语——并且在 engine 重启时丢失。

负责人的决定（10月1日），即需求：

1. 在轮次进行中到达的消息进入一个**持久化**队列，重启后依然存在；
2. **N 条消息 = 1 个轮次**：在进行中的轮次结束时，待处理的消息按顺序在一个轮次中一起读取；
3. **每一条都可以被取消**，在待处理期间，由发送者取消，所需最低角色与消息路由已要求的相同；
4. **上限 10** 条待处理，按 agent 和会话计，超过即带名称拒绝；
5. 适用于全部**七个**对话型 agent，经由同一路径（`TurnoAssincrono`），绝不按服务器分别实现。

## Decision {#decision}

**队列住在 `TurnoAssincrono` 中，其状态住在 event log 中。**

- `TurnoAssincrono.receber_mensagem/4` 在七个
  `handle_call({:user_message, …})` 中取代直接调用 `iniciar/3`。没有轮次且没有队列时，照常启动轮次（`:ok`，202）。轮次进行中且队列低于 10 时，入队，写入 `chat.message_queued` 并回复 `{:ok, :enfileirada, posicao}`——同样是 202，正文为 `{entrega: "enfileirada", posicao}`。队列达到上限时，`{:error, :fila_de_mensagens_cheia}`：带名称的 409 和持久的 `agent.error`（消息已记录且**不会**被读取——与 ADR 0163 对旧拒绝所要求的同样诚实）。
- **服务器只说明一句话如何变成一个轮次。** 七个服务器各自有了
  `turno_de_mensagem/2`（与 `handle_call` 原先内联完成的组装相同），以及 state 中的守卫（`:montar_turno_de_mensagem`）。`TurnoAssincrono` 决定**何时**；服务器决定**如何**。没有任何服务器获得自己的队列。
- **在轮次结束时——`finalizar/1`，绝不是 `suspender/1`——队列变成**一个**轮次。** 投递是发给自己的消息
  （`:entregar_fila_de_mensagens`），而不是收尾中的调用，因为服务器在同一个 `handle_info` 中还有自己的收尾（Infra Lead 排空 gate 修正，Arquiteto 处理给 Dev Lead 的 handoff），不能碰到一个已经启动的队列轮次。待处理消息合成一段文本
  （`FilaDeMensagens.texto_do_turno/1`：一条就是它自身；多条则按顺序编号，并有一行说明是多条），`chat.message_delivered` 列出这些 id。轮次的语言是**最新**一条消息作者的语言（RN-622）。重要的是**当前** state 中的队列，而不是 Task 结果中的队列，后者捕获的是轮次开始时的 state。
- **在轮次结束与投递之间到达的消息进入队列**末尾**，整个队列立即投递——最新的绝不插到等待中的那些前面。
- **三个不可变事件，都带 `chat.message` 的 id。**
  `chat.message_queued`（agent；`mensagemId`、`texto`、`idioma`、`posicao`——文本随之一起，因为重启后队列需要重新读取它）、
  `chat.message_delivered`（agent；`mensagemIds`）和 `chat.message_cancelled`
  （参与者 `user`，即取消者；`mensagemId`、`agente`）。待处理 = 已入队且既未投递也未取消——engine
  （`FilaDeMensagens.pendentes/2`）和界面（`estadosNaFila`）中是同一推导。没有任何表。
- **重启。** 七个服务器的 `init/1` 从日志重建队列
  （`TurnoAssincrono.fila_ao_subir/3`）并安排投递；
  `Reidratacao` 从历史中去掉被取消的（从未被说出）以及本 agent 的待处理消息（它将通过队列轮次到达——否则会出现两次）。在启动时，关闭孤立轮次（RN-586）之后，`Rehydrator` 唤醒有待处理队列的 agent（`FilaDeMensagens.acordar_pendentes/2`）：否则，engine 宕机时正处于轮次中的 agent 的队列会一直等到有人再写一次。被中断的轮次仍然**绝不**重做——读取的是没有任何轮次读过的消息。
- **取消。** `POST …/agents/:agent/messages/:messageId/cancel`
  （`developer`，与消息路由相同）。api 检查该消息是本会话的 `chat.message`、其参与者是调用者（否则 403
  `mensagem_de_outra_pessoa`），以及会话接受对话（RN-581）。决定它是否仍在队列中的是 agent 进程，它把与投递之间的竞争串行化：已被读取或已被取消时返回 409 `mensagem_fora_da_fila`。agent 不在线时内存中没有队列——队列就是日志——engine 直接写入取消。
- **在审批中挂起的轮次（Dev Lead，RN-284）继续拒绝**，返回
  `aguardando_aprovacao`。曾考虑使用同一队列并被拒绝：挂起的轮次没有可预见的结束（取决于某人在 Aprovações 中做出决定），入队就等于承诺在一个看不到尽头的“轮次结束时”读取。挂起时已在队列中的消息会等到**恢复**结束——投递会跳过挂起状态。
- **界面。** 当消息发往 agent 时，composer 在轮次期间不再锁定：按钮变成“Pôr na fila”，消息不会启动新轮次（进行中的轮次仍是被跟踪的那个），并在对话中带着“na fila de <agente>”的标记出现，对发送者还显示取消按钮。被取消的显示为删除线。没有 agent 的聊天（SSE）继续锁定：那里没有队列。

## Consequences {#consequences}

- **拒绝 `turno_em_andamento` 并未消失。** 它仍用于故事评审、就绪确认和 handoff 提议，这些以 `from` 调用 `iniciar/3`。单独阅读 ADR 0163 的人会以为消息仍被拒绝；RN-578 指向这里。
- **消息进入队列时其文本在日志中出现两次**（在 `chat.message` 和 `chat.message_queued` 中）。接受的代价：没有它，一个其 `chat.message` 已滑出 200 事件窗口的队列将无法重建。
- **在 `init/1` 中读取队列是每次 agent 启动多一次查询**（按类型，带 ADR 0060 的 200 上限）。一个会话中超过 200 个队列事件会让重建只看到最近的——已声明，未测量；10 条待处理的上限让这不太可能，但并非不可能。
- **启动时唤醒会在无人点击的情况下花费 token**——代表的是用户发送过而没有任何轮次读过的消息。这是与 RN-586 的刻意区别，后者不重做轮次：被中断的轮次可能已有效果；待处理的消息则没有。
- **agent 不在线时的取消有一个窗口：** agent 可能正在启动（从日志读取队列），与此同时取消被写入。没有锁；消息可能会被读取。已声明。
- **界面上另一个 agent 轮次进行中时发给其他 agent 的消息。** 界面一次跟踪一个轮次；在另一个工作时向**空闲**的 agent 发送会启动它的轮次（`entrega: lida`），界面开始通过日志跟踪它。收件人选择器在轮次期间仍然锁定，与之前一样。
- **已结束的会话。** agent 停止（RN-581），队列随之消亡；原本待处理的消息在日志中永远“在队列中”，界面不会在非活动会话中提供取消。如果会话被重新打开（ADR 0183）且 agent 再次启动，它的 `init/1` 会投递队列——接受的后果，没有单独设计。
- **只有 CI 能证明 engine。** 在本代码树中 `repo.hex.pm` 返回 403，ExUnit 套件无法在本地运行；新测试
  （`fila_de_mensagens_test.exs`）和调整过的测试是针对现有 fake 编写的，只经过解析器和格式化器验证。
