---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0057 — gate agent 等待审批，就像 dev 那样等待

- **状态：** 已接受
- **日期：** 2026-08-07
- **背景：** FASE 13b，发现 AB
- **扩展：** [ADR 0052](0052-dev-agent-espera-aprovacao-no-meio-do-laco.md)

## 背景 {#contexto}

[ADR 0052](0052-dev-agent-espera-aprovacao-no-meio-do-laco.md) 为 **dev agent** 解决了一个工具在循环中途需要审批的问题：agent 保留历史并**挂起**，决定到来时用真实结果替换原本是 `pending` 一词的位置，恢复执行。

**gate** agent 被排除在那次修正之外，而没有人注意到，因为没有任何执行能走到它们那里。FASE 13b 走到了。

在第 6 次真实执行中，`qa-automacao` 运行了：

```
ls -la && find . -name "AGENTS.md" -o -name "package.json" | head -50
```

一个复合命令，其中一个片段不在 `allow` 中——被正确地拒绝，并被 `ToolLoop` 正确地挂起。接下来发生的就是缺陷：`QaLeadServer` 没有处理这种结局的子句，落入了兜底分支，并记录：

```
delegation.failed  failureOrigin: "infra"
"QA de Automação não concluiu o parecer — desfecho inesperado do ToolLoop"
```

一次同时错了两件事：

1. **task 被阻塞**，原因是一个没有人作出的决定；
2. **来源是假的。** 没有任何基础设施失败。这违反了 [ADR 0020](0020-destravar-gates-qa-secops.md) 确立的规则：来源要**点名**，绝不靠排除法得出。

## 决策 {#decisão}

**gate agent 挂起和恢复，与 dev agent 完全一样。**

子 agent 获得第三种结局，与 `{:ok, parecer}` 和 `{:blocked, info}` 并列：

```elixir
{:awaiting, %{action_id:, tool_call_id:, tool_name:, ctx:}}
```

整个 `ctx` 随之传递——正是它让恢复成为可能，这与 ADR 0052 的选择相同。

**Lead** 变成等待的一方。它本来就是每个项目一个的 `GenServer`，于是获得了三样东西：

- 以**子 agent**（`qa-automacao`、`qa-performance-seguranca`）的身份订阅 `Engine.Dev.Wake`，因为 `task.action_settled` 按**提出**动作的参与者作为键到达，而提出者是子专业；
- 保存进行中的状态（`pendente`）——被挂起的委派、已经收集到的、还剩什么要跑；
- 在收到带有它所等待的 `action_id` 的 `{:action_settled, ...}` 时，恢复那个子 agent，并**从停下的地方继续该领域**。

### 形态上改变了什么，以及为什么 {#o-que-mudou-de-forma-e-por-quê}

`rodar_ativas` 原本是对活动委派的 `Enum.map`：一条直线，没办法在中途停下。它变成了 `continuar_area/4`，在剩余列表上递归，并累积已收集的结果。正是这种形态让它能在两次委派之间挂起而不丢失第一次。

## 后果 {#consequências}

**审批不再杀死 gate。** 待处理期间，该领域不汇总、不发出裁决、也不阻塞 task——它等待。用户的点击解除阻塞，而不是来得太迟。

**拒绝也会恢复。** 原因填入结果的位置，agent 学到那条路走不通了，而不是永远等待。与 ADR 0052 同样的规则。

**来源 `infra` 不再用于待处理的决定。** 兜底分支中剩下的是真正意外的结局。

### 这**不**解决什么 {#o-que-isto-não-resolve}

它不消除审批，也不应该消除。允许清单仍然是封闭列表，agent 仍然会发明命令——FASE 13b 的发现 **X**、**Z** 和 **AD** 仍然未关闭。改变的是后果：以前是一堵墙的东西，变成了一个决策队列。

**等待中途重启会丢失循环。** `pendente` 存在于 `QaLeadServer` 的内存中，而它是 `restart: :temporary`。dev agent 通过在 `dev_agent_states` 中持久化状态解决了这个问题；gate 没有对应的表，创建它是单独的范围。这被声明为已知限制——当 task 回到周期中时，gate 会由 `Dispatcher` 重新运行。

## 考虑过的替代方案 {#alternativas-consideradas}

**让 gate 完全自主运行**，不经过审批管道。拒绝：gate 在 dev 的 worktree 中运行命令，而这个边界之所以存在，正是因为它执行的是第三方代码。用一个洞替换一堵墙不是解决办法。

**只修正来源**（`infra` → `politica`），不挂起。这是中间步骤，但不够：gate 仍然会死，只是带着正确的标签。诚实，但无用。
