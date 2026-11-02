---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0052 — dev agent 在循环中途等待审批

- **状态：** 已接受——已在阶段 A 中实现并由测试证明
- **日期：** 2026-08-05
- **背景：** FASE 13b——dev agent 第一次用 API 模型真实执行

## 背景 {#contexto}

dev agent 的 `terminal` 是一个 `:pipeline` 工具：钩子 `Engine.Harness.Hooks.ActionPipeline` 在 api 中创建一个 `proposed_action`，api 通过 `permissions.json` 作出决定。当决定是 `auto_approve` 时，api 立即执行，钩子返回命令的真实输出。当决定是 `require_approval` 时，钩子把**字符串** `proposed_action <id> status pending` 作为工具结果返回——而 ToolLoop 继续下一次迭代。

agent 无法等待。它读到“pending”，对命令一无所获，尝试别的东西，每次尝试都消耗上限中的一次迭代。

在一次真实执行中（项目 `saudacao-local`，任务 `cd652d85`），结局是：

```
toolloop.limit_reached  {"iteration": 8, "max_iterations": 8}
backlog.task_blocked    {"reason": "limite de iterações atingido"}
```

八次迭代被烧掉，一行都没写，而用户给出的审批在循环已经耗尽之后才到达——它们毫无用处。

### 为什么允许清单解决不了 {#por-que-a-allowlist-não-resolve}

`DEV_TERMINAL_ALLOW_PATTERNS` 正是为了避免这种情况而存在的，`activate-execution.use-case.ts:139-144` 中的注释精确地描述了这种失败。但它是一份预见到的命令的列表，而模型会发明命令。在加入读取类命令（`ls`、`find`、`pwd`、`cat`……）之后，同一个 agent 前进了不少——worktree 创建、命令 `exit 0`、文件被读取——然后又卡在 `git branch -a` 和 `git rev-parse` 上。

每个新模型、每个新技术栈，都有一个新漏洞。允许清单是缓解，不能是答案。

### 已经存在并证明了这条路的东西 {#o-que-já-existe-e-prova-o-caminho}

`:awaiting_approval` **已经是** dev agent 的一个状态，在 Fase 12e 中为任务结束而创建：当 `pr_open` 处于待处理时，agent 保留 worktree，并由 `task.pr_settled` 释放，后者由 api 发出、经 `DevAgentWakeWorker` 路由。整个机制——持久化的状态、worktree 的保留、outbox 事件、worker、`Wake.deliver`——都已就绪并经过演练。

缺的是把它应用到循环中途，而不是发明它。

## 决策 {#decisão}

当一个 `:pipeline` 工具返回 `pending` 时，ToolLoop **停下**，agent 进入 `:awaiting_approval` 并保留一切。用户的决定发出一个唤醒它的事件，循环**从停下的地方恢复**，在原本是字符串“pending”的位置上放入命令的真实结果。

### 为什么停下而不是阻塞等待 {#por-que-parar-em-vez-de-bloquear-esperando}

显而易见的替代方案——钩子以轮询等待决定——更简单，但是错的：ToolLoop 在 agent 的 **GenServer 回调**内部运行（`dev_agent_server.ex:365`）。在那里阻塞会锁住本来会带来决定的邮箱本身，还有优雅关闭和熔断器。停下再通过消息恢复，正是 `pr_settled` 已经在做的，理由也相同。

### 消息保留在内存中 {#as-mensagens-ficam-em-memória}

agent 等待期间，循环的 `ctx`（带历史）留在 GenServer 的状态中。不持久化：agent 仍然活着，只是空闲。这保持了重启恢复已经声明的属性——回合和消息只存在于内存中，任务期间的重启会带诊断地阻塞（`dev_agent_server.ex:153-159`）。跨越重启的待处理审批落入同一条路径，它是诚实的，并且已经存在。

## 五个部件 {#as-cinco-peças}

| # | 位置 | 内容 |
|---|---|---|
| 1 | `apps/api/.../approve-action.use-case.ts`、`deny-action.use-case.ts` | 当动作的参与者是 dev agent 时发出 `task.action_settled`——带 `actionId`、`status` 以及执行结果 |
| 2 | `apps/engine/.../hooks/action_pipeline.ex` | 收到 `pending` 时，发出停止信号，而不是返回字符串 |
| 3 | `apps/engine/.../harness/tool_loop.ex` | 支持 `{:awaiting_approval, action_id, ctx}` 作为结局，与已有的 `halted` 并列 |
| 4 | `apps/engine/.../dev/dev_agent_server.ex` | 保存 `ctx`，持久化 `:awaiting_approval` + `action_id`，并在收到 `{:action_settled, …}` 时恢复 `ToolLoop.run/1` |
| 5 | `apps/engine/.../workers/dev_agent_wake_worker.ex` | 把 `task.action_settled` 路由给 agent，就像它已经对 `task.pr_settled` 做的那样 |

### 拒绝也是回答 {#recusa-também-é-resposta}

被拒绝的动作以拒绝的原因代替结果恢复循环——agent 学到那条路已经关闭，并尝试另一条。拒绝不会阻塞任务：它是用户的决定，`pr_settled` 带 `opened: false` 时的同一原则在这里适用（不计入熔断器）。

### 等待上限 {#teto-de-espera}

没有尽头的等待就是换了个名字的不死会话。agent 等待直到任务的不活动上限；超过时，以 `origin: política` 阻塞——任务停下是因为没人作出决定，这不同于代码或模型的缺陷。

## 后果 {#consequências}

**有利的**

- agent 不再在它无法执行的东西上烧迭代，用户的审批无论何时到达都开始有效。
- 允许清单不再是唯一的防线，回到它被设计的角色：免除例行事务的审批，而不是让 agent 能够运转。
- 用户开始在消息流中看到 `dev.awaiting_approval`，并知道 agent 在等**他**，而不是看到一个因“limite de iterações”而被阻塞的任务。

**不利的**

- 一个等待中的 agent 占用 worktree，不领取下一个任务。这与 `awaiting_gate` 中已经接受的代价相同，理由也相同：worktree 是按 **AGENT** 的，而不是按任务的。
- 内存中的 `ctx` 意味着等待期间的重启会丢失回合。它留在已经存在的带诊断的阻塞路径上；持久化消息历史是另一个问题，不属于本 ADR。

## 考虑过的替代方案 {#alternativas-consideradas}

**提高 `max_iterations`。** 只是推迟：在有待处理审批时，每次迭代都被浪费，所以任何上限都会被达到。

**通过 `agent_autonomy` 自动批准 `terminal`。** 会放行 engine 容器内的**任何**命令，而这正是 `dev-terminal-patterns.ts:11-15` 所拒绝的——用文件的话，`deny` 继续胜过 `allow`，`BUILTIN_DENY_PATTERNS` 仍然有效。

**在钩子中轮询。** 会锁住 GenServer，如上所述。

## 参考 {#referências}

- [ADR 0045](0045-reagendamento-por-evento-do-dev-agent.md)——本 ADR 所扩展的状态机和按事件的重新调度
- [RN-047](../business-rules/custo.md#rn-047)——dev agent 的熔断器
- 真实执行：项目 `saudacao-local`，任务 `cd652d85`，2026-08-05
