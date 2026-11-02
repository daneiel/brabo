---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0012 — 真正的 DevAgent：ToolLoop、按 task 的预算与阻塞纪律

- 状态：已接受
- 日期：2026-07-24
- 阶段：4a（会话 2——取代 NoopDevAgent）

## 背景 {#contexto}

上一次会话构建了执行基础设施（worktree、提交身份、git 流水线、合并锁、原子 claim），并用一个 **NoopDevAgent**（没有 LLM）验证了它。本次会话把这个“笨”主体替换为**真正的 DevAgent**：领取 task，通过第 3 阶段已有的 Harness 组装丰富的上下文，在 worktree 内通过 **ToolLoop** 实现，只有在测试套件为绿色（由它自己通过终端运行）时才开 PR，遵守按 task 的 token 预算，并在无法完成时带诊断地交回被阻塞的 task。

## 决策 {#decisões}

### 1. ToolLoop 获得通过 hook 的 halt 和 token 上限（叠加式） {#1-toolloop-ganha-halt-via-hook-e-teto-de-tokens-aditivo}

`Engine.Harness.ToolLoop` 只有两种结果（`{:ok, ctx}` /
`{:limit_reached, ctx}`）；生产中没有任何 agent 使用 `.Default`
（Criativo/PO/Arquiteto 各自重新实现了自己的循环）——扩展它风险很低。两种新结果：

- `{:halted, reason, ctx}`：`:post_tool_use` hook 早已支持 `{:halt,
  reason}`（`Engine.Harness.Hooks`），但结果被**丢弃**了
  （`_ = Hooks.run(...)`）。现在 `dispatch/2` 使用 `Enum.reduce_while` 并传播 halt——这正是 DevAgent 用来在它发出完成或阻塞信号的那一轮准确结束循环的机制（第 2 项）。
- `{:budget_exceeded, ctx}`：`ctx.tokens_spent_micros` 累计每次 `llm_turn` 早已返回（却被忽略）的 `usage.costMicros`；
  `ctx.token_budget_micros`（可选，默认 `nil` = 无上限）在下一轮**之前**检查——绝不会超出配置的花费，与 `limit_reached` 同一精神（绝不无限循环，现在也绝不无限花费）。
- `ctx.tools`（工具注册表）和 `ctx.hooks` 成为显式覆盖——`Engine.Harness.Tools.specs/1`/`find/2` 接受替代注册表（默认是固定的那个，保留 EchoAgent/测试）。DevAgent 使用 `Engine.Dev.Tools.registry/0`（没有 `EmitArtifact`；有 `ReportDone`/
  `ReportBlocked`）。
- `ctx.workspace_root` 覆盖文件/AGENTS.md 的根（默认是项目的共享 workspace）——`WorkspaceFiles`、`InstructionFiles` 和 `ContextBuilder.build_layers/3` 开始接受这个显式根。DevAgent 传入 **worktree**——ReadFile/WriteFile/SearchWorkspace 以及读取的 AGENTS.md 在正确的分支/提交上操作，而不是在共享克隆上。
- **worktree 中的终端**（对真实缺口的修正）：`TerminalExecutor.run/3` **总是**在项目的共享 workspace 中运行，从不在 agent 的 worktree 中——不修正的话，DevAgent 的测试会在它所修改的代码之外运行。可选的 `cwd` 一路流转：`ActionPipeline`（`terminal` 工具的 payload）→ `ExecuteTerminalActionUseCase`/`ApiToEngineClient`（api）→ `POST /internal/actions/execute` → `TerminalExecutor`（engine）。

### 2. 终止纪律——ReportDone/ReportBlocked 被**强制执行** {#2-disciplina-de-término--reportdonereportblocked-enforçados}

`Engine.Dev.Tools.ReportDone` 不信任 LLM：它在历史中查找**最后**一条 `tool` "terminal" 消息，并**要求**它以 `"exit 0"` 开头（`ActionPipeline.terminal_result/1` 的确切格式）——否则返回错误（模型会再试）。`ReportBlocked` 总是接受 `{reason, diagnosis}`。一个新的 `:post_tool_use` hook（`Engine.Dev.Hooks.Termination`）在两者之一成功时 halt 循环——使用第 1 项的机制。`DevAgentServer` 处理 `ToolLoop.run/1` 的 5 种可能结果：`report_done`（开 PR）、`report_blocked`、`limit_reached`、`budget_exceeded` 以及 `{:ok, ctx}`（模型停止却没有发信号——作为安全阻塞处理）。没有任何路径会在没有绿色测试套件证明的情况下开 PR；没有任何路径会让 task 卡住而没有结局。

### 3. 引用故事的 PR + in_review 状态 {#3-pr-referenciando-a-story--status-in_review}

`taskStatusEnum` 增加 `'in_review'`（`todo → in_progress → in_review →
done`；转到 `done` 留待 QA 存在时——不在范围内）。PR 正文是故事 DoD 的 Markdown 检查清单（`- [ ] item`）；标题引用故事+task。上下文来自 `GetDevTaskContextUseCase`（api，新增）：完整的故事（RF/RNF/DoD/DoR）、已解析的业务规则（`session_events` `artifact.business_rule`，与 `CreateStoryUseCase` 同一模式）以及项目的 ADR（不按模块过滤——与 `GetArchitectureUseCase` 相同的简化，已记录）。

### 4. 按 task 的预算——在 engine 中解决，无需新表 {#4-orçamento-por-task--resolvido-no-engine-sem-tabela-nova}

预算（`budgets` 表）只限定到项目**或**会话；task 没有自己的会话（一个模块的所有 task 都在同一个执行会话中运行）。没有对 `budgets`/`token_usage` 做侵入性迁移，而是**完全**在 engine 中解决按 task 的上限：每个 `run_task` 调用 `ToolLoop.run/1` **一次**，因此累计的 `tokens_spent_micros` **就是** task 的成本，按执行隔离。`taskBudgetMicros`（启用时可配置，`POST execution/activate`，省略时默认 US$0,50）流经
`ActivateExecutionUseCase` → `startExecution` → `dev_agent_states`（新列，迁移）→ `ToolLoop` 的 `ctx.token_budget_micros`。

### 5. task 阻塞——重新领取的强制执行 {#5-bloqueio-de-task--enforcement-de-reclaim}

`tasks` 增加 `blocked boolean` + `blocked_reason text`（迁移）。阻塞**不是**新的状态值（task 回到 `todo`）——它是一个正交的 flag。`ClaimNextTaskUseCase`/`claimNext` 在原子 claim 中排除 `blocked = true`——否则，一个长期不可能完成的 task 会在循环中被重新领取、再次阻塞。人在阅读诊断后通过 `UnblockTaskUseCase`
（`POST sessions/:id/tasks/:id/unblock`）解除。

### 6. 并发测试发现的真实 bug：`FOR UPDATE OF t` {#6-bug-real-achado-pelo-teste-de-concorrência-for-update-of-t}

N 个同时 claim 的测试（第 6 项）暴露出，`claimNext` 的 `FOR UPDATE SKIP LOCKED` 在没有 `OF t` 时也会试图锁住 join 中 `stories` 的行——由于多个 task 共享**同一个**故事，这会通过故事的锁把并发 claim 串行化（SKIP LOCKED 丢弃它们而不是尝试另一个 task），即使有可用的 task 也会丢失 claim。用 `FOR UPDATE OF t`（只锁 `tasks` 的行）修正。如果没有真实的并发测试（只有顺序测试，就像上一次会话那样），这个 bug 会被忽视。

## 后果 {#consequências}

- UI：实时显示当前 task/迭代/花费的 token（通过增强的 `agent.response`，已有的轮询）；被阻塞的 task 突出显示（沿用“Pendências de validação cruzada”已使用的样式）。
- 测试：`tool_loop_test`（通过 hook 的 halt、token 上限、自定义注册表）；`dev_agent_server_test`（正常流程、不可能的 task → blocked、预算超支 → blocked、没有绿色套件的 report_done → 被拒绝）；`claim-next-task`（真实并发——发现了第 6 项的 bug）；`mark-task-blocked`/`get-dev-task-context`（新增）。

## 范围与假设 {#escopo--assunções}

只有 **DevAgent**（取代 Noop）——QA/SecOps/Infra 以及经由 Phoenix 通道的完整团队面板仍不在本次会话中。`in_review → done` 留待 QA 存在时。按模块的 ADR 仍然没有真正的过滤（项目的所有 ADR）。DevAgent 的上下文窗口固定为 128.000 个 token（TODO：当 LLM 轮次把它返回给 engine 时，使用所解析模型的真实窗口——今天 engine 从不知道这个数字）。
