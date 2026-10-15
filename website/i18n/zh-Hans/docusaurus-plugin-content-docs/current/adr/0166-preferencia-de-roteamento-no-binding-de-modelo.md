---
traducao_de: 46b80218d8760540d8aa0f904fa42f38face0ae3
---

# ADR 0166 — 路由偏好住在模型 binding 中，随它一起传递，并在计量中冻结

## 状态 {#status}

**Accepted.** 由维护者于 2026-09-18 决定（AT-090）：*"a preferência
de roteamento é CONFIGURÁVEL POR BINDING"*。扩展
[ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)
（两层 capability，只有在被证明时才声明）和
[ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
（产生数字的东西被冻结在 `token_usage` 的行中）。两者都不被编辑。由此诞生的规则是
[RN-583](../business-rules/custo.md#rn-583)。

## Context {#context}

在 v6.1.0 安装的 `token_usage` 中测量（2026-09-14）：24 次经由 `openrouter` 的
`~deepseek/deepseek-v4-flash-latest` 调用。`upstream_provider`
（[RN-042](../business-rules/custo.md#rn-042)）已经说明了每次由谁提供服务：
**23 次是 Relace**，平均延迟 69,5 s（32 到 47 tok/s 之间），
**1 次是 Baidu**，37,8 s（约 190 tok/s）。当请求什么都不说时，OpenRouter 通过一种偏重**价格**的负载均衡选择上游——而 `openrouter-provider.ts` 什么都没说：`/chat/completions` 的正文发出时没有 `provider`/`sort`。

hub 在正文中接受 `provider: { sort: "price" | "throughput" | "latency" }`。剩下的问题是**产品**问题，而不是线上传输问题：**谁**选择标准，以及这个选择住在**哪里**。

## Decision {#decision}

### 1. binding 中的一列，在 `llm` 聚合中 {#1-uma-coluna-no-binding-no-agregado-llm}

`routing_preference`（枚举 `routing_preference`：`price | throughput |
latency`），**可为空**，位于 `model_bindings` 中。`null` 是今天的行为：什么都不发送，由 hub 自行决定。该列进入
`apps/api/src/db/schema/llm.ts`，binding 已经住在那里——聚合是模型的聚合，枚举与调用它的两张表住在一起（[ADR 0121](0121-schema-dividido-por-agregado-de-dominio.md) 的枚举规则）。

### 2. 偏好不会单独级联：它随胜出的 binding 一起传递 {#2-a-preferência-não-cascateia-sozinha-ela-viaja-com-o-binding-que-venceu}

级联（`session > agent > area > project > workspace`，再加上 Criativo 的级联后步骤）仍然是**binding 的**级联。胜出的 binding 带来模型以及它的偏好；没有任何层级从另一层级“只继承偏好”。三个原因：

- **偏好只有与选择它时所用的模型在一起才有意义。** 它为**一个** provider（hub）而存在；单独级联会产生没有人选择过的组合——agent 的模型落在一个没有该 capability 的 provider 上，加上项目的 `throughput`，或者 workspace 的 `latency` 被应用到一个 workspace 所有者从未见过的模型上。
- **独立的级联会要求界面上有第二条链。**
  [RN-470](../business-rules/custo.md#rn-470) 让**模型**的链逐节点可见；两条在同一行中落在不同层级的链，恰恰是界面无法解释的状态。
- **被级联**跳过**的层级会把偏好一起带走。** 因不可用或缺少 tool calling 而被跳过的 binding 整体失效——模型和标准都是。只让标准幸存，会是第一个原因中的同一缺陷，由跳过所造成。

写明的后果：要给整个区域设置 `throughput`，就写在**区域**的 binding 中；拥有自己 binding 而有所不同的 agent 使用**它自己的**偏好（在有人选择之前为空）。

### 3. 写入：缺省则保留，`null` 则清除，provider 没有 capability 则拒绝 {#3-a-escrita-ausente-preserva-null-limpa-provider-sem-capability-recusa}

`PUT .../model-binding`（全部五个作用域）增加
`routingPreference?: 'price' | 'throughput' | 'latency' | null`：

- **缺省**——保留已记录的偏好，*如果新模型的 provider 接受它*；否则它变成 `null`。省略不能静默地清除（一贯的换模型操作和“应用到所有”就是这样继续调用该路由的），也不能留下一个新 provider 不理解的已记录标准；
- **`null`**——显式清除；
- **有值，而 provider 没有该 capability**——422
  （`RoutingPreferenceNotSupportedError`），与其他 binding 拒绝走同一个过滤器。请求格式良好；站不住的是这个组合。

这三条规则所维护的不变式：**没有任何 binding 会为一个不声明它的 provider 保存偏好。**

### 4. **provider** 的 capability，在被证明之前声明为 `false` {#4-capability-de-provider-declarada-false-enquanto-não-provada}

`LLMProviderCapabilities.routingPreference`，像 `embeddings` 一样是必填的（可选字段就会出现忘了声明的新 provider）。九个都要声明。线上映射（`provider: { sort }`）是 OpenRouter 的特殊之处，作为其配置的 hook（`campoDeRoteamento`）加入，沿用
`extrairUpstreamProvider` 的设计：基类只在 capability 为 `true` **且**有偏好时才调用它——在解析中绝不出现 `if (name === 'openrouter')`。

**模型**层不增加列：`sort` 是 **hub** 对服务该模型的各上游的标准，OpenRouter 的目录不按行发布它，而只有一个上游的模型收到它时什么也不做。编造这个列就是没有来源的 capability。

**OpenRouter 的值就是证明所说的那个。** 只有当针对真实 API 的 smoke（`openrouter-provider.roteamento.smoke.spec.ts`）返回被选中的上游时，capability 才变为 `true`。在实现者的环境中没有凭据时，它以 `false` 诞生，功能以**休眠**状态诞生：路由以 422 拒绝，界面以文字说明本安装中没有任何 provider 的这一选项已被证明。

### 5. 被**请求**的东西冻结在 `token_usage` 中 {#5-o-que-foi-pedido-vai-congelado-em-token_usage}

`token_usage.routing_preference`，可为空，每次调用写入：**发送到线上**的偏好——binding 没有时为 `null`，有但 provider 不声明它时也为 `null`（它没有被发送，因此不是任何东西的出处）。这与冻结价格是同一把尺子：没有它，比较开启 `throughput` 前后的 `upstream_provider` 和 `latency_ms` 就要依赖重建当时 binding 的状态，而那在任何地方都没有记录。

### 6. 界面通过一条**provider** 路由发现 capability {#6-a-tela-descobre-a-capability-por-uma-rota-de-provider}

`GET llm/provider-capabilities` 返回九个 provider 的 capabilities，从注册表的实例中读取——与适配器使用的是同一个来源。新路由，而不是现有响应中的一个字段，因为现有响应中没有任何一个是关于 **provider** 的：模型是目录的一行（厂商的事实，与实体 `MesmasChaves`），binding 是某个作用域的决定。没有角色要求（只需认证），就像 `users/me/credentials`：它是本安装代码的事实，对所有人都一样。

控件住在编辑 binding 的地方——设置中的 agent 表和区域区块——使用**端点**的最低角色
（[RN-102](../business-rules/custo.md#rn-102)）：agent 上为 `developer`，区域上为 `maintainer`。只有在**有**自己 binding 的那一行上才可编辑；在继承的那一行上，说明当前标准来自哪个层级。provider 没有该 capability 的模型不会获得选项——它获得一句说明原因的话。

## Consequences {#consequences}

- capability 为 `true` 时，在 OpenRouter 的 binding 上设置 `throughput` 会改变每一个解析到它的调用的正文，`token_usage` 的行会说明请求了什么标准以及由谁提供了服务——前后比较是一次查询，而不是一次重建。
- 只要 capability 为 `false`，对任何人来说线上都没有任何变化：代码已就位，路由拒绝，界面解释。翻转这个 flag 是一个单行 PR，附带 smoke 的输出。
- 声明的代价：`sort: throughput` 可能路由到一个更**贵**的上游。计量继续按模型的目录价格收费（ADR 0042），这是 OpenRouter 的参考价格而不是上游的价格——这一差异早已存在，这里不测量。

**超出范围，已声明：**

- 会话（`SessionPage`）以及项目和 workspace 层级在界面上没有控件：API 在五个作用域中都接受该字段，但项目和 workspace 在任何界面上都没有模型选择器（已测量：web 没有调用任何
  `setProjectModelBinding`/`setWorkspaceModelBinding`），而会话选择器是另一个界面；
- agent 卡片（Visão Geral/Executores）显示模型且**不**编辑 binding——控件没有放在那里，因为那里不编辑 binding；
- OpenRouter `provider` 对象的其他字段（`order`、`only`、
  `ignore`、`allow_fallbacks`、`max_price`）以及 `:nitro` 后缀：没有一个被要求，每一个都是独立的产品决定。
