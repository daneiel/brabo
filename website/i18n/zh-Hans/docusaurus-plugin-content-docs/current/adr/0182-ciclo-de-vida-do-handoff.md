---
traducao_de: bc37a486a802cb4f98fc31c0b53619d72c5a77ce
---

# 0182 — handoff 提议获得生命周期：每个目标一个待处理，以及 `superseded`

## 状态 {#status}

**Accepted.** 2026-09-30（AT-291 和 AT-292，故事 HS-075，第 29 轮；按负责人的决定，vault 中的 AT-273 并入 AT-292）。基于
[ADR 0038](0038-hierarquia-de-agentes.md)（外部 handoff 只指向区域 lead 或没有区域的 agent，在 `CreateHandoffUseCase` 中验证）以及
[ADR 0090](0090-qa-estrategia-e-appsec-segundo-momento.md)（AppSec 把威胁模型交付给三个目标）。不编辑它们：**为 `handoffs` 表增加一个状态和一个不变式**。

## Context {#context}

2026-09-30 在 `dev` 的代码上测量：

- `HandoffStatus` 声明了 `offered | accepted | completed | rejected`，但只有 `offered` 和 `accepted` 被写入。没有过期、取代或去重。
- `CreateHandoffUseCase` 每次调用都插入新行。任何重复都会变成新提议：agent 重复 `offer_handoff`、Criativo 重新确认就绪、Staff 交回另一份 RFC。
- `OfferInfraHandoffUseCase` 不是幂等的。在“arquitetura pronta”上双击，或两个标签页，会把里程碑记录两次，并向 engine 请求两次 Arquiteto 的收尾轮次和两个给 Dev Lead 的提议——屏幕上出现 2× Infra 和 2× Dev Lead。
- AppSec（`criar_handoffs_appsec/3`）对每个带 `run_design` 的故事向相同的三个目标（`arquiteto`、`dev-lead`、`infra`）创建三个提议。N 个故事，就有 3N 个待处理提议堆积。
- 给一个早已活跃的 agent 的提议会永远保持 `offered`，界面把它显示为可操作：接受会重新启用早已在运行的那个。

## Decision {#decision}

1. **新状态 `superseded`**（迁移 `0064`，只有 `ALTER TYPE … ADD VALUE`）。不再是当前提议的那个在**行**上改变状态，就像接受早已做的那样，并获得一个带 `handoffId`、`toAgent`、`motivo`（`agente_ativado` | `nova_oferta`）和 `substitutaId` 的 `handoff.superseded` 事件。绝不 UPDATE 事件：宣告提议的 `handoff.offered` 保持原样。该事件落在**旧**提议的会话中，参与者为 `system`
   `handoff-lifecycle`，即使在已结束的会话中也会写入（它不是对话，RN-581）。

2. **每个（项目，目标）最多**一个** `offered` 提议。** 决定是纯函数
   （`decidirOferta`，`domain/sessions/ciclo-de-vida-do-handoff.ts`）：
   - 没有待处理的，创建；
   - 在**同一**会话中有待处理的，且新提议没有带来新工件（`null` 或相同）→ 返回现有的（`desfecho: ja_oferecido`），没有新行也没有事件。这就是双击、两个标签页、agent 重复调用工具；
   - 任何其他情况（**新**工件，或待处理的在另一会话中）→ 创建新的并**取代**待处理的（`desfecho: substituiu_oferta`）。

   **为什么取代，而不是总是返回现有的。** 卡片要求两个选项，并倾向于不丢失新工件。在工件变化时返回旧的，会让重写的 brief（或 Staff 的新 RFC）没有承载它的提议。返回**另一个**会话中的待处理提议，会让请求者在他所在的对话中没有任何可接受的东西——而如果另一个会话已经关闭，就在任何地方都没有可接受的东西（RN-581 拒绝在已结束会话中接受）。返回只在不丢失任何东西时才成立：同一会话、同一工件。

3. **通过**事务级**咨询锁实现并发**
   （`pg_advisory_xact_lock(hashtextextended('handoff:<projeto>:<destino>'))`），而不是部分唯一索引。索引需要在创建它**之前**、在同一迁移中清理已经存在的重复——而枚举的新值不能在创建它的事务中使用。通过标记 `rejected` 来清理是撒谎；不带事件地清理则违反规则本身。有了锁，之前的重复会在该目标的下一次提议或启用时收敛，**带**事件。锁按目标而不是按项目：给不同目标的提议彼此不等待。

4. **给项目中已**活跃** agent 的提议会被拒绝**，409 `agente_ja_ativo`，没有新行也没有事件。活跃 = 在项目的某个**非**终止会话中有针对它的 `agent.activated`——即界面的读取方式（`session-handoffs.ts`）从会话扩展到项目；已结束的会话对其对话型 agent 来说已关闭。`message` 是模型所读的文本（RN-163）：工具 `offer_handoff` 原样转发它，`FalhaDeTurno.origem/1` 把它归类为 `politica`，而不是 `codigo`。

5. **启用 agent 会取代给它的待处理提议**，在项目的**任何**会话中，经由三条启用路径：接受（经过 `ActivateAgentUseCase`；被接受的那个已经是 `accepted`，不被触碰）、直接启用以及执行的启用（按 `dev-<modulo>`）。

6. **`OfferInfraHandoffUseCase` 幂等。** 每个已有待处理提议或已经活跃的目标（`infra`、`dev-lead`）不会被再次触发；两者都如此时，不写入任何东西，也不向 engine 请求任何东西（`desfecho: ja_oferecido`，`jaAtendidos` 说明原因）。只触发缺少的部分：Infra 活跃而 Dev Lead 没有提议时，只请求 Dev Lead 的那个，不需要 Arquiteto 的轮次。

7. **AppSec 只向尚未收到也未活跃的目标提供（RN-636）。** engine 以 `seAusente` 模式询问 api（`create_handoff_if_absent/5`），而不是事先查询：从这里提出的询问会与另一个提议竞争，而 api 在目标的锁下作答。“已提供”和“已活跃”不会变成 `agent.error`；真正的失败继续按目标叙述（RN-116）。

## Consequences {#consequences}

- **界面多了一个状态。** `GET .../handoffs` 返回 `superseded`，创建路由返回 `desfecho`。web 的类型在此重新生成；界面**如何处理**新状态（不再作为可操作提供、从项目读取“活跃”）属于 `handoff-web` lane（AT-293..295）。
- **在“arquitetura pronta”上**同一瞬间**两次点击的竞争仍会把里程碑 `architecture.readiness_confirmed` 记录两次。** 没有提议重复（锁），Arquiteto 的第二个轮次被 engine 以 409 `turno_em_andamento` 拒绝（[ADR 0163](0163-o-clique-responde-ao-aceitar.md)）。连事件也关闭需要在调用 engine 期间持有锁，那是事务中的网络——被拒绝。
- **给活跃 agent 的新提议不再存在，“通过提议重新启用”也随之消失。** 在 PO 已活跃时重写 brief 的人会收到带名称的拒绝；工件留在日志中，对话与活跃的 agent 继续。需要新一轮的人要关闭它所活跃的那个会话。
- **当第一个故事的威胁模型提议仍待处理时，第二个故事的提议不会诞生**（RN-636）。工件留在日志中；目标在被启用时会读取项目的威胁模型。待处理的提议不会指向最新的——这是不取代一个仍在等待接受的提议的代价。
- **执行的启用会取代给 `dev-<modulo>` 的提议，而这些今天并不会诞生**（子 agent 不接收外部 handoff，ADR 0038）。这个调用的存在是为了让规则在层级改变的那天生效，代价是每个模块一次读取。
- **之前的重复不由迁移清理。** 它们在给同一目标的下一次提议或启用时收敛。一个再也不会收到提议或启用的目标会保留它的 `offered`，就像今天这样。
