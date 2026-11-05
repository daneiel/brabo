---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
id: rn-broker
title: 'Regras de negócio — Broker'
sidebar_label: Broker
description: 'As RNs hospedadas na raiz broker.'
keywords: [regras de negócio, broker]
---

# Broker

## Поиск RAG оставляет след, и след замораживает веса (RN-479..481)

### RN-494 — Gate образа (RN-105) действует во ВСЕХ ТРЁХ режимах выполнения {#rn-494}

**ПЕРЕСМАТРИВАЕТ [RN-169](api.md#rn-169) (пункт 1)
и [RN-421](api.md#rn-421)**: освобождение от gate RN-105 для проекта `mounted`/
`runner` — "эти режимы не поднимают собственный контейнер, поэтому решение
Arquiteto никогда не произойдёт" — ОТМЕНЕНО. `ReadProjectCodeUseCase
.portaoDoContainer` перестаёт проверять `executionMode`: все ТРИ режима теперь
требуют решённого `artifact.project_image` (Arquiteto, `choose_project_image`,
или Infra, выбирающей кандидата, `container_start` — ADR 0133/RN-491), прежде
чем открыть семь маршрутов чтения вкладки Code.

Исходное освобождение путало два вопроса: "поднимает ли этот проект контейнер
на СЕРВЕРЕ?" (нет, в `mounted`/`runner`, и здесь это не меняется) и "имеет ли
смысл требовать, чтобы КТО-ТО решил образ проекта, прежде чем открывать
чтение кода?" (да, во всех трёх режимах — решение касается того, что проект
ВЫПОЛНЯЕТ, а не того, где поднимается физический контейнер). Сохранение
освобождения позволяло вкладке Code у `mounted`/`runner` открываться без
того, чтобы кто-то подумал об образе проекта; единообразное правило
закрывает этот пробел.

**Принятая цена, всеми буквами**: каждый СУЩЕСТВУЮЩИЙ проект `mounted`/
`runner` без решённого `artifact.project_image` — включая реальные проекты
dogfooding, такие как `exp001`/`exp002`, — ТЕРЯЕТ доступ к вкладке Code в
момент деплоя этого PR, пока Arquiteto (или Infra) не решит для него образ.
Это ДЕЙСТВИЕ ОПЕРАТОРА, требуемое после деплоя, а не прозрачное исправление, —
поэтому ветка рождается `breaking/`, а версия поднимается MAJOR.

**Жизненный цикл (`project_containers`) тоже перестаёт отказывать по
режиму**: `RegistrarTransicaoDeContainerUseCase` больше не отвечает 400 для
`mounted`/`runner` — таблица может регистрировать строку для всех трёх
режимов, через ту же воронку `provisioning` (которая уже читала решение об
образе, теперь требуемое и для них). Для `mounted`/`runner` по-прежнему
НЕВОЗМОЖНО по-настоящему достичь `running`: это применяется в одном месте,
`ContainerBrokerPort.start()`, который отказывает
(`ModoDeExecucaoNaoSuportadoError`, намеренная политика — брокер на сервере
не видит папку пользователя, где живёт код `mounted`/`runner`), — а
`ExecuteContainerStartUseCase` уже обрабатывает этот отказ как обычный сбой
(`container.start_failed`, названная причина), никогда крах, никогда
молчание. На практике обычным путём (одобрение `container_start`) НИ ОДНА
строка не успевает родиться в `project_containers` для этих двух режимов,
потому что брокер отказывает ДО вызова какого-либо перехода. Дублирование
этой проверки режима в `propose-action.use-case.ts` или в
`ExecuteContainerStartUseCase` было рассмотрено и ОТБРОШЕНО: брокер уже
сбоит громко и с именем, а дублированная проверка лишь создала бы второе
место для расхождения с первым — то же рассуждение, что в комментарии
`ModoDeExecucaoNaoSuportadoError` (`apps/broker/src/operacoes.ts`), уже
указывавшем на этот PR.

Сторона web перестаёт обращаться с `mounted`/`runner` как с особым случаем:
`ProjectCodeTab` спрашивал режим проекта и открывал оболочку напрямую, даже
не вызывая `GET /projects/:id/container`, когда режим не был `container`. Это
УПРОСТИЛО компонент — все три режима теперь идут тем же путём
`useQuery`/состояний (загрузка, ошибка, `sem_decisao`, решено), без
`modoLocal` и условного по режиму `enabled`.

- **Где:** `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (`portaoDoContainer`, освобождение удалено),
  `apps/api/src/application/use-cases/containers/registrar-transicao-de-container.use-case.ts`
  (400 по режиму удалён), `apps/api/src/application/use-cases/iam/convert-project-execution-mode.use-case.ts`
  (исправлен комментарий упорядочения), `apps/web/src/routes/ProjectCodeTab.tsx`
  (единообразный gate, `modoLocal` удалён)
- **Тест:**
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (блок "o portão do container": `mounted`/`runner` отвечают 409 без решения и
  нормально читают при решённом),
  `apps/api/test/application/use-cases/containers/ciclo-de-vida-do-container.use-case.spec.ts`
  (`mounted`/`runner` регистрируют `provisioning` вместо 400),
  `apps/web/src/routes/ProjectCodeTab.test.tsx` (три режима обрабатываются
  одинаково)
- **Архитектурное решение:** [ADR 0135](../adr/0135-portao-de-imagem-nos-tres-modos.md)
- **Источник:** план владельца продукта, Часть 1 / PR 1.7 — решение №5
  исходного плана ("Portão RN-105 passa a valer nos TRÊS modos"), принятое ещё
  до появления этого PR
