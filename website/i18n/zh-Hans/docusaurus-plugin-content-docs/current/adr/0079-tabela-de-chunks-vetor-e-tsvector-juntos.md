---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0079 — chunk 表：向量与 `tsvector` 在同一行

- **状态：** 已接受
- **日期：** 2026-08-15
- **先前背景：** [ADR 0075](0075-embeddings-no-contrato-de-llm-provider.md)
  （`LLMProvider` 合约中的 embedding，没有消费的基础——`embed?` 只针对 Ollama 证明）、[ADR 0072](0072-projeto-local-ou-container.md)
  （用数据库 CHECK 绑定一对互斥的列，与这里用于 `session_id`/`source_path` 的模式相同）、[ADR 0078](0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md)
  （为什么标签页继续标为“Chat”而不是“Chat RAG”——本迁移**不**改变这个标签）

## 背景 {#contexto}

设计 handoff 所宣布的 Chat RAG（`design_handoff_brabo/designs/Brabo
Chat.dc.html`）需要一个地方来保存带 embedding 向量的已索引片段——今天**没有**任何这样的表。ADR 0075 让合约就绪（`LLMProvider.embed?`，在 Ollama 上用 `nomic-embed-text` 证明的 capability，768 维向量），但还没有任何东西写入或读取索引：没有表，合约就是一扇门后没有房间。

生成迁移之前有两个问题需要决定，两者都是结构性的，而不是实现层面的：

1. **向量和词法搜索住在同一张表中，还是两张？** 第 4 波（不在本迁移范围内）将构建**混合**搜索——语义（`pgvector`，余弦相似度）与词法（`tsvector`，Postgres 全文）结合。如果这两种信息住在不同的表中，每次混合搜索都需要按 `chunk_id` 做一次 JOIN，而且两张表可能分歧（一个片段有向量却没有词法条目，或反之），数据库没有任何机制阻止。
2. **索引覆盖哪些作用域？** handoff 暗示“在项目中搜索”，这对设计一个列来说太模糊了。调查**恰好**找到产品已经产出、并知道其来源的三种文本：`docs/` 的文件、ADR（也是文件，但有自己的身份——ADR 可以按编号引用，普通文档不行）以及会话（event log 已经有足够多的文本）。源代码和 Pull Request **刻意**被排除在外：两者在每次 `push` 时都会变化，在没有重新索引监视器的情况下索引它们，会让索引在覆盖率上**撒谎**——这是 ADR 0042 对模型 capability 早已拒绝的同一类错误（“未证明就声明”）。三个覆盖**诚实**的作用域，胜过五个带着编造数字的作用域。

第三点不是产品决定，而是一个对部署有影响的技术发现：`docker/postgres/init.sql:2` 运行 `CREATE EXTENSION
IF NOT EXISTS vector`，但这个文件只在 Postgres 卷**第一次**初始化时执行。带旧卷的环境——可能包括生产——可能没有安装该扩展，而创建它需要应用角色可能没有的权限。

## 决策 {#decisão}

**只有一张表 `chunks`，`embedding vector(768)` 和 `search_vector
tsvector` 是同一行的兄弟列。** `search_vector` 是 `GENERATED
ALWAYS AS (to_tsvector('portuguese', content)) STORED`——从不由应用写入，按 Postgres 的构造始终与 `content` 一致，并在 `INSERT` 的同一事务中就绪（不依赖任何 LLM provider 的响应）。`embedding` 可为**空**：索引流水线（第 4 波）尚不存在，让 CHUNK（文本切片）等待**向量**会把两种性质不同的失败——文档解析对比对 provider 的网络调用——混进一次原子写入中。

**在 `embedding` 上使用 HNSW 索引（`vector_cosine_ops`），而不是 IVFFlat。** IVFFlat 需要已加载的行来训练列表（`lists`）——在空表上构建（这正是这张表诞生时的状态，还没有索引流水线），索引会一直很差，直到有人在填充后手动重建。HNSW 逐次插入、增量地构建图，没有训练步骤——索引从第一行起就很好。使用 `vector_cosine_ops`，因为这是文本 embedding 通常期望的度量（相似度排序不应随向量的模而改变）。

**在 `search_vector` 上使用 GIN 索引**——词法那一半已为第 4 波的混合搜索准备好，通过 `@@`/`ts_rank` 使用，无需在查询时计算任何东西。

**三个作用域（RN-219）是一个 `pgEnum`——`docs` | `adr` | `session`——而 `session_id`/`source_path` 通过 CHECK 互斥，而不是通过应用约定**，与 ADR 0072 用于 `workspace_mode`/`workspace_path` 的模式相同：`scope = 'session'` 要求 `session_id` 有值并拒绝 `source_path`；`docs`/`adr` 要求 `source_path`（源文件的相对路径）并拒绝 `session_id`。锁放在数据库中，因为写入这张表的将是一条流水线（第 4 波），它不一定每次都经过同一个用例——批量重新索引脚本是绕过仅应用层验证的明显候选。

**迁移自己携带 `CREATE EXTENSION IF NOT EXISTS vector`**，而不是假设 `docker/postgres/init.sql` 已经运行过。`IF NOT EXISTS` 是幂等的——本地（扩展已安装，在撰写本 ADR 之前用 `SELECT * FROM pg_extension WHERE extname='vector'` 确认过）和新环境都经过同一行，没有可见的行为差异。

**本迁移诞生在 `breaking/` 分支，而不是 `feature/`。** 创建扩展需要应用角色具有 `CREATEDB`（或者扩展被 DBA 标记为“trusted”）。本地角色是超级用户（用 `SELECT rolsuper FROM pg_roles WHERE rolname=current_user` 确认过），但在生产中不能保证这一点——托管 Postgres 的管理者经常不给应用超级用户。如果迁移在那里失败，那就是部署前的**操作员**动作（以超级用户身份运行一次 `CREATE EXTENSION vector;`），而不是产品的 bug——这正是 CLAUDE.md 已用来决定 `breaking/` 与 `bugfix/`/`feature/` 的标准：“需要操作员在部署前采取行动的变更，即使内容是修正，也在 `breaking/` 中诞生”。

## 后果 {#consequências}

**本迁移交付的只是**基础**：** 表、索引、基本读写的仓储（`ChunkRepository`）。它不写入任何一行——没有索引流水线，没有混合搜索，没有 UI。标签页继续是“Chat”（ADR 0078）；在第 4 波交付“Chat RAG”这个名字所承诺的东西之前，标签不变。

**重新索引 `docs`/`adr` 是编写流水线者（第 4 波）的责任，而不是本迁移的**——表中没有源文件的哈希/版本列来检测变化，因为这个决定属于真正运行重新索引、并知道哪种策略（内容哈希、`mtime`、提交版本）适合尚不存在的监视器的人。

**源代码和 PR 继续不在索引中。** 如果某天加入，决定必须带有按 push 重新索引的机制——这不是对枚举 `chunk_scope` 的简单扩展，因为这张表诚实覆盖的保证取决于每个作用域都有清晰的“这个 chunk 何时过时”的故事。

**在生产中，本迁移可能停在 `CREATE EXTENSION`**，如果应用角色没有权限——这是刻意的行为（及早、响亮地失败），而不是让表在没有可用 `vector` 类型的情况下诞生，然后在第一次尝试 `INSERT` 时以更令人困惑的方式失败。
