---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# 0048 — event log 中的决定，以及 gate 的顺序

## 背景 {#contexto}

dogfooding 的两个发现，第 12 阶段已登记但未修正。之所以一起重新审视，是因为它们属于同一类缺陷：**一个重要的事实发生了，却没有被写在任何能充当记忆的地方。**

### 发现 #17——动作的决定不存在于日志中 {#achado-17--a-decisão-de-uma-ação-não-existia-no-log}

`proposed_action.created`、`.approved` 和 `.denied` **只进入 outbox**。
outbox 是传输：它被排空、标记 `processed_at` 并被修剪。决定只在 `proposed_actions.decided_at` 中留存，这一列说明**何时**，却不出现在 UI、Psicólogo 和 Anamnese 读取的时间线上。

两个后果，第二个只在撰写本 ADR 时才显现：

1. **第 10 阶段的主要指标无法采集。** “审批点击数”是 dogfooding 观察表的核心列，而没有任何查询能产出它。
2. **`docs/reference/events.md` 一直把这三个记录为领域事件。** 文档承诺了代码没有做的事——最糟糕的文档错误，因为读者无从怀疑。

### D5，以及埋在它下面的缺陷 {#o-d5-e-o-defeito-que-estava-embaixo-dele}

[ADR 0045](0045-reagendamento-por-evento-do-dev-agent.md) 把 D5 登记为已知限制：dev 的自主权为 `require_approval` 时，agent 会回收 worktree，待处理的批准会在一个已不存在的路径上执行。它预测正确的修正会是“每个 task 一个 worktree”。

调查以便修正时，情况是另一回事，而且更糟：

**`AgentIo.propose/3` 丢弃了动作的状态**（`{:ok, _action} -> :ok`）。agent 提出 commit、push 和 PR，然后**无条件地**调用 `open_gate` + `run_qa`，而不知道是否有任何东西执行过。在手动自主权下：

1. 三个动作以 `pending` 诞生；
2. gate 照样打开，QA 扫描**worktree**——文件就在那里——并批准；
3. SecOps 批准，task 变为 `done`；
4. `task.gate_resolved` 释放 agent，它领取下一个并删除 worktree；
5. 用户批准 commit，`git add -A` 在一个已经消失的目录中运行。

第 5 步返回 `{"", 2}`——`cd` 到不存在目录的 `System.cmd` 不抛异常——而 `git/2` 把它变成 `{:error, ""}`：动作以**空诊断**失败。

真正的损害不是批准失败。而是**task 在没有提交一行、没有任何 PR 的情况下以完成状态关闭**。而这并不需要奇特的配置：面板上的开关为 `dev-*` 暴露了 `require_approval`。

## 决策 {#decisão}

### 动作的决定成为领域事件，带真实参与者 {#a-decisão-de-ação-vira-evento-de-domínio-com-o-ator-real}

`proposed_action.created`（参与者 = 提出它的 agent）、`.approved` 和 `.denied`（参与者 = 做出决定的**用户**）开始被写入 `session_events`，与已存在的 outbox 行并列。outbox 继续是传输；日志开始成为记忆。

`.created` 的 payload 携带结果 `status`，正是这一点让自动批准**可审计**：统计 `.approved` 事件就是统计**人**的决定；策略自行决定的情况出现在带 `status: auto_approved` 且参与者为 agent 的 `.created` 中，永远不会与一次点击混淆。这正是第 10 阶段指标所缺的区分。

`approve_always` 免费进入：它委托给 `ApproveActionUseCase`。

刻意排除在外的是 `provision-repository` 和 `bootstrap-runner` 直接发到 outbox 的 `proposed_action.created`：那些动作是 bootstrap 的变更，已经在同一会话中由 `bootstrap.step_*` 叙述，复制它们会在审批指标中把同一事实计算两次。

### gate 只在 PR 打开之后才打开 {#o-gate-só-abre-depois-que-a-pr-abre}

`AgentIo.propose/3` 开始返回 `:executed | :pending | :refused`。agent 读取三种结果并且：

- **全部已执行**（自主权 `auto_approve`，即启用时播种的默认值）——像往常一样打开 gate；
- **有待处理的**——进入 `:awaiting_approval`，**保留 worktree**，不打开任何 gate。没有 PR 就没有可评判的东西。

释放 agent 的是 `task.pr_settled`，当 `pr_open` 有结果时由 api 发出——已执行、被拒绝或失败。`opened: true` 打开 gate，晚了但正确；`opened: false` 带诊断地交还 task，而不是让 agent 永远等待一个没人会打开的 gate。

有三件事让这变得廉价：

- **`propose_pr` 的 payload 早已携带 `storyTaskId`**，因此 api 确切知道 PR 打开的是哪个 task，无需新表也无需 join。
- **`aggregateType: 'task'` 自第 12b 阶段起已由 `Engine.Outbox.Drain` 排空**——没有新的聚合类型，没有新的 worker，只是 `DevAgentWakeWorker` 中多了一个子句。
- **`dev_agent_states.status` 是 `:string`**，不是枚举——新状态不需要迁移。

被拒绝的 PR **不计入 circuit breaker**。决定是用户做的；agent 没有烧掉任何上限。这与重启恢复早已适用的原则相同（RN-047）。

### 为什么**不是**每个 task 一个 worktree {#por-que-não-worktree-por-task}

ADR 0045 预测每个 task 一个 worktree 是 D5 的修正。这一预测**没有兑现，原因是它修错了症状**：每个 task 一个 worktree 能防止目录消失，但 gate 仍会评判一个不存在的 PR，task 仍会在没有提交的情况下关闭。缺陷不在删除——而在 gate 打开得太早。

顺序修正之后，D5 作为后果消亡：worktree 只在 `gate_resolved` 时被回收，gate 只在 PR 打开之后才打开，而 PR 只在 commit 和 push 执行之后才打开。**没有任何待处理的动作会比它自己的 worktree 活得更久**，无需改动目录结构，无需增加磁盘，也无需新的清理策略。

## 后果 {#consequências}

`docs/reference/events.md` 不再在三种事件类型上撒谎——而比较文字与发出点的生成器，现在真正找到了这三个。

第 10 阶段丢失的指标开始存在。下一次 dogfooding 可以用一个查询回答“人做了多少次决定”，而不是靠现场记录——而那正是因为没有做而丢失的东西（见[收获报告](../explanation/primeiro-dogfooding.md)）。

`session_events` 的量会增长：每个被提出的动作多一个事件。这些动作本就在执行中被叙述（`action.executed`/`action.failed`）；缺的是开始和决定。

engine 测试 fake 的默认值从 `pending` 改为 `auto_approved`。在状态被丢弃时这没有区别；从此有区别了，而 `auto_approved` 是现实所产生的——`ActivateExecutionUseCase` 为每个 dev agent 的 git 动作播种 `auto_approve`。与生产不同的默认值会让整个测试套件走手动审批的路径。

留待以后，作为 backlog：

- **每个 task 一个 worktree**，如果有一天出现批准耗时足够长、以致 worktree 因其他原因造成困扰的情况。它不再是缺陷修正，而成为架构选择。
- **空诊断的 `git/2`。** `cd` 到不存在目录的 `System.cmd` 返回 `{"", 2}`，这会在任何目录失败中变成 `{:error, ""}`，不只是这一次。这次的根因已关闭，因此空消息不再有已知的触发——但诊断上的漏洞仍在那里。
- **非 `pr_open` 类型的待处理动作。** 这个互锁覆盖的是 dev agent 的路径，那里的损害是具体的。待处理的 `terminal` 仍不阻塞任何东西，也不需要。
