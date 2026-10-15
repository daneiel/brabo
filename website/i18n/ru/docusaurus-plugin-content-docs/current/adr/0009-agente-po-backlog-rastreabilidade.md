---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0009 — Агент PO, backlog (epics/stories/tasks) и прослеживаемость

- Статус: принят
- Дата: 2026-07-24
- Фаза: 3b (сессия 2)

## Контекст {#contexto}

Сессия 1 3b поставила разговорный Criativo (выдаёт `business_rule`,
консолидирует `product_brief` и **предлагает** handoff к PO — `handoffs` со статусом
`offered`, правило активации, требующее `accepted`). Эта сессия замыкает цикл:
пользователь **принимает** handoff, **PO** активируется, потребляет brief + правила
и **производит backlog** (эпики → истории → задачи) с DoD/DoR и обязательной
привязкой к бизнес-правилам, сохраняя прослеживаемость правило→stories.

## Решения {#decisões}

### 1. PO как разговорный GenServer с циклом tool use на ход {#1-po-como-genserver-conversacional-com-loop-de-tool-use-por-turno}
`Engine.Agents.PoServer` повторяет `CriativoServer` (GenServer на сессию,
состояние + регидратация + streaming через канал Phoenix), но **каждый ход выполняет
ограниченный цикл tool use**: диспетчеризирует `create_epic/create_story/create_task` и
**внедряет результат (id/ошибку) обратно как сообщение `tool`**, повторно вызывая
модель — так она выстраивает цепочку (id эпика → `create_story` → `create_task`).
Criativo так не делает (один ход). Активированный принятым handoff (а не
командой пользователя), PO делает `:kickoff` при СВЕЖЕМ старте (читает brief + правила
из event log и генерирует backlog); перезапуск/повторная активация не генерируют заново.

### 2. Backlog в собственных таблицах; массивы в JSONB; привязка к правилу по ULID {#2-backlog-em-tabelas-próprias-arrays-em-jsonb-vínculo-a-regra-por-ulid}
`epics`/`stories`/`tasks` (миграция 0011). Поскольку проект **не использует массивы
Postgres**, RF/RNF/DoD/DoR/`business_rule_ids` — это `jsonb` (`$type<string[]>`).
`business_rule_ids` ссылается на `session_events.id` (артефакт
`artifact.business_rule`) **текстовым ULID без FK** — тот же выбор, что
`handoffs.artifact_id` (логическая, а не реляционная связь). Задачи наследуют
привязку истории (выводится, не хранится).

### 3. Готовность draft→ready проверяется в ДОМЕНЕ {#3-prontidão-draftready-validada-no-domínio}
`domain/backlog/story-readiness.ts` (`assertReady` → `StoryNotReadyError`) требует
непустых DoD, DoR, ≥1 RF и ≥1 привязанного правила — "валидация в домене, а не только
в prompt". `story-state-machine.ts` покрывает `draft→ready→in_progress→done`.
`create_story` создаёт в `draft` и продвигает в `ready` той же операцией, **когда
правило выполнено** (PO использует лишь 3 названных инструмента — инструмента
перехода нет); `TransitionStoryUseCase` открывает явный переход (протестирован) и
обслуживает будущие состояния.

### 4. Инструменты PO проходят через api (никогда прямой SQL/insert) {#4-ferramentas-do-po-passam-pela-api-nunca-sqlinsert-direto}
`create_epic/create_story/create_task` — это инструменты `:direct`, вызывающие
`EngineApiClient` → внутренние endpoints → use cases с валидацией домена.
`CreateStoryUseCase` **проверяет, что каждый `business_rule_id` действительно ссылается на
существующее событие `artifact.business_rule`** (отвергает выдуманные id; ничего
не создаётся). Каждое создание выдаёт `backlog.*` в event log (повествование PO).

### 5. Прослеживаемость правило→stories (открытый пункт = находка) {#5-rastreabilidade-regrastories-pendência--descoberta}
`domain/backlog/coverage.ts` (`computeCoverage`, чистая) + `GET /projects/:id/
coverage`: для каждого `artifact.business_rule` проекта — какие истории его
покрывают (через `business_rule_ids`). Правило без покрытия — это **находка** —
UI показывает его красным во вкладке Backlog. Уровень проекта (агрегирует правила
сессий через join с `sessions`).

### 6. Принятие handoff активирует PO по правилу сессии 1 {#6-aceitar-handoff-ativa-o-po-pela-regra-da-sessão-1}
`AcceptHandoffUseCase` (действие пользователя): `offered→accepted` + `handoff.accepted`
→ вызывает `ActivateAgentUseCase` для `toAgent`. Правило активации (требующее
handoff `accepted`) теперь проходит ровно благодаря этому принятию. UI: кнопка
"Aceitar handoff e iniciar PO" в сессии.

## Последствия {#consequências}

- Вкладка Backlog — на уровне проекта (локальное состояние, без нового маршрута), читаемая опросом
  `GET backlog` + `GET coverage`, — отражает генерацию PO в реальном времени.
- Composer сессии направляет активному агенту (PO имеет приоритет над
  Criativo) через `sendAgentMessage`.
- Тесты: домен (`story-readiness`, `story-state-machine`, `coverage`),
  use case (`create-story` отвергает несуществующее правило; `transition-story` отклоняет
  draft→ready без DoD) и `po_server_test` (kickoff выстраивает цепочку create_epic→
  create_story с внедрением результата; невалидное правило становится tool-result с
  ошибкой, не обрушивая цикл; broadcast; регидратация).

## Область {#escopo}

Только PO + backlog + прослеживаемость. **Arquiteto** (ADR в docs/adr/ репозитория
проекта, `module_map`, проверка, что story ссылается на существующий модуль) —
следующая сессия. `in_progress`/`done` и ручное редактирование backlog в UI остаются
на потом (машина состояний уже их покрывает).
