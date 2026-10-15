---
traducao_de: 78383039b5006cf39f88edb5054e4f5bb1b43aea
---

# 0185 — "Estou pronto — a necessidade está validada"：一次点击同时关闭就绪确认、gate `necessidade-validada` 和 PO 的接受

## 状态 {#status}

**Accepted.** 2026-09-30（AT-311 和 AT-312，故事 HS-079，史诗 EP-031，
第 32 轮）。负责人的决定，对 AT-309 调研中的两个问题都回答了“是”：

> "Um único clique 'Estou pronto — a necessidade está validada' pode fechar os
> dois gates, mesmo com o product_brief produzido depois do clique?"
>
> "O aceite do PO pode ser implícito no 'Estou pronto'?"

修订 [ADR 0095](0095-gate-necessidade-validada.md)（gate `necessidade-validada` 由一次**单独**的点击关闭）的设计以及
[RN-406](../business-rules.md#rn-406)。不编辑 0095：记录改变了什么，以及其中什么继续有效。

## Context {#context}

在 `origin/dev`（`94e5dc721d`）上测量，基于 AT-309 的调研：

- **“Validar necessidade”不锁定任何东西。** 该按钮只有在会话中有 `artifact.product_brief` 时才启用（`hasProductBrief`，`session-readiness.ts`），出现在“Estou pronto para produzir”**之后**，只写入 `necessity.validated`（`ValidateNecessityUseCase`），而该 gate 在 `docs/gates.yml` 中是 `warn`——RN-406 自己就说产品中没有任何东西**查询**它是否通过。
- **接受 PO 是紧接在“Estou pronto”之后多出的一次点击。** Criativo→PO 的 handoff 诞生于“Estou pronto”触发的轮次之中
  （`CriativoServer.executar_confirm_readiness/1` → `EngineApiClient.create_handoff`
  → `POST /internal/sessions/:id/handoffs`），而接受卡片调用
  `AcceptHandoffUseCase`，它写入向 `accepted` 的转换、
  `handoff.accepted`（参与者为该人）、`agent.activated`（参与者为该人），并按照 RN-635 写入项目中其他给 PO 的提议的 `handoff.superseded`。
- 三次点击——就绪、验证、接受——表达的是一个意图：“Criativo 整理的东西是对的，可以继续”。

0095 明确拒绝把验证并入 `confirm_readiness`，其论据依然正确：单独的 `confirm_readiness` 是结构性**下限**（“≥1 条已捕获的规则”，RN-142），而不是**实质**判断，合并两者“会让浅层下限伪装成新的 gate”。在这里回应这一反对意见的是**标签**：点击不再是“Estou pronto para produzir”，而成为“Estou pronto — a necessidade está validada”。用户用两者各自的措辞同时声明了两件事；结构性下限仍由 engine 检查，实质仍由人来声明。

## Decision {#decision}

### 1. 一个 POST，两个事件（RN-657） {#1-um-post-dois-eventos-rn-657}

`POST .../sessions/:id/readiness`（`ConfirmReadinessUseCase`）写入
`readiness.confirmed`，调用 engine，并且**只有在 engine 接受了轮次时**，才以同一人为参与者写入 `necessity.validated`，
`productBriefId: null`、`via: 'readiness.confirmed'` 以及 `readinessEventId`。
`productBriefId` 为空是对负责人问题后半部分的回答：brief 诞生于点击触发的轮次，事件指向的是**点击**，而不是一个尚不存在的 brief。

engine 的拒绝（409 轮次进行中，422 没有规则）在第二个事件之前就上抛：没有被接受的轮次，就没有正在到来的 brief，需求也不会被验证。`readiness.confirmed` 继续一如既往地在命令**之前**写入（ADR 0163）。

gate 仍然是 `warn`。没有任何东西开始查询它，提升它仍然是需要专属 ADR 的产品决定，如 0095 所说。

### 2. PO 的接受是隐含的，使用**相同**的事件（RN-658） {#2-o-aceite-do-po-é-implícito-com-os-mesmos-eventos-rn-658}

新点击的 `readiness.confirmed` 带有标记
`{ necessidadeValidada: true, aceiteImplicitoDoPo: true }`。当 engine 通过内部路由创建 Criativo→PO 提议时，api 会询问
（`decidirAceiteImplicitoDoPo`，纯规则）它是否就是那次点击所请求的提议——`criativo` → `po`、`offered`、本会话、携带的是在最近一次带标记的 `readiness.confirmed` **之后**诞生的 `product_brief`——如果是，就通过 `AcceptHandoffUseCase`（与卡片**相同**的用例）以点击者的名义接受它。

可审计的轨迹就是卡片的轨迹，没有新事件：`handoff.accepted` 和
`agent.activated` 以该人为参与者，两者的 payload 中都带有标记
`implicito: { via: 'readiness.confirmed', readinessEventId }`。在负责人留下的两个选项（新事件，或带人类参与者和标记的相同事件）中，选择了第二个，因为今天的每个读者——
`canActivateAgent`、handoff 列表、图投影、界面——都已经理解 `handoff.accepted`；新事件需要教会每一个，而漏掉一个就会把 PO 读成从未被接受。没有任何事件被编辑。

接受发生在内部路由中而不是在点击的 POST 中，因为在点击时提议还不存在。接受的失败不会上抛给 engine（Criativo 会叙述“我没能提供 handoff”，这是假的）：它变成持久的 `agent.error`，参与者为 `system`/`aceite-implicito`，带来源。400“não está `offered`”不是失败——另一个标签页在间隔中决定了这个提议，这已经在日志中。

### 3. engine 不变 {#3-o-engine-não-muda}

经测量：Criativo 不等待接受的任何东西（内部路由的响应只与 `{:ok, _}` 匹配），PO 由一贯的 `startAgent` 启用，其 `kickoff` 是 `GenServer.cast`。唯一的区别是**时刻**：PO 在创建提议的调用中启动，仍在 Criativo 的轮次中，而不是在人工点击之后。

### 4. 界面 {#4-a-tela}

按钮名为“Estou pronto — a necessidade está validada”（en："I'm ready
— the need is validated"），启用时的标题说明这次点击关闭什么以及 PO 会自行进入，成功提示也重复这一点。“Confirmar
necessidade validada”按钮被移除，连同客户端的 `handleValidateNecessity` 和
`validateNecessity`。这次点击也让 PO 成为 composer 的收件人——这是呼叫它的手势，与通过卡片接受相同（RN-631）。

## Consequences {#consequences}

**有利**

- 从三次点击到一次，不触动任何上限：接受 PO 不配置仓库（只有 Arquiteto 和 Dev Lead 会，RN-582），不合并也不 push。
- 验证仍然来自**一个人**，绝不来自 Criativo——0095 存在所要避免的反模式仍被避免。
- 接受的轨迹与卡片相同，所有现有消费者都能读懂，标记说明它来自哪次点击。

**不利，已声明**

- `necessity.validated` 不再指向它所验证的 brief：关联通过 `readinessEventId`，而 brief 是那次点击之后的下一个 `artifact.product_brief`。需要确切配对的人按顺序读日志。
- 验证在用户阅读摘要**之前**就被声明。这是负责人的决定；gate 是 `warn`，测量的是声明，而不是阅读。
- `POST .../agents/criativo/validate-necessity` 留在 api 中，界面上没有消费者：它是“Estou pronto”早于本 ADR 的会话的路径（那里接受卡片也继续存在，因为旧事件没有标记）。移除它会破坏 API 合约，留待没有旧会话使用它时再做。
- PO 在启动的那一刻没有人工点击就启动了。人在之前、在点击时已经决定，被记录的参与者是他。

## Alternatives considered {#alternatives-considered}

**新事件（`handoff.accepted_implicitly`）。** 被拒绝：见第 2 点——每个 `handoff.accepted` 的读者都得学习第二种类型。

**在点击的 POST 中接受，预先创建提议。** 被拒绝：提议携带 `product_brief` 作为工件，诞生于 Criativo 的轮次；提前创建需要改变 engine，并且要在没有证明其合理性的工件的情况下提供 handoff。

**让 engine 调用人工接受路由。** 被拒绝：人工路由要求已认证的用户，而 agent 启用 agent 正是内部路由描述所拒绝的。这里做决定的是 api，依据的是**人**写下的标记。

## References {#references}

- [ADR 0095](0095-gate-necessidade-validada.md)——本 ADR 修订的设计
- [ADR 0163](0163-o-clique-responde-ao-aceitar.md)——点击在接受时响应
- [ADR 0182](0182-ciclo-de-vida-do-handoff.md)——`superseded`，被保留
- [RN-406](../business-rules.md#rn-406)、[RN-657](../business-rules.md#rn-657)、
  [RN-658](../business-rules.md#rn-658)、[RN-633](../business-rules.md#rn-633)、
  [RN-635](../business-rules.md#rn-635)
- `apps/api/src/domain/sessions/estou-pronto.ts`
- `apps/api/src/application/use-cases/agents/confirm-readiness.use-case.ts`
- `apps/api/src/application/use-cases/agents/aceite-implicito-do-po.use-case.ts`
