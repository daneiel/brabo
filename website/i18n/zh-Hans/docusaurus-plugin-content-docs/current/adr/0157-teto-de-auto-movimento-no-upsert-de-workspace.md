---
traducao_de: 8b290c0ec233be29106b78a1b8943317bc25347c
---

# 0157 — workspace upsert 中的自我变动上限，以及原本是漏洞的自我晋升

## 状态 {#status}

**已接受。** 这是由 [ADR 0127](0127-tetos-de-rebaixamento-em-project-members.md) 开启、
[ADR 0156](0156-teto-de-auto-rebaixamento-na-remocao.md) 延续的这一系列中的**第三个**。它关闭了这两者以
书面形式声明留下的最后一个变动，并**修订**了 0127 中的一句话：自我**晋升**，它在“后果”中记录为保留的
能力，现在改为被拒绝。已接受的 ADR 不作编辑——本 ADR 引用它并说明改变了什么。对应 `BRB-002`，维护者
登记中的安全 P1。

## 背景 {#context}

前两个 ADR 关闭了 `project_members` 的三扇门——两扇写入、一扇删除——并且各自都白纸黑字地指出了仍然
开着的东西。0127：

> rebaixar o `owner` do workspace **no workspace**. O teto 1 é sobre
> `project_members`. `POST workspaces/:workspaceId/members` continua um upsert
> sem teto nenhum — mesma classe de defeito, escopo acima, não endereçado aqui.

以及 0156，重申道：

> **Estender o teto ao workspace.** `POST workspaces/:workspaceId/members` é um
> upsert sem teto nenhum, como o ADR 0127 já declarava (…) Escopo diferente,
> decisão separada.

**缺陷，经过测量。** `AddWorkspaceMemberUseCase` 是一个十二行的直通：`execute(workspaceId, userId,
role)` 调用 `workspaces.addMember`。**它不接收操作者**，而 controller
（`@Post(':workspaceId/members')`，`@RequireRole('owner')`）用纯请求体调用它，不带
`@CurrentUser()`——没有任何东西可以用来施加上限，与 0156 之前的删除路径一样。

这是**高一个作用域**的同一类缺陷，而且由于两个在项目中不存在的原因更为严重：

1. **没有更高的层级来接住下坠。** 在项目中，自我降级会让有效角色降到 workspace 的角色，而后者往往能
   托住它。在 workspace 中角色就是角色：一个把自己写成 `viewer` 的 `owner` 会失去整个 workspace，连同
   所有项目、按 [RN-060](../business-rules/custo.md#rn-060) 归其所有的 LLM 花费，以及邀请人来替补的
   能力本身；
2. **没有删除成员的路由可以从别的途径撤销。** `WorkspacesController` 没有删除成员的 `@Delete`——0156
   已经测量过这一点，并以此为理由没有在那个 PR 中扩展上限。撤销用的正是**这条**路由，而它要求的正是
   刚刚被放弃的 `owner`。无论通过界面还是 api，都没有回头路。

**后一半：自我晋升。** ADR 0127 在仍然可行的事情列表中写道：

> **auto-PROMOÇÃO.** Um `maintainer` pode se gravar como `owner` do projeto. Já
> era possível antes deste ADR e continua sendo; os tetos são sobre descer, e
> abrir a questão de subir aqui teria mudado, de passagem, uma capacidade que
> ninguém pediu para mudar.

有测试固定了这一点——*"subir o próprio papel não é rebaixamento e continua passando"*——一个 workspace
的 `maintainer` 把自己写成项目的 `owner`。在那个 PR 中不打开这个问题的决定在流程上是对的，而现在它被
打开了，答案是：**这是漏洞**。两半是同一个变动——一个人独自决定自己拥有什么权限——而向上的那一半是
两者中唯一**提升权限**的：0127 可以说它的上限与提权无关（“没有人获得原本没有的角色”），而对于自我
晋升，这句话是假的。一个 `maintainer` 没有人提拔就变成了项目的 `owner`，在一个有敏感项目的 workspace
中，这就是“可以被限制”与“无法被限制”之间的区别。

## 决策 {#decision}

**1. workspace 的 upsert 接收操作者并拒绝自我变动。**
`AddWorkspaceMemberUseCase.execute` 变为 `(workspaceId, atorId, alvoId, papel)`——与
`AddProjectMemberUseCase` 自 0127 起、`RemoveProjectMemberUseCase` 在 0156 中获得的顺序相同——
controller 传入 `@CurrentUser()`，在那里修改**自己**的角色返回 403。

**2. 上限不计数 owner。** 只在调用者是最后一个 owner 时才拒绝，会是显而易见的“安全”规则，而它
按 ADR 0127 的字面标准被拒绝：*"se enuncia numa cláusula, não tem número para envelhecer"*。计数会以
三种方式过时——它引入一次可能与写入失步的额外读取；它必须决定当第二个 owner 是服务账户或已离职的人时
怎么办，而 api 无法区分这些；它还会让路由的响应依赖于**其他**行的状态，于是同一个调用、同一个请求体，
今天通过、明天被拒，而调用者能控制的东西什么都没变。想离开自己角色的人去找另一个 `owner`，这与上限 2
在项目中已经产生的结果相同。

还有一个比美学更强的论据：**这个子句本身就产生了计数本要保证的不变量。** workspace 永远不会没有
`owner`，因为路由要求 `owner`，而唯一能移除最后一个 owner 的操作者就是他自己——那恰恰是被拒绝的变动。
数字不需要去数，因为规则的形式让它不可达。

**3. 上限 1 在这个作用域中没有对应物，而这种缺失是决定。** 它被认真考虑过，因为在这里——与 0156
的删除不同——这个变动**存在**：一个 `owner` 可以降级另一个 `owner`。拒绝的理由在于上限 1 是关于
**层级倒置**的规则，而倒置在这个作用域中不可能发生：

- 在项目中，`projectRole ?? workspaceRole` 让项目行**覆盖** workspace 行
  （[RN-471](../business-rules.md#rn-471)），因此一个 `maintainer` 能触及在他**之上**的人。0127 正是
  这样描述损害的：*"o dono perde o próprio projeto (…) restaurar exige `maintainer`, que o dono acabou
  de perder naquele escopo"*。行动者位于受害者**之下**；
- 在 workspace 中这不会发生。`@RequireRole('owner')` 是 `ROLE_ORDER` 的顶端，因此调用路由的人从不在
  它能触及的任何人之下。上限 1 的前提不存在——这不是被遗忘的对称，而是没有主体的规则。

而即便如此也加上对应物的代价会很高且不可逆：加上第 1 点的上限以及没有删除路由，`owner` 会变成一个
**吸收态**——没有人能通过 HTTP 离开它，既不能出于本人意愿，也不能由另一个 owner 动手。离职人员的
offboarding、所有权轮换以及纠正一次错误的邀请，都将需要直接写数据库。这正是 ADR 0127 生来要消除的那类
状态，换了个符号又组装了一遍。

因此，降级另一个 `owner` **保留**——并且可以通过同一条路由、由任何剩下的 owner 撤销，而项目中的那个
变动做不到这一点。

**4. 自我晋升在两条关联路由中都被关闭。** 上限 2 不再是“没有人降级自己”，而变成“没有人改动自己的
角色”，两个方向，在项目和 workspace 中皆然。重写**相同**的角色仍然通过：幂等的 upsert 不是变动，拒绝
它会弄坏有意重写角色的 `seed.ts`。

**5. 尺子不被复制：比较变成一个分类器。** 模块 `domain/iam/tetos-de-rebaixamento.ts` 获得
`autoMovimentoDoProprioPapel`，它返回**方向**（`'rebaixamento' | 'promocao' | null`）而不是布尔值。
选择它而不是单独的 `ehAutoPromocao`，是因为**调用方需要方向**：第 6 点的决定要求不同的消息，而两个
布尔谓词会让每个用例对同一个比较问两次，才能知道是哪一个作答。`ehAutoRebaixamento` **继续存在**，
变成对分类器的一次读取（`=== 'rebaixamento'`），行为逐字节不变。

它的存续是出于行为而不是兼容性的原因：委托给它的是 `remocaoEhAutoRebaixamento`，而**删除**只看到向下
的那一半。放宽它会让删除也拒绝自我晋升——而移除自己那条限制某人的项目行，恰恰是撤销上限 1 所阻止创建
的限制的方式，是 ADR 0156 第 3 点明确保护的良性变动。把一切统一起来，会顺手改变一扇本 ADR 没有打开的门。

**6. 消息按方向和作用域各自独立。** 共有四条，没有一条兼顾两件事：试图自我晋升的人不会收到
降级的句子（那不是他做的），撞上 workspace 上限的人也不会被叫去找一个 `maintainer`——在那里能撤销的
角色是 `owner`。这与 ADR 0156 第 5 点以及 [RN-470](../business-rules/custo.md#rn-470) 是同一种纪律：
不要因为两种状态共享同一个结果就把它们混为一谈。

**7. 操作者的角色来自仓库，而不是来自
`ResolveEffectiveRoleUseCase`。** 这与 0156 的选择相反，理由却与它给出的相同（“不为一次读取多加任何
依赖”）：在项目的用例中，引入 `ResolveEffectiveRoleUseCase` 是为了让操作者的角色不变成第二个手写的
`projectRole ?? workspaceRole` 组合；在 workspace 中**没有需要保护的组合**——`forWorkspace` **就是**
`workspaces.findMemberRole`——而这个用例手里已经有仓库，因为它正是用仓库来写入的。

**8. 403，在用例中，绝不在 `RolesGuard` 中。** 没有新意：guard 根据路由的 `@RequireRole` 授权**调用
者**，看不到请求体（`dto.role`）也看不到目标（`dto.userId`），而这个上限关乎操作者↔目标的关系。完整的
推理在 ADR 0127 中，这里不再重复。

**9. 晋升被施加，即使在这条路由上通过 HTTP 不可达。** 在 `@RequireRole('owner')` 下，操作者已经在
顶端，无处可升——在 workspace 作用域中，上限向上的一半是如今不会触发的机制。它仍然被加入，并且经过
测试，理由与上限 2 一直不设阈值的理由相同：用例不预设 guard，而在路由改变最低要求的那一天，保持正确的
是它。这与 [RN-514](../business-rules.md#rn-514) 按能力拒绝的设计相同，在有触发之前就已实现并测试。

## 本 ADR 明确拒绝的东西 {#o-que-este-adr-recusa-explicitamente}

- **计数 owner。** 见第 2 点。既不是“只有最后一个”，也不是“只在没有剩下其他活跃 owner 时”。这个
  子句没有会过时的数字，并且已经产生了永远不会有零个 owner 的不变量。
- **在这个作用域中设置 workspace `owner` 的上限。** 见第 3 点。这不是被遗忘的对称，也不是条件反射式
  的丢弃：它是关于层级倒置的规则，用在一个倒置不可能发生的路由上，加上它会让 `owner` 成为一个没有人能
  通过 HTTP 离开的状态。
- **workspace 成员的删除路由。** 它的缺失是本 ADR 背景的一部分（正因为它，自我降级才无法回头），而
  创建它会在关一扇门的同时开一扇新门——而这扇新门一诞生就需要同样的上限，外加对删除最后一个 owner 的
  判断，本 ADR 没有做这个判断的素材。如果有人要求，那是单独的决定。
- **把项目成员**删除**的上限放宽到晋升。** 见第 5 点。ADR 0156 以书面形式保护了这个变动，它逐字节
  保持不变。
- **改动 `ResolveEffectiveRoleUseCase.forProject`。** 连续第三个 ADR 说出这一点：
  `projectRole ?? workspaceRole` 在两个方向上保持不变。
- **界面上的 gate。** 没有界面：`POST /workspaces/:workspaceId/members` 在 `apps/web` 中没有调用者——
  已测量；唯一的出现是 `api-types.generated.ts` 中生成的类型。如今调用这条路由的是 `seed.ts`（通过
  用例，以 `owner` 为操作者）和直接集成。没有要调整的 toast，web 中没有任何一行改变。

## 后果 {#consequences}

**一个确实需要项目 `owner` 的合法 `maintainer`，开始依赖另一个人。** 这是第 4 点决定的直接代价，而且
并非假设：这正是拥有该路由所需角色的人，为下一项任务给自己所需角色的途径。它仍然可达——由项目的任何
其他 `maintainer`，以及 workspace 的任何 `owner`——而换来的是角色提升需要两个人。这与 ADR 0127 为向下
所做的交换相同，以同样的货币付同样的价格。

**ADR 0127 关于自我晋升的那句话变成错误的，而取代它的是本 ADR。** 它仍然写在那里，就像本仓库中
每个被取代的决定一样；读到它的人必须一路读到这里。这就是为什么索引中的那一行以及
`ehAutoRebaixamento` 的 docblock 都点名了这次修订。

**固定该权限的测试被反转了，而不是被删除**，名字保留了来源——*"subir o próprio papel era
permitido por ser 'não rebaixamento', e passa a ser 403 (ADR 0157)"*。与 0156 对删除的缺口测试所用的
形式相同。它是这项能力为何存在过的证据，不能扔掉。

**每次 workspace 关联多一次查询**，并且只有一次：操作者的角色。该路由用于管理，比较是纯函数，所以
代价与 0127 在项目中（两次）以及 0156 在删除中（两次）所接受的相同。

**签名改变了，而原本有两个调用者**——controller 和 `apps/api/src/db/seed.ts`，后者把 `owner.id`
作为操作者传入。在那里操作者与目标有意是不同的人，所以任何上限都不会被触及，seed 也不获得任何例外。
**`CreateWorkspaceUseCase` 不是调用者**，这是好事：它通过仓库、在创建事务内部把创建者写为 `owner`，这
是一次合法的自我晋升——产品中唯一的一次——如果有一天它被路由到这里，就会被拒绝。角色为空的子句旁边的
注释记录了这一点。

**路由的表面改变了，而没有改变任何成功响应**，记录在 `docs/security-surface.md` 中：`role:owner`
仍在表中，仍是 `RolesGuard` 施加的东西，但它不再是“这里谁可以做什么”的完整答案——这是这一族中第三条
获得这条注释的路由。

**仍然可行，点名如下：** 一个 `owner` 降级**另一个** `owner`（第 3 点，可通过同一条路由撤销）；在任何
作用域中降级调用者以外的任何人，这是一贯的能力；以及通过删除自己的项目行实现的自我**晋升**——删除限制
某人的那一行会提升其有效角色，而 ADR 0156 有意保护了这个变动。
