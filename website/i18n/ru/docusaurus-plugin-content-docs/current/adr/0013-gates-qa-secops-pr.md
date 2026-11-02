---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0013 — Gates PR: QAAgent и SecOpsAgent

- Статус: принят
- Дата: 2026-07-24
- Фаза: 4a (сессия 3 — gates QA и SecOps)

## Контекст {#contexto}

Реальный DevAgent (предыдущая сессия) реализует task и открывает PR, но PR не
проходит никакого автоматизированного ревью — она идёт прямо в `in_review`. Эта
сессия добавляет два недостающих gate: **QA** (запускает suite, строит
матрицу правило→тест, указывает правила без покрытия) и **SecOps** (запускает
semgrep/gitleaks, сверяет с ADR по безопасности) — каждый с заключением,
зарегистрированным как артефакт + комментарий в PR, возвратом dev в ТУ ЖЕ
ветку при отклонении и пределом исправлений, прежде чем стать `blocked`.

Критерий приёмки: task с (a) правилом без теста и (b) захардкоженным
секретом → QA возвращает первое, dev исправляет, SecOps останавливает второе, dev
исправляет, PR доходит до `awaiting_user` с 4 заключениями на временной шкале.

## Решения {#decisões}

### 1. Машина состояний gate как чистый предел {#1-máquina-de-estados-do-gate-como-teto-puro}

`domain/execution/pr-gate-state-machine.ts` (тот же шаблон, что
`action-state-machine.ts`/`story-state-machine.ts`): `PrGateStatus =
'awaiting_qa' | 'awaiting_secops' | 'awaiting_user'`. `nextGateStatus`
получает ТЕКУЩИЙ gate + вердикт и возвращает следующий статус (или `'blocked'`,
если предел исправлений превышен) — каждый gate может действовать только над СВОИМ
статусом (`InvalidGateActionError`, если QA пытается решать по `awaiting_secops`
или наоборот), гарантируя неизменяемый ПОРЯДОК (одобрение QA никогда не перескакивает прямо
в `awaiting_user`). `tasks` получает `gate_status`/`gate_correction_count`
(миграция `0015`) — без новой таблицы для заключений: они являются
`session_events` `artifact.qa_verdict`/`artifact.secops_verdict`, по тому же
шаблону, что `EmitArtifact`.

`RecordGateVerdictUseCase` — ЕДИНСТВЕННОЕ место, которое применяет машину, публикует
комментарий в PR (`GitProvider.commentOnPullRequest`, 10-я операция
контракта — best-effort, никогда не блокирует решение gate) и возвращает engine
следующее действие (`correct`/`run_secops`/`done`/`blocked`) — тот же принцип,
что всегда: api решает, engine выполняет.

### 2. Разговорный handoff НЕ переиспользован {#2-handoff-conversacional-não-reaproveitado}

`domain/sessions/handoff.entity.ts` смоделирован для активации РАЗГОВОРНОГО
агента (`offered/accepted`), без понятия ветки/worktree/task, —
втискивание в него было бы хуже, чем создание нового пути.
Возврат "QA/SecOps отклонил → назад к dev в ТУ ЖЕ ветку" — это
прямой вызов engine→engine: `DevAgentServer.correct/3` (отличается от
`work/2`, который забирает НОВУЮ task) переиспользует уже сохранённые `state.worktree`/
`state.branch`/`state.task_id` — НИКОГДА не вызывает
`worktree_manager().create/3` заново. В `report_done` исправления только
`propose_commit`/`propose_push` (PR уже существует, та же ветка) — никогда
повторный `propose_pr`.

### 3. QA использует ToolLoop/LLM; SecOps детерминирован — намеренная асимметрия {#3-qa-usa-toolloopllm-secops-é-determinístico--assimetria-intencional}

Сопоставление описания бизнес-правила с именем/содержимым теста
— это СЕМАНТИЧЕСКОЕ суждение: `QaAgentServer` использует реальный `ToolLoop` (тот же
harness, что у DevAgent), с `Engine.Gates.Tools.EmitQaVerdict`, ПРИНУДИТЕЛЬНЫМ
ровно как `ReportDone`: принимает `veredito: "approved"`, только если последний
`terminal` в истории завершился с `exit 0`.

Поиск захардкоженного секрета или уязвимости — это СТРУКТУРИРОВАННАЯ проверка
вывода сканера: ДЕТЕРМИНИРОВАННЫЙ SecOps (без LLM) надёжнее,
чем модель, пересказывающая находку безопасности (риск
галлюцинации/пропуска в проверке, которая должна быть бинарной).
`SecOpsAgentServer` запускает `gitleaks`+`semgrep` (`Engine.Actions.
GitleaksDetector`/`SemgrepDetector`, тот же шаблон необязательного обнаружения, что у
`RtkDetector` — `System.find_executable/1`, никогда не предполагает установленным) и перечисляет
ADR `securityRelevant` (новое необязательное поле в payload
`open_adr_pr` — информационный чек-лист, без глубокой построчной
корреляции). Ноль находок → `approved`; любая находка → `changes_requested`.

**Оба сканера протестированы в реальном Dockerfile engine (Alpine) и
устанавливаются/работают без проблем** (`gitleaks` через статический бинарник из релиза
GitHub; `semgrep` через pip) — первоначальное опасение нестабильности на
musl/Alpine в этой сессии не подтвердилось. Необязательное обнаружение остаётся
эшелонированной защитой (окружение без бинарников не ломает gate).

### 4. QA/SecOps разделяют worktree dev {#4-qasecops-compartilham-o-worktree-do-dev}

Ни один из них не создаёт собственного worktree — они находят worktree dev через
`DevAgentState.find_by_task_id/2` (новый запрос), — поскольку только читают/выполняют
команды и никогда не пишут код. `Engine.Gates.Diff.compute/2` вычисляет
`git diff <default_branch>...HEAD` (до этого в engine не было никакого вычисления diff)
— используется для сводки заключения (количество изменённых
файлов), а не как построчный фильтр находок сканера
(задокументированное упрощение: надёжная корреляция пути сканера ↔ diff
достаточно хрупка, чтобы не стоить усилий в этой сессии).

### 5. Косвенность запуска (Dispatcher) — тестируемость {#5-indireção-de-disparo-dispatcher--testabilidade}

`Engine.Gates.Dispatcher` (`.run_qa/2`, `.run_secops/2`) — единственная точка,
где `DevAgentServer`/`QaAgentServer` запускают СЛЕДУЮЩИЙ gate, — заменяемая
в тесте (`Engine.Gates.FakeGateDispatcher`) по той же причине, что
`worktree_manager()`: без этой косвенности тесты `DevAgentServer`
поднимали бы РЕАЛЬНЫЙ `QaAgentServer` вне Ecto-песочницы тестового процесса
(обнаружено при запуске suite — GenServer падал, пытаясь выполнить `DevAgentState.
find_by_task_id` без владельца соединения). Возврат gate→dev
(`DevAgentServer.correct/3`) НЕ проходит через косвенность — это `GenServer.
cast` через `:via`/`Registry`, который по природе OTP уже fire-and-forget
(молчит, если процесса нет, никогда не роняет вызывающего).

## Последствия {#consequências}

- UI: `ProjectApprovalsTab` получает раздел "PRs em revisão" — горизонтальный
  stepper dev→qa→secops→você (`PrGateTimeline`, новый компонент) для каждой
  task с открытым gate, раскрываемые заключения и `coverageMatrix` QA,
  отрисованную через `ui/Table`. `activity.ts` повествует `pr.gate_changed`/
  `artifact.qa_verdict`/`artifact.secops_verdict`.
- Тесты: машина состояний (неизменяемый порядок, предел исправлений),
  `RecordGateVerdictUseCase` (best-effort комментарий, превышение K блокирует),
  `DevAgentServer.correct/3` (та же ветка/worktree, без новой PR),
  `QaAgentServer` (принуждение `emit_qa_verdict`), `SecOpsAgentServer`
  (подложенный секрет → changes_requested; отсутствующий сканер → пропуск без
  поломки).

## Область и допущения {#escopo--assunções}

QA/SecOps только для PR DevAgent — Infra и полная панель команды через
каналы Phoenix остаются вне. `securityRelevant` в ADR — лишь информационный
флаг (Arquiteto Фазы 3b не меняется, кроме принятия необязательного
поля). Без глубокой корреляции diff↔находка сканера. `in_review →
done` (финальное одобрение пользователя) остаётся вне этой сессии — gate
заканчивается в `awaiting_user`, а человеческое действие merge всегда ручное.
