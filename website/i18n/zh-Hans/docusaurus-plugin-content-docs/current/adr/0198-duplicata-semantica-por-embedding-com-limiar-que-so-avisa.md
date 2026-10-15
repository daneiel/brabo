---
traducao_de: e48d6fadf002507531282196656b6b651acd9ed5
---

# 0198 — 故事与规则的语义重复通过带阈值的 embedding 提醒，花费进入计量

## 状态 {#status}

**Accepted.** 2026-10-01（AT-171，故事 HS-047，史诗 EP-026，第 36 轮；
负责人 10月1日的决定：*"embedding com limiar, só avisa"*——在发出时与项目中已有的故事和规则比较，超过阈值时**提醒**，绝不阻止；这项检查的 embedding 花费作为专属行进入计量）。在不编辑
[ADR 0075](0075-embeddings-no-contrato-de-llm-provider.md) 的情况下，为其计量切分开**一个**例外：该切分对 RAG 的索引和搜索继续有效
（[ADR 0080](0080-busca-hibrida-pesos-limiar-e-citacao.md)）；只有这项检查开始写入 `token_usage`。关闭了 [RN-080](../business-rules/custo.md#rn-080)
和 [RN-081](../business-rules/custo.md#rn-081) 声明为力所不及的那一半，而不改变其中任何一条：**完全**相同的重复仍被拒绝。

## Context {#context}

2026-10-01 在 `dev` 的代码上测量，改动之前：

- **发出发生在哪里。** 故事：PO 的 `create_story`
  （`apps/engine/lib/engine/harness/tools/create_story.ex`）调用
  `POST /internal/sessions/:id/stories`，创建者是 api 中的
  `CreateStoryUseCase`——标题相同即拒绝，理由被包含则提醒（RN-081）。业务规则：`emit_artifact`（Criativo 和另外五个对话型 agent）在 `ArtifactDedupe` 拒绝相同标题（RN-080）之后，经由 api（`append_event`）写入 `artifact.business_rule` 事件。没有规则表：规则**就是**事件。两个服务器（`po_server.ex`、`criativo_server.ex`）都不需要改变——发出住在这两个工具中。
- **RAG 如何调用 `embed`。** 经由单一入口 `RagEmbeddingService`，provider 和模型**固定**（`ollama`/`nomic-embed-text`，768 维——RN-222/233）：唯一声明 `capabilities.embeddings` 的 provider（RN-191）。失败变成带原因的 `available: false`，绝不是异常。该服务丢弃了合约返回的 `inputTokens`——即 0075 的切分。
- **是否有保存的向量。** 没有。`chunks` 索引 `chat.message`、`agent.response`、`docs/` 和 ADR；没有任何 `artifact.*`，没有任何故事。检查必须当场向量化。
- **为什么 0075 的切分管不到这项检查。** 它的理由是结构性的：`token_usage.session_id` 是 `NOT NULL`，而索引仓库不发生在会话中。发出故事或规则**总是**发生在 agent 的会话之中——`session_id` 存在。

## Decision {#decision}

1. **比较什么。** 新**标题**对照**项目**中**同类型**已有项的标题（故事对故事，规则对规则），用 RAG 模型向量之间的余弦，由**同一个** `RagEmbeddingService` 调用——绝不是通往 `embed` 的第二条路径。只比较标题，而不是标题+描述：发现 R 中的那一对是标题，而描述在模型的不同轮次之间长度和语气都会变化（成本和噪声，却没有需要它的案例）。完全重复（规范化后标题相同）不在这里讨论——它由 RN-080/081 先行拒绝，因此也被排除在比较之外。
2. **只提醒。** 检查在写入**之后**运行：故事和规则无论是否有提醒都已存在。提醒作为工具结果的一部分回到 agent（`create_story`、`emit_artifact`），并以 `backlog.semantic_duplicate_warned` 留在日志中，点名相似的条目和数值。
3. **阈值是 0,80，未经校准的起点**——就像 0080 中混合搜索的四个数字。“从……起”：相等即提醒。见“未测量的部分”。往低了错只会多一次不阻止任何东西的提醒；这就是为什么一个临时数字在这里合适，而在拒绝中则不合适。
4. **没有 embedding provider 时，检查被跳过并说明。** capability 缺失、daemon 不在线、模型未拉取，或时间上限——全部变成带原因的 `status: skipped`，以 `backlog.semantic_duplicate_check_skipped` 叙述，并写进给 agent 的话中。绝不让发出失败，也绝不沉默：否则，“没有提醒”会被读成“不是重复”。
5. **花费以专属行进入计量。** 经由唯一路径 `RecordLlmUsageUseCase`，参与者为 `system`/`duplicata-semantica`（不计入按 agent 的汇总，RN-038，也不计入区域花费，ADR 0110），RAG 的 provider/模型，`output_tokens = 0`，`input_tokens` 和 `estimated` 取自 provider 所报告的，模型在目录中时取目录价格（否则为 0，`model_id` 为空）。`RagEmbeddingService` 开始**返回**汇总的用量（`uso`）；索引和搜索忽略它，这正是对它们保持 0075 切分的方式。
6. **上限。** 最多比较**最近**的 100 个已有项
   （`TETO_DE_COMPARACOES_DE_DUPLICATA`），一个批次；截断时，结果说明是多少中的多少（RN-180）。整个检查的挂钟上限为 10 s（`TETO_DE_TEMPO_DA_CHECAGEM_MS`），低于调用它的 engine 中 `Req` 的 15 s：安装中 Ollama 的超时可达 300 s，而检查位于 agent 一个工具的路径上。
7. **没有 migration。** 什么都不保存：既没有向量，也没有新列。`token_usage` 中的专属行通过已存在的参与者来区分。

## Consequences {#consequences}

**发出的成本开始随项目增长。** 每次发出向量化
`min(N, 100) + 1` 个标题，N = 同类型的已有项数。故事或规则的标题有 5 到 15 个词；以 `nomic-embed-text` 的分词器，**估算**每个标题 10–30 个 token，也就是说在上限处每次发出最多约 ~3 000 个输入 token——使用本地 Ollama 时，目录价格为 0，成本为 0 micros；增长的是**延迟**，这里未测量。真实数字来自计量，这一行正是为此存在的。保存每个条目的向量（`stories` 中的列，规则事件的表）会把它减少到每次发出一次调用，而那是 migration——留到测得的成本要求时再做。

**发现 R 中的那一对不再被忽视——如果阈值是对的。** 而这个“如果”正是本决策的缺口（见下文）。

**提醒的语句只有一个来源**，即 api 中的 `fraseParaOAgente`；engine 只是转发。同一项检查服务两种类型。

**仍然会漏过的。** 含义在**描述**而不在标题中的重复（"Saudação com nome" × "Quem chama pode se identificar"，RN-080 的例子）不会被比较。因超时而丢失的提醒会被说明，但检查不会重做。而 `policy = 'block'` 的预算（[RN-019](../business-rules/custo.md#rn-019)）在这次调用**之前**不会被查询：该行计入花费并可能越过阈值，但检查不会因预算超支而被拒绝——它不阻止任何东西，而使用本地 Ollama 时记录的成本为 0。如果有付费的 embedding provider 加入，这个选择会重新摆上桌面。

**本 ADR 不改变的：** 对完全重复的拒绝（RN-080/081）、索引和搜索的计量切分（ADR 0075）、RAG 固定的模型和 provider（ADR 0080），以及任何对话型服务器。

## 未测量的部分 {#o-que-não-foi-medido}

负责人的决定要求用发现 R 中的那一对以及**不是**重复的对来校准阈值，并用录制的向量通过测试加以证明。这项改动诞生的环境**无法访问** Ollama 的 registry
（`registry.ollama.ai`：代理返回 403）和 Hugging Face（403），也没有 daemon——2026-10-01 测量。手写的向量证明的是手，而不是模型。因此，现有的是：

- `apps/api/test/fixtures/duplicata-semantica/pares.json`——校准对：发现 R 中的那一对以及两个**必须**提醒的改写；五个**不能**提醒的相邻主题对。
- `apps/api/scripts/gravar-vetores-de-duplicata.ts`——针对真实 Ollama 录制 `vetores.json`，使用 daemon 报告所用的模型，并打印每对相对当前阈值的余弦。
- `apps/api/test/domain/backlog/limiar-de-duplicata.calibracao.spec.ts`——当 `vetores.json` 存在时自动运行：每个 `duplicata` 对都提醒，每个 `distinta` 都通过。没有该文件时，带着有名称的提醒**跳过**（Ollama embedding smoke 的尺子），绝不静默通过。

在有人录制向量之前，0,80 是关于句子 embedding 模型的一般知识，而不是测量。如果录制显示没有任何数字能分开两边，答案是重新审视这些对或比较的文本——绝不放宽测试。
