---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0015 — 真正的 Psicólogo：ToolLoop、带证据的假设与成本分诊

- 状态：已接受
- 日期：2026-07-24
- 阶段：4b（会话 1——取代 PsychologistStub）

## 背景 {#contexto}

第 1 阶段的 `PsychologistWorker` 是一个明确的占位符：它读取 event log 并写入一个固定文本的 `psychologist.hypothesis`
（`Engine.Psychologist.Stub.summarize/1`），没有 LLM，没有证据，没有幂等性（它自己的 docstring 记录了 Oban 的一次重试会复制该事件）。

本次会话用真正的 Psicólogo 取代它：一个 `session.closed`/`session.closed_abnormally`（任何原因）的消费者，它组装上下文（完整的 event log + 项目的业务规则 + 之前未被驳回的假设），并通过 harness 产出结构化的假设——每一条都**必须**带有指向真实 event id 的证据。

验收标准：结束 3 个会话（正常、kill、错误）在 3 种情况下都产生带可导航证据的假设，轻量与重量分诊的不同成本在计量中可见。

## 决策 {#decisões}

### 1. Oban 任务直接调用 ToolLoop——没有 GenServer {#1-oban-job-chamando-toolloop-direto--sem-genserver}

与 QA/SecOps/Dev/Infra（按项目/会话的 GenServer，在项目生命周期中接收重复的 cast）不同，Psicólogo 每次会话关闭只运行**一**次，之后从不需要被寻址。Oban 已经提供带重试的受监督进程（`max_attempts: 5`），因此 GenServer/Supervisor/Registry 将是没有作用的仪式。
`PsychologistWorker.perform/1` 组装 ctx 并同步调用 `ToolLoop.run/1`——与 `QaAgentServer.run_qa/2` 形式相同，没有包装。

### 2. “最多 M 次尝试”就是 ToolLoop 的 `max_iterations` {#2-até-m-tentativas-é-o-max_iterations-do-toolloop}

没有新的重试子系统。CLAUDE.md 所要求的机制（“没有有效证据的假设被拒绝并重新请求模型，最多 M 次尝试”）已经是 harness 的常规循环：返回 `{:error, reason}` 的工具会把该字符串作为下一个 `tool` 结果注入，模型在下一轮中纠正。`M` 字面上就是 ctx 中的 `Triage.max_iterations(tier)`（轻量层 4，重量层 8）。

`Engine.Psychologist.Tools.EmitHypotheses` 是必需的工具（与 `EmitArtifact`/`EmitQaVerdict` 形式相同）；`Engine.Psychologist.Hooks.
Termination` 是 `:post_tool_use`，只在验证通过时才 halt。刻意分为两个阶段：工具验证，hook 终止。

### 3. 证据验证住在 api 的领域中，按批次原子化 {#3-validação-de-evidência-mora-no-domínio-da-api-atômica-por-lote}

`ProposeHypothesesUseCase` 通过
`SessionEventRepository.findById` 解析每个 `evidenceEventId`，并要求该事件存在**且**属于被分析的会话（与 `CreateStoryUseCase` 对
`business_rule_id` 的模式相同）；`domain/psychologist/hypothesis-evidence.ts`
（`validateHypothesisBatch`，纯函数）应用其余规则（证据非空、置信度为 0–100 的整数、会话异常结束时至少一条假设必须有 `terminationAnalysis`）。

只要任何一条假设失败，**整个批次**就被拒绝——部分接受会让模型在 tool 结果被汇总时以为部分已被登记，破坏纠正循环的清晰度。

### 4. 生命周期需要可变的表（事件是不可变的） {#4-ciclo-de-vida-exige-tabela-mutável-eventos-são-imutáveis}

`session_events` 是只追加的（CLAUDE.md），因此会变化的状态
（`proposed → accepted | dismissed`）住在专用表
`psychologist_hypotheses` 中——与 `tasks.gate_status`/
`infra_artifacts.gate_status` 同一模式。每次转换**也**发出它不可变的事件（`psychologist.hypothesis_proposed`/`_accepted`/`_dismissed`、
`psychologist.analysis_completed`/`_failed`）作为审计轨迹。

`domain/psychologist/hypothesis-lifecycle.ts`（`assertHypothesisTransition`，纯函数）只允许从 `proposed` 离开——避免重复接受的竞争。

### 5. 幂等性：部分唯一索引 +“失败的运行不写入行” {#5-idempotência-índice-parcial-único--run-falho-não-grava-linha}

`psychologist_analyses` 有
`uniqueIndex('psychologist_analyses_current_idx').on(sessionId).where(superseded = false)`
——每个会话最多**一个**当前分析，始终如此。这**就是**“session_id 唯一键 + 已处理”。

两层：worker 预先检查 `alreadyAnalyzed`（廉价的短路，在 Oban 重试时不花费 LLM），而索引是针对真实竞争的安全网。

**只有在分析完成时才产生一行。** 一次超出限制/预算而没有发出有效假设的运行不写入任何东西——刻意如此：这区分了“复制一个已完成的分析”（被阻止）与“重试一个失败的分析”（被允许，这正是验收标准中 engine 被 kill/重启后分析的场景）。失败的结果仍然叙述 `psychologist.analysis_failed`——绝不会没有结果，与 DevAgent/QA 同样的纪律。

**显式重新处理**（`triggeredBy: "manual"`，经由 `POST
projects/:id/sessions/:id/psychologist/reanalyze` → engine 将任务入队）总是运行：把之前的分析标记为 `superseded = true`（**绝不**删除）并插入新的。历史免费保留——旧的假设仍在那里，只是不再是“current”。

### 6. 终止原因是确定性的分类，而不是 LLM 的判断 {#6-causa-de-término-é-classificação-determinística-não-julgamento-do-llm}

`Engine.Psychologist.TerminationClassifier.classify/2` 是针对 `sessions.termination_reason` 的纯模式匹配——识别 "heartbeat_timeout"、kill 信号或异常消息是模式匹配，而不是语义（与 ADR 0013 对确定性 SecOps 的理由相同）。原因作为**事实**进入 prompt；模型分析它的**后果**。

这需要填补一个缺口：`ReportSessionTerminationUseCase` 从 engine 接收 `reason` 却只记录日志。现在它被传递到新列
`sessions.termination_reason`（可为空——人为/正常的关闭保持 null）。

### 7. 分诊：真正不同的 agent binding {#7-triagem-bindings-de-agente-genuinamente-diferentes}

`Engine.Psychologist.Triage.decide/1`——少于 **20** 个事件 → `:leve`，否则 `:pesada`。阈值的理由：低于这个数，会话通常只是有人打开并交换了两条消息，没有足够的行为信号来支撑一个强模型。

层级在 ctx 中选择 **agent slug**（`"psicologo-leve"` vs
`"psicologo"`），而不是在代码中覆盖模型——这样已有的 binding 级联（`session > agent > project > workspace`）自行解析，操作员继续通过 `ProjectSettingsTab` 的 binding 表控制两个层级而无需新界面，成本也在 `RunLlmTurnUseCase` 无条件写入的 `token_usage` 中真正分化。seed 把 `psicologo → Opus 4.8` 和
`psicologo-leve → Haiku 4.5` 绑定在一起。

层级还定义 `max_iterations` 和 `token_budget_micros`（50k vs
300k 微美元），由 ToolLoop 中已有的机制执行
（`{:budget_exceeded, ctx}`）——零新的执行代码。

## 后果 {#consequências}

- UI：`ProjectOverviewTab` 中新增 **Insights** 区块，**项目**作用域（而不是打开的会话——验收标准关闭 3 个不同的会话），按目标 agent 分组的假设，`HypothesisCard` 带置信度、终止分析和可点击的证据标签。每个标签导航到 `/projects/:id/sessions/:sessionId?highlightEvent=:eventId`
  ——`SessionPage` 增加了一个可折叠的“Log de eventos”面板（复用 `ActivityFeed`/`EventItem`，它们已经能分类所有事件类型），它会自动打开并滚动到高亮的事件。
  `activity.ts` 增加了真正的 `psychologist.*` 分支——旧分支
  `startsWith('hypothesis')` 是死代码（从未匹配
  `psychologist.hypothesis`）。
- 测试：领域（`hypothesis-lifecycle`、`hypothesis-evidence`——不存在的 id、其他会话的 id、缺少 `terminationAnalysis`）、
  `ProposeHypothesesUseCase`（正常路径、原子拒绝、supersede）、
  `GetPsychologistContextUseCase`、`ReportSessionTerminationUseCase`
  （原因被持久化）；engine：`Triage`（阈值边界）、
  `TerminationClassifier`（5 种原因）、`EmitHypotheses`（api 的消息被逐字保留供模型纠正）、`PsychologistWorker`
  （幂等时不调用 LLM、分诊选择正确的 agent、异常终止要求 `terminationAnalysis`、kill→重启后完成）。
- 给 Anamnese 的事件（`psychologist.hypothesis_accepted_for_anamnese`）作为一个独立的**类型**发出（而不是 payload 中的 flag）——未来的消费者无需检查 payload 即可过滤，与 `session.closed` 和 `session.closed_abnormally` 是独立类型同一精神。不经 outbox：目前还没有消费者，而经 outbox 路由需要在 `handlers_for/1` 中命名一个不存在的 worker。

## 范围与假设 {#escopo--assunções}

不在本次会话中：**Anamnese** 本身（周期任务、
`proficiency_profile`、作为 proposed_action 的 `instruction_patch`、agent 文件的版本化/回滚——第 4.6 阶段）；对转发给它的事件的任何优先级/消费逻辑；超出每次分析数字之外的成本仪表盘；任务级别的 `Oban unique:`（数据库约束 + 预检查已经足够——如果实践中出现不稳定，作为后续事项）；批量重新分析。

“已分析”状态是按**会话**而不是按项目——每个已结束的会话最多产生一个当前分析，重新分析一个不影响其他。
