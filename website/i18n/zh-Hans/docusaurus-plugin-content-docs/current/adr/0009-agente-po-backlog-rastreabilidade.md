---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0009 — PO agent、backlog（epics/stories/tasks）与可追溯性

- 状态：已接受
- 日期：2026-07-24
- 阶段：3b（会话 2）

## 背景 {#contexto}

3b 的会话 1 交付了对话式的 Criativo（发出 `business_rule`，整合 `product_brief`，并向 PO **提供** handoff——状态为 `offered` 的 `handoffs`，激活规则要求 `accepted`）。本次会话闭合这个循环：用户**接受** handoff，**PO** 被激活，消费 brief + 规则，并**产出 backlog**（史诗 → 故事 → 任务），带 DoD/DoR 以及与业务规则的强制关联，保持规则→故事的可追溯性。

## 决策 {#decisões}

### 1. PO 作为对话式 GenServer，每个回合有工具使用循环 {#1-po-como-genserver-conversacional-com-loop-de-tool-use-por-turno}
`Engine.Agents.PoServer` 镜像 `CriativoServer`（每个会话一个 GenServer，状态 + 重新水合 + 通过 Phoenix 通道流式传输），但**每个回合运行一个有界的工具使用循环**：分派 `create_epic/create_story/create_task`，并**把结果（id/错误）作为 `tool` 消息注回**，再次调用模型——这样它就能串联（史诗的 id → `create_story` → `create_task`）。Criativo 不这样做（单回合）。由被接受的 handoff 激活（而不是用户的命令），PO 在**全新**启动时执行 `:kickoff`（从事件日志读取 brief + 规则并生成 backlog）；重启/重新激活不会重新生成。

### 2. backlog 有自己的表；数组用 JSONB；通过 ULID 关联规则 {#2-backlog-em-tabelas-próprias-arrays-em-jsonb-vínculo-a-regra-por-ulid}
`epics`/`stories`/`tasks`（迁移 0011）。由于项目**不使用 Postgres 数组**，RF/RNF/DoD/DoR/`business_rule_ids` 都是 `jsonb`（`$type<string[]>`）。`business_rule_ids` 通过**不带外键的 ULID 文本**引用 `session_events.id`（构件 `artifact.business_rule`）——与 `handoffs.artifact_id` 的选择相同（逻辑关联，而非关系型）。任务从故事继承关联（派生，不存储）。

### 3. draft→ready 的就绪在**领域**中验证 {#3-prontidão-draftready-validada-no-domínio}
`domain/backlog/story-readiness.ts`（`assertReady` → `StoryNotReadyError`）要求非空的 DoD、DoR，≥1 个 RF 和 ≥1 条关联规则——“在领域中验证，而不只是在 prompt 中”。`story-state-machine.ts` 覆盖 `draft→ready→in_progress→done`。`create_story` 以 `draft` 创建，并**在规则满足时**在同一操作中提升为 `ready`（PO 只用这 3 个具名工具——没有转换工具）；`TransitionStoryUseCase` 暴露显式的转换（已测试），并服务于未来的状态。

### 4. PO 的工具经过 api（绝不直接 SQL/insert） {#4-ferramentas-do-po-passam-pela-api-nunca-sqlinsert-direto}
`create_epic/create_story/create_task` 是 `:direct` 工具，调用 `EngineApiClient` → 内部端点 → 带领域验证的用例。`CreateStoryUseCase` **验证每个 `business_rule_id` 确实引用一个存在的 `artifact.business_rule` 事件**（拒绝编造的 id；什么都不创建）。每次创建都在事件日志中发出 `backlog.*`（PO 的叙述）。

### 5. 规则→故事的可追溯性（待办 = 发现） {#5-rastreabilidade-regrastories-pendência--descoberta}
`domain/backlog/coverage.ts`（`computeCoverage`，纯函数）+ `GET /projects/:id/
coverage`：对项目的每个 `artifact.business_rule`，列出覆盖它的故事（通过 `business_rule_ids`）。没有覆盖的规则是一个**发现**——UI 在 Backlog 标签页中以红色显示它。项目层级（通过与 `sessions` 的 join 汇总各会话的规则）。

### 6. 接受 handoff 按会话 1 的规则激活 PO {#6-aceitar-handoff-ativa-o-po-pela-regra-da-sessão-1}
`AcceptHandoffUseCase`（用户动作）：`offered→accepted` + `handoff.accepted` → 为 `toAgent` 调用 `ActivateAgentUseCase`。激活规则（要求一个 `accepted` 的 handoff）现在恰恰因为这次接受而通过。UI：会话中的“Aceitar handoff e iniciar PO”按钮。

## 后果 {#consequências}

- Backlog 标签页是项目层级的（本地状态，没有新路由），从 `GET backlog` + `GET coverage` 的轮询读取——实时反映 PO 的生成。
- 会话的 composer 通过 `sendAgentMessage` 路由到活动的 agent（PO 优先于 Criativo）。
- 测试：领域（`story-readiness`、`story-state-machine`、`coverage`）、用例（`create-story` 拒绝不存在的规则；`transition-story` 拒绝没有 DoD 的 draft→ready），以及 `po_server_test`（kickoff 带结果注入地串联 create_epic→create_story；无效规则变成错误的 tool-result 而不让循环崩溃；广播；重新水合）。

## 范围 {#escopo}

只有 PO + backlog + 可追溯性。**Arquiteto**（项目仓库 docs/adr/ 中的 ADR、`module_map`、验证故事引用存在的模块）是下一次会话。`in_progress`/`done` 以及在 UI 中手动编辑 backlog 留待以后（状态机已经覆盖）。
