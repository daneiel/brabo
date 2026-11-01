---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0069 — 有条件地合并 handoff 的接受与执行的启用

- **状态：** 已接受
- **日期：** 2026-08-13
- **背景：** 用户的请求——当接受给 Dev Lead 的 handoff 的人已经拥有启用执行的角色时，把两次点击减少为一次
- **扩展：** [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)（作为可寻址 agent 的 Dev Lead）；`docs/business-rules.md` 中的 RN-135/RN-136/RN-137（handoff 卡片以及本决策开始串联的“Ativar execução”快捷方式）

## 背景 {#contexto}

`SessionPage.tsx` 中给 Dev Lead 的 handoff 卡片今天有两个按钮：
“Aceitar handoff e iniciar dev-lead”（要求 `developer`）和“Ativar execução”
（要求 `maintainer`，RN-137）。之所以是两次点击，是因为这是两种不同的**授权**，刻意不对齐：启用执行的人成为执行会话的 `session.createdBy`，而正是这个角色被 `ProposeActionUseCase`/`ResolveEffectiveRoleUseCase` 解析为此后 dev agent 提出的每一个 `git_commit`/`git_push`/`pr_open` 的**有效**角色（`ExecutionController#activate`，`RequireRole('maintainer')`）。以 `developer` 启用会产生无法开 PR 的 dev agent——这是保持两条路由有不同要求的原始理由，而它依然完全成立。

请求不是降低这一要求。而是当屏幕前的人**已经**拥有 `maintainer`/`owner`——因此本来就可以依次点击两个按钮而不碰到任何 403——第二次点击并不保护任何东西：它只是重复一个用户角色早已授权的决定。对只有 `developer` 的人来说，第二次点击仍是表示“是的，我希望**这个**成为执行会话”的唯一方式——它不能消失，因为他即使点击也永远无法启用。

## 决策 {#decisão}

**当 `toAgent === 'dev-lead'` **且**接受者的**有效**角色——从已经授权“Auto mode”（RN-153）以及 Aprovações/Configurações 界面的**同一个** `useCurrentWorkspaceWithRole()` 读取——是 `owner` 或 `maintainer` 时，`handleAcceptHandoff`（SessionPage.tsx）自动串联 `activateExecution`。对于 `developer`（或尚未解析的角色），当前流程**保持不变**：接受不启用任何东西，只要卡片还在屏幕上，“Ativar execução”就作为第二个按钮保留。**

```ts
if (toAgent === 'dev-lead' && podeFundirHandoffComExecucao) {
  await handleActivateExecution();
}
```

决策之中的三个决策：

1. **检查只在**客户端**——后端不变。**
   `POST .../execution/activate` 继续一如既往地要求 `maintainer`。合并纯粹是 UI 需要**多少次**点击才能到达一个本就可达的同一状态的问题；一个检查网络并直接调用该路由的 `developer` 会继续收到 403，与今天完全相同。没有新的授权面——只是一个只在结果早已确定时才触发的快捷方式。
2. **`handleActivateExecution` 不是被复制，而是被**复用**。** “Ativar execução”按钮已经调用的同一个函数（RN-137，以 `sessionId` 作为 `originSessionId`）——它已经用 `mensagemDaApi` 处理自己的错误，从不重新抛出。这很重要：如果合并触发了而后端因某个迟到的原因拒绝（例如在接受与启用之间变得不一致的会话），`handleAcceptHandoff` 的 `catch` **不**应该显示“Não foi possível aceitar o handoff”——接受早已成功。复用这个已经吞掉自身错误（有自己的 toast）的函数，正是在不重复错误处理的情况下保证消息正确的方式。
3. **角色从**WORKSPACE** 读取，而不是从新的项目端点。**
   与 `ProjectApprovalsTab.tsx`/
   `ProjectSettingsTab.tsx`/本界面的“Auto mode”已使用的近似相同：今天客户端没有已解析的**项目**角色，因此“我是 maintainer 吗？”这个问题在这次改动之前早已这样回答——这不是新来源，而是早已授权显示其他等价控件的那个来源。

## 考虑过并放弃的备选方案 {#alternativas-consideradas-e-descartadas}

- **总是合并，让单次点击对 `developer` 以 403 失败。**
  放弃：卡片会只有一个按钮，而对一半的角色来说，它会在一次已成功的接受背后发出一个**注定**失败的调用——用户会在已经成功接受 handoff 之后看到“Papel insuficiente”，一条与实际上成功了的动作捆绑在一起、令人困惑的消息。比为需要的人保留两个按钮更糟的 UX。
- **询问（“Deseja também ativar a execução?”）而不是静默串联。** 按用户的决定放弃：对 `maintainer`/`owner` 而言，今天的两次点击**已经**是明确且冗余的同意——第二次确认并不能保护一个此人已经做了两次的决定（接受 handoff，然后点击启用）。再问一次是没有安全收益的摩擦。
- **把 `POST .../execution/activate` 的要求降到 `developer`，从根上消除区分。** 放弃——这正是 RN-137 早已决定**不**做的事，因为它会悄悄颠倒 dev agent 所开 PR 的**有效**角色解析（每当启用者是 `developer` 时，每个 PR 都会从 `auto_approve` 变成 `require_approval`，而没有任何人明确决定过）。本次合并不重新打开这个问题——它只是为已经拥有两种角色的人省去一次冗余点击。
- **用**项目**（而不是 workspace）的有效角色来决定合并。** 因今天不存在而放弃：客户端没有返回按**项目**有效角色的路由（最接近的是 ADR 0064 的 `agent`/`area` 作用域，那是关于 LLM 模型的，不是 RBAC）。只为这个 UX 决定引入这样的路由是错误的原因——`useCurrentWorkspaceWithRole()` 已经是同一界面所有等价位置所用的近似。

## 后果 {#consequências}

- **`developer` 得不到这个快捷方式——这是有意的，而不是缺口。** 他继续需要一位 `maintainer`/`owner` 在之后启用执行，与今天完全一样。没有人失去能力：原本只接受 handoff 的人继续接受。
- **后端合约零变化。** `ExecutionController#activate` 继续保持 `RequireRole('maintainer')` 不变；这完全是 `apps/web` 的决定。
- **少一次点击，就能更快地让一个执行会话到达正确的 `originSessionId`。** RN-135（当执行经由这条路径启动时，聊天会话关闭）对 `maintainer`/`owner` 来说在接受的同一瞬间发生——不再有两次点击之间来源会话保持 `active` 等待第二次点击的窗口。
- **“Ativar execução”按钮没有从卡片上移除。** 对拥有该角色的人它是冗余的（合并已经完成了工作），对没有该角色的人它不起作用（仍然 403），但按角色有条件地移除它会多出一个需要测试的状态面而没有明确收益——一旦 handoff 不再处于 `offered`（已接受），整个卡片就会消失，因此按钮“残留”可见且无效的窗口，实际上就是点击到 handoff 查询失效之间的时间——而不是功能上的待办。
