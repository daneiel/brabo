---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0090 — QA-стратегия и AppSec как второй МОМЕНТ, а не новый агент

- **Статус:** Принят
- **Дата:** 2026-08-17
- **Контекст:** сознательное решение владельца продукта опередить триггер —
  не «естественный триггер», который предусматривал `docs/fluxo.yml`
  (`hoje_absorvido_por` + `criterio_de_separacao`), а сама работа по
  построению того, что включает gate
- **Активирует:** gate `implementavel` (`docs/gates.yml`, `status: planned`
  начиная с ФАЗЫ 14d)
- **Пересматривает часть:** [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)
  (который объявил gate `implementavel` как `planned`)
- **Прямой прецедент:** [ADR 0038](0038-hierarquia-de-agentes.md) (область
  QA — Lead + подспециализации), [ADR 0085](0085-fluxo-como-registro-declarativo.md)
  (`docs/fluxo.yml`, который уже предусматривал обе роли как `proposto`)

## Контекст {#contexto}

`docs/fluxo.yml` (ADR 0085) фиксирует две роли целевой модели как `proposto`,
каждую с критерием разделения, записанным в самом файле:

> **qa-estrategia** — hoje_absorvido_por: area-qa (которая действует только
> ПОСЛЕ, на PR). criterio_de_separacao: Когда gate implementavel включится —
> план тестирования является его входом. Может быть сам qa-lead во втором
> МОМЕНТЕ, не обязательно новый агент: разделение — по результату.
>
> **appsec** — hoje_absorvido_por: secops (который действует только на PR).
> criterio_de_separacao: Тот же образец, что у QA: два МОМЕНТА, а не два
> агента пока. Threat model в проектировании включается, когда появится gate
> implementavel. Отдельный агент только с реальным продакшеном.

Объявленный триггер («когда gate `implementavel` включится») никогда не
срабатывал органически — ничему в продукте он ещё не был нужен. Владелец
продукта решил опередить: триггер **есть** сама работа по построению
механизма, включающего gate, а не симптом использования, ждущий своего часа.

Эта поставка покрывает **qa-estrategia** полностью. **appsec** остаётся
`proposto`, в ТОЙ ЖЕ доктрине (два момента, а не два агента), с реализацией в
отдельном направлении — образец и решение одни, описаны здесь; код
`appsec`/`threat-model` остаётся на тот момент, когда это направление
запустится.

## Решение {#decisão}

**QA-стратегия — это `qa-lead` во втором МОМЕНТЕ — тот же процесс, отдельный
результат.** Никакого нового агента, никакого нового GenServer с собственным
именем в составе. `Engine.Gates.QaLeadServer` получает ДОБАВОЧНУЮ точку
входа, `run_design/3`, рядом с привычным `run/2` (ревью PR):

### Детали {#as-peças}

1. **`Engine.Gates.QaEstrategiaContext.fetch/3`** — ЛЁГКИЙ контекст: только
   story (из `EngineApiClient.list_backlog/1`, дерево, которое PO читает уже с
   [RN-164](../business-rules/autenticacao.md#rn-164)) и действующий
   `module_map` (из `EngineApiClient.get_infra_context/2`, ТОТ ЖЕ
   `GetInfraContextUseCase`, который потребляет Infra Lead, здесь только по
   полю `moduleMap`) — БЕЗ `dev_state`, БЕЗ `worktree_path`. Никакого нового
   маршрута в api: обе функции уже существовали, а gate `implementavel`
   выполняется PRE-DEV — dev agent, worktree и `task_id` ещё нет.
2. **`Engine.Gates.QaEstrategiaAgent`** — модуль БЕЗ СОСТОЯНИЯ (не
   `GenServer`), той же ФОРМЫ, что `Engine.Gates.QaPerformanceSegurancaAgent`:
   реестр инструментов БЕЗ `Terminal` (`ReadFile`, `SearchWorkspace`,
   `EmitPlanoDeTeste`), выполняющий общий `ToolLoop` harness. Ни один из трёх
   инструментов не проходит через `Engine.Harness.Hooks.ActionPipeline`
   (проходят только `terminal`/`write_file`) — этот агент НИКОГДА не
   приостанавливается, а `run_design/3` выполняется синхронно внутри
   собственного `handle_cast`. Выпускает `artifact.plano_de_teste` (схема
   проверяется в `Engine.Harness.ArtifactSchemas`) в event log вызвавшей
   сессии.
3. **`Engine.Gates.QaLeadServer.run_design/3`** — `GenServer.cast`, в том же
   стиле, что `run/2`, БЕЗ `DevAgentState.find_by_task_id`. Вызывается через
   `Engine.Gates.Dispatcher.run_qa_estrategia/3` (ТУ ЖЕ заменяемую в тесте
   косвенность, что уже используют `run_qa/2`/`run_secops/2`, — избегает
   подъёма настоящего GenServer в лёгком тесте).
4. **`Engine.Agents.DevLeadTools.assess_implementability`** — новый
   инструмент Dev Lead. Читает самый свежий `artifact.plano_de_teste` story в
   истории СОБСТВЕННОЙ сессии Dev Lead:
   - **плана ещё нет** — запускает `Dispatcher.run_qa_estrategia/3` и
     возвращает `{:error, texto}` с просьбой попробовать снова. Ошибка
     инструмента — это ВХОД цикла, а не конец пути
     ([RN-163](../business-rules/autenticacao.md#rn-163)) — у Dev Lead есть 14
     итераций, чтобы попробовать снова после появления плана;
   - **план есть** — собирает заключение (`implementavel`/`inviavel` +
     обоснование, с планом тестирования, встроенным в payload) и вызывает
     `EngineApiClient.propose_action/5` с `"assess_implementability"`, ТОТ ЖЕ
     образец из трёх исходов, что у `propose_execution_plan`
     ([RN-284](../business-rules.md#rn-284), ADR 0086).
5. **`decide.ts`** получает `assess_implementability`, минимальная роль
   `maintainer`, НАМЕРЕННО вне блока абсолютных потолков — то же рассуждение,
   что у `propose_execution_plan`: это начальное решение сессии, а не
   превышение уже разрешённого потолка.
6. **`docs/gates.yml`**, `implementavel`: `status: planned` → `active`, с
   `evidencia`, указывающим на event log (`proposed_action.created`,
   отфильтрованный по `actionType: assess_implementability`). `severidade`
   остаётся `warn` — не тронута; реестр уже говорил «рождается warn, даже
   когда включится».

### Почему потолок итераций НЕ получил новой клаузы {#por-que-o-teto-de-iterações-não-ganhou-cláusula-nova}

`Engine.Harness.Iteracoes.tipo/1` классифицирует неизвестного агента как
`:conversacional` (потолок 8). `"qa-estrategia"` попадает в это значение по
умолчанию, и это ПРАВИЛЬНОЕ решение — не пробел. Критерий
[RN-085](../business-rules/custo.md#rn-085) — не «кто много работает», а «что
удерживает расход сверх потолка итераций». Этот агент работает БЕЗ
`token_budget_micros` (нет task, PRE-DEV), та же ситуация, что у
`infra-workflows`, — который тоже остаётся на 8, хотя использует инструмент,
потому что подъём потолка без бюджета под ним умножил бы худший случай без
чего-либо, что его сдерживало бы.

## Последствия {#consequências}

**За**

- Поведение начинает совпадать с тем, что уже объявлял `docs/fluxo.yml`, —
  тот же класс исправления, что ADR 0086 (закрыть расхождение между
  объявленным fluxo и кодом), только здесь «кода» никогда не существовало.
- Разделение по результату доказывается без цены новой инфраструктуры: ноль
  GenServer, ноль новых HTTP-маршрутов, ноль таблиц.
- Gate `implementavel` получает измеримое доказательство в event log, в том же
  духе, что ADR 0054, — зафиксированное решение и делает прохождение gate
  измеримым.

**Против**

- **Окно ожидания между «запустил оценку» и «план существует» асинхронно и
  без callback.** Dev Lead узнаёт, что план готов, только когда МОДЕЛЬ решит
  снова вызвать `assess_implementability`, — автоматического возобновления
  нет (в отличие от приостановки на одобрении в ADR 0086, которая ЯВЛЯЕТСЯ
  событийно-ориентированной). Принято, потому что
  `Engine.Gates.QaEstrategiaAgent` работает в отдельном процессе (`qa-lead`), а
  Dev Lead не может блокировать синхронный `run_turn/2`, ожидая результата
  ДРУГОГО процесса, не сцепив их, — а потолок 14 итераций даёт достаточно
  запаса, чтобы модель попробовала снова в пределах ТОГО ЖЕ хода.
- **`appsec` остаётся `proposto`.** Эта поставка не решает вторую роль,
  которую объявляет тот же фрагмент `docs/fluxo.yml`, — сознательное решение
  о рамках, зафиксированное здесь, чтобы следующее направление
  переиспользовало ТОТ ЖЕ образец, не открывая решение заново.

## Рассмотренные альтернативы {#alternativas-consideradas}

**Новый агент `qa-estrategia`, собственный GenServer.** Отвергнуто: сам
`docs/fluxo.yml` уже возражал против этого — «не обязательно новый агент:
разделение — по результату». Новый GenServer продублировал бы проводку
`Wake`/`Registry` области QA без какого-либо выигрыша, поскольку этот путь
никогда не приостанавливается и не нуждается в машине возобновления,
оправдывающей собственный процесс.

**`assess_implementability` блокируется в ожидании плана тестирования
(синхронный вызов от начала до конца).** Отвергнуто — потребовало бы от Dev
Lead прямо вызывать `QaEstrategiaAgent.run/4`, в СОБСТВЕННОМ процессе, и
выполнять `ToolLoop` QA-стратегии ВНУТРИ хода Dev Lead. Технически возможно
(ни один из двух toolloop не приостанавливается), но сцепляет двух агентов —
ошибка чтения в QA-стратегии уронила бы весь ход Dev Lead, а потолок итераций
одного начал бы съедать потолок другого. Сохранение процессов раздельными, с
результатом, проходящим через event log, — ТОТ ЖЕ дизайн, что использует вся
коммуникация api↔engine.

**Переиспользовать `Engine.Dev.ContextBuilder.fetch/3`** (builder, который уже
использует `QaPerformanceSegurancaAgent`) **вместо нового builder.**
Отвергнуто: тот builder — по `task_id`, он предполагает dev agent, worktree и
код, уже закоммиченный в ветку. Вынуждать фиктивный `task_id` для оценки
PRE-DEV перевернуло бы порядок, который gate существует, чтобы гарантировать
(оценить ДО того, как сжечь токены на написание кода).

## Ссылки {#referências}

- `docs/fluxo.yml` — роли `qa-estrategia` (теперь `active`) и `appsec`
  (остаётся `proposto`)
- `docs/gates.yml` — gate `implementavel` (теперь `active`)
- [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) — объявил gate
  `implementavel` как `planned`
- [ADR 0038](0038-hierarquia-de-agentes.md) — область QA (Lead +
  подспециализации), структурный прецедент этого дизайна
- [ADR 0086](0086-dev-lead-plano-suspende-para-aprovacao.md) — образец
  `proposed_action` из трёх исходов, который повторяет
  `assess_implementability`
- `apps/engine/lib/engine/gates/qa_estrategia_agent.ex`,
  `qa_estrategia_context.ex`, `qa_lead_server.ex`, `dispatcher.ex`
- `apps/engine/lib/engine/agents/dev_lead_tools.ex`, `dev_lead_server.ex`
- `apps/api/src/domain/actions/decide.ts`
