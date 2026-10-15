---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0132 — RAG 命中率的 golden-set，以及 gate `rag-acertivo`

## 背景 {#context}

[ADR 0129](0129-telemetria-de-busca-do-rag-como-tabela.md)（第 2 部分，第 1 步）给混合搜索留下了痕迹——
`rag_searches`/`rag_feedback`，权重**冻结**在行中——但有意**什么都没测量**：它只做了埋点。
`pnpm --filter api medir:rag` 在存在时按项目读取这一痕迹。仍然缺少的，是 `rag-search-limits.ts` 自己仍在声明的
东西：

> NENHUM dos quatro números abaixo vem de calibração com dado real: não há,
> ainda, um corpo de perguntas reais rodado contra este índice.

这是同一计划的第 2 步——按产品负责人确定的顺序，五步中的第二步。它不校准任何东西（那是单独的产品决策，第 5 步，
有自己的放弃标准）；它提供第 1 步留作缺口的**问题集**。

### 模子已经存在，就是 ADR 0123 {#o-molde-já-existe-e-é-o-adr-0123}

QA Automação **语义**判断的回归 golden-set（[ADR 0123](0123-golden-set-regressao-qa-automacao.md)）解决了一个
相邻的问题——“如何测量某个不确定的东西的可靠性，不用 CI，带棘轮式下限”——这里的决定是**复用整个结构**，而
不是再发明一次同样的推理：

| 部件 | ADR 0123（QA） | 本 ADR（RAG） |
|---|---|---|
| 别名 | `mix.exs` `"golden_set.qa"` | `"golden_set.rag"` |
| 永久排除 | `test_helper.exs` `:golden_set_qa` | `:golden_set_rag` |
| ExUnit 测试 | `test/engine/gates/qa_automacao_agent_golden_test.exs` | `test/engine/rag/rag_golden_test.exs` |
| 棘轮下限 | `test/fixtures/golden_set_qa/floor.json` | `test/fixtures/golden_set_rag/floor.json` |
| seed | `apps/api/scripts/seed-golden-set-qa.ts` | `apps/api/scripts/seed-golden-set-rag.ts` |

按 **TAG** 的永久排除（绝不检测“Ollama 可达”）出于与 QA 一侧**相同**的理由：这台开发机一直运行着 Ollama，自动
包含会让该模块在**任何** `mix test` 中触发，无声地消耗 token。

### 模子**不**适用的地方——以及为什么这不是偏离 {#onde-o-molde-não-serve--e-por-que-isso-não-é-desvio}

QA 的 golden-set 测试的是一个**聊天 LLM** 的判断，通过 `Engine.Gates.QaAutomacaoAgent.run/5` 调用。RAG 在被测量
的路径上没有任何 LLM 判断——整个混合搜索（embedding + `ts_rank` + 按权重融合 + 按阈值截断）运行在 **api** 内部
（`HybridSearchUseCase`），而不是 engine。只为这个测试而用 Elixir 重新实现搜索，测试的会是**第二个**实现，而永远
不是真实的那个——这正是 ADR 0123 通过使用真实 LLM 客户端而不是模拟判断所避免的错误。

解决方案：`seed-golden-set-rag.ts` 同时做**两**件事——开通**并**搜索——返回已就绪的结果；`rag_golden_test.exs`
只调用该脚本（通过 `System.cmd`，与 QA 一侧相同的机制），并对返回的 JSON 应用下限。Elixir 一侧的角色不是“运行
搜索”，而是“作为 `mix test --only`/永久排除/棘轮下限的唯一入口”——这是产品其余部分已在使用的同一种 golden-set
纪律，应用于一个碰巧完全位于 api↔engine 边界另一侧的机制。

### 问题：组合而成，而非提取——并且说明了，而不是隐藏 {#as-perguntas-compostas-não-extraídas--e-isso-é-dito-não-escondido}

原始请求要的是来自 dogfooding 的**真实**问题。在写本 ADR 之前已验证：
`gh issue list --repo daneiel/brabo --state all` 返回 “No Issues”——这是单人项目，没有使用产品的人在 issue 或
PR 中提出问题的历史（PR 标题全都是 `tipo(escopo): o que mudou`，从不是问题）。

因此，`seed-golden-set-rag.ts` 中的 17 个问题是根据本仓库**真实**的 RN 和 ADR **组合**而成的——绝不是没有依据
地编造。每个问题都有一个 `expectedPath`，即答案所在的真实文件，而组合在写下问题之前通过直接阅读目标文件进行了
验证（而不是通过标题/grep）。这是请求本身为没有真实语料的情况所预见的途径，而假装它们是“真实的”会比声明其为
组合更糟。

### 被索引的语料是真实的、经过策展的，而不是合成的 {#o-corpus-indexado-é-real-curado-não-sintético}

与 QA（其代码骨架是合成的，为每个用例刻意设计）不同，RAG golden-set 的语料是本 monorepo 自身 `docs/` 的一个
**真实子集**——22 个文件（seed 中的 `ARQUIVOS_CURADOS`），逐字复制到被填充项目的仓库中，由任何真实项目都使用的
**同一个** `IndexProjectDocsUseCase` 索引。经过策展，而不是整棵树（真实的树有超过 130 个 ADR）——出于一次手动
运行中 embedding 的成本：在几百个 chunk 中搜索，与在几千个中搜索一样能充分检验向量+词法融合，而每次手动运行都
重新索引一百多个 ADR，会成倍增加时间，却不改善 golden-set 所测量的东西。

### 只有一个项目，而不是每个用例一个 {#um-projeto-só-não-um-por-caso}

QA 的 golden-set 为每个**用例**开通一个仓库，因为每个用例针对**不同的代码**测试不同的业务规则——隔离是必需的。
RAG 的 17 个用例是关于**同一个**文档语料的 17 个问题：拆成 17 个项目会把同样的内容索引 17 次（17 倍的 embedding
成本），去隔离那些本质上就是只读、彼此没有副作用的搜索。

### `execution_mode: 'runner'`，而不是默认的 `container` {#execution_mode-runner-não-o-container-default}

`ReadProjectCodeUseCase.portaoDoContainer`（RN-105）会以 409 拒绝对 `container` 项目的任何读取，直到 Arquiteto
决定一个镜像——`IndexProjectDocsUseCase` 调用这条路径来扫描 `docs/`。golden-set 从不触发 Arquiteto（没有任何
执行可以为此辩护，只有文档索引），因此 seed 以 `execution_mode: 'runner'` 插入项目——RN-169/RN-421 让
`mounted`/`runner` 豁免整个闸门，而这正是为这类情形准备的：没有自己容器的项目，没有理由为了让代码被读取而等待
镜像决定。CHECK `projects_workspace_path_casa_com_modo` 要求 `execution_mode <> 'container'` 时 `workspace_path`
非空——seed 写入一个合成路径（从不使用：没有任何真实 runner 连接到这个项目）。

### 命中标准：文件路径、top-K，绝不是第 1 名 {#o-critério-de-acerto-caminho-de-arquivo-top-k-nunca-rank-1}

预期的命中是**文件路径**，绝不是确切的 chunk——这是 ADR 0123 宽松的尺子在 RAG 上的改编：锁定 chunk 会让
golden-set 在每次调整 chunking 时坏掉，而 chunking 恰恰是本计划存在要能够在不重写用例的情况下修订的参数。

`GOLDEN_SET_RAG_TOP_K = 5`，而不是第 1 名：这才是产品真正使用结果的方式——Chat RAG 在回答旁边引用**多个**片段
（`RagCitationCard`，复数），而不只是第一个。针对第 1 名测量，测量的会是 UI 并不提出的问题。`5` 也不是真实路由
默认使用的 `RAG_SEARCH_RESULT_LIMIT`（10）——请求 10 个并针对 10 个测量，测试的会是比大多数真实搜索更宽松的 k
（Chat RAG 的面板不会滚动去看那 10 个）。标准位于 `apps/api/src/domain/rag/golden-set-criterio.ts`，纯函数并经过
测试（`golden-set-criterio.spec.ts`），理由与 `gate-registry.ts` 相同：“这算命中”的判定不应依赖于结果是如何
到达的。

### 遥测：**开启**，有意为之 {#telemetria-ligada-de-propósito}

`HybridSearchUseCase` 在每次调用时都会向 `rag_searches` 写一行，总是如此——没有关闭它的参数，也不应该有。正确的
问题不是“要关掉吗？”，而是“这会污染真实测量吗？”：不会。`medir:rag` 要求 `--projeto <uuid>`（从不全局聚合，见
脚本自己的头部），而 golden-set 总是创建一个带时间戳后缀的**新**项目——它写入的行永远不会出现在真实项目的
`medir:rag` 中，理由与 QA 的 golden-set 不会污染任何真实项目的指标相同。而真正写入，正是让这个 golden-set 走过
真实 Chat RAG 所使用的**同一条**代码路径的东西。

### gate `rag-acertivo` {#o-gate-rag-acertivo}

```yaml
- id: rag-acertivo
  fluxo: transversal # o RAG serve todos os fluxos, como acao-aprovada
  dono: usuario
  entrada: [golden-set-rag]
  entregavel: taxa-de-acerto-acima-do-piso
  verificacao: script
  severidade: warn
  aprovacao_humana: false
  status: active
  evidencia:
    tipo: teste
    arquivo: apps/engine/test/engine/rag/rag_golden_test.exs
```

`fluxo: transversal` 和 `dono: usuario` 有意复用自 gate `acao-aprovada`——这两个字段都不针对枚举校验
（`apps/api/src/domain/gates/gate-registry.ts`），而发明一个只有一个成员的新类别（`instrumentos`/`medicao`）会
通过校验器却没有任何意义。如果有一天想要一个 `medicao` 负责人，它已经作为**角色**存在于 `docs/fluxo.yml` 中
（`camada_instrumentos`），引入它是另一个决定，而不是这个 gate 的副作用。

`evidencia.tipo: teste`，而不是 `event_log`——证明这个 gate 的是 golden-set 本身，而不是日志中的事件（golden-set
的通过没有关联的 `proposed_action` 或领域事件）。先例：`merge-protegida` 出于同样的理由已经使用 `tipo: teste`——
保证不来自 event log。

`severidade: warn` 是**必需的**，而不是风格上的：RN-070 要求 `block` 必须有 `verificacao: script`（这个 gate
**有**），但 warn 的决定来自别处——没有带 LLM 的 CI（与 QA 的 golden-set 已记录的决定相同），因此该 gate **手动**
运行，而承诺 `block` 会描述一个并不存在的自动拦截。`docs/explanation/gates.md` 获得了“为什么是 warn”的第五个
完整示例，沿用前四个（`necessidade-validada`、`workspace-verificado`、`implementavel`、`paralelismo-autorizado`）
同样的论证结构。

`entrada: [golden-set-rag]` 不是对另一个 gate 的引用——校验器的启发式（以 `-verificada`/`-segura` 结尾的
`entrada`）不匹配这个名称，因此不会触发孤儿检查。这是通过阅读
`apps/api/src/domain/gates/gate-registry.ts`（`pareceGate`）确认的，而不是假设的。

## 决策 {#decision}

1. 把 ADR 0123 的结构（别名、永久排除、ExUnit 测试、按**模型**——这里是 **embedding** 模型——的棘轮下限、经由
   `System.cmd` 的外部 seed）复制到 RAG 领域，带上该领域要求的两处改编：seed 运行搜索（不只是开通，因为判断完全
   位于 api 一侧），以及语料是真实且经过策展的（而不是合成的）。
2. `apps/api/src/domain/rag/golden-set-criterio.ts`——纯函数，经过测试——定义命中标准（文件路径、top-5，绝不是
   确切 chunk/第 1 名），由 seed 以及任何未来的调试调用消费。
3. `docs/gates.yml` 获得 `rag-acertivo`，`warn`，`status: active`，`evidencia.tipo: teste` 指向 ExUnit 测试。
4. `floor.json` 以 **embedding** 模型为键（`RAG_EMBEDDING_MODEL`，如今是 `nomic-embed-text`——产品唯一支持的，
   RN-222），计数加 `of`，绝不是百分比，只由人写入。

## 后果 {#consequences}

**接入 CI 是 `TODO(humano)`，与 QA 相同。** 没有 API LLM 的机密或新的基础设施（CI 中真正的 Ollama），
golden-set 就**手动**运行——`mix golden_set.rag`——绝不在普通的 `mix test` 中运行。

**这 17 个问题测量的是在 22 个文件的语料上的检索，而不是真实的 130 多个 ADR。** 针对完整语料的 golden-set 会测量
更真实的难度分布（更多看似合理的干扰项，两个文件覆盖同一问题的机会更大）——这是一次手动运行中 embedding 成本的
决定，如果真实运行显示上限被人为地做得太容易，可以修订。

**golden-set 测量的是检索，而不是回答。** 它从不调用聊天 LLM 来根据命中合成答案——只测量正确的路径是否
出现在候选之中。这与第 1 步（`medir:rag`）也使用的指标相同（`precision@k`、排名分布），因此两个工具说的是同一种
语言。

**关于真实运行以及下限记录了什么：** 见 `test/fixtures/golden_set_rag/floor.json` 中带测得结果的 `_comment`
注释（或者，如果本会话的环境不允许针对真实 Ollama 运行，则是测量仍待人工运行的声明）。
