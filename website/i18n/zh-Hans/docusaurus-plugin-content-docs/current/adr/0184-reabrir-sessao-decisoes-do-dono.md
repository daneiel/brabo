---
traducao_de: dc3ec6a48c32909b8b62605552904ef7b42672b3
---

# ADR 0184 — 重新打开会话：所有者的三个决定，`developer` 即可重新打开

## 状态 {#status}

**已接受。** 2026-09-30（AT-337，第 32 轮）。基于 [ADR 0183](0183-reabrir-sessao-encerrada.md)，后者**不**被编辑：它把三项决定标为**临时、保守、等待所有者**的默认值，本 ADR 记录所有者对这三项的答复。

## 背景 {#context}

ADR 0183 为会话的终止状态开了一个出口——重新打开，经由专用路由（`POST projects/:projectId/sessions/:sessionId/reopen`）——并留下三个悬而未决的选择，声明为临时：

1. 最低角色，定为 `maintainer`，比结束会话的通用状态转换（`developer`）高一级；
2. 没有期限——每个已结束的会话永远可以重新打开；
3. 以 409 `sessao_com_execucao` 拒绝带有 `execution.activated` 的会话，以免 `findActiveExecutionSession`（RN-139）被引向一个旧的执行会话。

所有者于 2026-09-30 对这三项作出了决定。

## 决策 {#decision}

1. **最低角色 `developer`。** 与经由通用状态转换结束会话的角色相同：能宣告会话结束的人，也能把它带回来。0183 提高一级的理由（重新开启 token 花费）站不住脚，因为同一个 `developer` 本来就能开新会话并在其中对话，花同样的 token。`viewer` 仍被拒绝（403）。改动正是 0183 预见的：路由的 `@RequireRole` 和会话界面的 `roleAtLeast`。
2. **没有期限——已确认。** 不与 `closed_at` 做任何比较。
3. **带 `execution.activated` 的会话仍被拒绝——已确认。** 409 `sessao_com_execucao`；要重新执行，路径仍是开一个新会话并在其中激活执行。

0183 的其他内容都不变：专用转换（`canReopen`）、事件 `session.reopened`、在事务之前调用的 engine，以及忽略已被撤销的关闭的 `SessionLifecycleWorker`。

## 后果 {#consequences}

- 三项决定不再是临时的。[RN-650](../business-rules.md#rn-650) 改为写 `developer`，[RN-649](../business-rules.md#rn-649) 在两项已确认的决定中引用本 ADR。
- `docs/security-surface.md` 把该路由列为 `role:developer`；测试 `route-surface.spec.ts` 把表格与真实注解做比较。
- 界面把文字原因从 “exige maintainer” 改为 “exige developer”（键 `ativacao.reabrirExigeDeveloper`，两种语言）。
- 仍未决定、也不在此决定的：重新打开后 Psicólogo 的第二次自动分析（0183 的 Consequences）。
