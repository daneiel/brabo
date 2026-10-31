---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0098 — 一致的传输限制与有效的压缩窗口

- **状态：** 已接受
- **日期：** 2026-08-19
- **背景：** 修正 PR 中的 `413 request entity too large`（在真实使用中发现），RN-412

## 背景 {#contexto}

QA/SecOps 的 gate 在合法的 PR 上死于 `413 request entity too large`。散布在代码中的注释（`apps/engine/config/runtime.exs`、`apps/engine/lib/engine/actions/terminal_executor.ex`、`docker/docker-compose.yml`）把这个错误归咎于 LLM 的 **PROVIDER**。调查确认这一归因是错的：`Engine.Agents.FalhaDeTurno.origem({413, _})` 已经把这个失败归类为 `"codigo"`，而不是 `"modelo"`——分类器是对的，只是没有人把线索追到底。

真正的原因有两个独立的端头，两者需要一起关闭——只修正一个只会推迟溢出，而不会解决它：

1. **api 从未配置 Express 的 body 限制。** `apps/api/src/main.ts` 中的 `NestFactory.create` 没有触碰 JSON 解析器，所以生效的是 Express 的默认值：**100 KB**。Phoenix（engine）接受最大 8 MB 的 body。在传输最重的方向上——engine → api，具体是 `POST /internal/sessions/:sessionId/llm-turn`，它在 `ToolLoop` 的每次迭代中接收**整个**对话历史——api 以 80 倍的差距成为最窄的瓶颈，而没有任何人决定过这一点：这是缺少配置，而不是选择。
2. **engine 的上下文压缩在结构上无法在溢出之前到达。** `Engine.Harness.ContextManager.Default` 在估算的 token 超过 `threshold * context_window` 时决定压缩。两个缺陷把这个触发点推到了传输限制之后很远的地方：
   - `estimate/1` 只累加消息的 `content` 字段。带 `toolCalls` 的 `assistant` 消息（工具调用的格式）`content` 为空——工具调用的参数在 HTTP body 中**是**真实的字节，却被算作约零个 token。
   - 压缩窗口只使用 `context_window`——在五个 gate/dev agent 中是 128.000 个 token（`qa_automacao_agent.ex`、`qa_performance_seguranca_agent.ex`、`qa_estrategia_agent.ex`、`appsec_agent.ex`、`dev_agent_server.ex`）。在 `threshold: 0.7` 下，这意味着在约 350 KB 的估算 payload 时才压缩——远在任何合理的传输限制之后，而且当估算本身已经偏少时更糟。

在一个 60 次迭代的 gate（执行/gate agent 的上限）以及三到四个 32 KiB 的工具结果（RN-150 已经关闭的**单个**上限）下，累积的 body 在压缩甚至还没考虑行动之前很早就超过了 100 KB。

## 决策 {#decisão}

**两个端头在同一次修正中关闭，有意放在一起：**

1. `apps/api/src/main.ts` 开始显式配置 JSON 解析器的限制（`app.useBodyParser('json', { limit })`），从 `API_JSON_BODY_LIMIT` 读取，默认 `10mb`——在 Phoenix 已经接受的 8 MB 之上留有余量，engine 的上限变化时无需重新部署。
2. `Engine.Harness.ContextManager.Default` 获得：
   - `estimate/1` 计算**每一条**消息的 `content`，**加上** `assistant` 消息的 `toolCalls` 的 JSON 序列化——每 token 字节数的启发式与近似 tokenizer 的**相同**（`Engine.Harness.Tokenizer.bytes_per_token/0`，新的公开函数，以免重复常量）。
   - **有效**的压缩窗口变为 `min(context_window,
     teto_de_transporte)`，其中传输上限是**一个**新的配置（`transport_max_body_bytes`，默认 8 MiB——engine **自身**传输的上限，不在五个 agent 文件中复制，它们继续声明 `context_window: 128_000`，因为这描述的是**模型**，而不是传输）。
   - 旧消息（被总结的）与新消息（被保留的）之间的切分开始尊重 `ToolLoop` 的**迭代边界**（`group_by_iteration/1`）——一条带 `toolCalls` 的 `assistant` 消息以及回应它的 `role: "tool"` 总是一起去往切分的同一侧。在中间切开会破坏 provider 的工具使用协议（历史中有工具结果却没有对应的调用）。

本 ADR 记录的一般规则：**压缩必须在 body 超过真实的 HTTP 限制**之前**触发，而不是在模型“忘记”它的窗口之前。** 一个只隐式存在的传输上限（某个库的默认值）不是上限——它是一个等待着合适 payload 的故障。

## 后果 {#consequências}

- `transport_max_body_bytes` 的值（8 MiB）是声明的配置，没有针对真实流量校准——与混合搜索（RAG）的权重以及 `search_workspace` 的上限（RN-150）已经遵循的诚实尺子相同：可调的起点，而不是最终的数字。
- 只提高 api 的限制而不修正 engine 的估算（或者反之）会以另一种形式重新引入缺陷：要么 body 再次无限制地增长到更高的上限，要么压缩开始过早行动，总结仍然能放进传输的上下文。两个端头诞生于同一次提交。
- `dev.awaiting_gate` 作为 dev agent 的状态在实践中应该会更少见（gate 不再因合法 payload 的 413 而死），但 RN-412 也扩展了 `DEV_PENDING_TYPES` 以在该状态下保持会话——纵深防御，而不是依赖本 ADR 关闭 100% 因其他原因缓慢/卡住的 gate 情况。
