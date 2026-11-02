---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0097 — 为仪表盘的“N 个 agent 在线”直接读取 engine 的 schema

- **状态：** 已接受
- **日期：** 2026-08-18
- **背景：** 关闭 backlog 条目“仪表盘上的 N 个 agent 在线”（RN-409），继承自 dogfooding 的收获（FASE 13c）

## 背景 {#contexto}

仪表盘需要一个**真实**的存活数字——此刻有多少 agent 正在工作或有等待决定的待办，绝不是团队规模或历史在场（已作出的产品决定，见 RN-409）。事先的调查确认，这个数据只存在于**两个**不同的地方，而按现状没有一个能服务于仪表盘：

1. 真正的实时状态只存在于**客户端**，从事件日志派生（`deriveAgentRoster`），而且只在项目**打开**时——仪表盘一次列出所有项目，不打开任何会话。
2. 每个 dev agent 的当前状态已经被持久化——`dev_agent_states`，一张 **ENGINE** 的表，位于 Postgres schema `"engine"`（Ecto）中，复合键为 `(project_id, agent_id)`，`status` 取五个值之一（`working`/`idle`/`idle_tripped`/`awaiting_gate`/`awaiting_approval`，RN-047/ADR 0052）。

`api` 和 `engine` 共享**同一个**物理数据库（`brabo`/`brabo_test`），使用**同一个**连接用户/角色（`brabo`），按 schema 分隔——不是按实例，也不是按凭据。CLAUDE.md 中声明的通信约定（“eventos via Postgres + HTTP interno com service token para comandos síncronos”）覆盖的是**效果**——改变另一侧状态的命令——而不是读取报告。而且已经存在跨 schema 直接读取的先例：`apps/api/scripts/medir-execucao.ts`（FASE 13b）已经以同样的方式通过原始 SQL 读取 `engine.oban_peers`，以检测测量执行期间 engine 的重启——只不过是作为手动**脚本**，从未被自动化测试覆盖。

仪表盘的读模型（`DrizzleProjectsSummaryRepository`，RN-090）要求每个**整个 workspace** 只有**一次**聚合查询，绝不是每个项目一次——这是 `projects-summary.repository.spec.ts` 针对 2 个和 20 个项目证明为常数的性质。

## 决策 {#decisão}

在线 dev agent 的计数**直接**读取 `engine.dev_agent_states`，通过按 workspace 批处理的原始 SQL（`WHERE project_id IN (...) AND status NOT IN
('idle', 'idle_tripped') GROUP BY project_id`），放在已经批处理读模型其他十一个查询的**同一个** `Promise.all` 中——把 `medir-execucao.ts` 的模式从手动脚本提升为经过测试的生产代码（表的 fixture 在 `test/support/global-setup.ts` 中，位于同一个 `"engine"` schema 下）。

考虑过并**拒绝**的替代方案是在 engine 中暴露一个新的内部 HTTP 路由（`GET /internal/dev-agent-states/online-counts?projectIds=...`）并由 api 调用它。三个原因：

1. **RN-090 的性质关乎 SQL 查询，而不是网络调用。** 在 `DrizzleProjectsSummaryRepository` 内部——今天是一个**纯**数据库读取的仓库——引入 HTTP 依赖，会在一个今天只可能因 Postgres 宕机而失败的路径中引入网络故障，而查询计数测试（`pool.query`）将不再能看到调用的真实成本。
2. **这个数据是状态，而不是命令。** 内部 HTTP 的约定是为了在两侧之间同步**动作**（激活 agent、重新验证指令）——读取一张物理上就在旁边的状态表，与 api 读取自己的数据是同一种读取，只是经由不同的 schema。
3. **新增的攻击面最小。** 内部 HTTP 路由需要 service token 认证、自己的 DTO、两侧的契约测试——比在一个已经汇总了十四个查询的 `Promise.all` 中多加一个 SQL 查询更重。

## 后果 {#consequências}

- `DrizzleProjectsSummaryRepository` 开始依赖一张 api **不**迁移的表。接受的假设：运营产品的人会同时迁移两侧（`db:migrate` **和** `engine:migrate`）——这已经是产品其余部分的隐含假设（没有 `engine:migrate`，没有任何 agent 能启动，仪表盘无论如何都会显示零历史）。如果只有 api 迁移了，查询会**失败**——没有 try/catch 隐藏错误；整个仪表盘会大声且可见地出错，而不是某张卡片静默地缺少数字。
- `brabo_test`（api 的 vitest 测试库）获得了 `"engine"` schema 的**最小** fixture——`CREATE SCHEMA IF NOT EXISTS engine` + `CREATE TABLE dev_agent_states (project_id, agent_id, status)`——位于 `test/support/global-setup.ts`，**声明**为 engine 真实迁移（`apps/engine/priv/repo/migrations/20260724124356_create_dev_agent_states.exs`）的部分副本，而不是第二个迁移器。如果真实迁移改变了这两列的名称/类型，这个 fixture 需要手动跟进——这是本决定声明的代价。
- 如果有一天 engine 从 api 获得**更多**关于 dev agent 状态的使用者（不只是计数），把它提升为一个独立的内部 HTTP 路由——带两侧的契约和测试——的压力会增长。本 ADR 不关闭这扇门；它只声明**一个**批量读取的使用者还不值得付出打开它的代价。
