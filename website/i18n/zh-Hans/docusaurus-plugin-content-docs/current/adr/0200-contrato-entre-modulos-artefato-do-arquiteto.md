---
traducao_de: f97894b6489d2e6970b87610f36b64414277b26d
---

# ADR 0200 — 模块间合约成为 Arquiteto 的版本化工件，dev agent 读取它而不是别人的 worktree

## 状态 {#status}

**Accepted.** 2026-10-01（AT-276，故事 HS-071，史诗 EP-030，第 36 轮；
负责人 10月1日的决定：*"o contrato entre módulos vira artefato versionado
do Arquiteto (no molde de `module_map`/`c4_diagram`), lido pelos devs pela
ferramenta de leitura; mudar contrato é nova versão do Arquiteto"*）。扩展了
[ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)、
[ADR 0068](0068-diagrama-c4-do-arquiteto.md) 和
[ADR 0131](0131-roteamento-de-modulos-para-infra.md) 的无表工件设计；在
[ADR 0060](0060-superficie-de-leitura-de-codigo.md) 受约束的读取之下，把“写入的 agent 必须能够读取”（RN-164/165）这一规则应用到 dev agent。

## Context {#context}

### 症状 {#o-sintoma}

2026-09-29 的真实使用（分析 `analise-uso-real.md`，A30 项，6(e)）：
`dev-board-engine`，seq 1157/1230/1268/1344/1486——五个轮次在其他模块的 worktree 中读取接口。对照 AT-237 的测量
（[medicao-do-jev.md](../explanation/medicao-do-jev.md)），这个 agent 在整轮中有 24 个带工具的步骤：**24 步中有 5 步，约占它步骤的 ~21%**，是在探索别人的接口。该项目有七个 dev 模块
（`piece-catalog`、`retro-renderer`、`input-keyboard`、`game-session`、
`scoring`、`persistence`、`board-engine`）。

**这里无法测量的：** 这五个步骤的 token 成本。9月29日的 event log 存在于维护者的本地实例中（compose
`brabo-dev`），不在本环境；上面的数字来自分析以及 Jev 测量中的 agent 表，而不是重新执行的查询。成本上的收益可以之后用 AT-239 的同一把尺子（按参与者的 `token_usage`）测量。

### 产品给了 dev 什么（在 `dev` 上测量，2026-10-01） {#o-que-o-produto-dava-ao-dev-medido-em-dev-2026-10-01}

- **`module_map`**（`domain/architecture/module-graph.ts`）是
  `{name, stack, responsibility, dependsOn[]}`。它说明**谁**依赖谁，却对一个模块提供**什么**只字不提。Arquiteto 的工件
  （`module_map`、`project_image`、`module_routing`、`c4_diagram`）都不携带接口。
- **dev 的上下文**（`Engine.Dev.ContextBuilder`）带来 story、task、业务规则以及按模块过滤的 ADR——没有任何邻居的接口。
- **dev 的工具**（`Engine.Dev.Tools`）是 `read_file`、
  `search_workspace`、`write_file`、`terminal`、`rag_search`/`rag_feedback` 以及终止类工具：没有任何读取项目工件的工具。看到邻居接口的唯一方式是用 `terminal` 读取另一个 dev 的 worktree——一个尚未到达 `dev` 的分支上**进行中**的代码，并且可能在读取之后改变。

## Decision {#decision}

1. **合约是 Arquiteto 的工件 `artifact.module_contracts`。** 无表：事件就是记录，按 payload 中的 `version` 版本化，当前值是 `version` 最大者，平局按 `seq` 决定——与
   `GetC4DiagramUseCase`/`GetModuleRoutingUseCase` 相同的归约。每次声明携带**完整**列表并**取代**之前的；修改合约就是 Arquiteto 发出的新版本，之前的版本继续留在日志中。
2. **格式是能解决问题的最小格式：按模块，只写它**暴露**的东西。**
   `{modulo, expoe: [{tipo, assinatura, descricao}]}`，`tipo` 取
   `funcao | rota | evento | dado`，`assinatura` 必填（最多 300 个字符），`descricao` 可选，每个模块 1 到 40 项。
   - **它**消费**什么不写进合约。** 在读取时从当前 `module_map` 的 `dependsOn` 推导——与 C4 的 Container 层级相同的论据（ADR 0068）：地图已经验证了这些边无环，而手写的第二份列表会在第一次修订地图时就与之分歧。“模块 Y 使用 X 的哪些项”这一粒度被排除在外：Arquiteto 在实现之前并不知道，而消费 X 的人会读取 X 暴露的完整列表。
   - **`tipo` 是枚举，`assinatura` 是自由文本。** 类型是会改变**使用**该项方式的东西；签名无法放进单一 schema，因为每个模块的技术栈是自由的（一个 Elixir 函数和一条 Go 路由）。
   - **上限的存在是因为合约会进入每个 dev 的上下文。** 一个变成整个 API 文档的合约，会让每一步都付出读取 worktree 在一步中付出的代价。
3. **与 `module_map` **分开**的工件，绝不是它多出的一个字段。** 地图是一张表，被整个执行过程读取（task 的 claim、路由、C4），修订它会重新打开环检测。合约以另一种节奏变化——接口在 dev 工作时被发现——修订其中一个不能重新发出另一个，也不能与另一条战线争夺它的 schema（第 36 轮的资源 lane 会给 `module_map` 增加字段）。
4. **Arquiteto 获得 `declare_module_contracts`**（`:direct`，像
   `route_modules_to_infra`：架构声明，无外部效果，绝不是 `proposed_action`）。api 验证并以完整原因拒绝，原因回到模型（RN-061）：地图中不存在的模块（列出有效的）、没有 `module_map`、重复的模块、`expoe` 为空或超过上限、未知的 `tipo`、`assinatura` 为空或过长。它的 kickoff 增加第 5 步；该工具进入
   `Engine.Harness.IdiomaDaResposta.ferramentas_de_artefato/0`（RN-623）。
5. **dev agent 获得 `listar_contratos_de_modulos`**（`:direct`，在
   `Engine.Dev.Tools` 的注册表中，不在全局中）。**受约束**的读取：通过路由路径把作用域封闭在项目中（`GET internal/projects/:projectId/module-contracts`），**没有**任何参数，dev 的模块来自循环的上下文（`ctx.module`，由 `DevAgentServer` 放入），绝不来自模型。知道模块时，它只完整显示自己的模块以及它所消费的模块；消费它的模块和其他模块以名称出现。文本中最多 120 项，并说明被省略的部分。已离开地图的模块的合约会被**说明**，绝不被归属。
6. **dev 的 kickoff 说明合约存在以及在哪里读取它**，并说明另一个模块的接口不在其 worktree 中读取。当所需模块没有合约时，工具说明该怎么做：按照 story 和 task 所说的实现，如果 task 依赖一个不存在的接口，就 `report_blocked`，点名模块和所缺的东西——让 Arquiteto 去声明。它不会让人重读 worktree。

## Consequences {#consequences}

- **dev 以前花在探索接口上的步骤变成一次固定成本的读取**，而他读到的是 Arquiteto 固定下来的版本，而不是另一个 dev 进行中的代码。
- **接口开始有主人和版本。** 修改它的是 Arquiteto，以一个新版本；需要变更的 dev 不在邻居的代码中去做，而是阻塞并点名所缺的东西。
- **这不是锁。** 没有什么阻止 `terminal` 读取另一个 worktree：工具和 kickoff 改变的是 dev 所知道的路径，并不禁止另一条。关闭对别人 worktree 的读取将是路径约束（ADR 0055），另一条战线。
- **Arquiteto 在 kickoff 中多了一步**，在**同样**的 14 次迭代上限之下。在大型架构中它能否与其他七步一起放得下，未测量；耗尽上限仍然会被叙述（`toolloop.limit_reached`，RN-166）。
- **没有合约的项目继续工作**：读取返回地图，每个模块 `expoe: null` 并附带提醒。没有迁移，没有表。
- **工件的 `docs/` 文件夹（ADR 0148）获得该类型**作为版本化类型：当前值覆盖同一个文件，与其他四个一样。
- **不在此处，已声明：** 专属界面（合约出现在时间线和 `docs/` 文件夹中，而不在 Arquitetura 标签页中）；对 Jev 收益的影响（AT-239 按步骤测量工具；这一改动改变了 dev 的菜单，而
  `scripts/jev/catalogo.json` 是 9月29日的快照，此处未重新生成）；ExUnit 测试是在 `mix` 之外运行的（本环境中 `repo.hex.pm` 返回 403）——由 CI 证明它们。
