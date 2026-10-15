---
traducao_de: 15e14c662cd4de7b1d041babd7caf3ef71f9ae2a
---

# ADR 0173 — workspace 成员的移除诞生，由同一条款保护

## 状态 {#status}

**已接受。** 这是由 [ADR 0127](0127-tetos-de-rebaixamento-em-project-members.md) 开启、由 [ADR 0156](0156-teto-de-auto-rebaixamento-na-remocao.md) 和 [ADR 0157](0157-teto-de-auto-movimento-no-upsert-de-workspace.md) 延续的这条线上的**第四**个。它打开了 0157 拒绝顺手打开的那扇门——*"Uma rota de remoção de membro de workspace (…) Decisão separada, se alguém a pedir"*——依据维护者的决定（2026-09-27，AT-115/HS-006）：**路由诞生，由条款保护。** 已接受的 ADR 不编辑：0157 继续说这条路由不存在，而本 ADR 说它已经存在。

## 背景 {#context}

workspace 成员的离职处理过去是直接写数据库：`WorkspacesController` 没有成员的 `@Delete`——这是在 `BRB-002` 期间测得的，并被 0157 用作论据的一部分。0157 给打开这扇门的人留下了三个问题，而 HS-006 表明它们是同一场对话：

1. **最后一个 `owner`。** 今天"永不为零个 owner"的不变量来自一条条款——移除最后一个需要他自己来做，而上限 2 阻止了这一点。HS-006 担心移除路由会重新打开这条路，保证将不得不来自计数，而那正是 0127 所拒绝的（*"用一条条款表述，没有会过时的数字"*）；
2. **workspace 中的上限 1。** 它被排除在外（0157，第 3 点），因为加上没有移除路由，它会让 `owner` 成为一个吸收态；
3. **移除中的上限 2**：是继承项目移除的委托（`remocaoEhAutoRebaixamento`），还是需要自己的表述，因为这里的"之后"总是*没有*？

## 决策 {#decision}

**1. 诞生 `DELETE /workspaces/:workspaceId/members/:userId`，`owner`，204。** 与 upsert 相同的最低要求：改动成员列表的是维护它的人。与项目移除一样是幂等的——没有行的目标不是错误。

**2. 上限 2 是**继承**的，没有新尺子。** `RemoveWorkspaceMemberUseCase` 调用 `remocaoEhAutoRebaixamento`，把操作者在 **WORKSPACE** 中的角色作为今天的有效角色传入（在 workspace 中没有组合：有效角色就是那一行），并把 `null` 作为**之后**的角色。这个分支早已存在——就是没有 workspace 行的项目那一支，*"最大程度的降级"*——它回答了问题 3：这里的"之后"总是*没有*，而函数早已知道如何表述*没有*。从 workspace 中移除自己**总是 403**，带有自己的语句（`MENSAGEM_TETO_AUTO_REMOCAO_DO_WORKSPACE`）：点击"移除"的人并没有请求改变角色，这与项目移除在 0156 中获得自己语句的理由相同。参数名保留了项目的：重命名它们会因为一种读法而改变其他入口，而函数的 docblock 说明了这种读法。

**3. 最后一个 `owner` 受**同一**条款保护，无需计数 owner。** 证明仿照 0157 为 upsert 所做的：

- 路由要求 `owner`（`@RequireRole('owner')`），所以**执行移除的总是** workspace 的一个 `owner`；
- **没有人能移除自己**（第 2 点）；
- 因此每一次成功的移除都至少留下一个 `owner`：**调用者本人**。移除最后一个需要他移除自己——那正是被拒绝的动作。

HS-006 的前提（"路由会重新打开这条路"）没有得到证实：路由**打开**了对他人的移除，但对最后一个的移除恰恰就是自我移除，而它仍被早已关闭自我降级的那条条款关闭。计数仍因 0157 第 2 点的理由被拒绝。证明在测试中：*"com dois owners, qualquer sequência de remoções deixa ao menos um: quem remove fica"*，而路由的 `owner` 最低要求在 controller 的测试中被断言，因为它是证明的**一半**——如果最低要求下降，证明也随之倒塌。

**4. 移除**另一个** `owner` 仍然可行。** 这是完全吊销所有权的方式，也是 0157 第 3 点的自然延伸，后者保留了降级另一位所有者。**上限 1 在这个作用域中仍然没有对应物**（问题 2）：HS-006 认为会倒下的前提——"不存在通过 HTTP 离开 `owner` 的出口"——是 0157 关于**代价**的论据，而关于**原则**的论据依然成立：上限 1 是关于层级倒置的规则，而 `@RequireRole('owner')` 让倒置不可能发生。新路由只是加强了代价论据：有了它再镜像一个上限 1，移除另一位所有者也会被拒绝，`owner` 又会成为吸收态。

**5. 级联，在一个事务中。** 只移除 `workspace_members` 的那一行是表面功夫：覆盖关系 `projectRole ?? workspaceRole`（[RN-471](../business-rules.md#rn-471)）会让被移除者留在他有自己行的每个项目中。因此一并移除：

- `workspace_members` 的那一行；
- 被移除者**在本 workspace 的项目中**的 `project_members` 行（其他 workspace 的不受影响）；
- 绑定到这些项目的他的凭据：**项目**设备密钥（按 [RN-519](../business-rules.md#rn-519) 列出的同一列）和 **PAT**——每个 PAT 都属于一个项目（`project_id NOT NULL`）——以 `workspace_member_removed` 为理由吊销。没有这一步，有一天重新关联时会悄悄重新激活一个本应由移除结束的配对。

**6. 提交之后，活动连接按 RN-520 的路径断开。** 对 workspace 的每个项目执行一次 `disconnectRunnerOfUser(projectId, userId)`——**全部**，而不只是 `runner` 模式的，因为 runner 也会在 `container`/`mounted` 中连接（镜像，[RN-516](../business-rules.md#rn-516)）；多一个项目只是一次 `sem_runner` 的代价，少一个则会留下移除本要拆除的东西。放在只记录日志的 `try/catch` 中：副作用绝不拖垮主效果，这是 [RN-520](../business-rules.md#rn-520) 的尺子。

**7. **持有人**不移除；持有权可以转让**（维护者的决定，2026-09-27，[RN-616](../business-rules.md#rn-616)）。`workspaces.created_by` 不决定授权（决定的是角色，ADR 0127），但 agent 所消耗的 LLM 凭据、agent 操作所用的 git 凭据（[RN-058](../business-rules/custo.md#rn-058)，`ResolveCredentialOwnerUseCase`）以及花费报告的所有者（[RN-060](../business-rules/custo.md#rn-060)）都由它解析。按第 4 点移除创建者，会让 agent 继续消耗一个已不在 workspace 中的人的凭据。因此，以**持有人**之名：

- 目标 = 持有人的 `DELETE .../members/:userId` 是**具名的 409**，`criador_do_workspace`，说明需要先转让以及原因。第 2 点的上限先生效：持有人试图移除自己会得到一贯的 403。第 3 点继续有效——持有人是 `owner`，而调用者仍是留下来的那位 owner。
- 诞生 `PUT /workspaces/:workspaceId/owner-of-record`，`owner`，请求体 `{ userId }`。目标必须**已经**是该 workspace 的 `owner`——成为持有人就是付钱的人——否则返回 **409** `titular_precisa_ser_owner`。在一个事务中与角色读取一起写入 `created_by`；转让给当前持有人是幂等的。任何 `owner` 都可以调用，包括转让给一位没有提出请求的**其他** owner：这与早已能移除和降级所有者的权限相同，而目标的同意需要一个产品所没有的邀请流程。
- **花费，从提交起：** `ResolveCredentialOwnerUseCase` 开始返回**新的**持有人；agent 的轮次为模型的 provider 查找**他的**凭据，git 操作查找他的 git 凭据。如果他没有，产品就像对待任何没有凭据的持有人那样处理：轮次以 `"Nenhuma credencial cadastrada para <provider>"` 结束（`RunLlmTurnUseCase`/`StreamLlmTurnUseCase`），读取远程 git 时失败并点名缺少的是谁的凭据。转让**不**事先核对这一点——那将是在不知道项目用哪些 provider 的情况下按 provider 逐一读取，而以此为由拒绝，恰恰会锁住即将离开的持有人的出口。`ollama` 不使用凭据，保持不变。已经记录的花费留在原处：`token_usage` 不保存持有人，报告改由新持有人整体读取，包括历史。
- 成员变化和持有权变化都没有领域事件（upsert 和移除同样不发出）；转让留下一行带有从/到/操作者的日志。为这三者设立审计事件是一条独立的工作线。

## 已声明、但**不**做的事 {#o-que-fica-declarado-e-não-é-feito}

- **机器**密钥（`project_id` 为空）保留：它们属于**账户**，服务于此人的其他 workspace。在这里它们已经触及不到任何东西——`PatAuthGuard` 针对请求的项目解析角色，而角色是无。
- **已打开的会话**保持打开：它们属于项目，不属于个人，而 event log 是只追加的。被移除者**已经**连接的会话 socket 会一直保持到断开；新的 ticket（RN-108）要求 `viewer`，会被拒绝。按用户拆除会话通道需要 engine 中的新命令——独立的工作线。
- 被移除者的 **`:web` 终端**不是断开的目标（RN-520 只断开 `:runner`）；同样的缺口，同样的原因。
- **界面。** `apps/web` 中不存在 workspace 成员的部分（测得：`/workspaces/:id/members` 唯一的痕迹是 `api-types.generated.ts` 中生成的类型，甚至没有 workspace 成员的 `GET`）。这里不新建一个；这条路由是 API 路由，与 upsert 一样。

## 后果 {#consequences}

**离职处理不再是写数据库。** `owner` 可以移除任何其他人，包括另一位 `owner`（转让之后的持有人），并且移除是真实的：离开 workspace 及其所有项目，他的 runner 也会断开。

**上限这条线有五个入口、两道上限。** 没有新的上限诞生：上限 2 通过同一个函数多了一个入口，而上限 1 仍只在项目中。`docs/security-surface.md` 增加了第五条路由的说明。

**两句旧话变成假的，由本 ADR 取代它们。** 0157 的那句（*"`WorkspacesController` 没有成员的 `@Delete`"*）以及 workspace 中自我降级的 403 消息——它曾说*"不存在移除成员的路由"*，现在不再这样说了——错误语句不能断言不真实的事。

**写入之前多一次查询**（操作者的角色），之后对 engine 发起 N 次 HTTP 调用，每个 workspace 项目一次，发生在产品中最不频繁的管理路由上。
