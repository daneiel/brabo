---
traducao_de: 23e727d97992c1974a3df731360a293b67fd669c
---

# ADR 0109 — 向任选 agent 的手动 handoff 复用"提供 + 接受"，绝不引入第三种 handoff 状态

- **状态：** 已接受
- **日期：** 2026-08-23
- **背景：** 关闭 backlog 条目"Manual handoff to an agent of
  choice"（`docs/explanation/backlog.md`），其激活标准早已写在那里："当**固定** handoff 流水线**之外**的某个 agent 需要由人的决定来到达时——今天正是 Staff 的情况（ADR 0088），只能通过内部路由到达"
- **直接先例：** [ADR 0038](0038-hierarquia-de-agentes.md)（handoff 的目标规则——`assertHandoffTargetAllowed`）、[ADR 0088](0088-staff-agente-dormente-para-disparo-automatico.md)（Staff，促成本 ADR 的真实案例）、[ADR 0087](0087-ux-designer-agente.md)（UX Designer，由同一次调查发现、可一并处理）

## 背景 {#context}

`CreateHandoffUseCase` 是系统中唯一写入 `toAgent` 的地方（ADR 0038）——但它唯一的调用方是 `POST internal/sessions/:sessionId/handoffs`，一条只属于 engine 的路由。今天产品中的每个 handoff 都是由某个 **agent** 主动调用这条内部路由创建的（Criativo 提供给 PO，Arquiteto 提供给 Infra/Dev Lead，等等）。没有路径让一个**人**从会话界面把 handoff 指向这条固定链之外的 agent。

ADR 0088 在构建 Staff 时精确地点出了这个缺口："可**手动**触发"意味着领域机制（激活、目标校验）早已允许，但"通用的'向任选 agent 的手动 handoff' UI 仍在 backlog 中"。Staff 在 engine 中的管线（`StaffSupervisor`、`StaffServer`、`agent_command_controller.ex` 中的 `"staff"` 子句）已经就绪，却没有任何真实用户路径测试过它——到达它的唯一方式是对内部路由发起一次原始 HTTP 调用。

在写任何代码之前的调查发现了处于同样境地的第二个 agent：`ux-designer`（ADR 0087）在 engine 中同样有一个完整连接的 `message/2` 子句（`agent_command_controller.ex`，通过阅读文件确认——该子句与 Staff 的完全对应），并且同样无法从 `SessionPage.tsx` 到达，因为后者从未把它加入 `AGENTES_DE_CHAT`。两者一起关闭。

## 决策 {#decision}

**没有第三种 handoff 状态。** 手动 handoff 由 agent 自己的 `offer_handoff` 早已使用的**同一个** `CreateHandoffUseCase.execute` 写入——它以 `offered` 诞生，与自动的完全一样，而**既有**的接受流程（`AcceptHandoffUseCase`、路由 `handoffs/:handoffId/accept`、`SessionPage.tsx` 的 `offeredHandoff`/`handleAcceptHandoff`）无需任何改动就能接住它。唯一新的东西是第二条面向人的**写入**路径。选择这样做而不是发明一个独立的 `manual_handoff` 概念，有两个理由：

1. **读取一侧从来不需要知道是谁做的决定。** `handoff.offered` 在事件信封中本来就有 `actor`——手动 handoff 只是写入 `actor: {kind: 'user', id: userId}`，而不是 `CreateHandoffUseCase` 在代码中写死的默认值 `{kind: 'agent', id: fromAgent}`。`CreateHandoffInput` 正是为此增加了可选字段 `actor?: Actor`——与已有的兼容，内部调用方不传它，保持旧行为。
2. **为第二"种" handoff 重复接受/激活逻辑，正是 ADR 0086 已经拒绝过一次的反模式**（第二套挂起机制，而不是复用已有的）。`SessionPage.tsx` 中的接受卡片不在乎 handoff 是**如何**被提供的——只在乎它存在，并且指向界面知道如何与之对话的 agent（`AGENTES_DE_CHAT`）。

**`addressableAgents()`——比 `assertHandoffTargetAllowed` 更严格的目录。** 既有的目标规则（ADR 0038）只会**拒绝**子 agent；它对 `toAgent` 是否是一个真实、已知的 agent 不持任何意见——一个以"abc"为目标的 agent 也会通过。对 agent 而言这没问题，它只会提到自己指令中已知的 agent。对在下拉框中选择的人而言就**不**行了，过时的客户端或手工构造的请求可能发送任何东西。`addressableAgents()`（`apps/api/src/domain/agents/agent-areas.ts`）是封闭集合——区域 lead（`AGENT_AREAS.map(a => a.lead)`）∪ `SOLO_CONVERSATIONAL_AGENTS`（`criativo`、`po`、`arquiteto`、`ux-designer`、`staff`）——`RequestManualHandoffUseCase` 在调用 `CreateHandoffUseCase` **之前**核对是否属于它。

`SOLO_CONVERSATIONAL_AGENTS` 是一个新的、手写的列表，位于 api 的领域层——不是从 `apps/web/src/lib/agents.ts` 派生的（那个名册还包括 `qa-automacao`/`secops` 这样的 gate agent 以及 Psicólogo/Anamnese，都不能通过 handoff 寻址），也不是由 `gerar:areas` 生成的（它只覆盖 `AGENT_AREAS`）。web 一侧在 `agents.ts` 中获得自己手工镜像的副本，就在注释早已说明它"为颜色、图标和寻址**规则**而保留"的同一个文件中——这正是那条规则。今天两个列表**没有**通过测试相互核对（那需要与 Fase 18 的区域列表相同的生成器机制）；在最坏情况下，那里的分歧会在 `<select>` 中产生一个过时的选项，而后端的 `RequestManualHandoffUseCase` 会继续以 400 拒绝它——绝不会写出错误的 handoff。

**手动 handoff 的 `fromAgent` 是推导出来的，而不是询问的。** 选择器只询问 `toAgent`——再让用户指定 `fromAgent` 等于要求他解释 engine 的内部记账。`RequestManualHandoffUseCase` 读取会话的 `agent.activated` 事件（`SessionEventRepository.listByTypeInSession`）并取最近的一个，与 `SessionPage.tsx` 的 `activeAgent` 已在使用的"按 `seq` 最近者胜"规则相同（发现 9-fix）——此前在服务端不存在任何关于会话"当前 agent"的查询，因此本 ADR 引入了第一个，作用域限于本用例。尚未激活任何 agent 的会话落到哨兵值 `"usuario"`——绝不是猜出来的 agent 名，这与 RN-059 已经为轮次失败确立的"不用排除法诊断"规则相同。

**`ux-designer` 和 `staff` 都进入了 `AGENTES_DE_CHAT`。** 在写任何 web 代码之前通过阅读 `agent_command_controller.ex` 核实：两者都有一个与 `po`/`dev-lead`/`arquiteto` 形式完全相同的 `message/2` 子句——两者都不需要任何 engine 改动。`infra`/`qa` 仍被排除，没有变化：它们是没有 `kickoff/1` 也没有 `message` 子句的区域 lead，与 `AGENTES_DE_CHAT` 的注释早已给出的排除 Infra 的理由相同。

## 后果 {#consequences}

**有利**

- Staff（ADR 0088）和 UX Designer（ADR 0087）第一次可以从会话界面到达——两者在 engine 中都有完整的管线，却闲置在一条只有内部可用的路由之后。
- 零新的 handoff 语义：`handoffs` 表、`handoff.offered` 事件的形态以及接受/激活路径全都不变。除了 `actor.kind`，手动和自动的 handoff 对每个既有读者都无法区分。
- 可寻址目录是封闭且类型化的，而不是自由文本字段——`RequestManualHandoffUseCase` 像拒绝子 agent 一样拒绝未知的 slug，两者都在任何写入之前返回 400。

**不利，已声明**

- **没有测试在 api 与 web 之间核对 `SOLO_CONVERSATIONAL_AGENTS`。** 向 api 的列表新增一个独立对话式 agent 却不更新 web 的手工镜像，不会让 CI 失败——它只是不会作为选项出现在选择器中，直到有人注意到。扩展 `gerar:areas`（Fase 18）使其也覆盖这个列表是正确的修正，留到第二次分歧真正发生时再做（与 CLAUDE.md 要求的"不重构已完成之物"同一纪律）。
- **选择器不提供目标 agent 将如何处理 handoff 的确认/预览。** 它是一个简单的 `<select>` + 按钮，有意做得比 composer 更小（`.manualHandoffRow`，ADR 的意图："这是重定向，不是对话"）。
- **`infra`/`qa`/`dev-<modulo>` 仍然无法通过这个选择器到达。** `addressableAgents()` 包含它们的 lead（`infra`、`qa`、`dev-lead`）——它们**可以**被后端寻址——但 `AGENTES_DE_CHAT`（web 中独立的"本界面实际能与谁对话"列表）不包含 `infra`/`qa`，所以通过这个选择器向它们发起的 handoff 会创建一个接受卡片无法绘制的 `offered` handoff。本 ADR 不修正这一点——这与 ADR 0088 在本功能之前对 Staff 已经声明的局限相同，现在收窄到两个没有 `message` 子句的 lead。

## 考虑过的替代方案 {#alternatives-considered}

**一条专门的路由 `POST .../handoffs/manual`，与通用的 `POST .../handoffs` 分开。** 被拒绝：`GET .../handoffs` 早已拥有不带动词后缀的纯 `handoffs` 路径，而 Nest 按 HTTP 方法而不仅是路径路由——`POST .../handoffs` 读起来就是"创建一个 handoff"，无需限定词，而接受路径（`.../handoffs/:handoffId/accept`）已经确立了只在发生状态转换时才加动词后缀的模式。

**扩展 `CreateHandoffInternalDto`/内部路由以接受 `userId`，并直接从 web 调用它。** 被拒绝：内部路由在 `docs/security-surface.md` 中被归类为 `engine-service`，由共享的服务 token 而不是用户的 JWT 认证——让由人发起的请求经由它路由，会模糊 `route-surface.spec.ts` 所强制的分类，并完全跳过 `RequireRole('developer')`。

## 参考 {#references}

- `apps/api/src/domain/agents/agent-areas.ts` — `addressableAgents`、`SOLO_CONVERSATIONAL_AGENTS`
- `apps/api/src/application/use-cases/agents/request-manual-handoff.use-case.ts`
- `apps/api/src/application/use-cases/agents/create-handoff.use-case.ts` — 增加 `actor?: Actor`
- `apps/api/src/interfaces/http/agents/agents.controller.ts` — `POST
  .../handoffs`
- `apps/web/src/lib/agents.ts` — `addressableAgents`、`SOLO_CONVERSATIONAL_AGENTS`
- `apps/web/src/routes/SessionPage.tsx` — `AGENTES_DE_CHAT`、`.manualHandoffRow`
- `docs/business-rules.md` — RN-440
- `docs/explanation/backlog.md` — 已关闭的那一行"Manual handoff to an agent
  of choice"
