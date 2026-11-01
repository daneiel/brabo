---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0042 — 活目录、模型生命周期与可审计的价格

## 背景 {#contexto}

[ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md) 交付了 OpenAI 兼容基类、provider 合约以及按模型的 capabilities。第 9 阶段还缺另一半：自动发现模型、知道其中一个消失时该怎么办，以及在不破坏历史的情况下改变价格。

编码之前的探查发现了三件事，它们重新定义了这项工作。

### 历史成本早已冻结——漏洞在别处 {#o-custo-histórico-já-estava-congelado--o-buraco-era-outro}

范围要求一个测试证明“改变价格不会改变昨天的成本”。这个测试今天就会空洞地通过：`calculateCostMicros` 在调用的那一刻运行，结果成为 `token_usage.cost_micros`；之后没有任何东西重新计算。

真正的漏洞是 `token_usage` **没有保存**产生该成本的价格。旧值是不可变的，但不是**可复现**的：只要有人修改了 `models` 的那一行，`tokens × preço` 就不再对得上，也无法区分“成本是对的”与“成本从来就是错的”。

### `is_active` 只是装饰 {#is_active-era-decorativo}

这一列自第 1 阶段起就存在，只在**一个**地方被读取：`listActive()`。
`findById` 和 `findCandidates` 都忽略它。停用一个模型既不阻止新的 binding，也不中断现有的 binding，调用照样发生并照样收费。界面说“已停用”，系统却不同意。

### 不存在按可用性的回退 {#não-existia-fallback-por-disponibilidade}

`binding-resolver.ts` 只接收 `{scope, modelId}`，别无其他——它不认识模型。级联是关于**作用域**的，从不关乎所指模型的状态。一个指向已被 provider 删除的模型的 binding 会正常解析，只在调用时才因厂商的 404 而失败。

## 决策 {#decisão}

### 两个独立维度，而不是单一状态 {#dois-eixos-independentes-não-um-estado-só}

| 列 | 谁写入 | 回答的问题 |
| --- | --- | --- |
| `models.is_active` | owner，通过策展界面 | “我想使用这个模型吗？” |
| `models.availability` | 同步，自动 | “这个模型在那边还存在吗？” |

单一状态应付不了：如果同步写 `is_active`，一个消失了一小时的模型回来时会是**关闭**的，丢失策展；如果 owner 写 `availability`，他就能“重新启用”一个在另一边已不存在的模型。两者的交叉才是界面上产生提醒的东西。

仓库 upsert 的 `set` **不包含 `is_active`**——正是这一行保证了规则：同步重新遇到一个模型时，不能重新打开有人故意关闭的东西。

### 被发现的模型以**未启用**状态加入，消失的模型被标记并保留 {#modelo-descoberto-entra-inativo-modelo-sumido-é-marcado-e-preservado}

在 [RN-043](../business-rules/custo.md#rn-043) 中形式化。删除从来不是选项：
`model_bindings` 和 `token_usage` 都指向这一行。

第三条规则最不显眼却最重要：**失败的 provider 不会让任何东西变为不可用。** 401 的意思是“我不知道那边有什么”。把它当作空目录会把该 provider 的所有模型标记为消失，并一次性推翻所有 binding——只因一个被撤销的密钥。该 provider 被**跳过**，失败来源（`infra` | `modelo`）写入报告，使用 [ADR 0020](0020-destravar-gates-qa-secops.md) 的词汇。

出于同样的原因，当 capability 未声明时，基类的 `listModels` 会**抛出**，而不是返回 `[]`：空列表无法与“provider 一个模型都没有”区分，同步会把它读作“全都消失了”。

### 级联在每一层重新验证 capability {#a-cascata-revalida-capability-a-cada-nível}

`resolveBinding` 开始随 id 一起接收 `{availability, supportsToolCalling}`，并返回 `skipped[]`——被丢弃的内容及原因。

不显而易见的一点：当轮次带有工具时，`supports_tool_calling` 的过滤对**每一个**候选都有效，而不只是第一个。否则，一个指向不可用模型的 agent binding 会落到下一层，停在一个仅聊天的模型上，静默违反
[RN-040](../business-rules/custo.md#rn-040)——失败只会稍后在 ToolLoop 中显现为“agent 自己停了”。这正是 ADR 0020 花了九次执行才诊断出的失败模式。

触发条件是轮次**带有**工具，而不是参与者是 agent：context-manager 一个不带 `tools` 的摘要轮次在仅聊天模型上运行良好，锁住它会比规则要求的限制更多。

### 价格：在 `token_usage` 中做快照，在专属表中做审计 {#preço-snapshot-em-token_usage-auditoria-em-tabela-própria}

`token_usage` 增加了 `input_price_per_million_micros` 和
`output_price_per_million_micros`——产生该成本的价格。正是这让旧成本可复现，而不只是不可变
（[RN-044](../business-rules/custo.md#rn-044)）。

考虑过的备选是一张**有效期表**（带有效区间的价格，通过 join 重新计算成本）。被放弃：它会迫使每次成本读取都去解析正确的区间，而该 join 中的一个 bug 会给整个过去重新定价——正是本阶段所禁止的。快照把答案放在行里。

`model_price_changes` 是只追加的，带有前/后值对。它放在专属表中，**不放在 outbox**：`Engine.Outbox.Drain.run_once/0` 过滤
`aggregate_type == "session"`，因此放在那里的价格行将永远 `processed_at` 为空，污染 outbox 的延迟指标。它是不可变的领域日志，就像 `session_events`——CLAUDE.md 的同一条规则。

### engine 调度，api 执行 {#o-engine-agenda-a-api-executa}

同步作为**自我重新调度**的 Oban worker（`ModelSyncSchedulerWorker`）运行，采用仓库自 `OutboxDrainWorker` 起就使用的惯用法——
`Oban.Plugins.Cron` 没有安装，`unique:` 只放在 `kickoff/0` 中，绝不放在 `use` 中，否则正在执行的任务会与自己冲突，在一轮之后断掉链条。

worker 调用 `POST /internal/models/sync`，因为拥有凭据和 provider 注册表的是 api；在 Elixir 中复制注册表意味着维护两个目录。重新调度刻意在工作**之前**进行：一轮糟糕的运行不能断掉周期链条。

UI 的“Atualizar catálogo”按钮通过
`POST /workspaces/:id/models/sync` 调用同一个用例——不存在两个可能分歧的协调过程。

### 策展挂在 `:workspaceId` 下，而目录是全局的 {#a-curadoria-pende-de-um-workspaceid-e-o-catálogo-é-global}

`RolesGuard` 从路由中的 `:projectId` 或 `:workspaceId` 解析有效角色。两者都没有时它无从获取任何角色，一条没有作用域的路由上的 `@RequireRole('owner')` 会**永远拒绝**。因此策展路由是 `/workspaces/:workspaceId/models/*`。

目录本身仍是全局的——`models` 表从来不是按 workspace 的。路径中的 workspace 是 RBAC 的锚点，而不是数据切分，其后果在下文作为 backlog 记录。

## 后果 {#consequências}

- 一个暴露 `GET /models` 的新 provider 无需编写同步就获得同步：声明 `listModels: true`，如果格式不同，再加一个 `parseCatalogo`。
- UI 有了策展界面，支持批量启用，同步报告显示**每个** provider，包括被跳过的。
- `ModelPicker` 按来源重新分组（Local · APIs diretas · Hubs），并获得了“适合 agent”过滤器——RN-040 的错误消息自第 9a 阶段起就引用了它，而它当时并不存在。
- 价格开始以输入和输出**分开**显示。平均值掩盖了不对称：一个输入 3 USD、输出 15 USD 的模型显示为“9”，而那不是任何东西的价格。

## 留待以后的 {#o-que-fica-para-depois}

- **第 9b 阶段的六个 provider**（NVIDIA NIM、Deep Infra、Together AI、Bitdeer
  AI、Vultr 和 OpenRouter）。本次会话环境的出站策略拒绝所有出站 HTTPS，而阶段范围要求在编码前**在官方文档中**验证 `baseUrl`、认证、`usage` 格式和流式传输的特殊之处。基类、合约、同步以及按 `upstream_provider` 的计量都已准备好接纳它们：每一个都是配置 + seed + 凭据 kind。
- **使用真实 OpenRouter 凭据的验收**（真实目录以及在一个 task 中填充的 `upstream_provider`），它依赖上一项。
- **Ollama 和 Anthropic 的 `listModels`。** 两者都有目录端点，本阶段未在文档中验证。它们声明 `false` 并被显式跳过，这是诚实的；以猜测的解析声明 `true` 会把整个目录标记为消失。
- **默认开启的自动价格同步。** 同步只在该行未被标记为 `manual_pricing` 的地方写入价格；把来自同步的价格应用到手动行上需要 owner 的明确决定，而做出这一决定的 UI 尚不存在。
- **按 workspace 的目录。** 今天策展是全局的，路由中的 `:workspaceId` 只是 RBAC 锚点——workspace A 的 owner 启用一个模型，也就为 B 启用了它。
- **Bedrock 和 Azure OpenAI**，自题目设定起就不在第 9 阶段范围内。
- **`brabo_llm_call_errors_total`**，ADR 0041 登记为几乎不起作用。仍作记录，没有顺手修正。
