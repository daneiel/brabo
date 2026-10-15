---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0012 — Настоящий DevAgent: ToolLoop, бюджет на task и дисциплина блокировки

- Статус: принят
- Дата: 2026-07-24
- Фаза: 4a (сессия 2 — заменяет NoopDevAgent)

## Контекст {#contexto}

Предыдущая сессия построила инфраструктуру выполнения (worktrees, идентичность
commit, git pipeline, блокировка merge, атомарный claim) и проверила её с помощью
**NoopDevAgent** (без LLM). Эта сессия заменяет глупое тело **настоящим DevAgent**:
он забирает task, собирает богатый контекст через уже существующий Harness
Фазы 3, реализует через **ToolLoop** внутри worktree, открывает PR только с зелёным
набором тестов (запущенным им самим через терминал), соблюдает бюджет токенов на task и
возвращает заблокированную task с диагностикой, когда не может справиться.

## Решения {#decisões}

### 1. ToolLoop получает halt-через-hook и потолок токенов (аддитивно) {#1-toolloop-ganha-halt-via-hook-e-teto-de-tokens-aditivo}

У `Engine.Harness.ToolLoop` было только два исхода (`{:ok, ctx}` /
`{:limit_reached, ctx}`); ни один агент в production не использовал `.Default`
(Criativo/PO/Arquiteto заново реализуют собственный цикл) — низкий риск его
расширения. Два новых исхода:

- `{:halted, reason, ctx}`: hook `:post_tool_use` уже поддерживал `{:halt,
  reason}` (`Engine.Harness.Hooks`), но результат ОТБРАСЫВАЛСЯ
  (`_ = Hooks.run(...)`). Теперь `dispatch/2` использует `Enum.reduce_while` и
  распространяет halt — это механизм, которым DevAgent завершает цикл
  ровно на том ходе, в котором сигнализирует о завершении или блокировке (пункт 2).
- `{:budget_exceeded, ctx}`: `ctx.tokens_spent_micros` накапливает
  `usage.costMicros`, который каждый `llm_turn` уже возвращал (и который игнорировался);
  `ctx.token_budget_micros` (опциональный, по умолчанию `nil` = без потолка) проверяет ДО
  следующего хода — никогда не тратит сверх настроенного, в том же духе, что
  `limit_reached` (никогда бесконечный цикл, теперь также никогда бесконечный расход).
- `ctx.tools` (реестр инструментов) и `ctx.hooks` становятся явными
  переопределениями — `Engine.Harness.Tools.specs/1`/`find/2` принимают альтернативный
  реестр (по умолчанию фиксированный, сохраняет EchoAgent/тесты). DevAgent использует
  `Engine.Dev.Tools.registry/0` (без `EmitArtifact`; с `ReportDone`/
  `ReportBlocked`).
- `ctx.workspace_root` переопределяет корень файлов/AGENTS.md (по умолчанию —
  общий workspace проекта) — `WorkspaceFiles`, `InstructionFiles`
  и `ContextBuilder.build_layers/3` начинают принимать этот явный корень.
  DevAgent передаёт **worktree** — ReadFile/WriteFile/SearchWorkspace и
  прочитанный AGENTS.md работают в правильной ветке/commit, а не в общем клоне.
- **Терминал в worktree** (исправление реального пробела): `TerminalExecutor.run/3`
  ВСЕГДА выполнялся в общем workspace проекта, никогда в worktree
  агента — без исправления тесты DevAgent выполнялись бы вне кода, который
  он изменил. Опциональный `cwd` проходит: `ActionPipeline` (payload инструмента
  `terminal`) → `ExecuteTerminalActionUseCase`/`ApiToEngineClient` (api) →
  `POST /internal/actions/execute` → `TerminalExecutor` (engine).

### 2. Дисциплина завершения — ReportDone/ReportBlocked ПРИНУДИТЕЛЬНЫ {#2-disciplina-de-término--reportdonereportblocked-enforçados}

`Engine.Dev.Tools.ReportDone` не доверяет LLM: ищет ПОСЛЕДНЕЕ сообщение
`tool` «terminal» в истории и ТРЕБУЕТ, чтобы оно начиналось с `"exit 0"` (точный
формат `ActionPipeline.terminal_result/1`) — без этого возвращает ошибку (модель
пытается снова). `ReportBlocked` всегда принимает `{reason, diagnosis}`.
Новый hook `:post_tool_use` (`Engine.Dev.Hooks.Termination`) останавливает цикл,
когда один из двух успешен, — использует механизм пункта 1. `DevAgentServer`
обрабатывает 5 возможных исходов `ToolLoop.run/1`: `report_done` (открывает PR),
`report_blocked`, `limit_reached`, `budget_exceeded` и `{:ok, ctx}` (модель
остановилась без сигнала — рассматривается как защитная блокировка). Ни один путь
не открывает PR без доказательства зелёного набора тестов; ни один не оставляет task застрявшей без исхода.

### 3. PR со ссылкой на story + статус in_review {#3-pr-referenciando-a-story--status-in_review}

`taskStatusEnum` получает `'in_review'` (`todo → in_progress → in_review →
done`; переход в `done` откладывается до появления QA — вне охвата).
Тело PR — Markdown-чек-лист DoD story (`- [ ] item`);
заголовок ссылается на story+task. Контекст берётся из `GetDevTaskContextUseCase`
(api, новый): полная story (RF/RNF/DoD/DoR), разрешённые бизнес-правила
(`session_events` `artifact.business_rule`, тот же шаблон, что у
`CreateStoryUseCase`) и ADR проекта (без фильтра по модулю — то же
упрощение, что у `GetArchitectureUseCase`, задокументированное).

### 4. Бюджет на task — решается в engine, без новой таблицы {#4-orçamento-por-task--resolvido-no-engine-sem-tabela-nova}

Budgets (таблица `budgets`) ограничены только проектом ИЛИ сессией; у task нет
собственной сессии (все tasks модуля выполняются в одной сессии
выполнения). Вместо инвазивной миграции в `budgets`/`token_usage`
потолок на task решается ЦЕЛИКОМ в engine: каждый `run_task` вызывает
`ToolLoop.run/1` ОДИН раз, поэтому накопленный `tokens_spent_micros` ЯВЛЯЕТСЯ стоимостью
task, изолированной по выполнению. `taskBudgetMicros` (настраивается при включении,
`POST execution/activate`, по умолчанию US$0,50, если опущен) проходит
`ActivateExecutionUseCase` → `startExecution` → `dev_agent_states` (новый
столбец, миграция) → `ctx.token_budget_micros` в `ToolLoop`.

### 5. Блокировка task — принудительный контроль повторного claim {#5-bloqueio-de-task--enforcement-de-reclaim}

`tasks` получает `blocked boolean` + `blocked_reason text` (миграция). Блокировка —
НЕ новое значение статуса (task возвращается в `todo`) — это ортогональный флаг.
`ClaimNextTaskUseCase`/`claimNext` исключает `blocked = true` из атомарного claim —
без этого хронически невыполнимая task повторно забиралась бы и снова блокировалась
по кругу. Человек освобождает через `UnblockTaskUseCase`
(`POST sessions/:id/tasks/:id/unblock`), прочитав диагностику.

### 6. Реальная ошибка, найденная тестом конкурентности: `FOR UPDATE OF t` {#6-bug-real-achado-pelo-teste-de-concorrência-for-update-of-t}

Тест N одновременных claim (пункт 6) выявил, что
`FOR UPDATE SKIP LOCKED` в `claimNext` БЕЗ `OF t` также пытался заблокировать строку
`stories` из join — поскольку несколько tasks разделяют ОДНУ И ТУ ЖЕ story, это
сериализовало конкурентные claim через блокировку story (SKIP LOCKED отбрасывал
их вместо того, чтобы попробовать другую task), теряя claim даже при доступных
tasks. Исправлено `FOR UPDATE OF t` (блокировка только строки `tasks`).
Без настоящего теста конкурентности (только последовательного, как было в
предыдущей сессии) эта ошибка прошла бы незамеченной.

## Последствия {#consequências}

- UI: текущая task/итерация/потраченные токены вживую (через обогащённый
  `agent.response`, уже существующий опрос); заблокированные tasks выделены (стиль,
  уже используемый «Pendências de validação cruzada»).
- Тесты: `tool_loop_test` (halt через hook, потолок токенов, пользовательский
  реестр); `dev_agent_server_test` (счастливый поток, невыполнимая task →
  blocked, превышенный бюджет → blocked, report_done без зелёного набора тестов →
  отклонено); `claim-next-task` (настоящая конкурентность — нашёл ошибку пункта 6);
  `mark-task-blocked`/`get-dev-task-context` (новые).

## Охват и допущения {#escopo--assunções}

Только **DevAgent** (заменяющий Noop) — QA/SecOps/Infra и полная панель
команды через каналы Phoenix остаются вне этой сессии. `in_review → done`
откладывается до появления QA. ADR по модулю по-прежнему без настоящего фильтра
(все ADR проекта). Окно контекста DevAgent зафиксировано на
128.000 токенов (TODO: использовать реальное окно разрешённой модели, когда ход
LLM будет возвращать его в engine, — сегодня engine никогда не знал этого числа).
