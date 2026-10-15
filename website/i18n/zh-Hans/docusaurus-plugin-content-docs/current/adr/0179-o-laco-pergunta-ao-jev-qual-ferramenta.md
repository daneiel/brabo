---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0179 — 循环向 Jev 询问用哪个工具，用户的模型只看到剩下的菜单

## 状态 {#status}

**已接受。** 2026-09-29（AT-238，故事 HS-063，epic EP-029）。它实现了 AT-235 的规格，采纳维护者在 AT-236
（2026-09-28）中的十六项决定，以及下文关于采用标准的 2026-09-29 决定。它不取代任何 ADR：它在
[ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md) 的 provider 契约和
[ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md) 的模型目录**之外**增加一个部件，
并复用计量、预算（ADR 0110）和所有者的凭据（RN-058）而不改变它们。

## 背景 {#context}

如今为 agent 的每一步选择工具的，是**用户的聊天模型**，它每次调用都要看一份 7 到 19 个定义的目录。2026-09-27
至 29 的测量（`docs/explanation/medicao-do-jev.md`）把 Jev——OpenRouter Decisions API 的模型
`typesafe/jev-1.13`，它以概率回答一道多项选择题——放到 328 个已记录的真实步骤上做对照：

- **Jev 的 top-1：73%（66–79%）**，低于 AT-237 要求 Jev **独自选择**所需的 90%。选择并强制不可行。
- **P3 策略的菜单覆盖率：91%（85,1–94%）**——即 agent 实际调用的工具落在菜单 {Jev 的选择，同一次执行的
  上一个工具} **之内**的步骤比例。Jev 的 top-2 覆盖 90%。覆盖率是端到端准确率（聊天模型的准确率，现在面对
  1,6 个工具而不是 7,4 个）的**上限**，而不是准确率本身。
- P3 在 160 个验证步骤中有 98 个只提供**一个**工具，模型每次调用读取的定义从 746 个 token 降到 138 个。

因此，Jev 适合用来**限制**菜单，而不是替它做决定——这正是 AT-236 已经决定的（回答 12：Jev 只做限制）。

### 维护者关于标准的决定（2026-09-29） {#a-decisão-do-mantenedor-sobre-o-critério-2026-09-29}

AT-237 的采用标准是置信区间下限 **90%**。没有任何策略达到（P3：85,1%）。2026-09-29，维护者在看到上述数字后
**把标准降到了 80%**，并下令实现 P3。这是所有者的决定，不是发现：P3 的下限（85,1%）超过 80%，本仓库中任何其他
文字都不应说采用“通过了 90%”。测量**没有**证明的东西仍然声明如下：

- 覆盖率是上限，而在重放中测得的端到端准确率，根据对聊天模型的假设，在 62% 到 91% 之间；
- Wilson 区间把 160 个步骤当作独立的，而它们来自 10 次执行——诚实的区间更宽；
- **真正的验证是 AT-239**，实时地对比使用和不使用 Jev 时回合的步骤数、延迟和成本。本 ADR 交付的是机制，按
  AT-236 的指示默认开启，并备好按 workspace 的开关。

## 决策 {#decision}

**1. 路由器位于 api 中，在 `llm-turn` 内部，位于一个自己的端口之后。**
`ToolRouter`（`apps/api/src/application/ports/tool-router.port.ts`）不是 `LLMProvider`，也不在
`LLMProviderRegistry` 中：Jev 做决定而不聊天，不经过 provider 契约测试套件，并且**不进入 `models` 目录**。
适配器（`JevToolRouter`）与 `POST https://openrouter.ai/api/alpha/decisions` 通信，使用在
`scripts/jev/jev.ts` 中**测得**的格式——`questions` 是一个以问题 id 为键的**对象**（AT-235 的说明写的是列表，
而 API 返回了 400）。一个唯一的用例 `DecidirFerramentaDoPassoUseCase` 由**两个**回合用例
（`RunLlmTurnUseCase` 和 `StreamLlmTurnUseCase`）在已解析的 provider 和预算闸门通过之后、`provider.chat` 之前
调用。七个对话型 agent、dev agent 和 gate 的 `ToolLoop` 以及 Infra Lead 全都经过它们（AT-236 回答 2）；只有
Anamnese（已暂停）和压缩用的摘要器不在其中。

**2. 何时查询它——所有条件都满足时，才会有调用：**
回合模型的 provider 是 `openrouter`（AT-236 回答 1，解读 (a)）；请求带有两个或更多工具；回合中有 agent；engine
没有要求完整目录；workspace 没有关闭它。Jev 的 key 与聊天已解密的**同一个**——workspace 所有者的（RN-058）——
没有产生任何新的凭据读取。provider ≠ `openrouter` 时没有任何调用发出，连 workspace 的读取也没有。

**3. 策略是 P3，而且只做限制。** 这一步的菜单是 {Jev 选择的工具，同一次执行的上一个工具}，按目录顺序。如果
Jev 回答 `responder_sem_ferramenta`，或这一步的目录中没有上一个工具，菜单就是**完整目录**（AT-236 回答 12：
“catálogo inteiro, só registra”）。没有 `tool_choice`：只限制菜单，模型仍然可以用文本回答（回答 7）。
**v1 没有置信度阈值**——测得的 P3 不使用阈值，AT-236 回答 4 要求把它从测量中去掉，而 P3 的测量也不产出阈值。
置信度在每一步都会被**记录**，由 AT-239 提出阈值（如果曲线不同，就按 agent）。

**4. `state` 是产品在这一步之前真正拥有的东西**——即第二轮获胜的 `escopo` 变体的字段，在 api 内部从 engine
已经发送的 `messages` 中截取，不读数据库：`agente`（`agentId`）、`contexto`（第一条 `system` 消息的开头，
1.500 个字符）、`pedido`（最后一条 `user` 消息）和 `passos_recentes`（该消息**之后**最近 6 次工具调用，参数和
结果截断到 500）。每个请求上限 8 千 token，即 Jev 窗口的四分之一；超出则回退 `estado_grande`。与测量相比的两
处差别，已声明：`contexto` 是真实 `system` 的开头，而不是重放中的“操作者身份 + 指令”；而在修正中的 dev agent
里，`pedido` 是修正消息，即最后一条 `user`，而不是 kickoff。

**5. 回合绝不因 Jev 而失败。** HTTP 错误（包括已变化的 alpha 端点的 404/410）、超时（上限 2.000 ms，
`TOOL_ROUTER_TIMEOUT_MS`；测量中 328 个请求有 0 个超过它）、网络错误、意外的 JSON、选项之外的选择、过大的状态、
与保留选项的名称冲突：provider 收到完整目录，原因连同 RN-059 的**来源**写入事件（前三种为 `infra`，两种形式
问题为 `modelo`，我们自己的为 `codigo`）。适配器从不抛出，而用例还用一个最后防线的 `try/catch` 保护自己。

**6. 策略不变。** Jev 不批准、不拒绝、也不选择模型。留在菜单中的工具照常变成 `Proposed Action`，并像往常一样
经过 `decide()` 和绝对上限；路由器甚至不导入这些模块，engine 的一个测试断言它的模块不认识它们。如果模型调用了
一个**不**在这一步菜单中的工具（从历史中记得的），engine 照常派发它，事件只记录 `foraDoCardapio`（AT-236 回答
13：Jev 收窄，而不禁止）。迭代上限保持不变：对 Jev 的调用位于同一个 `llm-turn` **之内**，循环只在派发之后
才递增。

**7. 按步骤记录，供 AT-239 测量。** engine 在门面 `EngineApiClient` 中写入 `tool_router.decided`（只在一个
地方，供七个服务器和 `ToolLoop` 使用），带前后的菜单、选择、置信度、第二选项、上一个工具、`aplicado`、
`motivoDaQueda`、`origemDaQueda`、延迟、成本和 `foraDoCardapio`。指标由脚本从日志和 `token_usage` 中得出，
绝不手工记录。api 在 `llm-turn` 以及流的 `final` 帧中，以新的可选字段 `toolRouting` 返回这一步；旧的 engine
会忽略它。

**8. Jev 的花费是真实的花费。** 通过同一个 `RecordLlmUsageUseCase`（唯一的计量路径，带项目、会话和**领域**
预算）写一行 `token_usage`：`actor` 是**agent 本身**（回答 10——如果用自己的操作者，花费会逃出 ADR 0110 的
领域预算），`provider = openrouter`，`modelId = null`，`modelName = typesafe/jev-1.13`（花费标签页正是据此把
Jev 与聊天区分开，回答 8），`estimated = false`，`costMicros` = **响应**中的 `usage.cost`，单位为微美元。每
百万的价格是**隐含的**（响应本身的 `custo ÷ tokens`，回答 11），该行在新列 `price_implicit` 中说明这一点，保持
`tokens × preço = custo`（RN-044），而不假装存在目录价格。在 Jev 和聊天之间**不**重新查询预算闸门（回答 15）。
Jev 的成本在 `toolRouting.custoMicros` 中回到 engine，`ToolLoop` 把它加入自己的本地预算，而不动 `usage`。
Brabo 对**聊天**的计量记录得比 OpenRouter 收取的少（目录价格，没有缓存和推理）；Jev 的不受此影响，因为它使用
响应返回的成本。

**9. 开关属于 WORKSPACE**（回答 3），列 `workspaces.tool_router_enabled`，默认开启，migration 0066，由
`PUT workspaces/:workspaceId/tool-router` 修改（`owner`，即付费 key 的所有者）。api 在回合路径上从自己的数据库
读取这个 flag；engine 什么都不读，也不多做 HTTP。关闭时，不会有任何对 Jev 的调用发出，也不会产生任何事件。AT-235
提议的安装变量 `TOOL_ROUTER=jev|off` **没有**诞生：维护者的决定是按 workspace。只诞生了
`TOOL_ROUTER_TIMEOUT_MS`。

**10. agent 请求完整目录的路径**——AT-281 显示 61% 的步骤会有只含**一个**工具的菜单，而错误的菜单不能变成死胡同。
机制是最简单的、不开新约束之门的那种：如果菜单被限制了（`aplicado`），而模型**没有调用工具**就回答了（也不是
ADR 0020 可恢复的文本形式），且 provider 没有错误，门面会以 `catalogoCompleto: true` **重复**这一步**一次**，
这让 api 跳过 Jev。重复请求的是**更多**工具，绝不是 agent 原本没有的工具；api 除了“别限制我”之外不信任 engine
的任何东西；菜单从来都不是安全边界。在对话型的流中，只有在**没有任何东西**写给用户时才会重复（已投递的增量无法
撤销）。重复的代价是两次聊天调用，两者都被计量；第一次的 `toolRouting` 被标记为 `repetidoComCatalogoInteiro`。
被放弃的有：作为新工具的 `request_full_toolset`（它是每个 agent 中新的工具表面，而菜单只有一个工具的模型没有
理由去调用它），以及作为信号的 `report_blocked`（它会结束循环）。

## 后果 {#consequences}

- 每个符合条件的步骤多出一次串行调用（先 Jev，后聊天）：延迟约 +0,2–0,4 s（测量中记录的行），每步约
  US$ 0,00005。收益——每次调用更少的定义，也许更少的步骤——是假设，由 AT-239 测量。
- 当 Jev 出错、菜单让模型拿不到正确的工具时，代价是多一轮（第 10 项）。这种重复的比率在事件中
  （`repetidoComCatalogoInteiro`），它就是菜单不好的指标。
- 端点是 **ALPHA**。如果它变了，手动 smoke（`jev-tool-router.smoke.spec.ts`，上限 US$ 0,05，没有
  `OPENROUTER_TEST_KEY` 时跳过）会失败，而在生产中，每一步都会落到完整目录，事件中带 `erro_http` 或
  `resposta_invalida`——按 workspace 的开关就是为回退太吵的情况而存在的。
- Brabo 一侧的超时可能已被 OpenRouter 收费，而我们看不到 `usage.cost`：这笔花费不会进入 `token_usage`。已声明，
  未测量。
- key 在每个 workspace 安装中是唯一的，不按 agent，也不按项目。

## 本 ADR 不做什么 {#o-que-este-adr-não-faz}

- **不测量收益**（AT-239），也不校准阈值；v1 没有阈值。
- **不在界面上显示任何东西。** AT-236（回答 3）希望界面显示这一步由 Jev 路由，并附置信度，以及（回答 16）活动条
  叙述“escolhendo ferramenta”。数据存在（事件以及流的 `tool_routing_started` 帧，engine 因其类型未知而忽略它）；
  界面和活动条是 `apps/web` 的工作，不在这条 lane 内。
- 除了门面已经覆盖的之外不改变 agent 服务器，不路由 Anamnese，也不把 Jev 放进模型目录。
- 不决定是否提高 2.000 ms 的上限，也不决定 Dependabot 生态对固定版本 `typesafe/jev-1.13` 的处理（通过 PR 升级，
  回答 5）。
