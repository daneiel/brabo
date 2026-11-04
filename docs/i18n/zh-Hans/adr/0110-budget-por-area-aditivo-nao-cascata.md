---
traducao_de: 23e727d97992c1974a3df731360a293b67fd669c
---

# ADR 0110 — 按区域的预算是叠加的，与项目/会话并列——不是级联，也不是新表

- **状态：** 已接受
- **日期：** 2026-08-23
- **背景：** 关闭 ADR 0038 切分中的“按区域预算”一项，该项自第 8 阶段起被跟踪，最后一次在 ADR 0053 的“后果”中被提及（“`budget per area`……又近了一步：缺失的那张表现在存在了”）
- **扩展（不编辑）：** [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)（`agent_areas`/`max_parallel`）、[ADR 0063](0063-duas-audiencias-para-o-mesmo-gasto.md)（项目/会话预算，`CheckBudgetGateUseCase`/`RecordLlmUsageUseCase`）、[ADR 0064](0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md)（一个**不同**的机制，本 ADR 不应与之混淆）

## 背景 {#context}

`agent_areas`（`dev`/`qa`/`infra`，按项目）自第 14d 阶段起有 `max_parallel`——一个 lead 无需请求即可使用的上限，超出部分由用户授权。而 token 花费此前只有两个上限：项目和会话（`budgets` 表，`CheckBudgetGateUseCase` 在调用前阻止，`RecordLlmUsageUseCase` 在调用后递增）。没有任何东西限制单个**区域**能烧掉多少——一个有五个并行 agent 且没有单独上限的 dev 区域，可以花到会话上限允许的程度，与只有一个 agent 的区域一样，无法按区域看到或限制差异。

## 决策 {#decision}

### 1. 叠加，而非级联——与 ADR 0064 不同的机制 {#1-additive-not-cascade-a-different-mechanism-from-adr-0064}

这是本 ADR 存在所要记录的结论，因为两个机制共享一个词汇（“区域”）而别无其他共同之处。ADR 0064 的模型 binding 级联
（`session > agent > area > project > workspace`）选出**一个**胜者——有值的最具体作用域覆盖其下的一切。预算不是这样运作的，也从未如此：项目预算和会话预算本来就是独立的检查，各自都能单独阻止
（`CheckBudgetGateUseCase.execute` 并行运行两者，任一超出的瞬间即返回
`blocked: true`）。区域预算作为**第三个**独立检查加入，在同一个 `Promise.all` 中，语义同样是“任一个阻止即全部阻止”。不存在“区域预算覆盖项目预算”或反过来——agent 可以被三者中的**任何一个**阻止，不管另外两个怎么说。

### 2. 列放在 `agent_areas` 上，不放在通用 `budgets` 表中，也不放在新表中 {#2-the-columns-live-on-agent_areas-not-the-generic-budgets-table-not-a-new-one}

当时有三个选项：

- **通用 `budgets` 表。** 它有一个 CHECK 约束
  （`budgets_scope_check`），强制 `project_id`/
  `session_id` 中**恰好一个**有值——整张表的形态都围绕两个作用域之间的互斥构建。要通过这个约束塞进第三个（`area_id`，由于区域不是全局唯一的，需要与 `project_id` 组成自己的复合键），就意味着在一张从未被设计成承载两个以上作用域的表上，把它改造成三方互斥规则；而且区域是一种根本不同的作用域：它不需要 `policy`（`block`/`allow`），也不需要另外两者具有的 70/90/100 阈值通知——它是一个更简单的开/关上限，没有仅告警模式。
- **一张新的 `area_budgets` 表。** 技术上干净，但意味着每一次已经触及 `agent_areas` 的读写都要两次访问数据库（以及两个潜在的不一致窗口）——这与 `max_parallel` 已经直接在该行上回答的问题形态完全相同：“这个区域的 lead 无需请求能做多少”。为一个本就是 1:1、并且在每次并行决策中都会被读取的关系做 join。
- **`agent_areas.budget_micros`/`spent_micros`（选定）。** 精确镜像
  `max_parallel`——同一张表，同一行，同样的“lead 的上限，用户的决定”模式，`AgentAreaRepository` 中同样的 `setBudget`/`setMaxParallel` 形态。`budget_micros` 可为空（`null` = 无上限，默认——大多数项目永远不会配置），带一个 CHECK
  （`IS NULL OR >= 0`）；`spent_micros` 为 `NOT NULL DEFAULT 0`，带自己的 CHECK（`>= 0`），通过已经递增项目和会话花费的同一条唯一计量路径（`RecordLlmUsageUseCase`）原子地递增（`spent_micros = spent_micros +
  delta`）——**总是**递增，无论是否配置了上限，这样区域的真实花费从第一个 agent 轮次起就可见，早于任何人设定限额。

### 3. 解析某个参与者属于哪个区域，使用目录的纯函数，而不是成员关系查询 {#3-resolving-which-area-an-actor-belongs-to-uses-the-pure-catalog-function-not-a-membership-query}

`areaDo(agentId)`（`src/domain/agents/agent-areas.ts`，ADR 0053）已经能在**不**访问数据库的情况下回答“这个 agent 是哪个区域的 lead 或成员”——它是基于静态目录的纯函数（`qa`/`infra` 的固定成员，`dev` 按前缀 `dev-` 匹配，覆盖 `dev-<modulo>` **和** `dev-<modulo>-2`，无需知道项目的 `module_map`）。`CheckBudgetGateUseCase` 和
`RecordLlmUsageUseCase` 先只用字符串 `agentId` 调用它，只有在它返回匹配时才查询 `AgentAreaRepository.findByKey`——因此一个没有区域的参与者（聊天中的人，或不属于任何区域的 agent）除了那次纯函数调用之外没有任何成本。这是一条与 `RequestParallelizationUseCase` **不同**的解析路径，后者已经知道上下文是 `dev`，直接查找该键
（`this.areas.findByKey(projectId, 'dev')`）——它不需要解析任意参与者的区域，只需读取它已知的那个。

### 4. `maintainer`，无领域事件，与 `max_parallel` 同样的理由 {#4-maintainer-no-domain-event-same-reasoning-as-max_parallel}

`SetAreaBudgetUseCase` 镜像 `SetAreaMaxParallelUseCase`：`maintainer`
（改变花费上限就是决定产品无需请求能花多少，与启用执行的规则相同），且不发出任何事件（项目配置，没有可记录的会话——`SetAreaMaxParallelUseCase` 中已记录的同样理由）。与 `max_parallel` 不同，该值可以是
`null`，清除它是一等输入，而不是单独的删除路由——与
`RenameSessionDto` 已使用的 `ValidateIf`-叠加-`IsOptional` 的 DTO 形态相同（`name: null` 清除会话名）。

## 后果 {#consequences}

**有利**

- “按区域预算”一项在自第 8 阶段开放之后离开 backlog（`docs/explanation/backlog.md`）。
- 即使没有上限，区域花费也可见——`spent_micros` 不依赖先配置 `budget_micros`。
- 除了现有表上的两列和两个 CHECK 之外没有迁移成本——没有新表、没有新 FK、热路径上没有新增 join（`agent_areas` 在每次并行决策中都已被读取）。

**不利**

- 区域预算没有阈值通知（70/90/100%），与项目/会话不同——这是刻意的简化（第 2 项），不是疏忽：如果证明需要，可以以后添加，而无需触动“叠加还是级联”的决策。
- `RecordLlmUsageUseCase` 除了 `BudgetRepository` 之外还依赖 `AgentAreaRepository`——唯一计量路径上多了一个依赖，被接受是因为把它拆成两条写入路径会重新打开该类自己的文档注释所警告的“并非按构造强制”的风险。

## 考虑过的备选方案 {#alternatives-considered}

**在通用 `budgets` 表中增加第四个值 `budgetScope: 'area'`。**
已在第 2 项中拒绝——CHECK 约束以及 `policy`/阈值的形态不适合一个简单得多的作用域，而区域已经有一个天然的归宿（`agent_areas`），`max_parallel` 已证明了这一点。

**与项目/会话做成级联（最具体者胜）。** 那会抹去本功能与 ADR 0064 的模型 binding 之间的区别，并且会是一个比今天**更弱**的保证——一旦下层作用域可以覆盖它，“项目预算总是阻止，不管其他任何情况”就不再成立。一开始就被拒绝；记录在这里主要是因为与 ADR 0064 的名称冲突让混淆两者的诱惑真实到值得写下来。

## 参考 {#references}

- [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)——`agent_areas`/
  `max_parallel`，本 ADR 所镜像的模式
- [ADR 0063](0063-duas-audiencias-para-o-mesmo-gasto.md)——项目/会话预算，`CheckBudgetGateUseCase`/`RecordLlmUsageUseCase`
- [ADR 0064](0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md)——模型 binding 级联，一个与本机制**不同**的机制
- `apps/api/src/domain/llm/area-budget.ts`——`isAreaBudgetExceeded`，纯谓词
- `apps/api/src/domain/agents/agent-areas.ts`——`areaDo`，此处复用的纯成员关系解析器
- [RN-443](../business-rules.md#rn-443)
