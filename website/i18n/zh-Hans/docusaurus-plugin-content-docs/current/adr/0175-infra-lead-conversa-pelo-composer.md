---
traducao_de: 647a615b764cb1f27b5073762d7a6e80f1c8cd15
---

# ADR 0175 — Infra Lead 通过 composer 对话，在此之前它的回合先经过 `TurnoAssincrono`

## 状态 {#status}

**已接受。** 2026-09-27（AT-141）。维护者的决定：**是**——Infra Lead 开始通过 composer 对话，成为**第七个**对话式 agent。引用 [ADR 0163](0163-o-clique-responde-ao-aceitar.md)（点击在接受时响应），本文档**不**编辑它：它为六个对话式 agent 决定的内容，通过**同一个**机制对第七个也生效。还引用 [ADR 0038](0038-hierarquia-de-agentes.md)（agent 的层级、lead 和子 agent）和 [ADR 0086](0086-dev-lead-plano-suspende-para-aprovacao.md)（Dev Lead 的挂起，Infra Lead 没有）。规则：[RN-617](../business-rules.md#rn-617)。关闭 [RN-584](../business-rules.md#rn-584) 以书面形式留下的悬而未决的决定。

## 背景 {#context}

[RN-584](../business-rules.md#rn-584)（AT-098）去掉了聊天消息的默认收件人，并给了 `infra` 一个**具名**的拒绝（`422
agente_sem_conversa`），留下声明的产品问题：Infra Lead 是否通过 composer 对话？并声明了在没有准备的情况下回答“是”的代价：`InfraLeadServer` 导出的 `user_message/2` 在 `handle_call` 内部运行**整个**回合，`GenServer.call` 上限为 180 秒。

修改之前在代码中测得，Infra Lead 不在 [ADR 0163](0163-o-clique-responde-ao-aceitar.md) 及其后续 RN 给其他六个的**所有**部件之中：

| 部件 | 六个 | Infra Lead |
|---|---|---|
| 立即接受，先写入 `working`（[RN-578](../business-rules.md#rn-578)） | `TurnoAssincrono.iniciar/3` | 整个回合在 `handle_call`/`handle_cast` 中 |
| 具名拒绝 `409 turno_em_andamento` | 是 | 第二条消息在进程的队列中等待 |
| “Parar”（[RN-122](../business-rules.md#rn-122)） | `cancel/2` 的 `via_for/2` | `via_for/2` 不认识它，也没有可杀的 Task |
| 重启时的孤儿回合（[RN-586](../business-rules.md#rn-586)） | `TurnoOrfao` | “fica de fora — declarado na RN-586” |
| 关闭会话时停止（[RN-581](../business-rules.md#rn-581)） | `terminate/2` 放弃 Task | 等待 5 秒后被杀死 |
| 叙述的迭代上限（[RN-166](../business-rules/autenticacao.md#rn-166)） | `toolloop.limit_reached` | 循环在第 14 步静默结束 |

kickoff 也是：作为 `cast`，它不卡住任何点击，却在整个回合期间占用进程——在 AT-089 的安装中测得 8,4 分钟。这期间到达的消息会在队列中等待这 8,4 分钟，并以控制器中的 `:timeout`（500）结束，而“Parar”只会在之后才被处理。

还有上限：api 自动批准执行的容器动作的 `propose_action` 最多等待 225 秒（[RN-605](../business-rules.md#rn-605)），超过 `user_message/2` 的 180 秒。一条让模型提议 `container_start` 的消息，可能在提议仍然有效时让 `GenServer.call` 超时。

## 决策 {#decision}

1. **先是回合，然后是子句。** Infra Lead 的**三种**回合——kickoff、gate 纠正（`{:correct, _}`）和消息——都通过 `Engine.Agents.TurnoAssincrono` 启动，与六个使用的是**同一个**模块。kickoff 仍然是 `cast`，只在被接受 handoff 的**全新**启动时触发；改变的是它在哪里运行（在一个 Task 中）。旧的内联运行的 `user_message/2` 不复存在：名字保留了，现在它是接受——没有两条路径。
2. **与 Workflows 的整合在 Task **内部**运行。** 回合的结束（`concluir/1`：`propose_infra_pr` 的 HALT → `WorkflowsAgent` → 唯一的 PR）是回合函数的一部分，并返回 `state`；结束信号（`agent.done`、`agent.status: idle`）只从 `TurnoAssincrono` 发出，在服务器的进程中（[RN-585](../business-rules.md#rn-585)）。“Parar”也会杀死进行中的 Workflows。
3. **gate 纠正不会被丢弃。** 不带 `from` 的 `TurnoAssincrono.iniciar/3` 在有回合进行中时会忽略请求（kickoff 的防御性情况）。对于纠正，这会丢失 gate 的请求，所以它进入一个**队列**（`correcoes_pendentes`），并在回合结束时启动——成功、失败、崩溃或“Parar”——按到达顺序。这是 Arquiteto 的 `handoff_dev_pendente` 的模子。
4. **Infra Lead 进入 engine 的列表**：`@agentes_de_conversa` 以及 `message/2` 自己的子句（RN-584 的拒绝移除）、“Parar”中的 `via_for("infra")`，以及 `TurnoOrfao`（`@agentes`）。`Engine.Agents.Conversacionais` 本来就列着它。
5. **迭代上限是它自己的，14**，与 Arquiteto、Dev Lead、UX Designer 和 Staff 相同——第 14 步开始发出 `toolloop.limit_reached`。
6. **界面按一贯的规则提供它。** `infra` 进入 `AGENTES_DE_CHAT`（`apps/web/src/lib/session-readiness.ts`）：当它是最近的 `agent.activated` 时，它就是收件人，没有默认收件人（[RN-584](../business-rules.md#rn-584)）。**它的** handoff 的接受仍然在 [RN-499](../business-rules.md#rn-499) 的专用卡片中，消息流的卡片按**名称**排除它——否则邀请会出现两次，而且由于它是最早的，会再次掩盖 Dev Lead 的那个（RN-136）。
7. **对话不会打开外部效果。** 工具还是那四个；infra 的 PR 和两种容器启动仍然以 `proposed_action` 诞生，RN-566/RN-577/RN-610 的本地拒绝保持不变。

## 后果 {#consequences}

- **180 秒的上限对回合不再重要。** `user_message/2` 的 `GenServer.call` 只等待接受（毫秒级）；容器 `propose_action` 的 225 秒在 Task 内部流逝，没有人在同步等待。数字 180 000 保留了，与其他六个相同，作为**接受**的上限。
- **kickoff 期间的消息会以具名方式被拒绝。** 以前它会等待；现在是 409 `turno_em_andamento`，带持久的 `agent.error`——与其他六个相同的规则。
- **生成的列表不变。** `SOLO_CONVERSATIONAL_AGENTS`（由 `pnpm --filter api gerar:areas` 生成）是手动 handoff 所指向的**没有**领域的 agent 的列表；Infra Lead 是领域的 lead，仍然不在其中。`AGENTES_DE_CHAT` 不是生成的：它是守卫 `scripts/ci/destinos-do-composer.spec.ts` 与子句对照的列表。
- **界面会叙述它的工具。** 这四个在活动条中获得了句子（`toolNarration.json`），而不是回退。
- **已声明而未关闭：** Infra Lead 没有 `ask_structured_questions`，也没有 backlog 的读取——与它对话，就是与 kickoff 给它的东西以及一贯的工具对话，扩展这一点是独立的战线。消息不会重新执行 kickoff：一个被消息重新拉起的 Infra Lead（engine 重启后）会重新水合历史并回答，而不重新生成构件。
