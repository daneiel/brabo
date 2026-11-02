---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0099 — Neo4j 作为知识图谱和 prompt 模板，驱动放在 api 中

- **状态：** 已接受
- **日期：** 2026-08-19
- **背景：** 知识图谱的基础（RN-413/414/415），产品所有者把 Neo4j 引入产品的决定

## 背景 {#contexto}

产品中两个真实的空缺促成了本次交付。第一：**没有任何 agent 使用**已经存在的 RAG（pgvector，向量+词法混合搜索，`HybridSearchUseCase`）——只有 web 的“Chat RAG”标签页在用它。第二：**每个 agent 的 prompt 都是内联的 Elixir heredoc**——身份（`Engine.Harness.Agents`）、PO/Arquiteto/Dev Lead/UX/Infra 的 kickoff、`ContextManager` 的摘要 prompt——这些都不在代码之外，既没有版本化，也不可复用。

产品所有者要求引入 Neo4j，灵感来自仓库 [`ErickWendel/neo4j-ai-experiments`](https://github.com/ErickWendel/neo4j-ai-experiments)，它把图用作 AI agent 的记忆，并把 prompt 放在与应用逻辑分离的文件中（`prompts/` 目录，带有用于 NL→Cypher 转换、上下文和响应格式化的具名模板）。**这个项目是此处采用的模式的具体灵感来源**——值得明确致谢：没有它，“prompt 作为版本化文件，而不是困在代码中的字符串”这种形式不会有一个如此直接的先例可循。

## 决策 {#decisão}

Neo4j 作为**知识图谱**引入——从事件日志**派生**的记忆，绝不是事实来源——承担两项职责：

1. **版本化的 prompt 模板**（`PromptTemplate`/`PromptVersion`），逐步替换内联的 heredoc（GenServer 本身的迁移是未来的批次；本次交付只构建基础）。
2. **关系记忆**：用户的交互、Psicólogo 带证据的假设（`EVIDENCIA` → `Evento{sessionId,seq}`）、Anamnese 的熟练度画像、agent 之间的 handoff。

**pgvector 仍然是 chunk 的向量索引**——图不存储任何 embedding。把同一个向量存在两个数据库中，会在第一次只触及其中之一的重新索引时产生分歧；决定是保留**一个**向量来源，图作为其上的**关系**层。

**驱动：`neo4j-driver`（官方包）放在 `apps/api` 中，而不是 engine。** api 已经拥有产品的**全部**持久化（Postgres、pgvector、`permissions.json`）和现有的 RAG；engine 已经通过带 service token 的内部 HTTP 使用一切，从未直接连接过领域数据库。重复这一模式——engine 调用内部路由，api 与数据库对话——保持**一个**凭据/连接池边界，而不是两个。

**最小模式，带唯一性约束**（Neo4j Community 没有复合 NODE KEY，只有针对单一属性的 `IS UNIQUE`）：`PromptTemplate.name`、`Usuario.id`、`Projeto.id`、`Agente.slug`、`Interacao.sessionId`。`Hipotese`/`Handoff` 按各自的自然键 MERGE（假设的 id；handoff 的 `(sessionId, seq)`），没有正式约束——幂等性来自 MERGE，而不是额外的结构性限制。

## 降级，而非崩溃 {#degradação-não-crash}

`GraphStore.onModuleInit` 绝不抛出。三个环境变量（`NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD`）**在生产中是必需的**（启动时尽早失败，与 ADR 0059 的 `GIT_OAUTH_STATE_SECRET` 同样的精神），**在生产之外是可选的**——没人需要为了跑 api 的测试套件而启动本地 Neo4j。缺失或不可用时，驱动为 `null`，每个操作都抛出 `GraphUnavailableError`，由全局过滤器 `GraphErrorFilter` 转换为 503（绝不是原始的 500），或者在有回退的用例中转换为降级的响应（例如没有图增强的 RAG 搜索）。

## 后果 {#consequências}

- 图可以通过重放事件日志/outbox 重建（见 Onda 2，RN-416）——绝不是需要靠人工纪律保持同步的第二个事实来源。
- 把 GenServer 的内联 kickoff 迁移为使用图中的模板是**之后**的批次，声明在本次交付之外——本 ADR 只确立该机制存在，并且可以安全地逐步引入。
- 对产品来说是新的、被接受的后果：这是第一个既不是 Postgres 也不是 Ollama 的基础设施依赖。`docker-compose.yml` 为在本地运行 `pnpm dev` 的人多了一个服务，堆内存受限（参考开发机有 15 GB，已经分给了 Postgres、Ollama、api、engine 和 web）。
