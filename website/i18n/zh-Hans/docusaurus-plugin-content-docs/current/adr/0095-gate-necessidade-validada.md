---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0095 — gate `necessidade-validada` 由单独的人工确认关闭，而不是由 Criativo 自我验证

- **状态：** 已接受
- **日期：** 2026-08-17
- **背景：** fluxo.yml × 代码审计（第 6 波/最后一波，B2 项，
  `docs/explanation/auditoria-fluxo-vs-codigo.md`，D 节）
- **扩展：** [ADR 0054](0054-gates-como-registro-declarativo.md)（`docs/gates.yml` 设计的所有者）
- **参考：** `docs/explanation/modelo-de-time.md`——促成本决策的反模式已作为待办事项记录在那里

## 背景 {#contexto}

`docs/fluxo.yml`（角色 `criativo`）自 ADR 0085（fluxo v3）起声明了 `gate_saida: { id:
necessidade-validada, status: proposto }`。该 gate 从未真正存在：`docs/gates.yml` 中没有条目，代码中也没有任何机制。`docs/explanation/modelo-de-time.md` 已在“待决定的提议”列表中记录了它停滞的原因：

> Anti-padrão do Criativo como validação real do gate
> `necessidade-validada`.

反模式是这样的：Criativo 是**产出**业务需求的 agent（通过 `emit_artifact`/`confirm_readiness`，汇总为
`artifact.product_brief`）。如果由模型自己决定这个需求何时“已验证”——例如从对话中推断就绪——那么 gate 就是作者在自我评估，而不是真正的关口。一个没有独立验证的 gate 什么也测不了；它只是假装在测。

### 已经存在但不是这个的东西 {#o-que-já-existe-e-não-é-isto}

- **`confirm_readiness`/RN-142**——结构性下限：当会话中捕获的业务规则为**零**时拒绝（`CriativoServer`，
  `handle_call(:confirm_readiness, ...)`）。这是对**形式**（有内容吗？）的检查，而不是对**实质**（内容对吗？）的检查。它继续完全照原样有效——本 ADR 不触碰它。
- **`AcceptHandoffUseCase`**——PO 接受 handoff 是结构性的：把 handoff 转为 `accepted` 并启用目标 agent。它不评判所接受内容的**内容**；这是每个 handoff 都使用的同一通用机制（QA 从 dev 接受、Dev Lead 从 Arquiteto 接受等）。把这次接受当作“需求验证”会悄悄复用一个含义不同的事件。

两者都不是实质性的 gate。缺少的是第三个刻意设计的机制。

## 决策 {#decisão}

**gate 由用户明确且**单独**的一次点击关闭**——与“Confirmar arquitetura pronta”（[RN-160](../business-rules/autenticacao.md#rn-160)）同一交互模式：`SessionPage.tsx` 中一个专用按钮，一条专用 HTTP 路由
（`POST .../agents/criativo/validate-necessity`），一个专用用例
（`ValidateNecessityUseCase`），写入领域事件
`necessity.validated`（[RN-406](../business-rules.md#rn-406)）。

### 串联：在 `confirm_readiness` 之后，而不是与之并行 {#encadeamento-depois-de-confirm_readiness-não-em-paralelo-com-ele}

有两种顺序都合理：(a) 验证按钮只在 `confirm_readiness` 已运行**之后**（`product_brief` 已存在）才启用；或 (b) 两个按钮并存，各有自己的前置条件，彼此没有顺序关系。

选择 (a)。决定性的论据：**“验证”一份尚未汇总的 `product_brief` 毫无意义**——`necessidade-validada` 在 `docs/fluxo.yml` 中是 Criativo 的**出口** gate，即他的工作已经产出一个具体工件供用户评判的时刻。选项 (b) 将允许在代表需求的执行摘要存在**之前**验证需求，这会颠倒流程本身的顺序（需求**就是**汇总后的 `product_brief`——而不是之前的自由对话）。`hasProductBrief`（`events.some(e => e.type ===
'artifact.product_brief')`）是新按钮的前置条件，与已经守护两个相邻按钮的 `hasBusinessRule`/`hasPromotedStory` 同一模式。

### 为什么**不**通知 engine {#por-que-não-sinaliza-o-engine}

不同于 `OfferInfraHandoffUseCase`（RN-160/[ADR 0086](0086-dev-lead-plano-suspende-para-aprovacao.md)），它调用 `engineClient.offerInfraHandoff`/`offerDevHandoff`，因为**确认**正是启动下一步的东西；这里 Criativo→PO 的 handoff **已经在** `confirm_readiness` 内部发生了
（`CriativoServer.executar_confirm_readiness/1` 在这个 gate 存在之前就已调用
`EngineApiClient.create_handoff`）。没有任何 agent 在等待 `necessity.validated` 来行动——该事件只是记录有人确认了已交付内容的实质。`ValidateNecessityUseCase` 的构造函数中刻意没有通往 engine 的 port：只有 `SessionEventRepository`（读取最新的 `product_brief`）和 `AppendSessionEventUseCase`（写入）。

### `docs/gates.yml`：`warn`，而不是 `block` {#docsgatesyml-warn-não-block}

`aprovacao_humana: true`（字面上就是一次人工点击）和 `verificacao:
script`（验证脚本已经可以从 event log 中提取 `necessity.validated`）。但 `severidade: warn`：今天产品中没有任何机制在让 PO 继续之前**查询**这个 gate 是否通过——不同于 `story-promovida`/`plano-de-adocao`（`block`，因为真实的代码锁阻止它们被跳过），这个 gate 是测量，而不是关口。与 `implementavel` 中已使用的注释同一精神：“即使启用也以 `warn` 诞生”。如果以后出现阻断机制（例如 PO 在没有验证时拒绝工作），提升为 `block` 是新的产品决定，需要它自己的 ADR——不隐含在本次交付中。

## 后果 {#consequências}

**有利**

- 关闭 fluxo.yml × 代码审计计划六个波次中的**最后**一个
  （`docs/explanation/auditoria-fluxo-vs-codigo.md`，D 节）——六个都已关闭（第 3、4、5 波已由 ADR 0089/0090 提前、不按顺序关闭；第 1、2 波在之前的 PR 中关闭；这是第 6 个也是最后一个）。
- `docs/gates.yml` 不再有一个没有登记的 `active` 角色 gate——审计指出的这类缺口中的最后一个。
- 机制是可辨认的：读过“Confirmar arquitetura pronta”（RN-160）的人可以零成本读懂这个——同样的专用按钮 + 前置条件 + 专属事件模式。

**不利**

- Criativo 的流程中多了一次点击，而 `confirm_readiness` 已经独自产出 `product_brief` 和 handoff。接受：正是这多出的一次点击区分了“模型决定了”与“人验证了”——没有它，就根本没有 gate，只是一贯的机制换了个新名字。
- `warn` gate 不会阻止任何东西在没有它的情况下继续——一个项目可以永远不触发 `necessidade-validada`，PO 照常工作。刻意接受：在产品中没有任何人要求硬关口的情况下发明一个阻断，将是 ADR 0041/0042/0077 已经针对凭空捏造的 capability/说明所拒绝的同一类错误——把 gate 声明为诚实的测量，好过假装它锁住了它并不锁住的东西。

## 考虑过的备选方案 {#alternativas-consideradas}

**复用 `confirm_readiness`——一个已经同时算作两者的单一按钮。** 被产生本 ADR 的请求明确拒绝：
`confirm_readiness`/RN-142 是结构性下限（“至少捕获了 1 条规则”），而不是对需求**内容**的实质判断。合并两者会让浅层下限伪装成新的 gate。

**由 Criativo（模型）通过新工具（作为 tool call 的 `confirm_necessity_validated`）自行决定。** 被拒绝：这正是本 ADR 存在所要避免的反模式——产出 `product_brief` 的同一个 agent 不能是证明它正确的那个。

**把 `AcceptHandoffUseCase`（PO 接受 handoff）当作验证。** 被拒绝：这次接受是结构性的，对产品中的**每个** handoff 都是通用的——仅为这一来源改变它的含义，会打破 QA、Infra 和 Dev Lead 同样依赖的“接受 = 我开始工作了”这一解读。

**从一开始就 `severidade: block`，在需求被验证之前锁住 PO。** 被拒绝：这需要发明一个阻断机制（例如 `ActivateAgentUseCase` 在没有 `necessity.validated` 时拒绝启用 PO），而没有人要求过，今天对任何等价的 gate 也不存在（`arquitetura-pronta`/RN-160 除了对已晋升故事的重新验证之外，在后端也不阻断任何东西）。作为未来的可能性登记，而不是本次交付的一部分。

## 参考 {#referências}

- `apps/api/src/application/use-cases/agents/validate-necessity.use-case.ts`
- `apps/api/src/interfaces/http/agents/agents.controller.ts`
  （`validateNecessityHandoff`）
- `apps/web/src/routes/SessionPage.tsx`（`hasProductBrief`、
  `necessidadeJaValidada`、`handleValidateNecessity`）
- `docs/gates.yml`——gate `necessidade-validada`
- `docs/fluxo.yml`——角色 `criativo`，`gate_saida`
- [RN-406](../business-rules.md#rn-406)
- [RN-160](../business-rules/autenticacao.md#rn-160)——被复制的交互模式
- `docs/explanation/modelo-de-time.md`——促成该决策的反模式（本 ADR 将其从待办列表中移除）
- `docs/explanation/auditoria-fluxo-vs-codigo.md`——发现 B2，D 节
  （第 6 波，计划的最后一波）
