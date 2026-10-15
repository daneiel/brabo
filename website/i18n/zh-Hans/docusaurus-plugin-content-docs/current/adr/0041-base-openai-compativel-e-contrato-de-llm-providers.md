---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# 0041 — 一个 OpenAI 兼容基类、一份 LLM provider 合约，以及会拒绝 binding 的 capabilities

## 背景 {#contexto}

第 9 阶段将增加六个 LLM provider（NVIDIA NIM、Deep Infra、
Together AI、Bitdeer AI、Vultr 和 OpenRouter）。在编写第一个之前，对现有内容的探查表明，这个基础连现有的三个都撑不住：

1. **`OpenAIProvider` 悄无声息地丢弃 `options.tools`。** 五十四行代码、`openai` SDK，以及文件中一条承认 tool calling “在这个 provider 中尚不支持”的注释。把 OpenAI 模型绑定到 agent 的人会看到 ToolLoop 无结论地结束——与 [ADR 0020](0020-destravar-gates-qa-secops.md) 花了九次执行才诊断出的症状相同。
2. **`OpenAIProvider` 和 `AnthropicProvider` 都没有任何测试。**
   唯一被测试的 provider 是 Ollama，而且只测了传输层。
3. **没有 LLM 错误分类。** 三个 provider 都做
   `yield { type: 'error', message: (error as Error).message }`。过期的密钥、速率限制和不存在的模型，到达用户时都是同一条不透明的厂商字符串。git 一侧在
   [ADR 0002](0002-git-error-normalization.md) 中解决了这个问题，但这个教训从未跨过来。
4. **`models` 没有 capabilities，`LLMProvider` 也没有 `capabilities`**
   ——不同于 `GitProviderContract`，后者自第 2 阶段起就带着自己的。任何模型都可以绑定到任何 agent。
5. **没有 LLM 合约测试套件**，尽管 git 的那套
   （`test/contract/git-provider.contract.ts`）自 [ADR 0001](0001-git-provider-contract-shape.md) 起就作为项目约定写在 CLAUDE.md 中。

在这样的基础上加六个新 provider，会把这五个问题乘以六。

## 决策 {#decisão}

### 基类讲 `node:http`，而不是 SDK {#a-base-fala-nodehttp-não-o-sdk}

`OpenAICompatibleProvider` 只实现一次 `/chat/completions` 方言，并且是在原始 `node:http` 之上实现——而不是在 `openai` SDK 之上，SDK 从 `package.json` 中移除。

原因是阶段范围要求而 SDK 无法提供的那一项：**空闲超时**。SDK 讲 `fetch`，其超时针对整个请求；我们需要的是在 socket **静默**时断开它，既适用于“还没发出 headers”，也适用于“流中途停止发送 chunk”。这正是 ADR 0020 追查的区别，它为 Ollama 编写的 `postStream` 被提取到 `infrastructure/llm/http-stream.ts`，开始为两者服务。

附带的收获是，每个 provider 的特殊之处变成了配置 flag（`baseUrl`、认证 header、`streamOptionsIncludeUsage`、
`maxTokensField`），而不是撞上 SDK 允许配置的边界。每个 flag 的存在都是因为某个真实 provider 有分歧——规则是没有需要它的 provider 就不加 flag，第 9b 阶段在实现中对照官方文档确认每一个。

### 规范化的错误放在 chunk 中，`code` 必填 {#o-erro-normalizado-vai-no-chunk-com-code-obrigatório}

`ChatErrorChunk` 增加了 `code: LLMErrorCode`，分类变成了
`domain/llm/llm-provider-errors.ts` 中的类。该字段是**必填**的，而非可选：若是可选字段，新 provider 忘了分类，它的错误就会重新变成不透明字符串而没人察觉。

| status | `code` |
| --- | --- |
| 401、403 | `auth` |
| 404 | `model_not_found` |
| 429 | `rate_limit` |
| 413，或带上下文标记的 400 | `context_length` |
| socket 静默 | `timeout` |
| 未连接 | `connection` |
| 其余 | `upstream` |

与 `git-errors.ts` 是一组零散的类不同，这里有一个基类：错误的去向不是按类型给出 status 的 HTTP 过滤器，而是转换为 `ChatErrorChunk`。做转换的一方需要一个总是暴露 `code` 和 `message` 的单一入口。

### 两层 capabilities，以及会被拒绝的 binding {#capabilities-em-duas-camadas-e-um-binding-que-é-recusado}

`LLMProvider` 增加了 `capabilities`（后端的**上限**），`models` 增加了三个 `supports_*` 列（该特定模型能做什么）。模型可以比 provider 弱，永远不能更强。

使用离散列而非 `jsonb`：第 9c 阶段“适合 agent”的过滤器需要是一个 `WHERE`，而没有列的 capability 是没人能查询的 capability。

在此之上是新规则（[RN-040](../business-rules/custo.md#rn-040)）：
`assertModelFitsBindingScope` 拒绝把没有原生 tool calling 的模型绑定到 **agent**，消息会指向用户需要使用的过滤器。只有 `agent` 作用域会验证——`workspace` 和 `project` 是人类聊天的回退，锁住它们会在整个产品中禁止仅聊天的模型。

engine 的 `ToolCallRecovery` 继续存在，并且继续是**救援，而不是许可**：它依赖模型碰巧写对格式，写不对时就静默失败。刻意选择这种碰巧，正是规则所拒绝的。

**范围前提的更正：** `context-manager` 不是 binding 作用域——它是 `scope='agent'` 下的一个 agent slug（ADR 0007）。规则按构造覆盖它，无需新枚举。

### 合约拥有断言；harness 拥有方言 {#o-contrato-é-dono-das-asserções-o-harness-do-dialeto}

`test/contract/llm-provider.contract.ts` 针对任何
`LLMProvider` 运行同一组测试。每个 provider 的 harness 把九个场景翻译成自己的线上格式，并继承这些测试：帧在两个
`res.write` 之间被切开的流、usage 存在与缺失、tool calling、四种错误，以及静默的服务器。

假服务器是一个运行在临时端口上的真正 `node:http`——第 4 阶段 Ollama 测试的模子——而不是 `fetch` 的 mock。被测的恰恰是 socket 行为；mock 会乖巧地回应却什么也证明不了。

第 9b 阶段的 provider 从诞生起就带着三十条断言，自己一条都不用写。

### Anthropic 获得了 tool calling 并留在 SDK 上 {#o-anthropic-ganhou-tool-calling-e-ficou-no-sdk}

Anthropic 不讲 `/chat/completions`，所以不派生自基类。它获得了原生 tool calling（`tool_use` 块，`role: 'tool'` 的消息变成在一个 `user` 轮次中分组的 `tool_result`——该格式要求并行调用的结果出现在同一轮次中）、按 status 规范化的错误，以及通过 `withIdleTimeout` 的空闲上限，后者包裹 SDK 的生成器并在每个事件时重新上弦计时器。

## 后果 {#consequências}

### 被记录而非被隐藏的分歧 {#divergências-que-ficaram-documentadas-em-vez-de-escondidas}

合约有一个按 harness 参数化的维度——`usageFallback`——因为三种方言对同一问题给出不同回答：

- **兼容基类**用本地 tokenizer 计数并标记 `estimated: true`；
- **Ollama** 完全不发出 `usage`（没有 `done` 行就无可报告）；
- **Anthropic** 不会省略计数——`usage` 在
  `message_start` 中是必需的，那里的“无 usage”场景将是无效协议。

把这藏进一个只检查“有没有 usage”的单一测试，代价是丢掉“provider 说了零”与“provider 什么也没说”之间的区别——而这正是 `estimated` 标记存在所要承载的。

### 接受的代价 {#custos-aceitos}

- **`OpenAIProvider` 换了传输层。** 这不是“只是移动代码”：它离开了 SDK，开始自己解析 SSE。由于之前它没有任何测试，迁移由新的合约测试套件验证，而不是由既有测试。作为补偿，解析现在由三十条断言和一次经过验证的变异来演练：去掉 `tools` 的发送会让合约失败。
- **一条现有测试断言改变了。**
  `ollama-provider.spec.ts` 用精确的 `toEqual` 比较错误 chunk；多出的 `code` 键打破了它。一行。
- **四个测试 fake 增加了 `capabilities`。** port 中的 `capabilities` 是抽象的，所以用例的 `FakeProvider`/`ThrowingProvider` 需要声明。否则它们会类型无效却照样通过——`tsconfig.build` 排除了 `test/`，vitest 使用不做类型检查的 SWC，也就是说错误会是静默的。
- **迁移的回填是一个包含七个模型的字面列表。** 盲目的 `UPDATE` 会更简单，但会对操作员通过 SQL 插入的任何模型撒谎——对未经验证者，默认的 `false` 必须继续有效。

### 仍然开放的 {#o-que-continua-aberto}

- **`brabo_llm_call_errors_total` 几乎不触发。**
  `TracedLLMProvider` 只在*抛出*异常时递增，而 provider 是*yield* 错误 chunk 而不是抛出。既然错误现在有 `code`，计数器可以增加一个原因标签并开始真正计数——但那是未经请求就改动已完成阶段的可观测性，因此在这里登记而不是顺手去做。
- **`supports_vision` 在表中但没人使用。** 它之所以加入，是因为阶段范围在 capabilities 中列出了它；它会在第 9c 阶段的 ModelPicker 中获得消费者。
- **六个 provider、`list_models`、价格同步和重新分组的 ModelPicker** 属于 9b 和 9c。本阶段是基础：`llm_provider` 或 `credential_provider` 中没有任何新值。

引用 [ADR 0020](0020-destravar-gates-qa-secops.md)，`postStream` 和“总是记录失败来源”的规则来自那里；以及
[ADR 0002](0002-git-error-normalization.md)，本 ADR 终于在 LLM 一侧复刻了它的错误规范化。
