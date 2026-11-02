---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0008 — Разговорный агент Criativo в harness + фундамент handoffs

- Статус: принят
- Дата: 2026-07-24
- Фаза: 3b (сессия 1)

## Контекст {#contexto}

Фаза 3a поставила детерминированный harness + **одноразовый** ToolLoop
(автономный, работает до остановки), а человеческий чат — это **stateless api-only** echo
(`SendChatMessageUseCase` отправляет provider лишь текущее сообщение — без
истории, без harness, без tools; engine даже не участвует). Фазе 3b нужен
**разговорный агент Criativo**, ведущий идеацию ВМЕСТЕ с пользователем,
выдающий `business_rule` по ходу разговора и — только после явного подтверждения
пользователя — выдающий `product_brief` и предлагающий handoff к PO. Также нужен
фундамент **handoffs** с правилом, которое охраняет активацию агентов.

Жёсткое правило CLAUDE.md: "Агенты работают ВСЕГДА внутри Harness" и "engine
НИКОГДА не говорит с LLM-provider напрямую". Следовательно, Criativo живёт в engine
(harness), и каждый ход проходит через api (metering + budget).

## Решения {#decisões}

### 1. Criativo как GenServer с состоянием (не stateless) {#1-criativo-como-genserver-com-estado-não-stateless}
Один `Engine.Agents.CriativoServer` (GenServer, `restart: :temporary`) на сессию,
под надзором `CriativoSupervisor` (DynamicSupervisor), зарегистрированный в
`Engine.Sessions.Registry` с ключом `"criativo:<session_id>"` — повторяет
`SessionServer`. История разговора живёт в памяти и **регидратируется** из
`session_events` (chat.message/agent.response) в `init` — event log является долговечным
источником истины. Запускается командой пользователя (исключение из правила
активации), через api → `ApiToEngineClient.startAgent` → engine
`POST /internal/sessions/:id/agent/start`.

Отброшенная альтернатива: восстанавливать историю из event log на каждом ходе (без
живого процесса). Мы выбрали GenServer, чтобы иметь естественное место для состояния и
жизненного цикла на сессию (в соответствии с `SessionServer`).

### 2. Потоковая передача по токенам через SSE engine→api + ретрансляция Phoenix {#2-streaming-token-a-token-via-sse-engineapi--rebroadcast-phoenix}
Каждое сообщение пользователя выполняет ОДИН **потоковый** ход: `StreamLlmTurnUseCase`
(SSE-брат `RunLlmTurnUseCase` из 3a, который остаётся turn-result для
ToolLoop) передаёт дельты; `CriativoServer` потребляет SSE
(`EngineApiClient.llm_turn_stream`) и **ретранслирует** дельты в web через
канал Phoenix `session:<id>` (`agent.delta`/`agent.done`) — который web уже
подключал лишь для heartbeat. Итоговое сохранение (`agent.response` + артефакты)
приходит через опрос `session-events` (3 с), который `SessionPage` уже делает. Metering
(token_usage) обязателен и выполняется в api; engine никогда не говорит с provider
напрямую. Частично отменяет решение turn-result из 3a **только** для интерактивных
агентов.

### 3. Handoffs: таблица с изменяемым статусом + неизменяемые события {#3-handoffs-tabela-com-status-mutável--eventos-imutáveis}
Новая таблица `handoffs {from_agent, to_agent, artifact_id, status:
offered|accepted|completed|rejected}`. В отличие от таблиц событий,
`status` ИЗМЕНЯЕМ (это текущее состояние); каждый переход также становится
неизменяемым `session_event` `handoff.*`. Владелец таблицы — api: engine создаёт
handoff через `POST /internal/sessions/:id/handoffs` (никогда не пишет в таблицу api
напрямую).

### 4. Правило активации агента (чистый домен) {#4-regra-de-ativação-de-agente-domínio-puro}
`domain/sessions/agent-activation.ts`: агент активируется в сессии только при
handoff `accepted`, адресованном ему; **единственное исключение: Criativo** (запускается
командой пользователя — `USER_STARTED_AGENTS`). Чисто и протестировано изолированно
(повторяет `decide.ts`/`session-state-machine.ts`); `ActivateAgentUseCase`
загружает handoffs и применяет правило перед подъёмом процесса в engine.

### 5. Готовность — действие пользователя; product_brief выдаётся сервером (защита в домене) {#5-prontidão-é-ação-do-usuário-product_brief-é-server-emitted-guardrail-no-domínio}
"Подтверждение готовности — действие пользователя (кнопка), а не вывод модели."
`business_rule` выдаётся моделью через инструмент `emit_artifact` (с
`origin` — ссылками на разговор — проверяемым на НЕпустоту в `ArtifactSchemas`).
`product_brief` НЕ выдаётся инструментом (`known/0` его исключает; `EmitArtifact` блокирует
типы, выдаваемые системой) — он выходит только когда пользователь кликает "Estou pronto para
produzir" (`ConfirmReadinessUseCase` → engine `confirm_readiness`): тогда
`CriativoServer` выполняет ход консолидации, выдаёт `product_brief` напрямую
(`append_event_returning`, захватывая id) и создаёт handoff `offered` к PO.
Это делает "brief только после подтверждения" гарантией домена, а не prompt.

### 6. Артефакты остаются типизированными session_events {#6-artefatos-continuam-sendo-session_events-tipados}
Без таблицы артефактов: `business_rule`/`product_brief` — это `session_events`
`artifact.<tipo>` с payload, проверяемым в engine (`ArtifactSchemas`). Web
читает их тем же опросом событий (карточки правил в боковой панели; разделитель
handoff в чате, когда появляется `handoff.offered`).

## Область {#escopo}

Только фундамент handoffs (таблица + правило + handoff **offered**) и Criativo.
**PO** (принять handoff, активировать PO, backlog) — более поздняя сессия 3b. Без
Bitbucket/GenericGitProvider; очереди остаются в Postgres (Oban), без Redis.

## Последствия {#consequências}

- Web получает второй путь чата (агент vs. человек), решаемый по
  `agent.activated` в event log; сессии без Criativo остаются в человеческом чате.
- `CriativoServer` регидратируется из event log — переживает перезапуск, не теряя
  нить разговора.
- Детерминированные тесты: правило активации (unit), `ArtifactSchemas`
  (обязательный источник) и `CriativoServer` через прямые `init/1` + `handle_call/3`
  со скриптованным фейком LLM (streaming, защита product_brief,
  готовность→brief+handoff, broadcast, регидратация).
