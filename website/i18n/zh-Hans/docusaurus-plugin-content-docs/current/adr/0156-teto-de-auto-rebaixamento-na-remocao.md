---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0156 — 自我降级上限同样适用于移除项目成员

## 状态 {#status}

**Accepted.** 关闭
[ADR 0127](0127-tetos-de-rebaixamento-em-project-members.md) 以书面形式声明并在测试中固定下来的缺口。它不撤销也不修订那份 ADR：那份 ADR 的两个上限保持原样，改变的是评估上限 2 的**入口**集合。对应维护者登记簿中的 `BRB-001`，安全 P1。

## 背景 {#context}

ADR 0127 在 `project_members` 的**写入**路径上设置了两个上限——没有人能降级 workspace 的 `owner`，没有人能降级自己——并刻意选择不覆盖第三种动作，把原因和代价记录在“仍然可能，且有名称”一节：

> **auto-rebaixamento pela REMOÇÃO.** `RemoveProjectMemberUseCase` NÃO ganhou
> teto (…) A premissa de que "a remoção é sempre benigna" é falsa, e fica
> escrita aqui para não ser redescoberta. Os dois casos estão FIXADOS em teste
> (…), inclusive o que segue aberto, para a próxima pessoa saber que é decisão
> e não esquecimento. Fechá-lo custa a assinatura de
> `RemoveProjectMemberUseCase.execute`, que hoje é chamada por
> `list-projects-and-members.use-case.spec.ts` com dois argumentos.

本 ADR 就是那个“下一个人”，而预计的代价恰好被兑现。

**缺陷，经测量。** `RemoveProjectMemberUseCase.execute` 接收
`(projectId, userId)`——**不接收参与者**——而 controller
（`@Delete(':projectId/members/:userId')`，`@RequireRole('maintainer')`）只用两个路由参数调用，没有 `@CurrentUser()`。由于
`ResolveEffectiveRoleUseCase.forProject` 是 `projectRole ?? workspaceRole`
（[RN-471](../business-rules.md#rn-471)），删除项目行并不会删除一个角色：它把有效角色**换成**第二项。当 workspace 角色更低时，净效果就是上限 2 本要阻止的降级，而且同样不可逆——恢复需要 `POST :projectId/members`，而它要求的正是刚刚放弃的 `maintainer`。如果完全没有 workspace 角色，则降为**完全**无访问。

自 ADR 0127 起这个情况就已在测试中复现，测试名说明了它记录的内容：*"e a remoção SEGUE podendo rebaixar quem a chamou, quando o
workspace não segura — lacuna declarada no ADR 0127"*。一个权限来自项目行、在 workspace 中为 `viewer` 的 `maintainer`，移除自己的行，就降为 `viewer`，且无法通过界面恢复。

**为什么是同一条规则而不是新规则。** 上限 2 比较的是**今天**的有效角色与**之后**的有效角色，从来不需要知道后者是经由哪条路由到达的。在 `add` 中，之后的角色是请求体中的；在移除中，是 workspace 的。为第二个入口再写一把尺子，将是对一个已经住在 `domain/iam/tetos-de-rebaixamento.ts` 中的比较的第四份拷贝——而尺子的拷贝正是本仓库在多处追打的失败模式（生成的区域列表、两端同名的 `roleAtLeast`、复用而非重写的 `caminhoDeWorkspaceLocalValido`）。

## 决策 {#decision}

**1. 移除开始接收参与者，并拒绝净自我降级。** `RemoveProjectMemberUseCase.execute` 变为
`(projectId, atorId, alvoId)`——与 `AddProjectMemberUseCase` 相同的顺序——当移除调用者**自己**的行会让其角色低于今天时，抛出 `ForbiddenException`（403）。controller 传入 `@CurrentUser()`，就像 `add` 早已做的那样。

**2. 规则就是复用的上限 2，用 workspace 角色代替请求的角色。** 在同一个领域模块中加入 `remocaoEhAutoRebaixamento`，它不重新实现任何比较：它委托给 `ehAutoRebaixamento`，传入
`papelPedidoNoProjeto: papelDoAtorNoWorkspace`。它之所以存在，而不是让用例直接调用 `ehAutoRebaixamento`，是因为**一个**另一函数的签名无法表达的情况——参与者没有 workspace 角色，此时之后的角色是“无”，它不是一个 `Role`。这种情况是最大程度的降级，予以拒绝。

**3. 上限 1 没有对应项，这种缺席是决定。** 移除 workspace `owner` 的项目行只可能**提升**其有效角色或保持不变：`owner` 是 `ROLE_ORDER` 的顶端，因此不存在会让下降成为下降的 workspace 角色。这一动作不只是无害，它还是撤销 ADR 0127 上限 1 阻止创建的那种限制的**唯一**方式——一个在某项目中已经有 `viewer` 行的 workspace `owner`（在那份 ADR 之前写入，或通过直接写数据库）恰恰就是这样重新访问自己的项目。在那里设上限只会拒绝无害的动作，并把 ADR 0127 生来要消除的状态变为永久。这种缺席写在代码中，就在函数旁边，并在测试中固定。

**4. 没有阈值，与上限 2 相同。** 拒绝的是“自己”，而不是“低于 `maintainer`”，ADR 0127 声明的代价也随之而来：从项目 `owner` 降为 workspace `maintainer` 的自我移除是可逆的，**同样**被拒绝。它仍可由另一位 `maintainer` 完成。这种情况以前能通过，现在被拒绝——这是本 ADR 对一个无害动作引入的唯一行为变化，也是 ADR 0127 已经为 `add` 接受的同一种取舍：一个不带数字的条款，对比一个每次都需要解释的例外。

**5. 消息是**专属**的，而不是 `add` 的。** 点击“移除”的人并没有要求改变任何角色，一句谈论“降级自己”的话解释不了发生了什么。`MENSAGEM_TETO_AUTO_REBAIXAMENTO_POR_REMOCAO` 说明机制：没有项目行，角色会降为 workspace 的角色，恢复需要被放弃的那个角色。

**6. OpenAPI 描述开始描述代码。** 该路由的描述此前只说“在 workspace 中有角色的人通过继承继续看到项目”——只说对了一半，而缺失的那一半正是本决策的原因：继承来的角色可能**低于**该行。`openapi.json` 和 `api-types.generated.ts` 由生成器产出。

## 本 ADR 明确拒绝的 {#o-que-este-adr-recusa-explicitamente}

- **移除时的 workspace `owner` 上限。** 见第 3 点。这不是被遗忘的对称：不存在会降级 workspace `owner` 的移除。
- **第二把角色比较尺子。** 见第 2 点。比较仍然只住在一个地方。
- **改动 `ResolveEffectiveRoleUseCase.forProject`。** `projectRole ??
  workspaceRole` 逐字节保持，双向——这是 ADR 0127 拒绝消除的能力，这里没有任何东西重新打开这个问题。
- **把上限扩展到 workspace。** `POST workspaces/:workspaceId/members` 是一个完全没有上限的 upsert，ADR 0127 已经声明过——而且那里根本不存在移除：`WorkspacesController` 没有成员的 `@Delete`（已测量），所以在该作用域内等价动作无法通过 HTTP 达到。不同的作用域，单独的决定。
- **阻止移除**其他人**，即使其角色下降。** 这是一贯的合法能力——与在敏感项目中把 `developer` 限制为 `viewer` 是同一种——对移除和写入同样适用。
- **界面上的 gate。** 见“后果”。

## 后果 {#consequences}

**一个无害的动作也一并被拒绝，这是已接受的代价。** 在项目中为 `owner`、在 workspace 中为 `maintainer` 的人的自我移除，原本被允许，现在变为 403。它可由另一位 `maintainer` 撤销，原先固定这一许可的测试改为固定拒绝，测试名说明这是无阈值上限的代价。处于这种情况下想退出列表的人请另一位 `maintainer` 操作——与上限 2 通过 `add` 已经产生的结果相同。

**界面仍然提供 api 会拒绝的按钮，而拒绝会显示出来。**
`MembersSection.handleRemove` 已经有带 `mensagemDaApi` 的 `try/catch`
（[RN-471](../business-rules.md#rn-471)），因此 api 的那句话无需一行 web 代码就能到达 toast。与上限 1 不同，这个 gate **可以**在客户端计算——`userIdDaSessao()` 和有效角色都在那里——但只计算它会产生一个对一种拒绝坦诚、对另一种沉默的按钮，而这正是 ADR 0127 拒绝的半个 gate。留给解决整个问题的 web PR。

**每次移除多两次查询**，即使目标是别人：参与者的 `forProject`（会重做 `findById`）和 `forWorkspace`。这是 ADR 0127 在 `add` 中已经接受的代价，在一条管理路由上；而替代方案——在读取前加一个 `if (atorId === alvoId)`——会在用例中重复纯函数本应包含的条款。

**签名变了，有两个测试调用它。** `execute` 现在有三个参数；`list-projects-and-members.use-case.spec.ts` 和
`tetos-de-rebaixamento.use-case.spec.ts` 已更新。没有其他调用者：构造函数增加了 `ResolveEffectiveRoleUseCase`，它早已在 `iam-use-cases.module.ts` 中注册。

**缺口测试变成了上限测试。** ADR 0127 留下的固定该漏洞的块（"a remoção SEGUE podendo rebaixar quem a chamou"）被**反转**而不是删除，名称保留了来源。这是本仓库已在使用的方式，以免丢失某样东西为何存在的证据。

**仍然可能，且有名称：** 通过移除他人的行来降级他人；自我**提升**（未改变）；以及整个 workspace 作用域，其成员 `POST` 仍然没有上限。
