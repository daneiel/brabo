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
`ModelsSection`（区域）——，而决定谁打开它的尺子不是界面，而是
`assertModelFitsBindingScope`：api *拒绝*的地方，过滤器默认勾选；api 不拒绝的地方，由人来选择。因此*会话*选择器仍然没有过滤——在那里勾选会隐藏 api 接受的模型。**这并不消除 422**：过滤器只覆盖三个原因之一，另外两个（[RN-043](#rn-043)——在 workspace 中被停用、从提供方消失）仍然可能出现，不可用的模型仍会被*列出*并标记；[RN-470](#rn-470) 的拒绝结果仍然是说明发生了什么的东西。而且它是复选框的*初始*状态，不是锁：取消勾选就会重新列出全部。

**后果：被过滤器隐藏的现行模型会被*说出来*。** `workspace` 和
`project` 从未要求 tool calling，而解析 agent 或区域 binding 的路由调用 `ResolveModelBindingUseCase` 时**不带**
`exigeToolCalling`——因此这些层级上只能聊天的默认值会被正常解析，成为该行的现行模型。在过滤器勾选时，触发器显示的名称不在打开的列表中，也没有任何选项被选中。选择器现在会点名该模型和原因；它*可以*点名原因，因为那里只有一个过滤器。当整个列表都为空时，说话的仍然是空列表文本，它已经让人取消勾选——关于同一个复选框的两条提示只是噪音。

**事实更正，而不是对上文的更正：**"Only `agent` validates" 描述的是 Fase 9a。自 [ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md) 起，
`area` 进入*同一*校验——它不是通用回退，区域模型唯一的消费者是该区域的 agent（[RN-102](#rn-102)）——，这就是打开过滤器的界面有*两个*的原因。

- **位置：** `apps/api/src/domain/llm/model-capabilities.ts:38`；
  `apps/web/src/components/ModelPicker.tsx`（过滤器和隐藏现行模型的提示），`apps/web/src/routes/settings/ModelsSection.tsx`、
  `apps/web/src/routes/settings/ModelsSection.tsx`（打开它的界面）
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

### RN-127 — 代码标签页的 `ref`/`path` 拒绝以*数组*形式到达，而不只是拒绝范围之外的路径 {#rn-127}

`@Query('ref') ref?: string` 和 `@Query('path') path?: string`
（`code.controller.ts`）提取原始值，中间没有 DTO/`class-validator`，全局的 `ValidationPipe`（`main.ts`）也帮不上忙：按 Nest 的设计，它跳过原生基本类型（`String`），因此在 `ref`/`path` 作为方法参数到达之前，没有任何东西拦截它们。Express 把 `?ref=a&ref=b` 作为**数组**而不是字符串交付——TypeScript 的 `string` 注解只存在于编译期。

数组会逃过 [RN-095](#rn-095) 原本把值当作字符串进行的*两项*检查：在数组上，`ref.includes('..')` 的语义是*精确元素*（而不是子串），而 `REF_VALIDO.test(ref)` 在匹配之前对数组调用 `.toString()`——像 `['x/../y']` 这样的值包含 `..`，却仍能通过两项检查。

`garantirQueryEscalar(valor, criarErro)` 在任何其他检查*之前*拒绝数组，只在一处，由两个把查询当作字符串处理的地方复用：`caminhoDeRepositorioContido`（与 RN-092/095 同一文件）和
`ReadProjectCodeUseCase.alvo`（`ref`）。具体的错误（`CaminhoForaDoEscopoError`
或 `BadRequestException`）由调用者决定，以工厂形式传入——中央函数不决定错误类型，只决定检查的形式。

正常路径不变：每个合法的 `ref`/`path` 本来就是字符串。

- **位置：** `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  （`garantirQueryEscalar`，用于 `caminhoDeRepositorioContido`），
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  （`alvo`，`ref`）
- **测试：**
  `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  （单独的 `garantirQueryEscalar`，以及拒绝数组的 `caminhoDeRepositorioContido`），`apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  （作为数组的 `ref`/`path` 在 `tree` 上是 400，所有其他路由通过 `alvo` 复用它）
- **来源：** CodeQL 的*严重*警报（HTTP 查询参数的类型混淆），阻塞了 qa→main 的晋升，在 PR #256 期间发现；扩展了
  [RN-095](#rn-095)

### RN-093 — 在生产环境中，api 不会以 OAuth `state` 的示例密钥启动 {#rn-093}

当 `NODE_ENV === 'production'` 且 `GIT_OAUTH_STATE_SECRET` 缺失、等于仓库的示例字面量或少于 16 个字符时，`resolveOauthStateSecret()` **使启动失败**。在生产环境之外，开发默认值继续有效。

这个密钥签署 git OAuth 的 `state`，而 `state` 是唯一阻止回调 `GET /git/oauth/:provider/callback`——出于必要而公开的路由——被伪造的东西。密钥一旦为人所知，任何人都能为任意的 `{projectId, userId, provider}` 签发 `state`，让回调把从提供方获得的 git token 写入该 payload 所指的项目。

**为什么拒绝字面量，而不只是空值。** 默认值位于一个开源仓库的 `.env.example` 中——它是已发布的秘密，而不是弱秘密。而 `docker-compose.prod.yml` 把它作为回退值提供，因此在真实的出错路径上变量是**已定义的**：一个"非空"检查会对整个缺陷视而不见。

解析位于唯一的函数中，而不是每个调用者中，理由与 [RN-092](#rn-092) 相同——原来是同一字面量的两份副本，而副本会分歧。在这里分歧的话，回调会拒绝所有合法的 `state`。

- **位置：** `apps/api/src/infrastructure/security/oauth-state-secret.ts`
  （`resolveOauthStateSecret`），在 `apps/api/src/main.ts` 启动时调用
- **测试：** `apps/api/test/infrastructure/security/oauth-state-secret.spec.ts`
- **来源：** [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md)
### RN-114 — `GIT_OAUTH_STATE_SECRET` 的四个姊妹秘密在生产环境中同样不会以示例值启动 {#rn-114}

[ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md) 为 `GIT_OAUTH_STATE_SECRET` 关闭了这个模式，并明确保留了同一失败模式适用于四个姊妹秘密这一开放问题，它们在 `docker-compose.prod.yml` 中都有开发默认值：`AUTH_JWT_SECRET`、
`BRABO_SERVICE_TOKEN`、`CREDENTIALS_MASTER_KEY` 和 `SECRET_KEY_BASE`。这条 RN 关闭了这四个，完全复制同一条规则——这不是新的决定，而是把同一决定应用于姊妹们。

在生产环境（`NODE_ENV === 'production'`）中，当变量缺失/只有空格、等于仓库的示例字面量（它是公开的——在 `.env.example` 中）或少于 16 个字符时，每个解析器都**使启动失败**。在生产环境之外，开发默认值继续有效，因为没有 `.env` 的 `docker compose up` 必须能工作。

- `AUTH_JWT_SECRET`——推导出签署 access token 的 Ed25519 密钥对。使用公开默认值时，任何人都能伪造有效的 access token。
- `BRABO_SERVICE_TOKEN`——认证 api ↔ engine 的内部流量。使用公开默认值时，任何人都能不经过
  `EngineServiceGuard` 调用 `/internal/*` 路由。
- `CREDENTIALS_MASTER_KEY`——包裹加密用户凭据（LLM 密钥、git token）的 DEK。使用公开默认值时，任何人都能解密整个存量。**此处不在范围内**：任何轮换机制——它已经存在（`CREDENTIALS_MASTER_KEY_PREVIOUS` +
  `src/scripts/rewrap-deks.ts`）且不变；这里只是*启动*检查。
- `SECRET_KEY_BASE`（engine）——没有该变量时本来就会使启动失败（`runtime.exs`，`:prod` 块，Phoenix 的标准样板）。真正的缺陷不是 Elixir 中缺少检查：而是 `docker-compose.prod.yml` 把公开字面量作为回退值提供，使变量总是以*已定义*状态到达，掩盖了本已存在的 `raise`。这里的修正只是从 compose 中移除回退值——没有改动一行 Elixir。

拒绝字面量而不只是空值，理由与 ADR 0059 相同：`docker-compose.prod.yml` 把四个字面量作为回退值提供，因此在真实的出错路径上这些变量是**已定义的**——一个"非空"检查会对整个缺陷视而不见。

- **位置：** `apps/api/src/infrastructure/security/auth-key-material.ts`
  （`passphraseAtual`），`apps/api/src/infrastructure/security/service-token.ts`
  （`tokenDeServicoAtual`）和
  `apps/api/src/infrastructure/security/envelope-encryption.service.ts`
  （`EnvelopeEncryptionService`，在构造函数中检查）——前两个在 `apps/api/src/main.ts` 启动时调用，第三个在
  `NestFactory.create` 装配 provider 图时被执行。`SECRET_KEY_BASE` 在
  `apps/engine/config/runtime.exs`（未改变），回退值已从
  `docker/docker-compose.prod.yml` 中移除
- **测试：** `apps/api/test/infrastructure/security/auth-key-material.spec.ts`,
  `apps/api/test/infrastructure/security/service-token.spec.ts` 以及
  `apps/api/test/infrastructure/security/envelope-encryption.service.spec.ts` 中的 describe
  `validação de produção`
- **来源：** [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md)

### RN-076 — git 凭据从不写入文件 {#rn-076}

engine 在远程仓库上工作，方式是向 api 请求**工作远程**（`GET /internal/projects/:projectId/git-remote`），后者返回**干净的**来源，并单独返回 owner 的 token。token 通过**子进程的环境**进入 git 调用，别无他处：

- **不在 `origin` 中**——写入 `.git/config` 的是干净的 URL；
- **不在 argv 中**——`ps` 会显示任何进程的命令行；
- **不在文件中**——既没有持久化的 helper，也没有 `~/.git-credentials`。

凭据 helper 通过 `-c` 传入，只对那个进程有效，并且位于一个空的 `credential.helper=` 之后：helper 是累加的，第一个响应的胜出，因此不先清零的话，主机上的 helper 会抢先响应。

**为什么这是规则而不是偏好。** 把
`https://x-access-token:TOKEN@github.com/…` 写进 `origin`——几乎每个教程都这么教——会以明文把凭据写进**项目文件夹内部**，正是 [RN-075](#rn-075) 给予 dev agent **自动批准**读取权限的地方。一个 `cat .git/config` 就会在不经任何审批的情况下返回 token，而它会在循环的历史中传到 LLM 提供方。路径范围防止 agent 读取项目*之外*的东西；它无法防止产品自己放在*内部*的秘密。

凭据是 **workspace owner** 的，通过 [RN-058](#rn-058) 的同一个解析器——两条"凭据属于谁"的规则会分歧。`local` 提供方没有 token，也不询问 api：它直接从数据库解析，这是 `pnpm dev` 和整个测试套件所走的路径。

- **位置：** `apps/engine/lib/engine/actions/git_auth.ex`,
  `engine/projects/project_repository.ex`（`remoto_de_trabalho/1`），
  `apps/api/src/application/use-cases/git/get-project-git-remote.use-case.ts`
- **测试：** `apps/engine/test/engine/actions/git_auth_test.exs`（token 不出现在 argv 中，也不在 helper 中）和
  `apps/api/test/application/use-cases/git/get-project-git-remote.use-case.spec.ts`
  （返回的来源不包含 token，也不包含 `@`）
- **来源：** [ADR 0056](../adr/0056-o-engine-trabalha-em-repositorio-remoto.md)，
  发现 N，[backlog](../explanation/backlog.md) 的 Fase B

### RN-077 — 失败的来源总是四者之一 {#rn-077}

每个失败结果都以 [ADR 0020](../adr/0020-destravar-gates-qa-secops.md) 的**封闭**词汇点名*来源*——
`infra | modelo | codigo | politica`。没有第五个值：`null` 和
`"indeterminada"` 已不再可能。

两项结构性保证，没有一项依赖某人记得：

- **`AgentIo.block_task/4` 没有来源的默认值。** 它原来"在精神上是必需的"，默认值是 `"indeterminada"`——而真实执行中代价最高的结果正是这样产生的，因为调用点什么都没传。没有默认值，忘记就成了编译错误。
- **`FalhaDeTurno.origem/1` 总是返回四者之一**，并有一个表格测试，只要任何条目——包括从未见过的形式——产生别的东西就会失败。

**为什么去掉 `indeterminada`。** 它的存在有一个合理的论点：不瞎猜比在黑暗中选择更诚实。实际效果恰恰相反——`indeterminada` **不指向任何行动**，分诊下一轮的人要从零开始调查。它实际的意思是*分类器没有识别出这种形式*，这是我们代码的缺口：`codigo` 才是指向正确行动的来源（补上缺失的子句）。诊断仍然原样传递，因此什么都没丢。

**来源不是瞎猜。** ToolLoop 的每个结果都说明是谁决定停下的：`report_blocked` 和迭代上限属于**模型**（它作出了决定，或用完了它所拥有的）；预算和未批准的 PR 属于**策略**（是一个决定，没有东西坏掉）；重启和装配上下文失败属于**基础设施**；当存在 `last_error` 时，来源出自诊断所叙述的*同一个*错误——原先自相矛盾的正是这一对，`diagnosis` 说 `{413, …}`，同一行中 `origem` 却说 "indeterminada"。

- **位置：** `apps/engine/lib/engine/agents/falha_de_turno.ex`,
  `engine/dev/agent_io.ex`（`block_task/4`，没有默认值），
  `engine/dev/dev_agent_server.ex`（`origem_da_parada/1`）
- **测试：** `apps/engine/test/engine/agents/falha_de_turno_test.exs`
  （`o vocabulário é fechado`）和
  `apps/engine/test/engine/dev/dev_agent_server_test.exs`，它断言发出事件中的来源
- **来源：**
  [achados-execucao-real.md](../explanation/achados-execucao-real.md) 的发现 P、Q 和 T，[backlog](../explanation/backlog.md) 的 Fase G

### RN-078 — 保护分支的失败可以被确认，且只有它可以 {#rn-078}

在 GitHub 免费计划的私有仓库中，`protect_branches` 会失败——向导**在开始之前就提醒这一点**。用户可以确认这个失败并继续；bootstrap 结束，项目变得可以访问。

**这解锁的东西比看起来更大。** 失败后唯一提供的按钮是"重试"，而它总是因为同样的原因失败。而 `provision_failed` 让仪表板**把点击项目重定向回部署页面**——项目永远无法访问，困在一个不可能成功的步骤中。

**只有保护可以被确认。** 它是*最后*一步，也是唯一一个失败后仍留下可用仓库的步骤：仓库存在，文件已提交，分支已创建。创建仓库或提交失败是另一回事——在那里"继续"会产生一个没有地方工作的项目，按钮会成为第一个谎言之上的第二个谎言。拒绝会说明这一点，而不只是否定。

**产品的保证不变。** 合并锁（[RN-006](../business-rules.md#rn-006)）在 `decide.ts` 中施加，而不是由提供方的保护施加。没有它继续，去掉的是第二层，即 GitHub 的那一层——而不是 Brabo 的。正是这一点让这个出口诚实，而不是捷径。

决定以**用户**为执行者、原始错误放在 payload 中进入事件日志：不带保护继续是他的选择，之后阅读的人需要知道究竟豁免了什么。

- **位置：** `apps/api/src/application/use-cases/git/acknowledge-protection-failure.use-case.ts`,
  路由在 `interfaces/http/git/git.controller.ts`，按钮在
  `apps/web/src/routes/ProvisioningPage.tsx`
- **测试：** `apps/api/test/application/use-cases/git/acknowledge-protection-failure.use-case.spec.ts`
  （解锁；带执行者的日志中的决定；以及对先前失败的拒绝）
- **来源：** 发现 D，[backlog](../explanation/backlog.md) 的 Fase D

### RN-079 — Psicólogo 不分析没有可分析事件的会话 {#rn-079}

在花费一个模型回合之前，分析会先问有没有可分析的东西。没有的话，它**不运行**，结果成为 `psychologist.analysis_skipped`。

**"可分析"排除两样东西，原因不同：**

- **分析者自身的痕迹。** Psicólogo 把它的回合写进它所分析的会话日志（`agent.response`、`tool.call`、`tool.result`、假设）。把这些计算在内，会让一个空会话**从第一次分析起**就显得充实，每次重试都会让它更满——标准将再也不会失败。Anamnese 同理；
- **`bootstrap.*`**，即独自运行的仓库部署：九个机器步骤对这个人什么也说明不了。

其他一切都算，包括 `proposed_action.*`——用户不写任何消息地批准和拒绝**就是**行为，这是 Anamnese 已经学到的教训（[RN-063](#rn-063)）。

**这是两个计数，它们不能互相替代。** 原始计数衡量工作量（要读多少日志，进而用哪个分诊层级，轻还是重）；可分析计数决定是否有工作。混淆它们就是缺陷：一个只有 bootstrap 的会话被当作"20 个事件"，实际上一个都没有，于是获得了分析，而模型——没有任何东西可以引用——会编造不存在的 `seq`，直到证据校验拒绝它、它放弃为止，而预算已经花掉了。

**跳过同样适用于手动重新处理。** 重新处理不会制造材料：点击的人会在日志中收到原因，而不是关于一份不存在的日志的编造假设。

跳过会成为**事件**，这与 Anamnese 的跳过不同，后者只是日志——那个每 15 分钟运行一次，会变成噪音；这个每次会话关闭运行一次，而一个没有任何叙述的缺席分析是无法诊断的。

- **位置：** `apps/engine/lib/engine/session_events/event.ex`（`count_analisaveis/1`），
  `apps/engine/lib/engine/psychologist/triage.ex`（`should_run?/1`），
  `apps/engine/lib/engine/workers/psychologist_worker.ex`
- **测试：** `apps/engine/test/engine/session_events/event_analisaveis_test.exs`
  （包括对发现中那个会话的复现：14 个事件，没有一个可分析），
  `apps/engine/test/engine/workers/psychologist_worker_test.exs`
- **来源：** 发现 J，[backlog](../explanation/backlog.md) 的 Fase E

### RN-080 — 重复的业务规则在入口被拒绝 {#rn-080}

标题已经存在于**项目中**的 `business_rule` 不会被写入。拒绝通过与无效 payload 相同的路径回到模型，它会继续处理下一条规则，而不是停下。

**在入口，因为没有别的地方。** 没有规则表：工件*就是* `artifact.business_rule` 事件，而领域事件既不能删除也不能编辑。放它进来就意味着永远与重复共存。

**范围是项目，而不是会话**——重复是在会话之间产生的。再次运行 Criativo 会打开新会话，按会话的检查看不到上一轮，而这正是发现中的情形。

比较会规范化大小写、重音和多余空格；标点保留。**语义重复仍会通过，这是声明的，而不是遗忘：**
"Saudação com nome" 和 "Quem chama pode se identificar" 仍是两条规则，因为区分它们需要判断，放不进一个 `if`。
自 [RN-681](#rn-681) 起，*标题*的语义重复会在写入后通过 embedding **发出警告**——仍然通过，在这里从不被拒绝。

- **位置：** `apps/engine/lib/engine/harness/artifact_dedupe.ex`,
  `apps/engine/lib/engine/harness/tools/emit_artifact.ex`,
  `apps/engine/lib/engine/session_events/event.ex`（`titulos_de_regras/1`）
- **测试：** `apps/engine/test/engine/harness/artifact_dedupe_test.exs`,
  `apps/engine/test/engine/harness/emit_artifact_dedupe_test.exs`
- **来源：** 发现 K，[backlog](../explanation/backlog.md) 的 Fase E

### RN-081 — 重复的故事：相同标题拒绝，相同理由警告 {#rn-081}

对两个不同的问题给出两种不同的回应：

- 项目中**相同的标题**是错误，而不是选择：故事被**拒绝**，什么都不创建；
- **相同的理由**——故事引用的所有业务规则都已被另一个故事覆盖——是可疑，而不是错误。故事**会被创建**，并发出 `backlog.story_overlap_warned`。同一规则的第二种切分可能是正当的，因此由用户来判断；产品只是拒绝让它不被注意地通过。

**是包含，不是交集。** 两个故事共享一条规则是正常的，对此发出警告会变成没人读的噪音。只有当新故事没有增加任何覆盖时，信号才存在。不引用任何规则的故事不产生警告：把空集当作一切的子集会指控所有故事。

**界限与 [RN-080](#rn-080) 相同，而发现中的那一对恰好越过了它：**
"Endpoint público de saudação determinística" 和 "Endpoint público GET /hello que
responde saudação imediata" 以不同的标题和理由覆盖同一个端点——没有任何机械的东西把它们联系起来，它们继续通过。有测试断言这一点，让界限可见而不是隐含。
自 [RN-681](#rn-681) 起，这一对会通过 embedding 被*警告*——仍然通过，断言*这个*机制界限的测试依然有效。

- **位置：** `apps/api/src/domain/backlog/story-overlap.ts`,
  `apps/api/src/application/use-cases/backlog/create-story.use-case.ts`
- **测试：** `apps/api/test/domain/backlog/story-overlap.spec.ts`,
  `apps/api/test/application/use-cases/backlog/create-story.use-case.spec.ts`
- **来源：** 发现 R，[backlog](../explanation/backlog.md) 的 Fase E

### RN-082 — 动作的 git 凭据是 workspace *OWNER* 的 {#rn-082}

当 api 针对远程提供方执行 git 动作（`pr_open`、
`git_merge`）时，token 来自 **workspace owner**——与 [RN-058](#rn-058) 同一个解析器，而不是来自决定该动作的人。

**按决定者解析只在人工点击时有效。** 由策略自动批准的动作没有决定者：`decided_by` 为 `NULL`，token 为 `undefined`，GitHub 回应 `Requires authentication`。实际上，在自主权打开时——而这正是 ADR 0055 要实现的模式——**没有任何 dev agent 能在远程提供方上打开 PR**。

**暴露缺陷的对照**发生在同一次执行中：在同一轮里，`git_push` 通过而 `pr_open` 失败。push 由 *ENGINE* 执行，它已经注入了 owner 的凭据（[RN-076](#rn-076)）；PR 由 API 打开，而它处于不对称之中。

此前没有出现，因为之前的每次验证都使用 `LocalGitProvider`，那里根本不查询 token。

原则与 RN-058 相同，值得重复，因为正是它防止两条规则随时间分歧：**付账的人为 agent 买单**，这不随点击者而变化。这就是解析器被*复用*而不是重新实现的原因。

- **位置：** `apps/api/src/application/use-cases/actions/execute-git-action.use-case.ts`，
  复用 `application/use-cases/llm/resolve-credential-owner.use-case.ts`
- **测试：** `apps/api/test/application/use-cases/actions/execute-git-action.use-case.spec.ts`
  （自动批准的 `pr_open`，带 `decidedBy: null`，请求 owner 的凭据）
- **来源：** 发现 AA，[13b 的真实验证](../explanation/validacao-real.md)

### RN-083 — lead 决定并行度；超过上限时由你授权 {#rn-083}

启动多少个 agent 不再是代码中的一个数字：评估的是**区域的 lead**。但它的决定在*花费*上并不至高无上——在 `agent_areas.max_parallel`（默认 **2**）之内它直接启动并继续；**超过时就成为 `parallelize` 类型的 `proposed_action`**，经过与所有外部效果动作相同的流水线。

**上限属于*会话*，而不是模块。** 这是规则中唯一不显而易见的部分，也是粗心的重构会撤销的部分：按模块计数会允许 N 个模块 × 2 个 agent 而不需要任何授权——换了个名字的旧漏洞。有测试正好断言这一点。

**零或负数的上限是无效配置，而不是"无限制"。** 把它当作无限，会把一个输入错误变成无限制的花费，这与流水线存在的目的正相反。

**提出请求的是 lead；作出决定的是你。** `proposed_action` 以 lead 为执行者诞生，决定以你的名字留在事件日志中——正是这一区分让历史之后可以重建（[ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md)）。

原因在*不可变*的 payload 中传输，带三个数字（现有多少、请求多少、上限是多少）：六个月后阅读的人需要在不重建会话状态的情况下理解授权了什么。

`AcceptParallelizationUseCase` 不变：它仍然是*执行*者，无论是在直接路径上，还是在动作被批准时。从内部吸收它而不是重写它，正是让 Fase 4 的测试套件无需修改就保持绿色的原因——这证明了这一更换没有泄漏到外部契约。

**上限可按区域配置，并且只能由你配置。** `PATCH
/projects/:projectId/agent-areas/:key/max-parallel` 要求 `maintainer`——与激活执行相同的角色，理由也相同：改变上限就是决定产品可以不询问就花多少钱。没有自动提高它的途径。Anamnese 在注意到授权已成例行公事时可以*提议*，而提议在你接受之后仍要经过这条路由——一个自己提高自己花费上限的产品，正是审批流水线要阻止的东西。

改变上限对*之后*的请求有效。已经在等待决定的保持等待：动作在 payload 中带着它被创建时现行的上限，用新上限重新解读它，会改变你读完之后即将决定的东西。

- **位置：** `apps/api/src/domain/execution/paralelismo.ts`（纯规则），
  `application/use-cases/execution/request-parallelization.use-case.ts`,
  `application/use-cases/execution/set-area-max-parallel.use-case.ts`，
  在 `interfaces/http/execution/execution.controller.ts` 中暴露，在
  `apps/web/src/routes/settings/ParallelismSection.tsx` 中配置
- **测试：** `apps/api/test/domain/execution/paralelismo.spec.ts`,
  `test/application/use-cases/execution/request-parallelization.use-case.spec.ts`,
  `test/application/use-cases/execution/set-area-max-parallel.use-case.spec.ts`
  以及 `apps/web/src/routes/ProjectSettingsTab.test.tsx`（`ParallelismSection`）
- **Gate：** `docs/gates.yml`（`paralelismo-autorizado`）——自 fluxo.yml × 代码审计（发现 A1/B5）起为 `status: active`；机制本身没有变，变的只是自 FASE 14d 起错误地保持 `planned` 的登记，见
  [gates.md](../explanation/gates.md#a-registry-can-age-in-the-wrong-direction--stale-not-inactive)
- **来源：** [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md)，FASE 14d

### RN-094 — agent 区域与项目一同诞生 {#rn-094}

创建项目会在 `agent_areas` 中写入三个区域（`dev`、`qa`、`infra`），以及每个区域的 lead 和在 `agent_area_members` 中**可枚举**的成员——在与创建*相同*的事务中。如果 seed 失败，项目不会诞生：没有区域的项目，就是 RN-083 读到空表、在没有任何人决定的情况下落到默认值的项目。

**这是对缺陷的修正，而不是新能力。** `agent_areas` 自 FASE 14d 起就存在，却从未被写入——`AgentAreaRepository.upsert` 有测试，却*没有任何*调用者。在生产环境中表是空的，`GET /projects/:projectId/agent-areas` 返回 `[]`，读取它的四个用例在虚无上运行。这与 FASE 14d 自身的失败相同，写在 CLAUDE.md 中：**测试部件不等于测试通向它的路径**。因此这条规则的测试从路由调用的用例进入，使用真实仓储：这里的假对象只会证明已经被证明且已经坏掉的东西。

**在*两个*地方 seed，每一处回答不同的问题。** 项目创建让区域*存在*——设置界面读取的是一个从未执行过的项目。执行激活说明 `dev` 区域的*成员*是谁：`module_map` 的每个模块一个 `dev-<modulo>`，项目诞生时还不存在。在成员被写入之前，支撑寻址规则（RN-087）的是谓词 `ehDevDeModulo`，它不查询数据库。

**seed 从不发送 `max_parallel`。** 激活是可重复的，发送默认值会让你提高到 5 的上限悄无声息地回到 2——产品在撤销你的决定。回填迁移也一样：它让区域存在，就此止步。

在此之前创建的项目由迁移 `0038` 覆盖，两张表都使用 `ON
CONFLICT DO NOTHING`。没有它，缺陷只会对从零开始的人得到修正。

- **位置：**
  `apps/api/src/application/use-cases/agents/seed-agent-areas.use-case.ts`，
  由 `application/use-cases/iam/create-project.use-case.ts` 和
  `application/use-cases/execution/activate-execution.use-case.ts` 调用；
  规范列表在 `apps/api/src/domain/agents/agent-areas.ts`；
  回填在 `apps/api/src/db/migrations/0038_wandering_lila_cheney.sql`
- **测试：**
  `test/application/use-cases/iam/create-project-semeia-areas.spec.ts`（针对数据库的路径，包括让创建失败的那种失败），
  `test/db/agent-areas-backfill.spec.ts`（真正运行的迁移，运行两次）以及 `test/application/use-cases/execution/activate-execution.use-case.spec.ts`
  （dev 的成员，以及从不发送的上限）
- **来源：** FASE 18，在 16–26 计划的调查中发现的缺陷；
  表来自 [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md)

### RN-084 — 显示的流水线来自 gate 注册表 {#rn-084}

团队面板显示 PR 所处的阶段，方法是**从
`docs/gates.yml` 推导**，而不是来自写在界面上的列表。离开注册表的 gate 从流水线上消失；`planned` gate 永不出现。

**这条规则因一种特定的老化形式而存在。** 在 FASE
15b 之前，界面的阶段固定在组件中，而注册表（FASE 15a）在别处描述 gate。没有东西把两者联系起来：在 YAML 中加一个 gate 不会改变界面，删除一个会让界面继续显示一个已不存在的阶段——没有任何测试失败，因为两个来源各自都是正确的。这与 `docs/.docmap.yml` 要防止的腐坏相同，回应也相同：只有一个来源，并对其消费进行检查。

三个边界情况的决定，都是为了让界面**降级**而不是消失：

- 界面还不知道怎么绘制的 PR gate 会被**忽略**，而不是破坏渲染——注册表可能先于界面获得标签而获得一个 gate；
- **标签属于界面**，而不是注册表：YAML 描述的是工程，界面对话的是等待 PR 的人；
- **没有注册表**（路由失败）时，显示完整流水线而不是空白——一条通用流水线比什么都没有提供更多信息。

- **位置：** `apps/web/src/components/PrGateTimeline.tsx`（`etapasDaEsteira`），
  读取 `GET /gates`（`apps/api/src/interfaces/http/gates/gates.controller.ts`）
- **测试：** `apps/web/src/components/PrGateTimeline.test.ts`
  （`gate que SAI do registro some da tela`、`gate de PR que a tela ainda não
  sabe desenhar é IGNORADO`、`sem registro, mostra a esteira completa`）
- **来源：** [ADR 0054](../adr/0054-gates-como-registro-declarativo.md)，FASE 15b

### RN-085 — 迭代上限按 agent *类型*设置 {#rn-085}

一个 agent 在工具循环中可以转多少圈，取决于它所做的工作：对话者为 **8**，dev agent 和 QA 子 agent 为 **60**。不再有单一的数字。

**8 的上限诞生于对话型 agent，被做工作的 agent 继承了。** 在 13b 的真实验证中，这表现为阻塞：dev agent 把八圈都花在探索一个新部署的仓库上，**从未写过一个文件**；改为 25 后，它写了三个并运行了测试。记录的结果是 `limite de iterações atingido`，来源 `modelo`——技术上正确，实际上毫无用处，因为模型从未来得及判断任何东西。

**提高全局默认值是错误的修正**，而这正是规则所保护的：Criativo 对话不需要 60 圈，上限也是防止无限循环的锁。

**能提高的不是"工作多的"，而是下面有花费锁的。** 迭代上限防止无限循环；保护*钱包*的是 `token_budget_micros`。dev agent 和 QA 子 agent 带着任务的 `task_budget_micros` 运行，因此放宽圈数不会放宽账单。`infra-workflows` 使用重型工具，却仍然**保持 8**：它在没有预算的情况下运行，对它来说上限是唯一存在的锁。

两个有专门测试的边界情况：

- **`dev-lead` 是对话型的**，尽管有识别 dev agent 的 `dev-` 前缀（`dev-<modulo>`、`dev-<modulo>-2`）。lead 负责决定和委派，没有显式子句的话，它会因命名的偶然而以重型工作的上限诞生。
- **未知 agent 落到最低上限。** 向便宜的一侧犯错：需要更多圈数的会以 `limite de iterações atingido` 出现并被修正；错误地获得 60 的会悄无声息地花钱。

- **位置：** `apps/engine/lib/engine/harness/iteracoes.ex`，应用于
  `apps/engine/lib/engine/harness/tool_loop.ex`（`init/1`）
- **测试：** `apps/engine/test/engine/harness/iteracoes_test.exs` 和
  `apps/engine/test/engine/harness/tool_loop_test.exs`
  （`o teto vem do TIPO do agente quando o chamador não passa um`、
  `teto explícito do chamador VENCE o do tipo`）
- **来源：** 发现 X，[13b 的真实验证](../explanation/validacao-real.md)；
  [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md)，FASE 14d

### RN-086 — 为更多 agent 花钱永远不会自动批准 {#rn-086}

触及**产品可以独自花多少钱**的两个动作——
`parallelize`（现在就超过上限）和 `raise_max_parallel`（改变上限）
——永远不可自动批准。`agent_autonomy` 不行，
`permissions.json` 也不行。这与合并锁和指令补丁上限是同一类保证。

**没有这一点，[RN-083](#rn-083) 的上限就只是装饰。** 一个在 `allow` 中带 `Parallelize()` 的 `permissions.json` 会让每次超限都自行批准——要*求*用户决定的规则会变成免除用户决定。而 `raise_max_parallel` 是更严重的情形：那将是产品提高自己的花费上限，正是审批流水线要阻止的东西。

**Anamnese 可以*提议*，它做的正是这件事。** 当再授权一个 agent 成为例行公事时，上限就是错的，而最先察觉的是阅读历史的那一方。信号本来就会到达它：窗口内用户的决定来自 `proposed_actions`，带有 `actionType` 和 `status`。

阈值是**三次批准且没有拒绝**，两半都重要：

- **两次不是例行——就是两次。** 三次是区分"发生过"与"总在发生"的东西；
- **一次拒绝就推翻整个信号**，不管有多少次批准。如果用户曾经拒绝过，上限就在做它的工作，提议提高它就是把信号读反了。

提议一个**等于或小于**现行值的上限会被 api 拒绝：Anamnese 周期性运行，每轮都会重新提议同样的东西，让用户需要阅读的队列充满噪音。

批准应用的是 **payload** 中的值，而不是当时重新计算的值——那是你在作决定时读到的数字。

- **位置：** `apps/api/src/domain/actions/decide.ts`（上限），
  `application/use-cases/execution/propose-max-parallel.use-case.ts`,
  `execute-max-parallel-raise.use-case.ts`,
  `apps/engine/lib/engine/anamnese/tools/propose_max_parallel.ex`，阈值在
  `apps/engine/lib/engine/workers/anamnese_worker.ex`（`nota_de_paralelismo/1`）
- **测试：** `apps/api/test/domain/actions/decide.spec.ts`
  （`decide — teto do paralelismo`），
  `test/application/use-cases/execution/propose-max-parallel.use-case.spec.ts`,
  `execute-max-parallel-raise.use-case.spec.ts`,
  `apps/engine/test/engine/anamnese/tools_test.exs` 和
  `test/engine/workers/anamnese_worker_test.exs`（`duas aprovacoes NAO sao
  rotina`、`uma NEGACAO derruba o sinal`）
- **来源：** [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md)，FASE 14d

### RN-087 — Dev Lead 是执行的唯一外部地址 {#rn-087}

存在一个对话型 agent `dev-lead`，它接收 Arquiteto 的 handoff（自 [RN-672](../business-rules.md#rn-672) 起，来自 Infra，项目容器处于 `running`），并提议**执行计划**：每个模块多少个 agent 以及为什么。它不写代码——它分配工作并为之负责。

**在它之前，[RN-083](#rn-083) 中"由 lead 决定"这句话没有主人。** Arquiteto 完成后，执行由一个按钮启动，中间没有人评估有多少工作。

**`dev-<modulo>` 不再能通过 handoff 寻址。** 这不是新的例外：这是 [ADR 0038](../adr/0038-hierarquia-de-agentes.md) 的规则——外部 handoff 只寻址区域的 lead 或没有区域的 agent——开始像对 QA 和 Infra 一样对 dev 生效。在没有 Dev Lead 时，它们是*没有*区域的 agent，因此是有效目标；成为成员后，就不再是了。

**`dev` 区域是第一个*动态*区域**，正是它迫使使用谓词：成员是 `module_map` 的每个模块一个，由 Arquiteto 决定，每个项目都不同，因此没有可枚举的列表。`dev-lead` 与成员匹配相同的 `dev-` 前缀，排除它的是通用规则**lead 永远不是自己区域的成员**——它适用于任何区域，只存在于一处。第一个版本在三处重复这个排除，变异检查表明没有一份副本是测试可达的：每一份都能在另一份被变异时存活。

**计划是 `proposed_action`（由 [ADR 0086](../adr/0086-dev-lead-plano-suspende-para-aprovacao.md)、[RN-284](../business-rules.md#rn-284) 修订）。**
在这次变更之前，计划成为简单的*事件*，没有审批：理由是提议没有外部效果——花费发生在 agent 启动时，上限在那里要求授权；把提议变成待决定的动作会让你对同一件事决定两次。对 `docs/fluxo.yml` × 代码的审计发现，自 ADR 0085 起流程就已经把这个输出声明为 `via: proposed_action`，而代码从未被调整为一致——产品所有者判定是代码错了：计划是会话将在并行上花多少钱的*第一个*真实决定，用户开始在*看到*一次真正的审批之后才决定激活执行，而不只是读到消息流中的一行。旧的教训没有消失——它正是
`propose_execution_plan` *没有*进入 `decide.ts` 绝对上限块的原因（见 RN-284）。

***成功*的计划结束回合——在*没有*暂停的路径上。** 在第一次真实执行中，Dev Lead 在同一会话中登记了**两次** `execution.plan_proposed`——文本不同，总数相同——因为循环回到了模型，它又提议了一次。事件日志是不可变的：留下了两份提议，没有任何东西说明哪个有效。工具 spec 中"只用一次"的指示是请求，不是保证；保证的是循环停止。自 ADR 0086 起，当提议处于 `pending` 时，结束回合的是暂停的*停止*（RN-284）——立即成功（`auto_approved`/`executed`/`approved`，见 RN-284）继续以一贯的方式关闭循环。

**是成功，而不是"调用了工具"**：被拒绝的计划（空的，或某个模块零个 agent）让循环继续，否则拒绝会变成回合结束，模型永远没机会修正。这道防护的第一个版本只看工具名称，就有这个缺陷——是由行为测试发现的，而不是靠阅读。

空计划，或某个模块零个 agent 的计划，**在提议任何东西之前**就被拒绝——提议一旦创建，就是用户的真实决定，而一个提议了一半的计划无从撤回。

- **位置：** `apps/engine/lib/engine/agents/dev_lead_server.ex` 和
  `dev_lead_tools.ex`；寻址规则在
  `apps/api/src/domain/agents/agent-areas.ts`；handoff 在
  `application/use-cases/agents/offer-infra-handoff.use-case.ts`
- **测试：** `apps/engine/test/engine/agents/dev_lead_tools_test.exs`,
  `dev_lead_server_test.exs`（`o plano ENCERRA o turno`、`o plano recusado NÃO
  encerra o turno`），
  `apps/api/test/domain/agents/agent-areas.spec.ts`（`o dev de módulo DEIXOU de
  ser endereçável`、`` `dev-lead` É endereçável, apesar do prefixo ``）和
  `test/application/use-cases/agents/offer-infra-handoff.use-case.spec.ts`
- **来源：** [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md)，FASE 14d；
  审批机制由 [ADR 0086](../adr/0086-dev-lead-plano-suspende-para-aprovacao.md) 修订

### RN-064 — 心跳不会结束有待定工作的会话 {#rn-064}

> **由 [RN-581](../business-rules.md#rn-581)（AT-072）扩展：** 等待用户的对话型 agent 成为*第五个*信号，也是唯一有上限的（8h，原因 `conversation_idle_timeout`）；响应新增了
> `aguardandoUsuarioDesde`。这条规则的其余部分照旧有效。

心跳超时衡量的是**标签页**的不活动，而不是**工作**的不活动。在结束之前，`SessionServer` 询问 api 是否还有剩余工作（`GET /internal/sessions/:id/pending-work`）；如果有，它重新安排超时并在日志中记录原因，而不是杀死会话。

默认值是 **30 秒**。离开会话切换到 Backlog 标签页就足以杀死它——在一次真实执行中，这把一个给 Arquiteto 的 `offered` handoff 困在了一个已关闭的会话中：史诗和四个故事都已就绪，而链条无法继续，因为没有地方可以接受已死会话的 handoff。

关闭会话关乎工作是否结束，而不是谁在看。

**api 宕机*不*会阻止结束**：`{:error, _}` 照样结束，在日志中给出警告。用永生的会话换掉孤儿会话，就是用一个缺陷换另一个。

"待定工作"是**三个**信号——第二个来自发现 V，第三个来自 Criativo→PO→Arquiteto 的真实 bug：

1. **`offered` 的 handoff**——上面的原始情形；
2. **状态为 `pending` 的 `proposed_action`**——有人在等*你的*决定，某个 agent 可能已暂停等待结果（[RN-073](#rn-073)）；
3. **已*激活*且仍在回合中的 agent**——在会话中发过言的每个执行者的最后一个 `agent.status` 是 `working`，之后没有 `idle`。

第二个是第一个的同一缺陷低一个层级，而 `hello-limpo` 的执行显示了代价：会话诞生于 23:34:12，一个动作在 23:34:13 变为 `pending`，心跳在 **23:34:42——恰好是超时的 30s**——关闭了它。dev agent 在一个数据库认为已结束的会话中又工作了一个多小时，这毒害了每一项按会话的指标：时长、成本以及"多少个好好结束了"都开始读取一个不描述实际发生之事的状态。

第三个是同一个窗口，在前两个任何一个存在之前一步：`AcceptHandoffUseCase` 把旧 handoff 标记为 `accepted` 并立即激活下一个 agent，但 engine 中的激活是 `GenServer.cast`，发出即不管——在 agent 甚至开始之前就响应 201。由 Criativo 的 handoff 激活的 PO 运行一个最多 12 次 LLM 迭代的 kickoff，只使用 `category: :direct` 的工具（`create_epic`/`create_story`/`create_task`），它们从不产生 `proposed_action`，并且只在整个回合*结束*时才提供下一个 handoff（信号 1）。在激活与那个结束之间，信号 1 和信号 2 都不存在——只有每 10s 一次的 Phoenix 通道 ping 撑着会话，任何超过 30s 超时的延迟都会在 PO 仍在生成 backlog 时关闭会话，从根上打断 handoff 链：下一个 handoff 最终被提供在一个已经 `closed`、不再接受任何东西的会话中。

`agent.status`（`working`/`idle`）是每个对话型 agent（Criativo/PO/Arquiteto/Dev Lead/Infra）已经在回合边界叙述的东西，并且被*持久化*在事件日志中，而不只是在通道中广播
（`Engine.Sessions.LiveBroadcast.agent_status/4`，[ADR 0021](../adr/0021-fechamento-4a-infra-e-painel.md)）
——团队面板已经读取同一个信号来推导名册（`apps/web/src/lib/agent-status.ts` 中的 `conversationalStatus`）。在这里复用它不需要任何新事件：第三个信号是在会话中发过言的*每个*执行者的最后一个 `agent.status`，并且按事件类型是通用的——它覆盖任何由 handoff 激活的 agent，而不只是 PO。

这条规则的上一个版本白纸黑字地写着，把 agent 的工作包括进来"而没有证明这种交互的测试，就是在猜"。执行产生了证明，测试现在存在了。

**仍然排除在外的：**没有待定动作、没有 handoff、也没有未完回合的 `in_progress` 任务。dev agent 有自己的状态机，自行持有 worktree；api 拥有且执行已证实的信号是待定动作。把任务包括进来需要 api 读取属于 engine 的 `dev_agent_states`——这是边界决定，不是顺手修复。dev agent 也不发出 `agent.status`（它们用自己的状态机运行，而不是对话型的回合循环）——第三个信号不覆盖它们，也不需要：待定动作已经覆盖了它们的路径。

- **位置：** `apps/api/src/application/use-cases/sessions/get-session-pending-work.use-case.ts`,
  `apps/api/src/application/ports/session-event-repository.port.ts`
  （`listByTypeInSession`），`apps/engine/lib/engine/sessions/session_server.ex`
  （`handle_info(:heartbeat_timeout, …)`）
- **测试：** `apps/engine/test/engine/sessions/session_lifecycle_test.exs`
  （`heartbeat NÃO encerra sessão com trabalho pendente` 以及相反的情形）和
  `apps/api/test/application/use-cases/sessions/get-session-pending-work.use-case.spec.ts`
  （三个信号、已经决定因而*不*撑住会话的动作、释放会话的 `idle`、按执行者的隔离、按 agent 类型的通用性以及按会话的范围）
- **来源：** FASE 13b 的真实执行；发现 V，[backlog](../explanation/backlog.md) 的 Fase H；Criativo→PO→Arquiteto 链式衔接的真实 bug

### RN-063 — 不产出而结束是结果，不是失败 {#rn-063}

Anamnese 有一个工具用来说**"没有什么要发出，原因如下"**（`skip_proficiency`）。这一轮以 `anamnese.run_skipped` 结束，原因放在 payload 中——绝不以 `anamnese.run_failed` 结束。

之前它没有这个动词。唯一的工具是 `emit_proficiency`，它拒绝空列表（有道理：空档案不是档案）。在没有合格成员的窗口中，Anamnese 在*第一次*迭代就发现了这一点，用散文写下"没有合格成员"，以 `profiles: []` 调用 `emit_proficiency`，被拒绝——然后重复直到迭代上限。每一圈都会重新发送历史，而历史每圈都在增长。

在一次真实执行中，这花费了 **14.5 万输入 token，是 Criativo 和 PO 花费总和的 4 倍**，什么都没产出。而且它会在调度器的每次 tick 时回来，每 15 分钟一次，永远如此。

迭代上限是有效的——这不是无限循环。浪费是**每一轮的，无限重复**，这更糟：循环会卡住，有人会注意到；这个是慢慢流血。

为一个做了正确事情的轮次叙述 `run_failed` 也是缺陷：读日志的人会学会忽略失败事件。

- **位置：** `apps/engine/lib/engine/anamnese/tools/skip_proficiency.ex`,
  `apps/engine/lib/engine/anamnese/hooks/termination.ex`,
  `apps/engine/lib/engine/workers/anamnese_worker.ex`（`handle_outcome`）
- **测试：** `apps/engine/test/engine/workers/anamnese_worker_test.exs`
  (`encerrar sem perfis é DESFECHO: narra run_skipped com o motivo, não falha`)
- **来源：** FASE 13b 的真实执行

### RN-062 — 发给对话型 agent 的消息会*重新水合*进程 {#rn-062}

发给 Criativo、PO 或 Arquiteto 的消息，如果进程没有在运行，会在投递之前启动它。每个服务器的 `init` 本来就会从事件日志重建历史；缺的是调用它的人。

以前，engine 重启会悄无声息地杀死对话：会话以 `active` 存活下来，agent 的进程却没有，下一条消息以 `GenServer.call ... exited` 死掉——没有事件，界面上没有错误，什么都没有。用户看到自己的消息出现，却永远没有回复到来。

`revise/2` 的注释说，这条路由上的 agent 死掉"是一个 bug"。确实是——而 engine 只要重启就会发生。这是 Fase 12b 给 dev agent 的同一保证，应用于对话型 agent。

- **位置：** `apps/engine/lib/engine_web/controllers/agent_command_controller.ex`
  （`message/2`）
- **测试：** 由 agent 测试套件覆盖；执行证明在
  docs/explanation/validacao-real.md
- **来源：** FASE 13b 的真实执行

### RN-060 — 密钥的花费属于 owner，只有他能看到 {#rn-060}

按凭据的消耗报告（`GET /workspaces/:id/credential-spend`）要求在 workspace 中是 **`owner`**。不是 `maintainer`：自
[RN-058](#rn-058) 起，所有项目的 agent 都消耗所有者的凭据，而他的账单与只是操作某个项目的人无关。

报告按**提供方**分组，因为那是凭据的单位——每人每个提供方一个密钥。单一总数无法与任何账单对上。

并且它把 **agent** 与**人**分开：自 RN-058 起，两者都出自同一个密钥，而"我的 agent 贵吗？"与"我聊天用得多吗？"是不同的问题。这就是为什么这是产品中唯一*没有* [RN-038](#rn-038) 的 `actor_kind = 'agent'` 过滤器的成本汇总——这里的问题是从密钥中流出了多少，而 owner 自己的聊天也从中流出。

**已移除**凭据的花费仍留在报告中，带标记：消耗确实发生了，隐藏它会得到一个与提供方账单对不上的总数。

没有任何秘密穿过：响应包含提供方、token 和成本——绝不包含密钥，即使是加密的也不包含（[ADR 0050](../adr/0050-credencial-sempre-cifrada-verificacao-explicita.md)）。

- **位置：**
  `apps/api/src/application/use-cases/llm/get-credential-spend.use-case.ts`,
  `apps/api/src/interfaces/http/llm/budgets.controller.ts`,
  `apps/web/src/components/CredentialSpendSection.tsx`
- **测试：** `test/application/use-cases/llm/get-credential-spend.use-case.spec.ts`
  （按提供方分组；把 agent 与人分开；已移除的密钥带标记保留）；
  `apps/web/src/components/CredentialSpendSection.test.tsx`
- **来源：** 用户与 RN-058 一同作出的决定

### RN-101 — 同一笔花费，两类受众：账单属于 owner，消耗属于花钱的人 {#rn-101}

产品回答关于 `token_usage` 的**两个不同问题**，没有一个是另一个的切片。

**owner 的问题是按*凭据*的。** `GET /workspaces/:id/credential-spend` 保持 [RN-060](#rn-060) 留下的样子——按提供方，要求 `owner`，回答"从我的密钥里流出了多少"。与它一起，`GET /workspaces/:id/spend-report`（同样是 `owner`）按**模型、提供方、项目、执行者和日期**拆分 workspace——提供方维度由 [RN-186](#rn-186) 引入。owner 能看到两者，因为他是唯一能看到两者的人。

**成员的问题是按*执行者*的。** `GET /projects/:id/spend/me`（角色 `viewer`）以 token 和**估算**成本返回**调用者**在该项目中消耗了什么，按会话和日期。它**不按提供方或凭据拆分**——运行的密钥是 owner 的（[RN-058](#rn-058)），而他账单的一个切片不是成员所问的东西。

执行者**不是参数**：它来自已认证的用户，没有地方可以写入别人的 id。"成员看不到其他执行者的行"是用例签名的性质，而不是某个人可能忘记调用的检查。

**agent 不计入成员的账。** `token_usage` 记录的是谁*花了*钱，而不是谁让花钱；把 agent 归给启动它的人，就是编造一个表中没有的数据。agent 的花费出现在 owner 的报告中，密钥是他的。

**`provider` 维度存在，而成员够不着它。** 在
[ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md) 之前，它在聚合中根本不存在，正是这种缺失约束着成员的视图。如今
`sumGroupedBy` 有六个维度（`model`、`provider`、`project`、`actor`、
`session`、`day`），约束改变的是形式而不是力度：约束它的是*类型*——见 [RN-186](#rn-186) 和 [RN-187](#rn-187)。没有改变的是，提供同一模型名称的两个提供方，在 `model` 维度上仍然落在同一行。

- **位置：**
  `apps/api/src/application/use-cases/llm/get-my-spend.use-case.ts`,
  `apps/api/src/application/use-cases/llm/get-workspace-spend-report.use-case.ts`,
  `apps/api/src/application/ports/token-usage-repository.port.ts`,
  `apps/api/src/interfaces/http/llm/spend.controller.ts`,
  `apps/web/src/routes/ProjectSpendTab.tsx`
- **测试：** `apps/api/test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  （成员看不到其他执行者的行，也看不到 agent 或 owner 的行；过滤按 `(kind, id)` 这一对进行；响应不携带提供方）；
  `apps/web/src/routes/ProjectSpendTab.test.tsx`
- **来源：** [ADR 0063](../adr/0063-duas-audiencias-para-o-mesmo-gasto.md)（FASE 22），
  由 [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md) 修订

### RN-186 — `provider` 是 owner 报告的维度，且只属于它 {#rn-186}

`sumGroupedBy` 接受 `provider` 作为维度，
`GET /workspaces/:id/spend-report` 在模型、项目、执行者和日期旁边返回 `porProvider` 列表。[ADR 0063](../adr/0063-duas-audiencias-para-o-mesmo-gasto.md)
曾把这个维度排除在外；[ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)
把它带了回来，**却没有推翻那个论点**：按提供方拆分花费仍然就是按*凭据*拆分，因此这个维度位于一条已经要求 `owner`（[RN-060](#rn-060)）的路由上——与 `credential-spend` 同一把尺子，后者继续回答*账单*的问题（按月，与今天存在的密钥相关联）。

`GET /projects/:id/spend/me` **什么都没有获得**。不对称正是设计：两个响应仍然不是彼此的切片（[RN-101](#rn-101)）。

`model` 维度**没有改变**：提供同一模型名称的两个提供方仍然在同一行。想要按凭据拆分的人有专门的列表，而交叉两个维度会让排名的行数成倍增加，却回答不了两个单独列表回答不了的问题。

- **位置：** `apps/api/src/application/ports/token-usage-repository.port.ts:137`
  （`SpendDimension`），
  `apps/api/src/infrastructure/persistence/drizzle/token-usage.repository.ts:255`
  （`GROUP BY`），`apps/api/src/application/use-cases/llm/get-workspace-spend-report.use-case.ts:112`,
  `apps/api/src/interfaces/http/llm/spend.controller.ts:56`
- **测试：** `apps/api/test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  （"quebra por PROVIDER, e o mesmo nome de modelo em dois providers segue UMA
  linha"）
- **来源：** [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-187 — 成员视图够不着 `provider`，保证它的是*类型* {#rn-187}

在这个维度不存在时，约束成员视图的是没有可传的参数这一**缺失**。维度回来之后，约束改由签名承担：`sumGroupedBy` 有**两个重载**，接受带 `actor` 的范围的那个——成员受众的范围，也是成员唯一拥有的——只接收
`SpendDimensionDoAtor`，即 `Exclude<SpendDimension, 'provider'>`。
`sumGroupedBy('provider', escopoComAtor)` **无法编译**。

仓储和用例都刻意没有针对这种组合的 `if`：运行时检查会给人一种保证是动态的印象，而支撑它的其实是编译器——而 `if` 正是下一次重构会在没有任何测试变红的情况下删掉的东西。

屏障是双重的，两半彼此独立：成员的路由**也没有维度参数**（只有 `projectId` 和 `dias`），因此像 `?dimensao=provider` 这样编造的查询在到达 handler 之前就被 Nest 丢弃。

用 `Exclude` 而不是第二个手写列表是刻意的：新维度诞生时两类受众都能触及，而把它移出成员的触及范围，会成为*在这一处*的显式行为——绝不是另一个文件中的遗忘。

- **位置：** `apps/api/src/application/ports/token-usage-repository.port.ts:121`
  （两个重载），`:147`（`SpendDimensionDoAtor`），`:163`/`:173`（两个范围），`apps/api/src/application/use-cases/llm/get-my-spend.use-case.ts:73`,
  `apps/api/src/interfaces/http/llm/spend.controller.ts:98`
- **测试：** `apps/api/test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  （"não compila pedir `provider` com escopo de ator"——一个 `@ts-expect-error`，如果屏障倒下，`tsc` 会把它作为*未使用*的指令拒绝；以及 "só pede as
  dimensões `session` e `day`"），
  `apps/api/test/interfaces/spend.controller.spec.ts`（成员的路由只接受 `dias`，别无其他）
- **来源：** [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-188 — 人与 agent 是按执行者列表的划分，不多做查询 {#rn-188}

owner 的报告除了保持完整的 `porAtor` 之外，还带有 `porOwner`（`actor_kind = 'user'` 的行）和
`porAgente`（`actor_kind = 'agent'`）。这两块在用例中由 `porAtor` **推导**——`actorKind` 自 FASE 22 起就已经在行中——，而不是两次带 `where actor_kind` 的查询。原因是测量过的：[ADR 0063](../adr/0063-duas-audiencias-para-o-mesmo-gasto.md)
表明这些查询的成本随 `token_usage` 的大小而不是请求的大小增长，因此为了分开已经在内存中分开的东西而多扫描两次窗口，会因为错误的原因而昂贵。

既不是人也不是 agent 的 `actor_kind`（目前是 `system`）**不进入任何一块**，并在 `porAtor` 和总数中保持可见。为它开第三块，就等于说产品有一类它并没有的受众。

"按 owner"这个标签来自设计 handoff，依据 [RN-058](#rn-058) 成立——所有这些行花的都是 owner 的密钥。workspace 的所有者是谁，仍然由 `ownerId` 字段决定，而不是每行的 `actorKind`。

- **位置：** `apps/api/src/application/use-cases/llm/get-workspace-spend-report.use-case.ts:120`
- **测试：** `apps/api/test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  （"separa PESSOA de AGENTE em dois blocos, sem perder a lista por ator"）
- **来源：** [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-102 — 区域的模型是可继承的默认值；偏离是 agent 的决定，恢复继承会抹去该决定 {#rn-102}

binding 级联增加了一层：`sessão > agente > **área** > projeto >
workspace`。`area` 位于 agent 和项目*之间*——它是一个区域的 lead 和子 agent 共享的*默认值*（`qa`/`qa-automacao`/
`qa-performance-seguranca`、`infra`/`infra-workflows`、`dev`/`dev-<módulo>`），而 agent 自己的 binding 是覆盖它的*偏离*。如果区域位于 agent *之上*，它总会胜出，"可继承的默认值"实际上就成了"强加的默认值"——没有任何 agent 能选择别的模型。

新的层级进入与 [RN-041](#rn-041)/[RN-043](#rn-043) *相同*的能力重新校验：从提供方消失或不做 tool calling 的区域模型会被*跳过*并记录在 `skipped` 中，与 `agent` 原来一样。`assertModelFitsBindingScope`（RN-040）开始在 `area` 范围也要求 `supports_tool_calling`——它从不被人工聊天读取，只被 agent 读取，因此放它通过只会把同样的无声失败推迟一个层级。

**"恢复继承"会删除 binding，从不把下层的模型复制到上层。** 把区域决定的模型写入 agent，在界面上看起来一样，但并不一样：它会成为一份*副本*，区域的下一次变更会在无人察觉的情况下把这个 agent 甩在后面。继承是*没有*自己的决定，撤销偏离就是删除那一行——`DELETE
/projects/:id/agent-bindings/:slug` 和 `DELETE
/projects/:id/area-bindings/:key`，都是 204，当范围已经在继承时都是 404（如果是静默的 204，幂等性就会*撒谎*：删除不存在的东西和真正删除，对同一界面来说是不同的回答）。

更改*区域*的模型要求 `maintainer`，而不是像单个 agent 那样的 `developer`——理由与并行上限相同（[RN-083](#rn-083)）：区域的 binding 一次触及 lead 和*所有*子 agent，而选择模型就是决定产品不询问就花多少钱。

***界面*开始遵守*两个*最低要求，而且确实是两个。** 在此之前，
`ModelsSection`——按 agent 的模型表——不检查任何角色：现行模型列的 `ModelPicker` 和来源列的"恢复继承"对所有人都显示为可点击，包括 `viewer`，而 api 以 403 拒绝。出路*不*是复制姊妹部分的闸门（`owner || maintainer`）：那会把缺陷换成*相反*的缺陷，把一个 `developer` 锁在 `PUT`/`DELETE .../agent-bindings/:slug` 接受的操作之外——而相反的缺陷更糟，因为提供会被拒绝的东西至少会以一个 toast 告终，而失去能力对失去它的人是不可见的。最低要求属于*端点*，而不是部分，这两个部分在*同一*界面上相邻，最低要求却不同。比较从界面中移出，成为 `roleAtLeast`（`apps/web/src/lib/roles.ts`），基于已经存在的 `ROLE_ORDER`——与后端函数同名，因为这是线路两侧的同一条规则；手写层级（`role === 'owner' || role === 'maintainer'`）在最低要求高时碰巧正确，在低时悄无声息地出错。*缺失*的角色（查询进行中，或失败了）什么也够不着：向禁用的一侧犯错，重新加载就能修复。

**消失的是*控件*，绝不是*信息***（ADR 0064）。不能编辑的人仍然在触发器中看到现行模型以及完整的来源链（[RN-470](#rn-470)），"恢复继承"仍留在该行中，处于非活动状态——正是它*说明*那个 agent 发生了偏离，隐藏它会抹去一个可以读取却不能更改的状态。它们变灰的原因在该部分的说明文字中以文字说*一次*，而不是在每一行用 `title` 说明：在 Chromium 中，`disabled` 元素上的 tooltip 不会打开（浏览器不在禁用控件上派发鼠标事件），一个不会出现的解释就是多了些代码的同一种缺失。

**这些都不是安全边界，限制是声明过的。** 拒绝的仍然是 `RolesGuard`。界面读取的角色是 *WORKSPACE* 的（`useCurrentWorkspaceWithRole`），而另一侧授权的是*项目*的有效角色（`ResolveEffectiveRoleUseCase.forProject`），`project_members` 中的一行会在两个方向上*覆盖*它——因此在项目中拥有自己角色的人，可能在这里看到一个 api 本会接受的禁用控件。关闭这一点需要一个 web 还没有的*按项目*角色查询，这与 `ModelsSection` 已经带着的缺口相同；只在一个部分中发明第二个角色来源，会比这个缺口更糟。

> **附加说明（[RN-471](../business-rules.md#rn-471)）：** 上一段的缺口是*一个*，而不是每个部分一个，在界面*已经*按项目查询角色的地方，它被关闭而不是被声明。**成员**部分获取
> `listProjectMembers`，它一次性为所有人执行 `findMemberRole`，并组合出 `projectRole ?? workspaceRole`——正是 `forProject` 所做的。这不是本段所拒绝的第二个角色来源：而是*同一*组合，来自该部分手头已有的数据。两个模型部分因为没有这些数据，继续使用近似。阅读上面的"在两个方向上*覆盖*"时要小心：它是字面意思，而有三处 OpenAPI 描述声称相反——见 RN-471。

- **位置：** `apps/api/src/domain/llm/binding-resolver.ts`（优先级），
  `apps/api/src/domain/llm/model-capabilities.ts`（`area` 的能力），
  `apps/api/src/application/use-cases/llm/resolve-model-binding.use-case.ts`
  （agent 的区域来自 `agent-areas.ts` 目录，无需往返数据库），`apps/api/src/application/use-cases/llm/clear-model-binding.use-case.ts`,
  `apps/api/src/interfaces/http/llm/model-bindings.controller.ts`
  （`area-bindings`，`agent-bindings` 和 `area-bindings` 上的 `DELETE`），
  `apps/web/src/routes/settings/ModelsSection.tsx`（带"恢复继承"的来源列，以及基于 `roleAtLeast` 重写、最低要求不变的 `maintainer` 闸门），
  `apps/api/src/interfaces/http/llm/model-bindings.controller.ts:273` 和 `:301`
  （两个 agent 端点上的 `developer`——这些行*没有*改变），
  `apps/web/src/lib/roles.ts:49`（`roleAtLeast`——缺失的比较），
  `apps/web/src/routes/settings/ModelsSection.tsx:89`（`podeEditar`，以及为什么是
  `developer` 而不是 `maintainer`），`:379`（禁用的选择器），`:446`（禁用的按钮，以及为什么原因不放在 `title` 中），`:546`（说明原因的说明文字）
- **测试：** `test/domain/llm/binding-resolver.spec.ts`,
  `test/domain/llm/model-capabilities.spec.ts`,
  `test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`,
  `test/application/use-cases/llm/clear-model-binding.use-case.spec.ts`,
  `apps/web/src/routes/ProjectSettingsTab.test.tsx`,
  `apps/web/src/routes/settings/papel-na-tabela-de-agentes.test.tsx`
  （`viewer` 不能编辑，点击不会到达 api；`developer` 能编辑，PUT/DELETE 会到达；缺失的角色是非活动的；行中的信息在控件变灰后保留；以及阻止"统一"两个部分的情形——同一个
  `developer` 同时看到 agent 表启用而区域表禁用）
- **来源：** [ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md)（FASE 23）

### RN-103 — agent 的 binding 是*按项目*的，不再是全局的 {#rn-103}

在 FASE 23 之前，`scope = 'agent'` 保存一个全局 SLUG（`scope_id = 'qa'`），而 `PUT /projects/:id/agent-bindings/:slug` 在路由中接收 `:projectId` 却刻意*丢弃*它——在一个项目的界面上选择 Arquiteto 的模型，会改变它在*所有*项目中的模型。当区域成为可继承的默认值（RN-102）之后，这站不住了：区域是按项目的，而一个位于按项目默认值*之上*的全局 agent binding，会让同一个 agent 只在存在区域的地方解析出不同的模型——并且会让"恢复继承"抹去一个波及无人关注的项目的决定。

出路是让 `agent` 也按项目，而不是把区域降到 agent 之下：`agent` 和 `area` 的 `scope_id` 变成*复合*的——`<projectId>:<agent 的 slug|区域的键>`——而不是为每个 binding 保存一个项目而发明一张新表。项目 UUID 和 agent slug 从不包含 `:`，这让第一个 `:` 成为无歧义的分隔符；读取在第一个处切分，而不是在所有处，这样带 `:` 的 slug（目前一个都没有，但没有什么阻止它）不会变成三段。

没有项目的 `scope_id`（旧格式）在写入时被*拒绝*，而不是被接受后忽略：写入它会创建一个级联再也找不到的 binding——不可见，而不是一个错误。迁移 0040 把每个现有的全局 agent binding 展开为每个项目一行（保留每个项目在变更之前解析的结果），并删除旧格式；之所以是*展开*而不是删除，是因为全局行从未保存它"属于"谁的信息——编造一个所有者项目就是编造原本不存在的数据。

- **位置：** `apps/api/src/domain/llm/binding-scope-id.ts`（格式和校验），`apps/api/src/application/use-cases/llm/set-model-binding.use-case.ts`
  （`workspaceDoEscopo` 也开始从 `agent`/`area` 推导 workspace——在此之前 RN-043 的策展在它们上无法核对），`apps/api/src/db/migrations/0040_tearful_night_nurse.sql`
- **测试：** `test/domain/llm/binding-scope-id.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`,
  `test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`
  （"o binding de agente é POR PROJETO: o vizinho não o enxerga"）
- **来源：** [ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md)（FASE 23）

### RN-470 — 模型来源区分自有 binding 与从 Criativo 继承，级联中的空值不与其他空值共用同一符号 {#rn-470}

api 响应中的 `origin: 'agent'` 意味着**两件不同的事**，而 api 不区分它们是正确的：agent 在 `model_bindings` 中有一行 `agent` 范围的记录，**或者**级联落在 `workspace` 上而
[`herdarModeloDeStart`](#rn-102) 把值换成了 Criativo 的模型——读"来自哪里"的人需要看到它来自一个 *AGENT*，而不是来自一个数据库中不存在的范围。必须区分它们的是**界面**，而在此之前它没有区分：来源列打印原始枚举，在一个数据库中有 3 行 `agent` 的项目里，12 个 agent 都显示同一个词 `agent`。

**来源是一条*链*，而不是一个词。** `workspace › projeto › área ›
agente`，每个节点四种状态，四种都存在是因为它们说的是不同的事：**现行**（使用中的模型从这里来——唯一以 `Badge` 显示的节点）、**已定义**（这一层有自己的值，但一个更具体的层胜出了）、**空**（这里没有值）和**被跳过**（有值，但级联因 `unavailable`/`sem_tool_calling` 丢弃了它，[RN-043](#rn-043)）。把"已定义"折叠成"空"会把原始枚举的问题带回低一层。

**在继承中，`agente` 节点保持为*空*，一个额外节点点名 Criativo。** 级联到达的层级（`workspace`）显示为"已定义"，而**不是**现行：workspace 的模型不是生效的那个，把它标为现行就是断言了错误的模型。Criativo 的节点是唯一一个不是数据库范围的节点，这是刻意的——它点名的是级联之后的那一步。同一条链也适用于*区域*部分，在那里 `origin: 'agent'` **只能**是这一步：区域查询不会把 agent 范围放进级联。

**推导属于*客户端*，它无法证明的东西仍然可以操作。** 没有新端点：界面已经获取了四个层级。当工作区之上没有任何层级有*可用*的值（被跳过的不会阻止下降）并且模型与解析出的 Criativo 模型相同时，`agent` 就是继承。剩下一个无法区分的情形：agent 有自己的行，指向与 Criativo 相同的模型，且没有区域或项目默认值。这就是为什么"恢复继承"在每个 `agent` 来源上都继续显示——动作恰恰在链无法证明的情形中保持可用，而在那种情形下它仍然会改变未来（没有这一行，agent 开始跟随 Criativo）。

**这个选择的另一半：404 有自己的结果。** 在每个 `agent` 来源上保留按钮，意味着*也*在没有行可删的地方提供它——在那里 `ClearModelBindingUseCase` 正确地响应 **404**（"删除了不存在的东西"和"删除了"不是同一个回答；把它们折叠起来会隐藏一个错误的 `agentSlug`）。然而对点击的人来说，这个 404 不是失败：所请求的状态——agent 在继承——**已经是事实**，把它称为错误就是界面与它所知道的东西相矛盾。因此它不像其他拒绝那样经过 `mensagemDaApi`，有两个原因：api 的句子是硬编码在代码中的 pt-BR，而 web 的默认语言是 `en`；并且这个端点只有**一个** 404 原因（角色不足是 `RolesGuard` 中的 403，格式错误的 `scope_id` 不是 404）——客户端*知道*这个 404 意味着什么，可以用读者的语言说出来。任何其他状态仍然是真正的失败，带 api 的句子和 `danger` 色调。在**两种**结果中都会重新读取该行：如果 api 说本来就没有 binding，过时的是界面。

**而自己的结果属于*端点*，而不是界面。** 同一行的另一个动作——通过现行模型列的 `ModelPicker` 更换模型——有七条拒绝路径，**没有任何一个状态能单独识别其中之一**（`SetModelBindingUseCase`）：格式错误的 `scope_id` 或 DTO 拒绝的 `modelId` 是 400，低于 `developer` 的角色是 403，**两个无法区分的原因是 404**（"Modelo não encontrado" 和 "Projeto não encontrado"），三个原因是 422（[RN-040](#rn-040) 没有 tool calling；[RN-043](#rn-043) 在 workspace 中被停用或从提供方消失）。在那里客户端*不能*点名 404——选择两句中的一句，就是界面断言它不知道的东西——因此每次拒绝都遵循正常语法，带 api 的句子和 `danger` 色调。这两个函数相邻，刻意以相反的方式处理同一个状态：授权自己结果的是*唯一*的原因，而不是界面。

**在拒绝时，现行模型列继续显示已确认的 binding。** `ModelPicker` 不在本地状态中保存选择（`selected` 来自 `selectedModelId` prop，它来自查询），因此拒绝不会在界面上留下 api 拒绝写入的模型——而该行只在成功时重新读取，因为拒绝时数据库中什么都没变。这是把这条 RN 的同一纪律应用于时间：界面不断言一个不存在的状态，不靠短横线，不靠枚举，也不靠乐观。

**空值有自己的文本，不同的空值有不同的文本。** 界面上的三个 `—` 用同一个符号说三件事，现在各说各的：`sem modelo em nenhum nível`（没有任何层级为该 agent 设置 binding）、`sem gasto ainda`（agent 没有记录消耗——不同于 `US$ 0,00`，那是免费运行过）以及 `sem padrão em nenhum nível`（区域及其上面的两层都为空）。与
[RN-180](autenticacao.md#rn-180) 同一纪律：界面不用一条短横线断言它无法点名的东西。

- **位置：** `apps/web/src/routes/settings/cascata.tsx:119`（`montarCadeia`——四种状态和 Criativo 的节点），`:178`（`herdouDoCriativo`——推导及其限制），`:287`（`CadeiaDeCascata`），
  `apps/web/src/routes/settings/ModelsSection.tsx:149`（`cadeiaDoAgente`），
  `:329`（`handleModelChange`——为什么这里的 404 *没有*自己的结果，以及为什么该行只在成功时重新读取），`:385`（`handleClearAgentBinding`——三种结果，以及为什么 404 有它自己的），`:359`（来源列），`:429`
  （`não há nível abaixo`），`:448`（`sem gasto ainda`），
  `apps/web/src/components/ModelPicker.tsx:95`（`selected` 来自 prop——选择器不保存选择，这就是拒绝不会在界面上留下幽灵值的原因），
  `apps/api/src/application/use-cases/llm/set-model-binding.use-case.ts:38`
  （这个端点的两个 404 原因——这个文件*没有*改变），
  `apps/api/src/interfaces/http/shared/llm-binding-error.filter.ts:39`
  （策展拒绝的 400/422——这个文件*没有*改变），
  `apps/web/src/routes/settings/ModelsSection.tsx`（区域的链），
  `apps/api/src/application/use-cases/llm/clear-model-binding.use-case.ts:25`
  （api 抛出的 404——这个文件*没有*改变），
  `apps/api/src/domain/llm/binding-resolver.ts:140`（api 返回的 `origin: 'agent'`，以及解释它为何正确的注释——这个文件*没有*改变）
- **测试：** `apps/web/src/routes/settings/cascata.test.tsx`（自有 binding 结束于 `agente` 节点；继承让 `agente` 为空并点名 Criativo；workspace 在继承中从不显示为现行；区域部分同样；区分在 `en` 下保留；被丢弃的层级成为划线节点，竞争的徽章消失；三种空值三段文本；作为纯函数的 `montarCadeia` 和
  `herdouDoCriativo`，包括被*丢弃*的区域默认值不会阻止下降的情形），
  `apps/web/src/routes/settings/voltar-a-herdar.test.tsx`（点击的三种结果：删除并重新读取；404 不是错误，即使在 `en` 下也不转达 api 的 pt-BR 句子，并重新读取，因为过时的是界面；其他状态走 `mensagemDaApi` 且不重新读取），
  `apps/web/src/routes/settings/troca-de-modelo.test.tsx`（同一行的另一个动作：写入并重新读取；`unavailable` 模型的 422——可达的情形，因为选择器会显示带标记的不可用模型——走 `mensagemDaApi` 且不重新读取；现行模型列保持在旧模型上，绝不显示被拒绝的；而 404 *没有*自己的结果，这是与姊妹函数的对照）
- **来源：** 产品所有者的设计评审（UI 改进画布的第 9 项——"cascata de modelo como cadeia visível"）

### RN-059 — 回合失败是带来源的持久事件，而且 agent 会说话 {#rn-059}

当 LLM 回合失败时，agent 在事件日志中写入 **`agent.error`**，带三个字段：`origem`（ADR 0020 的词汇）、葡萄牙语的 `mensagem` 以及原始的 `reason`。并且消息出现在**对话的消息流中**，而不只是在日志中。

过去正好相反，结果是最坏的：四个对话型 agent 写入内容为**空**的 `agent.response`——在不可变日志中与成功无法区分——并通过短暂的 `broadcast` 发送原因。那一秒没有打开标签页的人永远不会知道发生了错误；打开的人则看到一个空白气泡。

还有第二条路径，更糟：当 api 在它*自己*的最后一帧中叙述失败（预算、缺少凭据、缺少 binding）时，回合不会落入错误分支，**根本不发出任何事件**——绝对的沉默。

这个分支一旦被修正，又付出了第二轮代价：在 PO、Arquiteto 和 Dev Lead 中，它返回 `{state, ""}`——一个*元组*，而 `run_turn` 的其他所有分支都返回 `state`（一个 map）。`TurnoAssincrono.tratar_resultado/2` 中的 `Map.put/3` 在 `handle_info` 中抛出 `BadMapError`，由于四个对话型 agent 都是 `restart: :temporary`，agent 会*死掉*且不再回来。失败不再是无声的，却变成了崩溃——而触发条件是最常见的那些。规则完整适用：agent 叙述失败**并保持运行**。因此 `tratar_resultado/2` 在四者共享的位置有第二道屏障：不是 map 的回合结果会成为来源为 `codigo` 的 `agent.error`，绝不会成为一个死掉的进程。

来源*绝不*靠猜：`FalhaDeTurno.origem/1` 中的每个模式都有书面的理由，不匹配任何模式的以 **`codigo`** 输出——缺口属于我们的分类器，而这是指向正确行动的来源（ADR 0020）。

已经写入的事件不会被删除——界面把它们*点名*为这条规则之前的空响应，而不是显示空白。

- **位置：** `apps/engine/lib/engine/agents/falha_de_turno.ex`,
  `criativo_server.ex`, `po_server.ex`, `arquiteto_server.ex`,
  `dev_lead_server.ex`, `infra_lead_server.ex`（`emit_falha/2`），
  `turno_assincrono.ex`（`tratar_resultado/2`，第二道屏障），
  `apps/web/src/lib/session-falha.ts`
- **测试：** `apps/engine/test/engine/agents/criativo_server_test.exs`
  （带来源的持久事件；从不写入空响应；在最后一帧中叙述的错误也会成为事件）；`po_server_test.exs`（带错误的最后一帧不会让 agent 倒下——*真正*的 GenServer，使用 `Process.alive?/1`）；
  `arquiteto_server_test.exs` 和 `dev_lead_server_test.exs`（同一路径，完整周期）；`turno_assincrono_test.exs`（第二道屏障叙述而不是崩溃）；`apps/web/src/lib/session-falha.test.ts`
- **来源：** FASE 13b 的真实执行

### RN-116 — *创建* handoff 失败不会让 agent 倒下 {#rn-116}

`confirm_readiness`（Criativo → PO）和 `offer_infra_handoff`（Arquiteto → Infra；
`offer_dev_handoff`，即 Arquiteto → Dev Lead，已在
[RN-672](../business-rules.md#rn-672) 中移除，而 Infra 提供的给 Dev Lead 的 handoff 遵循同一把尺子）在回合已经运行*之后*调用 api 创建 handoff——在 Criativo 的情形中，是在 `product_brief` 已经写入事件日志之后。如果这次调用失败（api 宕机、5xx 等），handoff 不存在，但这*绝不*会让 agent 的 GenServer 倒下：失败成为持久的 `agent.error`，带 `origem`（`FalhaDeTurno.origem/1`），以及一条说明*已经*保存了什么（product_brief、规则）、什么没有保存（handoff）的消息——让用户知道再次确认是安全的，不会重复工作。

过去正好相反：三个调用都使用 `{:ok, _handoff} = EngineApiClient.create_handoff(...)`
——一个严格匹配。`{:error, _}` 变成 `MatchError`，而由于三个 agent 都以 `restart: :temporary` 在 `:one_for_one` 的 `DynamicSupervisor` 中启动，进程就这么*消失*了——没有 `agent.error`，消息流中没有回复，只有沉默。从观察者的角度看：信息（规则、product brief）似乎已经"通过"（已写入），但下一个 agent 那边什么都没开始，因为 handoff 从未存在过。重新打开对话本身不能解决问题——只有*新*消息会重新激活进程（从事件日志重新水合），只有新的就绪确认会再次尝试 handoff。

消息*不*复用 `FalhaDeTurno.mensagem/1`（`RN-059` 的那句"não consegui
completar este turno... nada foi gasto"）：在三个调用点上，工作都已经运行过（或者在 `offer_dev_handoff` 的情形中根本不需要运行）——当整合回合中已经花费了 token 时，说"什么都没花"是假的。只复用 `FalhaDeTurno.origem/1`，它按原因的*形式*（HTTP 状态、传输异常）分类，而不是按是否是 LLM 回合。

`Engine.Harness.Tools.OfferHandoff`（PO 通过 ToolLoop 中的工具调用使用的工具）本来就会在不崩溃的情况下处理 `{:error, reason}`——缺陷只存在于这三个服务器驱动的 handler 中，它们*直接*调用 `EngineApiClient.create_handoff/5`，而不是经过工具。

- **位置：** `apps/engine/lib/engine/agents/criativo_server.ex`
  （`handle_call(:confirm_readiness, ...)`、`emit_falha_handoff/3`），
  `apps/engine/lib/engine/agents/arquiteto_server.ex`
  （`handle_call(:offer_infra_handoff, ...)`、`emit_falha_handoff/3`）；
  `apps/engine/lib/engine/infra/infra_lead_server.ex`
  （`emit_falha_do_handoff_ao_dev_lead/2`，RN-672）
- **测试：** `apps/engine/test/engine/agents/criativo_server_test.exs`
  （"prontidão: falha ao criar o handoff NÃO derruba o processo, e vira
  agent.error durável"）；`apps/engine/test/engine/agents/arquiteto_server_test.exs`
  （`offer_infra_handoff`，成功和失败）；
  `apps/engine/test/engine/infra/infra_lead_server_test.exs`（Infra 提供的给 Dev Lead 的 handoff，被 500 拒绝）
- **来源：** `exp-001` 项目（Criativo → PO）中的真实使用报告；同样的结构性失败通过阅读代码在 Arquiteto 的两个 handoff 中被发现，没有为它们单独复现

### RN-058 — *AGENT* 花费的密钥是 workspace owner 的 {#rn-058}

LLM 凭据属于一个人（`user_credentials.user_id`），而 agent 不是人。agent 的回合按 **workspace owner**（`workspaces.created_by`）解析密钥，而不是按打开会话的人，也不是按创建项目的人：付账的人为 agent 买单，当团队中的另一个人开始会话时，这一点不变。

用 `created_by` 而不是 `workspace_members.role = 'owner'`：可能有多个 owner，"其中任意一个"会让使用的密钥在无人决定的情况下变化。

在此之前，回合在用户列中传入的是 **agent 的 slug**（`agentId ?? sessionId`）。查询以 `user_id = 'criativo'` 到达数据库，Postgres 拒绝了无效的 UUID，错误在消息流中变成**空响应**——没有指标，没有失败事件，界面上什么都没有。只有一次真实执行才揭示的实际效果是：**从来没有任何 agent 使用过带凭据的提供方**。只有 `ollama` 能工作，因为对它会跳过查找——而 Fase 4、Fase 10 的 dogfooding 以及所有演示都是用本地模型运行的。

人工聊天从未有过这个缺陷：它使用 `actor.id`，那是真正的用户。

- **位置：**
  `apps/api/src/application/use-cases/llm/resolve-credential-owner.use-case.ts`,
  `apps/api/src/application/use-cases/llm/stream-llm-turn.use-case.ts`,
  `apps/api/src/application/use-cases/llm/run-llm-turn.use-case.ts`
- **测试：** `test/application/use-cases/llm/resolve-credential-owner.use-case.spec.ts`
  （owner 胜过创建项目的人；找到的密钥是他的；不存在的项目是 404 而不是数据库错误）
- **来源：** FASE 13b 的真实执行

### RN-056 — 能力的分面来自提供方；沉默保留原有的值 {#rn-056}

`supports_vision`、`supports_reasoning` 和 `generates_image` 是**提供方的事实**，而不是意见：它们在同步时来自远程目录，回退与 `supports_tool_calling` 相同——远程，然后本地，然后 `false`。

在 OpenRouter（目前唯一公布这些的）中，三者来自：
`architecture.input_modalities` 包含 `image`，
`supported_parameters` 包含 `reasoning`，以及
`architecture.output_modalities` 包含 `image`。接受图像和**生成**图像是不同的维度：把它们合并会把用户送到错误的模型。

以前，同步从已*写入*的数据读取 `supportsVision`，从不查询远程——该列以 `false` 诞生，没有途径变为 true。第一次真实同步的 338 个模型全部为 `false`，包括提供方声明为多模态的 181 个。

**没有声明不等于声明没有**
（[ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)）：当提供方沉默时，解析器*省略*该字段，`undefined` 保留本地值。因此界面只把分面用作*正向*过滤器，从不写"不能读图"——这里的 `false` 意味着"提供方没有声明"。

- **位置：** `apps/api/src/infrastructure/llm/openrouter-provider.ts`
  （`temModalidade`、`parseCatalogoOpenRouter`），
  `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts`,
  `apps/api/src/db/schema/llm.ts`（`models`）
- **测试：**
  `test/infrastructure/llm/openrouter-provider.contract.spec.ts`
  （`modalidade não declarada OMITE o campo em vez de afirmar false`）；
  `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`
  （`catálogo que se cala sobre modalidade preserva a faceta gravada`）
- **来源：** [ADR 0051](../adr/0051-facetas-de-capability-e-curadoria-por-uso.md)

### RN-057 — "用途"是 workspace 的策展，标记用途不会打开模型 {#rn-057}

没有任何提供方的目录公布"适合写代码"。这是**操作者的意见**，在使用中发现——因此它位于 `workspace_models.uses`，与 workspace 的另一个决定（[RN-052](#rn-052)）并列，而不是在 `models` 中。

*封闭*的词汇——`codigo`、`documentacao`、`analise`、`imagem`、
`conversa`——，两侧都有编译期的穷尽性证明。自由文本会在一周内让 `code`、`coding` 和 `código` 出现在同一个过滤器中。

保持维度分离的两条规则：

1. **标记用途不会打开模型。** `workspace_models.is_active` 的 DEFAULT 是
   `true`，因此由用途标记创建的行以显式的 `is_active = false` 插入。没有这一点，对模型发表意见就会授权它花钱，违反 [RN-043](#rn-043)。
2. **更换用途不会关闭已经打开的。** `is_active` 不在 `ON CONFLICT` 的 `SET` 之中。

用途列表**替换**之前的，而不是相加：空列表就是全部取消标记的方式，并且是一个正当的状态——"没有人发表意见"不等于"没用"。

- **位置：** `apps/api/src/domain/llm/model-uses.ts`,
  `apps/api/src/db/schema/llm.ts`（`workspace_models.uses`），
  `apps/api/src/infrastructure/persistence/drizzle/workspace-model.repository.ts`
  （`setUses`），
  `apps/api/src/application/use-cases/llm/set-model-uses.use-case.ts`
- **测试：** `test/application/use-cases/llm/set-model-uses.use-case.spec.ts`
  （`marcar uso NÃO liga o modelo — a linha nova nasce inativa`、
  `trocar o uso não desliga o que já estava ligado`、
  `o uso vale só neste workspace`）
- **来源：** [ADR 0051](../adr/0051-facetas-de-capability-e-curadoria-por-uso.md)

### RN-038 — workspace 摘要中计数的 agent = 本月花费了 token {#rn-038}

项目仪表板的摘要（"N 个活跃项目 · M 个 agent · 本月花费"）把在当月 `token_usage` 中至少有一行 `actor_kind = 'agent'` 的执行者计为"agent"，汇总 workspace 的所有项目。没有 `actor_kind` 过滤器，发送聊天的 `user` 或记录使用的 `system` 会让计数膨胀——`token_usage` 为任何类型的执行者记录，而不只是 agent。按月截断使用
`created_at >= date_trunc('month', now())`；只在上个月工作过的 agent 不计入，即使它仍出现在某个会话的名册中。计数自然包括 Fase 8 的区域子专业（`qa-automacao`、`qa-performance-seguranca`、`infra-workflows`）：每个在花费 token 时都有自己的 `actor_id`。

- **位置：** `apps/api/src/infrastructure/persistence/drizzle/token-usage.repository.ts`
  （`summarizeForWorkspaceThisMonth`）
- **测试：** `test/application/use-cases/iam/get-workspace-summary.use-case.spec.ts`

---

### RN-703 — 没有模型的子 agent 继承区域 lead 解析出的模型 {#rn-703}

"应用到所有 agent"（RN-476）为设置目录中的每个 agent 写入一个 binding——17 行——，而 engine 在这个列表之外运行的子 agent 在任何层级都没有模型：`appsec` 以来源 `infra` 的 `agent.error`（"Nenhum modelo vinculado para esta sessão"）告终，对除 `dev-backend`/`dev-frontend` 之外的每个 `dev-<modulo>` 以及 `qa-estrategia` 也是如此。当*子 agent* 的级联找不到值（或者只找到没有人为项目选择的 workspace 全局默认值）时，它使用其区域 lead 的*已解析* binding：目录（`agent-areas.ts`）中区域的 lead，或者——对于 `appsec` → `secops` 和 `qa-estrategia` → `qa`，它们由 engine 在 lead 内部运行但不接收 handoff——旁边的一张表，只服务于这种继承。响应带有指明 lead 的 `herdadoDoLead`，`origin` 仍然是 lead 的 binding 的来源（RN-470：界面不断言自有配置）。tool calling 过滤器（RN-040）在 lead 的解析中与子 agent 的解析中同样适用。如果仍然没有模型，失败消息会说明在哪里配置。

- **位置：** `apps/api/src/application/use-cases/llm/resolve-model-binding.use-case.ts:76`
  (`leadDoSubagente`); `apps/api/src/domain/agents/agent-areas.ts:123` (`leadDoSubagente`);
  `apps/api/src/domain/llm/binding-resolver.ts:66` (`MENSAGEM_SEM_MODELO`)
- **测试：** `apps/api/test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`
  （`appsec` 继承自 `secops`，`dev-api` 继承自 `dev-lead`；lead 也没有模型时仍为 `null`——失败用例）
- **来源：** AT-367

---

### RN-774 — 每个模块的第一个任务拥有两倍的单任务上限 {#rn-774}

模块的第一个任务搭建整个骨架（清单、应用、数据库、测试），比后续任务花费更多：在 10月8日的 TP-01 中，它使用 Haiku 4.5 花费了 US$ 0.53，被 US$ 0.50 的固定上限（`taskBudgetMicros: 500000`）阻塞。根据所有者的决定（10月9日），它获得**2 倍的单任务上限**（默认为 US$ 1.00）；其余任务沿用配置的上限。倍数是 engine 中的命名常量，而不是配置。

"第一个"由日志衡量，绝不由任务状态衡量：它是其 `backlog.task_claimed` 在项目中针对该模块*最早*的任务。阻塞会清空 `assigned_to`，重启 engine 会丢失进程的记忆；日志不变，因此同一任务在被释放后再次被领取时仍然是第一个，gate 要求的修正也会获得 2 倍。api 在 dev 的上下文中返回 `task.primeiraDoModulo`（没有 `module` 时为 `false`，该模块没有任何领取时也为 `false`——正常上限是保守的），*有效*上限在 engine 的单一位置解析。因预算而阻塞时会说明对该任务生效的上限（"teto da primeira tarefa do módulo: 1000000 micro-USD,
US$ 1.00"）。QA 的 gate 仍使用基础的 `task_budget_micros`——不在卡片的范围之内。

- **位置：** `apps/engine/lib/engine/dev/teto_da_tarefa.ex:32` (`efetivo`);
  `apps/engine/lib/engine/dev/dev_agent_server.ex:669` (`diagnostico_de_orcamento`);
  `apps/api/src/application/use-cases/execution/get-dev-task-context.use-case.ts:182`
  (`ehPrimeiraTarefaDoModulo`)
- **测试：** `apps/engine/test/engine/dev/dev_agent_server_test.exs`（describe
  "RN-774"：花费 US$ 0.53 的第一个不阻塞，同一模块的第二个阻塞——失败用例——，另一个模块的第一个也获得 2 倍）；
  `apps/engine/test/engine/dev/teto_da_tarefa_test.exs`;
  `apps/api/test/application/use-cases/execution/get-dev-task-context.use-case.spec.ts`
  （describe "RN-774"）
- **来源：** AT-433

### RN-802 — Dev Lead 计划的估算把每个模块第一个任务算作两倍 {#rn-802}

`propose_execution_plan` 的审批卡片（RN-709）原来说"最多 N × 上限"，忽略了每个模块的第一个任务有两倍上限（RN-774）。现在 api 在 payload 中、在 `orcamentoPorTarefaMicros` 旁边带上
`multiplicadorDaPrimeiraDoModulo`，句子汇总*有效*上限：（任务数 − 有任务的模块数）× 上限 + 有任务的模块数 × 倍数 × 上限，并说明"每个模块的第一个算两倍"。一个模块 8 个任务、上限 US$ 0.50 时：最多 US$ 4.50。这是上限：已经有任务被领取过的模块的第一个不会获得两倍，句子仍然说"最多"。payload 中没有倍数（旧提议）时，用旧的算法。

倍数只在 engine 中*应用*（`Engine.Dev.TetoDaTarefa`）；api 有一个声明的镜像，因为界面不应该复制这个常量，而提议时不会询问 engine。改一个就要改另一个。

- **位置：** `apps/api/src/application/use-cases/execution/activate-execution.use-case.ts:83` (`MULTIPLICADOR_DA_PRIMEIRA_TAREFA_DO_MODULO`);
  `apps/api/src/application/use-cases/actions/propose-action.use-case.ts:237` (`multiplicadorDaPrimeiraDoModulo`);
  `apps/web/src/lib/aprovacoes.ts:346` (`multiplicador`)
- **测试：** `apps/web/src/lib/aprovacoes.test.ts`（it "RN-802 (AT-473)"：8 个任务、1 个模块 → US$ 4.50；3 个任务、2 个模块 → US$ 2.50；没有预算则没有数字——失败用例）；
  `apps/api/test/application/use-cases/actions/propose-action.use-case.spec.ts`（"plano válido nasce pending"）
- **来源：** AT-473

### RN-892 — 调用的稳定前缀带标记发往 prompt 缓存，能力只在 OpenRouter 中打开，并经过证明 {#rn-892}

在 TP-01（10月15日）中测得：经由 OpenRouter 的 `anthropic/claude-haiku-5.5` 收到 840 万输入 token，其中缓存为 **0**，输入占 US$ 1.02 中的 US$ 0.84。Anthropic 模型只从缓存读取在文本内容块中以 `cache_control: { type: "ephemeral" }` 标记的前缀（最多四个点，TTL 5 分钟——https://openrouter.ai/docs/features/prompt-caching）。

1. **提供方能力，必需。** `LLMProviderCapabilities.promptCaching`
   只在 OpenRouter 中为 `true`，在其他八个中为 `false`。声明它而没有 `marcarCacheDePrompt` 钩子会在构造时失败。关闭时，请求体与之前逐字节相同。
2. **配置中的模型层。** 在 OpenRouter 中只有 `anthropic/*` 获得缓存点；其他模型自行缓存，原样返回。
3. **两个点，放在不变的东西上。** 前缀的最后一个 `system`（指令，以及其前的工具）和末尾 `system` 尾部之前的最后一个 `user`/`tool`。尾部——语言（RN-622）、环境（RN-706）、流程（RN-711）、档案（RN-680）——位于最后一个点*之后*，消息的顺序从不改变。
4. **证明（ADR 0041/0042）。** 2026-10-15，smoke 使用真实凭据运行（`OPENROUTER_TEST_KEY=… pnpm --filter api exec vitest run
   test/infrastructure/llm/openrouter-provider.cache.smoke.spec.ts`），对 `anthropic/claude-haiku-5.5` 的第二次调用返回
   `cached_input_tokens=8011`；只有在那之后，OpenRouter 的能力才变为
   `true`。打开其他提供方需要等效的 smoke。收益通过 [RN-666](#rn-666) 出现在计量中。

- **代码：** `apps/api/src/infrastructure/llm/openrouter-provider.ts:276` (`marcarCacheDePromptOpenRouter`);
  `apps/api/src/infrastructure/llm/openai-compatible-provider.ts:501` (`mensagens`)
- **测试：** `apps/api/test/infrastructure/llm/openrouter-provider.contract.spec.ts`（"pontos de cache de prompt (RN-892)"：打开时标记两个点；关闭时逐字节相同；有能力而无钩子会失败——失败用例）
- **来源：** AT-543
