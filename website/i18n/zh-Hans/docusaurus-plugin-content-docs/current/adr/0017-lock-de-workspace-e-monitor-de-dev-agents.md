---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0017 — 工作区初始化锁、dev agent 的 Monitor 以及上限继承

- 状态：已接受
- 日期：2026-07-25
- 阶段：4a（审计后的修正）

## 背景 {#contexto}

针对原始会话的 7 项和验收标准对 Fase 4a 进行的审计。确认了四个缺陷（其中一个破坏了验收标准），以及 engine 测试套件约 50% 的不稳定性。本 ADR 记录结构上的变化；原始决定在 [ADR 0011](0011-infra-dev-agents-worktrees-merge-lock.md) 中。

## 决策 {#decisões}

### 1. `Workspace.ensure!/3` 按项目串行化初始化（修订 0011 §4） {#1-workspaceensure3-serializa-a-inicialização-por-projeto-revisa-0011-4}

ADR 0011 曾把工作树的竞争视为“不是验收标准的要求”。**它是**：激活时，项目的 N 个 dev agent 一起启动，全都在工作树尚不存在时调用 `ensure!/3`。`git init`/`fetch` 在同一目录中冲突（`could not lock config file`、`cannot copy
.../hooks/*.sample`）。实测：8 个 agent 时 7 个死掉；2 个时——验收标准的数量——1 个死掉，6/6 次执行可重现。

初始化改为在 `:global.trans({{Workspace, project_id},
self()})` 内运行，并在临界区内重新检查（等待的一方会发现工作树已准备好）。锁是按项目的：不同的项目仍然并行。热路径（工作树已存在）完全不碰锁。

### 2. `Workspace.ensure/3` 不抛出；worktree 失败会退回任务 {#2-workspaceensure3-não-levanta-falha-de-worktree-devolve-a-task}

`ensure!/3` 会抛出 `MatchError`，而 `DevAgentServer` 是 `restart: :temporary`——agent 彻底死掉。更糟的是：任务已经被认领（`in_progress`，`blocked = false`），对认领（只取 `todo`）不可见，也不在解除阻塞的范围内。任务被卡住，UI 中没有恢复路径。

新的 `ensure/3` 返回 `{:ok, dir} | {:error, mensagem}`，由 `WorktreeManager.create/3` 使用；`DevAgentServer` 在组装 worktree **之前**把 `task_id` 固定在 state 中，并在失败时调用 `block_task/3`。

### 3. `Engine.Dev.Monitor`——dev agent 获得以前只有会话才有的 Monitor {#3-enginedevmonitor--dev-agents-ganham-o-monitor-que-só-sessões-tinham}

`DevAgentState.delete/2` 存在，却没有任何调用点：该行在进程之后仍然存活，而 `DevRehydrator` 在每次启动时都会复活每一个曾经存在过的 dev agent（包括因崩溃而死的，它们回来时没有工作周期，还在 Registry 中占着 `agent_id`——使 `WorktreeCleanupWorker` 失效，因为“存活”的 agent 永远不会有孤立的 worktree）。

新的 `Engine.Dev.Monitor` 镜像 `Engine.Sessions.Monitor`，但有一个会话那个没有的区分：**`:shutdown` 保留该行**（这正是重新水合覆盖的情况——节点关闭），任何其他原因都删除它。

两个 Monitor 都是**单例**：如果它们死掉，engine 会一下子失去对所有被观察进程的监控。数据库中的 `delete` 在两者中都加上了保护（`rescue`/`catch :exit`）——数据库不可用不能产生那样的效果。这也是测试套件剩余不稳定性的根本原因。

### 4. 并行化的子 agent 继承基础 agent 的上限 {#4-o-subagente-da-paralelização-herda-os-tetos-do-agente-base}

`parallelize` 以默认值 `nil` 启动 `dev-<modulo>-2`。由于 `ToolLoop` 的守卫是 `when is_integer(budget)`，`nil` 意味着**无限制**：一键接受会创建一个没有花费上限的 agent。api 不能作为来源——它不持久化激活时选择的预算——所以额外的 agent 从基础 agent 的持久状态继承；没有基础 agent 时，engine 以 409 拒绝，而不是创建一个没有上限的 agent。`AcceptParallelizationUseCase` 改为在写入事件**之前**调用 engine，因为事件日志是不可变的。

### 5. `persist/1` 显式写入 `max_gate_corrections` {#5-persist1-grava-max_gate_corrections-explicitamente}

该列在 `on_conflict` 的 `:replace` 列表中；在 upsert 中省略它会在第一个任务周期就把它清零。gate 从数据库读取这个字段（`qa_agent_server`/`secops_agent_server`），于是用户选择的上限会静默地变成 api 的 `DEFAULT_MAX_GATE_CORRECTIONS = 3`。

## 后果 {#consequências}

- 两个 dev 并行的验收标准在新项目中开始成立。
- 新测试：同一项目中 8 个并发的 `ensure/3`；`ensure/3` 返回错误而不抛出；worktree 失败退回任务；上限在 `persist` 后保留；Monitor 在崩溃时删除、在 `:shutdown` 时保留；并行化中的上限继承以及没有基础 agent 时的 409。
- engine 测试套件：173 个测试，12/12 次执行为绿（基线：18 次执行中 9 次失败）。
- `workspace_test.exs` 和 `workspace_files_test.exs` 改为 `async: false`——它们是仅有的修改全局 `Application.env` `:project_workspaces_root` 的 `async: true` 模块。

## 未解决（审计） {#não-resolvido-auditoria}

记录审计发现但本次会话不处理的内容：并行化建议仍然是 `count >= 2`，而不是依赖图（schema 中任务之间没有依赖）；`dev_agent_states.status` 从不离开 `"working"`；分支不被持久化；合并锁不覆盖 payload 中没有 `targetBranch` 的 `git_merge`（目前不可达——没有 agent 提议 `git_merge`）；以及 outbox 只排空 `aggregate_type = "session"`。
