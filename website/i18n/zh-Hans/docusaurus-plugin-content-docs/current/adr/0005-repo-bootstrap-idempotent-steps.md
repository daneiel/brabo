---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0005 — 幂等且可恢复的 Gitflow bootstrap

## 背景 {#contexto}

第 2 阶段，会话 3（“核心”）：`ProvisionRepositoryUseCase` 除了创建仓库之外，开始执行完整的 Gitflow bootstrap（dev/qa/rc 分支、按 capabilities 设置的保护、PR 模板、
docs/branching-policy.md），作为一系列步骤，这些步骤必须：运行 N 次总是收敛到同一状态（幂等性），在中途崩溃后从停下的地方恢复（进度持久化），并把每一次变更作为 auto_approved 的 `proposed_action` 叙述在会话的 event log 中——这一切在代码中都没有任何先例（本仓库第一个“中途杀掉进程再恢复”的功能）。

两项决定在实现之前已与用户明确确认；其余的在实现过程中解决，随着与现有代码（会话、proposed_actions、
`GitProviderContract`）的集成暴露出真实的约束。

## 决策 {#decisões}

**1. `getFileContent` 作为 `GitProviderContract` 的第 9 个操作。**
“文件已以相同内容提交”的检查（提交类步骤的幂等性）无法用原有的 8 个操作完成——没有一个能读取文件内容。已与用户确认：添加
`getFileContent(externalId, branch, path): Promise<string | null>`，在 3 个 provider 中实现（LocalGitProvider 通过 `git show`，GithubProvider 通过 Octokit `repos.getContent`，GitlabProvider 通过
Gitbeaker `RepositoryFiles.show`），并由唯一的合约测试套件覆盖。GitHub/GitLab 的假后端（msw）需要开始真正跟踪内容（之前只有分支/PR 元数据）——GitHub 使用 blob→tree→commit 图（镜像真实 API），GitLab 使用每个分支的 path→内容映射（其提交 API 每次发送完整状态）。

**2. 专用会话，只创建一次，并在每次恢复时复用。**
`proposed_actions`/`session_events` 需要一个已存在的 `sessionId`——不支持“无会话”的动作/事件。已与用户确认：
`ProvisionRepositoryUseCase` 在第一次尝试时为每个项目创建**一个**会话（与 `CreateSessionUseCase` 同样廉价的机制——只是 INSERT + outbox 事件，从不调用 engine），把 id 保存在
`repo_bootstraps.session_id` 中，并在每次恢复时**复用**它——bootstrap 的历史（成功、失败、恢复、跳过）被叙述在一条连续的时间线上，而不是分散在多个会话中。会话从不通过 `TransitionSessionUseCase` 转换到 `active`（那会通过 `ApiToEngineClient.startSession` 调用 engine——对一个从不运行任何命令的会话来说是错的）：`created→active` 的转换直接通过 `SessionRepository.updateStatus` 完成，由 `assertTransition` 守护。出于同样的原因，步骤失败时会话**从不**进入 `closed_abnormally`——那是一个终止状态（没有出向转换，`session-state-machine.ts`），会破坏未来恢复时的复用；在任意次数的失败/恢复尝试期间它都保持 `active`，只有当 6 个步骤在同一次执行中收敛时才关闭（`closing→closed`，这两跳不触碰 engine）。

**3. 每个项目一个游标，每次执行全面重新验证。**
`repo_bootstraps` 是每个项目一行（而不是每步一条日志）——
`{project_id, session_id, step, status, attempts, last_error}`。幂等性**并非**来自基于该游标跳过步骤：**每次**执行（全新或恢复）都从头遍历 6 个步骤，针对 provider 中的真实状态调用每个步骤的 `check()`——只有当 `check()` 报告“不满足”时才会发生真正的变更。游标只是诊断信息（最后触及的步骤 + 结果），从不是 gate。这一条规则顺带带来：幂等性（运行 N 次 = 所有 `check()` 都返回满足，零变更）、失败后恢复（已完成的步骤仍然满足，只执行缺失的部分），以及“在变更中途杀掉进程”后的恢复（该行停留在 `status=running`；下一次执行时 `check()` 发现变更其实已经发生并跳过）——测试标准（第 6 项）的 3 个场景是**同一个**机制，而不是三个独立实现。

**4. bootstrap 路径中没有 `decide()`——status 诞生时就硬编码为 `auto_approved`。** 需求说“bootstrap 的决定为 auto_approved”。真正调用 `decide()`（就像 `ProposeActionUseCase` 对用户/agent 动作所做的那样）默认**不会**产生这个结果：`permissions.json` 中没有适用规则时，`decide()` 的回退是 `require_approval`，从不是 `auto_approve`。也就是说，“bootstrap 总是自动批准”只有作为与自由裁量流水线分开的结构性类别才讲得通，而不是“对新项目而言 decide() 的典型结果”。在结构上是安全的：`auto_approved` 在 `action-state-machine.ts` 中从不是转换的目标（只是初始状态），因此在创建时硬编码不违反状态机。接受的后果：`permissions.json` 中针对 `git_branch_create` 等的 `deny` 不会阻止 bootstrap——这是新项目的基础设施，而不是 agent/用户的自由裁量动作。

**5. 步骤的**执行**顺序不同于需求中列出的顺序。**
需求把“从 main 创建 dev”列在第一，提交列在最后。照原样不可能：`createRepo` 在 3 个 provider 中都创建一个空的 bare 仓库，没有初始提交（`auto_init: false`——“已配置”在所有 provider 中必须意味着同一件事），而一个没有任何提交的 ref 不能作为 `createBranch` 的源。`main` 上的两次提交（PR 模板、
`branching-policy.md`）必须**先**发生——正是它们给了 `main` 第一个提交。真实的执行顺序
（`BOOTSTRAP_STEP_SEQUENCE`/`BOOTSTRAP_STEPS`，保持同步）：
`commit_pr_template → commit_branching_policy → create_dev_branch →
create_qa_branch → create_rc_branch → protect_branches`。分支级联为 dev←main、qa←dev、rc←qa（我的默认——需求没有指定 qa/rc 的来源；沿用 CLAUDE.md 中描述的 dev→qa→rc→main 晋升流水线）。schema 中的 `bootstrap_step` 枚举（声明顺序）不需要改变——它从不按顺序比较，只按相等比较。

**6. 重新配置已收敛的项目不返回 409。** 之前版本的 `ProvisionRepositoryUseCase` 在项目已有仓库时抛出 `ConflictException`。保留这个守卫会破坏幂等性：“运行用例 N 次无错误地收敛”（需求第 2 项）与“第 2 次调用抛出 409”不兼容。解决：没有这种意义上的冲突守卫——已收敛的项目只是让全部 6 个 `check()` 报告满足（纯跳过），从不报错。

**7. github/gitlab 凭据按用户（PAT），不再按项目（OAuth）。** 之前的版本通过 `project_git_connections`（按项目的 OAuth 连接，由遗留的 `createRepository` 使用）解析令牌。新合约（`createRepo` 等）期望 PAT（Gitbeaker 构造函数中的 `token:`——`PRIVATE-TOKEN`），而不是 OAuth 令牌（`oauthToken:`——
`Authorization: Bearer`）；两者不可互换（docs/adr/0004）。解决：凭据现在来自 `UserCredentialRepository`（用户登记的 PAT，见 docs/adr/0004），直接解密（原始字符串，没有 OAuth 流程的 `{accessToken,refreshToken}` JSON 包装）。

**8. 遗留合约 `GitProvider`/`createRepository` 退役。**
已通过 grep 确认 `ProvisionRepositoryUseCase` 是整个 `src/` 中 `.createRepository()` 的唯一消费者——`GitProviderRegistry` 现在直接返回 `GitProviderContract`。关闭了 docs/adr/0001 中登记的“显式债务”。

## 后果 {#consequências}

- `projects` 中没有 status 列——`provisioning|provisioned|
  provision_failed` 纯粹从 `repo_bootstraps` 推导
  （`repo-bootstrap-status.ts`，与 `action-state-machine.ts` 同样不依赖框架的理念），避免两个事实来源。
- `repo_bootstraps` 不使用 `SELECT ... FOR UPDATE`——对**同一**项目的并发配置在本会话中不被串行化（与旧的 `findByProjectId` 守卫已经隐含的简化相同）。如果这成为真实问题，未来的决定是关于该行的乐观/悲观锁，而不是重新设计游标。
- 真实风险，本会话未实现：`GithubProvider.protectBranch`
  硬编码了 `enforce_admins: true`，如果顺序反过来（先保护后提交）会阻止向 `main` 提交——这里并非如此（提交先发生），但一个真实的 GitHub 若 `main` 已在 bootstrap 之外被保护，之后可能会拒绝管理性 push。不在本会话范围内（验收标准针对 LocalGitProvider 测试，它没有保护的概念）。
- `apps/api/scripts/demo-repo-bootstrap.ts` 端到端演示验收标准：用 LocalGitProvider 配置，在第 2 次调用 `createBranch` 时注入失败（可观测地等价于在 6 步中的第 4 步杀掉进程），再次运行，收敛，并打印完整的 event log，显示恢复时第 1-3 步的 `bootstrap.step_skipped`。
