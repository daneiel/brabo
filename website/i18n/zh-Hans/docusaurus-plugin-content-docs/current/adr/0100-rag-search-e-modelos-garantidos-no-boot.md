---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0100 — 面向 agent 的 `rag_search`，以及启动时确保存在的 Ollama 模型

- **状态：** 已接受
- **日期：** 2026-08-20
- **背景：** 知识图谱的基础（RN-413/414/415），与 [ADR 0099](0099-neo4j-grafo-de-conhecimento-e-templates.md) 配套

## 背景 {#contexto}

RAG（pgvector，向量+词法的混合搜索，ADR 0079/0080/0082）自 Programa 28 的 Onda 4/frente G2 起就已在 api 中完整存在——但在本次交付之前，`grep -rn "rag" apps/engine/lib` 的结果是**零**。**没有任何 agent 查询过自己项目的 RAG。** 这是当前设计中最大的空缺：产品构建了一个索引，却只有 web 的“Chat RAG”标签页读取它。

第二个发现，同样真实且不属于本功能：`nomic-embed-text`（`rag-search-limits.ts` 中的 `RAG_EMBEDDING_MODEL`）**从不被自动拉取**。`docker-compose.yml` 中 `ollama` 服务的 entrypoint 只拉取 `llama3.2:1b`。在任何干净的环境中，RAG 都会静默降级为纯词法搜索，直到有人手动运行 `ollama pull nomic-embed-text`——之前没人注意到，因为产品直到现在都没有一个能让降级尽早显现的程序化搜索使用者。

## 决策 {#decisão}

**新工具 `rag_search`**（`apps/engine/lib/engine/harness/tools/rag_search.ex`），类别 `:direct`（读取，不经过 `ActionPipeline`/`proposed_action`——读取不是外部效果，这是既定规则）。它调用 `POST /internal/rag/search`（api 的新路由，复用 `HybridSearchUseCase`，不重复搜索逻辑），并以显式**引用**（`path` + 片段）格式化命中结果，使模型能够引用所读内容的出处。当响应带有 `degraded: true`（embedding 不可用，搜索降级为纯词法）时，这一点出现在返回给模型的文本**开头**——绝不藏在末尾，因为按字节上限截断可能会删掉这个警告。

**独立的上限**，秉承 RN-150 的精神（每个可能超限的读取工具都有它**自己**的变量，绝不复用别人的）：`top_k` 在工具内部被钳制到一个最大值（10），以及格式化文本的**字节**上限（16 KiB，小于 `search_workspace`/`read_file` 的 32 KiB——每个 RAG 命中已经是完整的 chunk+excerpt，每项累积字节更快）。

注册在默认注册表（`Engine.Harness.Tools`，服务 PO/Arquiteto/对话式 agent）和 dev agent 的注册表（`Engine.Dev.Tools`）中。也扩展到已经引用已索引 ADR/约定的读取型 gate（`QaTools`、`QaEstrategiaAgent`、`AppSecAgent`、`QaPerformanceSegurancaAgent`）——不包括 `Infra.WorkflowsAgent`（有意保持狭窄，目前没有 `ReadFile`/`SearchWorkspace`），也不包括 Psicólogo/Anamnese（它们推理的是事件日志，而不是项目的文档/代码）。

**`ollama-model-loader`**：`docker-compose.yml`（开发和生产）中的新一次性服务，通过 `OLLAMA_REQUIRED_MODELS` 拉取 `gemma:1b`、`yi-coder:1.5b` 和 `nomic-embed-text`——是对现有 `ollama` 服务的补充（其 entrypoint 继续为 engine 自身使用拉取 `llama3.2:1b`，未改动）。它修复了 `nomic-embed-text` 从不自动到位这个真实 bug，而不仅仅是本功能的需要。

## 后果 {#consequências}

- 面向 agent 的 RAG 能力只在被实际执行时才声明——对 `POST /internal/rag/search` 的真实往返取决于 api 路由是否在线；api 不可用时，工具以模型可读的错误降级（绝不让 `ToolLoop` 崩溃，RN-163）。
- `deploy/k8s/` 获得 Neo4j 和 model-loader 的最小清单，**声明**为未针对真实集群验证（与 `deploy/k8s/` 其余部分同样的纪律：能力只在被证明时才声明）。
- `rag_search` 的 embedding 成本暂不经过计量——与 ADR 0075 对 RAG 整体已声明的缺口相同（`token_usage.session_id` 是 `NOT NULL`，索引不在会话内发生）。
