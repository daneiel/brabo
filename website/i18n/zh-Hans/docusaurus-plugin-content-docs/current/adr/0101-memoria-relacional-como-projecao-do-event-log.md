---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0101 — 关系记忆作为事件日志的投影；在不触碰 GenServer 的情况下使用模板

- **状态：** 已接受
- **日期：** 2026-08-20
- **背景：** 使用图的基础（RN-416/417），与 [ADR 0099](0099-neo4j-grafo-de-conhecimento-e-templates.md)/[ADR 0100](0100-rag-search-e-modelos-garantidos-no-boot.md) 配套

## 背景 {#contexto}

上一批构建了图的基础（Neo4j、版本化模板、`rag_search`），却没有真正的使用者。这一批把两侧连接起来：（1）三个 agent 开始从图中的模板解析 kickoff/身份，并以内联文本作为回退；（2）Psicólogo 和 Anamnese 开始通过 `rag_search` 把“最近 N 条”/“时间窗口”与项目的**相关**片段组合起来；（3）图开始通过事件日志的投影自行写入。

在并行化之前，有两个设计问题需要回答：如何在不重写整个 GenServer 的情况下使用模板，以及如何写入图而不从 engine 打开第二条写入路径。

## 决策 {#decisão}

**模板：`InstructionFiles` 获得 `:graph` 来源，不改变契约。** 最终优先级：**`db > graph > dir > root`**——用户的 `instruction_patch` 仍然胜过一切（既定的业务规则：用户总能覆盖）；图胜过磁盘上的内容。`PromptAssembler` 不变；没有任何 agent 的 GenServer 失去一行逻辑——每个都只是在使用内联文本之前**尝试**解析模板，内联文本变成回退。复用 ETS 缓存（没有新的并行缓存），短 TTL。

两个标志，有意**分开**：`graph_templates_enabled?`（Psicólogo + Anamnese，同一个键，同一个 kickoff 使用者）和 `graph_instruction_templates_enabled?`（ux-designer，经由 `InstructionFiles`）。单个键会在并行编写它们的两条战线之间与**相反**的默认值冲突——而 Elixir 的 `config/2` 对重复键的解析取**最后**一次出现，会在**没有任何错误**的情况下让其中一个静默。两个名字不会混淆的键，比在并行战线之间协调一个单一值更便宜。两个默认值都是 `false`：新能力以关闭状态诞生，直到种子运行并有人有意激活——与 `psychologist_enabled?`/`anamnese_enabled?` 的标准相同。

**相关性：组合，绝不替换。** Psicólogo 和 Anamnese 继续读取它们一直读取的内容（最近事件 / 时间窗口），并**获得**第二个来源 `rag_search`，其查询从分析的**触发条件**派生（在 Psicólogo 中是分类后的结束原因；在 Anamnese 中是还没有画像的能力——绝不是假设/犹豫的自由文本，因为已确立的禁令是 Anamnese 绝不推断健康/性格/年龄/性别）。`Triage` 现有的上限（`max_prompt_events`、`max_payload_chars`）**仍然**是总预算——相关片段从最近窗口中扣除名额，绝不额外相加。RAG 的 `degraded: true` 在两个 agent 组装的上下文中都明确出现——绝不隐藏。RAG 的失败是严格附加的：没有命中时，行为与这一批之前**完全相同**（正是这一点让约 50 个已有测试在一个都没碰的情况下保持绿色）。

**关系记忆：现有 OUTBOX 的投影，独立的 aggregate_type。** 显而易见的替代方案——engine 直接写入图——被舍弃：它会在事件日志之外打开**第二条**写入路径，破坏事件日志是唯一事实来源的保证。复用 outbox 已有的 `aggregateType: 'session'` 这一替代方案也被舍弃：engine 一侧的 `Engine.Outbox.Drain` 已经每约 2s 排空这一类型并标记 `processed_at`——在 api 一侧针对同一类型运行的使用者几乎总会输掉竞争。决定是：第二行 outbox，同一个事务，`aggregateType:
'graph_projection'`——engine 的过滤器（`IN ('session',
'task')`）永远匹配不到这个值，与 `deny-action.use-case.ts` 已经用来在同一个事务中写两个 `aggregateType` 的模式相同。`GraphProjector`（轮询器，约 2s，与 `DomainGaugesCollector` 同样的形式）排空这个队列，并调用已有的写入用例（`RecordHandoff`、`RecordHypothesis`、`RecordAnamneseProfile`、`RecordInteraction`）——幂等性在**它们**之中，投影器不重复这些逻辑。

## 后果 {#consequências}

- 图仍然可以通过重放重建：`graph_projection` 是一个从事件日志**派生**的队列，绝不是第二次主写入——失去 Neo4j 并从零重建是重放，而不是数据丢失。
- 批次中途的 `GraphUnavailableError` 会**停止**整个周期（不尝试批次的其余部分，它们会因同样的原因失败）——该行保持未处理状态，在下一个周期重试。重试是自动的，无需干预。
- 声明在本次交付**之外**的使用，与之前 ADR 同样的诚实模式：`query_user_context`（带证据的假设 + 图中的画像）仍然没有暴露的 HTTP 路由——Psicólogo/Anamnese 还不从图中**读取**，只通过 `rag_search` 读取 RAG（pgvector）；只有 `psychologist.hypothesis_proposed` 被投影（没有 `accepted`/`dismissed`）；`context-manager-summarize` 是第一批四个模板中唯一还没有被任何 agent 使用的。
- 两个标志（`graph_templates_enabled?`、`graph_instruction_templates_enabled?`）在所有环境中都保持 `false`，直到有人运行种子程序并有意激活——本次交付本身不改变生产中的可观察行为。
