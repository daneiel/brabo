---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0014 — InfraAgent и живая панель команды (закрытие Фазы 4a)

- Статус: принят
- Дата: 2026-07-24
- Фаза: 4a (сессия 4 — закрытие)

## Контекст {#contexto}

Последние два пункта Фазы 4a: **InfraAgent** (читает module_map + ADR по
инфраструктуре от Arquiteto, предлагает Dockerfile/compose/CI через PR —
никогда не применяет в окружении) и **полная панель команды** (все агенты
инстанцированы, живой статус через каналы Phoenix, больше не
статический/единообразный статус). На этом Фаза 4a закрывается; Фаза 4b
(Psicólogo/Anamnese) остаётся на потом.

Критерий приёмки: в подопытном проекте InfraAgent сдаёт PR с валидным
Dockerfile, проходящим gates (синтаксический QA + сканирование SecOps), а
панель показывает всю команду с правильными состояниями во время реального
исполнения.

## Решения {#decisões}

### 1. Handoff Arquiteto→Infra — тот же механизм, новая точка предложения {#1-handoff-arquitetoinfra--mesmo-mecanismo-novo-ponto-de-oferta}

InfraAgent следует ТОЙ ЖЕ семье агентов уровня сессии
(Criativo/PO/Arquiteto) — а не образцу уровня проекта у Dev/QA/SecOps, —
потому что активируется явным handoff, а не инстанцируется по одному на
модуль. `ArquitetoServer` получает `handle_call(:offer_infra_handoff, ...)`
(зеркало `confirm_readiness` у Criativo): выполняет завершающий ход и
вызывает `EngineApiClient.create_handoff(project_id, session_id, "arquiteto",
"infra", nil)`. Выделенный человеческий endpoint
`POST projects/:id/sessions/:id/agents/arquiteto/handoff-infra` →
`OfferInfraHandoffUseCase` — **не** переиспользует endpoint `readiness`
Criativo (разные агенты и моменты потока).

`AcceptHandoffUseCase` получает seed автономии, обусловленный
`toAgent === "infra"`: `agent_autonomy (infra, open_infra_pr) =
auto_approve` (ПРЕДЛОЖЕНИЕ PR безопасно автоодобрять — InfraAgent никогда
ничего не применяет в окружении) и `(infra, terminal) = deny`.
`ArquitetoSupervisor`/`agent-activation.ts` уже обобщены по имени агента —
никаких изменений не нужно, кроме того, что `agent_command_controller.ex`
получает клаузу `"infra"`.

### 2. Ограничение терминала — структурное + политика, а не новый ActionType {#2-restrição-de-terminal-é-estrutural--policy-não-um-novo-actiontype}

`decide()` оценивает IAM → agent_autonomy → permissions.json, каждая стадия
лишь ПОВЫШАЕТ разрешительность — `deny` в agent_autonomy ЗАМЫКАЕТ НАКОРОТКО
до того, как будет запрошен permissions.json. Значит, «запретить общий
терминал, но разрешить hadolint» нельзя (и не нужно) выражать в ТОМ ЖЕ
ActionType `terminal`: проверка hadolint у InfraAgent (`ValidateInfraFile`,
инструмент `:direct`) выполняется как прямой вызов `System.cmd` через
`Engine.Actions.HadolintDetector`, без какого-либо proposed_action, — тот же
образец, что у детекторов SecOps. Запрет общего `terminal` двойной:
**структурный** (реестр инструментов InfraAgent — `[ValidateInfraFile.spec(),
ProposeInfraPr.spec()]` — никогда не включает `Terminal`) и **политика**
(`agent_autonomy (infra, terminal) = deny`, глубокая защита, проверяемая через
`decide()`, но не реальный механизм, препятствующий неправомерному
использованию).

### 3. `open_infra_pr` обобщает `open_adr_pr` до N файлов {#3-open_infra_pr-generaliza-open_adr_pr-pra-n-arquivos}

Новый `ActionType` (`decide.ts`), откалиброванный как `open_adr_pr`
(maintainer/pending по умолчанию). `domain/git/infra-pr-execution-result.ts`
отражает `AdrPrExecutionResult`, но `paths: string[]` (один коммит с
несколькими файлами). `ExecuteInfraPrUseCase` обобщает `ExecuteAdrPrUseCase`:
`GitProvider.commitFiles` уже принимал `files: {path,content}[]` — только
потребитель был зафиксирован на 1 файле. Фиксированная ветка
`feature/infra-setup` (одна на сессию, а не по slug, как ADR).

**Цикл исправления без нового PR**: сессия производит ОДИН-единственный цикл
PR инфраструктуры — исправление после `changes_requested` переиспользует ТУ ЖЕ
ветку/PR, а не открывает другой. `ExecuteInfraPrUseCase` определяет это через
`InfraArtifactRepository.findBySessionId` (новый): если для сессии уже есть
артефакт, вызов трактуется как исправление — только `commitFiles`, без
`createBranch`/`openPullRequest`, без новой строки в `infra_artifacts`
(переиспользует `pullRequestUrl`/`pullRequestId` ИСХОДНОГО исполнения,
прочитанные обратно через `listByProjectAndType`). `InfraAgentServer`
получает `handle_cast({:correct, findings}, state)` (зеркало
`DevAgentServer.correct/3`): велит модели исправить и снова вызвать
`propose_infra_pr` — ТОТ ЖЕ инструмент, без особого ветвления для случая
исправления (различение целиком живёт в api).

### 4. Gates инфраструктуры: лёгкая параллельная таблица, та же машина состояний {#4-gates-de-infra-tabela-paralela-leve-mesma-máquina-de-estados}

За PR инфраструктуры нет task/story/worktree (файлы рождаются как прямое
содержимое, как ADR, — никогда не касаются worktree). Вместо того чтобы
втискивать это в `tasks`, новая таблица `infra_artifacts` (миграция 0016) с
ТЕМИ ЖЕ колонками gate, что у `tasks` (`gate_status`, `gate_correction_count`,
`blocked`, `blocked_reason`) + `pr_action_id` (id proposed_action
`open_infra_pr` — единственный id, который engine знает в ответ). В отличие от
`tasks` (которая существует ДО PR и открывает gate потом через
`OpenGateUseCase`), артефакт инфраструктуры рождается только тогда, когда PR
уже открыт, — `gate_status` приходит сразу `'awaiting_qa'`.

`RecordInfraGateVerdictUseCase` переиспользует ТУ ЖЕ `nextGateStatus` (чистый
домен, уже агностичный к Task) против `InfraArtifactRepository` вместо
`TaskRepository` — с ключом по `prActionId`, а не `taskId`
(`findByPrActionId`). Комментарий в PR через `listByProjectAndType` (а не
`findInSessionForUpdate`, предназначенный исключительно для использования
внутри транзакции с блокировкой).

`Engine.Infra.InfraGateRunner` (новый) ДЕТЕРМИНИРОВАН от начала до конца
(без собственного GenServer, без LLM) — `run_qa/3` запускает `hadolint` по
каждому Dockerfile из payload PR (получаемому через новый
`GetInfraPrFilesUseCase` + endpoint `GET .../infra-artifacts/:prActionId/files`,
поскольку нет worktree, на который можно указать детекторам);
`run_secops/3` запускает `gitleaks`+`semgrep` (те же детекторы, что у SecOps
для dev) против ВРЕМЕННОГО каталога, записанного на лету с файлами из payload
(удаляется в `after` у `try`). Запускается через
`Engine.Gates.Dispatcher.run_infra_qa/3`/`run_infra_secops/3` (та же
тестируемая косвенность, что Dev↔Gates, но с `Task.start` — fire-and-forget —
вместо собственного GenServer, поскольку runner не нуждается в состоянии между
вызовами).

### 5. Живая панель команды — broadcast в существующих точках выпуска {#5-painel-do-time-ao-vivo--broadcast-nos-pontos-de-emissão-existentes}

Без нового outbox-relay (большее, ненужное для критерия приёмки изменение):
`Engine.Sessions.LiveBroadcast.event_appended/4` (новый, маленький)
вызывается рядом с `EngineApiClient.append_event` во ВСЕХ GenServer уровня
проекта, которые лишь писали событие без broadcast (`DevAgentServer`,
`QaAgentServer`, `SecOpsAgentServer`, `InfraAgentServer`,
`InfraGateRunner`), — broadcast в канал `session:<id>`, событие
`event.appended`. Разговорные агенты (Criativo/PO/Arquiteto/Infra) получают
`agent.status` (`working`/`idle`) на существующих границах хода (начало/конец
каждого `handle_cast`/`handle_call`, выполняющего `run_turn`).

Web: `session-channel.ts` получает `onEvent`/`onAgentStatus` — при получении
`queryClient.invalidateQueries(['session-events', ...])` (переиспользует уже
существующий парсинг/кэш polling, лишь ускоряет refetch).
`ProjectOverviewTab` открывает СОБСТВЕННЫЙ канал (`connectSessionHeartbeat`),
независимый от того, что уже открывает `SessionPage`, поскольку это разные
маршруты/вкладки, монтируемые в разные моменты.

`lib/agent-status.ts` (новый) — `deriveAgentRoster(events, moduleMap,
executionActivated, handoffs)` собирает РЕАЛЬНЫЙ состав:
criativo/po/arquiteto всегда; `dev-<modulo>` для каждого модуля module_map,
когда исполнение активировано (синтезирует `AgentDef`, переиспользуя
значок/цвет общего «dev-backend», так как для динамического id нет
фиксированной записи); qa/secops, когда какой-либо gate (dev ИЛИ infra) хоть
раз открывался; infra, когда handoff принят. Статус: разговорные агенты —
через последний `agent.status`; dev — через эвристику по последним
собственным событиям (`dev.*`/`backlog.task_blocked`); qa/secops — через
`gateStatus` самого свежего заключения (`awaiting_qa`/`awaiting_secops`
говорит, у кого из двух мяч, — они синглтоны на проект, обрабатывают
последовательно). «Команда агентов» в `ProjectOverviewTab` начинает
использовать это, с `model`/`autonomy` (`AgentCard`, уже принимал props),
разрешаемыми через `getAgentModelBinding`/`listAgentAutonomy` один раз на
загрузку страницы.

### 6. Лента активности и вкладка Одобрения {#6-feed-de-atividade-e-tab-aprovações}

`activity.ts` получает ветки `infra.gate_changed`, `infra.pr_opened`/
`infra.pr_failed`, `infra.artifact_blocked` и
`architecture.readiness_confirmed` (зеркало уже существующих веток
`pr.gate_changed`/`adr.*`, текст ясно говорит «PR инфраструктуры»).
`artifact.qa_verdict`/`secops_verdict` (уже существующая ветка,
переиспользуемая dev И infra) проверяет `prActionId` в payload, чтобы
различать текст, не дублируя ветку.

Новый человеческий endpoint `GET projects/:id/infra-artifacts`
(`ListInfraArtifactsUseCase`) + хук `useInfraArtifacts`. У `PrGateTimeline`
(уже существующий компонент, используемый PR dev) prop `task: Task` сужен до
структурного интерфейса `GateSubject { title, blocked, blockedReason,
gateStatus }` — и `Task`, и `InfraArtifact` удовлетворяют ему структурно, не
привязывая компонент к домену backlog. Новый раздел «PR инфраструктуры на
ревью» во вкладке Одобрения, тот же компонент.

## Последствия {#consequências}

- Тесты: `decide.spec.ts` доказывает короткое замыкание (deny в
  agent_autonomy никогда не доходит до запроса permissions.json, даже при
  широком allow); интеграция `ProposeActionUseCase` (InfraAgent, предлагающий
  `terminal`, получает `denied`); `RecordInfraGateVerdictUseCase` (полное
  зеркало тестов gate для task, включая уже заблокированный артефакт,
  отклоняющий новое заключение). Engine: `ValidateInfraFile` (отсутствие
  hadolint не ломает ход), `InfraAgentServer` (счастливый путь с N файлами,
  исправление, deltas + `agent.status`, регидрация), `InfraGateRunner` (lint с
  находкой, одобрение запускает следующий gate, отсутствующий сканер
  пропускается без поломки).
- `docker build --check` остаётся вне рамок — потребовал бы монтирования
  сокета хоста в контейнер engine (Alpine, сегодня без docker CLI/демона),
  реальный риск, не принимаемый без явного запроса. Только hadolint
  (`Engine.Actions.HadolintDetector`, необязательный бинарник, тот же образец,
  что у остальных детекторов).
- «Живая» панель через broadcast в уже существующих точках выпуска — без
  нового обобщённого outbox-relay api→engine→Phoenix.
- Фаза 4b (Psicólogo/Anamnese) остаётся вне.

## Рамки и допущения {#escopo--assunções}

Сессия производит ОДИН цикл PR инфраструктуры (исправления переиспользуют ту
же ветку/PR — никогда второй конкурирующий PR). Без глубокой корреляции
diff↔находка сканера (то же упрощение, что в ADR 0013). Статус
dev/qa/secops на панели эвристический (best-effort по event log, а не
транзакционный источник истины) — достаточно для панели, не используется
никаким решением gate.
