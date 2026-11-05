---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
id: rn-contracts
title: 'Regras de negócio — Contratos'
sidebar_label: Contratos
description: 'As RNs hospedadas na raiz contracts.'
keywords: [regras de negócio, contracts]
---

# Contratos

## Git

### RN-028 — Решает capability, а не имя провайдера {#rn-028}

Неподдерживаемая операция (защита ветки в локальном провайдере) объявляется в
`capabilities` и отклоняется с `GitNotSupportedError` — никогда не тихий
сбой.

Capabilities **четыре**: `protectBranch` и `pullRequests` начиная с Фазы 2, и
`listTree` и `pullRequestDiff` начиная с ФАЗЫ 26 (вкладка Code, только
чтение). С ними правило не изменилось — изменился охват. И критерий
объявления по-прежнему — доказательство: capability равна `true` только
тогда, когда набор тестов проверяет её на этом провайдере; без доказательства
объявляется `false` и происходит деградация (тот же критерий, что в ADR
0041/0042).

- **Где:** `packages/shared/src/index.ts` (`GitProviderCapabilities`);
  потолки двух операций чтения в
  `apps/api/src/domain/git/git-read-limits.ts`, вне shared, потому что тот на
  100% состоит из типов
- **Тест:** единый контрактный набор, `test/contract/git-provider.contract.ts`,
  прогоняемый против трёх провайдеров
- **Источник:** [ADR 0001](../adr/0001-git-provider-contract-shape.md)

### RN-087 — Dev Lead — единственный внешний адрес исполнения {#rn-087}

Существует агент `dev-lead`, разговорный, который получает handoff от
Arquiteto (начиная с [RN-672](api.md#rn-672) — от Infra, с
контейнером проекта в `running`) и предлагает **план исполнения**: сколько
агентов на модуль и почему. Он не пишет код — он распределяет работу и
отвечает за неё.

**До него фраза «решает lead» из [RN-083](api.md#rn-083) не имела владельца.**
Arquiteto заканчивал, и исполнение поднималось кнопкой, без кого-либо
посередине, кто оценил бы, сколько работы есть.

**`dev-<modulo>` перестали быть адресуемыми через handoff.** Это не новое
исключение: это правило [ADR 0038](../adr/0038-hierarquia-de-agentes.md) —
внешний handoff адресует только lead области или агента без области, —
начавшее действовать для dev так же, как уже действовало для QA и Infra. Пока
Dev Lead не было, они были агентами БЕЗ области и потому допустимыми целями;
став участниками, они перестают ими быть.

**Область `dev` — первая ДИНАМИЧЕСКАЯ**, и именно это вынудило предикат:
участники — по одному на модуль `module_map`, решаемые Arquiteto и разные в
каждом проекте, так что перечислять нечего. `dev-lead` совпадает с тем же
префиксом `dev-`, что и участники, а исключает его общее правило **lead
никогда не является участником собственной области** — которое действует для
любой области и живёт в одном месте. Первая версия повторяла это исключение в
трёх точках, и проверка мутациями показала, что ни одна из копий не была
достижима тестом: каждая переживала мутацию другой.

**План — это `proposed_action` (пересмотрено [ADR 0086](../adr/0086-dev-lead-plano-suspende-para-aprovacao.md), [RN-284](engine.md#rn-284)).**
До этого изменения план становился простым СОБЫТИЕМ, без одобрения:
аргумент был в том, что у предложения нет внешнего эффекта — расход
происходит, когда агенты поднимаются, и именно там потолок требует
разрешения; превращение предложения в решаемое действие заставило бы вас
решать одно и то же дважды. Аудит `docs/fluxo.yml` × код обнаружил, что поток
уже объявлял этот выход как `via: proposed_action` с ADR 0085, а код так и не
был подогнан под это, — владелец продукта решил, что ошибался код: план —
ПЕРВОЕ реальное решение о том, сколько сессия потратит на параллелизм, и
пользователь стал решать активировать исполнение, УВИДЕВ настоящее
одобрение, а не просто прочитав строку в ленте. Старый урок не исчез — это
причина, по которой `propose_execution_plan` НЕ вошёл в блок абсолютных
потолков `decide.ts` (см. RN-284).

**УСПЕШНЫЙ план завершает ход — на пути БЕЗ приостановки.** При первом
реальном исполнении Dev Lead зарегистрировал **два** `execution.plan_proposed`
в одной сессии — разные тексты, одинаковый итог, — потому что цикл
возвращался к модели, и она предлагала снова. Event log неизменяем: остались
два предложения и ничего, говорящего, какое действует. Инструкция «используй
один раз» в spec инструмента — просьба, а не гарантия; гарантирует остановка
цикла. Начиная с ADR 0086, когда предложение остаётся `pending`, ход
завершает ОСТАНОВКА по приостановке (RN-284) — немедленный успех
(`auto_approved`/`executed`/`approved`, см. RN-284) по-прежнему закрывает цикл
так же, как всегда.

**Успешный, а не «вызвал инструмент»**: отклонённый план (пустой или с нулём
агентов в модуле) позволяет циклу продолжаться, иначе отказ становится концом
хода, и модель так и не доходит до исправления. Первая версия этой защиты
смотрела только на имя инструмента и имела этот дефект — найденный
поведенческим тестом, а не чтением.

Пустой план или план с нулём агентов в модуле отклоняется **до предложения
чего-либо** — предложение, однажды созданное, является реальным решением
пользователя, а наполовину предложенный план нельзя было бы отозвать.

- **Где:** `apps/engine/lib/engine/agents/dev_lead_server.ex` и
  `dev_lead_tools.ex`; правило адресации в
  `apps/api/src/domain/agents/agent-areas.ts`; handoff в
  `application/use-cases/agents/offer-infra-handoff.use-case.ts`
- **Тест:** `apps/engine/test/engine/agents/dev_lead_tools_test.exs`,
  `dev_lead_server_test.exs` (`o plano ENCERRA o turno`, `o plano recusado NÃO
  encerra o turno`),
  `apps/api/test/domain/agents/agent-areas.spec.ts` (`o dev de módulo DEIXOU de
  ser endereçável`, `` `dev-lead` É endereçável, apesar do prefixo ``) и
  `test/application/use-cases/agents/offer-infra-handoff.use-case.spec.ts`
- **Источник:** [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md), ФАЗА 14d;
  механизм одобрения пересмотрен [ADR 0086](../adr/0086-dev-lead-plano-suspende-para-aprovacao.md)

### RN-110 — `blame` — 13-я операция `GitProviderContract`, с тем же словарём отсутствия, что и у других чтений {#rn-110}

Фундамент задолженности по blame, объявленной в ФАЗЕ 26 (ни один экран пока
его не потребляет — это в следующей волне). `blame(ref, path)` возвращает
`GitBlame | null`, где `null` означает ровно то, что уже означает в
`getFileContent`/`listTree`: файл отсутствует в этой ref, или ref не
существует. Два словаря «не существует» для одной вкладки заставили бы экран
обрабатывать один случай двумя способами — та же причина, что уже действовала
для двух предыдущих операций.

Каждый провайдер вычисляет СОБСТВЕННЫМИ средствами, потому что общего
endpoint нет: у GitHub нет blame в REST (только GraphQL — единственная
операция провайдера, говорящая на GraphQL), у GitLab есть
`repository/files/:path/blame`, а локальный берётся из `git blame --porcelain`,
единственный из трёх, протестированный против настоящего репозитория в этой
сессии (два других — только против fake backend контрактного теста — без
`GITHUB_TEST_TOKEN`/`GITLAB_TEST_TOKEN` в окружении против реального API
доказывает ручной smoke). `GIT_BLAME_LINE_LIMIT` (2000) отсекает действительно
огромный файл — уже обрезанный по байтам в маршруте содержимого, но `blame`
читает весь файл у провайдера, прежде чем принять решение.

- **Где:** `packages/shared/src/index.ts` (`BlameInput`, `GitBlame`,
  `GitBlameLine`, capability `blame`),
  `apps/api/src/infrastructure/git/{github,gitlab,local}-provider.ts`,
  `apps/api/src/domain/git/git-read-limits.ts` (`GIT_BLAME_LINE_LIMIT`),
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (метод `blame`), `apps/api/src/interfaces/http/git/code.controller.ts`
  (`GET /projects/:id/code/blame`)
- **Тест:** `apps/api/test/contract/git-provider.contract.ts` (блок "blame"),
  выполняемый тремя spec провайдеров — `local` против настоящего git — и
  `read-project-code.use-case.spec.ts` (блок "blame")
- **Источник:** ФАЗА 26b (фундамент объявленных задолженностей ФАЗЫ 26/
  [ADR 0060](../adr/0060-superficie-de-leitura-de-codigo.md))

### RN-111 — `listPullRequests` — 14-я операция `GitProviderContract`; навигируемый список открывает тот же diff по id {#rn-111}

`CodeDiffPanel.tsx` потребляет `listPullRequests(state?)` в кликабельном
списке (id/номер/заголовок/автор/состояние/ветки, с фильтром по состоянию);
клик по элементу переиспользует ТОТ ЖЕ поток diff по id, который уже
существовал, — нового пути чтения нет, только способ ДОБРАТЬСЯ до id без
необходимости знать его наизусть. Тот, кто уже знает id (например, пришёл из
Aprovações), по-прежнему может вставить его напрямую.

`listPullRequests(state?)` возвращает СВОДКУ по PR
(`GitPullRequestSummary`: id, номер, заголовок, автор, состояние, ветки,
`updatedAt`) — а не `GitPullRequest`, который является типом ЗАПИСИ
(открыть/смержить) и никогда не имел ни заголовка, ни автора, потому что ни
одной из двух операций это не требовалось. Собственный тип не даёт записи
получить поля, которые использует только чтение.

У `local` ЕСТЬ PR — sidecar store Фазы 4a уже является источником, а
предположение формулировки («PR не существует в концепции чистого локального
репозитория») не подтвердилось: самодостаточность dev agents с тех пор
создавала локальные PR. Все три capabilities — `true`. `GIT_PR_LIST_LIMIT`
(100) — одна страница, без последующей пагинации: человеческая навигация, а
не синхронизация истории.

- **Где:** `packages/shared/src/index.ts` (`ListPullRequestsInput`,
  `GitPullRequestSummary`, `GitPullRequestList`, capability
  `pullRequestsList`), `apps/api/src/infrastructure/git/{github,gitlab,
  local}-provider.ts`, `apps/api/src/domain/git/git-read-limits.ts`
  (`GIT_PR_LIST_LIMIT`), `read-project-code.use-case.ts` (метод
  `pullRequests`), `code.controller.ts` (`GET /projects/:id/code/pull-requests`),
  `apps/web/src/routes/code/CodeDiffPanel.tsx` (кликабельный список, фильтр
  по состоянию, переиспользование потока diff по id)
- **Тест:** `git-provider.contract.ts` (блок "listPullRequests"),
  `read-project-code.use-case.spec.ts` (блок "lista de PRs"),
  `apps/web/src/routes/code/CodeDiffPanel.test.tsx`
- **Источник:** ФАЗА 26b

### RN-112 — `listBranchesDetailed` — СОБСТВЕННАЯ операция, отдельная от `listBranches` {#rn-112}

Фундамент богатого выпадающего списка, теперь потребляемый
`CodeBranchPicker.tsx` (`ahead`/`behind`, бейдж PR — волна после ФАЗЫ 26b
закрыла задолженность, которую объявлял `CodeShell.tsx`). Решение было НЕ
расширять `listBranches` — исходную 13-ю операцию, которую bootstrap Gitflow
вызывает, не нуждаясь ни в чём из этого: обогащение стоит дополнительного
вызова провайдера НА КАЖДУЮ ВЕТКУ (два в GitLab, у которого нет endpoint,
возвращающего обе стороны сравнения за один вызов, в отличие от
`compareCommitsWithBasehead` в GitHub и `git
rev-list --left-right --count` в локальном). Прицепить эту стоимость к
каждому принятию/созданию ветки превратило бы bootstrap в дорогой обход. Обе
операции сосуществуют в контракте: `listBranches` для bootstrap,
`listBranchesDetailed` (15-я) для вкладки Code — `GitBranchDetail`
расширяет `GitBranch` только по ФОРМЕ, никогда по КОНТРАКТУ вызывающего.

`ahead`/`behind` всегда относительны к ветке ПО УМОЛЧАНИЮ репозитория
(`ListBranchesDetailedInput.defaultBranch`, которую вызывающий уже знает —
запрашивать её у провайдера снова было бы лишним вызовом только ради того,
чтобы переоткрыть уже известное). `null` в обоих, когда провайдер не может
вычислить (осиротевшая ветка, несвязанная история), — честная деградация,
никогда не выдуманное число. `GIT_BRANCH_DETAIL_LIMIT` (30) отсекает по тем
же причинам трафика, что и пункт 34 ФАЗЫ 26, — без него репозиторий с сотнями
веток превращался бы в сотни вызовов при каждом открытии выпадающего списка.

- **Где:** `packages/shared/src/index.ts` (`ListBranchesDetailedInput`,
  `GitBranchDetail`, `GitBranchDetailList`, `GitBranchPullRequestRef`,
  capability `branchesDetailed`), `apps/api/src/infrastructure/git/{github,
  gitlab,local}-provider.ts`, `git-read-limits.ts`
  (`GIT_BRANCH_DETAIL_LIMIT`), `read-project-code.use-case.ts` (метод
  `branches`), `code.controller.ts` (`GET /projects/:id/code/branches`);
  в web — `apps/web/src/lib/api-client.ts` (`getCodeBranches`) и
  `apps/web/src/routes/code/CodeBranchPicker.tsx` — сам выпадающий список,
  открываемый из `CodeShell.tsx`
- **Тест:** `git-provider.contract.ts` (блок "listBranchesDetailed"),
  `read-project-code.use-case.spec.ts` (блок "branches detalhadas"),
  `apps/web/src/routes/code/CodeBranchPicker.test.tsx`
- **Граничный случай:** метод `branches()` живёт в ТОМ ЖЕ сценарии
  использования, что и остальные шесть чтений (`ReadProjectCodeUseCase`), а не
  рядом с bootstrap — это ЧТЕНИЕ вкладки Code, с тем же разрешением учётных
  данных и теми же воротами контейнера (RN-105), что и остальные; трактовка её
  как операции bootstrap продублировала бы и то и другое. Ref вне списка веток
  (тег или sha) остаётся достижимой — в подвале выпадающего списка есть
  ручное поле, потому что `listBranchesDetailed` не перечисляет эти две вещи.
- **Источник:** ФАЗА 26b (фундамент); следующая волна закрыла UI

## Gate `implementavel` активируется — QA-стратегия как второй момент qa-lead (RN-340/341, ADR 0090)

### RN-341 — QA-стратегия — второй МОМЕНТ qa-lead, и она никогда не приостанавливается {#rn-341}

`docs/fluxo.yml` объявлял роль `qa-estrategia` как `proposto`, с критерием
разделения, записанным в самом реестре: "может быть самим qa-lead во втором
МОМЕНТЕ, не обязательно новым агентом — разделение идёт по результату
работы". [ADR 0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md)
строит ровно это: `Engine.Gates.QaEstrategiaAgent` — модуль БЕЗ СОСТОЯНИЯ (не
`GenServer`), запускаемый `Engine.Gates.QaLeadServer.run_design/3` — НОВОЙ и
ДОБАВОЧНОЙ точкой входа в ТОМ ЖЕ процессе `qa-lead`, без изменения `run/2`
(обычный путь, ревью PR, привязанный к `DevAgentState.find_by_task_id`).

**Контекст ЛЁГКИЙ, и именно здесь проявляется разделение по результату.**
`Engine.Gates.QaEstrategiaContext.fetch/3` получает ТОЛЬКО историю (из
`EngineApiClient.list_backlog/1`, дерева, которое уже читает PO —
[RN-164](engine.md#rn-164)) и действующий `module_map`
(из `EngineApiClient.get_infra_context/2`, ТОГО ЖЕ `GetInfraContextUseCase`,
который потребляет Infra Lead, здесь только по полю `moduleMap`) — БЕЗ
`dev_state`, БЕЗ `worktree_path`: gate `implementavel` работает ДО-DEV, до
появления dev agent, worktree или `task_id`. Никакого нового маршрута в api —
обе функции уже существовали.

**Никогда не приостанавливается.** Реестр инструментов (`ReadFile`,
`SearchWorkspace`, `EmitPlanoDeTeste`) не включает ни `terminal`, ни
`write_file` — ДВА единственных инструмента, которые
`Engine.Harness.Hooks.ActionPipeline` перехватывает для создания
`proposed_action`. Поскольку ни один вызов не проходит через конвейер
действий, `ToolLoop` этого агента никогда не производит `:pending`, а
`run_design/3` работает СИНХРОННО внутри собственного `handle_cast` — без
механизма приостановки/возобновления, в отличие от остальной области QA.

**Потолок итераций остаётся 8 (разговорный), а не 60 (gate) — намеренно, не
пробел.** Этот агент работает БЕЗ `token_budget_micros` — ни задачи, ни
бюджета задачи ещё нет. Критерий [RN-085](engine.md#rn-085) —
не "кто много работает", а "что удерживает расход сверх потолка итераций".
Без бюджета под ним повышение потолка умножило бы худший случай, ничем его
не сдерживая, — ТА ЖЕ причина, по которой `infra-workflows` остаётся на 8,
хотя и использует инструмент. `"qa-estrategia"` НЕ получил собственной клаузы
в `Engine.Harness.Iteracoes.tipo/1`: попасть в значение по умолчанию —
правильное решение.

Результат — `emit_plano_de_teste` (синтез, проверяемые исполняемые критерии,
ОБЩАЯ стратегия автоматизации без фреймворка — решение о рамках этого
направления, в `spec/0`, которую читает модель, а не проверка в коде) —
становится артефактом `artifact.plano_de_teste` (`ArtifactEmitter.emit/5`,
схема проверена, `criteriosExecutaveis` не может быть пустым), в журнале
событий ТОЙ ЖЕ сессии, которая вызвала `run_design/3`, — именно там его потом
читает `assess_implementability` ([RN-340](api.md#rn-340)). Сбой (лимит итераций,
бюджет, модель, остановившаяся без испускания) НИКОГДА не молчалив:
долговечный `agent.error` с источником, та же линейка, что в
[RN-059](engine.md#rn-059).

**Начиная с [RN-674](engine.md#rn-674) (ADR 0192) МОМЕНТ изменился.** Второй момент
по-прежнему принадлежит `qa-lead`, без нового агента, и по-прежнему никогда
не приостанавливается; но он выполняется ПОСЛЕ сдачи работы, в начале цикла
`run/2`, с worktree dev и файлами diff — `run_design/3` и
`QaEstrategiaContext` удалены, а артефакт получил `taskId`. Потолок
по-прежнему 8, теперь С бюджетом задачи под ним.

- **Где:** `apps/engine/lib/engine/gates/qa_estrategia_agent.ex`,
  `qa_lead_server.ex` (`run_area/3`, начиная с [RN-674](engine.md#rn-674)),
  `tools/emit_plano_de_teste.ex`, `hooks/termination_plano_de_teste.ex`;
  `apps/engine/lib/engine/harness/artifact_schemas.ex` (`plano_de_teste`);
  `apps/engine/lib/engine/harness/iteracoes.ex` (БЕЗ новой клаузы, см.
  выше); `docs/fluxo.yml` (`qa-estrategia`, `status: active`)
- **Тест:** `apps/engine/test/engine/gates/qa_estrategia_agent_test.exs`,
  `qa_lead_server_test.exs` (describe "plano de teste da entrega (ADR 0192)"), `apps/engine/test/engine/harness/artifact_schemas_test.exs`
  (describe "plano_de_teste"), `iteracoes_test.exs` ("qa-estrategia é
  conversacional DE PROPÓSITO")
- **Источник:** [ADR 0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md)

---

## `secops-runtime` — отчёт о злоупотреблениях по `rate_limit_hits` (RN-375..377, ADR 0091)

### RN-377 — Раздел "не измерено" постоянен и называет три пробела по имени {#rn-377}

`montarRelatorio` всегда включает `naoMedido`: автоматическое обнаружение
инцидента, реагирование на инцидент и постмортем безопасности. Все три
зависят от того же триггера, который `docs/fluxo.yml` уже объявлял для
`secops-runtime`, — реального продакшен-трафика, — и ни один из них не
имитируется примерным инцидентом или выдуманным числом (тот же принцип, что в
ADR 0041/0042/0077: без реальных данных пробел остаётся видимым, а не
изображённым). Раздел уйдёт из списка только тогда, когда у продукта будет
реальный трафик, против которого его можно измерить, — это не TODO, который
стирают при следующей уборке.

- **Где:** `apps/api/scripts/relatorio-seguranca-runtime.ts`,
  `apps/api/package.json` (`relatorio:seguranca-runtime`)
- **Тест:** `apps/api/test/scripts/relatorio-seguranca-runtime.spec.ts`
- **ADR:** [0091](../adr/0091-secops-runtime-relatorio-de-abuso.md)

---

## `platform` получает первую поставку: отчёт о телеметрии по запросу (RN-385/386, ADR 0092)

### RN-385 — Роль `platform` рождается как СКРИПТ разового чтения по тем же источникам, что `DomainGaugesCollector` {#rn-385}

`docs/fluxo.yml` описывает `platform` (`camada_plataforma`) как "SRE / Platform
— владелец петли обратной связи", `status: planned`, с активацией,
синхронизированной с `DEPLOY_ENABLED`, — которого не существует. Владелец
продукта решил опередить ту половину, за которой уже стоят реальные данные:
`pnpm --filter api relatorio:telemetria
[--projeto <uuid>] [--json]` по запросу читает ТЕ ЖЕ вопросы, на которые
`DomainGaugesCollector` уже отвечает каждые `METRICS_GAUGE_INTERVAL_MS` для
scrape Prometheus, — активные/closing сессии по проекту, заблокированные
задачи по проекту, состояние последнего бэкапа (возраст, статус, размер,
всегда ГЛОБАЛЬНО, никогда по проекту, потому что бэкап у продукта один). Это
не LLM-агент и не `GenServer`: это разовое чтение без состояния, которое
завершается после печати.

SQL-запросы ПРОДУБЛИРОВАНЫ, а не импортированы из коллектора — его методы
(`collectSessions`/`collectBlockedTasks`/`collectBackup`) приватны и
заканчиваются записью в gauge Prometheus (`this.metrics.*.set(...)`); нет
чистой половины "только запрос", которую можно переиспользовать, не связав
разовый скрипт с жизненным циклом `@Injectable` NestJS. Скрипт также НЕ
является вторым коллектором: он не регистрирует никакой метрики и не работает
в `setInterval`.

Вывод всегда содержит "где посмотреть больше" (три версионируемых дашборда
в `deploy/k8s/observability/dashboards/*.json`, алерты в
`deploy/k8s/observability/alerts/brabo-alerts.yaml`, `docs/runbook.md
#observabilidade` и `pnpm dev:obs` для локальной наблюдаемости) — скрипт
ССЫЛАЕТСЯ на то, что уже существует, и никогда не дублирует.

- **Где:** `apps/api/scripts/relatorio-telemetria.ts`; отражает
  `apps/api/src/infrastructure/observability/domain-gauges.collector.ts`
- **Тест:** `apps/api/test/scripts/relatorio-telemetria.spec.ts` (чистые
  функции — `parseArgs`, `formatarIdade`, `formatarBytes` — тот же срез, что у
  `medir-execucao.spec.ts`: часть, говорящая с базой, проверяется запуском
  скрипта против реальной базы)
- **ADR:** [0092](../adr/0092-platform-relatorio-de-telemetria-sob-demanda.md)

### RN-386 — Отчёт о телеметрии объявляет, ничего не выдумывая, то, что он НЕ измеряет {#rn-386}

Реального триггера роли `platform` (`DEPLOY_ENABLED`) не существует: нет
продакшен-окружения с реальным трафиком, нигде в продукте не определён
числовой SLO, и постмортем невозможен без настоящего инцидента.
`relatorio-telemetria.ts` говорит это в СОБСТВЕННОМ выводе, в разделе "не
измерено", вместо того чтобы изображать покрытие, которого нет, — та же
дисциплина, что в ADR 0042 для оценки модели и в ADR 0077 для качества кода:
без реальных данных продукт ОБЪЯВЛЯЕТ пробел и никогда не выдумывает число.

Три пробела, все явные: **формальный числовой SLO** (ни один не определён);
**постмортем** (зависит от реального инцидента, которого не было); и
**телеметрия обратно в продукт в замкнутой петле** (скрипт — разовое чтение
по запросу; наблюдать, решать и действовать самостоятельно — вот что сделало
бы `platform` `active` в `docs/fluxo.yml`, и поэтому `gate_saida: { id:
operavel, status: planned }` роли остаётся `planned`, не тронутым этим
изменением).

- **Где:** `apps/api/scripts/relatorio-telemetria.ts` (функция `imprimir`,
  раздел "Не измерено"); `docs/fluxo.yml` (`camada_plataforma › platform ›
  saidas_alvo`, артефакт `telemetria-consolidada`, поле `nota`)
- **Тест:** косвенное покрытие — раздел является фиксированным текстом,
  проверяемым чтением файла; здесь нет условной истины для тестирования
  (ошибиться между "измерено" и "не измерено" можно только в самом тексте)
- **ADR:** [0092](../adr/0092-platform-relatorio-de-telemetria-sob-demanda.md)

---

## Аудит fluxo.yml × код — Волна 2: RN-160 на бэкенде и делегирование Dev Lead → dev (RN-404/405, ADR 0094)

### RN-405 — Делегирование Dev Lead → dev становится данными в `delegations`, с `parecerArtifactId`, переопределённым как "то, что обосновало решение" {#rn-405}

ADR 0053 (ФАЗА 14d) уже предусматривал делегирование Dev Lead →
`dev-<modulo>` как "тот же путь, что у QA и Infra" (`delegations`,
`area = 'dev'`), но объявил это вне рамок. `dev_lead_server.ex` никогда не
писал в таблицу — писали только QA (`qa_lead_server.ex`) и Infra
(`infra_lead_server.ex`), и оба на стороне ENGINE, потому что именно там
субагент производит ЗАКЛЮЧЕНИЕ (вердикт одного раунда), обосновывающее
`parecerArtifactId`.

У Dev Lead такого паттерна нет: активация `dev-<modulo>` происходит на
стороне API, в `AcceptParallelizationUseCase.execute` — вызываемом как
прямым путём (`RequestParallelizationUseCase`, ниже потолка сессии
[RN-083](api.md#rn-083)), так и одобренным
(`ExecuteParallelizationUseCase`, после того как пользователь одобрит
`proposed_action` типа `parallelize`). Запись вошла ВНУТРЬ этого метода —
она бесплатно покрывает оба пути, потому что оба уже сходятся там, — со
`status: 'completed'`, ПЕРЕОПРЕДЕЛЁННЫМ для этой области: он означает
"делегирование ОСУЩЕСТВЛЕНО" (агент поднялся), а не "субагент закончил и
выдал заключение", как в QA/Infra (решение записано в
[ADR 0094](../adr/0094-delegacao-dev-lead-vira-dado.md)).

`parecerArtifactId` указывает на `id` самого свежего действующего события
`artifact.module_map` проекта — полученного из
`SessionEventRepository.listByTypeForProject(projectId, 'artifact.module_map')`
(уже существующий общий метод, используемый `computeCoverage` для
`artifact.business_rule`; новый запрос не писался, лишь ещё один его вызов —
последний элемент списка самый свежий, потому что функция упорядочивает по
`createdAt` ASC), — артефакт, обосновавший решение делегировать.
`area: 'dev'`, `leadAgent: 'dev-lead'`, `subagent` — точный id активированного
агента (`extraDevAgentId(module)`, ТА ЖЕ функция, что строит id во всём
остальном сценарии использования, — никакого нового формата). Без
`artifact.module_map` в проекте (такого быть не должно — это обязательный
вход Dev Lead в `docs/fluxo.yml`) делегирование НЕ записывается с выдуманным
id: лишь логируется неожиданное состояние, по тому же уроку RN-059 (никогда
не тихий сбой, но и никогда не изображение несуществующего обоснования). А
сбой `RecordDelegationUseCase.execute` (например, база недоступна)
перехватывается и логируется, никогда не распространяется — активация dev
agent уже является успехом к моменту попытки записать делегирование и не
может быть обрушена вспомогательной записью.

- **Где:** `apps/api/src/application/use-cases/execution/accept-parallelization.use-case.ts`
  (`recordDevDelegation`, вызывается в конце `execute`)
- **Тест:** `apps/api/test/application/use-cases/execution/accept-parallelization.use-case.spec.ts`,
  describe "delegação Dev Lead → dev (área dev, ADR 0094)" — записывает с
  `area: 'dev'`, указывая на самый свежий module_map; без module_map не
  записывает (и не выбрасывает); сбой `RecordDelegationUseCase` не роняет
  активацию
- **ADR:** [0094](../adr/0094-delegacao-dev-lead-vira-dado.md)

---

## Аудит fluxo.yml × код — Волна 6 (последняя): gate `necessidade-validada` (RN-406, ADR 0095)

Закрывает последнюю находку плана аудита (раздел D,
`docs/explanation/auditoria-fluxo-vs-codigo.md`) — B2. Остальные пять волн
уже закрылись (3, 4 и 5 — досрочно, вне порядка, ADR 0089/0090; 1 и 2 — в
предыдущих PR). `docs/fluxo.yml` (роль `criativo`) объявлял `gate_saida: { id: necessidade-validada, status:
proposto }` начиная с ADR 0085 без какого-либо механизма за ним — и
`modelo-de-time.md` уже записывал почему: Criativo (модель), решающий в
одиночку, что потребность, которую он сам произвёл, проверена, — это
самопроверка, а не настоящий gate.

### RN-406 — Gate `necessidade-validada` закрывается ОТДЕЛЬНЫМ кликом пользователя, никогда самопроверкой Criativo {#rn-406}

> **Пересмотрено [ADR 0185](../adr/0185-estou-pronto-fecha-os-dois-gates.md)
> ([RN-657](api.md#rn-657)) по решению владельца от 30.09.** Клик перестал быть
> ОТДЕЛЬНЫМ: "Я готов — потребность проверена" записывает
> `readiness.confirmed` и `necessity.validated` в одном POST, с
> `product_brief`, произведённым ПОСЛЕ клика (`productBriefId: null`). Кнопка
> "Подтвердить проверку потребности" убрана с экрана. Что из этого правила
> продолжает действовать: проверяет всегда ЧЕЛОВЕК, никогда Criativo; gate
> остаётся `warn`. `POST .../agents/criativo/validate-necessity` остаётся в
> api без потребителя на экране — это путь для сессии, чьё "Я готов"
> предшествует ADR 0185. Текст ниже — дизайн ADR 0095, сохранённый как
> история.

`SessionPage.tsx` получает третью кнопку подтверждения, в ТОМ ЖЕ
интерактивном паттерне, что "Я готов производить" (RN-142) и "Подтвердить
готовность архитектуры" ([RN-160](web.md#rn-160)):
"Подтвердить проверку потребности" (`handleValidateNecessity`) вызывает `POST
.../agents/criativo/validate-necessity`, который записывает
`necessity.validated` с `payload.productBriefId`, указывающим на самый свежий
`artifact.product_brief` сессии.

Кнопка включается только ПОСЛЕ того, как `confirm_readiness` уже
консолидировал `product_brief` (`hasProductBrief`, `events.some(e => e.type ===
'artifact.product_brief')`) — нет смысла "проверять" исполнительное резюме,
которое ещё не произведено, и это наиболее согласованное прочтение
`docs/fluxo.yml`: `necessidade-validada` — gate ВЫХОДА Criativo, момент, когда
его работа уже сдала конкретный артефакт. `ValidateNecessityUseCase`
повторно проверяет то же предусловие на БЭКЕНДЕ
(`SessionEventRepository.listByTypeInSession(sessionId,
'artifact.product_brief')`, берёт последний по `seq`) — одного отключённого UI
было бы недостаточно, тот же урок, что в [RN-404](api.md#rn-404).

В отличие от `OfferInfraHandoffUseCase` (RN-160), это подтверждение НЕ
сигнализирует engine: handoff Criativo→PO уже произошёл внутри самого
`confirm_readiness`
(`CriativoServer.executar_confirm_readiness/1`), поэтому никакой агент не
ждёт этого события — это лишь запись того, что человек проверил СУТЬ уже
сданного. `ValidateNecessityUseCase` не получает `ApiToEngineClient` в
конструкторе.

`docs/gates.yml` получает gate `necessidade-validada`: `status: active`,
`aprovacao_humana: true` (это буквально клик человека),
`verificacao: script`, но `severidade: warn` — ничто в продукте сегодня не
ПРОВЕРЯЕТ прохождение этого gate, прежде чем позволить PO продолжить (в
отличие от `story-promovida`/`plano-de-adocao`, которые `block`, потому что
реальная блокировка в коде не даёт их пропустить). `docs/fluxo.yml` (роль
`criativo`) переходит со `status: proposto` → `status: ativo`.

- **Где:** `apps/api/src/application/use-cases/agents/validate-necessity.use-case.ts`;
  `apps/api/src/interfaces/http/agents/agents.controller.ts`
  (`validateNecessityHandoff`); `apps/web/src/routes/SessionPage.tsx`
  (`hasProductBrief`, `necessidadeJaValidada`, `handleValidateNecessity`)
- **Тест:** `apps/api/test/application/use-cases/agents/validate-necessity.use-case.spec.ts`
  — без `product_brief` отказывает ДО записи какого-либо события; с одним или
  несколькими записывает, ссылаясь на САМЫЙ СВЕЖИЙ;
  `apps/web/src/routes/SessionPage.validar-necessidade.test.tsx` — кнопка
  отключена без `product_brief`, включена с ним, исчезает после
  `necessity.validated`
- **ADR:** [0095](../adr/0095-gate-necessidade-validada.md)

---

### RN-407 — PO читает воронку поставки и частичные DORA, третье чтение в рамках проекта {#rn-407}

PO получил ТРЕТИЙ инструмент чтения — `listar_metricas_de_produto`
(`:direct`, вообще без параметров), — обслуживаемый
`GET /internal/projects/:projectId/product-metrics`, тот же дизайн, что у
двух соседних инструментов [RN-164](engine.md#rn-164):
область, замкнутая на проекте, без поискового термина, без пагинации.

`docs/fluxo.yml` (роль `po`, вход `metricas-de-produto`) объявлял
`status: lacuna` начиная с
[ADR 0089](../adr/0089-analytics-e-delivery-metricas-como-relatorio.md), который
уже поставил ДАННЫЕ — скрипт `pnpm --filter api analise:funil` измеряет
реальную воронку сессия → коммит → PR → merge, реальный lead time и реальную
частоту деплоя по `proposed_actions`. Не хватало лишь МЕХАНИЗМА: у PO никогда
не было способа перечитать этот отчёт внутри хода. Закрывает пункт B4 аудита
`fluxo.yml` × код
([docs/explanation/auditoria-fluxo-vs-codigo.md](../explanation/auditoria-fluxo-vs-codigo.md)) —
ПОСЛЕДНИЙ незакрытый пункт таблицы "Бэклог модели команды"
(docs/explanation/backlog.md), которая после этого становится пустой.

ВЫЧИСЛЕНИЕ — ТО ЖЕ, что у скрипта, никогда не дублированное: чистые функции
(`calcularFunil`/`calcularLeadTimes`/`leadTimeMedioMs`/
`deploymentFrequencyPorDia`) и запрос, собирающий `AcaoGit[]`
(`buscarAcoesGitDoFunil`), извлечены из `apps/api/scripts/analise-funil.ts`
в `apps/api/src/application/services/funil-metrics.ts` — сценарий
использования в `src/` не может импортировать из `scripts/`, и скрипт стал
РЕЭКСПОРТИРОВАТЬ оттуда вместо локального определения, без изменения
сигнатуры и поведения (регрессионный тест скрипта остаётся зелёным, не будучи
тронутым).

JSON-тело, которое возвращает маршрут, **не имеет никакого поля** для трёх
постоянных отсутствий, которые скрипт уже объявлял текстом ("Не измерено,
намеренно": полная продуктовая воронка генерация идей → коммит,
доказательство принятия по функциям, MTTR/change failure rate) — форма
отчёта никогда не резервировала для них места. Инструмент PO называет все три
по ИМЕНИ в ТЕКСТЕ, который возвращает модели, всегда, а не только когда число
равно нулю: без этого раздела PO читал бы только числа воронки и по умолчанию
заключил бы, что никакого пробела нет.

- **Где:** `apps/api/src/application/services/funil-metrics.ts`;
  `apps/api/scripts/analise-funil.ts` (реэкспортирует);
  `apps/api/src/application/use-cases/backlog/list-product-metrics.use-case.ts`;
  `apps/api/src/interfaces/http/internal/internal-projects.controller.ts`;
  `apps/api/src/interfaces/http/internal/dto/product-metrics.response.dto.ts`;
  `apps/engine/lib/engine/harness/tools/listar_metricas_de_produto.ex`;
  `apps/engine/lib/engine/agents/po_server.ex`;
  `apps/engine/lib/engine/sessions/engine_api_client.ex`
- **Тест:** `apps/api/test/application/use-cases/backlog/list-product-metrics.use-case.spec.ts`;
  `apps/api/test/scripts/analise-funil.spec.ts` (регрессия — по-прежнему
  импортирует из `scripts/analise-funil.ts`, без изменений);
  `apps/engine/test/engine/harness/tools/listar_metricas_de_produto_test.exs`;
  `apps/engine/test/engine/agents/po_server_test.exs`
- **Источник:** тот же паттерн, что у
  [RN-164](engine.md#rn-164) (чтение агентом в рамках
  проекта, без внешнего эффекта, без `proposed_action`); данные — из
  [ADR 0089](../adr/0089-analytics-e-delivery-metricas-como-relatorio.md), эта
  RN лишь закрывает недостающий механизм чтения.

## Репозиторий рождается при принятии handoff к Arquiteto, а выполнение без него не начинается (RN-582) {#o-repositório-nasce-no-aceite-do-handoff-ao-arquiteto-e-a-execução-não-começa-sem-ele-rn-582}

### RN-605 — Pull образа — ИМЕНОВАННЫЙ шаг `start` под управляющим потолком, а превышение говорит, что большой образ не поднимается {#rn-605}

`start` порта Docker не делал pull: его делал `docker run` внутри, под
`TIMEOUT_DE_CONTROLE_MS` (30 с). Воспроизведено в AT-234 дублёром демона
(образа нет, pull 45 с, без сна и без сети): превышение выходило как
`ComandoDeDockerFalhouError` — «`docker run …` terminou com código -1: (sem
saída de erro)», — становилось 502 с `origem: null` в брокере и доходило до api
без имени. А убийство CLI ОТМЕНЯЕТ pull (измерено в Docker 29.8.0, containerd):
образ оставался отсутствующим следующие 60 с, так что фраза «pull может
продолжаться в демоне» была неверна.

Из четырёх измеренных выходов (собственный потолок ~300 с, асинхронный
`start`, досрочный pull при решении об образе, только дать имя) мейнтейнер решил
**D — только дать имя** (2026-09-27). Правило:

1. **Pull явный.** Перед `run` — `image inspect`; присутствующий образ не
   скачивается снова (тот же `--pull missing`, что у `run`). Отсутствующий —
   `docker pull` под ТЕМ ЖЕ управляющим потолком 30 с — никакого большего
   потолка.
2. **У превышения есть имя.** `PullExcedeuTetoError`, источник `infra`, с
   образом, потолком и полным последствием: pull отменён, образ по-прежнему
   отсутствует, большой образ этим путём не поднимается, а исправление —
   скачать его заранее на хосте. Прежде чем это утверждать, адаптер
   проверяет демон (`docker version`): недоступный демон остаётся
   `DockerIndisponivelError`. Pull, упавший по другой причине, идёт обычным
   путём (`ComandoDeDockerFalhouError`, без источника, ADR 0128).
3. **Имя проходит насквозь.** Брокер отвечает 504 с `origem: 'infra'`, а api
   передаёт его в `BrokerRecusouError` — `origem` заполнен, никогда `null`. В
   режиме `runner` тот же адаптер работает на машине пользователя, и сообщение
   приходит в `container_start_result`.
4. **Потолки ждущих `start` считают весь худший случай**: два `ps` в
   `resolver`, `image inspect`, `pull`, `run` и диагностический
   `docker version` — шесть управляющих вызовов
   (`CHAMADAS_DE_CONTROLE_NO_START`). Api ждёт 10 + 6 × 30 + 5 = **195 с**
   (`TETO_DE_MUTACAO_MS`); engine в `RunnerRouter` — 6 × 30 + 5 = **185 с**
   для `start` и 4 × 30 + 5 = **125 с** для `stop`/`remove` (было 60 с, меньше,
   чем `resolver` плюс операция).
5. **`propose_action` engine ждёт выполнения, которое api делает внутри
   него.** Автоодобренные `container_start`, `container_start_via_runner` и
   `container_stop` ВЫПОЛНЯЮТСЯ в том же запросе (`ProposeActionUseCase`), а
   вызов падал в значение по умолчанию Req, 15 с, — длинный `start`
   возвращался как timeout транспорта даже без pull. Теперь он несёт
   `receive_timeout` **225 с** (потолок api + 30 с), зеркалированный в api как
   `TETO_DO_PROPOSE_ACTION_DE_CONTAINER_NO_ENGINE_MS`; тесты обеих сторон
   проверяют брокер < api < engine и runner < engine. `container_remove` вне:
   он никогда не рождается автоодобренным.

Ни одной новой зависимости
([ADR 0128](../adr/0128-porta-de-docker-e-a-prova-de-empacotamento.md)), ни одного
поля, которое пишет вызывающий ([ADR 0130](../adr/0130-broker-de-container.md)):
образ по-прежнему берётся из решения Arquiteto, а `pull` — не новая операция
брокера, а шаг `start`.

**Заявлено, не закрыто:**

- **Большой образ не поднимается с первой попытки** ни через брокер, ни через
  runner — решение D мейнтейнера. Итог теперь именован; исправление —
  скачать образ заранее на хосте.
- **В худшем случае сбоя одобрение зависает до ~195 с**:
  `ExecuteContainerStartUseCase` выполняется внутри `POST` одобрения, и ни
  web, ни HTTP-сервер не имеют собственного потолка.
- Не измерено, переиспользуются ли слои, скачанные до отмены, при следующей
  попытке.

- **Код:**
  `packages/docker-port/src/docker-cli.ts:192` (`PullExcedeuTetoError`),
  `:553` (`garantirImagem`), `:115` (`CHAMADAS_DE_CONTROLE_NO_START`),
  `:106` (`TIMEOUT_DE_CONTROLE_MS`);
  `apps/broker/src/servidor.ts:199` (`PullExcedeuTetoError`);
  `apps/api/src/infrastructure/http-clients/container-broker.client.ts:205` (`TETO_DE_MUTACAO_MS`),
  `:175` (`CHAMADAS_DE_CONTROLE_NO_START`),
  `:228` (`TETO_DO_PROPOSE_ACTION_DE_CONTAINER_NO_ENGINE_MS`);
  `apps/engine/lib/engine/sessions/engine_api_client.ex:1872` (`opcoes_do_propose_action`),

  `apps/engine/lib/engine/sessions/engine_api_client.ex:1872` (`opcoes_do_propose_action`),
  `:1649` (`@teto_do_propose_action_de_container_ms`);
  `apps/engine/lib/engine/runners/runner_router.ex:52` (`@timeout_do_start_ms`)
- **Тест:** `packages/docker-port/src/docker-cli.spec.ts:425` (describe
  воспроизведения, "(AT-234)": pull 45 с заканчивается ИМЕНОВАННО, `:457`;
  недоступный демон остаётся недоступным демоном, `:481`; помещающийся pull
  поднимается, `:493`; присутствующий образ не скачивается, `:508`; шесть
  вызовов, `:520`);
  `apps/broker/src/servidor.spec.ts:317` (504 с источником `infra`);
  `apps/api/test/infrastructure/http-clients/container-broker.client.spec.ts:144`
  (приходит с `origem`), `:362` и `:377` (расчёт и порядок);
  `apps/runner/src/index-handlers.spec.ts:420` (имя в
  `container_start_result`);
  `apps/engine/test/engine/sessions/engine_api_client_propose_action_test.exs:67`
  (настоящий HTTP: api, задерживающаяся на 16 с, дожидается), `:82` и `:95`
  (действия и порядок, читая зеркало api);
  `apps/engine/test/engine/runners/runner_router_test.exs:183`
- **Источник:** AT-234

## Решать в чате, там, где находится владелец (RN-626) {#decidir-no-chat-onde-o-dono-está-rn-626}

### RN-627 — Контейнер проекта работает от владельца папки, измеренного api {#rn-627}

При `--cap-drop ALL` root контейнера не имеет `CAP_DAC_OVERRIDE` и не пишет в
папку проекта, принадлежащую uid оператора: `npm install` давал `EACCES` для
каждого dev agent (AT-247, [ADR 0180](../adr/0180-container-com-o-dono-da-pasta.md)).

1. **api измеряет, broker составляет.** `container-spec` возвращает
   `usuarioDaPasta` (`stat` папки режимов `container`/`mounted`; `null`, если
   папка недостижима, если владелец root или если проект `runner`). Broker
   копирует его в `spec.usuario`, а адаптер выдаёт `--user uid:gid` и
   `--env HOME=/tmp`.
2. **Никогда не приходит от того, кто просит.** У `start` нет тела, а тело
   `exec` игнорирует лишнее поле; `exec` наследует пользователя контейнера.
3. **Broker перепроверяет.** Целые в 1..2^31-1; `0` отклоняется с указанием
   `usuario.uid`/`usuario.gid` (root — это отсутствующий, «как всегда»).
4. **Не ослабляет изоляцию**: `--cap-drop ALL`, один bind, сеть из двух
   значений и пять операций остаются. Уже созданный контейнер меняется только
   при пересоздании.

- **Где:** `packages/docker-port/src/docker-cli.ts:637` (`argsDeCriacao`),
  `packages/docker-port/src/spec-de-container.ts:141` (`usuarioValidado`),
  `apps/broker/src/operacoes.ts:385` (`especificacaoDoProjeto`),
  `apps/api/src/application/use-cases/containers/obter-spec-de-container.use-case.ts:110`
  (`ObterSpecDeContainerUseCase`)
- **Тест:** `packages/docker-port/src/docker-cli.spec.ts` (`run` несёт
  `--user` и по-прежнему без свободного поля), `packages/docker-port/src/spec-de-container.spec.ts`
  (`usuario`), `apps/broker/src/operacoes.spec.ts` ("o usuário do container"),
  `apps/api/test/application/use-cases/containers/spec-e-observacao-de-container.use-case.spec.ts`
- **Источник:** AT-247

## Anamnese не платит дважды за одно окно, а спасение gate не перезапускает цикл, который кого-то ждёт (RN-722) {#a-anamnese-não-paga-duas-vezes-pela-mesma-janela-e-o-resgate-de-gate-não-reinicia-ciclo-que-espera-alguém-rn-722}

### RN-738 — Остановка контейнера проекта мгновенна, а строка `/containers` перечитывается при решении {#rn-738}

- **Правило:** каждый контейнер проекта поднимается с `--init` — КОНСТАНТОЙ
  композиции `docker run` в `DockerViaCli`, никогда не полем spec (изоляция —
  это тип, ADR 0130); действует для broker и runner, которые используют тот
  же порт. Команда ожидания (`sleep infinity`) была PID 1 без обработчика
  SIGTERM, а ядро не доставляет PID 1 сигнал с действием по умолчанию:
  `docker stop` ждал 10 с и убивал (`Exited (137)`). Измерено в одноразовом
  контейнере: 10,25 с без `--init`, 0,20 с с ним. На странице `/containers`
  решение ожидающего действия (одобрить, отклонить, всегда разрешать)
  инвалидирует `['containers-overview']` и
  `['container-lifecycle', projectId]` в `finally` — также когда вызов падает
  или обрывается, — и возвращает promise карточке. Никакого нового poll
  (RN-579/632).
- **Где:** `packages/docker-port/src/docker-cli.ts:637` (`argsDeCriacao`),
  `apps/web/src/routes/ContainersPage.tsx:72` (`invalidateContainers`), `:183`
  (`aprovar`)
- **Тест:** `packages/docker-port/src/docker-cli.spec.ts` (`run` несёт
  `--init` перед командой), `apps/broker/src/contencao-do-brabo.spec.ts`
  (оба режима поднимаются с `--init`), `apps/web/src/routes/ContainersPage.test.tsx`
  (одобрение перечитывает обзор и жизненный цикл; отклонённое одобрение тоже
  перечитывает)
- **Источник:** AT-422 (локальная установка, 03.10: три остановки `executed`
  со строкой в "rodando" и `Exited (137)`)

### RN-807 — `exec`, превысивший потолок, возвращается как превышение, а команда умирает внутри контейнера {#rn-807}

- **Правило:** превышение потолка `exec` в `DockerPort` решается по ЧАСАМ
  (прошло ≥ потолка) помимо `killed`, потому что клиент `docker exec`
  перехватывает SIGTERM от `timeout` `execFile` и выходит с кодом 0 —
  измерено: `sleep 30; echo FIM` под потолком 3 с возвращал `erro: null`,
  `stdout: ""`, а адаптер возвращал `exitCode: 0`. Команда агента,
  превышавшая 120 с, возвращала «exit 0», и QA одобрил зависающую suite.
  Превышение теперь возвращает `exitCode: -1`, `timedOut: true` и метку
  timeout. А убийство клиента не убивает команду: `exec` оборачивает команду
  (которая остаётся ОДНИМ аргументом, нетронутым) в `sh`, записывающий свой
  PID — лидер группы и сессии, потому что runtime делает `setsid` в каждом
  `docker exec`, — в `/tmp` контейнера; при превышении адаптер убивает ГРУППУ
  по этому PID (SIGKILL) во внутреннем вызове, без новой операции в порте (ADR
  0130). Измерено и отвергнуто: `timeout` busybox внутри `sh -c` — сторож
  умирает вместе с клиентом, а `sleep` выживает. Если убийство падает (`/tmp`
  без записи, например), метка говорит, что процесс мог выжить.
- **Где:** `packages/docker-port/src/docker-cli.ts:269` (`estourouOTeto`),
  `packages/docker-port/src/docker-cli.ts:455` (`matarExecEstourado`)
- **Тест:** `packages/docker-port/src/docker-cli.spec.ts` ("erro nulo depois do
  teto É estouro"; "no estouro mata o grupo do comando DENTRO do container";
  "o comando que estoura volta timedOut e MORRE dentro do container", против
  настоящего Docker, пропускается без демона)
- **Источник:** AT-482

### RN-820 — Контейнер проекта возвращается сам, когда демон перезапускается {#rn-820}

- **Правило:** `docker run`, составленный `DockerViaCli`, несёт
  `--restart unless-stopped` как КОНСТАНТУ, рядом с `--init` из
  [RN-738](#rn-738) — spec не получает поля, а изоляция ADR 0130 не меняется.
  Перезапущенный демон (обновление системы) снова поднимает контейнер
  проекта; явный `docker stop` (`container_stop` жизненного цикла) НЕ
  отменяется, потому что `unless-stopped` не поднимает то, что остановлено
  вручную, — никогда `always`. Измерено: контейнер `unless-stopped`,
  остановленный `docker stop`, остаётся `exited` с `RestartCount=0`.
- **Где:** `packages/docker-port/src/docker-cli.ts:637` (`argsDeCriacao`)
- **Тест:** `packages/docker-port/src/docker-cli.spec.ts` ("cria o container
  com rótulo gerenciado, UM bind e as capabilities derrubadas")
- **Источник:** AT-494 (перезапущенный демон оставил каждый контейнер проекта
  `Exited (143)` при записи `running`)
