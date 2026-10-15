---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# 0043 — 在基础之上的六个 LLM provider，Fase 9b 终于关闭

## 背景 {#contexto}

[ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md) 交付了 OpenAI 兼容的基础、provider 契约以及两层 capabilities。[ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md) 交付了实时目录和可审计的价格，但在自己的"之后再做"中明确写明：**Fase 9b 的六个 provider**（NVIDIA NIM、Deep Infra、Together AI、Bitdeer AI、Vultr 和 OpenRouter）没有进入——那个阶段会话的出站策略拒绝所有外发 HTTPS，而在编码之前**在官方文档中**核实 `baseUrl`、认证和流式传输的特殊之处，是该范围本身的条件，而不是细节。

Fase 11 分两批交付了这六个。先是单独的 OpenRouter（11a）——六个中唯一的**中转平台（hub）**，之所以先选它，正是为了在把这个模子重复五次之前，先用真实生产环境证明基础。然后是五个直连（11b）——NVIDIA NIM、Together AI、DeepInfra、Bitdeer、Vultr——依次进行，每一个都针对其 API 的官方文档**从零**调查。指导这两批的规则，继承自 ADR 0041 本身的精神（"每个标志都存在，是因为某个真实 provider 有分歧"）：关于怪癖的假设**绝不**在 provider 之间继承。一个看起来像另一个的 provider，可能恰恰在没人检查的地方有分歧。

## 决策 {#decisão}

### 验收表，逐个 provider {#a-tabela-de-aceite-provider-por-provider}

| provider | `listModels` | 原因 | 连接测试 | 怪癖 | 模型来源 |
| --- | --- | --- | --- | --- | --- |
| **OpenRouter** (11a) | `true` | 目录在每一行自带定价（十进制字符串，USD/token，经转换） | `GET /key`，专用端点 | 自有请求头（`HTTP-Referer`/`X-Title`）；错误出现在流的**中途**（唯一的 hub）；模型 id 带上游前缀 | sync |
| **NVIDIA NIM** | `false` | `GET /v1/models` 存在，所核实的任何文档中都没有价格 | `GET /v1/models`，只看状态 | 工具调用按**模型**而非按 API；托管端点 ≠ 自托管容器 | seed |
| **Together AI** | `true` | 目录带有扁平的 `pricing`（数字），单位通过市场比较推断——没有明确文档 | `GET /v1/models`，只看状态 | 带命名空间的 id（无前缀则 404）；429 带 `error_type` | sync + seed |
| **DeepInfra** | `true` | 目录**公开、无需认证**，**实时**确认带有真实价格 | 无——公开目录无法区分好密钥和坏密钥 | 目录混合了聊天/图像/音频/视频（按 `tags` 过滤） | sync + seed |
| **Bitdeer** | `false` | 公开渠道找不到任何目录/价格形态 | `GET /v1/models`，无密钥时实时确认为 401 | 六个中最浅的公开文档；在其博客的配置示例中确认了 3 个**真实** id | seed |
| **Vultr** | `false` | 基础调用的路由（`/models`）在文档中没有价格；文档记载的带价格路由实时返回 404 | `GET /v1/models`，无密钥时实时确认为 401 | 用真实示例确认了工具调用（`kimi-k2-instruct`，`finish_reason: "tool_calls"`） | seed |

### "诚实的 false"两次实时胜过"脆弱的 true" {#falso-honesto-venceu-verdadeiro-frágil-duas-vezes-ao-vivo}

ADR 0041/0042 的规则（"capability 只有在被证明时才声明"）不只是原则——它在实现过程中被检验过，并两次改变了结果：

- **DeepInfra** 在规划中是 `listModels:
  false` 的候选（文档暗示必须认证，且在基础调用的端点上价格未确认）。对 `GET https://api.deepinfra.com/v1/openai/models`（与 `OpenAICompatibleProvider.listModels()` 一贯调用的同一个端点——`{baseUrl}/models`，无一例外）的**实时**检查表明，目录是公开的，完全不需要认证，并在 `metadata.pricing.{input_tokens,output_tokens}` 下返回真实价格。它变成了 `true`——无需扩展基础，因为它默认已调用的 URL 就够了。
- **Vultr** 走了相反的路：规划指向 `true`（Vultr 的文档把价格关联到一个带有 `cost`/`contextWindow` 的端点 `GET /provider`）。对该路径的**实时**检查返回 **404**——文档过时了，或者所记载的路径从未以那种形式存在。由于基础只调用 `{baseUrl}/models`，而按照 Vultr 自己的官方参考，那条路由（已确认存在，无密钥时 401）没有价格，决定变成了 `false`。

两种情况下，最终决定都不是来自计划——而是来自在实现过程中真正去调用 API。一个在这次检查之前就锁定决定的计划，会在 NIM/Bitdeer 上猜对，在 DeepInfra/Vultr 上猜错。

### 没有新的"凭据种类" {#nenhum-kind-de-credencial-novo}

九个 provider 的每一个 LLM 凭据都有**相同**的形态——一个用信封加密加密的 API 密钥（`user_credentials.encrypted_api_key`）。在 LLM 一侧过去不存在、现在也不存在凭据"类型"的结构性区分（例如 OAuth 与密钥）。按 provider 变化的只是它**是否**声明了连接测试（OpenRouter 用专用的 `GET /key`；支持它的五个直连用只看状态的 `GET {baseUrl}/models`；DeepInfra 没有，因为其公开目录无法用来校验任何密钥）。

## 后果 {#consequências}

- `LLM_PROVIDER_NAMES` 从 3 个条目变为 **9** 个（`llmProviderEnum` 和 `credentialProviderEnum` 随之更新，通过迁移 `0030`）。ADR 0041 早已保证的双向穷举检查（类型 × 数组）让构建一直保持红色，直到注册表和模块拥有全部 9 种情况——完全按设计运作。
- 凭据注册的 DTO（`upsert-credential.dto.ts`）和连接测试器（`llm-credential-connection-tester.ts`）不再有硬编码的 provider 列表（在 DTO 中重复了三遍——Swagger、`@IsIn`、TS 类型），改为从 `LLM_PROVIDER_NAMES_COM_CREDENCIAL`/一个覆盖映射派生。本阶段的真实发现：手工列表正是工作中途弄坏一个测试的原因——凭据测试器的构造函数多了一个参数，而有一个 spec 没有跟上——这与 ADR 0041 的穷举检查在类型一侧早已要避免的静默失败是同一类，只不过这里是在值一侧。
- 凭据界面和 `ModelPicker` 无需新组件就吸收了这 9 个：`ROTULO_DO_PROVIDER`（一个穷举的 `Record`）增加了 6 个标签，`HUBS` 仍只有一个成员（`openrouter`）——五个直连之所以落入"APIs diretas"，是因为它们不在这个列表中，而不是因为新规则。
- 生成的参考（`docs/reference/llm-providers.md`，`providers-capabilities` 块）增加了三列——凭据、模型来源（`sync` | `seed` | `sync + seed`）和怪癖摘要——全部**机械地派生**（来自代码和已经手写的散文），没有为了给文档供数据而触碰任何 provider 文件。

### 洞察笔记：通向 Psicólogo 成本路由的钩子 {#nota-de-insight-o-gancho-pro-roteamento-de-custo-do-psicólogo}

`upstream_provider`（ADR 0042，为 Fase 9b 所做的准备）现在背后有了真实数据——不只是空的 schema。`docs/reference/llm-providers.md` 中的示例查询（"Hubs e o custo real"）表明，比较**同一个**模型经由 hub × 直连的成本，今天已经可以查询。**这被记录为种子，而不是实现**：这一比较没有自动的使用者，而自然的解读——Psicólogo 有一天建议"这个模型直连比经由 hub 更便宜"——只是在这里记下，没有工单，也没有阶段范围。

### 核实基础未被触碰 {#verificação-de-que-a-base-saiu-intocada}

`git diff origin/main -- apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts` 是**空的**——`SyncModelCatalogUseCase` 自 ADR 0042 起就以通用方式遍历 `LLM_PROVIDER_NAMES`；多吸收 6 个 provider 不需要一行代码。

`git diff origin/main -- apps/api/src/infrastructure/llm/openai-compatible-provider.ts` **不是空的**：+31/-0，唯一一个钩子——

```ts
export type ParseErrorFrame = (
  frame: Record<string, unknown>,
) => LLMProviderError | undefined;
```

加上 `OpenAICompatibleConfig` 中的可选字段 `parseErrorFrame?: ParseErrorFrame`，以及在 SSE 循环**中途**、读取 `delta`/`usage` 之前对它的调用——因为 hub 的错误帧不是字段为空的内容帧，而是另一种东西，把它当作后者处理会掩盖失败而不是报告它。这 31 行之所以存在，完全是因为 **OpenRouter 是六个中唯一的 hub**：只有 hub 会接受连接、开始发送文本，而背后的真实提供方在流的**中途**掉线——没有任何直连 provider 有这类失败，因为没有一个路由到第三方基础设施。证明这一扩展是最小且必要的、而不是投机的：11b 的五个直连 provider 都没有声明任何 `parseErrorFrame` 就通过了整个契约套件，也没有一个需要它。

基础中的其他文件（`http-stream.ts`、`llm-provider-errors.ts`、`model-capabilities.ts`、`model.repository.ts`）相对于 `origin/main` 都没有任何 diff。

## 之后再做 {#o-que-fica-para-depois}

- **用真实凭据验收六个冒烟测试**（`openrouter-provider.smoke.spec.ts` 和 11b 的五个），每个都由自己的 `<PROVIDER>_TEST_KEY` 把关。已编写、针对 mock 测试过，从未针对真实密钥运行——与 ADR 0042 早已为 OpenRouter 记录的待办相同，现在扩展到五个新的。（有密钥时）逐一运行它们，才能最终用现实而不是文档证明 Together/DeepInfra 的价格以及 NIM/Bitdeer/Vultr 的估计 ID。
- **NVIDIA NIM、Bitdeer 和 Vultr 的估计价格**——三者在本阶段都没有在可访问的文档中公布按模型的价格；种入的值是市场近似值（`manual_pricing: true`），一旦有官方来源即可修正。
- **Psicólogo 的成本路由解读**（见上面的洞察笔记）——种子，还不属于任何阶段的范围。
- **dogfooding 的 P1 发现**（Fase 10）仍未被触碰，与 backlog 的其余部分争夺 Fase 12——Fase 11 从未被授权触碰它们，也没有触碰。

引用 [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md) 和 [ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)，它们的基础以配置的形式支撑了这六个 provider——除了 OpenRouter 作为 hub 证明为必要的那唯一一个钩子之外，没有一个需要对基础进行重构。
