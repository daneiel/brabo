---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# 0082 — Chat RAG：混合搜索的独立标签页，不重命名“Chat”

## 状态 {#status}

已接受。

## 背景 {#contexto}

[ADR 0080](0080-busca-hibrida-pesos-limiar-e-citacao.md)（PROGRAMA 28，Onda 4，frente G2）让索引管道和 Chat RAG 的三个 HTTP 路由就绪——`POST .../rag/search`、`POST .../rag/reindex`、`GET .../rag/coverage`——但明确声明**界面**是 Onda 5 的工作。与此同时，[ADR 0078](0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md)（RN-202）已经决定 `sessions` 标签页继续标为“Chat”，绝不是最新 handoff 所要求的“Chat RAG”——因为在那个时刻，“Chat RAG”描述的是产品并不具备的能力（没有管道，没有引用的 UI）。这条战线（Onda 5，G3）是这项能力真正开始存在的时刻，它需要回答的问题是：既然 RAG 已经存在，“Chat RAG”这个标签放到哪里？

两个选项：把 `sessions` 重命名为“Chat RAG”（handoff 字面上建议的），或者给“Chat RAG”一个**独立**的标签页。这两个界面回答的是结构上不同的问题——`sessions` 是与一个**已激活**的 agent 的对话，每个回合花费 owner 的密钥（RN-058），并且可以写入 backlog、代码以及 agent 拥有的任何工具；RAG 是对一个**已经构建好**的索引的搜索，中间没有任何 agent，本质上只读（ADR 0080 的三个路由是 `viewer`/`viewer`/`maintainer`，没有一个调用对话式 LLM）。把两者合并到同一个标签页，会迫使 UI 在同一个消息流中表达“这是一个已索引 chunk 的引用”和“这是一个 agent 的发言”，而用户从未同时要求这两件事。

## 决策 {#decisão}

**“Chat RAG”成为独立的标签页，`key: 'rag'`，不触碰 `sessions` 的标签。** RN-202 仍按原样有效——`sessions` 从来不是“Chat RAG”，现在也仍然不是——但其理由从“能力不存在”变成了“能力存在于**别处**”。该标签页进入 `apps/web/src/routes/project-tabs.ts`（`ordem: 28`，紧跟 `code` 之后，在 `backlog` 之前）——与代码标签页所处的“查看已产出/已索引的内容”同一邻域，并在 Backlog 之前，那里是新产出诞生的地方。

**界面消费 ADR 0080 的三个契约，不猜测形态**（`apps/web/src/lib/api-client.ts`/`api-types.ts` 获得 `searchRag`/`getRagCoverage`/`reindexRag`，以及与 DTO 1:1 镜像的类型——`RagSearchHit`、按 `kind` 区分的联合类型 `RagChunkOrigin`、`RagCoverage`）。UI 有三块：

1. `RagCoveragePanel`——已索引的 `docs`/`adr`/会话相对于真实总数的**真实**计数，以及 `chunksTotal`/`chunksWithoutVector`。没有“reindexado há Xmin”：自 ADR 0080 起后端的响应就不带这个数据，也不该由这个界面来编造它（RN-252）。
2. 带范围过滤的搜索（`docs`/`adr`/`session` 药丸按钮，缺省 = 全部），以及在 `vectorAvailable: false` 时的提示——“busca só por palavra-chave — embedding indisponível”，后端给出原因时附上原因（RN-252，RN-233 同样诚实的降级到达了 UI）。
3. `RagCitationCard`——带综合得分和两个分开信号的引用（信号没有找到 chunk 时为 `null`，绝不是 0%，保留 ADR 0080 的区分）。来源 `file` 以文本显示路径/`headingPath`；来源 `session` 通过 `useNavigate` + `search: { highlightEvent }` 导航到**确切**的事件——与 Psicólogo 的证据 chip 已经使用的**同一个**路由和同一个参数（`HypothesisCard.tsx`，Fase 4b）——复用，而不是第二条导航路径（RN-253）。

**“Reindexar agora”按钮只对 `owner`/`maintainer` 显示**，在客户端镜像路由已经应用的尺子（RN-238）——与 `ProjectSettingsTab`/`ProjectApprovalsTab` 已经用于其他 `maintainer` 闸门的 `useCurrentWorkspaceWithRole` 模式相同（RN-254）。没有该角色的人根本看不到按钮，而不是看到它被禁用：重新索引会对项目仓库和 embedding provider 发起 N 次调用，这与领域并行上限（RN-083）的“不经询问就改变产品花费”是同一把尺子。

## 后果 {#consequências}

**RN-202 推迟的承诺到来了，但不是按 handoff 设计的方式。** handoff 重命名一个已有的标签页；产品打开一个新的。鉴于这两个界面从来不是同一个问题，这是最站得住的决定——而且错了的代价（注册表中多一个标签页）小于把与 agent 的对话和对索引的搜索混在同一界面的代价。

**没有指向代码标签页的按路径深链接。** 来源为 `file` 的引用以纯文本显示 `sourcePath`/`headingPath`，不导航——代码标签页（FASE 26/26b）今天没有通过路由/`search` 打开到特定文件的机制，构建该机制超出了这条战线的范围。这一点被声明，而不是半实现：文本显示真实路径，只是不可点击。

**客户端的 `maintainer` 闸门只是 UX。** 保证 `reindex` 不在没有该角色时运行的仍然是 api（`RequireRole`，RN-238）——界面只是避免一次 api 无论如何都会拒绝的点击。这遵循产品所有其他 UI 闸门的相同模式（auto mode、并行上限、领域模型）：没有一个替代服务器的检查。
