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

## O que foi medido (03/10/2026)

- `apps/web` não tem `@tanstack/ai*` — só React Query e Router.
- Versões no dia: `@tanstack/ai` 0.64.0, `@tanstack/ai-client` 0.36.1,
  `@tanstack/ai-react` 0.29.4; MIT; a página marca **Alpha**, com versão nova
  quase todo dia.
- Conexão própria É possível (`ConnectConnectionAdapter` /
  `SubscribeConnectionAdapter`); usando só o cliente, nenhuma chamada de LLM
  sairia do Harness, do roteador nem do metering.

## Por que não

1. O canal Phoenix não fala AG-UI (`agent.delta`/`agent.done`/`agent.status`/`tool.call`).
2. O clique responde no aceite e o fim vem pelo canal/log (RN-578, [ADR 0163](../adr/0163-o-clique-responde-ao-aceitar.md)).
3. A fila do `ChatClient` (`whenBusy: 'queue'`) conflita com a fila no log (RN-673, [ADR 0191](../adr/0191-a-mensagem-com-turno-em-curso-entra-numa-fila.md)).
4. Um assistente por conversa contra o fio multiagente com destinatário (RN-584, RN-631).
5. Faixa e passos do turno vêm do log (RN-460, AT-395).
6. O isolamento por token da RN-639 correria risco.
7. Corte do fio e reidratação pelo log (RN-644, RN-580) não se aproveitam.

O único ganho seria trocar o store de `apps/web/src/lib/streaming-do-turno.ts`.

## Proibido em qualquer adoção futura

- O `chat()` do servidor TanStack (fala direto com o provider).
- O BYOK do pacote: chave no navegador fere a [RN-058](../business-rules/custo.md#rn-058).

## Revisitar quando

- O TanStack AI chegar à **1.0**; ou
- surgir chat **fora do fio da sessão**.
