---
traducao_de: 8397a73e2338fe4d24d56ee0a87b33fdff223ff8
---

# ADR 0188 — provider 返回的真实成本成为计量的数字

## 状态 {#status}

**Accepted.** 2026-09-30（AT-270 和 AT-272，故事 HS-070，史诗 EP-030，第 34 轮；
负责人 9月30日的决定：*"o custo real vira o número"*——当 provider 返回它收取的金额时，写入并显示的就是这个值，
`estimated = false`；目录价格只用于没有真实成本的地方）。
补充
[ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
（冻结且可审计的价格）和
[ADR 0076](0076-provider-volta-a-ser-dimensao-de-gasto.md)（provider 作为花费维度），但不编辑它们：冻结价格继续存在，并继续是每一次响应没有说明成本的调用的数字；改变的是两种来源同时存在时哪一个胜出。把
[ADR 0179](0179-o-laco-pergunta-ao-jev-qual-ferramenta.md) 为 Jev 工具决策成本设定的设计扩展到**聊天**——**同一个**列
`price_implicit` 和**同一个**函数 `precoImplicitoPorMilhao`——而不是用第二种方式来表达“此成本为真实成本”。

## Context {#context}

2026-09-30 在 `dev` 的代码上测量，改动之前：

- 写入 `token_usage.cost_micros` 的成本来自**一个**地方，在三个用例中重复——`RunLlmTurnUseCase`（9月29日真实使用 305 行中的 276 行）、`StreamLlmTurnUseCase`（28）和 `SendChatMessageUseCase`（1）：
  `calculateCostMicros(tokens, preço de models)`。没有其他路径写入计量（`RecordLlmUsageUseCase` 是唯一的，它只是转发这个数字）。
- `OpenAICompatibleProvider.chat` 从 `usage` 帧中只读取
  `prompt_tokens` 和 `completion_tokens`。它丢弃了 `usage.cost`（OpenRouter 收取的成本，美元）、`model`（实际**提供服务**的模型——别名
  `~deepseek/deepseek-flash-latest` 解析为一个带日期的版本）和 `id`
  （`gen-…`，`GET /api/v1/generation?id=` 接受的标识符）。真实使用分析的发现（`openai-compatible-provider.ts:237-245`）在 `dev` 上逐字节复现。
- 差距是测量出来的，不是假设的：9月29日的真实使用按冻结价格（每百万 20 000 / 600 000 micros）合计 US$ 0,314259，而测试密钥当天记录 US$ 0,5807（1,85×）。按 `upstream_provider` 已经记录的**底层** provider 重新定价，无缓存的上限约为 US$ 0,917。hub 的目录价格是**一条**路由的价格；hub 按它实际使用的路由收费。
- `usage.cost` 早已是对 OpenRouter 所做的所有付费测量的花费来源（`docs/explanation/medicao-do-idioma.md`、
  `medicao-do-jev.md`、`scripts/idioma/validar.ts`）：该字段存在于 `/chat/completions` 的真实响应中，这些测量的花费就是靠它累加的，从不是靠 `/key` 的计数器。

## Decision {#decision}

1. **优先级。** 当 `usage` chunk 带有 `costMicros` 时，它**就是**该行的 `cost_micros`、engine 加到循环本地预算上的数字（该轮的 `usage.costMicros`）、递增项目/会话/区域预算的数字，也是 Gastos 标签页累加的数字。没有它时，目录的冻结价格（ADR 0042）照常产生这个数字。一个领域函数同时决定这两件事——`custoDaChamada`（`domain/llm/custo-da-chamada.ts`）——三个用例都经过它；没有第二把尺子。
2. **带真实成本的行，其价格是隐含的。** `成本 ÷ tokens`，两个价格列中是同一个值（provider 返回**一个**成本；把它在输入和输出之间拆分就是编造比例），`price_implicit = true` 表明这一点。正是这保证了 `tokens × preço = custo`（RN-044）可复现（除了整数价格的舍入），而不假装存在一个产生该数字的价目表价格。与 ADR 0179 是**同一个**公式（`precoImplicitoPorMilhao`）和**同一个**列。
3. **目录本应收取的金额放在旁边**，在 `catalog_cost_micros` 中，仅在数字为真实值的行中（其他行为 `null`）。这正是卡片所要求的（“把真实成本记录在估算值旁边”），也让 9月29日分析在汇总层面测得的差距可以逐行测量。
4. **`estimated` 的含义不变。** 它继续说明 **tokens** 是由 provider 计数还是本地估算（RN-041）。有真实成本的行 `estimated = false`，因为成本只会随 provider 的 `usage` 一起到达；表明**成本**为真实的标记是 `price_implicit`。用 `estimated` 同时回答两个问题会抹掉“provider 说了 0 个 tokens”与“provider 什么也没说”之间的区别。
5. **记录解析出的模型和生成 id**——`resolved_model_name`
   和 `generation_id`，由该方言的**每个** provider 从帧的 `model` 和 `id` 读取（它们是 `/chat/completions` 方言自身的字段，不是 hub 的怪癖）。`model_name` 继续是**目录**名称：它是报表的维度（RN-101/RN-186），也是与 `model_id` 的关联；把它换成解析出的名称，会在别名每出一个新的带日期版本时，把同一个 binding 拆成 N 行报表。
6. **读取成本的是配置 hook，而不是基类。** `OpenAICompatibleConfig` 中的 `extrairCustoReal`，**只**在 OpenRouter 上配置
   （`extrairCustoRealOpenRouter`）。没有该 hook 的 provider 即使 `usage.cost` 存在也忽略它——该字段的单位和含义属于 hub，而第 9 阶段的规则是 provider 的特殊性变成 hook/flag，绝不是 `if`。`LLMProviderCapabilities` 中不产生新的 capability：成本是**逐响应**观察的，它的缺失会逐行自动降级到目录。
7. **BYOK 不是真实成本。** 当 `usage.is_byok === true` 时，`cost` 是 hub 的费用，推理由提供方另行收费；只记录这笔费用就是记录得**少于**实际收费——正是本 ADR 要关闭的缺陷——因此该行回落到目录。不是有限非负数的成本同样视为“没说”，绝不是零；真正的零（免费模型）是真实成本。

8. **记录输入和输出的组成部分**（AT-272，RN-666）：
   `cached_input_tokens`（`usage.prompt_tokens_details.cached_tokens`）和
   `reasoning_tokens`（`usage.completion_tokens_details.reasoning_tokens`），由基类为该方言的每个 provider 读取，因为它们是 OpenAI 自身的字段。它们是 `input_tokens`/`output_tokens` 的**组成部分**，绝不与之相加，也不重新计算成本：有真实成本时，缓存折扣已在数字中；没有时，目录没有可应用的缓存价格，编造一个就是另一种估算。`null` 是“没说”，区别于 0。测量（`medir-execucao.ts`）开始按 agent 报告输入中有多少是读取的缓存——只针对报告了的调用，以及有多少次——以及有多少次成本是真实的。9月29日分析留作假设的区间（US$ 0,58 到 0,92 之间，取决于缓存）在新调用中变得可测量；旧的 305 次仍然没有这一信息。

## Consequences {#consequences}

- Gastos 标签页、预算和循环本地预算的数字，在 OpenRouter 测量的调用中开始成为它所收取的金额。同一份报表累加真实行和估算行；`price_implicit` 逐行区分两者。
- **预算可能“跳变”。** 基于目录价格校准的预算从此会看到同样调用的花费最多高约 ~1,85×（9月29日的测量）：70/90/100% 的阈值会更早到达。这是所要求的行为——预算从此针对的是钱，而不是估算——并为之前校准过上限的人声明于此。
- **界面仍然写着“估算”。** 成员的 Gastos 标签页副标题（RN-101）声称成本是估算的。界面如何区分真实与估算——每行一个标签、一个比例，或只是改句子——是负责人尚未做出的产品决定；这里没有改动任何界面，api 也还没有在任何路由中暴露 `price_implicit`。
- **没有密钥的证明。** 这台机器上没有 OpenRouter 的凭据：证明是合约测试套件中**录制的响应**
  （`openrouter-provider.contract.spec.ts`，带有付费测量所读取的 `usage` 形态），手动 smoke（`openrouter-provider.smoke.spec.ts`）开始在有凭据时要求 `price_implicit` 和 `gen-…`。BYOK 下 `cost` 的含义是对文档的**阅读**，而不是测量。
- **一列，两个写入者。** `price_implicit` 诞生于 migration 0066（Jev）；本决策只是为它增加第二个写入者，migration 0067 只创建三个新列。`price_implicit = true` 的行要么是 Jev（`model_name = typesafe/jev-1.13`，`model_id` 为空），要么是带真实成本的聊天调用（`model_id` 有值，`catalog_cost_micros` 非空）；Jev 不写 `catalog_cost_micros`，因为它没有目录价格。
- **Anthropic 不在组成部分之列。** 它在自己的协议中报告缓存（`cache_read_input_tokens`），其适配器不读取；它的行在两列中都写 `null`。其他 provider 均无变化。
- 解析出的模型和 id 所解锁的东西——用 `GET /generation?id=` 核对一行的收费、按带日期版本重新定价——尚待构建；这里只做记录。
