---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0080 — 混合搜索：权重、阈值，以及什么算引用

- **状态：** 已接受
- **日期：** 2026-08-16
- **之前的背景：** [ADR 0079](0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)（`chunks` 表，向量和 `tsvector` 在同一行——只有基础，没有流水线也没有搜索）、[ADR 0075](0075-embeddings-no-contrato-de-llm-provider.md)（`LLMProvider.embed?`，capability 只针对 Ollama 证明过）

## 背景 {#contexto}

ADR 0079 留下了一张就绪却为空的表：没有流水线写入它，没有搜索读取它。这一波（PROGRAMA 28，Onda 4，工作线 G2）需要解决四个开放问题，四个都是结构性的——产品决策，而不是实现细节：

1. 对于 ADR 0079 的三个诚实作用域（`docs`、`adr`、`session`），**变成 chunk 的文本从哪里来**？
2. **如何把**文档/消息**切成**片段——大小、重叠——而不用一个任意的数字？
3. **当嵌入 provider 没有响应时怎么办？** 流水线不能在只索引了词法那一半时假装已经完整索引。
4. **如何在一次搜索中组合**向量信号（pgvector）和词法信号（`tsvector`），用什么权重、什么截断——以及**返回什么**作为引用，因为 Chat RAG（Onda 5，界面尚未构建）将消费的正是这个契约，而无法去猜测形态。

## 决策 {#decisão}

### 1. 文本来源：项目**自身**的仓库，以及会话的 event log {#1-origem-do-texto-o-repositório-do-próprio-projeto-e-o-event-log-da-sessão}

`docs`/`adr` 从被索引项目的 **GIT** 仓库索引——通过 `ReadProjectCodeUseCase`，即 Code 标签页使用的**同一个**表面（同样的所有者凭据解析，RN-058/082；同样的容器关口，RN-105；同样的路径检查，RN-095；同样的缓存）。这不是作为产品的 Brabo 的文档：而是每个**受管**项目可能在自己仓库中拥有的 `docs/`/`docs/adr/` 约定。在重新索引时不重复扫描目录树，比把两个作用域分成两个用例更重要——`IndexProjectDocsUseCase` 覆盖两者，按路径**前缀**区分（`docs/adr/` → `adr`，其余 → `docs`）。

`session` 从构成对话的**两种**事件类型索引：`chat.message`（人）和 `agent.response`（agent）。event log 的其余部分（`tool.call`、`agent.status`、`tool.result`、gate 事件）被排除在外——那是机制，不是可引用的知识。索引一个 `tool.call` 会让搜索把 JSON payload 当作散文返回；索引 `agent.error` 会把一次失败当作会话的主题来引用。每个会话 chunk 在 `metadata.sourceRef` 中保存**来源**事件的 id——与 `GetSessionEventUseCase` 早已能解析的 id 相同——让引用能导航回对话中的确切位置。

### 2. 分块：1200 个字符，150 个重叠，按**段落**/断点 {#2-chunking-1200-caracteres-150-de-sobreposição-por-parágrafoquebra}

`CHUNK_TARGET_CHARS = 1200`（葡萄牙语约 300 个 token）瞄准的是一段大到足以承载一个完整想法的文字——嵌入向量需要这一点，才不会把含义稀释在不相关的主题之间——又小到足以成为几秒钟就能读完的引用，而不是整篇文档。`CHUNK_OVERLAP_CHARS = 150`（目标的 12.5%）之所以存在，是因为恰好在句子中间切断，会让下一片段丢失它的前文。

这两个数字是**可调整的起点，不是科学**：目前还没有一组针对该索引运行过的真实问题，用来校准最佳 chunk 大小与检索质量之间的关系——本计划没有产出这样的数据，而捏造它就是假装拥有并不存在的精确度（与 ADR 0042 拒绝为模型打分时所拒绝的是同一类错误）。

切分优先选择离目标最近的**段落**断点（`\n\n`），其次是**单词**断点（空格），只有当 200 个字符的窗口内两者都不存在时才在单词中间切断——在表格中间被切断的 Markdown，仍然好过把一句话从中间切开的引用。Markdown 文档（`docs`/`adr`）先按**标题**拆分（保留 `headingPath` 轨迹，即"文件 + 章节"引用中的"章节"部分），然后才在每个章节**内部**按大小切分。

按 **token** 而不是字符计数，需要嵌入模型自身的分词器，而 `nomic-embed-text` 在本地不暴露它（不同于 `chat` 已在使用的 `GptTokenizerEstimator`，后者针对**聊天**模型校准）。带有干净断点偏好的字符计数是一种诚实的近似。

### 3. provider 失败：索引词法部分，声明缺口——绝不假装完整 {#3-falha-do-provider-indexa-léxico-declara-a-lacuna--nunca-finge-completo}

嵌入的模型/provider 由常量**固定**（`RAG_EMBEDDING_MODEL = 'nomic-embed-text'`，`RAG_EMBEDDING_PROVIDER =
'ollama'`），而不是通过目录解析：`chunks.embedding` 是 `vector(768)`，即该模型真实且**有文档记载**的维度（RN-222），而目前还没有持久化的列说明"哪个模型用于嵌入"——ADR 0075 把这留作将来的工作，这一波也没有迁移名额来解决（本波唯一的迁移 `0046` 属于工作线 F1，用于 `project_containers`）。

当 `ollama` 没有响应时——守护进程宕机、超时、模型未拉取——`RagEmbeddingService` **不会抛出让调用方逐个 chunk 处理**：它返回 `available: false`，并对每个请求的向量返回 `null`。索引流水线**照样**写入 chunk，带 `embedding: null`——`search_vector` 是 `GENERATED ALWAYS AS`，不依赖任何 provider（ADR 0079），所以即使语义部分不可用，词法那一半仍然可用。另一种选择——因为缺了一半信号就让整个索引失败——会丢掉能用的那一半。索引报告（`embedding: { available, embedded, skipped, reason }`）声明这一缺口；返回中没有任何东西在并非如此时说"索引完成"。

同样的降级也适用于**搜索**：如果查询无法向量化，搜索只用词法信号运行，并以 `vectorAvailable: false` 提示——绝不假装运行了完整的混合搜索。

### 4. 混合搜索：两次独立查询，按加权求和融合 {#4-busca-híbrida-duas-consultas-independentes-fusão-por-soma-ponderada}

向量和词法是针对 `chunks` 的**两次独立查询**（`ChunkRepository.searchByVector`/`searchByLexicalQuery`），而不是一次带 JOIN 的查询——每一次都利用为它而建的索引（余弦用 HNSW，`ts_rank` 用 GIN），这与 ADR 0079 把两列放在**同一**行（以免失去融合）、但不强制**同一**查询（以免失去合适的索引）的设计理由相同。port 返回原始候选；用例（`HybridSearchUseCase`）进行融合、加权和截断——与早已把 `ChunkRepository`（保存数据）和决定如何处理数据的一方分开的边界相同（RN-226）。

**权重：向量 0.6，词法 0.4。** 归一化的 `ts_rank`（bit 32，`rank/(rank+1)`）即使在强匹配下也很少超过约 0.3，而真正相关的一对的余弦相似度通常在 0.5 到 0.85 之间——两种尺度本质上**不可**比较。向量一侧权重更大承认了这一点，而不抹掉词法：一个只有词法的 chunk 理论上可以单独越过阈值（`0.4 * 0.3 = 0.12`，低于阈值——所以实际上单独一个很强的词法匹配仍然不够，这是有意的：只是碰巧共享一个单词的文本，在没有任何含义支持的情况下不应成为引用）。

**阈值：0.2。** 低于它，"找到了一点弱的东西"和"什么都没找到"对读回答的人来说无法区分——一个被当作强引用呈现的弱引用比没有引用更糟。

**四个数字（权重、阈值、chunk 大小、重叠）都不是来自用真实搜索质量数据进行的校准。** 目前还没有一组针对该索引运行的真实问题——Chat RAG 本身（Onda 5）还没有作为界面存在。它们是起点，被如此记录，每个选择的论据都已写下，以便日后用数据复审，而不是凭空重新计算。

### 什么算引用 {#o-que-conta-como-citação}

返回契约（`HybridSearchHit`）是：`chunkId`、`content`、组合 `score`、`vectorScore`/`lexicalScore`（当该信号没有找到这个 chunk 时各自为 `null`——而不是零，零会把"没找到"与"找到了且相似度为零"混为一谈）、`scope`，以及 `origin`——一个按 `kind` 区分的联合：对 `docs`/`adr` 为 `{ kind: 'file', sourcePath, headingPath?, title? }`，对 `session` 为 `{ kind: 'session', sessionId, eventId?, title? }`。区分的存在，是为了让使用者永远不必检查两个可选字段才能知道哪个是 `null`——`tsc` 让检查成为穷举的。

## 后果 {#consequências}

**"索引覆盖率"（handoff 所要求的面板）以今天能**诚实**回答的内容回答**：`GetRagCoverageUseCase` 统计仓库中真实的 `.md` 文件数与其中有 chunk 的数量，以及项目的会话数与其中有 chunk 的数量。它不包括"12 分钟前重新索引"——没有按作用域的索引时间戳列，一个猜出来的数字会是谎言。

**重新索引总是**手动**的**（`POST .../rag/reindex`，`role:maintainer`，通过 `deleteByScope`/`deleteBySession` 再重建的幂等完整重建）。没有按 push 或按会话关闭的监听器——这是 ADR 0079 早已记录的决定（"重新索引是编写流水线者的责任"），而这一波把流水线写成了**按需**的，而不是响应式的。源代码和 Pull Request 仍然不在索引中，原因与 ADR 0079 相同。

**嵌入的计量仍然在外**（与 ADR 0075 相同的切分）：固定的 provider 是本地且免费的（`ollama`），所以今天没有需要记录的成本；当付费的嵌入 provider 进入的那天，这个缺口必须先关闭。

**在这一波、在界面（Onda 5）之前就提供 HTTP。** `POST .../rag/search`、`POST .../rag/reindex` 和 `GET .../rag/coverage` 之所以存在，是因为 Chat RAG 的界面依赖搜索和引用的契约，才能在不猜测形态的情况下构建——handoff 早已假定"busca híbrida · embeddings + BM25 ·
limiar X"以及一个覆盖率面板，而两者只有在这三条路由之后才有真实数据。
