---
id: tanstack-ai
title: TanStack AI — not adopted
description: Why the web app does not adopt TanStack AI for the session chat (decision of 2026-10-03), what was measured, the two things any future adoption must never use, and the trigger to revisit it.
---

# TanStack AI — not adopted

**Decision (owner, 2026-10-03):** the web app does **not** adopt
[TanStack AI](https://tanstack.com/ai/latest) now. Revisit when it reaches
**1.0**, or if a chat feature is born **outside the session thread**. No ADR:
nothing structural changes.

## What it is

A family of packages (`@tanstack/ai`, `@tanstack/ai-client`,
`@tanstack/ai-react`, MIT) for building chat UIs: a client `ChatClient` with
streaming, a message queue, and a server `chat()` that talks to LLM providers.

## What was measured (2026-10-03)

- `apps/web` has no `@tanstack/ai*` dependency — only React Query and Router.
- Versions on that day: `@tanstack/ai` 0.64.0, `@tanstack/ai-client` 0.36.1,
  `@tanstack/ai-react` 0.29.4. The project page marks it **Alpha**, with a new
  version almost every day.
- A custom connection **is** possible (`ConnectConnectionAdapter` /
  `SubscribeConnectionAdapter` in `ai-client`'s `connection-adapters.d.ts`).
  Using only the client, no LLM call would leave the Harness, the router or
  the metering.

## Why not

1. The Phoenix channel does not speak AG-UI: it carries `agent.delta`,
   `agent.done`, `agent.status` and `tool.call`
   (`apps/web/src/lib/session-channel.ts`). Adopting would need a translator
   or changing the seven conversational servers.
2. The click answers on **accept**, and the end of the turn comes through the
   channel and the log ([RN-578](../business-rules.md#rn-578),
   [ADR 0163](../adr/0163-o-clique-responde-ao-aceitar.md),
   `acompanharTurnoPeloLog` in `apps/web/src/lib/session-turno.ts`).
3. The `ChatClient` message queue (`whenBusy: 'queue'`) conflicts with the
   queue that lives in the **log** ([RN-673](../business-rules.md#rn-673),
   [ADR 0191](../adr/0191-a-mensagem-com-turno-em-curso-entra-numa-fila.md)).
4. One assistant per conversation, against a thread with several agents and
   an explicit recipient ([RN-584](../business-rules.md#rn-584),
   [RN-631](../business-rules.md#rn-631)).
5. The activity strip and the turn's steps come from the log
   ([RN-460](../business-rules.md#rn-460), AT-395).
6. The per-token isolation of [RN-639](../business-rules.md#rn-639)
   (`SessionPage.streaming-isolado.test.tsx`) would be at risk.
7. The thread cut and rehydration from the log
   ([RN-644](../business-rules.md#rn-644),
   [RN-580](../business-rules.md#rn-580)) gain nothing.

The only gain would be replacing the store in
`apps/web/src/lib/streaming-do-turno.ts`.

## Forbidden in any future adoption

- The TanStack **server** `chat()`: it talks to the provider directly,
  bypassing the Harness, the router and the metering.
- The package's **BYOK**: an API key in the browser violates
  [RN-058](../business-rules/custo.md#rn-058) (the agent spends the workspace
  owner's key, held encrypted by the api).

## Revisit when

- TanStack AI reaches **1.0**; or
- a chat feature is needed **outside the session thread**.

## Sources

- [TanStack AI](https://tanstack.com/ai/latest)
- [`@tanstack/ai` on npm](https://www.npmjs.com/package/@tanstack/ai)
- [`@tanstack/ai-client` on npm](https://www.npmjs.com/package/@tanstack/ai-client)
- [`@tanstack/ai-react` on npm](https://www.npmjs.com/package/@tanstack/ai-react)
