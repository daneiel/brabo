---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0075 — LLMProvider 合约中的 embedding

- **状态：** 已接受
- **日期：** 2026-08-14
- **扩展：** [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)、
  [ADR 0043](0043-seis-providers-de-llm-e-o-fechamento-da-fase-9b.md)

## 背景 {#contexto}

即将到来的 Chat RAG 需要把文本转为向量，而产品不会做这件事。搜索是字面的：**“embedding”这个词只出现在一条注释里**，在 `bitdeer-provider.ts` 的说明文字中，解释在 Bitdeer 文档中找到的唯一一个带认证的 `curl` 示例是他们的 embedding API。没有任何 provider 实现这个操作，没有任何类型描述它，没有任何 capability 声明它。

有三件事让这不只是“加一个方法”。

**1. capability 是一个新维度，而不是现有维度的变体。** 今天的 capabilities——`streaming`、`toolCalling`、`listModels` 以及 `models` 的 `supports_*` 列——讲的是模型如何**对话**。embedding 不是一种更贫乏的对话：它是另一个操作，有另一个端点、另一种正文和另一种响应类型。

**2. 这里的模型层是**排斥**，而不是梯度。** tool calling 允许降级：一个不请求工具的模型仍然能回复文本，这就是为什么 [RN-040](../business-rules/custo.md#rn-040) 只拒绝 agent 的 binding，而不是禁止该模型。embedding 不允许：`nomic-embed-text` 不回答问题，`llama3.2` 不返回向量。它们是两个不相交的模型集合，而“这个模型是 embedding 模型吗？”这个问题不适合任何现有列。

**3. 凭阅读文档来声明已经付出过高昂代价。**
[ADR 0043](0043-seis-providers-de-llm-e-o-fechamento-da-fase-9b.md) 记录了两次**现场**回退——DeepInfra 和 Vultr——文档承诺而执行否认的 capability。每个云 provider 都有一页说它提供 `/embeddings`；没有一页是证明。

## 决策 {#decisão}

### 操作：`embed`，可选，错误会**抛出** {#a-operação-embed-opcional-com-erro-que-lança}

```ts
embed?(
  inputs: readonly string[],
  options: EmbeddingOptions,
): Promise<EmbeddingResult>;
```

可选，遵循 `listModels` 自第 9c 阶段起履行的同一双边合约：**声明 capability 的一方实现该方法，不声明的一方不暴露它**。消费者通过查看 capability 来降级，绝不是在失败时才发现。

**批量，而不是单个。** 一个索引一次接收 N 个片段，每个 provider 都接受数组形式的 `input`。顺序是输入与向量之间唯一的联系，由此产生合约最重要的保证：**每个输入一个向量，否则就是错误**——绝不是更短的列表。部分被拒绝的响应事后无法察觉，因为第 i 个向量变成了另一句话的，索引就会静默出错。

**返回值说明四件事**，每一件都有其原因：

| 字段 | 原因 |
| --- | --- |
| `vectors` | 结果，按输入的顺序 |
| `dimensions` | 对照**实际到来**的东西核对，而不是从目录复制——向量索引的维度是固定的，写入不同的大小会在远离原因的地方失败 |
| `model` | provider **声称**使用的，并不总是所请求的（别名解析为带日期的版本）——进入计量的是它，理由与冻结价格相同（[RN-044](../business-rules/custo.md#rn-044)） |
| `inputTokens` + `estimated` | embedding 会产生花费，“说了零” × “什么也没说”的区分与 [RN-041](../business-rules/custo.md#rn-041) 相同 |

**错误会**抛出**，按 `code` 规范化**，而不是像 `chat` 中那样变成 chunk。
chunk 的理由是保留一个已经发生的轮次的花费；这里没有什么要保留的——要么 provider 返回了向量并收费，要么没有返回也没有收费。这与 `listModels` 做的选择相同，论据也相同，分类也**相同**（`auth`、`rate_limit`、`model_not_found`、
`context_length`、`timeout`、`connection`、`upstream`）：没有新的 code。

### 两层 capability {#a-capability-em-duas-camadas}

**Provider**——`LLMProviderCapabilities.embeddings`，必填（不是可选），论据与在 `ChatErrorChunk` 中让 `code` 必填的相同：字段可选时，新 provider 会忘记声明而没人察觉。

**模型**——`ModeloDoCatalogo.supportsEmbeddings` 和 `embeddingDimensions`，两者都是可选的，因为缺失意味着**“provider 没说”**，绝不是编造的 `false`（ADR 0041）。九个中只有 Ollama 按模型发布这一信息：`/api/tags` 中的 `capabilities: ["embedding"]`，以及给出维度的 `details.embedding_length`。

守卫 `assertCanEmbed` 按照最利于失败呈现的顺序检查两者：先查 provider，因为换模型解决不了不做 embedding 的 provider。它也拒绝**没有声明**的模型，并给出不同的消息——读者要做的是同步目录，而不是换模型。从模型**名称**推断 capability 将是披着数据外衣的猜测，这正是 ADR 0041 所禁止的。

### 证明：一个 `true`，八个 `false` {#a-prova-um-true-oito-false}

合约测试套件增加了五个用例，针对每个声明了该 capability 的 provider 运行：每个输入一个向量且顺序正确、维度和所用模型、不完整的批次变成错误、provider 错误按 `code` 规范化，以及空输入列表在发出网络请求前就被拒绝。

**只有 `ollama` 声明 `embeddings: true`**，证明是执行：对 0.32.1 版 daemon 使用 `nomic-embed-text` 发起 `POST
/api/embed`，两个输入 → 两个 768 维向量以及 `prompt_eval_count: 10`。同一次执行产生了变成测试的发现：**聊天模型返回 `501`**（"This server does not
support embeddings"）——模型层在尽可能晚的地方失败，这正是 `assertCanEmbed` 存在的理由。

其他八个声明 `false`，出于两种不同的原因，各自的说明都有记录。七个是**缺乏证明**：环境中没有它们的密钥，而唯一运行过的付费 smoke（OpenRouter，第 13a 阶段）是**聊天**的——在 hub 中，embedding 路由到与聊天不同的提供方，一个端点的证明不是另一个端点的证明。第八个是**操作不存在**：Anthropic 没有自己的 embedding 端点，其文档让人使用第三方，那是另一个 provider，有另一把密钥和另一种方言。

然而，OpenAI 兼容基类的 `/embeddings` 方言是**被证明**的——合约测试套件在开启该 capability 的基类配置上第二次运行。这正是让某个 provider 在拥有密钥的那天变为 `true` 变得廉价的原因：改字面量中的一行，解析早已被演练过。

## 后果 {#consequências}

**embedding 的花费还没有被测量，这是声明过的切分，而不是遗忘。** 返回值携带 `inputTokens`/`estimated`，正是为了喂给 `RecordLlmUsageUseCase`，它仍然是唯一的计量路径——`calculateCostMicros(input, 0, …)` 已经可用，因为 embedding 没有以 token 计的输出。缺的是结构性的，不适合放在这里：`token_usage` 的 `session_id` 是 **NOT NULL** 且有指向 `sessions` 的 FK，而索引仓库并不发生在会话之中。为了有地方写入而临时造一个合成会话，紧接着就会需要修正；这个决定属于实现消费者的那一波。

**模型层还没有列。** 它今天住在目录行中
（`ModeloDoCatalogo.supportsEmbeddings`），`models` 没有增加
`supports_embeddings`，因为这一波的 migration 名额属于另一条战线——两个并发的 migration 会在 `_journal.json` 和 drizzle 的快照上冲突，这是该计划声明过的限制因素。诚实的后果是：目录同步读取了 capability 却还没有地方持久化它，因此消费者需要询问 provider 或者连同列一起加载。`assertCanEmbed` 刻意接收一个窄的 `Pick`，以便服务于两种来源，并在列存在时无需改变。

**九个 provider 开始多声明一个字段。** 代价是真实的，并一次付清：必填的 capability 正是阻止下一个 provider 诞生时没有答案的东西。`TracedLLMProvider` 有条件地转发 `embed`，就像它对 `listModels` 所做的那样——并获得了自己的测试，因为恰恰是在那里 `listModels` 曾经从整个产品中静默消失过一次。
