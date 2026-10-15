---
traducao_de: 4a96d14a43984b17eb9c018ce61b5286964878b0
---

# ADR 0129 — RAG 搜索的遥测是**表**，权重冻结在行中

## 背景 {#context}

`apps/api/src/domain/rag/rag-search-limits.ts` 在自己的注释中声明，混合搜索的四个数字——两个权重（0.6/0.4）、阈值（0.2）以及每个信号的候选数——都不是来自任何校准：

> NENHUM dos quatro números abaixo vem de calibração com dado real: não há,
> ainda, um corpo de perguntas reais rodado contra este índice.

[ADR 0080](0080-busca-hibrida-pesos-limiar-e-citacao.md) 选择这些值时记录了推理（`ts_rank` 和余弦的尺度不可比较，向量一侧更大的权重补偿了词法那把更短的尺子），并说它们会用数据复审。数据从未到来，原因不是缺少使用：搜索**不留下任何痕迹**。整个产品中零行表、零个 `rag.*` 事件。没有痕迹，"校准"就是用一个猜测替换另一个——更糟的是，在实践中不可逆，因为没有东西可以用来比较之前和之后。

这是可度量 RAG 计划五个阶段中的第一个，也是唯一一个有意**不改变搜索行为**的阶段：它给出眼睛，然后停下。

### 具体障碍 {#o-obstáculo-concreto}

显而易见的出路是会话事件——event log 早已是产品其余部分的测量工具，而 CLAUDE.md 的规则说执行指标由脚本从中提取，绝不手工记录。但 `session_events.session_id` 是 `NOT NULL`（`apps/api/src/db/schema/sessions.ts`），而**来自 RAG 标签页的搜索属于项目**：它没有任何会话。只把遥测记录为事件，恰恰会丢失那些有人看过分数并作出判断的搜索——它们承载着测量所能拥有的唯一真实信号。

这与迫使 [ADR 0075](0075-embeddings-no-contrato-de-llm-provider.md) 切掉嵌入计量的是同一类问题：`token_usage.session_id` 同样是 `NOT NULL`，而索引仓库不发生在会话之中。那里的切分被声明，花费被排除在外。这里的切分会更糟：只剩下一半的搜索，而剩下的是 agent 的那些——没人评判的那些。

## 决策 {#decision}

**1. `apps/api/src/db/schema/rag.ts` 中的两张表，而不是事件。**

`rag_searches`（每次搜索一行：`hits` 带每个片段从 1 开始的排名、`degraded`/`vector_available`、`latency_ms`、操作者，以及**可为空**的 `session_id`）和 `rag_feedback`（对某次搜索中某个片段的 `util`/`irrelevante` 投票）。该聚合的文件早已存在（`chunks`），所以 barrel `db/schema.ts` 没有变化；按照 [ADR 0121](0121-schema-dividido-por-agregado-de-dominio.md) 的约定，枚举 `rag_verdict` 与调用它的表放在同一个文件中，`actor_kind` 则复用自 `sessions.ts` 而不是重新声明。

`session_id NULL` 是**信息**，不是数据缺失：它意味着搜索来自标签页。

**2. 权重被**冻结**在行中。**

`pesosVigentes()`（`domain/rag/rag-telemetry.ts`）把搜索那一刻的 `{vector, lexical,
threshold}` 复制进记录。这与计量中冻结价格（[ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)）以及 `project_containers` 的 `image_version`（[ADR 0081](0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md)）是同一纪律。

没有这份副本，第一次改动 `RAG_SEARCH_WEIGHT_VECTOR` 的校准就会让之前的所有测量**静默地**变成另一种含义——而"改动之后变好了吗？"，遥测存在所要回答的唯一问题，就无法用手头的数据去问。它有意是函数而不是导出的常量：一个共享的常量在内存中会是 JSONB 每一行里的同一个对象。

**3. 事件存在，而它是**叙述**。**

`rag.search` 和 `rag.feedback` **只在有会话时**——agent 的路径——才进入 event log，让时间线叙述它做了什么。这种不对称被声明而不是隐藏：**表是测量的来源，事件是叙述**，`medir:rag` 从不读取 event log。

两种类型在发出点上被**完整**写出，而不是通过常量：`docs/reference/events.md` 的清单是通过对 api 代码 grep `type: '<x>.<y>'` 生成的，藏在常量后面的类型对它不可见——文档会在一份不完整的列表上显示为绿。`execution.activated` 早已使用同样的形式。`'rag'` 在同一次提交中进入 `PREFIXOS_DE_EVENTO`（`scripts/docs/generate.mjs`）。

**4. 写入遥测从不拖垮搜索，也从不静默失败。**

INSERT 在 `HybridSearchUseCase` 内部的 `try/catch` 中运行：提问的人不应因为测量工具倒下就失去答案。但失败会变成带有分类来源（`infra`，[ADR 0020](0020-destravar-gates-qa-secops.md)）的日志，并在响应中给出 `searchId: null`——这与"什么都没找到"**不**一样：它是"没有可以附加投票的东西"，UI 需要把两者分开，以免提供一个 api 会拒绝的控件。

**5. 投票要求搜索返回的引用，并且是 `:direct`。**

未知的 `searchId`，或者不在那次搜索命中结果中的 `chunkId`，都是 400。这不是装饰性的严格：被投票片段的**排名**正是区分"索引贫乏"与"**权重**错了"的东西——贫乏的索引在任何位置都不返回正确的片段，错误的权重会在第 7 名返回正确的片段——而没有排名的投票产生没有意义的数字。

engine 的工具（`rag_feedback`）是 `category: :direct`，**不**变成 `proposed_action`：给一个片段打分没有外部效果，把它变成待批准的操作会让队列塞满噪音，直到没有人再去读真正的那些（与让 `rag_search`/`read_file` 留在流水线之外的是同一把尺子）。拒绝以带有 api 消息的**错误 tool-result** 返回，让模型去修正（RN-061/RN-163），绝不是崩溃。

**6. `medir:rag` 只因一件事失败。**

整个窗口中都是 `vector_available: false`：此时测量的不是混合搜索，而是它的词法那一半，针对它校准向量权重，就是针对一个不是实际运行的系统做校准。其余一切——`precision@k`、降级率、没有超过阈值命中的搜索、p50/p95 延迟、被投为有用者的排名分布——都是**报告**：出现在表中，不判定失败。与 `medir-execucao.ts` 同一模子。

## 后果 {#consequences}

**校准变得可能，但仍未进行。** 本阶段有意不改变分块、权重或阈值：在积累测量之前改动数字，会摧毁它存在所要建立的基线。该条目在 CLAUDE.md 中继续被声明为开放，现在旁边有了工具。

**`degraded` 和 `vector_available` 是两列，今天是冗余的。** 此刻 `degraded = !vector_available`。冗余在 schema 中被声明而不是隐藏，不在读取时从一个派生另一个的原因是，它们回答的不是同一个问题：`vector_available` 是关于搜索那一刻嵌入 **PROVIDER** 的事实——正是它让 `medir:rag` 失败——而 `degraded` 是与 engine 的**契约**（`POST /internal/rag/search`）中的用词，其定义可以扩展到其他降级，而 provider 并没有倒下。派生会把两者永远绑在一起。

**投票在"Reindexar agora"之后不会存活。** `rag_feedback.chunk_id` 以**级联**方式引用 `chunks`。重新索引会删除并重建 chunk，所以评判的历史也随之消失。保留指向已不存在片段的孤儿投票测量不了任何东西——但代价是真实的，并写在 schema 中：重新索引的人失去比较基础，测量重新开始。

**`precision@k` 测量的是被**评判**的东西，而不是被返回的东西。** 分母是排名 ≤ k 的被投票命中数，绝不是 `k`。没有投票的命中是**未知**的，不是不相关的，把它算作不相关，会让精确度在每次有人投票更少片段时自行暴跌——测量的是投票意愿，而不是搜索质量。被接受的后果是，这个指标只在有投票的地方存在：没有任何投票时，它是 `null`，表上写"未测量"，绝不是 0。

**与 engine 的内部契约在两个方向上增长了。** `POST /internal/rag/search` 开始在请求体中接受**可选**的 `sessionId`/`agent`（api 无法推断两者中的任何一个；一个它没有收到的会话，就是一个不存在的会话），并返回 `searchId` 以及每个命中一个 `chunkId`。`chunkId` 是该 DTO 有意简化的唯一例外——没有 `searchId`/`chunkId` 这一对，agent 就没有可以指向的东西。当 `searchId` 为 `null` 时，工具**省略** id 和投票邀请，而不是向模型提供一个会被拒绝的引用。

**六个 agent 的提示中多了一个工具。** `rag_feedback` 进入早已有 `rag_search` 的六个注册表（`dev/tools.ex`、`gates/qa_tools.ex`、`qa_estrategia_agent.ex`、`qa_performance_seguranca_agent.ex`、`appsec_agent.ex`、`harness/tools.ex`）。真实代价：每个轮次的上下文中多一段规格。替代方案——只有人工反馈——会漏掉大部分搜索所经过的路径。

**一条会**写入**的 `viewer` 路由。** `POST /projects/:projectId/rag/feedback` 与 `search` 角色相同，而不是 `maintainer`：投票既不花钱也不配置任何东西，它是观察，限制它会掏空测量唯一的事实来源。它在 `docs/security-surface.md` 中按这一推理归类；约束是用例对引用的校验，而不是角色。

**没有新 agent，也没有 gate。** golden set 和 `rag-acertivo` gate 是下一个阶段，它们依赖本阶段先积累数据才能存在。
