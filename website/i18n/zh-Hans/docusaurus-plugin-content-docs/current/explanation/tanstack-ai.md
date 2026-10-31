---
id: tanstack-ai
title: TanStack AI——未采用
description: 为什么 web 不在会话聊天中采用 TanStack AI（2026年10月3日的决定）、测量了什么、未来采用时的两项禁令以及重新评估的触发条件。
traducao_de: 17fe83498b0a1eea177367926431ffddda3ce9ff
---

# TanStack AI——未采用

**决定（所有者，2026年10月3日）：** web 现在**不**采用 [TanStack AI](https://tanstack.com/ai/latest)。等它到 **1.0** 时，或者出现一个**会话消息流之外**的聊天功能时，再重新评估。没有 ADR：没有任何结构性的变化。

## 它是什么 {#o-que-é}

一组用于构建聊天界面的包（`@tanstack/ai`、`@tanstack/ai-client`、`@tanstack/ai-react`，MIT）：客户端有一个带流式传输和消息队列的 `ChatClient`，服务器端有一个与 LLM provider 对话的 `chat()`。

## 测量了什么（2026年10月3日） {#o-que-foi-medido-03102026}

- `apps/web` 没有 `@tanstack/ai*` 依赖——只有 React Query 和 Router。
- 当天的版本：`@tanstack/ai` 0.64.0、`@tanstack/ai-client` 0.36.1、`@tanstack/ai-react` 0.29.4。项目页面标注为 **Alpha**，几乎每天都有新版本。
- 自有连接**是**可行的（`ai-client` 的 `connection-adapters.d.ts` 中的 `ConnectConnectionAdapter` / `SubscribeConnectionAdapter`）。只使用客户端的话，不会有任何 LLM 调用绕过 Harness、路由器或计量。

## 为什么不 {#por-que-não}

1. Phoenix 通道不说 AG-UI：它承载的是 `agent.delta`、`agent.done`、`agent.status` 和 `tool.call`（`apps/web/src/lib/session-channel.ts`）。采用它需要一个翻译层，或者修改七个对话式服务器。
2. 点击在**接受**时就响应，回合的结束经由通道和日志到达（[RN-578](../business-rules.md#rn-578)、[ADR 0163](../adr/0163-o-clique-responde-ao-aceitar.md)、`apps/web/src/lib/session-turno.ts` 中的 `acompanharTurnoPeloLog`）。
3. `ChatClient` 的消息队列（`whenBusy: 'queue'`）与存在于**日志**中的队列冲突（[RN-673](../business-rules.md#rn-673)、[ADR 0191](../adr/0191-a-mensagem-com-turno-em-curso-entra-numa-fila.md)）。
4. 每个对话一个助手，而我们的消息流有多个 agent 和显式的收件人（[RN-584](../business-rules.md#rn-584)、[RN-631](../business-rules.md#rn-631)）。
5. 活动条和回合的步骤来自日志（[RN-460](../business-rules.md#rn-460)、AT-395）。
6. [RN-639](../business-rules.md#rn-639) 的按 token 隔离（`SessionPage.streaming-isolado.test.tsx`）会面临风险。
7. 消息流的截断和经由日志的重新水合（[RN-644](../business-rules.md#rn-644)、[RN-580](../business-rules.md#rn-580)）得不到任何好处。

唯一的收益是替换 `apps/web/src/lib/streaming-do-turno.ts` 的 store。

## 任何未来采用中都禁止的 {#proibido-em-qualquer-adoção-futura}

- TanStack **服务器**的 `chat()`：它直接与 provider 对话，绕过 Harness、路由器和计量。
- 该包的 **BYOK**：浏览器中的 API 密钥违反 [RN-058](../business-rules/custo.md#rn-058)（agent 花费的是 workspace owner 的密钥，由 api 加密保存）。

## 何时重新评估 {#revisitar-quando}

- TanStack AI 到达 **1.0**；或者
- 出现一个**会话消息流之外**的聊天功能。

## 来源 {#fontes}

- [TanStack AI](https://tanstack.com/ai/latest)
- [npm 上的 `@tanstack/ai`](https://www.npmjs.com/package/@tanstack/ai)
- [npm 上的 `@tanstack/ai-client`](https://www.npmjs.com/package/@tanstack/ai-client)
- [npm 上的 `@tanstack/ai-react`](https://www.npmjs.com/package/@tanstack/ai-react)
