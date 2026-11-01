---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0088 — Staff：代码就绪，自动触发处于休眠

- **状态：** 已接受
- **日期：** 2026-08-16
- **背景：** `docs/fluxo.yml`，块 `id: staff`（`camada_decisao_tecnica`），
  自 ADR 0085 起为 `status: planned`
- **直接先例：** [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)
  （Dev Lead——独立对话型 agent，无区域），
  [ADR 0068](0068-diagrama-c4-do-arquiteto.md)（无表的工件，在 event log 中版本化）

## 背景 {#contexto}

自 ADR 0085 起，`docs/fluxo.yml` 将 Staff/Principal Engineer 声明为
`status: planned`：“合约就绪，启用已决定，等待触发器”。为它设想的触发器是 Anamnese 发现一个**反复出现**的系统性问题——但 Anamnese 处于暂停状态（`ANAMNESE_ENABLED=false`，2026-08-10 的产品决策），暂停期间不会提出任何 handoff。

产品负责人决定提前交付**代码**，即使知道自动触发器不会触发：Staff 已就绪并可**手动**启动（今天任何 agent 或用户都可以通过通用内部路由向它发起 handoff），只有自动触发仍待完成。这**不是**半成品实现——这与 ADR 0081 对容器生命周期所做的区分相同（表已就绪，编排器尚未）：缺失的部分是被声明的，而不是被隐藏的。

## 决策 {#decisão}

**Staff 作为第五个独立对话型 agent 诞生**（与 Criativo、PO、Arquiteto 和 Dev Lead 并列），完全沿用 Arquiteto 的模子——每个会话一个 GenServer、从 event log 重建（rehydration）、自己的有界工具使用循环（上限 14，与 Arquiteto/Dev Lead 同一量级：推理，而非轻量对话）——只有两处刻意的差异。

### 1. 没有 `kickoff/1` {#1-sem-kickoff1}

所有其他对话型 lead 在**全新**启动时从会话的 event log 合成一条开场指令（各自的 `kickoff_instruction/1`）——总有之前的工件（product_brief、module_map、backlog）可以概括。Staff 没有这样的来源：让它浮现的系统性问题来自外部（Anamnese，当它存在时；或今天手动创建 handoff 的人），而不是来自其所在会话的 event log。没有 kickoff，`Engine.Agents.StaffSupervisor.start_agent/2` 启动进程（重建历史），然后它保持空闲，直到第一条 `user_message`——这就是发起 handoff 的人解释问题的方式。

`apps/engine/lib/engine_web/controllers/agent_command_controller.ex` 体现了这一点：“staff”的 `start/2` 子句**从不**调用 `StaffServer.kickoff/1`（该函数根本不存在），不同于 po/arquiteto/dev-lead/infra，它们在 `origin == :started` 时有条件地调用。

### 2. 启用：通用路径，不使用 `USER_STARTED_AGENTS` {#2-ativação-o-caminho-genérico-sem-user_started_agents}

`USER_STARTED_AGENTS`（`apps/api/src/domain/sessions/agent-activation.ts`）是 Criativo 的例外——不经 handoff、由用户直接命令启动。调查确认 Staff **不需要**进入这个列表：`canActivateAgent` 已经会启用任何有一个指向它的 `accepted` handoff 的 agent，这与今天 `dev-lead`/`arquiteto`/`infra` 使用的路径相同。为此，api 中不需要任何领域改动：

- `assertHandoffTargetAllowed`（`apps/api/src/domain/agents/agent-areas.ts`）只**拒绝**指向区域**子 agent** 的 handoff（ADR 0038）；Staff 没有区域——像 Criativo/PO/Arquiteto/Dev Lead 一样自由通过。
- `ActivateAgentUseCase`/`ApiToEngineClient.startAgent` 对 `agent: string` 是通用的——没有需要扩展的枚举。

后果是坦诚的：“可手动启动”意味着领域**机制**允许 handoff 和启用，而不是说今天存在一个专门的界面，让人在不通过其他 agent 的代码或直接调用内部路由（`POST .../internal/sessions/:sessionId/handoffs`）的情况下选择“向 Staff 发起 handoff”——“向任选 agent 手动 handoff”的通用 UI 仍在 backlog 中（`docs/explanation/backlog.md`），本次变更之前就是如此。

### 3. `propose_rfc`——唯一的工具，不是 `proposed_action` {#3-propose_rfc--a-única-ferramenta-sem-proposed_action}

`Engine.Agents.StaffTools.propose_rfc` 写入 `artifact.rfc_staff`（问题、带权衡的选项、建议、一次性 PoC），并在**同一个** tool call 中把 handoff 交回 Arquiteto——中间没有人工确认，与 `CriativoServer` 在同一回复中发出 product_brief 并向 PO 提供 handoff 的模式相同。

两个真实先例决定了这一机制，因此 api 中**没有**诞生任何新用例：

- `Engine.Harness.Tools.EmitInsight`（Arquiteto 的 `emit_insight`）是**无推导**工件的模式：整个 payload 来自 tool call，事件直接通过 `EngineApiClient.append_event_returning/3` 写入——无表，无专用用例。
- `artifact.c4_diagram`（ADR 0068）是证实这一选择的**对照**：它在 api 中有自己的用例，因为 Container 层级是从当前 `module_map` **推导**出来的——只有 api 拥有该数据。RFC 不需要从那边推导任何东西。

`propose_rfc` 也**不是** `proposed_action`：登记一份架构文档不是外部效果（不是 git、终端，也不是 agent 花费）——真正的决定（采纳、调整、拒绝）属于 Arquiteto，在该工具已交回的 handoff 中做出。与 `emit_insight` 同样的理由。

## 后果 {#consequências}

**有利**

- Staff 在 engine 中端到端存在（服务器、工具、supervisor、路由），今天就可测试，无需等 Anamnese 结束细化——当它回来时，只差 Anamnese 的**代码**调用 `create_handoff(..., "staff", ...)`；其余都已就绪。
- 启用不需要 api 中的任何领域改动——调查证明通用路径已足够，避免开一个以后还得撤销的新例外（`USER_STARTED_AGENTS`）。
- `docs/fluxo.yml` 不再是唯一知道 Staff 存在的来源：代码与注册表已声明的内容一致，真实缺口（自动触发器）变得精确，不再笼统（“等待触发器”）。

**不利，已声明**

- **团队面板的 roster（`apps/web/src/lib/agent-status.ts`）和仪表盘卡片（`ProjectCardSummary.roster`，经由
  `apps/api/.../projects-summary.repository.ts`）在 Staff 活跃时会显示它**——`staffActive` 已加入两条路径，标准与 `infraActive` 相同，以免重蹈 `RosterFacts` 注释早已警告过的分歧（“两条规则会在第一个新 agent 出现时分歧”）。
- **会话界面（`SessionPage.tsx`）没有改动。** `staff` 不进入 `AGENTES_DE_CHAT`——与 `infra` 已被接受的模式相同（**真实**、**活跃**的 agent，同样不在该列表中：该文件自己的注释记录了指向 Infra 的 handoff“从不在**这里**被接受”）。这不是 Staff 的**新**缺口：这是产品对没有由会话 composer 驱动对话的 lead 早已采用的模式。声明的真实差异：Infra 有 `kickoff/1`（被接受后自己运行）；Staff 没有——因此，在没有能向它发送第一条 `user_message` 的聊天界面的情况下，今天端到端的使用路径是内部路由（`POST .../agent/message`，`agent: "staff"`），而不是界面。补上这一点意味着改动 `SessionPage.tsx`——产品中争用最多的文件——不属于本决策：提前的是代码，不是聊天 UI。
- `Engine.Harness.Agents.identity/1`
  （`apps/engine/lib/engine/harness/agents.ex`）中没有条目——与今天的 `dev-lead` 状态相同，它同样落入通用回退（"Você é o agente staff."）。这不是**新**缺口：是一个活跃先例的真实状态，没有顺手修正。

## 考虑过的备选方案 {#alternativas-consideradas}

**等 Anamnese 结束细化再构建 Staff。** 被拒绝——产品负责人的明确决定：提前写代码可以免去 Anamnese 重新开启那天的“第二个 PR”，而**手动**启动的价值独立于自动触发器而存在。

**把 `staff` 加入 `USER_STARTED_AGENTS`。** 被拒绝——调查表明没有必要：`canActivateAgent` 的标准路径已经会通过被接受的 handoff 启用，而该列表是为**相反**的例外（不经 handoff 启动的 agent）存在的。在这里添加会凭空创造一条领域不需要的规则。

**给 Staff 一个带通用指令（“调查系统性问题”）的 `kickoff/1`。** 被拒绝——没有真实工件可概括（只有 Anamnese 才会产出），kickoff 将是一个空洞的邀请；会话保持空闲直到第一条消息，这样是坦诚的。

## 参考 {#referências}

- `docs/fluxo.yml`——块 `id: staff`
- `docs/business-rules.md`——RN-305/RN-306
- [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)——无区域的独立对话型 agent 的模子
- [ADR 0068](0068-diagrama-c4-do-arquiteto.md)——为 RFC 决定“无专用用例”的对照
- [ADR 0081](0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md)——
  “部件就绪，真实消费者尚未”且不弱化声明的先例
- `apps/engine/lib/engine/agents/staff_server.ex`、`staff_tools.ex`、
  `staff_supervisor.ex`
- `apps/engine/lib/engine_web/controllers/agent_command_controller.ex`
- `apps/api/src/domain/sessions/agent-activation.ts`、
  `apps/api/src/domain/agents/agent-areas.ts`
- `apps/web/src/lib/agents.ts`、`apps/web/src/lib/agent-status.ts`
