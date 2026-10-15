---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0018 — NoopDevAgent 作为永久的执行模式

- 状态：已接受
- 日期：2026-07-25
- 阶段：4a（执行基础设施的验证）

## 背景 {#contexto}

NoopDevAgent 在 Fase 4a（ADR 0011）中作为 `DevAgentServer` 的 `:work` 主体存在，并在下一次会话中被真实 agent **取代**（ADR 0012）。这样一来，端到端检验执行基础设施——隔离的 worktree、身份 `dev-<modulo>[bot]`、`proposed_actions` 管道、PR——的唯一方式就变成了运行依赖 LLM 的**真实** agent：昂贵、缓慢且不确定。基础设施的冒烟测试不能依赖一个模型。

本次会话把 Noop 带回来，现在作为一种**永久的执行模式**，与真实 agent 共存。

## 决策 {#decisões}

### 1. `Engine.Dev.AgentIo`——共享的副作用 {#1-enginedevagentio--os-efeitos-colaterais-compartilhados}
新模块，包含 `via/2`、`emit/3`、`claim_task/1`、`propose/3`、`propose_commit/2`（身份）、`propose_push/1`、`propose_pr/3`、`persist/1`、`block_task/3` 和 `worktree_manager/0`，从 `DevAgentServer` 中抽出，行为不变。**两个 server 使用同一份代码**：一个重新实现 worktree/身份/管道的 Noop 验证的只是一个副本，而不是基础设施。`dev_agent_server_test.exs`（12 个用例）是这次抽取的安全网——它未经修改就通过了。

### 2. `Engine.Dev.NoopDevAgentServer`——是模式，不是身份 {#2-enginedevnoopdevagentserver--modo-não-identidade}
自己的 GenServer，同一个 Registry，**同一个 `agent_id`**（`dev-<modulo>`），以及与真实 agent 相同的持久状态。由于是同一个 agent_id，api 播种的自主权和指令无需任何改变即可生效。周期：认领 → worktree → 简单文件 → commit → push → PR → 任务 `in_review`。**不打开 gate**（QA 是 LLM agent）：Noop 停在 PR。`{:correct, _}` 有一个防御性子句，带着诊断把任务退回，而不是让进程崩溃——`DevAgentServer.correct/3` 是 `via/2` 上的 cast，会到达这里。

### 3. `dev_agent_states.impl`——模式是持久的 {#3-dev_agent_statesimpl--o-modo-é-durável}
新列（默认 `"real"`）。由重新水合来选择要启动的模块：如果不持久化模式，Noop 在节点重启后会作为**真实** agent 回来——在没人要求的情况下开始消耗 token。`DevAgentSupervisor.start_agent/7` 接收 `impl`；`server_for/1` 把模式映射到模块（`"noop"` 之外的任何值都落到真实的——安全的默认值是生产的那个）。并行化的接受**继承**基础 agent 的 `impl`，与它已经继承上限的理由相同。

### 4. 接受并行化开始为额外的子 agent 播种 {#4-aceite-da-paralelização-passa-a-seedar-o-subagente-extra}
修复一个真实的 bug：`AcceptParallelizationUseCase` 没有为 `dev-<modulo>-2` 创建 `agent_autonomy` 行，也没有指令。没有自主权，`decide()` 会落到默认的 `require_approval`——“一键接受”变成了每个任务三次手动审批，而验收标准（“看到第三个在工作”）无法达成。现在它在调用 engine **之前**，以与基础 agent 相同的 `DEV_AUTO_GIT_ACTIONS` 播种指令 + `auto_approve`。`git_merge` 仍然不在其中。

### 5. 在 Compose 中为 engine 以读写方式挂载 bare repo {#5-bare-repos-montados-rw-pro-engine-no-compose}
原来是 `git_local_repos:/data/git-repos:ro`。自 Fase 4a 起，`git_push` 执行器在 **ENGINE** 中运行，把 worktree 的分支推送到 bare repo——在只读挂载下，push 死于 `remote unpack failed: unable to create
temporary object directory`，dev agent 的 PR 永远打不开。`:ro` 是 Fase 1 的前提（engine 只做 checkout），被 Fase 4a 推翻而没有人注意到：验收标准的演示在之前的配置下**无法通过**。

## 后果 {#consequências}

- `POST /projects/:id/execution/activate` 接受 `devAgentImpl: 'real' |
  'noop'`（省略 = `real`）。UI **不变**——Noop 模式是验证工具，不是产品功能；演示通过脚本触发它。
- `pnpm --filter api demo:noop-execution` 针对 Compose 栈运行完整的验收标准。
- 新测试：`noop_dev_agent_server_test.exs`（周期、身份、不使用 LLM、worktree 失败、2 个并行 agent）、`dev_rehydrator_test.exs`（模式在重启后保留，`:work` 不被重新触发，幂等性）以及 `git_executor_test.exs`（**真实 git** 中的身份：bot 作者 + `Co-authored-by`、隔离的 worktree）——最后这个填补了一个缺口：到目前为止只断言了提议的 payload，从没断言过最终的提交。

## 范围与假设 {#escopo--assunções}

Noop 在任何方面都不替代真实 agent：它不读取任务上下文，不运行测试套件，不经过 gate。它用来在不点燃 LLM 的情况下回答“执行基础设施是否就绪？”。并行化建议仍然是 `countClaimableByModule >= 2`，而不是任务依赖图（schema 中任务之间没有依赖）——仍然未决，正如 ADR 0017 已经记录的那样。
