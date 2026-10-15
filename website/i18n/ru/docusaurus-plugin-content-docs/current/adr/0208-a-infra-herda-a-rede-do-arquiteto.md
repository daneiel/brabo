---
traducao_de: 8d6d3ff7815b9c1a57462ad2061380c148299f42
---

# 0208 — Infra наследует сеть, объявленную Arquiteto

## Статус {#status}

**Accepted.** 2026-10-02 (AT-392; решение владельца от 02.10, "egress direto").
Пересматривает, не редактируя, пункт 3
[ADR 0190](0190-a-infra-sobe-o-container-no-aceite.md) (подъём на сервере
с буквальным `network: "none"`) и отходит от §4
[ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md), который требовал
разрешения пользователя для `egress`.

## Контекст {#context}

Измерено 02.10 (проект `loja-teste-2`): Arquiteto решил
`artifact.project_image` v1 с `network: "egress"` ("Egress necessário para
npm install…"). При принятии handoff Infra автоматический подъём на сервере
(`subir_no_aceite/2`, `infra_lead_server.ex`) предложил `container_start` с
`none`, а `ExecuteContainerStartUseCase` записал v2 (`infra-lead`) с `none`,
перезаписав решение Arquiteto. Контейнер Node поднялся без сети, и
`npm install` не выполняется.

## Решение {#decision}

1. Выбор Infra НАСЛЕДУЕТ сеть самой свежей `artifact.project_image`,
   выданной Arquiteto (`actor_id: "arquiteto"`), в любой сессии
   проекта — читаемую локально engine (`Event.rede_do_arquiteto/1`, тот же
   Postgres, без HTTP в цикле). Действует для подъёма на сервере при принятии и для
   инструмента `propose_container_start`, когда модель не передаёт `network`.
2. Без решения Arquiteto (или со значением вне `none`/`egress`) остаётся
   `none`, как раньше.
3. Подъём по-прежнему самостоятельный: семя `container_start: auto_approve` из ADR
   0190 не меняется, поэтому `egress` поднимается без клика.

## Последствия {#consequences}

- Цена ОБЪЯВЛЕНА, а не оплачена: сеть `egress` достигает опубликованных портов
  машины (ADR 0189, граница 5), и рассуждение `external-effect.ts` о том, что
  "без сети `curl | sh` ничего не достигает", перестаёт действовать для каждого проекта,
  в котором Arquiteto объявил `egress`. Согласие пользователя, которого требовал ADR 0065
  §4, уходит с пути по решению владельца.
- Версия, записанная Infra, начинает повторять сеть Arquiteto вместо того, чтобы
  понижать её; история артефакта остаётся согласованной.
- Правило: [RN-723](../business-rules.md#rn-723).
