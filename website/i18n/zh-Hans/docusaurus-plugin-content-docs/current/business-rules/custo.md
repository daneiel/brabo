---
id: custo
title: '业务规则——成本'
sidebar_label: 成本与计量
description: '关于预算、计量（metering）、支出报告和成本上限的 RN——因篇幅原因从 business-rules.md 中拆出。'
keywords: [业务规则, 成本, 预算, metering, token]
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
---

# 成本

> 这些 RN 从 [`business-rules.md`](../business-rules.md) 中拆出，内容一字未改：单页已超过 640 KB，
> 仅这两个部分就占了一半。锚点 `#rn-NNN` 保持不变——只是承载它们的文件变了。

### RN-017 — 预算的范围是互斥的：项目**或**会话 {#rn-017}

一个 `budget` 引用一个项目或一个会话，绝不同时引用两者——由数据库中的 `check` 保证，而不只是代码。

- **位置：** `apps/api/src/db/schema/llm.ts`（`budgets_scope_check`）
- **测试：** 约束本身就是保证

### RN-018 — 预算在 70%、90% 和 100% 时通知，不重复 {#rn-018}

每个阈值**只触发一次**；最后一次通知的阈值持久化在
`budgets.last_threshold_notified` 中。

- **位置：** `apps/api/src/domain/llm/budget-threshold.ts:1`
- **测试：** `test/domain/llm/budget-threshold.spec.ts`

### RN-019 — `policy = 'block'` 拒绝调用；`'allow'` 只做记录 {#rn-019}

- **位置：** `apps/api/src/domain/llm/budget-threshold.ts:4`
- **边界情况：** 处于 `allow` 的项目在达到上限时**不会停下**。这是"预算没拦住"最常见的原因——见
  [runbook](../runbook.md)。

### RN-020 — 模型按级联解析，从最具体到最一般 {#rn-020}

`session > agent > area > project > workspace`。第一个存在的胜出。`area` 在 FASE 23 加入——关于它的位置，以及对已经读过这个级联的人有什么变化，见 [RN-102](#rn-102)。

- **位置：** `apps/api/src/domain/llm/binding-resolver.ts`
- **测试：** `test/domain/llm/binding-resolver.spec.ts`

### RN-040 — agent 的 binding 要求原生 tool calling {#rn-040}

只有当模型具备 `supports_tool_calling` 时，才允许把模型绑定到**agent**（`scope = 'agent'`）。agent 只存在于 ToolLoop 之内，而 ToolLoop 只有在模型懂得**请求**工具时才能工作；否则失败会在后面表现为"agent 没做完就停了"，这正是
[ADR 0020](../adr/0020-destravar-gates-qa-secops.md) 所禁止的排除法诊断。拒绝是 422，消息指向**"适用于 agent"**过滤器——没有这个指引，规则就成了死胡同。

engine 的 `ToolCallRecovery` 会挽回模型以散文写出的调用，但它是**救援，而不是许可**：它依赖模型碰巧写对格式。

只有 `agent` 做校验。`workspace` 和 `project` 是人工聊天的回退，`session` 是对话——它们都不运行 ToolLoop，锁住它们会禁止产品中只能聊天的模型。`context-manager` agent 在构造上已被覆盖：它是 `agent` 范围*之内*的一个 slug，而不是一个独立的范围。

**附加说明——过滤器改为默认*勾选*，而打开它的是*范围*。** 上面一段说拒绝指向"适用于 agent"过滤器，"否则规则就成了死胡同"——而很长一段时间里它确实是：让选择器在打开时勾选过滤器的 prop 从 Fase 9c 起就存在，却**没有任何生产界面传递它**。agent 的选择器打开时提供只能聊天的模型，点击它们只是为了被拒绝。写入经校验范围的两个界面改为打开时即过滤——`ModelsSection`（agent）和
`AreaModelsSection`（区域）——，而决定谁打开它的尺子不是界面，而是
`assertModelFitsBindingScope`：api *拒绝*的地方，过滤器默认勾选；api 不拒绝的地方，由人来选择。因此*会话*选择器仍然没有过滤——在那里勾选会隐藏 api 接受的模型。**这并不消除 422**：过滤器只覆盖三个原因之一，另外两个（[RN-043](#rn-043)——在 workspace 中被停用、从提供方消失）仍然可能出现，不可用的模型仍会被*列出*并标记；[RN-470](#rn-470) 的拒绝结果仍然是说明发生了什么的东西。而且它是复选框的*初始*状态，不是锁：取消勾选就会重新列出全部。

**后果：被过滤器隐藏的现行模型会被*说出来*。** `workspace` 和
`project` 从未要求 tool calling，而解析 agent 或区域 binding 的路由调用 `ResolveModelBindingUseCase` 时**不带**
`exigeToolCalling`——因此这些层级上只能聊天的默认值会被正常解析，成为该行的现行模型。在过滤器勾选时，触发器显示的名称不在打开的列表中，也没有任何选项被选中。选择器现在会点名该模型和原因；它*可以*点名原因，因为那里只有一个过滤器。当整个列表都为空时，说话的仍然是空列表文本，它已经让人取消勾选——关于同一个复选框的两条提示只是噪音。

**事实更正，而不是对上文的更正：**"Only `agent` validates" 描述的是 Fase 9a。自 [ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md) 起，
`area` 进入*同一*校验——它不是通用回退，区域模型唯一的消费者是该区域的 agent（[RN-102](#rn-102)）——，这就是打开过滤器的界面有*两个*的原因。

- **位置：** `apps/api/src/domain/llm/model-capabilities.ts:38`；
  `apps/web/src/components/ModelPicker.tsx`（过滤器和隐藏现行模型的提示），`apps/web/src/routes/settings/ModelsSection.tsx`、
  `apps/web/src/routes/settings/AreaModelsSection.tsx`（打开它的界面）
- **测试：** `test/domain/llm/model-capabilities.spec.ts`、
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`；
  `apps/web/src/routes/settings/filtro-de-aptos.test.tsx` 和
  `apps/web/src/routes/SessionPage.filtro-de-aptos.test.tsx`（打开过滤器的两个界面，以及不打开的那个）
- **来源：** [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)

### RN-041 — 提供方未给出的 token 计数被标记为估算 {#rn-041}

当提供方的响应不含 `usage` 时，OpenAI 兼容基类用 tokenizer 在本地计数，并以
`estimated: true` 发出 chunk。这个数字仍可用于计费，但这个标记保留了**"提供方说是零"**与**"提供方什么也没说"**之间的区别——正是它让 UI 能够限定成本，而不是显示一个来历不明的值。

另外两个提供方有分歧，而分歧被规范化，而不是被隐藏：Ollama 在没有 `done` 行时干脆不发出 `usage`；Anthropic 不能省略计数，因为在其协议中 `usage` 在
`message_start` 里是必需的。三种响应见
[docs/reference/llm-providers.md](../reference/llm-providers.md#normalized-divergences)。

- **位置：** `apps/api/src/infrastructure/llm/openai-compatible-provider.ts:167`
- **测试：** `test/contract/llm-provider.contract.ts`（场景
  `sem_usage`，针对三个提供方运行）
- **来源：** [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)

### RN-042 — 计量记录*实际服务*调用的是谁，而不只是调用从哪里进入 {#rn-042}

当调用经过一个会告知真实提供方的 hub 时，`token_usage` 除了入口提供方外，还在 `upstream_provider` 中记录该提供方。没有 hub——或 hub 没有告知——时，该字段是**`null`**，绝不是空字符串：按提供方统计成本的查询需要区分"没有经过 hub"和"经过了 hub 但 hub 没说"。

在指标中，没有 hub 时 `upstream_provider` 标签重复提供方本身，因此 `sum by (upstream_provider)` 仍然汇总全部成本。

- **位置：** `apps/api/src/application/use-cases/llm/record-llm-usage.use-case.ts:73`
- **测试：** `test/application/use-cases/llm/record-llm-usage.use-case.spec.ts`
- **来源：** [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)

### RN-681 — 与现有相似的故事和规则通过 embedding 产生*警告*，绝不拒绝；检查的花费是计量中的独立一行 {#rn-681}

在写入一个故事（`create_story`）或一条业务规则（`business_rule` 的 `emit_artifact`）之后，api 将其*标题*与*项目*中同类现有条目的标题比较，使用 RAG embedding 模型向量之间的余弦，当最接近的达到阈值时*发出警告*。

1. **警告，绝不拒绝。** 检查运行时条目已经存在。警告在工具结果中返回给 agent——句子点名相似条目、id 和数值——并以 `backlog.semantic_duplicate_warned` 留在日志中。*精确*重复仍会在此之前被 [RN-080](#rn-080) 和
   [RN-081](#rn-081) 拒绝，因此规范化后相同的标题不参与比较。
2. **阈值是 0.80，是*起点*，未经校准**（ADR 0198，与
   [ADR 0080](../adr/0080-busca-hibrida-pesos-limiar-e-citacao.md) 的权重一样）：在规则诞生的环境中，无法记录发现 R 那一对以及非重复对的真实向量。一旦 `vetores.json` 被记录，证明会自行运行；在那之前它被*跳过*并给出警告。
3. **没有 embedding 提供方时，检查被*跳过*并*说明***——能力缺失、daemon 不在、超时：`backlog.semantic_duplicate_check_skipped`，原因写入日志和给 agent 的句子。绝不会让发出失败。
4. **花费作为独立一行进入计量**：执行者
   `system`/`duplicata-semantica`，RAG 的提供方和模型，输出为零，模型在目录中时使用目录价格。这是对
   [ADR 0075](../adr/0075-embeddings-no-contrato-de-llm-provider.md) 划分的*唯一*例外——RAG 的索引和搜索仍在其外——，之所以成立，是因为发出发生在会话之内。
5. **上限：** 最近的 100 个现有条目（截断时结果会说明是多少中的多少）以及整个检查 10 s 的挂钟时间。

- **位置：** `apps/api/src/domain/backlog/duplicata-semantica.ts:35` (`LIMIAR_DE_DUPLICATA_SEMANTICA`),
  `:44` (`TETO_DE_COMPARACOES_DE_DUPLICATA`), `:53` (`TETO_DE_TEMPO_DA_CHECAGEM_MS`),
  `:107` (`ehDuplicataSemantica`),
  `apps/api/src/application/use-cases/backlog/verificar-duplicata-semantica.use-case.ts:111` (`VerificarDuplicataSemanticaUseCase`),
  `:241` (`medir`), `:285` (`narrar`), `:349` (`fraseParaOAgente`),
  `apps/api/src/application/use-cases/backlog/create-story.use-case.ts:193` (`semanticDuplicate`),
  `apps/api/src/interfaces/http/internal/internal-sessions.controller.ts:640` (`semanticDuplicateCheck`),
  `apps/api/src/application/use-cases/rag/rag-embedding.service.ts:106` (`uso`),
  `apps/engine/lib/engine/harness/tools/emit_artifact.ex` (`aviso_semantico`),
  `apps/engine/lib/engine/harness/tools/create_story.ex` (`aviso_semantico`)
- **测试：** `test/application/use-cases/backlog/verificar-duplicata-semantica.use-case.spec.ts`
  （高于阈值时警告；花费成为独立一行；低于阈值时不叙述；没有提供方时跳过并说明；时间上限；比较次数上限；通过事件处理规则；计量和日志失败不会拖垮），
  `test/application/use-cases/backlog/create-story.use-case.spec.ts`
  (`duplicata semântica (RN-681)`), `test/domain/backlog/duplicata-semantica.spec.ts`,
  `test/domain/backlog/limiar-de-duplicata.calibracao.spec.ts`（*数值*——在向量被记录之前跳过），
  `apps/engine/test/engine/harness/duplicata_semantica_test.exs`,
  `apps/web/src/lib/activity.test.ts` (`duplicata semântica (RN-681)`)
- **来源：** [ADR 0198](../adr/0198-duplicata-semantica-por-embedding-com-limiar-que-so-avisa.md)
  （AT-171，发现 R）

### RN-666 — 计量记录输入中有多少来自缓存、输出中有多少是推理 {#rn-666}

`token_usage` 的每一行记录提供方在 OpenAI 方言的 `usage` 中给出的两个*部分*：`cached_input_tokens`
（`prompt_tokens_details.cached_tokens`——`input_tokens` 中有多少由缓存提供，以价格的一小部分计费）和 `reasoning_tokens`
（`completion_tokens_details.reasoning_tokens`——`output_tokens` 中有多少是推理）。

1. **是部分，绝不是相加。** `input_tokens`/`output_tokens` 仍然是提供方给出的总数，已经包含这些部分；不往它们上面加任何东西，也不据此重新计算任何成本——成本的数字是
   [RN-665](#rn-665) 的那个。
2. **"没说"不是零。** `null` = 提供方未告知；0 = 告知没有。不是非负整数的值视为"没说"。
3. **测量会说明缓存占多少。** `medir-execucao.ts` 开始按 agent 显示读取的缓存和推理及其占总数的百分比，*只*针对告知了的调用（不是全部时说明有多少次），没有任何调用告知时显示"未测量"——另外还显示有多少次调用的成本是真实成本。
4. **对方言的所有提供方都读取**，因为这两个字段是 OpenAI 自己的；不发送它们的提供方保持 `null`。Anthropic 在其协议中告知缓存（`cache_read_input_tokens`），这里*不*读取——保持 `null`，已声明；Ollama 不告知。

- **位置：** `apps/api/src/infrastructure/llm/openai-compatible-provider.ts:323` (`cachedInputTokens`),
  `apps/api/src/infrastructure/llm/openai-compatible-provider.ts:650` (`contagem`),
  `apps/api/src/application/use-cases/llm/run-llm-turn.use-case.ts:175` (`cachedInputTokens`),
  `apps/api/src/application/use-cases/llm/record-llm-usage.use-case.ts:113` (`cachedInputTokens`),
  `apps/api/src/db/schema/llm.ts:374` (`cachedInputTokens`),
  `apps/api/scripts/medir-execucao.ts:89` (`formatarParteMedida`)
- **测试：** `test/infrastructure/llm/openrouter-provider.contract.spec.ts`
  （带两个部分的录制响应；没有细节；无效值和零），`test/application/use-cases/llm/run-llm-turn.use-case.spec.ts`,
  `test/scripts/medir-execucao.spec.ts` (`formatarParteMedida`)
- **来源：** [ADR 0188](../adr/0188-o-custo-real-do-provider-vira-o-numero-do-metering.md)
  （AT-272）

### RN-665 — 提供方返回的真实成本就是计量的数字；目录价格用在没有真实成本的地方 {#rn-665}

所有者的决定（9月30日）：**真实成本成为数字**。当 LLM 调用的响应说明了提供方收取多少——在 OpenRouter 中是流最后一帧中的 `usage.cost`——，这个值就是该行的 `token_usage.cost_micros`、回合返回给 engine 的值（循环将其累加到本地预算）、增加项目/会话/区域预算的值，以及支出报告汇总的值。没有它时，由目录的冻结价格产生数字，与
[ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md) 中一样。

1. **一条规则，三条路径。** `RunLlmTurnUseCase`、`StreamLlmTurnUseCase`
   和 `SendChatMessageUseCase` 都经过同一个 `custoDaChamada`；没有第二把尺子。
2. **隐含价格，带标记。** 有真实成本时，两个价格列都记录 `custo ÷ tokens`（同一个值：提供方返回*一个*成本）以及
   `price_implicit = true`——这保持了 `tokens × preço = custo`
   （[RN-044](#rn-044)），而不假装是价目表价格。没有真实成本时，
   `price_implicit = false`，各列是目录的值。
3. **目录价格放在旁边。** `catalog_cost_micros` 记录按目录价格本应收取的金额，只在数字为真实成本的行中（其他行为 `null`）——这是逐行的估算与账单之间的差距。
4. **`estimated` 仍然只说 *TOKEN***（[RN-041](#rn-041)）。带真实成本的行 `estimated = false`，因为成本只会随提供方的 `usage` 一起到达；把*成本*标记为真实的是 `price_implicit`。
5. **响应关于自身说了什么，就记录什么。** `resolved_model_name`（帧中的 `model`——解析后的别名）和 `generation_id`（`id`，在 OpenRouter 中是 `gen-…`），对方言的所有提供方都适用。`model_name` 仍然是目录的那个，即报告的维度。
6. **只有经过证明的才读取成本。** `extrairCustoReal` 钩子只存在于 OpenRouter；没有它的提供方会忽略存在的 `usage.cost`。不是有限非负数的成本视为"没说"（真正的零是真实成本），而在 `is_byok: true` 时*不*读取成本：那是 hub 的费用，推理在别处计费——该行回落到目录价格。

- **位置：** `apps/api/src/domain/llm/custo-da-chamada.ts:43` (`custoDaChamada`),
  `apps/api/src/application/use-cases/llm/run-llm-turn.use-case.ts:225` (`custoDaChamada`),
  `apps/api/src/application/use-cases/llm/stream-llm-turn.use-case.ts:238` (`custoDaChamada`),
  `apps/api/src/application/use-cases/llm/send-chat-message.use-case.ts:227` (`custoDaChamada`),
  `apps/api/src/infrastructure/llm/openai-compatible-provider.ts:319` (`extrairCustoReal`),
  `apps/api/src/infrastructure/llm/openrouter-provider.ts:243` (`extrairCustoRealOpenRouter`),
  `apps/api/src/db/schema/llm.ts:357` (`priceImplicit`)
- **测试：** `test/domain/llm/custo-da-chamada.spec.ts`,
  `test/infrastructure/llm/openrouter-provider.contract.spec.ts`（录制响应：成本、解析后的模型、id；BYOK；没有 `cost`；没有钩子的提供方），`test/application/use-cases/llm/run-llm-turn.use-case.spec.ts`,
  `test/application/use-cases/llm/stream-llm-turn.use-case.spec.ts`,
  `test/application/use-cases/llm/send-chat-message.use-case.spec.ts`；有凭据时，手动 smoke `openrouter-provider.smoke.spec.ts`
- **来源：** [ADR 0188](../adr/0188-o-custo-real-do-provider-vira-o-numero-do-metering.md)
  （AT-270）

### RN-679 — 策展拒绝 OpenRouter 的自由路由别名 {#rn-679}

所有者的决定（10月1日）：**`~` 别名不进入策展**——只接受上游固定的模型。OpenRouter 的自由路由别名（以 `~` 开头的 id，如 `~deepseek/deepseek-flash-latest`）"总是重定向到该家族最新的那个"：目录发布的是*橱窗*价格（在 9月29日的真实使用中，是该家族最便宜端点的价格），端点列表为空，收费的是实际服务的上游。没有一个上游能让
[ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md) 的冻结价格有任何意义。替代方案——按上游定价——被否决。

1. **尺子属于提供方。** `ehAliasDeRoteamentoLivre` 是 `provider =
   'openrouter'` *且*名称以 `~` 开头；其他提供方中相同的前缀不是别名，不会拒绝。
2. **激活会拒绝，带代码。** `POST .../models/activate` 带
   `isActive: true` 且批次中有任何别名时，返回 **422**，带
   `code: "alias_de_roteamento_livre"`、被拒绝的 `modelIds` 以及点名它们的句子。*整个*批次被拒绝，与不存在 id 的 404 一样
   （[RN-043](#rn-043)）：同一批次中上游固定的模型也不会被打开。目录界面在一个有专门标题的 toast 中显示 api 的句子，并按 `code` 匹配，绝不按文本。
3. **同步*不*过滤别名。** 它继续留在目录中——从那里消失会让同步把已策展的东西标记为 `unavailable`，级联会悄无声息地跳过它的 binding。策展的读取会*标记*它：
   `freeRoutingAlias`，在读取时由提供方和名称推导，从不写入。该行在有人尝试激活之前，以*文字*显示徽章和原因。
4. **已策展的继续工作。** 这是可测量的（OpenRouter 行中带 `~` 的名称），选择的出路是最不令人意外的：规则之前已激活的别名**保持激活**——它的 binding 继续解析，选择器继续显示——，在目录中带标记出现，并且可以被*关闭*。关闭后不会回来。什么都不删除，也不重写任何 binding。对仍处于激活状态的别名新建 binding 在这里不会被拒绝：规则属于策展，binding 遵循 [RN-043](#rn-043)。

- **位置：** `apps/api/src/domain/llm/alias-de-roteamento-livre.ts:23` (`ehAliasDeRoteamentoLivre`),
  `:41` (`AliasDeRoteamentoLivreError`),
  `apps/api/src/application/use-cases/llm/set-models-active.use-case.ts:59` (`AliasDeRoteamentoLivreError`),
  `apps/api/src/infrastructure/persistence/drizzle/workspace-model.repository.ts:67` (`freeRoutingAlias`),
  `apps/api/src/interfaces/http/shared/llm-binding-error.filter.ts:60` (`code`),
  `apps/web/src/components/ModelCatalogSection.tsx:693` (`recusaDeAliasLivre`)
- **测试：** `test/application/use-cases/llm/set-models-active.use-case.spec.ts`
  （整个批次被拒绝，带代码和 id；上游固定的激活；OpenRouter 之外的 `~` 激活；规则之前已策展的别名保持激活、带标记、可关闭且不会回来），`test/interfaces/http/shared/llm-binding-error.filter.spec.ts`,
  `apps/web/src/components/ModelCatalogSection.test.tsx`（徽章和原因；拒绝的 toast；其他错误的通用 toast）
- **来源：** AT-271（9月29日真实使用分析的 A25 项）；补充
  [RN-665](#rn-665)

### RN-583 — hub 的路由标准属于 binding，随之传输，并在计量中冻结 {#rn-583}

模型 binding 可以保存一个**路由标准**——
`routing_preference`：`price`、`throughput` 或 `latency`——告诉 *HUB* 如何选择服务该模型的上游。可为空：`null` 是一贯的行为，不向线路发送任何东西，由 hub 自行决定。

1. **随胜出的 binding 传输，从不独自级联。** 级联仍然是 binding 的级联：胜出的层级带来模型*和*它的标准。级联*跳过*的层级（模型不可用、没有 tool calling）会把标准一起带走——只让标准存活会产生没有人选择过的组合。
2. **写入有三种形式。** 在五个范围的 `PUT .../model-binding` 中，`routingPreference` **缺失**时，如果新模型的提供方声明了该能力则保留已记录的，否则变为 `null`；**`null`** 清除；为没有该能力的提供方提供**值**则返回 **422**
   （`RoutingPreferenceNotSupportedError`）。不变式：没有 binding 会为不声明该能力的提供方保存标准。
3. **冻结*发送到线路上*的东西。** `token_usage.routing_preference` 按调用记录，与 [RN-042](#rn-042) 的 `upstream_provider` 并列：发送的标准，当 binding 没有标准或提供方不声明该能力时为 `null`（没有发送的东西不是任何东西的来源）。与冻结价格（ADR 0042）同一把尺子。
4. ***提供方*的能力，只凭证明。**
   `LLMProviderCapabilities.routingPreference` 在九个提供方中都是必需的，自 2026-09-29（AT-158）起*只*在 OpenRouter 中为 `true`：使用真实凭据的 smoke（`openrouter-provider.roteamento.smoke.spec.ts`）显示标准*改变*了实际服务的上游——在 `meta-llama/llama-3.3-70b-instruct` 上，
   `price` 落在 DeepInfra，`throughput` 落在 Groq（`latency` 在一次测量中是 Groq，另一次是 CoreWeave），而没有标准时 hub 在 Novita/DeepInfra 之间交替。证明是*差异*，而不是被接受：旧默认模型（`~deepseek/deepseek-v4-flash-latest`）对三种标准和无标准都返回*同一个*上游，这无法区分"hub 遵守了"和"根本没有选择"。其他八个仍为 `false`，对它们而言这个功能仍然*休眠*：路由以 422 拒绝，界面以文字说明提供方没有经过证明的选项，线路上什么都不变。证明*不*断言的是：每种标准会选择哪个上游——那是 hub 的决定，并随时间变化。

- **位置：** `apps/api/src/domain/llm/routing-preference.ts:56`（写入），
  `apps/api/src/domain/llm/routing-preference.ts:75`（发送到线路上的东西），
  `apps/api/src/domain/llm/binding-resolver.ts:100`（随 binding 传输），
  `apps/api/src/application/use-cases/llm/record-llm-usage.use-case.ts:118`
  （在计量中冻结），
  `apps/api/src/infrastructure/llm/openrouter-provider.ts:327` (`openrouterConfig`，经过证明的能力)
- **测试：** `test/domain/llm/routing-preference.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`,
  `test/application/use-cases/llm/run-llm-turn.use-case.spec.ts`,
  `test/infrastructure/llm/openrouter-provider.contract.spec.ts`；能力的手动证明是 `test/infrastructure/llm/openrouter-provider.roteamento.smoke.spec.ts`
- **来源：** [ADR 0166](../adr/0166-preferencia-de-roteamento-no-binding-de-modelo.md)（AT-090）

### RN-043 — 新发现的模型以停用状态进入；消失的模型被标记，从不删除 {#rn-043}

目录同步有三种结果，没有一种是破坏性的：

1. **新模型**进入时**在任何 workspace 中都没有策展行**，而没有行*就是*停用状态。一个提供方的目录有数百行——把它们全部作为激活状态倒进来会让选择变得不可能，并在没有任何人决定的情况下打开一个昂贵的模型。激活是 owner 的策展，只在他的 workspace 中有效（[RN-052](#rn-052)）。
2. **从远程目录中消失的模型**获得
   `availability = 'unavailable'`，并**留在表中**：
   `model_bindings` 和 `token_usage` 指向这一行，删除它会把成本历史一起带走。
3. **回来的模型**恢复为 `available`，策展**保持不变**——owner 的选择能挺过提供方的暂时缺席。

两个维度刻意相互独立：策展是一个人的决定，`availability` 是对提供方的观察。谁都不写入对方——而自 [ADR 0049](../adr/0049-curadoria-de-modelo-por-workspace.md) 起，它们甚至不在同一张表中，因此同步即使想覆盖，也没有策展字段可以覆盖。

对系统其余部分有三个后果：

- 对停用或不可用模型的**新** binding 在领域中被拒绝（`ModelNotBindableError`，422）。已有的 binding 保留；
- `resolveBinding` 的**级联**跳过不可用的候选，把跳过的记录在 `skipped` 中，并且——当回合带有工具时——在*所有*层级重新校验
  `supports_tool_calling`。没有这一点，回退会让 agent 落在只能聊天的模型上，悄无声息地违反 [RN-040](#rn-040)；
- **失败的提供方不会让任何东西变得不可用**：401 是"我不知道那里有什么"，而不是"那里什么都没有"。该提供方被跳过，报告中带有失败的*来源*（`infra` | `modelo`）——绝不是排除法诊断。

- **位置：** `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts:160`,
  `apps/api/src/domain/llm/binding-resolver.ts:63`,
  `apps/api/src/domain/llm/model-capabilities.ts:49`
- **测试：** `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`,
  `test/domain/llm/binding-resolver.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`
- **来源：** [ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)

### RN-044 — 价格从此刻起生效，旧成本仍然可以核对 {#rn-044}

`token_usage` 的每一行都记录产生其 `cost_micros` 的价格。改变模型价格**不会对过去的消耗重新定价**——更进一步：旧成本仍然**可复现**，因为即使在 `models` 表经过三次修正之后，`tokens × 记录的价格` 仍与记录的成本一致。

每次价格变更都在 `model_price_changes` 中写入一行，只追加，带前后对照以及来源（`manual` | `sync`）。这一对值刻意一起记录：从上一行重建"之前"，取决于没有任何写入逃出审计路径，而这恰恰是审计要证明的东西。与当前相同的价格是无操作——一行"从 10 变为 10"会把日志变成噪音。

规则适用于**所有**改变价格的路径，而不只是界面的那条。过去有两种写入会逃过它：目录同步（它通过 `upsert` 改变价格，从未产生领域自 Fase 9c 起就声明的 `sync` 来源）和 `seed.ts`（它在已经 seed 过的数据库上运行——k8s 的 `bootstrap.sh` 中的 `BRABO_FORCE_SEED=1`——因此会悄无声息地修正价格）。两者现在都会审计，seed 复用 `UpdateModelPricingUseCase` 本身。

- **位置：** `apps/api/src/application/use-cases/llm/update-model-pricing.use-case.ts:44`,
  `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts:213`,
  `apps/api/src/db/seed.ts:376`
- **测试：** `test/application/use-cases/llm/update-model-pricing.use-case.spec.ts`,
  `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`
- **来源：** [ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)

### RN-189 — embedding 为每个输入返回一个向量，或者一个错误 {#rn-189}

`embed` 是*批量*操作：接收 N 段文本，返回 N 个向量，**顺序相同**。顺序是输入与向量之间唯一的联系，这就是更短的响应不可接受的原因——第 i 个向量最终会属于另一个句子，索引会悄无声息地出错，症状出现在*搜索*中，几周之后，远离原因。

因此，契约拒绝而不是降级三种情况：不完整的批次、空向量、同一响应中维度不同。空的输入列表也会在离开网络之前被拒绝——对它返回 `[]` 会让调用者写入一个空索引，以为自己索引了什么。

结果带有四个字段，每一个都回答一个在产品其他地方已经代价高昂的问题：`dimensions` 对照*返回*的内容核对（绝不从目录复制）；`model` 是提供方**声称**使用的，因为别名会解析为带日期的版本，进入计量的正是这个名称，理由与冻结价格相同（[RN-044](#rn-044)）；`inputTokens` 带有 `estimated`，保留 [RN-041](#rn-041) 中"提供方说是零"与"提供方什么也没说"的区别。

错误被**抛出**，按 `code` 规范化，而不是像 `chat` 中那样变成一个 chunk。chunk 的理由是保留进行中回合的花费；这里没有什么可保留——要么提供方返回了向量并收费，要么没有返回也没有收费。这与 `listModels` 的选择相同，分类法也相同：没有新的 `LLMErrorCode`。

- **位置：** `apps/api/src/application/ports/llm-provider.port.ts:61`,
  `apps/api/src/infrastructure/llm/embedding-result.ts:26`
- **测试：** `test/contract/llm-provider.contract.ts`（五个用例，针对每个声明该能力的提供方运行）
- **来源：** [ADR 0075](../adr/0075-embeddings-no-contrato-de-llm-provider.md)

### RN-190 — embedding 的能力有两层，模型那一层是互斥 {#rn-190}

与 tool calling（[RN-040](#rn-040)）一样，能力有两层：*提供方*（`capabilities.embeddings`，上限）和*模型*（目录行中的 `supportsEmbeddings`）。两种情形的区别正是这条规则要断言的：

- **tool calling 是一个梯度**——不请求工具的模型仍然可以对话，因此只有 agent 的 binding 被拒绝；
- **embedding 是互斥**——`nomic-embed-text` 不回答问题，`llama3.2` 不返回向量。它们是不相交的集合，Ollama daemon 用对使用聊天模型的 embedding 请求响应 **`501`**（"This server does not support
  embeddings"）证明了这一点。

`assertCanEmbed` 按最利于失败的顺序检查两者：先检查提供方，因为换模型修不好一个不做 embedding 的提供方。**没有声明**的模型也会被拒绝，消息不同——缺失意味着"提供方没说"
（[ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)），绝不是许可，读者应该做的是同步目录而不是换模型。禁止根据模型*名称*推断能力：那是穿着数据外衣的猜测。

- **位置：** `apps/api/src/domain/llm/embedding-capability.ts:64`,
  `apps/api/src/infrastructure/llm/ollama-provider.ts:319`
- **测试：** `test/domain/llm/embedding-capability.spec.ts`,
  `test/infrastructure/llm/ollama-provider.spec.ts`
- **来源：** [ADR 0075](../adr/0075-embeddings-no-contrato-de-llm-provider.md)

### RN-191 — `embeddings: true` 需要实际运行，而不是文档 {#rn-191}

本项目的规则（[ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)/[ADR 0043](../adr/0043-seis-providers-de-llm-e-o-fechamento-da-fase-9b.md)）应用于新能力：**只有 `ollama` 声明 `true`**，证明是针对真实 daemon 0.32.1 使用 `nomic-embed-text` 运行的 `POST /api/embed`——两个输入，两个 768 维向量，`prompt_eval_count: 10`。

其他八个声明 `false`，出于两个不同的原因：

- **缺乏证明**（七个）：环境中没有它们的密钥，唯一运行过的付费 smoke 测试（[验收](../explanation/aceite-providers.md)）是*聊天*——在 hub 中，embedding 路由到与聊天不同的提供方，一个端点的证明不是另一个的证明；
- **操作缺失**（Anthropic）：没有专门的 embedding 端点，其文档指向一个第三方，那是另一个提供方，另一个密钥，另一种方言。

OpenAI 兼容基类的*方言*单独证明，契约套件在打开能力的情况下对它再运行一次。正是这一点让某个提供方在它的密钥出现的那天变为 `true` 变得廉价：改字面量中的一行，解析已经被演练过。声明 `false` 却仍然暴露该方法的提供方会在接触网络之前**拒绝调用**。

- **位置：** `apps/api/src/infrastructure/llm/ollama-provider.ts:73`,
  `apps/api/src/infrastructure/llm/openai-compatible-provider.ts:325`
- **测试：** `test/contract/llm-provider.contract.ts`,
  `test/infrastructure/llm/openai-compatible-provider.contract.spec.ts`,
  `test/infrastructure/llm/ollama-provider.embeddings.smoke.spec.ts`
  （手动，针对真实 daemon）
- **来源：** [ADR 0075](../adr/0075-embeddings-no-contrato-de-llm-provider.md)

### RN-045 — 被采纳的仓库只能由已批准的计划修改 {#rn-045}

采纳现有仓库**只诊断不行动**。采纳校验访问（`getRepo`），写入项目的行，并产生一个**计划**：bootstrap 将要做的事情的序列化列表，通过调用每个步骤的 `check()` 获得——与自 [RN-029](../business-rules.md#rn-029) 起提供幂等性的是同一个——而从不执行相应的变更。

只要 `repo_bootstraps.plan_decision` 为**空**，就不运行任何变更。闸门位于执行器**之前**，而不是其内部：bootstrap 的 runner 与 Fase 2 的相同，没有过滤器，只是根本不被调用。加上原本就会跳过受保护分支的防护，不存在任何代码路径会在已批准计划之外触碰分支。

两种结果：

- **批准**是全有或全无（批准零散的步骤会破坏
  `dev←main, qa←dev` 的级联）。执行的是在执行时**重新推导**的计划：等于或小于所展示的，**绝不更大**——在此期间变为受保护的分支会被跳过；
- **按现状采纳**免去 bootstrap，记录决定，并且**不**为了假装收敛而移动游标。计划被保存，作为刻意未应用之内容的证据。

对重新生成的计划作出决定会被拒绝（409）：决定携带用户看到的 `planGeneratedAt`，对另一件事说的"是"不算数。

正常的部署流程拒绝（409）在被采纳的仓库中运行——没有这道防护，恢复路径会在没有任何计划的情况下对第三方仓库运行 bootstrap。

**已知限制：**这里的"保护不一致"是有 × 无，因为契约只暴露这么多（`GitBranch.protected` 是布尔值，而
[ADR 0028](../adr/0028-protecao-de-branch-divergencia-entre-providers.md) 推迟了规范化的 `ProtectionPolicy`）。*部分*保护的分支被算作"未保护"，可能被覆盖——但只在已批准的计划之内。

- **位置：** `apps/api/src/application/use-cases/git/decide-bootstrap-plan.use-case.ts`,
  `apps/api/src/application/use-cases/git/bootstrap-plan.ts`,
  `apps/api/src/application/use-cases/git/bootstrap-steps.ts:112`
- **测试：** `test/application/use-cases/git/decide-bootstrap-plan.use-case.spec.ts`,
  `test/application/use-cases/git/bootstrap-plan.spec.ts`
- **来源：** [ADR 0044](../adr/0044-adocao-de-repositorio-existente.md)

### RN-046 — 每个项目仓库都声明其来源 {#rn-046}

`project_repositories.origin` 和 `repo_bootstraps.origin` 说明 Brabo 是**创建**了仓库（`created`）还是**采纳**了一个已存在的（`adopted`）。来源由写入该行的一方显式写入——而不是列的默认值——之后不再改变。

这不是装饰：正是它让产品把 Fase 10 不得不手工完成的事（在 `project_repositories` 和
`repo_bootstraps` 中插入行，让项目指向一个 fork）作为正当情形来处理。`adopted` 仓库有自己的分支策略，不经过部署流程，只按 [RN-045](#rn-045) 被修改。

迁移 `0031` 的回填把所有已存在的都标记为 `created`，并且可以在这一点上盲目：在它之前不存在采纳，因此没有被采纳的行会被错误分类。

- **位置：** `apps/api/src/db/schema/git.ts`, `apps/api/src/db/migrations/0031_special_winter_soldier.sql`,
  `apps/api/src/domain/git/repo-bootstrap.entity.ts`
- **测试：** `test/application/use-cases/git/adopt-repository.use-case.spec.ts`
- **来源：** [ADR 0044](../adr/0044-adocao-de-repositorio-existente.md)

### RN-047 — dev agent 的熔断器：连续 N 次阻塞让它停下，而不在循环中烧掉预算 {#rn-047}

每个 dev agent 维护一个计数器（`dev_agent_states.consecutive_blocked`），记录有多少个任务连续以 `blocked` *结束*——在本地（ToolLoop 中）或远程（gate 的修正次数上限用尽）。达到按项目设置的上限（`max_consecutive_blocked`，默认 3）时，agent 停在 `idle_tripped`，**不再尝试领取下一个任务**。一个获得批准的终止结果会把计数器归零；单独一个被阻塞的任务走正常流程（带诊断退回，可供人解除阻塞）——熔断器处理的是*序列*，而不是任务。

离开 `idle_tripped` 的唯一途径是显式重新武装（`POST .../agents/:agentId/rearm`，角色 `developer`）：它把计数器归零，agent 重新尝试领取任务。没有自动解锁——与 `MarkTaskBlockedUseCase`/`unblock` 的原则相同，只是应用于序列而不是任务。重新武装一个**没有**被熔断的 agent 是 **409**，而不是静默成功：`dev.rearmed` 事件是不可变的，为没有发生的重新武装记录它，就是在事件日志中撒谎。

来自 agent *外部*的阻塞（例如 `QaLeadServer` 内部失败）也需要唤醒它——这就是 `task.gate_resolved` 的发出位于 `MarkTaskBlockedUseCase`（所有阻塞都要经过的漏斗）而不是只能看到其中一部分的 `RecordGateVerdictUseCase` 中的原因。没有这一点，agent 会永远停在 `awaiting_gate`，任务已死，熔断器的计数器永不增加。

在 agent 处于 `working` 时重启 engine **不**计入计数器：被扣留的任务会带着重启诊断被阻塞，但这种阻塞不是 agent "烧穿上限"——而是基础设施倒下了。只有当 dev↔gate 循环本身产生真正的 `blocked` 时，计数器才会上升。

- **位置：** `apps/engine/lib/engine/dev/dev_agent_server.ex`（`finish_task/2`、
  `resume_state/2`），`apps/api/src/application/use-cases/execution/rearm-dev-agent.use-case.ts`,
  `apps/api/src/db/schema/iam.ts`（`projects.max_consecutive_blocked`）
- **测试：** `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  （describe `circuit breaker`），`apps/engine/test/engine/dev/dev_rehydrator_test.exs`
  （describe `the four rehydrated states`），`test/application/use-cases/execution/rearm-dev-agent.use-case.spec.ts`
- **来源：** [ADR 0045](../adr/0045-reagendamento-por-evento-do-dev-agent.md)

### RN-053 — 重新激活执行会唤醒停下的 agent，在已存在的会话之内 {#rn-053}

激活一个**已经在执行**的项目的执行，是重新激活，而不是从零开始：它落入当前的执行会话，并唤醒停下的 agent。分两部分，系统两侧各一部分。

**会话被复用。** 激活使用项目中已经带有 `execution.activated` 的 `active` 会话；只有在没有时才创建一个。没有列说明"这是执行会话"——区分它的是它保存的事件，查询的正是这个。关闭会话仍然是重新开始的方式：已关闭的会话不是候选，下一次激活会打开新的。

以前，`create` 是无条件的，而当 agent 已经存活时 engine 会**丢弃**新的 `session_id`。每次点击"激活"都会留下一个活跃会话，它收到 `execution.activated` 之后什么也没有——agent 的事件继续流向上一次激活的会话。

**agent 通过 wake 唤醒，而不是 `work`。** 从零开始会触发循环（`:work`——发出 `dev.started` 并领取任务）。已经存活的 agent 收到 `{:wake, :became_claimable}`，由服务器的状态防护决定：

| agent 状态 | 重新激活做什么 |
|---|---|
| `idle` | 领取下一个任务 |
| `working`, `awaiting_gate`, `awaiting_approval` | 什么都不做——进行中的任务不会被放弃 |
| `idle_tripped` | 什么都不做——只有显式的重新武装能解锁它（[RN-047](#rn-047)） |

向所有 agent 触发 `:work` 会比缺陷更糟：它无条件领取任务，对处于 `awaiting_gate` 的 agent 而言，意味着丢下 gate 正在扫描的 worktree——而且一次点击就绕过了熔断器。

- **位置：** `apps/api/src/application/use-cases/execution/activate-execution.use-case.ts`,
  `apps/api/src/infrastructure/persistence/drizzle/session.repository.ts`
  (`findActiveExecutionSession`),
  `apps/engine/lib/engine_web/controllers/execution_command_controller.ex`
  (`acordar/4`)
- **测试：** `test/application/use-cases/execution/activate-execution.use-case.spec.ts`
  （describe `reactivation doesn't open an orphan session`），
  `test/infrastructure/persistence/session-execution.repository.spec.ts`,
  `apps/engine/test/engine_web/controllers/execution_command_controller_test.exs`
  （describe `reactivation`）
- **来源：**
  [第一次 dogfooding](../explanation/primeiro-dogfooding.md) 的发现 #11

### RN-048 — story 的晋升默认由用户进行；模式改变谁来触发，从不改变校验什么 {#rn-048}

`projects.story_promotion` 选择*谁*把 story 从 `draft` 晋升为
`ready`：

- **`manual`**：PO 把 story 完成后，它保持 `draft`，并带有
  `stories.proposed_ready = true`。**它的任何任务都不可领取**——
  `claimNext` 要求 `story.status = 'ready'`——由用户在 Backlog 中单独或批量地晋升它。
- **`auto`**（自 [RN-659](../business-rules.md#rn-659) 起是新项目的默认）：PO 在完成一个完整的 story 时自行晋升它。这是 Fase 12c 之前的行为；`manual` 从 12c 起一直是默认值，直到 RN-659（迁移 `0065`）只改变了列的默认值——中途创建的项目仍为 `manual`。

**模式改变触发器，而不是标准。** 两条路径都经过
`assertPromotable`——就绪性（RF/DoD/DoR/规则）以及对照现行 `module_map` 解析的模块——这正是 `story-promotion.spec.ts` 中的对称性测试所锁定的：对于每个 story，`isPromotable` 都与 `assertPromotable` 抛出的结果一致。在这个阶段之前，校验是重复且不对称的（创建调用 `canBecomeReady`，转换调用 `assertReady` + `assertModulesResolved`）：通往同一状态的两扇门，锁不一样。让触发器可配置，首先需要把它们统一起来，否则"通过 UI 晋升"和"在创建时晋升"会是同名的不同规则。

**不完整**的 story 永远不会被提议。只有当 story 已经能通过校验时，`proposed_ready` 才会打开——提议领域会拒绝的东西，就是把 PO 的工作伪装成决定推给用户。

**拒绝**会把 story 退还给 PO：写入 `returned_reason`/`returned_at`，关闭 `proposed_ready`，发出 `backlog.story_promotion_returned`，并把原因作为*置顶*消息注入 PO 的会话，措辞与退还给 dev 的 gate 的优先级措辞相同（ADR 0020 的教训）。拒绝在与 engine 通信**之前**被记录，engine 失败也不会撤销它——这与 [RN-047](#rn-047) 中重新武装的顺序相反，理由是：那里事件断言的是*关于* engine 的事情，这里断言的是关于用户的事情，无论是否有值班的 PO 在听，它都是真的。

批量晋升**不是全有或全无**：每个 story 是它自己的事务，在提议和决定之间失去就绪性的 story 会带着原因以 `failed` 返回，而不会拖垮用户刚刚审阅过的其他 story。

`backlog.story_transitioned` 事件记录**真实的执行者**——手动晋升时是 `user`，自动晋升时是 `agent/po`。事件日志是不可变的，也是审计所读取的：在用户的决定中记录 PO，恰恰会抹去规则要交还的那个人工环节。

迁移 `0033` 做的是*有针对性*的回填，而不是盲目的：列以 `manual` 诞生，所有已存在的项目都被移到 `auto`。新的默认值适用于之后来的项目；进行中的项目不能因为一次部署而停止产出。

- **位置：** `apps/api/src/domain/backlog/story-promotion.ts`,
  `apps/api/src/db/migrations/0033_absurd_domino.sql`,
  `apps/api/src/application/use-cases/backlog/promote-stories.use-case.ts`,
  `apps/api/src/application/use-cases/backlog/return-story.use-case.ts`,
  `apps/engine/lib/engine/agents/po_server.ex` (`revision_message/1`)
- **测试：** `test/domain/backlog/story-promotion.spec.ts`（对称性），
  `test/db/story-promotion-migration.spec.ts`（有针对性的回填），
  `test/application/use-cases/backlog/promote-stories.use-case.spec.ts`,
  `test/application/use-cases/backlog/return-story.use-case.spec.ts`,
  `apps/engine/test/engine/agents/po_server_test.exs`（describe `revise/2`）
- **来源：** [ADR 0046](../adr/0046-promocao-de-story-com-autoridade-do-usuario.md)
### RN-049 — 对提议动作的每一个决定都留在事件日志中，并带有决定者 {#rn-049}

`proposed_action.created`、`.approved` 和 `.denied` 是 `session_events` 中的领域事件，此外还有把它们带到 engine 的 outbox 行。outbox **不是**记忆：它被排空，标记 `processed_at`，然后被修剪。

`actor` 是真正作出决定的人——`.approved`/`.denied` 中是**用户**，`.created` 中是提议的 **agent**。而 `created.payload.status` 说明动作是如何诞生的（`pending`、`auto_approved`、`denied`）。

这带来了产生指标的区分：**人工决定 = `proposed_action.approved` 事件**；策略自行决定只出现在带 `status: auto_approved` 和 agent 执行者的 `.created` 中，永远不会与一次点击混淆。这个计数——"批准点击"——正是 Fase 10 想测量却没能测量的，因为决定不存在于可查询的地方（发现 #17）。`approve_always` 算作批准，因为它委托给同一个用例，并在其上发出 `permission.granted`。

出于决定而被排除在外的：仓库 bootstrap 直接向 outbox 发出的 `proposed_action.created`。这些变更已经由同一会话中的 `bootstrap.step_*` 叙述，重复它们会在批准指标中把同一事实计算两次。

- **位置：** `apps/api/src/application/use-cases/actions/propose-action.use-case.ts`,
  `.../approve-action.use-case.ts`, `.../deny-action.use-case.ts`
- **测试：** `test/application/use-cases/actions/approve-deny-action.use-case.spec.ts`
  （describe `the decision in the event log`）
- **来源：** [ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md)

### RN-050 — 没有打开的 PR，就不打开任何 gate {#rn-050}

dev agent 提议 commit、push 和 PR，并**读取每一项的结果**。只有三项都执行了，它才打开 gate。如果有一项停在 `pending`——agent 的自主权处于 `require_approval`——它进入 `awaiting_approval`，**持有 worktree**，不打开任何 gate。

没有这一点，gate 无论如何都会打开，而损害是无声的：QA 扫描的是**worktree**，而不是 PR；找到文件，批准；SecOps 批准；任务以完成告终——**一行都没有提交，也没有任何 PR**。直到之后批准 commit 时，用户才会看到动作失败（诊断为空，因为在已删除的目录中 `System.cmd` 返回 `{"", 2}`）。

释放 agent 的是 `task.pr_settled`，当 `pr_open` 达到终止结果时由 api 发出：`opened: true` 打开 gate；`opened: false`（被拒绝或失败）带诊断退回任务，而不是让 agent 永远等待一个没有人会打开的 gate。

被拒绝的 PR **不计入** [RN-047](#rn-047) 的熔断器：决定是用户作出的，而不是 agent 烧穿上限——与重启恢复的原则相同。

这条规则也顺带消除了 D5（待批准时 worktree 被回收）：worktree 只在 `gate_resolved` 时释放，gate 只在 PR 之后打开，PR 只在 commit 和 push 之后打开。

- **位置：** `apps/engine/lib/engine/dev/agent_io.ex`（`propose/3`），
  `apps/engine/lib/engine/dev/dev_agent_server.ex`（`abrir_gate/1`、
  `aguardar_aprovacao/2`），
  `apps/api/src/application/use-cases/actions/execute-git-action.use-case.ts`
  (`settlePrOpen`)
- **测试：** `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  （describe `pending approval doesn't open a gate`）
- **来源：** [ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md)

### RN-051 — 手工输入的价格胜过提供方的目录 {#rn-051}

`manual_pricing = true` 的 `models` 行有一个数字，是有人在阅读提供方文档之后输入的。目录同步**不会碰它**——即使远程目录带有自己的价格也一样。schema 一直是这么说的（"同步价格的一方*不能*在没有显式决定的情况下覆盖此处标记的行"），而代码没有这样做：只要远程带有价格，它总是胜出，下一次同步会撤销那个修正了错误数字的人所做的更正。

这条规则之所以存在，是因为对若干提供方来说，输入的数字是**唯一存在的数字**：NVIDIA NIM 和 Bitdeer 在任何文档中都不公布按 token 的价格
（[提供方参考](../reference/llm-providers.md)），seed 的值是市场近似值。让远程目录覆盖它，会在无人决定的情况下用一个近似值换掉另一个已知的近似值。

新模型诞生时，标志来自目录，而不是固定的默认值：**有**价格被发现时，`manual_pricing = false`（来源是同步，由它保持该行最新）；**没有**价格被发现时，`true`——这一行在等人输入一个价格，标记它就已经保护了这个数字，免受第一个决定提供价格的目录覆盖。

- **位置：** `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts`
  （`resolverPreco`），`apps/api/src/db/schema/llm.ts:137`
- **测试：** `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`
  (`manually typed price beats a catalog that REPORTS a price`)
- **来源：** [ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)

### RN-052 — 模型策展只在作出决定的 workspace 中有效 {#rn-052}

在选择器中打开或关闭一个模型，是*那个 workspace* 的决定，不会波及邻居。目录本身仍然是全局的——名称、价格、窗口和能力是提供方的事实，对所有人都一样，按 workspace 复制它们会对同一个模型产生 N 个真相，还会把 `token_usage.model_id` 劈成两半。

在此之前，`models.is_active` 是整个安装的一列：点击"激活"的人替所有 workspace 作了决定，界面对此没有任何提示。实际效果是一个 workspace 在另一个 workspace 的选择器中打开了昂贵的模型——花费出现在什么都没决定的人的预算中。

三条派生规则：

1. **没有行就是停用状态。** 没有单独的"从未决定"状态；同步发现的模型没有行，不出现在选择器中（[RN-043](#rn-043)）。
2. **停用是 `UPDATE`，不是 `DELETE`。** 删除这一行也会删除是谁、在何时作出的决定。读取把两种情况都视为未激活；记录是为审计者而存在的。
3. **`agent` 和 `session` 范围不检查策展。** 两者都没有 workspace 锚点——agent 的 binding 是按全局 slug 的。检查收到 `null`，只核对可用性，让缺口显式存在，而不是猜一个 workspace。

- **位置：** `apps/api/src/db/schema/llm.ts`（`workspace_models`），
  `apps/api/src/application/use-cases/llm/set-models-active.use-case.ts`,
  `apps/api/src/application/use-cases/llm/set-model-binding.use-case.ts`
  (`workspaceDoEscopo`)
- **测试：** `test/application/use-cases/llm/set-models-active.use-case.spec.ts`
  (`activating in one workspace does NOT turn on the model in its neighbor`)
- **来源：** [ADR 0049](../adr/0049-curadoria-de-modelo-por-workspace.md)

### RN-061 — *工具*失败也是事件，并回到模型 {#rn-061}

工具调用的结果从不被丢弃。它在事件日志中成为 `tool.result`（`ok`，失败时还有 `erro`），agent 在消息流中**说出**发生了什么，原因以 `tool` 角色**回到模型**——让它在下一回合修正并重新发出。工具错误是循环的输入，而不是终点。

Criativo agent 是唯一丢弃它的
（`_ = EmitArtifact.run(args, state)`）——PO 和 Arquiteto 已经在回馈它。在一次真实执行中，模型针对要求 `title`/`description`/`origin` 的 schema 发出了 `titulo`/`descricao`：**对话中的四条业务规则全部被拒绝**，没有记录任何事件，而它继续说"我已登记规则"，面板却是空的。

工具描述现在*点名*每种类型的必填字段，用英文并附一个填好的示例——包括 `business_rule.origin` 是产生该规则的消息的 `seq` 的**非空列表**，而不是自由文本。没有这一点，模型就会猜，而且是用对话的语言猜。

这是把 [RN-059](#rn-059) 的同一规则应用到另一条失败路径上：同一个问题有两种策略，就是两次吞掉错误的机会。

- **位置：** `apps/engine/lib/engine/agents/criativo_server.ex`（`dispatch_tool`、
  `realimentar`），`apps/engine/lib/engine/harness/tools/emit_artifact.ex`
  （`descricao/0`），`apps/engine/lib/engine/harness/artifact_schemas.ex`
  (`required/1`)
- **测试：** `apps/engine/test/engine/agents/criativo_server_test.exs`
  (`a refused tool becomes a tool.result with an error, and the agent speaks`)
- **来源：** FASE 13b 的真实执行

### RN-065 — 每个*会话*一个 module_map；修订是另一个会话 {#rn-065}

`create_module_map` 拒绝**同一会话内**的第二次发出，并给出说明下一步的消息。跨会话时映射继续版本化（`version + 1`，`findCurrent` 返回最高的）——修订架构是期望的行为。

区别正是要点：跨会话时，新的发出是一次**修订**；在同一会话内，是模型**从零重新决定**。在一次真实执行中，Arquiteto 连续发出了四个映射，每次名称和划分都不同——`greeting`、`hello_core`、`greeting`、`hello-api-core`——循环之所以结束，只是因为网络断了（`%Req.TransportError{reason: :timeout}`）。

拒绝通过工具结果回到模型（[RN-061](#rn-061)）：它读到已经存在一个，就进入 `assign_story_modules`，即其 kickoff 的第 2 步。这就是回合在映射发出时**不**结束的原因——Arquiteto 还有三个步骤（关联故事、提议 ADR、记录张力），在那里结束会扼杀这三步。

- **位置：** `apps/api/src/application/use-cases/architecture/create-module-map.use-case.ts`
- **测试：** `test/application/use-cases/architecture/create-module-map.use-case.spec.ts`
  （`refuses the SECOND map of the same session`；跨会话的版本化在旁边继续得到证明）
- **来源：** FASE 13b 的真实执行

### RN-066 — 每个关于模块的响应都带有规范名称 {#rn-066}

Arquiteto **没有读取**现行 module_map 的工具。这就是它收到的三种关于模块的响应必须说出名称的原因：

1. 成功的 `create_module_map` 返回 **api 所记录的**模块——而不只是版本。
2. 被拒绝的 `assign_story_modules` 除了列出不存在的模块，还列出**有效**模块。
3. 被 [RN-065](#rn-065) 拒绝的 `create_module_map` 说明会话已经定义了**哪些**模块，而不是多少个。

没有任何映射时就没有名称可提供，而空列表读起来像"再猜一次"：这条路径点名真正的问题——缺少 kickoff 的第 1 步。

原因是具体的。在一次真实执行中，Arquiteto 发出了映射（`saudacao`、`api_http`），却无法重读它，于是诉诸蛮力：连续 18 次猜测——`api`、`core`、`http`、`greeting`、`domain`、`web`、
`hello-api`、`hello`、`greeting-api`、`saudacao`、`app`、`server`、`publico`、
`public-api`、`api-publica`——直到**碰巧猜中一个**。用它在事件日志中的话说：*"vou descobrir os nomes válidos testando candidatos
plausíveis"*。

损害不在于浪费，而在于结果：**四个**故事全部落在同一个模块（`saudacao`），包括端点那一个，`api_http` 没有任何故事，而结果声称*"Todas as 4 histórias foram
vinculadas a módulos com sucesso"*。由于执行会**为每个模块启动一个 dev agent**，设计的架构不会是建造出来的架构。

[RN-065](#rn-065) 的循环是这一点的症状：Arquiteto 重新发出映射，正是为了试图固定它无法读取的名称。

- **位置：** `apps/api/src/application/use-cases/architecture/assign-story-modules.use-case.ts`,
  `apps/api/src/application/use-cases/architecture/create-module-map.use-case.ts`,
  `apps/engine/lib/engine/harness/tools/create_module_map.ex`
- **测试：** `test/application/use-cases/architecture/assign-story-modules.use-case.spec.ts`
  （`the refusal lists the VALID modules`；`with no module_map, it directs
  creating the map`）和
  `create-module-map.use-case.spec.ts`（`the refusal says WHICH modules
  there are`）
- **来源：** FASE 13b 的真实执行

### RN-067 — 每个会话诞生时都发出 `session.created` {#rn-067}

`CreateSessionUseCase` 是创建会话的**唯一**位置。它在插入的**同一事务中**向 outbox 发出 `session.created`，正是这个事件让 engine 启动该会话的 `SessionServer`。

直接调用 `sessions.create(...)` 的人产生了一个 engine 从不知道的会话。效果是一连串无声的后果：

- Phoenix 通道永远响应 `REFUSED JOIN`——UI 只在控制台中抱怨，并每 10 秒重试一次；
- 没有通道就没有实时更新：消息流卡在输入指示器上，即使 agent 已经 `idle`；
- 没有人发送心跳，而关闭会话的正是心跳（[RN-064](#rn-064)），因此它**永远**保持 `active`。

有三条路径这样做：`provision-repository`（两次调用）、
`adopt-repository` 和 `activate-execution`——最后一个创建的正是运行 **dev agent** 的会话。

来自一次真实执行的对照证明：助手的会话没有 `session.created`，`engine.session_states` 为空，并且 `REFUSED JOIN`；通过正常路由打开的会话有该事件、状态行和 `JOINED`。

测试刻意针对*源码*：行为测试一次只能证明一条路径，而这里的缺陷是没有人想到的那条路径。

- **位置：** `apps/api/src/application/use-cases/sessions/create-session.use-case.ts`
  （所有者），`git/provision-repository.use-case.ts`,
  `git/adopt-repository.use-case.ts`,
  `execution/activate-execution.use-case.ts`（调用者）
- **测试：** `test/application/use-cases/sessions/toda-sessao-emite-created.spec.ts`
  (`only CreateSessionUseCase calls sessions.create`)
- **来源：** FASE 13b 的真实执行

### RN-068 — dev agent 无需请求许可即可读取 worktree {#rn-068}

激活执行会在项目的 `allow` 中植入两族命令：**读取自己的 worktree**（`ls`、`pwd`、`find`、`cat`、`head`、`tail`、
`grep`、`wc`、`echo`、`git status`、`git diff`、`git log`）以及**构建与测试**。

第二族早已存在：`ReportDone` 只有在 `exit 0` 的 `terminal` 之后才允许打开 PR。第一族是新增的，因为 agent **在构建之前先看**，没有它就连开始都做不到。

原因是具体的。处于待定状态的 `:pipeline` 工具返回 `proposed_action <id> status pending` 作为*结果*——而不是命令的输出——ToolLoop 继续前进。在新部署的仓库中，agent 的每个 `ls -la` 都落入审批，什么也没教给它，还烧掉一次迭代。在一次真实执行中，结果是
`toolloop.limit_reached {iteration: 8, max_iterations: 8}`，任务因"达到迭代上限"而被阻塞，一行都没写——而用户给出的批准在循环耗尽之后才到达。

放开读取并不放松流水线，测试断言的正是这一点：`deny` 胜过 `allow`，`BUILTIN_DENY_PATTERNS` 仍然有效，匹配按 *TOKEN* 前缀进行（允许的 `ls` 不允许 `lsof`），复合命令要求*每个*段都匹配——`ls && rm -rf /` 不会因为 `ls` 而通过。

允许列表是缓解，不是解决方案：它是预期命令的列表，而模型会发明命令。结构性的修正——agent *等待*决定，而不是烧掉迭代——见
[ADR 0052](../adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md)。

- **位置：** `apps/api/src/domain/actions/dev-terminal-patterns.ts`，
  由 `application/use-cases/execution/activate-execution.use-case.ts` 植入
- **测试：** `test/domain/actions/dev-terminal-patterns.spec.ts`
  （`allows ls -la`；`a composite command doesn't hitch a ride on the
  allowed segment`）
- **来源：** FASE 13b 的真实执行

### RN-143 — 只读的 git 子命令只有在被使读取无歧义的标志锚定时才被允许，绝不凭单独的动词 {#rn-143}

查询一次真实执行的数据库时发现，dev agent 在探索性子命令上烧掉了几十次人工审批——`git branch -a`、`git
remote -v`、`git worktree list`、`git show origin/dev --stat`、`git log
--all --oneline --graph`、`git for-each-ref`、`git ls-tree -r origin/dev
--name-only`、`git config user.name`——没有一个被 [RN-068](#rn-068) 覆盖，后者只允许 `git status`/`diff`/`log`（不带额外标志）。由于按 token 前缀匹配要求复合命令的*每个*段都在 `allow` 中，只要其中出现*一个*这样的子命令，一长串探索命令就整体落入 `require_approval`。

`DEV_TERMINAL_ALLOW_PATTERNS` 新增了
`git branch -a/-r/-v/--list/--show-current`、`git remote -v`/`git remote
show`、`git worktree list`、`git show`、`git for-each-ref`、`git
ls-tree`、`git rev-parse` 和 `git config --get`。`git log` 不需要新模式：匹配本来就是按 token *前缀*（允许额外的尾随 token），所以 `Terminal(git log)` 已经覆盖了 `git log
--all --graph --oneline --decorate`。

**这里的谨慎与 RN-068 对 `ls`/`lsof` 所展示的相同，只是应用于那些有一个接受同样截断形式的*变更型*兄弟的动词。**
`Terminal(git branch)` 会匹配 `git branch -D nome`（删除），也会匹配 `git
branch nome-nova`（创建）或单独的 `git branch`——模式看不到它所核对的前缀*之后*是什么。这就是为什么四个具有变更形式的动词（`branch`、`remote`、`worktree`、`config`）没有一个是凭单独的动词被接纳的；每一个都由使读取无歧义的标志*锚定*，无论后面跟什么：

- `git branch`——锚定在 `-a`/`-r`/`-v`/`--list`/`--show-current`，绝不在单独的动词上；`-D`/`-d`/`-m`/`-M`（删除/重命名）和单独的分支名（创建）被排除在外。
- `git remote`——锚定在 `-v` 和 `show`（其后只接受远程名，总是读取）；`add`/`remove`/`set-url` 被排除在外。
- `git worktree`——锚定在 `list`；`add`/`remove`/`prune` 被排除在外。
- `git config`——只接纳了 `--get`，因为它是 git 本身保证无论后面跟什么都是读取的唯一标志（一个键，或一个键 + 值模式）。*不带* `--get` 的 `git config user.name`/`git config
  user.email` 被刻意排除：键之后的第二个 token（`git config user.name "novo valor"`）是*写入*，而前缀匹配在不发明新的参数计数解析器的情况下，无法区分"没有多余 token"和"多一个 token"——这与已经阻止单独 `git branch` 的限制相同。`--global`/`--system` 从未被锚定。

- **位置：** `apps/api/src/domain/actions/dev-terminal-patterns.ts`
- **测试：** `test/domain/actions/dev-terminal-patterns.spec.ts`（describe
  `read-only git subcommands (found live)`——覆盖实时观察到的复合链被自动批准，以及每个使用*相同*命令词的变更变体——`git branch -D`、`git remote add`、`git worktree add`、
  `git config --global user.name`——仍处于 `require_approval`）
- **来源：** 对一次真实会话数据库的查询，在使用中发现

### RN-069 — 重试任务会重建分支，而不是失败 {#rn-069}

`WorktreeManager.add_worktree/3` 使用 `git worktree add -B`（创建**或**重置），而不是 `-b`。它原本就会移除前一个 worktree 的目录，却把分支留了下来——而由于分支名来自任务的 slug，对*同一*任务的第二次尝试总是落入 `fatal: a branch named
'feature/<slug>' already exists`。

效果是永久性的：解除任务阻塞没用，重新激活执行没用，熔断器跳闸后无路可走。在一次真实执行中，唯一的出路是在项目的 workspace 中手动执行 `git worktree prune`。

重置是正确的选择：前一个 worktree 已经被移除，那次尝试的工作毫无价值（任务已回到队列），分支从 `work_dir` 的当前位置重新诞生。

- **位置：** `apps/engine/lib/engine/dev/worktree_manager.ex`
- **测试：** `apps/engine/test/engine/dev/worktree_manager_test.exs`
  (`retrying the SAME task recreates the worktree instead of failing`)
- **来源：** FASE 13b 的真实执行

### RN-070 — 每个声明的 gate 都指向证明它的证据 {#rn-070}

`docs/gates.yml` 中没有任何条目可以没有 `evidencia`，注册表不能断言多于它所校验的：`block` gate 要求 `verificacao:
script`，`planned` gate 不携带尚未发生之事的证据。

证据是一个**定位器**，而不是散文：`event_log` 带有事件类型以及将它们与相邻事件区分开来的 payload 过滤器；`teste` 和 `ci` 带有路径，消失的目标会*失败*。这与 docmap 所说的死 glob 是同一种失败模式——一条从不触发、却假装有覆盖的规则。

**最后这一断言是关于*仓库*的，从不在运行时评估。** 注册表分两层校验：`validarRegistro`（内容——`block` 需要 `script`，四个人工 gate 仍是人工的，`active` 需要证据，没有重复 id，没有孤立的 `entrada`）在文件被读取的任何地方都有效，也是 api 的 loader 所调用的；`validarLocalizadores`（目标文件在磁盘上）只有在 checkout 之内才有意义，由真实文件的测试和 `validacao-gates.ts` 的第 2 阶段来要求。

两者过去是同一个函数，这造成了一个生产缺陷，在已安装的 v6.1.0 中测得：`GET /gates` 返回 `500`，`RegistroDeGatesInvalido` 列出全部十一个目标缺失——大约 55 分钟内十二次 5xx，在每个安装中都是如此。生产镜像带有
`/app/docs/gates.yml`，而 `docs/` 中别无其他；`apps/api/test/`、`scripts/ci/`
和 `.github/` 从不进入镜像。规则没有被放宽——它被移到了问题存在的地方。不要把它放回 loader：在一个没有仓库的进程中，`arquivoExiste` 回答的是另一棵树。

界面掩盖了这一点：[RN-084](#rn-084) 让 `PrGateTimeline` 在路由失败时回落到完整流水线，因此 500 只出现在 api 的日志中。

三种类型，因为不是每个 gate 都存在于事件日志中：
[`merge-protegida`](../business-rules.md#rn-014) 是一条纯规则中的上限，不发出自己的事件（保证它的是一个测试），`backmerge` 是 CI，状态在 `.release/gate.json` 中。因此把它们降级为 `warn`，就是对产品最硬的锁撒谎。

过滤器与类型同样重要：`qa-verificada` 和 `secops-segura` 写入*同一个* `pr.gate_changed`，而同一类型在 gate *打开*时也会触发，不带 `veredito`——没有过滤器，打开就会被算作通过。基础设施 PR 的两个 gate 也一样。这就是为什么没有任何一对（`event_types` +
`filtro`）可以重复。

过滤器只能触及 *PAYLOAD*，这是刻意的：接受任意列会打开整个查询。谁晋升了 story（人或 PO）存在于 `actor_kind` 列中，不在声明式词汇之内。

- **位置：** `apps/api/src/domain/gates/gate-registry.ts`
  （`validarRegistro` 和 `validarLocalizadores`），登记在
  `docs/gates.yml`，在 `apps/api/scripts/validacao-gates.ts` 中测量；
  刻意只调用第一个的 loader 是
  `apps/api/src/infrastructure/gates/gate-registry.loader.ts`
- **测试：** `apps/api/test/domain/gates/gate-registry.spec.ts`
  （`é válido: nenhum problema acumulado`；`todo alvo de prova citado
  existe no repositório`；`validarRegistro ignora o disco: alvo ausente
  não é problema DELE`；`nenhum par (event_types + filtro) se repete
  entre gates`）和
  `apps/api/test/infrastructure/gates/gate-registry.loader.spec.ts`
  （`carrega o registro real sem exigir os alvos que a imagem não leva`，
  针对按生产镜像目录树重建的根）
- **来源：** FASE 15a（ADR 0054）；两层划分来自在已安装的 v6.1.0 中测得的
  `GET /gates` 的 500（AT-086）
### RN-071 — 用户权限的四个 gate 不能被声明为自动 {#rn-071}

`acao-aprovada`、`story-promovida`、`plano-de-adocao` 和 `merge-protegida`
在构造上就是 `aprovacao_humana: true`。列表位于*领域*中（`GATES_HUMANOS_IMUTAVEIS`），而不是测试中：修改它必须是一个刻意的行为，像代码一样被审查。

`aprovacao_humana: true` 意味着决定属于用户——直接通过一次点击，或者委托给他自己在 `permissions.json` 中写下的策略。正是这一点让 `acao-aprovada` 可以与 `status: auto_approved` 共存：策略独自决定，就是用户事先已经作出了决定。`merge-protegida` 是连委托都不存在的情形——即使自主权打开，上限也会把 `auto_approve` 降为 `require_approval`。

反过来也会失败：列表中没有对应 gate 的 id 是一条死规则，指向虚无。

- **位置：** `apps/api/src/domain/gates/gate-registry.ts`
  （`GATES_HUMANOS_IMUTAVEIS`）；上限在
  `apps/api/src/domain/actions/decide.ts`
- **测试：** `apps/api/test/domain/gates/gate-registry.spec.ts`
  （`%s cannot have aprovacao_humana false`）；上限在
  `apps/api/test/domain/actions/decide.spec.ts`
- **来源：** FASE 15a（ADR 0054）

### RN-072 — 没有显式选择时，模型是 Criativo agent 的模型 {#rn-072}

当 binding 级联落在 **workspace** 的默认值上——也就是说，没有人为这个项目决定任何东西——继承的模型是 **Criativo** agent 的，而不是全局默认值。

Criativo agent 始终是项目的入口：第一次对话就是与它进行的，它的 binding 代表"这个项目用来思考的模型"。

继承只填补**空缺**，从不覆盖：会话、agent 或项目的 binding 是某个人的显式选择，继续胜出。这就是为什么它是级联*之后*的一步，而不是级联之内的新范围——它不争夺优先级。继承的模型经过同样的过滤：从目录中消失或没有 tool calling 意味着不被继承，理由与级联跳过它们相同（[RN-043](#rn-043)）。

这修复的是：workspace 的默认值是全局的，往往是一个小的本地模型。新会话和 dev agent——它们没有自己的 binding——会诞生在它上面，而 [ADR 0020](../adr/0020-destravar-gates-qa-secops.md) 禁止在语义步骤中使用小的本地模型。在一次真实执行中，必须在每个打开的会话中手动更换模型，三个 dev agent 在没有任何人要求的情况下运行在
`llama3.2:1b` 上。

- **位置：** `apps/api/src/domain/llm/binding-resolver.ts`
  （`herdarModeloDeStart`），应用于
  `application/use-cases/llm/resolve-model-binding.use-case.ts`
- **测试：** `apps/api/test/domain/llm/binding-resolver.spec.ts`
  （`fills the gap`；`does NOT override %s's explicit choice`）
- **来源：** 真实执行的发现 B 和 O（FASE 13c，阶段 A）

### RN-073 — 待定的审批*暂停*循环，而不是烧掉它 {#rn-073}

当流水线工具返回 `pending` 时，ToolLoop **停止**，dev agent 进入 `:awaiting_approval`，持有任务、worktree 和循环的历史。用户的决定发出 `task.action_settled`，唤醒它：真实结果占据原本会是 "pending" 一词的位置，循环从中断处继续。

测试锁定的两个性质：

- **等待期间什么都不记录。** 工具消息的位置保持为空。在那里写 "pending" 会告诉模型这就是命令的回答——而这正是缺陷所在。
- **拒绝也是一个回答。** 原因占据结果的位置，agent 得知那条路已经关闭，而不是永远等待没有人会批准的东西。这与 `opened: false` 的 `pr_settled`（[RN-047](#rn-047)）是同一原则，低一个层级。
- **wake 必须*到达*。** `task.action_settled` 诞生于 `task` 聚合，而不是表名所暗示的 `proposed_action`：engine 的 drain 读取一个封闭的聚合列表（`session` 和 `task`）。在这个列表之外发出时，事件被成功写入，`processed_at` 保持为空，甚至不会被读取——没有 job，没有错误，没有日志，agent 永远等待。契约跨越两种语言，这就是它在两侧都被锁定的原因。

如果 engine 在等待期间**重启**，这条规则对该任务不再适用：暂停的循环只存在于内存中，因此任务以来源 `infra` 被阻塞地回到队列，之后作出的决定无处可用。带诊断地阻塞是刻意的——另一种选择是永恒而无声的等待，而这正是这条规则要终结的。

这修复的是：`pending` 过去作为工具的*结果*返回，循环继续前进。模型把它读作命令的回答，什么也没学到，尝试别的东西——每次尝试都烧掉一次迭代，直到 `toolloop.limit_reached {iteration: 8, max_iterations: 8}`，任务因"达到迭代上限"而被阻塞，一行都没写。授予的批准在循环耗尽之后才到达，毫无用处。

终端允许列表（[RN-068](#rn-068)）仍然有效，但不再是唯一的防线：它是预期命令的列表，而模型会发明命令。

- **位置：** `apps/engine/lib/engine/harness/hooks/action_pipeline.ex`,
  `harness/tool_loop.ex`, `dev/dev_agent_server.ex`,
  `workers/dev_agent_wake_worker.ex`；发出在
  `apps/api/src/application/use-cases/actions/{approve,deny}-action.use-case.ts`
- **测试：** `apps/engine/test/engine/dev/dev_agent_awaiting_approval_test.exs`
  （`pending action STOPS the agent`；`approved: resumes the loop with
  the REAL output`；`restart during the wait BLOCKS the task`）和
  `apps/engine/test/engine/dev/wake_do_outbox_ao_agente_test.exs`，它走完整条链——outbox、drain、队列和进程——因为逐环节的测试在投递损坏时全都是绿的；聚合在 api 一侧锁定于
  `apps/api/test/application/use-cases/actions/approve-deny-action.use-case.spec.ts`
- **来源：** [ADR 0052](../adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md)，
  分诊的阶段 A

### RN-135 — 激活执行会关闭发起请求的*聊天*会话 {#rn-135}

`ActivateExecutionUseCase` 总会解析*执行*会话（`findActiveExecutionSession`，或创建一个新的 `criativa`），但从不转换点击"激活执行"所在的*聊天*会话——与 Dev Lead/PO 的对话，位于一个单独的会话中。它永远保持 `active`，即使执行已经在另一个会话中独自运行，并继续作为打开的对话出现在列表中。

`execute()` 新增了 `originSessionId`，可选且放在最后——旧的调用者（目前只有从概览页激活，没有会话上下文）继续以*完全相同*的方式工作，什么都不关闭。传入时，在方法*末尾*（在其他一切都已发生之后：module_map、区域、自主权、`startExecution`、`execution.activated`）：

- **从不关闭自身的执行会话**——如果 `originSessionId` 等于刚收到 `execution.activated` 的会话，就跳过关闭，因为关闭它会摧毁 dev agent 刚获得的进程；
- **只关闭处于 `active` 的**——与
  `decide-bootstrap-plan.use-case.ts#fecharSessao` 同样的谨慎，如果会话已不存在或已不处于打开状态则什么都不做；
- **复用 `GetSessionPendingWorkUseCase`**（[RN-073](#rn-073)）——与阻止不活动心跳关闭会话的*同一*防护：已提供的 handoff、待定的 `proposed_action` 或之后没有 `idle` 的 `working` agent 都会阻止关闭；
- 在 `closed` 之前经过 `closing`——状态机（`active -> closing -> closed`）不允许直接跳转。

这里的失败或待定状态*绝不*传播给调用 `execute()` 的人：执行的激活已经发生，是主要效果；关闭来源聊天是*尽力而为*的附带效果。

- **位置：** `apps/api/src/application/use-cases/execution/activate-execution.use-case.ts`
  （`closeOriginSession`），`apps/api/src/interfaces/http/execution/dto/activate-execution.dto.ts`
  （`originSessionId`），`apps/api/src/interfaces/http/execution/execution.controller.ts`
- **测试：** `apps/api/test/application/use-cases/execution/activate-execution.use-case.spec.ts`，
  describe `fecha a sessão de origem (RN-135)`——没有待定时关闭，有待定时*不*关闭，*不*关闭已经不是 `active` 的会话，不带参数的旧调用者什么都不关闭，即使 `originSessionId` 与之一致也从不关闭自身的执行会话
- **来源：** 代码调查中的发现——已激活执行的创意会话在列表中仍为 `active`，即使其中有 35 个 dev agent 事件

### RN-074 — 终端输出有字节上限 {#rn-074}

命令的输出在成为工具结果之前被截断到 `TERMINAL_OUTPUT_MAX_BYTES`（默认 32 KiB），截断会留下一个**标记**，说明两个大小以及该怎么做：

```
[saída truncada: 32768 de 1048576 bytes. Refine o comando (head, grep,
-maxdepth) para ver o que falta.]
```

测试锁定的三个性质：

- **上限是 `>`，不是 `>=`。** 恰好等于限制的输出原样通过——标记它会让模型去细化一个已经给出全部内容的命令。
- **截断不会切开多字节字符。** `binary_part/3` 按字节截断；落在一个 `é` 中间会产生无效二进制，在结果到达模型之前就破坏 JSON 序列化。
- **`raw_bytes` 仍然是产生的*真实*大小**，而不是截断后的。这是测量，在这里撒谎恰恰会隐藏促成这个上限的行为。想检测截断的人比较 `byte_size(stdout)` 与 `raw_bytes`。

这修复的是：每个命令的输出都留在循环的历史中，并在之后的**每一个**回合中传输。没有上限时，一个在大目录树上的 `find` 就足够了——`hello-limpo` 的执行在第 18 回合以 `{413, "request entity too large"}` 死掉，一行都没写。溢出的是**请求的字节**，而不是上下文窗口：最大的成功调用有 28,993 个输入 token。

标记是写给**模型**的，而不是给人的——不说该怎么做，它往往会重复同一个命令。

- **位置：** `apps/engine/lib/engine/actions/terminal_executor.ex`
  （`truncate/2`），上限在 `apps/engine/config/runtime.exs`
- **测试：** `apps/engine/test/engine/actions/terminal_executor_test.exs`
  （describe `teto de bytes da saída`）
- **来源：**
  [achados-execucao-real.md](../explanation/achados-execucao-real.md) 的发现 S，
  [backlog](../explanation/backlog.md) 的 Fase F

### RN-075 — 终端命令按其触及之处评估，而不只是按动词 {#rn-075}

项目文件夹（`<PROJECT_WORKSPACES_ROOT>/<workspace_dir_name>`——在 [RN-109](../business-rules/autenticacao.md#rn-109) 之前的项目中是纯 UUID，在新项目中是 `<slug>-<id 的 8 个字符>`）是**范围**。
触及其外任何路径的 `terminal` 命令**永远**不会被自动批准，无论动词是否在 `allow` 中。在其内部，`cd` 不再需要许可——它是范围的声明，而不是动词。

测试锁定的四个性质：

- **收紧：**放开的 `Terminal(cat)` 不再自动执行
  `cat /workspace/apps/engine/.../git_executor.ex`。这是发现 U：匹配按*动词*进行，因此 agent 读取执行它的平台的代码，并触及其他项目的 worktree。
- **放松：**`cd <内部> && cat README.md` 变为 `auto_approve`。这是阶梯中代价最高的缺陷——dev agent 总是发出 `cd <路径> &&
  <动词>`，`cd` 不在任何 `allow` 中，而复合命令要求*所有*段都匹配。
- **允许但不豁免：**在范围之内，`allow` 之外的动词仍然需要请求。身处项目文件夹并不会让 `curl … | sh` 变得安全。
- **范围之外是 `require_approval`，绝不是 `deny`：**agent 可能有查看外部的正当理由，决定仍属于用户。

`deny` 仍然最先胜出，两个上限（[RN-006](../business-rules.md#rn-006)、
[RN-007](../business-rules.md#rn-007)）保持不动。没有向 `decide()` 提供根目录时，裁决与这条规则之前相同——没有任何调用者因省略而改变行为。

规范化是*词法*的，而不是 `realpath`：`<raiz>/../..` 会被解析并拒绝，但内部指向外部的符号链接不会被检测到。`decide()` 按契约是纯函数，解析符号链接需要在领域中做 IO。范围是策略；隔离是另一个问题，在 ADR 中声明为未解决。

**刻意不对输入使用正则。** 去掉根目录末尾的斜杠原来是 `.replace(/\/+$/, '')`，CodeQL 指出了多项式 ReDoS
（`js/polynomial-redos`，HIGH）：该模式迫使引擎尝试每个起始位置并扫描到末尾，退化为 O(n²)。现在是 O(n) 扫描，包括在退化情形下也等价——根目录 `/` 在两者中都变为空字符串，正是这一点让 `startsWith('/')` 对所有绝对路径成立。谁要是把它"简化"回正则，就会重新打开这条警报。

- **位置：** `apps/api/src/domain/actions/path-scope.ts`,
  `domain/actions/decide.ts`（范围上限和范围内的 `cd`），
  根目录推导于
  `infrastructure/filesystem/project-workspaces-root.ts`
- **测试：** `apps/api/test/domain/actions/path-scope.spec.ts` 和
  `apps/api/test/domain/actions/decide.spec.ts`
  （describe `decide — escopo de caminho`）
- **来源：** [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md)，
  发现 U，[backlog](../explanation/backlog.md) 的 Fase F

范围只有在其自身位于根目录之内时才有效——保证这一点的是 [RN-092](#rn-092)。

### RN-092 — `projectId` 是路径段，范围永远不离开根目录 {#rn-092}

`projectScopeRoot()` **拒绝**不是简单路径段（`^[A-Za-z0-9_-]{1,64}$`）的 `projectId`，抛出异常而不是拼出路径。

原因是 id 来自没有校验管道的 `@Param('projectId')`，而 Express **在交付之前就解码了段的百分号编码**：`..%2F..%2Fetc` 到达时是 `../../etc`，`join` 会毫无怨言地解析到根目录之外。这个函数的两个消费者都会受害，而第二个是严重的：

- `permissions.json` 会在任意路径上被读取**和写入**；
- [RN-075](#rn-075) 的范围授权在该文件夹下执行 `terminal` 命令。逃出根目录的范围，就是审批策略指向了错误的地方——这是*安全*失败，而不是找不到文件。

检查刻意**比 UUID 更宽**（接受字母、数字、连字符和下划线），以免绑定 id 的格式，同时又窄到结果永远无法逃出。它位于**根目录被推导的地方**，而不是每个调用者中，理由与这个函数存在的理由相同：两种推导必须一致，重复的检查就是有一天会分歧的检查。

正常路径不变——每个真实 id 都是来自数据库的 UUID。

- **位置：** `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`projectScopeRoot`)
- **测试：** `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
- **来源：** [ADR 0058](../adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md)，
  CodeQL 的 `js/path-injection` 警报

### RN-095 — 仓库读取被限制在项目内并有上限 {#rn-095}

代码读取接口面（`GET /projects/:projectId/code/{tree,file,search}`
以及 PR 的 diff）有**两项**保证，而两项属于同一类型：产品拒绝做客户端请求的事。

**约束。** 来自客户端的每个文件路径都经过
`caminhoDeRepositorioContido()`，它把请求锚定在项目文件夹上，拒绝离开它的东西——`../`、绝对路径或 NUL 字节。它是唯一的一个函数，与 [RN-092](#rn-092) 的 `projectScopeRoot` 在同一文件中，复用终端范围的原语（`normalizarCaminho`/`dentroDoEscopo`）。**没有任何路由自行校验路径**，而这正是规则所断言的：同一约束的四个实现就是四次分歧的机会，CLAUDE.md 已经记录了保持中央检查、并在 CodeQL 面板上付出代价的决定（它看不到位于另一个函数中的屏障）。

它返回*规范化后*的路径，调用者使用返回的东西。返回原始路径会允许检查 `b` 却把 `a/../b` 发给提供方——这是约束存在却不生效的最常见形式。

向量不是"读错文件"。在 `github`/`gitlab` 中，路径会成为提供方 API 的 URL 段，因此一个 `../` 会**换掉端点**，而手里拿着 workspace owner 的凭据（[RN-058](#rn-058)/[RN-082](#rn-082)）。在 `local` 中，它成为 `git show <ref>:<path>` 的右侧。`ref` 在同一位置、出于同一理由被检查，其中的 `..` 被拒绝，因为对 git 而言 `dev..main` 是提交区间，而不是修订。

**上限。** 目录树和 diff 已经由契约截断
（`GIT_TREE_ENTRY_LIMIT`、`GIT_DIFF_FILE_LIMIT`，FASE 26a）。**搜索**不是：它不是契约的操作——它组合在 `listTree` 和 `getFileContent` 之上，是唯一一个成本随仓库*大小*而不是请求大小增长的读取。三个预算让它停下（遍历的目录、打开的文件、返回的匹配），一个短 TTL 缓存避免重复相同的调用，`truncated` 说明发生了截断。没有它们，`viewer` 可以随意消耗 owner 的凭据和速率限制——与仪表板每分钟 3,824 次请求（[RN-090](../business-rules.md#rn-090)）同一族的缺陷。

截断总是**可见的**：每个可能被截断的响应都在一个字段中说明这一点。搜索中还会带上 `filesScanned`，因为没人看得见的成本就是没人修正的成本。

**读取不会变成 `proposed_action`。** 读取不是外部效果，把它变成审批动作会让队列充满噪音，直到再也没有人去读真正的那些。阶段的冻结是这件事的另一面：标签页只读，而写入——当它到来时——以 `proposed_action` 的形式诞生。

- **位置：**
  `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  （`caminhoDeRepositorioContido`），
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`,
  `apps/api/src/domain/git/git-read-limits.ts`,
  `apps/api/src/domain/git/git-read-cache.ts`,
  `apps/api/src/interfaces/http/git/code.controller.ts`
- **测试：**
  `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  （单独的约束），
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  （恶意路径在三条路由上于调用提供方**之前**被拒绝，以及三个预算各自让搜索停下），
  `apps/api/test/domain/git/git-read-cache.spec.ts`
- **来源：** FASE 26b，16–26 计划的第 34 项；约束扩展了
  [RN-092](#rn-092)（[ADR 0058](../adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md)）
