---
traducao_de: 23e727d97992c1974a3df731360a293b67fd669c
---

# ADR 0022 — 阶段 4b 的收尾（第 1 次会话）：能送达的证据、能显示的成本、能在 kill 之后存活的分析

- 状态：已接受
- 日期：2026-07-25
- 阶段：4b（第 1 次会话的收尾——真实的 Psicólogo 本身是 ADR 0015）

## 背景 {#contexto}

ADR 0015 交付了真实的 Psicólogo：`session.closed` 的消费者、组装好的上下文、经由 ToolLoop 的结构化
假设、在领域中校验的证据、通过唯一部分索引实现的幂等性、按 tier 的成本分诊。这些在这里都没有被撤销。

缺的是 ADR 0019/0020/0021 为阶段 4a 迈出的那一步：运行验收标准，发现只有运行时才会出现的问题。
对照需求对三个应用的审计发现了具体的偏差——其中三处从字面上破坏了验收标准，而且标准从未被执行过
（之前的每个阶段都有一个 `demo:*`；Psicólogo 没有）。

## 决策 {#decisões}

### 1. 可导航的证据要求按 ID 获取事件 {#1-evidência-navegável-exige-buscar-o-evento-por-id}

证据 chip 导航到 `/projects/:id/sessions/:sid?highlightEvent=:eid`，`SessionPage` 滚动到
`#event-<id>`。有两件事让这个目的地不存在：

- `ActivityFeed` 隐藏机器噪声（`agent.response`、`tool.call`、`tool.result`、`agent.status`、
  `agent.delta`、`context.compacted`），还会应用 agent/类型过滤器。这些**恰恰**是 Psicólogo 引用
  最多的事件——agent 的行为就在那里。chip 导航过去了，界面却什么都没显示。
- `useSessionEvents` 获取 `{ limit: 200, latest: true }`。最近 200 个事件之外的证据是不可达的——
  而 `activity.ts` 自己的注释记录了一份有 193 个事件的真实日志。

两项修正，在性质上有意不同：

**`GET /projects/:projectId/sessions/:sessionId/events/:eventId`**（新增，`viewer`），基于
`GetSessionEventUseCase`，它复用 `SessionEventRepository.findById`，并采用与
`ProposeHypothesesUseCase.resolveKnownEventIds` **相同**的归属检查（存在**且**属于这个会话；其他
会话的 id 返回 404）。`SessionPage` 把被引用的事件**固定在日志面板顶部**渲染。这与分页和过滤无关——
它是证据能够送达的结构性保证。

**`ActivityFeed` 永远不隐藏被高亮的事件**，即使它是机器噪声，即使过滤器处于激活状态。一个看不见的
高亮，就是一次什么也到达不了的导航。

为什么两者都要而不是只要一个：固定的事件解决一般情况；过滤器中的例外让高亮在事件**也**在时间窗中时
保持一致——没有它，用户会在顶部看到事件，却在日志中看不到高亮。

### 2. 每次分析的成本存在，却在任何地方都不显示 {#2-o-custo-por-análise-existia-e-não-aparecia-em-lugar-nenhum}

`GetPsychologistAnalysisCostUseCase` 已在 DI 模块中注册，却**没有任何 controller 注入它**。它的
docstring 声称是“UI 在 Insight 卡片中显示的数字”——没有路由，没有 UI，没有测试。“在计量中可见
轻型与重型分诊之间的不同成本”无人可以验证。

`GET /projects/:projectId/psychologist/analyses`（`viewer`），基于
`ListPsychologistAnalysesUseCase`，它把当前的分析与假设计数（一次分组查询，而不是 N 次）以及来自
`token_usage` 的汇总成本结合起来。UI 在洞察分区顶部获得了一条分析条带：tier、事件计数、假设、成本
以及指向会话的链接。

成本是按被分析的**会话**计算的，而不是按分析行——`token_usage` 按会话 + 操作者记录，不引用分析。
在被重新分析的会话中，数字是各轮累计的，这对“Psicólogo 在这个会话上花了多少”是正确的；因此字段叫
`costMicros` 而不是 `analysisCostMicros`。

### 3. 没有 Lifeline，“重启后的分析”是不可能的 {#3-sem-lifeline-análise-pós-restart-era-impossível}

`config :engine, Oban` 有 `plugins: [Oban.Plugins.Pruner]`。使用 `Oban.Engines.Basic` 时，一个在
`executing` 时被 SIGKILL 的 job 不会回来：节点死去时没有标记结果，该行永远孤立在 `executing`，
worker 的 `max_attempts: 5` 从未发挥作用。“kill engine 后在重启时产生分析”这一要求无法成立。

`{Oban.Plugins.Lifeline, rescue_after: :timer.minutes(5)}` 加入了插件。它有意适用于**所有**
worker（Psicólogo、Anamnese、outbox 的 drain）——孤立是机制的问题，而不是某个 worker 的问题。

守护这一点的测试（`Engine.ObanDurabilityTest`）断言的是配置，而不是行为：每个 worker 测试都直接调用
`perform/1`，因此孤立场景只在真正运行 engine 时才存在。配置测试是防止无声回归的东西；真实场景留在
验证 runbook 中。

### 4. 失败分支中的 `:ok` 杀死了重试 {#4-ok-num-branch-de-falha-matava-a-retentativa}

`PsychologistWorker.perform/1` 在上下文没来时返回 `:ok`，注释写着“让 Oban 重试”。在 Oban 中，`:ok`
把 job 标记为 `completed`。如果在 drain 时 api 不在线，分析会悄无声息地消失。

现在它返回 `{:error, reason}`。这个分支中有意不叙述 `analysis_failed`：叙述的路径就是 api 自己，而
正是它不在线——在此期间记录结果的是 job 的那一行。

`reason_for/1` 也开始查看 `ctx.last_error`，ToolLoop 在 provider 失败时会填充它。没有它，provider
超时被叙述为“结束了却没有发出假设”——这是在 QA 和 Dev（ADR 0019）中已经关闭的同一个陷阱，而它们是
比 Psicólogo 更新的代码。

### 5. 终止原因来自**原因**，而不是状态 {#5-a-causa-de-término-vem-do-motivo-não-do-status}

`Monitor.classify/1` 有意让 `heartbeat_timeout` 以 `"closed"` 关闭（另一端没有人是会话结束的正常
方式，不是 engine 的故障）。但 `TerminationClassifier.classify(_, "closed")` 返回 `:normal`，于是：

- 原因 `:timeout` 在**生产中不可达**，尽管需求把 timeout 与 crash 和 kill 并列点名；
- 因超时而死的会话在 prompt 中显示为“正常结束”，从未获得终止分析一节；
- 分类器的测试锁定了错误的行为
  （`classify("heartbeat_timeout", "closed") == :normal`）。

分类器改为先读取原因。我们放弃了把 `Monitor.classify/1` 改为让 `heartbeat_timeout` 以
`closed_abnormally` 关闭：它能从源头解决，但会触动阶段 1/4a 的状态机及其测试，超出本次会话的范围——
而且“超时**从 engine 的视角看**是非异常的结束”这一决定仍然正确。需要另一种看法的是 Psicólogo，而
表达它的也是它。

契约上的后果：engine 开始在 `emit_hypotheses` 的 payload 中发送 `cause`，而 api 在
`cause !== 'normal'` 时要求 `terminationAnalysis`（`requiresTerminationAnalysis`），而不是查看
`session.status === 'closed_abnormally'`。`cause` 在 DTO 中是可选的——没有它，就回落到以前的行为，
因此较旧的 engine 在滚动部署中不会出问题。

还为 `{"normal", "closed_abnormally"}`（进程干净地退出了，但 api 没有预料到停止）诞生了一个诚实的
原因：`:unknown`，标签为 “parada inesperada, sem causa identificada”。以前它会落入 `:crash`，那会就
存在异常这一点撒谎。

### 6. prompt 的日志需要上限——pinned 不会被压缩 {#6-o-log-do-prompt-precisa-de-teto--pinned-não-compacta}

整个 event log 被放在一条 `:pinned` 消息中，而 `ContextManager` 从不压缩 pinned。这是**正确的**
（摘要不会保留证据必须引用的 event id），但这意味着截断必须更早发生：`Event.list/1` 没有 `LIMIT`，
每个事件都 `inspect(payload)`，一个长会话会撑破 128k 的窗口，分析会死于 provider 错误。

三处改动：

- `Event.count/1`（在数据库中 COUNT）和 `Event.list_recent/2`。分诊改为基于真实计数做决定，而不加载
  日志；之后，已知 tier 时，才以该 tier 的上限读取事件。
- 按 tier 的事件上限（`max_prompt_events`）以及每个事件的 payload 大小上限（`max_payload_chars`）。
  进入的是**尾部**：那是会话在终止时刻的状态所在，也正是终止一节需要描述的东西。与动态的
  `latest: true` 是同样的道理。
- 截断**对模型可见**：prompt 说明省略了多少事件，并要求只引用出现的 id。没有这一点，模型会以为自己
  读了整个会话，并引用它没看到的 id——api 会拒绝它们，烧掉迭代次数。

### 7. 假设的生命周期变为 compare-and-swap {#7-ciclo-de-vida-da-hipótese-vira-compare-and-swap}

`updateStatus` 没有 `WHERE status = 'proposed'`——防止重复接受的保护只是用例的先读后写检查，因此两次
同时点击都会通过，第二次会覆盖第一次的决定。它变成了 `updateStatusIfProposed`，不匹配时返回 `null`，
由用例转换为 400。

领域检查（`assertHypothesisTransition`）有意仍在 CAS 之前：是它为常见情况给出好的消息（“已经被接受
了”）。CAS 是互斥，而不是解释。

`AcceptHypothesisUseCase` 也改为在**一个**事务中运行。原本是四个（update、两个事件、Anamnese 的
入队）：中间的崩溃会留下一个从未进入队列的 `accepted` 假设——恰恰破坏了 accept 所要供给的闭合循环。

### 8. 并发分析的竞争是冲突，而不是 500 {#8-corrida-de-análise-concorrente-é-conflito-não-500}

`findCurrentBySession` 不加锁，因此两个同时进行的 `auto` 运行都会看到“没有当前分析”并都插入。唯一
部分索引一直是正确的安全网——缺的是把违反（命名索引上的 23505）转换为 `ConflictException`，而不是让
它作为 500 泄漏出来。我们没有加 `SELECT ... FOR UPDATE`：输掉竞争的一方不会丢失工作（获胜的分析已经
写入），因此加锁是没有收益的成本。

`superseded_at`（migration `0020`）回答分析**何时**被取代。`supersedes` 链已经回答了被谁，但
“带历史地取代前一个版本”没有日期就无法审计。

### 9. 分诊变成了运维旋钮 {#9-triagem-virou-knob-de-operador}

阈值、迭代上限、按 tier 的预算和 prompt 上限原本是模块属性。它们被移到 `config/runtime.exs`，以
ADR 0015 的值作为默认值，与 harness 的其他旋钮对齐——成本控制是按环境收紧的东西，而不是靠重新编译。

### 10. 清理 {#10-limpeza}

`ActionPipeline` 在 Psicólogo 的 hooks 中注册为 `:pre_tool_use`，但注册表只有一个工具
`emit_hypotheses`，它是 `:direct`（Psicólogo 是只读的，从不提议有外部效果的动作）——永久的 no-op，
已移除。`listCurrentByProject`/`listNonDismissedByProject` 获得了 `ORDER BY created_at DESC`（没有
它，Postgres 不承诺顺序，洞察的分组会在轮询之间变换顺序）。`api-client` 中的 `reanalyzeSession` 存在
却没有任何调用者：它在分析条带上获得了一个按钮。`internal-sessions.controller` 中仍在谈论
“PsychologistWorker (placeholder, fase 3+ traz a análise real)” 的注释被修正了。

## 后果 {#consequências}

- **可执行的验收标准**：`apps/api/scripts/demo-psicologo.ts`
  （`pnpm --filter api demo:psicologo`）结束 3 个会话——带短日志的正常结束（轻型分诊）、kill
  （`closed_abnormally`，原因 `kill`）、以及带长日志的错误（重型分诊）——并做结构性验证：每个会话一个
  当前分析、预期的 tier、至少一个假设、**所有**证据都能通过本会话中按 id 的端点解析、两个异常会话中
  有 `terminationAnalysis`、轻型的成本低于重型的、以及重新处理会取代而不删除（带日期）。如果有什么不
  吻合，它以代码 1 退出并列出失败项。假设的**文本**不做验证——它来自 LLM。

- **两个 ollama 模型被以零价格填充**，而两个 tier 的零成本证明不了任何关于“不同成本”的东西。
  脚本给它们分配不同的名义价格（seed 明确说价格是可编辑的），并把每个 tier 绑定到其中一个。成本仍然
  来自真实路径（`RunLlmTurnUseCase` 根据模型价格写入 `token_usage.cost_micros`）——没有任何并行的成本
  机制。针对付费 provider 运行时，`DEMO_MODEL_LEVE`/`DEMO_MODEL_PESADO` 可以省掉这一步。

- **脚本中的 kill 是 Monitor 的报告**，而不是进程的 SIGKILL：Psicólogo 消费的是
  `sessions.termination_reason` + 状态，这正是真实的 kill 会产生的东西。在分析中途杀死 engine 的容器
  是**另一个**场景（由 Lifeline 救回孤立的 job），需要手工验证：job 处于 `executing` 时，对 engine
  执行 `docker kill`，再启动它，分析会在 `rescue_after` 之后完成。

- **阶段 4b 的第一批 web 测试**：`HypothesisCard`（置信度、指向**被分析**会话的证据导航、终止一节、
  只在提议状态下的操作）、`ActivityFeed`（被高亮的永远不会被隐藏，即使是机器噪声，即使有 agent 过滤）
  以及 `activity.ts` 的 `psychologist.*` 分支——它们原本存在却没有任何测试。

- engine 中加入了：端到端的重型分诊测试（之前的都以空日志运行，`event_count == 0`）、返回
  `{:error, _}` 的上下文失败、在 api 一次拒绝**之后**的成功修正（“最多 M 次尝试”的循环从未被执行到
  成功）、由 `heartbeat_timeout` 在状态 `"closed"` 下分类出的超时，以及日志截断。api 中加入了
  `AcceptHypothesisUseCase`/`DismissHypothesisUseCase`（原本没有任何测试）、阻止重复接受的 CAS、
  `ListPsychologistAnalysesUseCase`（轻型 < 重型）、`GetSessionEventUseCase` 以及由 `cause` 驱动的
  终止要求。

## 已执行的验证 {#verificação-executada}

验收标准在这个栈上**运行了**（本地 Ollama，没有付费 provider），三个用例都通过：每个会话一个当前
分析、预期的 tier、每个都有假设、**所有**证据都能通过本会话中按 id 的端点解析、两个异常会话中有
`terminationAnalysis`、轻型成本（US$ 0,000087）低于重型（US$ 0,002086），以及带有日期
`superseded_at` 的重新分析取代。

有两件事只有运行时才出现，两者都在脚本中变成了默认值/文档：

- **`llama3.1:8b` 不调用工具。** 它用完了 tier 的迭代次数，从未发出 `emit_hypotheses`；结果呈现为
  “结束了却没有发出假设”而**不是**“provider 故障”——顺带说一句，这正是决策 4 的区分在起作用：模型
  回应了，只是没有使用工具。在这个栈上只有 `qwen2.5-coder:7b` 能维持带结构化参数的 tool call（这也是
  它运行 dev agent 的原因），因此在 Ollama 中复制了一份，以便给同一个有能力的模型两个**价格**。
- **轻型 tier 4 次迭代的上限对本地 7B 来说太紧。** 在第一轮中，kill 会话在两次 `evidenceEventIds`
  为空、两次引用一个**编造的** event id（`01KYE4B4W25GJ8R6H9Z3FJ8DQX`）的尝试之后，死于“迭代上限”，
  每一次都被正确地拒绝，api 的消息回到了模型。也就是说：证据护栏在生产中抓住了一次 id 幻觉，完全如
  设计所想。正确的应对是按环境提高上限（旋钮现在在 compose 中），绝不放松校验。

**重启后的 kill 已手工验证并且有效。** Job
`Engine.Workers.PsychologistWorker` 处于 `executing`，对 engine 的容器执行 `docker kill`，job 孤立
在 `executing` 没有结果，engine 恢复，约 6 分钟后（5 分钟的 rescue_after + Lifeline 的间隔）分析
**完成**，`supersedes` 指向之前的那个。没有 Lifeline，这个 job 永远不会离开 `executing`。

## 范围与假设 {#escopo--assunções}

不在本次收尾范围内：`findCurrentBySession` 中的 `SELECT ... FOR UPDATE`（见决策 8）；job 级别的
`Oban unique:`（约束 + 预检查已经足够，而 Lifeline 解决了会促使这么做的情况）；批量重新分析；分析
条带之外的成本仪表盘；对 `Monitor.classify/1` 或会话状态机的任何改动。

`superseded_at` 是增量且可为空的——在这次 migration **之前**被取代的分析，保持 `superseded = true`
且日期为空，这是诚实的：并不存在它何时发生的记录。
