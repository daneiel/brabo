---
id: tanstack-ai
title: TanStack AI — не принят
description: Почему web не принимает TanStack AI в чате сессии (решение от 03.10.2026), что было измерено, два запрета для будущего принятия и триггер пересмотра.
traducao_de: 17fe83498b0a1eea177367926431ffddda3ce9ff
---

# TanStack AI — не принят

**Решение (владелец, 03.10.2026):** web **не** принимает
[TanStack AI](https://tanstack.com/ai/latest) сейчас. Пересмотреть, когда он дойдёт до
**1.0**, или если появится функция чата **вне ленты сессии**. Без ADR:
ничего структурного не меняется.

## Что это {#o-que-é}

Семейство пакетов (`@tanstack/ai`, `@tanstack/ai-client`,
`@tanstack/ai-react`, MIT) для построения интерфейсов чата: `ChatClient`
на клиенте, со streaming и очередью сообщений, и `chat()` на сервере, который
говорит с LLM-providers.

## Что было измерено (03.10.2026) {#o-que-foi-medido-03102026}

- У `apps/web` нет зависимости `@tanstack/ai*` — только React Query и Router.
- Версии на тот день: `@tanstack/ai` 0.64.0, `@tanstack/ai-client` 0.36.1,
  `@tanstack/ai-react` 0.29.4. Страница проекта помечает **Alpha**, с новой
  версией почти каждый день.
- Собственное подключение **возможно** (`ConnectConnectionAdapter` /
  `SubscribeConnectionAdapter` в `connection-adapters.d.ts` из `ai-client`).
  При использовании лишь клиента ни один вызов LLM не вышел бы за пределы Harness,
  маршрутизатора и metering.

## Почему нет {#por-que-não}

1. Канал Phoenix не говорит на AG-UI: он несёт `agent.delta`,
   `agent.done`, `agent.status` и `tool.call`
   (`apps/web/src/lib/session-channel.ts`). Принятие потребовало бы переводчика
   или изменения семи разговорных серверов.
2. Клик отвечает при **принятии**, а конец хода приходит через канал и
   журнал ([RN-578](../business-rules.md#rn-578),
   [ADR 0163](../adr/0163-o-clique-responde-ao-aceitar.md),
   `acompanharTurnoPeloLog` в `apps/web/src/lib/session-turno.ts`).
3. Очередь сообщений `ChatClient` (`whenBusy: 'queue'`) конфликтует с
   очередью, которая живёт в **журнале** ([RN-673](../business-rules.md#rn-673),
   [ADR 0191](../adr/0191-a-mensagem-com-turno-em-curso-entra-numa-fila.md)).
4. Один ассистент на разговор против ленты с несколькими агентами и
   явным адресатом ([RN-584](../business-rules.md#rn-584),
   [RN-631](../business-rules.md#rn-631)).
5. Полоса активности и шаги хода приходят из журнала
   ([RN-460](../business-rules.md#rn-460), AT-395).
6. Изоляция по токену [RN-639](../business-rules.md#rn-639)
   (`SessionPage.streaming-isolado.test.tsx`) оказалась бы под угрозой.
7. Обрезка ленты и регидратация из журнала
   ([RN-644](../business-rules.md#rn-644),
   [RN-580](../business-rules.md#rn-580)) ничего не выигрывают.

Единственным выигрышем была бы замена store в
`apps/web/src/lib/streaming-do-turno.ts`.

## Запрещено при любом будущем принятии {#proibido-em-qualquer-adoção-futura}

- **Серверный** `chat()` TanStack: он говорит напрямую с provider,
  обходя Harness, маршрутизатор и metering.
- **BYOK** пакета: API-ключ в браузере нарушает
  [RN-058](../business-rules/custo.md#rn-058) (агент тратит ключ owner
  workspace, хранимый зашифрованным в api).

## Пересмотреть, когда {#revisitar-quando}

- TanStack AI дойдёт до **1.0**; или
- появится функция чата **вне ленты сессии**.

## Источники {#fontes}

- [TanStack AI](https://tanstack.com/ai/latest)
- [`@tanstack/ai` в npm](https://www.npmjs.com/package/@tanstack/ai)
- [`@tanstack/ai-client` в npm](https://www.npmjs.com/package/@tanstack/ai-client)
- [`@tanstack/ai-react` в npm](https://www.npmjs.com/package/@tanstack/ai-react)
