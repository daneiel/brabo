---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0008 — harness 中的对话式 Criativo agent + handoff 的基础

- 状态：已接受
- 日期：2026-07-24
- 阶段：3b（会话 1）

## 背景 {#contexto}

Fase 3a 交付了确定性的 harness + **一次性**的 ToolLoop（自主的，运行直到停止），而人类聊天是一个**无状态、仅 api** 的回声（`SendChatMessageUseCase` 只把当前消息发给 provider——没有历史，没有 harness，没有工具；engine 甚至不参与）。Fase 3b 需要一个**对话式的 Criativo agent**，它与用户一起引导构思，在对话过程中发出 `business_rule`，并且——只有在用户明确确认之后——发出 `product_brief` 并向 PO 提供 handoff。它还需要 **handoff** 的基础，以及把守 agent 激活的规则。

CLAUDE.md 的硬规则：“Agentes rodam SEMPRE dentro de um Harness”以及“o engine NUNCA fala com provider de LLM direto”。因此 Criativo 存在于 engine（harness）中，每个回合都经过 api（计量 + 预算）。

## 决策 {#decisões}

### 1. Criativo 作为有状态的 GenServer（不是无状态的） {#1-criativo-como-genserver-com-estado-não-stateless}
每个会话一个 `Engine.Agents.CriativoServer`（GenServer，`restart: :temporary`），由 `CriativoSupervisor`（DynamicSupervisor）监督，以键 `"criativo:<session_id>"` 注册在 `Engine.Sessions.Registry` 中——镜像 `SessionServer`。对话历史存在内存中，并在 `init` 时从 `session_events`（chat.message/agent.response）**重新水合**——事件日志是持久的事实来源。由用户的命令启动（激活规则的例外），经由 api → `ApiToEngineClient.startAgent` → engine `POST /internal/sessions/:id/agent/start`。

舍弃的替代方案：每个回合都从事件日志重建历史（没有存活的进程）。我们选择 GenServer，是为了有一个按会话存放状态和生命周期的自然位置（与 `SessionServer` 一致）。

### 2. 通过 engine→api 的 SSE 逐 token 流式传输 + Phoenix 重新广播 {#2-streaming-token-a-token-via-sse-engineapi--rebroadcast-phoenix}
每条用户消息运行**一个**流式回合：`StreamLlmTurnUseCase`（3a 的 `RunLlmTurnUseCase` 的 SSE 兄弟，后者仍为 ToolLoop 返回回合结果）传输增量；`CriativoServer` 消费 SSE（`EngineApiClient.llm_turn_stream`），并通过 Phoenix 通道 `session:<id>`（`agent.delta`/`agent.done`）把增量**重新广播**给 web——web 原本只为心跳连接这个通道。最终的持久化（`agent.response` + 构件）通过 `SessionPage` 已经在做的 `session-events` 轮询（3s）到达。计量（token_usage）是强制的，在 api 中运行；engine 绝不直接与 provider 对话。**只**对交互式 agent 部分推翻了 3a 的回合结果决定。

### 3. handoff：状态可变的表 + 不可变的事件 {#3-handoffs-tabela-com-status-mutável--eventos-imutáveis}
新表 `handoffs {from_agent, to_agent, artifact_id, status:
offered|accepted|completed|rejected}`。与事件表不同，`status` 是**可变**的（它是当前状态）；每次转换也会成为一个不可变的 `session_event` `handoff.*`。api 拥有这张表——engine 通过 `POST /internal/sessions/:id/handoffs` 创建 handoff（绝不直接写 api 的表）。

### 4. agent 激活规则（纯领域） {#4-regra-de-ativação-de-agente-domínio-puro}
`domain/sessions/agent-activation.ts`：只有当会话中有一个指向某 agent 的 `accepted` handoff 时，该 agent 才会被激活；**唯一的例外：Criativo**（由用户的命令启动——`USER_STARTED_AGENTS`）。纯函数并单独测试（镜像 `decide.ts`/`session-state-machine.ts`）；`ActivateAgentUseCase` 加载 handoff，并在 engine 中启动进程之前应用该规则。

### 5. 就绪是用户的动作；product_brief 由服务器发出（领域中的护栏） {#5-prontidão-é-ação-do-usuário-product_brief-é-server-emitted-guardrail-no-domínio}
“Confirmação de prontidão é ação do usuário (botão), não inferência do modelo.” `business_rule` 由模型通过工具 `emit_artifact` 发出（带 `origin`——对对话的引用——在 `ArtifactSchemas` 中验证为**非空**）。`product_brief` **不能**由工具发出（`known/0` 排除了它；`EmitArtifact` 阻止系统发出的类型）——它只在用户点击“Estou pronto para produzir”时才产生（`ConfirmReadinessUseCase` → engine `confirm_readiness`）：此时 `CriativoServer` 运行一个整合回合，直接发出 `product_brief`（`append_event_returning`，捕获 id），并创建给 PO 的 `offered` handoff。这让“brief 只在确认之后”成为领域的保证，而不是 prompt 的保证。

### 6. 构件仍然是类型化的 session_event {#6-artefatos-continuam-sendo-session_events-tipados}
没有构件表：`business_rule`/`product_brief` 是 `session_events` `artifact.<tipo>`，payload 在 engine 中验证（`ArtifactSchemas`）。web 从同一个事件轮询中读取它们（侧边面板中的规则卡片；当 `handoff.offered` 出现时聊天中的 handoff 分隔线）。

## 范围 {#escopo}

只有 handoff 的基础（表 + 规则 + **offered** handoff）和 Criativo。**PO**（接受 handoff、激活 PO、backlog）是 3b 之后的会话。没有 Bitbucket/GenericGitProvider；队列仍在 Postgres（Oban）中，没有 Redis。

## 后果 {#consequências}

- web 获得第二条聊天路径（agent 与人类），由事件日志中的 `agent.activated` 决定；没有 Criativo 的会话仍走人类聊天。
- `CriativoServer` 从事件日志重新水合——在重启后不会丢失对话的线索。
- 确定性测试：激活规则（单元）、`ArtifactSchemas`（必需的来源），以及通过直接调用 `init/1` + `handle_call/3` 并用编排好的假 LLM 测试 `CriativoServer`（流式传输、product_brief 的护栏、就绪→brief+handoff、广播、重新水合）。
