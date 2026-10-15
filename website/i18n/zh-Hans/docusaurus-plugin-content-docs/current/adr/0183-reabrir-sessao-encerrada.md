---
traducao_de: 3b61c3e15ad44f6d269a4dc6745c50bb636a42b7
---

# 0183 — 已结束的会话可以重新打开：终止状态的专属出口，通向 `active`，带新事件

## 状态 {#status}

**Accepted.** 2026-09-30（AT-071，故事 HS-048，史诗 EP-027，第 30 轮）。
修订 [RN-001](../business-rules.md#rn-001) 的一部分——*"terminal states have
no exit"*——并与 [ADR 0061](0061-tipo-da-sessao-na-criacao.md) 共存（会话有不可变的 `kind`，执行状态是事件 `execution.activated`）。两者都不被编辑：**向状态机增加一个转换**，并声明它不改变什么。

本 ADR 的三项决定是**临时、保守、等待负责人的默认值**——最低角色、没有期限以及拒绝有执行的会话。它们在下文中如此标注，修改其中任何一项都不需要新的 ADR：只需替换所指的那一行以及引用它的 RN。

## Context {#context}

在 `origin/dev`（`79e6b1209f`）上测量，基于 AT-071 的调研
（2026-09-13，`b61bc49cd`）：

- `session-state-machine.ts` 声明了 `closed: []` 和 `closed_abnormally: []`，并带有注释 *"Estados terminais: nenhuma transição sai deles"*，测试固定了这一点。在 api、engine、web、ADR 和 RN 中都没有会话的 `reopen`/`reabrir`/`retomar`。
- 真实案例（`exp001`，会话 `fe57b393…`）：因 `heartbeat_timeout` 而 `closed`，92 个事件，十一个 `artifact.business_rule`，五对结构化问题。整个对话都保存在 event log 中（RN-002），工件也是事件，但会话没有办法重新接受对话——自 [RN-581](../business-rules.md#rn-581) 起，api 会以 409 `sessao_encerrada` 拒绝终止会话中的所有对话事件。
- “开一个新会话”并不能替代：启用一个 agent 需要**本会话中**有 `accepted` 的 handoff（`agent-activation.ts`），PO 的 kickoff 读取**本会话的** brief 和规则。复制到新会话会重复工件并打断 Criativo → PO 的链条。
- 两个依赖都已关闭：AT-072（RN-581——heartbeat 识别进行中的对话，上限 8h）和 AT-073（RN-580——重建读取整个对话）。在关闭时停止的对话型 agent 会在第一条消息时通过幂等的 `start_agent` 回来，并从日志重建历史。
- `session.closed` 不是 `session_events` 的一行：它是 outbox。会话**何时**以及**为何**关闭的唯一持久记录，是 `sessions` 行中的 `closed_at` 和 `termination_reason` 列。

## Decision {#decision}

1. **一个新转换，只从终止状态出发，只通向 `active`。**
   `session-state-machine.ts` 中的 `canReopen`/`assertReopen`，与
   `canTransition` **分开**：`ALLOWED_TRANSITIONS` 继续保持 `closed: []` 和
   `closed_abnormally: []`，因此通用路由
   `POST .../sessions/:id/transition` 对 `closed → active` 继续返回 409。**`closing → active` 无论经由任何路径仍被禁止**——shutdown drain 中的接管依赖于此（`shutdown.ex`）。而 `created`/`active` 的会话不会“重新打开”。

2. **专属路由，`POST projects/:projectId/sessions/:sessionId/reopen`**，200，用例 `ReopenSessionUseCase`。与
   `TransitionSessionUseCase.activate` 设计相同：engine 在事务**之前**被调用（`startSession`），它的失败会让会话保持原来的结束状态；在锁下一切都会重新验证。

3. **改变的是状态，之前的关闭变成一个**新**事件。** `sessions` 的行变为 `active`，`closed_at` 和 `termination_reason` 被清空。在**同一个** `seq` 计数器中（RN-002），经由一贯的漏斗
   （`AppendSessionEventUseCase`），写入 `session.reopened`，参与者为 `user`（重新打开者），payload 为 `{from, to, closedAt, terminationReason}`——即列中丢失内容的副本。没有任何东西被编辑、删除或重新编号；`kind` 不被触碰（RN-097）。

4. **临时默认值——最低角色 `maintainer`。** 比通用转换（`developer`）高一级：重新打开会在一个有人认定已结束的会话中重新开启 token 花费。降为 `developer` 只需替换路由的 `@RequireRole` 和界面的 `roleAtLeast`。

5. **临时默认值——没有期限。** 每个已结束的会话永远都可以重新打开。期限（例如 30 天）就是在用例中与 `closed_at` 做一次比较。

6. **临时默认值——有 `execution.activated` 的会话**不能**重新打开。** 409
   `sessao_com_execucao`。`findActiveExecutionSession` 选择带有 `execution.activated` 的最新 `active` 会话（RN-139）：重新打开一个旧的执行会话会把它送回这个查找，下一次重新启用可能会把 dev agent 引向它。“重新执行”的声明路径仍然是开一个新会话并在其中启用执行（“nova execução”卡片）。

7. **Engine：已被重新打开撤销的关闭不会停止任何东西。**
   `SessionLifecycleWorker` 读取会话的 `status`
   （`ProjectSession.status/1`，直接读取 api 的表，就像 Anamnese 早已做的那样），如果它不再是终止状态，就记录日志并忽略该任务——一个延迟或重试中的任务会推倒重新打开的会话的进程和对话型 agent。没有该行时，关闭照常进行。

8. **Web。** 在已结束会话的横幅中，“Reabrir sessão”附带一句说明会恢复什么；低于 `maintainer` 时不可用（`roleAtLeast` 基于 **workspace** 的角色，即界面上已声明的 RN-471 缺口），原因以**文字**说明。api 的拒绝（执行、403）变成带有其原话的 toast。

## Consequences {#consequences}

- **RN-001 在字面上不再成立**（"terminal states have no exit"）：通过专属路由，有**一个**出口。RN-649 是新规则的地址；RN-001 不被编辑，由新规则指向它。
- **Psicólogo 的第二次分析：在负责人决定之前被**阻塞**，**无需新代码。第二次关闭会再次发布 `session.closed`，而当已存在该会话的 `current` 分析时，`PsychologistWorker` 会在自动路径上短路（`alreadyAnalyzed`）。重新打开后的对话**没有**自动分析；手动重新处理（`triggeredBy:
  "manual"`）仍然可用并取代之前的分析。如果负责人决定第二次分析是正当的（对话增长了），改动在 worker 中。今天 Psicólogo 处于暂停状态（`PSYCHOLOGIST_ENABLED=false`）。
- **图谱的第二次汇总是正当且幂等的**：`Interacao` 以 `sessionId` 为键，`seq` 窗口单调扩展
  （`RecordInteractionUseCase`）。
- **按会话的预算和测量开始有不止一个活跃区间。** 用 `closed_at - created_at` 计算的时长指标对重新打开的会话是在撒谎；之前的区间在 `session.reopened` 的 payload 中。此处未测量；现有脚本均未修改。
- **重新打开后的 heartbeat**：执行重新打开的界面是打开的，并连接 heartbeat；没有标签页时，heartbeat 会再次关闭它（RN-064/RN-581，进行中的对话最多保持 8h）。这是 `active` 会话一贯的行为。
- **已知的竞争窗口**：如果事务在 engine 启动 `SessionServer` **之后**失败（并发重新打开，被锁下的重新验证拒绝），就会留下一个属于仍然结束的会话的进程——这与 `TransitionSessionUseCase.activate` 已经付出的代价相同。没有客户端的 heartbeat 会结束它，报告落到一个终止会话中。
- **卡在已结束会话中的 `offered` handoff 在重新打开时重新可以被接受**（RN-581 只按状态拒绝接受）。[ADR 0182](0182-ciclo-de-vida-do-handoff.md) 的生命周期继续有效：如果目标在本会话关闭期间于另一会话中被启用，该提议已经是 `superseded`。
- **刻意未触碰**：`closed_abnormally` 中的“Encerrar”按钮（AT-155）。
