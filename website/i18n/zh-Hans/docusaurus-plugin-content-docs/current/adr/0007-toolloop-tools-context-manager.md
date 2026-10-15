---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# 0007 — ToolLoop、工具、ContextManager（带 LLM 的 harness）

## 背景 {#contexto}

Fase 3a 的第二次会话：把确定性的 harness（ADR 0006）接上 LLM。一个运行 LLM 回合的 `ToolLoop`、已注册的工具（read_file、search_workspace、write_file、terminal、emit_artifact）、一个在超过限度时进行压缩的 `ContextManager`、钩子与动作管道的连接，以及一个用于验证的 `EchoAgent`。CLAUDE.md 的硬规则：engine **绝不**直接与 LLM provider 对话——每次调用都经过 api（计量 + 预算）。

塑造了这项工作的发现：之前不存在带工具调用和计量的内部 LLM 端点（engine→api）——只有面向 web 的 `/chat`（SSE，人类用户，没有工具），而 Ollama provider 既不发送 `tools`，也不解析 `tool_calls`。因此本次会话除了 engine（Elixir）之外，在 api（TypeScript）中也有大量工作。

## 决策 {#decisões}

### 内部 LLM 端点返回回合结果（不向 engine 流式传输） {#endpoint-de-llm-interno-turn-result-não-streamado-pro-engine}

`POST /internal/sessions/:id/llm-turn`（EngineServiceGuard）→ `RunLlmTurnUseCase`。它在 api **内部**消费 provider 的流（与 `/chat` 一样），并以一个 JSON 返回**完整**的回合（助手消息 + `toolCalls` + 用量）。ToolLoop 是逐回合的；“流式传输”发生在 provider→api 这一层。拒绝把 NDJSON 一直流到 engine：在工具循环中，engine 需要完整的消息（带 tool_calls）才能分派工具，所以流式传输只会增加实时的增量——它不改变验收标准（每个工具调用、context.compacted、成本），却要付出在 Elixir 中消费流的代价。已与用户确认。

该端点写入 `token_usage`（通过 `RecordLlmUsageUseCase` 的**强制**计量，需要 `sessionId`），但**不**写入 `session_events`：engine 拥有事件日志中的叙述（`agent.response`、`tool.call`、`tool.result`、`toolloop.limit_reached`）——避免重复的日志。工具调用：`ChatMessage`/`ChatOptions`/`ChatStreamChunk` 获得了工具字段（packages/shared），Ollama provider 开始发送 `tools` 并解析 `message.tool_calls`。

### 工具：直接的与经由管道的 {#ferramentas-diretas-vs-pipeline}

- 直接的（在 engine 中进程内执行）：`read_file`、`search_workspace`、agent 白名单内的 `write_file`、`emit_artifact`。每次文件访问都经过 `WorkspaceFiles.safe_path/2`——**路径穿越被阻止**（没有东西能逃出 `<PROJECT_WORKSPACES_ROOT>/<project_id>`）。
- 经由管道的（通过 api 中的 proposed_action）：`terminal`（**始终**），以及白名单**之外**的 `write_file`。钩子 `:pre_tool_use` 创建 `proposed_action`（api 的 decide/permissions）；`auto_approved` 的 terminal 被自动执行（现有分支），其结果成为工具的结果；白名单之外的 write_file 保持 `pending`（批准后的执行是未来阶段）。新的 `ActionType` `write_file`（developer）。engine **不**直接创建 proposed_action——它经过一个新的内部端点 `POST /internal/sessions/:id/actions`。

### emit_artifact = 类型化的 session_event（没有表） {#emit_artifact--session_event-tipado-sem-tabela}

api 中没有构件表，也没有按类型的验证。一个构件是一个 `session_event` `"artifact.<tipo>"`，其 payload 在 **ENGINE** 中验证（`ArtifactSchemas`，按类型的必需键；目前只有 `"note"`——产品类型属于 3b），通过 `append_event` 发出。拒绝现在就创建构件表（那会是 3b 的范围）。

### 连接的钩子（第 4 项） {#hooks-ligados-item-4}

`:pre_tool_use` = 查询管道发生的地方（`ActionPipeline`）；`:post_tool_use` = 把 `tool.result` 写入事件日志（`EventLog`）。ToolLoop 的默认注册，但可替换（它是 Hooks 的一个值）。是动作管道日后更深入接入的基础。

### ContextManager：保留 pinned 的压缩 {#contextmanager-compactação-preservando-pinned}

当估算的 token 超过 `threshold * 模型窗口` 时，它通过 `agent`/"context-manager" 绑定（便宜的模型——没有新 schema，是自由的 slug）总结最早的**非** pinned 回合，用摘要替换它们，保留 pinned 的（系统 prompt + 任务）以及最近的 `keep_recent` 个，并发出带 `tokensBefore`/`tokensAfter` 的 `context.compacted`。如果摘要器失败则有确定性的回退（绝不丢失线索）。内部消息是以字符串为键的 map（线上格式）+ `:pinned`（发送前移除）。

### ToolLoop 在哪里运行 {#onde-o-toolloop-roda}

`EchoAgent.run/2` 同步运行 `ToolLoop`（为验收标准可在 IEx 中观察）。在生产中，一个按会话的驱动（`Engine.TaskSupervisor` 下的 Task，由 SessionServer 协调）避免阻塞心跳的 GenServer——这是未来会话的完善；本次会话的触发方式是 IEx（没有 Mix.Task 的先例，与 `Debug.print` 一样）。

## 后果 {#consequências}

- 每个新 behaviour（`ToolLoop`、`ContextManager`）都遵循 behaviour + 可通过 `Application.get_env` 替换的实现这一模式，不使用 Mox；确定性测试使用一个假的 `EngineApiClient`，它通过进程字典为 `llm_turn`/`propose_action` 编写脚本（循环在测试进程中同步运行），并把事件 `send` 给 `:test_pid`。
- 验收标准（在真实会话中用 Ollama 运行 EchoAgent）需要 Ollama 中一个支持工具的模型以及绑定（会话 + "context-manager"）。自动化测试使用假实现（真实 Ollama 是手动演示）。
- `OpenAIProvider` 增加了一个类型转换，以便在扩大的 `ChatRole` 下继续编译（其中的工具调用不在本阶段范围内——只有 Ollama）。
