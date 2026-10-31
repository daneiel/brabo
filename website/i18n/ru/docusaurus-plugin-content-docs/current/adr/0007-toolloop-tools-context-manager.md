---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0007 — ToolLoop, инструменты, ContextManager (harness с LLM)

## Контекст {#contexto}

Вторая сессия Фазы 3a: подключить детерминированный harness (ADR 0006) к LLM.
`ToolLoop`, выполняющий ходы LLM, зарегистрированные инструменты (read_file,
search_workspace, write_file, terminal, emit_artifact), `ContextManager`,
сжимающий выше предела, связывание hooks с конвейером действий и
проверочный `EchoAgent`. Жёсткое правило CLAUDE.md: engine НИКОГДА не говорит с
LLM-provider напрямую — каждый вызов проходит через api (metering + budget).

Открытие, сформировавшее работу: не было внутреннего LLM-endpoint
(engine→api) с tool-calling и metering — лишь web-facing `/chat` (SSE,
человек-пользователь, без tools), а provider Ollama не отправлял `tools` и не
разбирал `tool_calls`. Поэтому эта сессия потребовала существенной работы в api
(TypeScript), помимо engine (Elixir).

## Решения {#decisões}

### Внутренний LLM-endpoint turn-result (без потоковой передачи в engine) {#endpoint-de-llm-interno-turn-result-não-streamado-pro-engine}

`POST /internal/sessions/:id/llm-turn` (EngineServiceGuard) → `RunLlmTurnUseCase`.
Потребляет поток provider ВНУТРИ api (как `/chat`) и возвращает
ПОЛНЫЙ ход (сообщение ассистента + `toolCalls` + использование) одним JSON.
ToolLoop работает ход за ходом; "streaming" происходит на уровне provider→api.
Отвергнута потоковая передача NDJSON до engine: в tool loop engine нужно
полное сообщение (с tool_calls) до диспетчеризации инструментов, поэтому
streaming лишь добавил бы живые дельты — не меняя критериев приёмки
(каждый tool call, context.compacted, стоимость), и стоил бы потребления потока на
Elixir. Подтверждено с пользователем.

Endpoint записывает `token_usage` (ОБЯЗАТЕЛЬНЫЙ metering через `RecordLlmUsageUseCase`,
требует `sessionId`), но НЕ записывает `session_events`: engine владеет повествованием
в event log (`agent.response`, `tool.call`, `tool.result`,
`toolloop.limit_reached`) — избегает дублирования журнала. Tool-calling: `ChatMessage`/
`ChatOptions`/`ChatStreamChunk` получили поля tool (packages/shared), а
provider Ollama начал отправлять `tools` и разбирать `message.tool_calls`.

### Инструменты: прямые vs конвейерные {#ferramentas-diretas-vs-pipeline}

- Прямые (выполняются в процессе engine): `read_file`, `search_workspace`,
  `write_file` внутри whitelist агента, `emit_artifact`. Каждый доступ к
  файлу проходит через `WorkspaceFiles.safe_path/2` — **path traversal заблокирован**
  (ничто не выходит за `<PROJECT_WORKSPACES_ROOT>/<project_id>`).
- Конвейерные (через proposed_action в api): `terminal` (ВСЕГДА) и `write_file`
  ВНЕ whitelist. Hook `:pre_tool_use` создаёт `proposed_action` (decide/
  permissions api); `auto_approved` terminal автоисполняется (существующая
  ветвь), и результат становится результатом инструмента; write_file вне
  whitelist остаётся `pending` (выполнение после одобрения — будущая фаза). Новый
  `ActionType` `write_file` (developer). Engine НЕ создаёт proposed_actions
  напрямую — проходит через новый внутренний endpoint `POST /internal/sessions/:id/actions`.

### emit_artifact = типизированный session_event (без таблицы) {#emit_artifact--session_event-tipado-sem-tabela}

Нет таблицы артефактов и валидации по типу в api. Артефакт — это
`session_event` `"artifact.<tipo>"` с payload, проверяемым В ENGINE
(`ArtifactSchemas`, обязательные ключи по типу; пока только `"note"` — продуктовые
типы — это 3b), выдаваемый через `append_event`. Отвергнуто создание таблицы
артефактов сейчас (это была бы область 3b).

### Подключённые hooks (пункт 4) {#hooks-ligados-item-4}

`:pre_tool_use` = место, где происходит запрос к конвейеру (`ActionPipeline`);
`:post_tool_use` = записывает `tool.result` в event log (`EventLog`). Регистрация
по умолчанию ToolLoop, но заменяемая (это значение Hooks). Основа для более глубокого
подключения конвейера действий позже.

### ContextManager: сжатие с сохранением закреплённого {#contextmanager-compactação-preservando-pinned}

Когда оценочные токены превышают `threshold * окно модели`, суммаризирует
самые старые НЕзакреплённые ходы через binding `agent`/"context-manager"
(дешёвая модель — без новой схемы, это свободный slug), заменяет их резюме,
сохраняет закреплённые (system prompt + задача) и `keep_recent` самых свежих
и выдаёт `context.compacted` с `tokensBefore`/`tokensAfter`. Детерминированный
fallback, если суммаризатор падает (никогда не теряет нить). Внутренние сообщения —
maps со строковыми ключами (формат провода) + `:pinned` (удаляется перед отправкой).

### Где работает ToolLoop {#onde-o-toolloop-roda}

`EchoAgent.run/2` выполняет `ToolLoop` синхронно (наблюдаемо в IEx для
критерия приёмки). В продакшене драйвер на сессию (Task под
`Engine.TaskSupervisor`, координируемый SessionServer) избегает блокировки
GenServer heartbeat — доработка будущей сессии; в этой сессии триггер —
IEx (без прецедента Mix.Task, как `Debug.print`).

## Последствия {#consequências}

- Каждый новый behaviour (`ToolLoop`, `ContextManager`) следует шаблону
  behaviour + заменяемая реализация через `Application.get_env`, без Mox;
  детерминированные тесты используют фейк `EngineApiClient`, который скриптует `llm_turn`/
  `propose_action` через словарь процесса (цикл выполняется синхронно в
  тестовом процессе) и отправляет (`send`) события в `:test_pid`.
- Критерий приёмки (EchoAgent в реальной сессии с Ollama) требует
  tool-capable модели в Ollama и bindings (сессия + "context-manager").
  Автоматические тесты используют фейк (реальный Ollama — ручная демонстрация).
- `OpenAIProvider` получил приведение типа, чтобы продолжать компилироваться с расширенным
  `ChatRole` (tool calling в нём вне области этой фазы — только Ollama).
