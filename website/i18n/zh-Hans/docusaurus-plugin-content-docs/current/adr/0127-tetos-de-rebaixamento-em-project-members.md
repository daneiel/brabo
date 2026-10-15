---
traducao_de: 30cd83cf109ffd8ec272c1821c14a1288b65e4f1
---

# ADR 0127 — `project_members` 中的两道降级上限，覆盖关系保留

## 背景 {#context}

`ResolveEffectiveRoleUseCase.forProject` 自 Fase 1 起就是 `projectRole ?? workspaceRole`：只要 `project_members` 中有一行，它就**胜出**，不与 workspace 角色比较。覆盖在**两个**方向上都成立——可以升，也可以降。

这是在审查 #444（它关闭了成员部分的角色 gate）时发现的，并记录在 [RN-471](../business-rules.md#rn-471)。这一发现有两半。第一半是文档层面的：**四**个地方承诺的恰恰相反——"the EFFECTIVE role is the higher of this one and what the person already has in the workspace"，"associating someone as `viewer` here doesn't downgrade a workspace `owner`"——三处 OpenAPI 描述和 `apps/web/src/lib/roles.ts` 中的一条注释。RN-471 修正了 web 那一处（它最糟：位于导出 `roleAtLeast` 和 `ROLE_ORDER` 的模块，也就是这一类问题的下一个人最先打开的代码），并把 api 那三处**声明**为未修正，因为那是契约变更。

第二半没有被任何地方守住，这也是本 ADR 的原因：由于覆盖向下也成立，`AddProjectMemberUseCase` 只是对仓储 upsert 的一行透传，而 `RemoveProjectMemberUseCase` 只检查项目是否存在。两者都没有看目标**是谁**，也没有看操作者与目标之间的关系。今天任何 `maintainer` 都能触发两个后果：

1. **降级 workspace 的 `owner`。** 一个 `maintainer` 在某个项目里给所有者写入 `viewer`，所有者就失去了自己的项目——仪表盘的读取、决策，一切。恢复需要 `maintainer`，而所有者刚刚在那个范围内失去了它；
2. **不可逆的自我降级。** 一个 `maintainer` 把自己写成 `viewer` 后无法撤销，因为撤销走的是同一条路由，而它要求 `maintainer`。界面上没有回头路。

这些都不是权限提升——没有人获得原本没有的角色。这是失去访问权，而差别很重要：`maintainer` 本来就能对项目造成破坏，但不能制造出一个**没有人**不碰数据库就能脱离的状态。

显而易见的办法是让 `forProject` 返回"两者中较高者"，从根上消除问题，让代码去对齐那三处描述而不是反过来。这一方案被考虑过并被**拒绝**：在敏感项目中限制某人——一个 workspace 的 `developer` 在项目 X 中变成 `viewer`——是产品有意提供的能力，也是唯一能按项目约束访问的方式。"两者中较高者"会消除它，而 `resolve-effective-role.use-case.spec.ts` 一直以来都固定着向上的那一半（"papel de projeto sobrepõe o de workspace"）。

## 决策 {#decision}

**覆盖在两个方向上保留，而两个危险动作开始被拒绝。** `forProject` **不**改变：仍然是 `projectRole ?? workspaceRole`，仍然是系统中该角色的唯一组合方式。

**上限 1——没有人能降级 workspace 的 `owner`。** 对于 workspace 角色为 `owner` 的人，所请求的角色必须是 `owner`；任何更低的都是 403。给已经是 workspace `owner` 的人写入项目 `owner` 是冗余的，可以通过——只有降级被拒绝。

`owner` 从 **`workspace_members.role`** 读取，绝不从 `workspaces.created_by` 读取。两者都存在于 `db/schema/iam.ts`，但不是同一回事。`created_by` 是一个历史事实：谁创建了 workspace。授权在系统其余**所有**地方使用的都是 `role`——`ResolveEffectiveRoleUseCase.forWorkspace` 就是 `workspaces.findMemberRole`，而 `created_by` 不出现在任何授权路径中（它出现在 `get-credential-spend.use-case.ts` 中，用于判断被消耗的 LLM 密钥属于谁，那是另一个问题）。读取 `created_by` 的上限会在两种具体而相反的情况下保护错人：已经转让所有权、如今是 `developer` 的创建者会被保护起来，尽管他已不是所有者；而没有创建任何东西的当前 `owner`——有多个所有者的 workspace 的常见情况，以及所有权已转让的情况——会失去保护，而这恰恰是上限要封住的漏洞。

**上限 2——没有人能降级自己。** 如果目标就是调用者本人，而请求的角色低于他**今天**在该项目中的有效角色，就是 403。

表述就是这样，没有阈值。曾考虑的替代方案是"不得把自己降到 **`maintainer` 以下**"，理由是 `maintainer` 是能撤销的角色。两者都拒绝危险动作，但带阈值的那个是一条照抄 controller 的 `@RequireRole` 中某个数字的领域规则：哪天路由改了最低要求，它就会悄无声息地过时，而且不解释 `maintainer` 从哪来就无法表述它。"没有人能降级自己"是一个条款，没有会过时的数字，并且与上限 1 是**同一种**形式——问的是谁，而不是多少。代价是一个无害的动作也一并被拒：`owner` 在自己的项目里把自己设为 `maintainer` 本来是可逆的，现在被拒绝。它仍然可以由另一个 `maintainer` 完成，而为规则加例外的表述成本高于失去这个动作。**提升**自己的角色不是降级，这里不涉及。

**上限放在哪里：放在用例中，规则在领域层。** 不放在 `RolesGuard`。guard 回答的是另一个问题——用路由的 `@RequireRole` 授权**调用者**——它看不到请求体（`dto.role`）也看不到目标（`dto.userId`），而这两道上限关乎**目标**以及操作者↔目标的关系。需要请求体的 guard 就得了解每条路由的 DTO，而那正是它存在的意义所在、不应跨越的边界。

**形式**沿用仓库中已有的绝对上限先例：`domain/actions/decide.ts`（RN-154，以及修订了 RN-106 的 RN-418）——纯函数，位于领域层，消息紧挨着条件，没有配置项，也没有"始终允许"。新的 `apps/api/src/domain/iam/tetos-de-rebaixamento.ts` 就是这种形式在此处的应用，`AddProjectMemberUseCase` 在写入之前调用它。先例中**不**照搬的是结局：在 `decide.ts` 中，上限会把 agent 的 `proposed_action` 变成 `require_approval`，因为另一端有人工审批队列。这里调用本身就**是**人发起的、同步的，没有可以送去的队列，结局就是拒绝。

**状态：两者都是 403。** 这是**授权**拒绝——调用者拥有路由要求的角色，却没有执行这一具体动作的权限。不是 409，因为它不是与某个会过去的状态冲突（等待不会改变什么）；不是 400，因为请求体有效，同样的请求体换一个目标就会通过。带自有消息的 `ForbiddenException` 正是 api 中其他策略用法已经采用的（`ActivateAgentUseCase`、`CreateSocketTicketUseCase`、`RegisterUseCase`），而消息会到达界面：#444 给两个原本静默失败的动作加上了带 `mensagemDaApi` 的 `try/catch`。

**RN-471 声明的三处 OpenAPI 描述开始描述代码实际所做的事**——`POST :projectId/members` 的描述、`AddMemberDto.role` 的描述，以及 `GET :projectId/members` 的摘要；后者承诺"includes whoever inherits access from the workspace"，而 `listMembers` 是对 `project_members` 的 `innerJoin`。`openapi.json` 和 `api-types.generated.ts` 由生成器产出。

**web 一侧不在本 PR 中**，而且不是因为体量。界面可以自行算出上限 2（`userIdDaSessao()` 和有效角色自 #444 起就在那里），但**无法**算出上限 1：`listProjectMembers` 返回的是**项目行**的角色，目标的 **workspace** 角色不在客户端任何查询的可及范围内。只禁用一半选项，会做出一个对一种拒绝诚实、对另一种拒绝却默默出错的 `Select`——正是 RN-471 本身所反对的、在界面上虚构的第二个角色来源。在此期间，拒绝会**显示出来**：`handleRoleChange` 已经在 toast 中显示 `mensagemDaApi(erro, …)`，而 api 的那句话会说明是**哪**道上限触发了。

## 后果 {#consequences}

**覆盖仍然是一把双刃剑，而这正是所买下的。** 这两道上限都不能让 `projectRole ?? workspaceRole` 在一般意义上变得安全；它们只拒绝两个有名有姓的动作。`maintainer` 仍然可以降级任何**不是** workspace `owner`、也不是他自己的人——包括另一个 `maintainer`，包括以受害者无法撤销的方式。这是能力，不是疏忽：它与把 `developer` 在敏感项目中限制为 `viewer` 是同一机制，二者不可能只留其一。改变的是，那个**没有人**能脱离的状态（所有者被挡在自己的项目之外；唯一的 `maintainer` 把自己抹掉）不再可达。

**仍然可能，并具名列出：**

- 降级另一个不是 workspace `owner` 的 `maintainer`，无需其同意，他本人也无法自行恢复；
- **通过移除实现的自我降级。** `RemoveProjectMemberUseCase` **没有**获得上限，这是两项选定动作之外的又一个动作。移除自己的那一行，会让有效角色落到 workspace 角色：当 workspace 能兜住时（那里是 `maintainer`），这是无害的，正是一个人离开列表的方式；当兜**不住**时——权限来自项目行、在 workspace 中是 `viewer` 的 `maintainer`——这就是从另一扇门进行的不可逆自我降级。"移除总是无害的"这一前提是错的，写在这里以免被重新发现。两种情况都在测试中**固定**下来（`tetos-de-rebaixamento.use-case.spec.ts`），包括仍然开放的那一种，好让下一个人知道这是决定而非遗忘。封住它的代价是 `RemoveProjectMemberUseCase.execute` 的签名，它目前被 `list-projects-and-members.use-case.spec.ts` 以两个参数调用；
- **自我提升。** `maintainer` 可以把自己写成项目的 `owner`。这在本 ADR 之前就可以，现在仍然可以；上限针对的是下降，在这里顺带打开"上升"的问题，会改变一项没人要求改变的能力；
- **在 workspace 中**降级 workspace 的 `owner`。上限 1 针对的是 `project_members`。`POST workspaces/:workspaceId/members` 仍然是没有任何上限的 upsert——同一类缺陷，更上一层的范围，此处不处理。

**界面暂时会提供 api 拒绝的选项。** 这正是这一系列最近几个 PR 关闭的缺陷，而它有意通过一个 PR 重新出现：gate 的一半目前在客户端无法实现（见 Decision）。web 的 PR 需要在两者之间做决定：在 `GET :projectId/members` 中暴露目标的 workspace 角色——契约变更，而且 RN-471 已经记录这条路由承诺了一个它并不做的 `innerJoin`——还是只隐藏它知道的那部分。在那之前，拒绝由 toast 用 api 的那句话说出来。

**一个 500 变成了 404。** `AddProjectMemberUseCase` 开始调用 `projects.findById`（它需要 `workspaceId` 来读取目标的角色），并在项目不存在时抛出 `NotFoundException`，与 `ListProjectMembersUseCase` 和 `RemoveProjectMemberUseCase` 早已做的一样。通过 HTTP 这是不可达的——`RolesGuard` 会先以 403 拒绝——但用例不再对调用方做假设。

**每次关联多两次查询。** `findById`、workspace 上的 `findMemberRole`，以及操作者的 `forProject`（它会再做一次 `findById`）。这是一条管理路由，每次邀请调用一次，而替代方案——复用 guard 已经算好的 `request.effectiveRole`——会把用例绑到 guard 的状态上，而选择上限放在**哪里**正是为了避免这种耦合。

**三处 OpenAPI 描述变了，但没有改变任何响应。** 依照旧承诺（"higher of"）进行集成的人从 Fase 1 起就已经错了；生成的契约现在描述真实行为，而两道上限的 `403` 对路由的调用方来说是真正的新东西。
