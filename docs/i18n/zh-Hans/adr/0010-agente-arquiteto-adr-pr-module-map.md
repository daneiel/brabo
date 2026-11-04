---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0010 — Arquiteto agent：通过真实 PR 的 ADR、module_map 和交叉验证

- 状态：已接受
- 日期：2026-07-24
- 阶段：3b（最后一次会话——结束 Fase 3）

## 背景 {#contexto}

闭合 Criativo → PO → **Arquiteto** 的循环。由一个被接受的 PO handoff 激活，Arquiteto 产出：（a）通过 Fase 2 的 git 管道提交到**项目自身**仓库 `docs/adr/` 的 **ADR**，位于 `feature/adr-*` 分支，附带由用户批准/合并的**真实 PR**；（b）一个针对依赖环做过校验的 **module_map**。它强制**交叉验证**（只有当故事引用的所有模块都存在于当前 module_map 中时，故事才能进入 `ready`），并发出关于规则↔架构张力的 **insights**。

## 决策 {#decisões}

### 1. ADR = 新的 ActionType `open_adr_pr`，带 git 执行器 {#1-adr--novo-actiontype-open_adr_pr-com-executor-git}
git 动作在批准后没有执行器（`ApproveActionUseCase` 只路由 `terminal`）。我们增加了 `open_adr_pr`（git 效果，`require_approval`，最低角色 maintainer）。Arquiteto 的工具 `propose_adr` 创建 proposed_action（现有管道）；批准时，`ApproveActionUseCase` 路由到 `ExecuteAdrPrUseCase`，后者通过 `GitProviderContract`（Fase 2）执行 `createBranch(feature/adr-<slug>)` + `commitFiles(docs/adr/<slug>.md)` + `openPullRequest`，并写入 `executionResult` {pullRequestUrl, …}。**用户的两个步骤**：批准动作（打开 PR）以及在 provider 中合并真实的 PR。合并由用户负责（应用只打开 PR——正如验收标准所要求）。

### 2. module_map 有自己的表，在领域中针对环进行校验 {#2-module_map-em-tabela-própria-validado-contra-ciclos-no-domínio}
专用工具 `create_module_map`（而不是 `emit_artifact`）：它需要被**存储**以便交叉验证。表 `module_maps`（不可变历史；**当前 = 最大 version**）。`domain/architecture/module-graph.ts` 检测环（DFS）并**拒绝**该映射（错误 → tool-result）。它还在事件日志中发出 `artifact.module_map`（叙述）。

### 3. 故事↔module_map 的交叉验证（阻止 + 重新验证） {#3-validação-cruzada-storymodule_map-bloqueio--revalidação}
故事增加 `module_ids[]`（jsonb）。`TransitionStoryUseCase`（draft→ready）：除了就绪条件（DoD/DoR/RF/规则）外，要求**所有** `module_ids` 都存在于当前 module_map 中（`assertModulesResolved`）——空的 moduleIds 可以通过（这是待办，不是阻止，以尊重上一次会话的故事）。新的 module_map 会**重新验证** `ready` 的故事，并把孤立的（模块被移除）**降级为 draft**，带事件 `backlog.story_demoted`——这就是通知（通过轮询出现在 feed/铃铛中）。Arquiteto 用 `assign_story_modules`（校验存在性）把模块绑定到故事——这就是故事开始引用有效模块的方式。

### 4. Arquiteto 作为带 `:pipeline` 工具的 GenServer {#4-arquiteto-como-genserver-com-tool-pipeline}
`ArquitetoServer` 镜像 `PoServer`（流式 + 有界的工具使用循环 + 重新水合 + kickoff）。工具：`create_module_map`/`assign_story_modules`/`emit_insight`（`:direct`）和 `propose_adr`（`:pipeline` → `propose_action`）。**PO** 获得了 `offer_handoff`，在 kickoff 结束时向 Arquiteto 提供 handoff；用户接受（`AcceptHandoffUseCase` 流程），按会话 1 的同一激活规则激活 Arquiteto。

### 5. Insights 作为类型化构件 {#5-insights-como-artefato-tipado}
当模型看到规则↔架构的张力时（例如：没有模块满足的非功能需求），`emit_insight` 写入 `artifact.insight`。没有领域逻辑——这是 agent 的判断，在 feed 中叙述。

## 后果 {#consequências}

- 项目概览获得 **Arquitetura** 一节：module_map（`depends_on` 以 chip 显示的模块）、ADR（指向 PR 的链接 + 状态徽章）以及以红色显示的交叉验证待办项。会话中接受 handoff 的按钮变成通用的（任意 agent），composer 路由到最靠后的活动 agent。
- 测试：领域（`module-graph` 拒绝环、`module-resolution`）、用例（`CreateModuleMap` 拒绝环 + 重新验证/降级孤立项；`TransitionStory` 在模块缺失时阻止 ready；`ExecuteAdrPr` 用假的 GitProvider 打开 PR），以及 `arquiteto_server`（kickoff 串联 module_map→assign→ADR→insight；环变成错误的 tool-result；广播；重新水合）。

## 范围 {#escopo}

Fase 3 的最后一次会话。不实现执行 agent（Fase 4）。用于打开 PR 的凭据是审批者的（`decidedBy`），与仓库开通一致（Fase 2）。没有 Bitbucket/GenericGitProvider；队列放在 Postgres（Oban）中。
