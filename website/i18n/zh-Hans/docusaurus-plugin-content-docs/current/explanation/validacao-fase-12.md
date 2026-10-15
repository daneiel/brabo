---
id: validacao-fase-12
title: 三项发现已经消亡的验证
sidebar_label: Fase 12 的验证
sidebar_position: 5
description: 一份可审计的脚本流程，在一次执行中演练采用、手动晋升和重新调度——事件 id 从数据库提取，并说明该验证有意不证明的内容。
keywords: [验证, Fase 12, dogfooding, 采用, 重新调度, 晋升]
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# 三项发现已经消亡的验证

[第一次 dogfooding 的收获](./primeiro-dogfooding.md)留下了三项 P1 级的可操作性发现。Fase 12 逐一处理了它们；本文档证明这三项是在**同一次执行中**消亡的，而不只是在每个切片为自己编写的单元测试中。

验证是一个脚本：`pnpm --filter api validacao:fase-12`。当标准未满足时，它以非零代码退出——它是验收标准，不是报告——并在最后打印**从数据库读取**的证据表。下面的 id 不是手工抄写的。

## 它**不**证明什么 {#o-que-ela-não-prova}

这一部分放在最前面，而不是脚注里，因为一个隐藏自身局限的验证还不如没有。

**不证明远程 GitHub。** 采用针对 `LocalGitProvider` 运行。原因不是图方便：Fase 10 中使用的 fork **从未被命名**——任务的第 135 行仍然是 `TODO(humano): qual owner/repo do fork?`——所以没有可以重新采用的目标。被演练的路径在两个 provider 中是相同的（`getRepo` → 计划 → `origin: 'adopted'`）；不同的是网络，而这一差异由冒烟测试 `adopt-repository.smoke.spec.ts` 覆盖，它只在有真实的 `ADOPT_TEST_REPO` 和 `GITHUB_TEST_TOKEN` 时运行。

**不证明 gate 的判断。** QA 和 SecOps 是 LLM agent。这里裁决通过 `RecordGateVerdictUseCase` 进入——它是它们的意见所经过的**真实**漏斗，也是 outbox 行 `task.gate_resolved` 诞生的地方。Fase 12b 需要证明的是裁决 → outbox → wake → claim 这条链，而不是模型是否会读测试套件。判断仍由 Fase 4a 的验收覆盖，[ADR 0020](../adr/0020-destravar-gates-qa-secops.md) 明确声明它们在本地模型下**不是确定性的**。

**不做合并。** 受保护分支上的合并按设计是用户的决定（[RN-014](../business-rules.md#rn-014)）。脚本流程的第 6 步展示了在自主度为 `auto_approve`、`permissions.json` 全部放行的情况下，锁恰恰拒绝了这一点。

**任何地方都不使用 LLM。** dev 是 `NoopDevAgentServer`。它不编写真正的代码——但自 Fase 12d 起它演练的是与真实 agent **相同的状态机**（`Engine.Dev.AgentIo`），而这正是这里被测试的东西。在那之前，Noop 处理一个 task 就停下：发现 #10 在测量工具自身内部存活，这会因为工具而不是产品的缺陷而让"零重启"标准失败。

## 脚本流程 {#o-roteiro}

| # | 步骤 | 断言的内容 |
|---|---|---|
| 0 | 创建项目 | 诞生时就是 `story_promotion = manual`，**无需任何人配置任何东西** |
| 1 | 采用一个预先存在的 bare repo，带 `main` 和 `develop`，没有 `qa` 也没有 `rc` | `origin = 'adopted'`；计划诊断出缺失的分支**和**模板之外的分支；`plan_decision` 保持**为空**；没有手工插入任何行 |
| 1b | 决定"按原样采用" | 模板**不**被强加于用户的仓库（[RN-045](../business-rules/custo.md#rn-045)） |
| 2 | PO 创建一个完整的故事，带 3 个任务 | 故事处于 `draft` + `proposed_ready`；**`claimNext` 返回 `null`** |
| 3 | 用户晋升 | 故事变为 `ready`；提议离开队列；事件记录 `user`，而不是 `agent/po` |
| 4 | 激活执行并依次解决 3 个 gate | 3 个任务、1 个 agent、**engine 0 次重启** |
| 5 | 空队列 | 显式的 `dev.idle`，进程存活 |
| 6 | 在一切放行的情况下提议合并到受保护分支 | `pending`——仍然是你的决定 |

第 2 步以可验证的方式消灭发现 #13：故事处于 `draft` 还不够，还必须**没有任何东西可被认领**。因此脚本直接调用 `claimNext` 并要求得到 `null`。第 4 步消灭 #10：从第二轮起没有人触发 `:work`——agent 自己认领，由上一轮的 `task.gate_resolved` 唤醒。

## 证据 {#a-evidência}

把脚本打印的表格贴在这里。每一行都是数据库中存在、之后可以查询的 `session_events.id`（ULID）。

执行于 **2026-08-07**，退出码 `0`，dev 栈处于运行状态，脚本在 api 容器内部运行。下面的 id 在这次运行中直接从数据库取出——项目 `f84f7226`、backlog 会话 `680ab9e9`、执行会话 `91f384fa`。

| 阶段 | 事件 | id | seq |
|---|---|---|---|
| 1. 采用 | `bootstrap.repository_adopted` | `01KZCW6SBGZZ5J2DTNKR35EQPC` | 1 |
| 1. 采用（按原样） | `bootstrap.adopted_as_is` | `01KZCW6SETRNVJEX5V018GY5Q0` | 2 |
| 2. PO 提议 | `backlog.story_promotion_proposed` | `01KZCW6SGJJQX623FW4TQ28ZV3` | 3 |
| 3. 你晋升 | `backlog.story_transitioned` | `01KZCW6SH7F14Y1QCJQHNJNF50` | 4 |
| 4. dev 认领 | `dev.working` | `01KZCW6SWFY33TF8DDX9MYHG40` | 5 |
| 4. PR 已打开，等待 gate | `dev.awaiting_gate` | `01KZCW6TB712EMZCC29WDK7YJC` | 14 |
| 4. dev 认领 | `dev.working` | `01KZCW6VAYQD1R0XH6J3VKKKJ9` | 18 |
| 4. PR 已打开，等待 gate | `dev.awaiting_gate` | `01KZCW6VQ3TZSH72CHAECBHZSX` | 27 |
| 4. dev 认领 | `dev.working` | `01KZCW6XA40AVK9N71PPRWKG4N` | 31 |
| 4. PR 已打开，等待 gate | `dev.awaiting_gate` | `01KZCW6XKXYTNW6ARDWF4VRW42` | 40 |
| 5. 空队列，agent 空闲 | `dev.idle` | `01KZCW6Y812HAPVG3ZYS2CM6WA` | 43 |

三对 `dev.working` → `dev.awaiting_gate` 就是三个 task，**只有一个 agent，其间 engine 没有重启**——发现 #10，由执行而不是单元测试证明。最后的 `dev.idle` 就是第 5 步：队列为空，进程存活而不是死亡。

## 第一次执行的代价 {#o-que-a-primeira-execução-custou}

上面的表格经过了**四次修正**才得以存在，值得记录是哪四次，因为其中三次属于**测量工具**，一次属于**产品**——这一区分正是要点。

**在测量工具中**（脚本和 `NoopDevAgentServer`）：

1. 试验对象诞生在 `os.tmpdir()`，位于容器本地。执行采用的是 api；为组装 worktree 而克隆的是运行在 engine 中的 dev agent。bare 位于 api 的 `/tmp`，engine 看不到它。它改为诞生在 `GIT_LOCAL_REPOS_ROOT`，即共享卷——脚本自己的文件头早已把它声明为前置条件。
2. Noop 把 task 标为 `in_review` 就停在那里，没有调用 `open_gate`：`tasks.gate_status` 保持 NULL。`awaiting_gate` 却没有打开的 gate，也没有可以评判的东西。
3. 当 agent 已经处于 `:awaiting_gate` 时到来的 `{:pr_settled, %{opened: true}}` 在 Noop 中没有对应子句。`FunctionClauseError`，而由于 server 是 `restart: :temporary`，进程就彻底死亡了。

这三项是同一个故事：Noop 在 Fase 12d 中与真实 agent 对齐了，但没有跟上之后的变化。这正是本文档早已点名的风险——*"发现 #10 在测量工具自身内部存活"*——如今又有了三个新实例。

**在产品中**，而这是只有真实执行才能发现的：

4. 队列为空时，`POST /internal/sessions/:id/tasks/claim` 以 `201` 响应，`content-length: 0`。用例返回 `null`，但 NestJS 把它序列化为**空**响应体；`Req` 交出的是 `""`，它不是 `nil`，于是 `AgentIo.try_claim/2` 匹配到"找到 task"的子句——调用 `run_task("")` 并抛出 `BadMapError`。

   `try_claim/2` 位于 `AgentIo` 中，**与真实的 `DevAgentServer` 共享**：每个 dev agent 都会在其模块队列清空的那一刻死亡，而那是最常见的结局。而且是彻底死亡——server 是 `restart: :temporary`，`Monitor` 随后删除状态行。这与 Fase 12b 交付的恰恰相反：不是被监督、可由事件唤醒的 `dev.idle`，而是死掉的进程。

   测试套件从未发现它，因为 fake 正确地返回了 `nil`。它已在边界处修正（`claim_task/4`），并由契约守护（`try_claim/2`），没有改动路由的 HTTP 状态码。

发现 4 是对本阶段存在所要提出的问题的实证回答：真实执行证明了什么测试证明不了的东西。

如果它声称已演练的某个阶段没有在 event log 中留下证据，脚本拒绝以成功结束——没有这项检查，一次错误的查询会产生一张短表而验证照样通过，这正是生成式报告的经典失败模式。

## 之前 × 现在 {#antes--agora}

**Fase 10** 一列只引用可以从书面记录中推导出来的内容。凡是依赖实时计数的，都显示为 `não medido`，原因在[收获](./primeiro-dogfooding.md)中解释。

| | Fase 10 | 现在 |
|---|---|---|
| 把项目指向一个已有仓库 | 在两张表中手工 seed，**在第一次会话之前**（`dogfooding-mission.md:104-134`） | 采用路由；`origin = 'adopted'`；零手工写入 |
| 仓库的策略存在分歧 | 没有诊断——引导是唯一途径，而它会强加模板 | dry-run 计划**描述**分歧，未经批准不应用任何东西 |
| 每交付一个 task 的 engine 重启次数 | **1，由构造决定**——发现 #10 的性质（`:666`），不是估计。实际总数：**未测量** | **0** |
| 批次 | 整个阶段都按批次运行（`:393-416`） | 不存在：agent 独自走完模块队列 |
| 没有 task 的 agent | 进程死亡（`restart: :temporary`） | 显式的 `idle`，被监督，可由事件唤醒 |
| 连续失败 | 连续烧掉预算 | 熔断器停在 `idle_tripped`（[RN-047](../business-rules/custo.md#rn-047)） |
| 故事 → `ready` | 创建时自动完成，没有人工步骤（发现 #13，`:669`） | 用户的决定，操作者记录在 event log 中（[RN-048](../business-rules/custo.md#rn-048)） |
| 拒绝一个故事 | 没有状态、事件或按钮（发现 #14） | 退回给 PO，理由固定在其会话中 |
| 人工干预总数 | **未测量**——观察表留空（`:488-490`） | 审批流水线中的那些，本阶段**没有**改变它 |
| 合并到受保护分支 | 手动，按设计 | 手动，按设计——不变，第 6 步证明了这一点 |

最后一行与其他行同样重要。Fase 12 是关于 agent 不在任务之间死亡、关于决定回到用户手中；它**不**扩大任何自主度。审批流水线与原来完全一样。

## 如何运行 {#como-rodar}

```bash
# a stack de dev de pé (api e engine compartilhando /data)
pnpm dev

# de dentro do container da api
docker compose -f docker/docker-compose.yml exec api \
  pnpm --filter api validacao:fase-12
```

如果某项标准未满足，脚本会说出是哪一项——消息以 `CRITÉRIO NÃO FECHOU:` 开头，并点名失败的断言。
