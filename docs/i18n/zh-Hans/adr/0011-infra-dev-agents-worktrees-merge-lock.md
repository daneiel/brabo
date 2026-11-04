---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0011 — dev agent 的基础设施：worktree、git 执行器和合并锁

- 状态：已接受
- 日期：2026-07-24
- 阶段：4a（会话 1——执行基础设施）

## 背景 {#contexto}

Fase 4（执行 agent）的开始。在真正的 dev 之前，本次会话构建**基础设施**，并用一个 **NoopDevAgent**（没有 LLM）来验证它：按 module_map 的每个模块动态实例化一个 dev、隔离的 git worktree、提交身份 `dev-<modulo>[bot]`、受保护分支上的合并锁、一键接受的并行化建议，以及孤立 worktree 的清理。用户的决定：**100% 本地、自包含**的 git 流程。

## 决策 {#decisões}

### 1. 合并锁作为领域中的上限（decide.ts） {#1-trava-de-merge-como-teto-no-domínio-decidets}
新的 `ActionType git_merge`（payload `{sourceBranch, targetBranch}`）。`decide()` 依次评估 IAM → agent_autonomy → permissions（每个阶段只会**提高**宽松度）；最后有一个**上限**：如果是 `git_merge` 且 `targetBranch ∈ {dev,qa,rc,main}`（受保护分支），policy **绝不**是 `auto_approve`——降为 `require_approval`，不论 agent_autonomy 和 permissions.json 如何。Deny 仍然胜出。测试证明 autonomy 和 permissions 都无法覆盖它。受保护分支上的合并**始终**是手动的（CLAUDE.md）。

### 2. 通过管道的 git 执行器；在 worktree 中本地提交 {#2-executores-git-via-pipeline-commit-local-no-worktree}
`git_commit`/`git_push`/`pr_open`/`git_merge` 获得执行器（以前只有 `terminal`/`open_adr_pr`）。`git_commit`/`git_push` 在 **ENGINE** 中运行（`GitExecutor`，在 worktree 中 `System.cmd git`——提交带 `--author=dev-<modulo>[bot]` + `Co-authored-by`），通过一个镜像终端的内部端点。`pr_open`/`git_merge` 在 api 中通过 `GitProvider` 运行。`ExecuteGitActionUseCase` 负责路由；`ApproveAction`/`ProposeAction`（auto_approved）调用它。每个 git 操作都以 proposed_action 诞生（第 3 项），尊重 autonomy/permissions。

### 3. LocalGitProvider 获得本地 PR（自包含） {#3-localgitprovider-ganha-pr-local-self-contained}
`openPullRequest`/`mergePullRequest` 通过一个轻量存储（bare repo 中的 sidecar JSON）+ 经由 git 的合并来实现；`capabilities.pullRequests` 变为 `true`。（以追加方式）推翻了 Fase 2 在本地不支持 PR 的决定——这是演示在没有 GitHub 时运行所必需的。唯一的契约测试套件开始覆盖本地的 PR。

### 4. worktree 来自本地工作树；每个 agent 一个；清理孤立项 {#4-worktrees-off-o-working-tree-local-1-por-agente-limpeza-de-órfãos}
`WorktreeManager` 在 `<workspace>/.worktrees/<agent_id>` 中创建 worktree（分支 `feature/<task>`），来源是 `Engine.Actions.Workspace` 已经从 bare repo 组装的工作树。每个 agent 一个 worktree（按 agent_id 的目录保证这一点）；`WorktreeCleanupWorker`（自动重新调度的 Oban）修剪孤立项（在 `Engine.Dev.Registry` 中没有存活 agent 的 worktree）。

### 5. 动态 dev agent：监督 + 重新水合 {#5-dev-agents-dinâmicos-supervisão--rehydration}
`DevAgentSupervisor`（DynamicSupervisor）+ `Engine.Dev.Registry`（键 `{project_id,
agent_id}`），每个模块一个 `DevAgentServer`。持久状态在 `dev_agent_states`（`engine` schema）中；`DevRehydrator` 在启动时重建 agent（与 `SessionServer`/`Rehydrator` 相同的惯用法）——重新水合**不会**重新触发 `:work` 周期。NoopDevAgent（`:work`）：领取任务（原子认领 `FOR UPDATE SKIP LOCKED`）→ worktree → 一个简单文件 → 提议 commit/push/pr_open。`ActivateExecutionUseCase` 按模块播种指令 + `auto_approve` 自主权（git 操作），并让 engine 启动 agent。

### 6. 建议的并行化；一键接受 {#6-paralelização-sugerida-aceite-de-um-clique}
激活时，有 ≥2 个可认领任务的模块（有可用的独立分支——任务依赖图目前简化）会发出 `execution.parallelization_suggested`。接受（UI 中的按钮 → engine）会启动一个带自己 worktree 的 `dev-<modulo>-2`。

## 后果 {#consequências}

- 项目概览获得 **Execução** 一节：“Ativar execução”按钮（存在 module_map 时）、带分支/任务的 dev agent、带“Aceitar”的并行化建议，以及已打开的 PR。feed 叙述 `dev.*`/`execution.*`。
- 测试：`decide`（合并锁——autonomy 和 permissions 都不能自动批准受保护分支上的合并）；`ClaimNextTaskUseCase`（原子认领，每个 agent 不同）；LocalGitProvider PR（契约）；`worktree_manager`（2 个并行 worktree 无冲突 + 清理孤立项）；`dev_agent_server`（Noop 周期 + 持久化/重新水合）。

## 范围与假设 {#escopo--assunções}

只有 **NoopDevAgent**（没有 LLM）——真正的 dev（harness + LLM）是下一次会话。完整的实时团队面板（Phoenix 通道）以及 QA/SecOps/Infra 之后再来。`git_merge` 只在手动审批时执行（GitProvider）——演示检验的是自动合并的**拒绝**。**开发环境的假设：** api 和 engine 共享 bare repo（`GIT_LOCAL_REPOS_ROOT`）和工作区（`PROJECT_WORKSPACES_ROOT`）的文件系统——Compose 中的卷。
