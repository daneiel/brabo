---
id: tanstack-ai
title: TanStack AI — não adotado
description: Por que o web não adota o TanStack AI no chat da sessão (decisão de 03/10/2026), o que foi medido, as duas proibições para uma adoção futura e o gatilho de revisão.
---

# TanStack AI — não adotado

**Decisão (dono, 03/10/2026):** o web **não** adota o
[TanStack AI](https://tanstack.com/ai/latest) agora. Revisitar quando chegar à
**1.0**, ou se nascer uma feature de chat **fora do fio da sessão**. Sem ADR:
nada estrutural muda.

## O que é

Uma família de pacotes (`@tanstack/ai`, `@tanstack/ai-client`,
`@tanstack/ai-react`, MIT) para construir interfaces de chat: um `ChatClient`
no cliente, com streaming e fila de mensagens, e um `chat()` no servidor que
fala com os providers de LLM.

## O que foi medido (03/10/2026)

- `apps/web` não tem dependência `@tanstack/ai*` — só React Query e Router.
- Versões no dia: `@tanstack/ai` 0.64.0, `@tanstack/ai-client` 0.36.1,
  `@tanstack/ai-react` 0.29.4. A página do projeto marca **Alpha**, com versão
  nova quase todo dia.
- Conexão própria **é** possível (`ConnectConnectionAdapter` /
  `SubscribeConnectionAdapter` em `connection-adapters.d.ts` do `ai-client`).
  Usando só o cliente, nenhuma chamada de LLM sairia do Harness, do roteador
  nem do metering.

## Por que não

1. O canal Phoenix não fala AG-UI: ele carrega `agent.delta`,
   `agent.done`, `agent.status` e `tool.call`
   (`apps/web/src/lib/session-channel.ts`). Adotar exigiria um tradutor
   ou mudar os sete servidores conversacionais.
2. O clique responde no **aceite**, e o fim do turno vem pelo canal e pelo
   log ([RN-578](../business-rules.md#rn-578),
   [ADR 0163](../adr/0163-o-clique-responde-ao-aceitar.md),
   `acompanharTurnoPeloLog` em `apps/web/src/lib/session-turno.ts`).
3. A fila de mensagens do `ChatClient` (`whenBusy: 'queue'`) conflita com a
   fila que mora no **log** ([RN-673](../business-rules.md#rn-673),
   [ADR 0191](../adr/0191-a-mensagem-com-turno-em-curso-entra-numa-fila.md)).
4. Um assistente por conversa, contra um fio com vários agentes e
   destinatário explícito ([RN-584](../business-rules.md#rn-584),
   [RN-631](../business-rules.md#rn-631)).
5. A faixa de atividade e os passos do turno vêm do log
   ([RN-460](../business-rules.md#rn-460), AT-395).
6. O isolamento por token da [RN-639](../business-rules.md#rn-639)
   (`SessionPage.streaming-isolado.test.tsx`) correria risco.
7. O corte do fio e a reidratação pelo log
   ([RN-644](../business-rules.md#rn-644),
   [RN-580](../business-rules.md#rn-580)) não ganham nada.

O único ganho seria trocar o store de
`apps/web/src/lib/streaming-do-turno.ts`.

## Proibido em qualquer adoção futura

- O `chat()` do **servidor** TanStack: ele fala direto com o provider,
  contornando o Harness, o roteador e o metering.
- O **BYOK** do pacote: chave de API no navegador fere a
  [RN-058](../business-rules/custo.md#rn-058) (o agente gasta a chave do owner
  do workspace, guardada criptografada pela api).

## Revisitar quando

- O TanStack AI chegar à **1.0**; ou
- surgir uma feature de chat **fora do fio da sessão**.

## Fontes

- [TanStack AI](https://tanstack.com/ai/latest)
- [`@tanstack/ai` no npm](https://www.npmjs.com/package/@tanstack/ai)
- [`@tanstack/ai-client` no npm](https://www.npmjs.com/package/@tanstack/ai-client)
- [`@tanstack/ai-react` no npm](https://www.npmjs.com/package/@tanstack/ai-react)
