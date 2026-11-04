---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0087 — UX Designer 作为对话式 agent 加入

- **状态：** 已接受
- **日期：** 2026-08-17
- **背景：** 产品所有者的明确决定，提前触发 `docs/fluxo.yml` 早已为该角色声明的分离条件

## 背景 {#contexto}

`docs/fluxo.yml`（ADR 0085）早已把 `ux-designer` 记录为团队目标模型中的一个角色，`status: proposto`，`hoje_absorvido_por: criativo
(discovery) + design/ (design system como dado)`，并附有一条客观的分离标准：

> Quando o projeto GERENCIADO tiver interface própria a desenhar — hoje o
> design system é insumo estático. Separa quando protótipo virar artefato
> recorrente.

这一条件**没有触发**。Brabo 在生产中还没有真正构建带有自身 UI 的项目；设计系统（`design/tokens.css`、`design/COMPONENTS.md`）仍是 Arquiteto 和 dev agent 查阅的静态输入，从来不是需要反复做 UX 决策的活项目。

尽管如此，产品所有者决定现在就构建这个 agent——这是**有意识**的提前决定，记录在此，以免被误认为是对标准的误读。该角色此前所吸收内容的历史仍以注释形式保留在 `docs/fluxo.yml` 中：之前的文本没有被删除，只是不再是当前状态。

## 决策 {#decisão}

**UX Designer 作为第五个对话式 agent 加入——Criativo、PO、Arquiteto、Dev Lead，现在还有 UX Designer——**独立**（没有区域、没有子 agent），镜像 `Engine.Agents.DevLeadServer` 的设计。**

### 各个部件 {#as-peças}

1. **`Engine.Agents.UxDesignerServer`**（`apps/engine/lib/engine/agents/ux_designer_server.ex`）——每个会话一个 GenServer，从 event log 恢复，流式输出，有界的工具使用循环，上限 14（与 Arquiteto/Dev Lead 同一量级：**推理**型 agent，而不是像 Criativo/PO 那样的轻量对话，后者上限 12）。由指向"ux-designer"的 `accepted` handoff 激活——机制是**通用**的（api 中的 `ActivateAgentUseCase`/`canActivateAgent` 早已接受任何有已接受 handoff 的 agent；那里一行都没改）——kickoff 只在**全新**启动时运行（重启不会重新生成原型）。
2. **kickoff 读取 `artifact.product_brief`**，即 Criativo 产出的**同一个**"业务需求"——没有新工件，与 `ArquitetoServer.build_kickoff/1` 已有的读取模式相同。
3. **设计系统在身份中**被**描述**（`Engine.Harness.Agents`，条目 `"ux-designer"`），是静态文本，包含 `design/tokens.css` 的 token（语义色、字体、间距、圆角）和 `design/COMPONENTS.md` 的约定（按钮变体、图标风格）。对话式 agent **没有**读取仓库文件的工具——没有可复用的工具——而身份是提示中唯一在**每个**轮次都存在、而不只是在 kickoff 中出现的层。
4. **`propose_prototype`**（`Engine.Agents.UxDesignerTools`，`apps/engine/lib/engine/agents/ux_designer_tools.ex`）——**唯一**的工具：`personas`、`jornadas`、`prototipo`（`telas` + `anotacoes`）和 `resumo`。写入 `artifact.prototipo_navegavel`，并就**同一个**工件向"po"和"dev-lead"提供 handoff。
5. **`Engine.Agents.UxDesignerSupervisor`**——`DevLeadSupervisor` 模式的精确复制；在 `Engine.Application` 中注册在它旁边。`EngineWeb.AgentCommandController` 增加了其他四个对话式 agent 已有的三个子句（`start`、`message`、`via_for`）。
6. **`apps/web/src/lib/agents.ts`**：`AgentKey` 中加入 `'ux-designer'`，条目使用 `color: 'var(--accent)'`。`design/tokens.css` 的五个语义 token 中没有一个是其他 agent 未使用的——`--accent` 被复用得最少（只有 Arquiteto），而设计系统的规则禁止新的十六进制值。`icon: PencilIcon`，目录中唯一一个在语义上与设计/编辑相关且尚无归属的图标。

### `artifact.prototipo_navegavel`：没有表，api 中也没有专门的用例 {#artifactprototipo_navegavel-sem-tabela-e-sem-caso-de-uso-dedicado-na-api}

这是编码前需要调查的决定，因为"无表工件"的两个先例（`artifact.project_image`，ADR 0065；`artifact.c4_diagram`，RN-149）走的路径与 `artifact.business_rule`/`artifact.product_brief` **不同**，在看清**原因**之前，两条路径看起来可以互换。

`choose_project_image`/`create_c4_diagram` 在 api 中有**自己的**用例（`DecidirImagemDoProjetoUseCase`、`CreateC4DiagramUseCase`），因为每一个都有结构上的理由：

- C4 的 Container 层由当前 `module_map` **派生**——模型不能重新输入这些内容，否则可能与真实来源分歧；
- 镜像决定有领域层的拒绝条件（显式 tag、资源上限），不止一个使用者需要以同样方式遵守。

`propose_prototype` 两者都没有。persona、旅程、界面和注释都是**自包含**的内容——只有 UX Designer 自己写、只有他回读，没有任何内容派生自其他工件，也没有等待复用的第二条共享领域规则。因此它走 `business_rule`/`product_brief` 的路径：在 **ENGINE** 中做**形式**校验（`Engine.Harness.ArtifactSchemas`，类型 `"prototipo_navegavel"`），并通过 api 早已为任何 `session_event` 暴露的**通用**路径写入（`EngineApiClient.append_event_returning/3`，没有新路由）。开一个 `CreatePrototipoUseCase` 会复制 `CreateC4DiagramUseCase` 的形式，却没有让它在那里成立的两个理由中的任何一个——没有论据的复杂性。

### 一个工件，两个 handoff——绝不是两个工件 {#um-artefato-dois-handoffs--nunca-dois-artefatos}

`docs/fluxo.yml` 列出了该角色的两个输出：`prototipo`（给 PO）和 `spec-visual`（给 Dev Lead）。显而易见的诱惑是为"spec-visual"做第二次工具调用或第二个工件。决定是**不**重复：原型（界面 + 行为注释）**就是**视觉规格——PO 读 `resumo`/`prototipo` 来设计 backlog，Dev Lead 读**同样的** `telas`/`anotacoes` 作为实现参考。同一内容的两份副本会在第一次只改一边时分道扬镳——这与 C4 不重新输入 `module_map` 早已成立的论据相同。

### 轮次在第一次成功时停止——Dev Lead 的教训，但没有它的挂起 {#o-turno-para-no-primeiro-sucesso--a-lição-do-dev-lead-sem-a-suspensão-dele}

`UxDesignerServer` 复用了 `DevLeadServer` 设计中不依赖 ADR 0086 也能成立的那一半：一次**成功**的 `propose_prototype` 结束轮次，以免模型再次提议、产出两个总数相同的原型（这正是促成 Dev Lead 中那道守卫的真实缺陷）。ADR 0086 的**另一**半——挂起等待 `proposed_action`——在这里不适用：`propose_prototype` 没有任何外部效果（它是内容，不是行动；没有"RN-083 的上限所收取的花费"的对应物），所以它以简单事件诞生，就像 `execution.plan_proposed` 在 0086 之前那样。

## 后果 {#consequências}

**有利**

- 该角色以与其他四个对话式 agent **相同**的严谨性启用——迭代上限、恢复、带来源叙述的失败（RN-059/163）——而不是在 Criativo 内部作为临时功能生长。
- api 中零新路由：通过 handoff 激活的机制、通用的 `append_event_returning` 和通用的 `create_handoff` 已经足够。api 中唯一的新暴露面是名册中的 `uxDesignerActive` 字段（RN-287），与 `infraActive` 早已做的对称。
- `docs/fluxo.yml` 不再描述一个代码中没有的角色——`status: active`，真实的输入/输出，没有 `_alvo` 后缀。

**不利**

- **条件被提前触发，出于明确决定。** 原始的分离标准（受管项目中有自身界面）本身不足以作为理由——之所以被接受，是因为产品所有者在知情的情况下提出了要求。
- **`teste-de-usabilidade` 不可及。** 它需要真实的人类用户测试界面；没有 agent 能替代。不做模拟。
- **`metricas-de-uso` 仍是已声明的缺口。** 它依赖 `analytics` 角色（**产品**指标），`docs/fluxo.yml` 中仍为 `proposto`——没有它，UX Designer 对应的输入没有真实来源。
- **仪表盘卡片和团队面板分别计算 `uxDesignerActive`**（RN-090）——与 `infraActive` 早已存在的重复相同，出于同样的理由接受：api 回答**事实**，展示属于 web。

## 考虑过的替代方案 {#alternativas-consideradas}

**等待分离条件触发。** 这是本次改动之前对 `docs/fluxo.yml` 的字面解读。因产品所有者的明确决定被拒绝——见背景。

**`artifact.prototipo_navegavel` 在 api 中使用专门的用例，仿照 `CreateC4DiagramUseCase`。** 被拒绝：证明那种模式合理的两个理由（派生内容、共享的领域拒绝）在这里都不适用。照搬形式而没有理由，是读代码的下一个人不得不独自去辩护的复杂性。

**为"spec-visual"做第二次工具调用/第二个工件。** 被拒绝：原型本身就是视觉规格。同一内容的两份副本（一份给 PO，一份给 Dev Lead）会有在第一次只改一边时分歧的风险。

**UX Designer 作为某个新区域的子 agent。** 被拒绝：该角色中没有任何东西需要内部委派或多个并行执行者——它是每个会话**一个**人的推理，正如 Criativo/PO/Arquiteto/Dev Lead 已经是的那样。

## 参考 {#referências}

- `docs/fluxo.yml` — `id: ux-designer` 块，原始的分离条件
- [ADR 0085](0085-fluxo-como-registro-declarativo.md) — `docs/fluxo.yml` 作为角色的声明式登记
- [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) — 创建 Dev Lead，本 ADR 复制的模子
- [ADR 0086](0086-dev-lead-plano-suspende-para-aprovacao.md) — 为什么 `propose_prototype` **不**挂起（没有外部效果）
- [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)，[RN-149](../business-rules/autenticacao.md#rn-149) — `artifact.prototipo_navegavel` 遵循的无表工件模式，以及为什么它**不**需要另外两个所拥有的专门用例
- `apps/engine/lib/engine/agents/ux_designer_server.ex`、`ux_designer_tools.ex`、`ux_designer_supervisor.ex`
- `apps/engine/lib/engine/harness/agents.ex`、`artifact_schemas.ex`
- `apps/web/src/lib/agents.ts`、`agent-status.ts`
