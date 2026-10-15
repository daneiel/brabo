---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0015 — Настоящий Psicólogo: ToolLoop, гипотезы с доказательствами и сортировка по стоимости

- Статус: принят
- Дата: 2026-07-24
- Фаза: 4b (сессия 1 — заменяет PsychologistStub)

## Контекст {#contexto}

`PsychologistWorker` Фазы 1 был явной заглушкой: он читал event
log и записывал `psychologist.hypothesis` с фиксированным текстом
(`Engine.Psychologist.Stub.summarize/1`), без LLM, без доказательств, без
идемпотентности (собственная docstring документировала, что повторная попытка Oban
продублировала бы событие).

Эта сессия заменяет его настоящим Psicólogo: потребителем
`session.closed`/`session.closed_abnormally` (любая причина), который собирает
контекст (полный event log + бизнес-правила проекта + предыдущие
неотклонённые гипотезы) и производит через harness структурированные гипотезы —
каждую ОБЯЗАТЕЛЬНО с доказательствами, указывающими на реальные id событий.

Критерий приёмки: закрытие 3 сессий (нормальное, kill, ошибка) порождает гипотезы
с навигируемыми доказательствами во всех 3 случаях, различные затраты между лёгкой
и тяжёлой сортировкой видны в metering.

## Решения {#decisões}

### 1. Задача Oban, вызывающая ToolLoop напрямую — без GenServer {#1-oban-job-chamando-toolloop-direto--sem-genserver}

В отличие от QA/SecOps/Dev/Infra (GenServer на проект/сессию, которые
получают повторяющиеся casts на протяжении жизни проекта), Psicólogo работает
ОДИН раз на закрытие сессии и никогда не нуждается в адресации потом.
Oban уже даёт контролируемый процесс с повторными попытками (`max_attempts: 5`),
поэтому GenServer/Supervisor/Registry был бы церемонией без функции.
`PsychologistWorker.perform/1` собирает ctx и вызывает `ToolLoop.run/1`
синхронно — та же форма, что у `QaAgentServer.run_qa/2`, без обёртки.

### 2. «До M попыток» — это `max_iterations` ToolLoop {#2-até-m-tentativas-é-o-max_iterations-do-toolloop}

Новой подсистемы повторов нет. Механизм, которого требует CLAUDE.md
(«гипотеза без действительного доказательства отклоняется и запрашивается у модели заново,
до M попыток»), — это уже обычный цикл harness: tool, возвращающий
`{:error, reason}`, получает эту строку, внедрённую как следующий `tool`-result,
и модель исправляется на следующем ходе. `M` — это буквально
`Triage.max_iterations(tier)` в ctx (4 на лёгком уровне, 8 на тяжёлом).

`Engine.Psychologist.Tools.EmitHypotheses` — обязательный tool (та же
форма, что у `EmitArtifact`/`EmitQaVerdict`); `Engine.Psychologist.Hooks.
Termination` — это `:post_tool_use`, который делает halt ТОЛЬКО когда проверка
прошла. Два этапа намеренно: tool проверяет, hook завершает.

### 3. Проверка доказательств живёт в домене api, атомарна на пакет {#3-validação-de-evidência-mora-no-domínio-da-api-atômica-por-lote}

`ProposeHypothesesUseCase` разрешает каждый `evidenceEventId` через
`SessionEventRepository.findById` и требует, чтобы событие существовало И принадлежало
анализируемой сессии (тот же шаблон, что у `CreateStoryUseCase` для
`business_rule_id`); `domain/psychologist/hypothesis-evidence.ts`
(`validateHypothesisBatch`, чистая) применяет оставшиеся правила (непустое
доказательство, целая уверенность 0–100, обязательный `terminationAnalysis` хотя бы
в одной гипотезе, когда сессия завершилась аварийно).

ВЕСЬ ПАКЕТ отклоняется, если любая гипотеза не проходит, — частичное принятие
заставило бы модель поверить, что часть была зарегистрирована, когда tool-result
агрегирован, ломая ясность цикла исправления.

### 4. Жизненный цикл требует изменяемой таблицы (события неизменяемы) {#4-ciclo-de-vida-exige-tabela-mutável-eventos-são-imutáveis}

`session_events` — append-only (CLAUDE.md), поэтому меняющееся состояние
(`proposed → accepted | dismissed`) живёт в выделенной таблице
`psychologist_hypotheses` — тот же шаблон, что у `tasks.gate_status`/
`infra_artifacts.gate_status`. Каждый переход ТАКЖЕ испускает своё
неизменяемое событие (`psychologist.hypothesis_proposed`/`_accepted`/`_dismissed`,
`psychologist.analysis_completed`/`_failed`) для журнала аудита.

`domain/psychologist/hypothesis-lifecycle.ts` (`assertHypothesisTransition`,
чистая) позволяет выйти только из `proposed` — исключает гонку двойного принятия.

### 5. Идемпотентность: уникальный частичный индекс + «неудачный run не записывает строку» {#5-idempotência-índice-parcial-único--run-falho-não-grava-linha}

У `psychologist_analyses` есть
`uniqueIndex('psychologist_analyses_current_idx').on(sessionId).where(superseded = false)`
— не более ОДНОГО текущего анализа на сессию, всегда. Это И ЕСТЬ «уникальный ключ
session_id + уже обработано».

Два слоя: worker заранее проверяет `alreadyAnalyzed` (дешёвое короткое замыкание,
не тратит LLM при повторной попытке Oban), а индекс — страховочная сеть
против реальной гонки.

**Строка рождается только когда анализ ЗАВЕРШАЕТСЯ.** Run, превысивший
лимит/бюджет, не испустив действительных гипотез, ничего не записывает —
намеренно: это отличает «дублировать завершённый анализ» (заблокировано) от
«повторить неудавшийся» (разрешено, и это ровно сценарий
kill-engine/анализ-после-перезапуска критерия приёмки). Неудачный
исход всё равно описывает `psychologist.analysis_failed` — никогда не остаётся без
исхода, та же дисциплина, что у DevAgent/QA.

**Явная повторная обработка** (`triggeredBy: "manual"`, через `POST
projects/:id/sessions/:id/psychologist/reanalyze` → engine ставит
задачу в очередь) выполняется всегда: помечает предыдущий анализ `superseded = true` (НИКОГДА
не удаляет) и вставляет новый. История сохраняется бесплатно — старые
гипотезы остаются на месте, просто больше не «current».

### 6. Причина завершения — детерминированная классификация, а не суждение LLM {#6-causa-de-término-é-classificação-determinística-não-julgamento-do-llm}

`Engine.Psychologist.TerminationClassifier.classify/2` — чистый pattern-match
по `sessions.termination_reason` — распознать «heartbeat_timeout»
vs сигнал kill vs сообщение исключения — это сопоставление с образцом, а не
семантика (то же обоснование, что в ADR 0013 для детерминированного SecOps). Причина
входит в prompt как ФАКТ; модель анализирует её ПОСЛЕДСТВИЯ.

Это потребовало закрыть пробел: `ReportSessionTerminationUseCase` получал
`reason` от engine, но только логировал. Теперь он протягивается до нового столбца
`sessions.termination_reason` (nullable — человеческое/плавное закрытие остаётся
null).

### 7. Сортировка: действительно разные binding агентов {#7-triagem-bindings-de-agente-genuinamente-diferentes}

`Engine.Psychologist.Triage.decide/1` — меньше **20** событий → `:leve`,
иначе `:pesada`. Обоснование порога: ниже него сессия обычно — это
кто-то, кто открыл и обменялся двумя сообщениями, без достаточного поведенческого
сигнала, чтобы оправдать сильную модель.

Уровень выбирает **slug агента** в ctx (`"psicologo-leve"` vs
`"psicologo"`), а не переопределение модели в коде — так уже существующий каскад
binding (`session > agent > project > workspace`) разрешается
сам, оператор продолжает управлять обоими уровнями через таблицу
bindings в `ProjectSettingsTab` без нового экрана, и стоимость действительно расходится
в `token_usage`, который `RunLlmTurnUseCase` уже записывает
безусловно. Seed связывает `psicologo → Opus 4.8` и
`psicologo-leve → Haiku 4.5`.

Уровень также задаёт `max_iterations` и `token_budget_micros` (50k vs
300k micro-USD), соблюдаемые механизмом, который уже есть в ToolLoop
(`{:budget_exceeded, ctx}`), — ноль нового кода соблюдения.

## Последствия {#consequências}

- UI: новый раздел **Insights** в `ProjectOverviewTab`, область ПРОЕКТА
  (а не открытой сессии — критерий приёмки закрывает 3 разные
  сессии), гипотезы, сгруппированные по целевому агенту, `HypothesisCard` с
  уверенностью, анализом завершения и кликабельными chips доказательств. Каждый chip
  переходит на `/projects/:id/sessions/:sessionId?highlightEvent=:eventId`
  — `SessionPage` получил сворачиваемую панель «Log de eventos»
  (повторно использующую `ActivityFeed`/`EventItem`, которые уже классифицируют каждый
  тип события), которая открывается сама и прокручивается до выделенного события.
  `activity.ts` получил настоящие ветки `psychologist.*` — старая ветка
  `startsWith('hypothesis')` была мёртвым кодом (никогда не совпадала с
  `psychologist.hypothesis`).
- Тесты: домен (`hypothesis-lifecycle`, `hypothesis-evidence` — несуществующий
  id, id другой сессии, отсутствующий `terminationAnalysis`),
  `ProposeHypothesesUseCase` (счастливый путь, атомарный отказ, supersede),
  `GetPsychologistContextUseCase`, `ReportSessionTerminationUseCase`
  (сохранённая причина); engine: `Triage` (граница порога),
  `TerminationClassifier` (5 причин), `EmitHypotheses` (сообщение api
  сохранено дословно, чтобы модель исправилась), `PsychologistWorker`
  (идемпотентность не вызывает LLM, сортировка выбирает правильного агента, аварийное
  завершение требует `terminationAnalysis`, kill→restart завершается).
- Событие для Anamnese (`psychologist.hypothesis_accepted_for_anamnese`)
  испускается как отдельный ТИП (а не флаг в payload) — фильтруемый
  будущим потребителем без инспекции payload, в том же духе, что
  `session.closed` vs `session.closed_abnormally` — отдельные типы.
  Без outbox: потребителя пока нет, а маршрутизация через outbox потребовала бы
  назвать несуществующий worker в `handlers_for/1`.

## Охват и допущения {#escopo--assunções}

Вне этой сессии: сама **Anamnese** (периодические задачи,
`proficiency_profile`, `instruction_patch` как proposed_action,
версионирование/rollback файла агента — Фаза 4.6); любая логика
приоритизации/потребления переданного ей события; dashboard стоимости
сверх числа на анализ; `Oban unique:` на уровне задачи (constraint
базы + предварительная проверка уже достаточны — остаётся как follow-up, если на практике появится
нестабильность); пакетный повторный анализ.

Статус «уже проанализирована» — на СЕССИЮ, а не на проект — каждая
закрытая сессия даёт не более одного текущего анализа, и повторный анализ одной не
затрагивает другие.
