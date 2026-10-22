---
id: custo
title: 'Бизнес-правила — Стоимость'
sidebar_label: Стоимость и metering
description: 'RN бюджета, metering, отчёта о расходах и потолка стоимости — вынесенные из business-rules.md по размеру.'
keywords: [бизнес-правила, стоимость, бюджет, metering, token]
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
---

# Стоимость

> Эти RN вынесены из [`business-rules.md`](../business-rules.md) без
> изменения ни единой запятой содержания: единая страница превышала 640 KB, и
> одни эти два раздела составляли её половину. Якоря `#rn-NNN`
> остались идентичными — изменился только файл, в котором они находятся.

### RN-017 — У бюджета исключительная область видимости: проект **или** сессия {#rn-017}

`budget` ссылается на проект или на сессию, никогда на оба — это
гарантируется `check` в базе данных, а не только в коде.

- **Где:** `apps/api/src/db/schema/llm.ts` (`budgets_scope_check`)
- **Тест:** гарантией является ограничение

### RN-018 — Уведомление о бюджете на 70%, 90% и 100%, без повторов {#rn-018}

Каждый порог срабатывает **один раз**; последний уведомлённый сохраняется в
`budgets.last_threshold_notified`.

- **Где:** `apps/api/src/domain/llm/budget-threshold.ts:1`
- **Тест:** `test/domain/llm/budget-threshold.spec.ts`

### RN-019 — `policy = 'block'` отклоняет вызов; `'allow'` лишь регистрирует {#rn-019}

- **Где:** `apps/api/src/domain/llm/budget-threshold.ts:4`
- **Граничный случай:** проект в `allow` **не останавливается** на потолке.
  Это самая частая причина «бюджет не удержал» — см.
  [runbook](../runbook.md).

### RN-020 — Модель разрешается каскадом, от самого конкретного к самому общему {#rn-020}

`session > agent > area > project > workspace`. Побеждает первый
существующий. `area` вошла в ФАЗЕ 23 — см. [RN-102](#rn-102) о её позиции и о
том, что меняется для того, кто уже читал этот каскад.

- **Где:** `apps/api/src/domain/llm/binding-resolver.ts`
- **Тест:** `test/domain/llm/binding-resolver.spec.ts`

### RN-040 — Binding агента требует нативного tool calling {#rn-040}

Привязка модели к **агенту** (`scope = 'agent'`) разрешена, только если у
модели есть `supports_tool_calling`. Агент существует только внутри
ToolLoop, а ToolLoop работает, только если модель умеет **запрашивать**
инструменты; без этого сбой проявился бы позже как «агент остановился, не
закончив», — ровно та диагностика методом исключения, которую
[ADR 0020](../adr/0020-destravar-gates-qa-secops.md) запретил. Отказ — это
422, и сообщение указывает на фильтр **"aptos para agentes"** — без этого
указания правило превращается в тупик.

`ToolCallRecovery` в engine восстанавливает вызовы, которые модель написала
прозой, но это **спасение, а не лицензия**: оно зависит от того, угадает ли
модель формат случайно.

Проверяет только `agent`. `workspace` и `project` — это fallback
человеческого чата, а `session` — разговор; ни один из них не запускает
ToolLoop, и их блокировка запретила бы в продукте модели только для чата.
Агент `context-manager` покрыт по построению: это slug **внутри** области
`agent`, а не собственная область.

**Дополнительная заметка — фильтр стал приходить ОТМЕЧЕННЫМ, и включает его
ОБЛАСТЬ.** Абзац выше говорит, что отказ указывает на фильтр "aptos para
agentes", «иначе правило становится тупиком» — и долгое время оно им было:
prop, открывающий селектор с отмеченным фильтром, существовал с Фазы 9c, и
**ни один экран production его не передавал**. Селектор агента открывался,
предлагая модель только для чата, клик по которой существовал лишь для того,
чтобы быть отклонённым. Оба экрана, записывающие в проверяемую область,
начинают открываться отфильтрованными — `ModelsSection` (агент) и
`ModelsSection` (область), — и правило того, кто включает, — не экран, а
`assertModelFitsBindingScope`: там, где api ОТКЛОНЯЕТ, фильтр приходит
отмеченным; там, где не отклоняет, выбирает человек. Поэтому селектор СЕССИИ
остаётся без фильтра — отметка там скрыла бы модель, которую api принимает.
**Это не устраняет 422**: фильтр покрывает одну из трёх причин, а две другие
([RN-043](#rn-043) — отключена в workspace, исчезла у провайдера) остаются
достижимыми, при этом недоступная всё ещё ПЕРЕЧИСЛЕНА и помечена; исход
отказа из [RN-470](#rn-470) по-прежнему то, что сообщает, что произошло. И это
НАЧАЛЬНОЕ состояние checkbox, а не замок: снятие отметки снова перечисляет
всё.

**Следствие: действующее значение, которое скрывает фильтр, ПРОГОВАРИВАЕТСЯ.**
`workspace` и `project` никогда не требовали tool calling, а маршруты,
разрешающие binding агента или области, вызывают
`ResolveModelBindingUseCase` **без** `exigeToolCalling` — так что
чат-модель по умолчанию на этих уровнях разрешается нормально и становится
действующей для строки. С отмеченным фильтром триггер показывал имя, которого
открытый список не содержал, без какой-либо отмеченной опции. Picker теперь
называет модель и причину; он МОЖЕТ назвать причину, потому что фильтр там
только один. Когда весь список становится пустым, говорит по-прежнему текст
пустого списка, который уже велит снять отметку, — два предупреждения об
одном checkbox были бы шумом.

**Исправление факта, а не текста выше:** "Only `agent` validates" описывает
Фазу 9a. Начиная с [ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md)
`area` входит в ТУ ЖЕ проверку — это не общий fallback, единственный
потребитель модели области — её агент ([RN-102](#rn-102)), — и именно
поэтому экранов, включающих фильтр, ДВА.

- **Где:** `apps/api/src/domain/llm/model-capabilities.ts:38`;
  `apps/web/src/components/ModelPicker.tsx` (фильтр и предупреждение о
  скрытом действующем), `apps/web/src/routes/settings/ModelsSection.tsx`,
  `apps/web/src/routes/settings/ModelsSection.tsx` (кто его включает)
- **Тест:** `test/domain/llm/model-capabilities.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`;
  `apps/web/src/routes/settings/filtro-de-aptos.test.tsx` и
  `apps/web/src/routes/SessionPage.filtro-de-aptos.test.tsx` (два экрана,
  которые включают, и тот, что не включает)
- **Источник:** [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)

### RN-041 — Количество токенов, не сообщённое провайдером, помечается как оценочное {#rn-041}

Когда ответ провайдера не несёт `usage`, OpenAI-совместимая база считает
локально токенизатором и выпускает chunk с `estimated: true`. Число всё ещё
годится для выставления счёта, но метка сохраняет разницу между
**«провайдер сказал ноль»** и **«провайдер ничего не сказал»** — и это
позволяет UI квалифицировать стоимость, а не показывать значение без
происхождения.

Два других провайдера расходятся, и расхождение нормализуется, а не
прячется: Ollama просто не выпускает `usage` без строки `done`; Anthropic не
может опустить подсчёт, потому что `usage` обязателен в `message_start` его
протокола. Все три ответа — в
[docs/reference/llm-providers.md](../reference/llm-providers.md#normalized-divergences).

- **Где:** `apps/api/src/infrastructure/llm/openai-compatible-provider.ts:167`
- **Тест:** `test/contract/llm-provider.contract.ts` (сценарий
  `sem_usage`, выполняемый против трёх провайдеров)
- **Источник:** [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)

### RN-042 — Metering регистрирует, кто ОБСЛУЖИЛ вызов, а не только через что он вошёл {#rn-042}

Когда вызов проходит через hub, который сообщает реального провайдера,
`token_usage` регистрирует этого провайдера в `upstream_provider`, помимо
провайдера входа. Без hub — или с hub, который не сообщил, — поле равно
**`null`**, никогда пустой строке: запрос стоимости по провайдеру должен
различать «не проходил через hub» и «проходил через hub, и hub не сказал».

В метриках метка `upstream_provider` повторяет самого провайдера, когда hub
нет, так что `sum by (upstream_provider)` продолжает суммировать всю
стоимость.

- **Где:** `apps/api/src/application/use-cases/llm/record-llm-usage.use-case.ts:73`
- **Тест:** `test/application/use-cases/llm/record-llm-usage.use-case.spec.ts`
- **Источник:** [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)

### RN-681 — История и правило, похожие на существующие, порождают ПРЕДУПРЕЖДЕНИЕ через embedding, никогда отказ; расход проверки — собственная строка metering {#rn-681}

После записи истории (`create_story`) или бизнес-правила (`emit_artifact` с
`business_rule`) api сравнивает её ЗАГОЛОВОК с заголовками существующих того
же типа в ПРОЕКТЕ, по косинусу между векторами модели embedding из RAG, и
ПРЕДУПРЕЖДАЕТ, когда ближайший находится на пороге или выше.

1. **Предупреждение, никогда отказ.** Элемент уже существует, когда
   выполняется проверка. Предупреждение возвращается агенту в результате
   инструмента — фраза называет похожий элемент, id и число — и остаётся в
   логе как `backlog.semantic_duplicate_warned`. ТОЧНЫЙ дубликат
   по-прежнему отклоняется раньше, согласно [RN-080](#rn-080) и
   [RN-081](#rn-081), и поэтому одинаковый нормализованный заголовок
   исключается из сравнения.
2. **Порог — 0,80, и это ОТПРАВНАЯ ТОЧКА, не откалиброванная** (ADR 0198,
   как и веса [ADR 0080](../adr/0080-busca-hibrida-pesos-limiar-e-citacao.md)):
   реальные векторы пары из находки R и пар, не являющихся дубликатами, не
   удалось записать в окружении, где родилось правило. Доказательство
   запускается само, когда будет записан `vetores.json`; до тех пор оно
   ПРОПУСКАЕТСЯ с предупреждением.
3. **Без провайдера embedding проверка ПРОПУСКАЕТСЯ, и об этом ГОВОРИТСЯ** —
   отсутствие capability, демон недоступен, timeout:
   `backlog.semantic_duplicate_check_skipped` с причиной в логе и во фразе
   агенту. Никогда не роняет эмиссию.
4. **Расход входит в metering собственной строкой**: актор
   `system`/`duplicata-semantica`, провайдер и модель RAG, нулевой вывод,
   цена каталога, когда модель в нём есть. Это ЕДИНСТВЕННОЕ исключение из
   среза [ADR 0075](../adr/0075-embeddings-no-contrato-de-llm-provider.md) —
   индексация и поиск RAG остаются вне, — и оно уместно, потому что эмиссия
   происходит внутри сессии.
5. **Потолки:** 100 самых свежих существующих (результат говорит, сколько из
   скольких, когда обрезает) и 10 s по часам на всю проверку.

- **Где:** `apps/api/src/domain/backlog/duplicata-semantica.ts:35` (`LIMIAR_DE_DUPLICATA_SEMANTICA`),
  `:44` (`TETO_DE_COMPARACOES_DE_DUPLICATA`), `:53` (`TETO_DE_TEMPO_DA_CHECAGEM_MS`),
  `:107` (`ehDuplicataSemantica`),
  `apps/api/src/application/use-cases/backlog/verificar-duplicata-semantica.use-case.ts:111` (`VerificarDuplicataSemanticaUseCase`),
  `:241` (`medir`), `:285` (`narrar`), `:349` (`fraseParaOAgente`),
  `apps/api/src/application/use-cases/backlog/create-story.use-case.ts:193` (`semanticDuplicate`),
  `apps/api/src/interfaces/http/internal/internal-sessions.controller.ts:640` (`semanticDuplicateCheck`),
  `apps/api/src/application/use-cases/rag/rag-embedding.service.ts:106` (`uso`),
  `apps/engine/lib/engine/harness/tools/emit_artifact.ex` (`aviso_semantico`),
  `apps/engine/lib/engine/harness/tools/create_story.ex` (`aviso_semantico`)
- **Тест:** `test/application/use-cases/backlog/verificar-duplicata-semantica.use-case.spec.ts`
  (предупреждает выше порога; расход становится собственной строкой; ниже —
  не описывает; без провайдера пропускает, сообщая; потолок времени; потолок
  сравнений; правило по событиям; упавшие metering и лог не роняют),
  `test/application/use-cases/backlog/create-story.use-case.spec.ts`
  (`duplicata semântica (RN-681)`), `test/domain/backlog/duplicata-semantica.spec.ts`,
  `test/domain/backlog/limiar-de-duplicata.calibracao.spec.ts` (ЧИСЛО —
  пропускается, пока не записаны векторы),
  `apps/engine/test/engine/harness/duplicata_semantica_test.exs`,
  `apps/web/src/lib/activity.test.ts` (`duplicata semântica (RN-681)`)
- **Источник:** [ADR 0198](../adr/0198-duplicata-semantica-por-embedding-com-limiar-que-so-avisa.md)
  (AT-171, находка R)

### RN-666 — Metering записывает, сколько входа пришло из кэша и сколько вывода было рассуждением {#rn-666}

Каждая строка `token_usage` записывает две ЧАСТИ, которые провайдер сообщает в
`usage` диалекта OpenAI: `cached_input_tokens`
(`prompt_tokens_details.cached_tokens` — сколько из `input_tokens` было
отдано из кэша, по доле цены) и `reasoning_tokens`
(`completion_tokens_details.reasoning_tokens` — сколько из `output_tokens`
было рассуждением).

1. **Часть, никогда не сумма.** `input_tokens`/`output_tokens` остаются
   итогами, которые сказал провайдер, и уже включают части; к ним ничего не
   прибавляется, и никакая стоимость по ним не пересчитывается — число
   стоимости берётся из [RN-665](#rn-665).
2. **«Не сказал» — это не ноль.** `null` = провайдер не сообщил; 0 = сообщил,
   что не было. Значение, не являющееся неотрицательным целым, — «не сказал».
3. **Измерение говорит, сколько было кэша.** `medir-execucao.ts` начинает
   показывать по агенту прочитанный кэш и рассуждение с процентом от итога,
   ТОЛЬКО по вызовам, которые сообщили (и в скольких, когда не во всех), и
   «не измерено», когда не сообщил ни один, — а также в скольких вызовах
   стоимость реальная.
4. **Читается для каждого провайдера диалекта**, потому что оба поля — от
   самой OpenAI; кто их не присылает, остаётся с `null`. Anthropic сообщает
   кэш в своём протоколе (`cache_read_input_tokens`), и это здесь НЕ читается —
   остаётся `null`, объявлено; Ollama не сообщает.

- **Где:** `apps/api/src/infrastructure/llm/openai-compatible-provider.ts:323` (`cachedInputTokens`),
  `apps/api/src/infrastructure/llm/openai-compatible-provider.ts:650` (`contagem`),
  `apps/api/src/application/use-cases/llm/run-llm-turn.use-case.ts:175` (`cachedInputTokens`),
  `apps/api/src/application/use-cases/llm/record-llm-usage.use-case.ts:113` (`cachedInputTokens`),
  `apps/api/src/db/schema/llm.ts:374` (`cachedInputTokens`),
  `apps/api/scripts/medir-execucao.ts:89` (`formatarParteMedida`)
- **Тест:** `test/infrastructure/llm/openrouter-provider.contract.spec.ts`
  (записанный ответ с обеими частями; без деталей; недопустимое значение и
  ноль), `test/application/use-cases/llm/run-llm-turn.use-case.spec.ts`,
  `test/scripts/medir-execucao.spec.ts` (`formatarParteMedida`)
- **Источник:** [ADR 0188](../adr/0188-o-custo-real-do-provider-vira-o-numero-do-metering.md)
  (AT-272)

### RN-665 — Реальная стоимость, которую возвращает провайдер, — это число metering; каталог остаётся там, где её нет {#rn-665}

Решение владельца (30.09): **реальная стоимость становится числом**. Когда
ответ вызова LLM говорит, сколько провайдер взял, — в OpenRouter это
`usage.cost` в финальном кадре stream, — это значение является
`token_usage.cost_micros` строки, тем, что ход возвращает engine (и цикл
прибавляет к локальному бюджету), тем, что увеличивает бюджеты проекта,
сессии и области, и тем, что суммируют отчёты о расходах. Без него число даёт
замороженная цена каталога, как в
[ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md).

1. **Одно правило, три пути.** `RunLlmTurnUseCase`, `StreamLlmTurnUseCase` и
   `SendChatMessageUseCase` проходят через одну и ту же `custoDaChamada`;
   второго правила нет.
2. **Неявная цена, помеченная.** При реальной стоимости обе колонки цены
   записывают `стоимость ÷ токены` (одно и то же значение: провайдер
   возвращает ОДНУ стоимость) и `price_implicit = true` — что сохраняет
   `токены × цена = стоимость` ([RN-044](#rn-044)), не изображая табличную
   цену. Без реальной стоимости `price_implicit = false`, и колонки — из
   каталога.
3. **Каталог рядом.** `catalog_cost_micros` записывает, что взяла бы цена
   каталога, только в строках, чьё число реальное (`null` в остальных), —
   это расстояние между оценкой и счётом, построчно.
4. **`estimated` по-прежнему говорит о ТОКЕНАХ** ([RN-041](#rn-041)). Строка
   с реальной стоимостью имеет `estimated = false`, потому что стоимость
   приходит только с `usage` провайдера; СТОИМОСТЬ как реальную помечает
   `price_implicit`.
5. **То, что ответ сказал о себе, записывается.** `resolved_model_name`
   (`model` кадра — разрешённый alias) и `generation_id` (`id`, `gen-…` в
   OpenRouter), для каждого провайдера диалекта. `model_name` остаётся
   значением каталога, измерением отчётов.
6. **Стоимость читает только тот, кто доказал.** Hook `extrairCustoReal`
   существует только в OpenRouter; провайдер без него игнорирует
   присутствующий `usage.cost`. Стоимость, не являющаяся конечным
   неотрицательным числом, — «не сказал» (настоящий ноль — реальная
   стоимость), а при `is_byok: true` стоимость НЕ читается: это комиссия hub,
   а инференс оплачивается отдельно, — строка падает на каталог.

- **Где:** `apps/api/src/domain/llm/custo-da-chamada.ts:43` (`custoDaChamada`),
  `apps/api/src/application/use-cases/llm/run-llm-turn.use-case.ts:225` (`custoDaChamada`),
  `apps/api/src/application/use-cases/llm/stream-llm-turn.use-case.ts:238` (`custoDaChamada`),
  `apps/api/src/application/use-cases/llm/send-chat-message.use-case.ts:227` (`custoDaChamada`),
  `apps/api/src/infrastructure/llm/openai-compatible-provider.ts:319` (`extrairCustoReal`),
  `apps/api/src/infrastructure/llm/openrouter-provider.ts:243` (`extrairCustoRealOpenRouter`),
  `apps/api/src/db/schema/llm.ts:357` (`priceImplicit`)
- **Тест:** `test/domain/llm/custo-da-chamada.spec.ts`,
  `test/infrastructure/llm/openrouter-provider.contract.spec.ts` (записанный
  ответ: стоимость, разрешённая модель, id; BYOK; без `cost`; провайдер без
  hook), `test/application/use-cases/llm/run-llm-turn.use-case.spec.ts`,
  `test/application/use-cases/llm/stream-llm-turn.use-case.spec.ts`,
  `test/application/use-cases/llm/send-chat-message.use-case.spec.ts`; с
  учётными данными — ручной smoke `openrouter-provider.smoke.spec.ts`
- **Источник:** [ADR 0188](../adr/0188-o-custo-real-do-provider-vira-o-numero-do-metering.md)
  (AT-270)

### RN-679 — Курирование отклоняет alias свободной маршрутизации OpenRouter {#rn-679}

Решение владельца (01.10): **alias `~` не входит в курирование** — только
модель с фиксированным upstream. Alias свободной маршрутизации OpenRouter (id,
начинающийся с `~`, например `~deepseek/deepseek-flash-latest`), «всегда
перенаправляет на последнюю модель семейства»: каталог публикует ВИТРИННУЮ
цену (при реальном использовании 29.09 — цену самого дешёвого endpoint
семейства), список endpoints приходит пустым, а берёт деньги upstream,
который обслужил. Нет upstream, относительно которого замороженная цена
[ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
что-либо означала бы. Альтернатива — цена по upstream — была отклонена.

1. **Правило — провайдера.** `ehAliasDeRoteamentoLivre` — это `provider =
   'openrouter'` И имя, начинающееся с `~`; тот же префикс у другого
   провайдера не является alias и не отклоняется.
2. **Активация отклоняет, с кодом.** `POST .../models/activate` с
   `isActive: true` и каким-либо alias в пакете — **422** с
   `code: "alias_de_roteamento_livre"`, отклонёнными `modelIds` и фразой,
   которая их называет. Отклоняется ВЕСЬ пакет, как 404 несуществующего id
   ([RN-043](#rn-043)): не включается даже модель с фиксированным upstream из
   того же пакета. Экран каталога показывает фразу api в toast с собственным
   заголовком и сопоставляет по `code`, никогда по тексту.
3. **Sync НЕ фильтрует alias.** Он остаётся в каталоге — исчезновение оттуда
   заставило бы sync пометить `unavailable` то, что уже было курировано, и
   каскад молча пропускал бы его bindings. Чтение курирования его ПОМЕЧАЕТ:
   `freeRoutingAlias`, выводимый из провайдера и имени при чтении, никогда
   не записываемый. Строка показывает значок и причину ТЕКСТОМ до того, как
   кто-то попробует активировать.
4. **То, что уже было курировано, продолжает работать.** Это измеримо (имя с
   `~` в строке OpenRouter), и выбран наименее удивительный выход: alias,
   активный до правила, **остаётся активным** — его bindings продолжают
   разрешаться, селектор продолжает показывать, — он выходит помеченным в
   каталоге и может быть ВЫКЛЮЧЕН. Выключенный — не возвращается. Ничего не
   удаляется, и ни один binding не переписывается. НОВЫЙ binding для всё ещё
   активного alias здесь не отклоняется: правило относится к курированию, а
   binding следует [RN-043](#rn-043).

- **Где:** `apps/api/src/domain/llm/alias-de-roteamento-livre.ts:23` (`ehAliasDeRoteamentoLivre`),
  `:41` (`AliasDeRoteamentoLivreError`),
  `apps/api/src/application/use-cases/llm/set-models-active.use-case.ts:59` (`AliasDeRoteamentoLivreError`),
  `apps/api/src/infrastructure/persistence/drizzle/workspace-model.repository.ts:67` (`freeRoutingAlias`),
  `apps/api/src/interfaces/http/shared/llm-binding-error.filter.ts:60` (`code`),
  `apps/web/src/components/ModelCatalogSection.tsx:693` (`recusaDeAliasLivre`)
- **Тест:** `test/application/use-cases/llm/set-models-active.use-case.spec.ts`
  (пакет отклоняется целиком с кодом и id; фиксированный upstream
  активируется; `~` вне OpenRouter активируется; alias, курированный до
  правила, остаётся активным, помеченным, выключается и не возвращается),
  `test/interfaces/http/shared/llm-binding-error.filter.spec.ts`,
  `apps/web/src/components/ModelCatalogSection.test.tsx` (значок и причина;
  toast отказа; общий toast для другой ошибки)
- **Источник:** AT-271 (пункт A25 анализа реального использования 29.09);
  дополняет [RN-665](#rn-665)

### RN-583 — Критерий маршрутизации hub принадлежит binding, путешествует с ним и замораживается в metering {#rn-583}

Binding модели может хранить **критерий маршрутизации** —
`routing_preference`: `price`, `throughput` или `latency`, — который говорит
HUB, как выбирать upstream, обслуживающий модель. Допускает null: `null` —
привычное поведение, ничего не уходит в провод, и hub решает сам.

1. **Путешествует с победившим binding, никогда не каскадирует сам.**
   Каскад остаётся каскадом binding: победивший уровень приносит модель И её
   критерий. Уровень, который каскад ПРОПУСКАЕТ (модель недоступна, нет tool
   calling), уносит критерий с собой — выживание одного критерия дало бы
   комбинацию, которую никто не выбирал.
2. **Запись в трёх формах.** В `PUT .../model-binding` пяти областей
   **отсутствующий** `routingPreference` сохраняет записанный, если
   провайдер новой модели объявляет capability, и становится `null`, если не
   объявляет; **`null`** очищает; **значение** для провайдера без capability —
   **422** (`RoutingPreferenceNotSupportedError`). Инвариант: ни один binding
   не хранит критерий для провайдера, который его не объявляет.
3. **Замораживает то, что УШЛО В ПРОВОД.** `token_usage.routing_preference`
   записывается при каждом вызове, рядом с `upstream_provider` из
   [RN-042](#rn-042): отправленный критерий и `null`, когда у binding его не
   было или когда провайдер не объявляет capability (то, что не было
   отправлено, не является происхождением ничего). То же правило, что у
   замороженной цены (ADR 0042).
4. **Capability ПРОВАЙДЕРА, только с доказательством.**
   `LLMProviderCapabilities.routingPreference` обязательна у всех девяти и
   равна `true` ТОЛЬКО у OpenRouter начиная с 2026-09-29 (AT-158): smoke с
   реальными учётными данными (`openrouter-provider.roteamento.smoke.spec.ts`)
   показал, что критерий МЕНЯЕТ обслуживший upstream — на
   `meta-llama/llama-3.3-70b-instruct` `price` попал на DeepInfra, а
   `throughput` на Groq (`latency` был Groq в одном измерении и CoreWeave в
   другом), тогда как без критерия hub чередовал Novita/DeepInfra.
   Доказательство — это РАЗНИЦА, а не принятие: модель старого значения по
   умолчанию (`~deepseek/deepseek-v4-flash-latest`) возвращала ОДИН И ТОТ ЖЕ
   upstream для трёх критериев и без критерия, а это не различает «hub
   уважил» и «выбора не было». Остальные восемь остаются `false`, и для них
   функция остаётся СПЯЩЕЙ: маршрут отклоняет с 422, экран говорит текстом,
   что у провайдера нет доказанной опции, и в проводе ничего не меняется.
   Чего доказательство НЕ утверждает: какой upstream выбирает каждый
   критерий, — это решение hub, и оно меняется со временем.

- **Где:** `apps/api/src/domain/llm/routing-preference.ts:56` (запись),
  `apps/api/src/domain/llm/routing-preference.ts:75` (что уходит в провод),
  `apps/api/src/domain/llm/binding-resolver.ts:100` (путешествует с binding),
  `apps/api/src/application/use-cases/llm/record-llm-usage.use-case.ts:118`
  (замораживается в metering),
  `apps/api/src/infrastructure/llm/openrouter-provider.ts:327` (`openrouterConfig`,
  доказанная capability)
- **Тест:** `test/domain/llm/routing-preference.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`,
  `test/application/use-cases/llm/run-llm-turn.use-case.spec.ts`,
  `test/infrastructure/llm/openrouter-provider.contract.spec.ts`; ручное
  доказательство capability — `test/infrastructure/llm/openrouter-provider.roteamento.smoke.spec.ts`
- **Источник:** [ADR 0166](../adr/0166-preferencia-de-roteamento-no-binding-de-modelo.md) (AT-090)

### RN-043 — Обнаруженная модель входит отключённой; исчезнувшая модель помечается, никогда не удаляется {#rn-043}

У синхронизации каталога три исхода, и ни один не разрушителен:

1. **Новая модель** входит **без строки курирования в каком-либо
   workspace**, и отсутствие строки И ЕСТЬ отключённое состояние. Каталог
   провайдера содержит сотни строк — выгрузить их как активные сделало бы
   выбор невозможным и включило бы дорогую модель без чьего-либо решения.
   Активация — курирование owner, и действует только в его workspace
   ([RN-052](#rn-052)).
2. **Модель, исчезнувшая из удалённого каталога**, получает
   `availability = 'unavailable'` и **остаётся в таблице**:
   `model_bindings` и `token_usage` указывают на строку, и её удаление унесло
   бы вместе историю стоимости.
3. **Вернувшаяся модель** возвращается в `available` с **нетронутым**
   курированием — выбор owner переживает временное отсутствие у провайдера.

Две оси намеренно независимы: курирование — решение человека,
`availability` — наблюдение провайдера. Ни одна не пишет в другую — и начиная
с [ADR 0049](../adr/0049-curadoria-de-modelo-por-workspace.md) они даже не
живут в одной таблице, так что у синхронизации нет поля курирования, которое
она могла бы растоптать, даже если бы захотела.

Три следствия в остальной системе:

- **НОВЫЙ** binding для неактивной или недоступной модели отклоняется в
  домене (`ModelNotBindableError`, 422). Уже существующие bindings
  остаются;
- **каскад** `resolveBinding` пропускает недоступного кандидата, записывает
  пропущенное в `skipped` и — когда ход несёт инструменты — повторно
  проверяет `supports_tool_calling` на ВСЕХ уровнях. Без этого fallback
  посадил бы агента на модель только для чата и молча нарушил бы
  [RN-040](#rn-040);
- **упавший провайдер ничего не делает недоступным**: 401 — это «не знаю,
  что там есть», а не «там ничего нет». Провайдер пропускается, с ИСТОЧНИКОМ
  сбоя (`infra` | `modelo`) в отчёте — никогда диагностика методом
  исключения.

- **Где:** `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts:160`,
  `apps/api/src/domain/llm/binding-resolver.ts:63`,
  `apps/api/src/domain/llm/model-capabilities.ts:49`
- **Тест:** `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`,
  `test/domain/llm/binding-resolver.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`
- **Источник:** [ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)

### RN-044 — Цена действует с этого момента, а старая стоимость продолжает сходиться {#rn-044}

Каждая строка `token_usage` регистрирует цену, которая дала её
`cost_micros`. Изменение цены модели **не переоценивает прошлое
потребление** — и более того: старая стоимость остаётся
**воспроизводимой**, потому что `токены × записанная цена` совпадает с
записанной стоимостью даже после трёх исправлений в таблице `models`.

Каждое изменение цены записывает строку в `model_price_changes`, только
добавление, с парой до/после и источником (`manual` | `sync`). Пара
записывается вместе намеренно: восстановление «до» из предыдущей строки
зависело бы от того, что ни одна запись не ускользнула от проверяемого
пути, — а ровно это аудит и существует, чтобы доказать. Цена, равная
текущей, — no-op: строка «изменилась с 10 на 10» превратила бы лог в шум.

Правило действует для **каждого** пути, меняющего цену, а не только для
экрана. Две записи обычно от него ускользали: синхронизация каталога
(которая меняла цену через `upsert`, никогда не производя источник `sync`,
который домен объявлял с Фазы 9c) и `seed.ts` (который выполняется на уже
засеянной базе — `BRABO_FORCE_SEED=1` в `bootstrap.sh` k8s — и поэтому молча
исправлял цену). Обе теперь аудируются, а seed переиспользует сам
`UpdateModelPricingUseCase`.

- **Где:** `apps/api/src/application/use-cases/llm/update-model-pricing.use-case.ts:44`,
  `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts:213`,
  `apps/api/src/db/seed.ts:376`
- **Тест:** `test/application/use-cases/llm/update-model-pricing.use-case.spec.ts`,
  `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`
- **Источник:** [ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)

### RN-189 — Embedding возвращает один вектор на вход или ошибку {#rn-189}

`embed` — ПАКЕТНАЯ операция: получает N текстов и возвращает N векторов, **в
том же порядке**. Порядок — единственная связь между входом и вектором, и
именно поэтому
более короткий ответ не годится — i-й вектор оказался бы принадлежащим
другой фразе, и индекс молча ошибался бы, а симптом проявился бы при ПОИСКЕ,
через недели и далеко от причины.

Поэтому контракт отклоняет, а не деградирует, три вещи: неполный пакет,
пустой вектор и разные размерности в одном ответе. Пустой список входов тоже
отклоняется до выхода в сеть — ответ `[]` на него заставил бы вызывающего
записать пустой индекс, думая, что он что-то проиндексировал.

Результат несёт четыре поля, и каждое отвечает на вопрос, который уже дорого
обошёлся в другом месте продукта: `dimensions` сверяется с тем, что
ВЕРНУЛОСЬ (никогда не копируется из каталога); `model` — то, что провайдер
**сказал**, что использовал, потому что alias разрешается в датированную
версию, и именно это имя идёт в metering, по той же причине, что и
замороженная цена ([RN-044](#rn-044)); а `inputTokens` приходит с
`estimated`, сохраняя различие «провайдер сказал ноль» × «провайдер ничего не
сказал» из [RN-041](#rn-041).

Ошибка **выбрасывается**, нормализованная по `code`, а не становится chunk,
как в `chat`. Смысл chunk — сохранить расход идущего хода; здесь нечего
сохранять — либо провайдер вернул векторы и взял плату, либо не вернул и не
взял. Это тот же выбор, что у `listModels`, и та же таксономия: никакого
нового `LLMErrorCode`.

- **Где:** `apps/api/src/application/ports/llm-provider.port.ts:61`,
  `apps/api/src/infrastructure/llm/embedding-result.ts:26`
- **Тест:** `test/contract/llm-provider.contract.ts` (пять случаев,
  выполняемых против каждого провайдера, объявляющего capability)
- **Источник:** [ADR 0075](../adr/0075-embeddings-no-contrato-de-llm-provider.md)

### RN-190 — У embedding двухуровневая capability, и уровень модели — исключение {#rn-190}

Как и у tool calling ([RN-040](#rn-040)), у capability два уровня:
ПРОВАЙДЕР (`capabilities.embeddings`, потолок) и МОДЕЛЬ
(`supportsEmbeddings` в строке каталога). Разница между двумя случаями —
ровно то, что правило существует, чтобы утверждать:

- **tool calling — градиент**: модель, которая не запрашивает инструменты,
  всё равно разговаривает, и поэтому отклоняется только binding агента;
- **embedding — исключение**: `nomic-embed-text` не отвечает на вопрос, а
  `llama3.2` не возвращает вектор. Это непересекающиеся множества, и демон
  Ollama доказывает это, отвечая **`501`** ("This server does not support
  embeddings") на запрос embedding с чат-моделью.

`assertCanEmbed` проверяет оба в порядке, который лучше всего падает:
сначала провайдер, потому что смена модели не исправит провайдер, не
делающий embedding. Модель **без объявления** тоже отклоняется, с другим
сообщением — отсутствие означает «провайдер не сказал»
([ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)),
никогда разрешение, и правильное действие для читающего — синхронизировать
каталог, а не менять модель. Выводить capability по ИМЕНИ модели
запрещено: это была бы догадка, одетая в данные.

- **Где:** `apps/api/src/domain/llm/embedding-capability.ts:64`,
  `apps/api/src/infrastructure/llm/ollama-provider.ts:319`
- **Тест:** `test/domain/llm/embedding-capability.spec.ts`,
  `test/infrastructure/llm/ollama-provider.spec.ts`
- **Источник:** [ADR 0075](../adr/0075-embeddings-no-contrato-de-llm-provider.md)

### RN-191 — `embeddings: true` требует исполнения, а не документации {#rn-191}

Правило дома ([ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)/[ADR 0043](../adr/0043-seis-providers-de-llm-e-o-fechamento-da-fase-9b.md)),
применённое к новой capability: **только `ollama` объявляет `true`**, и
доказательство — `POST /api/embed`, выполненный против реального демона
0.32.1 с `nomic-embed-text`, — два входа, два вектора размерности 768,
`prompt_eval_count: 10`.

Остальные восемь объявляют `false`, по двум разным причинам:

- **нет доказательства** (семь): для них нет ключа в окружении, а
  единственный платный smoke test, который когда-либо выполнялся
  ([приёмка](../explanation/aceite-providers.md)), был по ЧАТУ — в hub
  embedding маршрутизируется к другим провайдерам, чем чат, и доказательство
  одного endpoint не является доказательством другого;
- **отсутствует операция** (Anthropic): выделенного endpoint embedding нет, а
  его документация указывает на третью сторону, то есть другого провайдера, с
  другим ключом и другим диалектом.

ДИАЛЕКТ OpenAI-совместимой базы доказан отдельно: набор контрактных тестов
выполняется второй раз над ней с включённой capability. Именно это делает
дешёвым переключение провайдера на `true` в день, когда появится его ключ:
меняется одна строка литерала, а разбор уже отработан. Провайдер, который
объявляет `false` и всё же раскрывает метод, **отклоняет вызов** до обращения
к сети.

- **Где:** `apps/api/src/infrastructure/llm/ollama-provider.ts:73`,
  `apps/api/src/infrastructure/llm/openai-compatible-provider.ts:325`
- **Тест:** `test/contract/llm-provider.contract.ts`,
  `test/infrastructure/llm/openai-compatible-provider.contract.spec.ts`,
  `test/infrastructure/llm/ollama-provider.embeddings.smoke.spec.ts`
  (ручной, против реального демона)
- **Источник:** [ADR 0075](../adr/0075-embeddings-no-contrato-de-llm-provider.md)

### RN-045 — Принятый репозиторий изменяется только одобренным планом {#rn-045}

Принятие существующего репозитория **диагностирует, не действуя**. Принятие
проверяет доступ (`getRepo`), записывает строки проекта и производит
**план**: сериализованный список того, что сделал бы bootstrap, полученный
вызовом `check()` каждого шага — того же, что даёт идемпотентность с
[RN-029](../business-rules.md#rn-029), — никогда не выполняя
соответствующую мутацию.

Пока `repo_bootstraps.plan_decision` **пустой**, ни одна мутация не
выполняется. Ворота стоят **перед** исполнителем, а не внутри него: runner
bootstrap — тот же, что в Фазе 2, без фильтра, и его просто не вызывают.
Вместе с защитой, которая уже пропускала защищённые ветки, нет такого пути
кода, который коснулся бы ветки вне одобренного плана.

Два исхода:

- **одобрить** — всё или ничего (одобрение отдельных шагов сломало бы каскад
  `dev←main, qa←dev`). Выполняется план, **заново выведенный** в момент
  исполнения: равный показанному или меньший, **никогда не больший** — ветка,
  ставшая защищённой за это время, пропускается;
- **принять как есть** отменяет bootstrap, регистрирует решение и **не**
  трогает курсор, чтобы изобразить сходимость. План сохраняется как
  свидетельство того, что намеренно не было применено.

Решение по перегенерированному плану отклоняется (409): решение несёт
`planGeneratedAt`, который видел пользователь, и «да», данное о чём-то
другом, не действует.

Обычное провизионирование отказывается (409) работать в принятом
репозитории — без этой защиты путь возобновления запустил бы bootstrap в
чужом репозитории вообще без плана.

**Известное ограничение:** «расходящаяся защита» здесь — это наличие ×
отсутствие, потому что только это раскрывает контракт
(`GitBranch.protected` — булево значение, а
[ADR 0028](../adr/0028-protecao-de-branch-divergencia-entre-providers.md)
отложил нормализованную `ProtectionPolicy`). Ветка с ЧАСТИЧНОЙ защитой
считается «незащищённой» и может быть перезаписана — но только внутри
одобренного плана.

- **Где:** `apps/api/src/application/use-cases/git/decide-bootstrap-plan.use-case.ts`,
  `apps/api/src/application/use-cases/git/bootstrap-plan.ts`,
  `apps/api/src/application/use-cases/git/bootstrap-steps.ts:112`
- **Тест:** `test/application/use-cases/git/decide-bootstrap-plan.use-case.spec.ts`,
  `test/application/use-cases/git/bootstrap-plan.spec.ts`
- **Источник:** [ADR 0044](../adr/0044-adocao-de-repositorio-existente.md)

### RN-046 — Каждый репозиторий проекта объявляет своё происхождение {#rn-046}

`project_repositories.origin` и `repo_bootstraps.origin` говорят, **создал**
ли Brabo репозиторий (`created`) или **принял** уже существовавший
(`adopted`). Происхождение записывается явно тем, кто пишет строку, — а не
значением колонки по умолчанию — и потом не меняется.

Это не украшение: это то, что заставляет продукт считать легитимным случаем
то, что Фазе 10 пришлось делать вручную (вставлять строки в
`project_repositories` и `repo_bootstraps`, чтобы направить проект на fork).
У репозитория `adopted` собственная политика веток, он не проходит
провизионирование и изменяется только согласно [RN-045](#rn-045).

Backfill миграции `0031` помечает всё существовавшее как `created` и может
быть в этом слепым: принятия до неё не существовало, так что нет принятой
строки, которую можно классифицировать неверно.

- **Где:** `apps/api/src/db/schema/git.ts`, `apps/api/src/db/migrations/0031_special_winter_soldier.sql`,
  `apps/api/src/domain/git/repo-bootstrap.entity.ts`
- **Тест:** `test/application/use-cases/git/adopt-repository.use-case.spec.ts`
- **Источник:** [ADR 0044](../adr/0044-adocao-de-repositorio-existente.md)

### RN-047 — Circuit breaker dev agent: N последовательных блокировок его останавливают, не сжигая бюджет в цикле {#rn-047}

Каждый dev agent ведёт счётчик (`dev_agent_states.consecutive_blocked`) того,
сколько задач подряд ЗАВЕРШИЛИСЬ `blocked` — локально (в ToolLoop) или
удалённо (исчерпан потолок исправлений gate). При достижении потолка проекта
(`max_consecutive_blocked`, по умолчанию 3) агент останавливается в
`idle_tripped`, **не пытаясь взять следующую задачу**. Одобренный
терминальный исход обнуляет счётчик; отдельная заблокированная задача идёт
обычным путём (возвращается с диагнозом, доступна человеку для
разблокировки) — breaker имеет дело с ПОСЛЕДОВАТЕЛЬНОСТЬЮ, а не с задачей.

Единственный выход из `idle_tripped` — явное перевзведение
(`POST .../agents/:agentId/rearm`, роль `developer`): оно обнуляет счётчик,
и агент снова пытается брать задачи. Автоматической разблокировки нет — тот
же принцип, что у `MarkTaskBlockedUseCase`/`unblock`, применённый к
последовательности, а не к задаче. Перевзведение агента, который **не**
заблокирован, — **409**, а не молчаливый успех: событие `dev.rearmed`
неизменяемо, и его регистрация для несостоявшегося перевзведения была бы
ложью в event log.

Блокировка, приходящая ИЗВНЕ агента (например, внутренний сбой
`QaLeadServer`), тоже должна его будить — поэтому выпуск
`task.gate_resolved` живёт в `MarkTaskBlockedUseCase`, воронке, через
которую проходит каждая блокировка, а не в `RecordGateVerdictUseCase`,
который видит лишь их часть. Без этого агент навсегда остался бы в
`awaiting_gate`, с мёртвой задачей и никогда не растущим счётчиком breaker.

Перезапуск engine с агентом в `working` **не** засчитывается в счётчик:
удерживаемая задача блокируется с диагнозом перезапуска, но эта блокировка —
не агент, «сжигающий потолок», а падение инфраструктуры. Счётчик растёт,
только когда сам цикл dev↔gate производит настоящий `blocked`.

- **Где:** `apps/engine/lib/engine/dev/dev_agent_server.ex` (`finish_task/2`,
  `resume_state/2`), `apps/api/src/application/use-cases/execution/rearm-dev-agent.use-case.ts`,
  `apps/api/src/db/schema/iam.ts` (`projects.max_consecutive_blocked`)
- **Тест:** `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  (describe `circuit breaker`), `apps/engine/test/engine/dev/dev_rehydrator_test.exs`
  (describe `the four rehydrated states`), `test/application/use-cases/execution/rearm-dev-agent.use-case.spec.ts`
- **Источник:** [ADR 0045](../adr/0045-reagendamento-por-evento-do-dev-agent.md)

### RN-053 — Повторная активация исполнения будит остановленных внутри уже существующей сессии {#rn-053}

Активация исполнения проекта, который **уже исполняется**, — это повторная
активация, а не старт с нуля: она попадает в текущую сессию исполнения и
будит агентов, которые стояли. Две части, по одной с каждой стороны системы.

**Сессия переиспользуется.** Активация использует сессию `active` проекта,
которая уже несёт `execution.activated`; создаёт её, только когда таковой
нет. Нет колонки, говорящей «эта сессия — исполнения»: сессию отличает
событие, которое она хранит, и именно его запрашивают. Закрытие сессии
остаётся способом начать заново: закрытая не является кандидатом, и
следующая активация открывает новую.

Раньше `create` был безусловным, а engine **отбрасывает** новый `session_id`,
когда агент уже жив. Каждый клик «активировать» оставлял после себя
активную сессию, получавшую `execution.activated` и больше ничего, — события
агентов продолжали идти в сессию предыдущей активации.

**Агента будит wake, а не `work`.** Старт с нуля запускает цикл (`:work` —
выпускает `dev.started` и берёт задачу). Уже живой агент получает
`{:wake, :became_claimable}`, а решает защита состояния сервера:

| состояние агента | что делает повторная активация |
|---|---|
| `idle` | берёт следующую задачу |
| `working`, `awaiting_gate`, `awaiting_approval` | ничего — текущая задача не бросается |
| `idle_tripped` | ничего — разблокирует только явное перевзведение ([RN-047](#rn-047)) |

Запуск `:work` для всех был бы хуже дефекта: он берёт задачу безусловно, и
для агента в `awaiting_gate` это означало бы бросить worktree, который gate
сейчас прочёсывает, — не говоря об обходе circuit breaker одним кликом.

- **Где:** `apps/api/src/application/use-cases/execution/activate-execution.use-case.ts`,
  `apps/api/src/infrastructure/persistence/drizzle/session.repository.ts`
  (`findActiveExecutionSession`),
  `apps/engine/lib/engine_web/controllers/execution_command_controller.ex`
  (`acordar/4`)
- **Тест:** `test/application/use-cases/execution/activate-execution.use-case.spec.ts`
  (describe `reactivation doesn't open an orphan session`),
  `test/infrastructure/persistence/session-execution.repository.spec.ts`,
  `apps/engine/test/engine_web/controllers/execution_command_controller_test.exs`
  (describe `reactivation`)
- **Источник:** находка №11
  [первого dogfooding](../explanation/primeiro-dogfooding.md)

### RN-048 — Продвижение story по умолчанию принадлежит пользователю; режим меняет того, кто запускает, никогда то, что проверяется {#rn-048}

`projects.story_promotion` выбирает, КТО продвигает story из `draft` в
`ready`:

- **`manual`**: PO доводит story до полноты, и она остаётся `draft` с
  `stories.proposed_ready = true`. **Ни одна из её задач не может быть взята**
  — `claimNext` требует `story.status = 'ready'`, — и продвигает её
  пользователь, по отдельности или пакетом, из Backlog.
- **`auto`** (значение по умолчанию для нового проекта начиная с
  [RN-659](../business-rules.md#rn-659)): PO продвигает сам, завершив полную
  story. Таким было поведение до Фазы 12c; `manual` был значением по
  умолчанию 12c до RN-659 (миграция `0065`), которая изменила только значение
  колонки по умолчанию — проекты, созданные в промежутке, остаются `manual`.

**Режим меняет триггер, а не критерий.** Оба пути проходят через
`assertPromotable` — готовность (RF/DoD/DoR/правило) и модули, разрешённые
относительно действующего `module_map`, — и именно это фиксирует тест
симметрии в `story-promotion.spec.ts`: для каждой story `isPromotable`
согласуется с тем, что выбрасывает `assertPromotable`. До этой фазы проверка
была дублированной и асимметричной (создание вызывало `canBecomeReady`,
переход вызывал `assertReady` + `assertModulesResolved`): две двери в одно
состояние, с разными замками. Чтобы сделать триггер настраиваемым, сначала
пришлось их объединить, иначе «продвинуть через UI» и «продвинуть при
создании» были бы разными правилами с одним именем.

**Неполная** story никогда не предлагается. `proposed_ready` включается,
только когда story уже прошла бы проверку, — предложение того, что домен
отклонил бы, переложило бы работу PO на пользователя под видом решения.

**Отказ** возвращает story PO: записывает `returned_reason`/`returned_at`,
выключает `proposed_ready`, выпускает `backlog.story_promotion_returned` и
внедряет причину как ЗАКРЕПЛЁННОЕ сообщение в сессии PO, с той же
формулировкой приоритета, что и у gate, возвращённого dev (урок ADR 0020).
Отказ записывается **до** обращения к engine, и сбой engine его не
отменяет — это противоположно порядку перевзведения в [RN-047](#rn-047), и
по причине: там событие утверждает что-то О engine, здесь — что-то о
пользователе, что верно независимо от того, дежурит ли PO, чтобы это
услышать.

Пакетное продвижение **не «всё или ничего»**: каждая story — своя
транзакция, и та, что потеряла готовность между предложением и решением,
возвращается `failed` с причиной, не роняя остальные, которые пользователь
только что просмотрел.

Событие `backlog.story_transitioned` регистрирует **реального актора** —
`user` при ручном продвижении, `agent/po` при автоматическом. Event log
неизменяем, и его читает аудит: запись PO в решении пользователя стёрла бы
ровно тот человеческий этап, который правило существует, чтобы вернуть.

Миграция `0033` делает **направленный**, а не слепой backfill: колонка
рождается `manual`, и каждый уже существовавший проект переводится в `auto`.
Новое значение по умолчанию действует для тех, кто придёт позже; идущий
проект не может перестать производить из-за deploy.

- **Где:** `apps/api/src/domain/backlog/story-promotion.ts`,
  `apps/api/src/db/migrations/0033_absurd_domino.sql`,
  `apps/api/src/application/use-cases/backlog/promote-stories.use-case.ts`,
  `apps/api/src/application/use-cases/backlog/return-story.use-case.ts`,
  `apps/engine/lib/engine/agents/po_server.ex` (`revision_message/1`)
- **Тест:** `test/domain/backlog/story-promotion.spec.ts` (симметрия),
  `test/db/story-promotion-migration.spec.ts` (направленный backfill),
  `test/application/use-cases/backlog/promote-stories.use-case.spec.ts`,
  `test/application/use-cases/backlog/return-story.use-case.spec.ts`,
  `apps/engine/test/engine/agents/po_server_test.exs` (describe `revise/2`)
- **Источник:** [ADR 0046](../adr/0046-promocao-de-story-com-autoridade-do-usuario.md)
### RN-049 — Каждое решение о предложенном действии остаётся в event log, с тем, кто решил {#rn-049}

`proposed_action.created`, `.approved` и `.denied` — доменные события в
`session_events`, помимо строк outbox, которые доставляют их в engine.
Outbox — **не** память: он вычерпывается, помечается `processed_at` и
подрезается.

`actor` — тот, кто реально решил: **пользователь** в `.approved`/`.denied`,
**агент**, который предложил, в `.created`. А `created.payload.status`
говорит, как действие родилось (`pending`, `auto_approved`, `denied`).

Это даёт различие, которое составляет метрику: **человеческое решение =
событие `proposed_action.approved`**; политика, решающая сама, появляется
только в `.created` со `status: auto_approved` и актором-агентом и никогда не
путается с кликом. Этот подсчёт — «клики одобрения» — был ровно тем, что
Фаза 10 хотела измерить и не смогла, потому что решения не существовало в
запрашиваемом месте (находка №17). `approve_always` считается одобрением,
потому что делегирует тому же сценарию использования, и поверх выпускает
`permission.granted`.

Осталось вне рамок, по решению: `proposed_action.created`, который bootstrap
репозитория выпускает прямо в outbox. Эти мутации уже описываются
`bootstrap.step_*` в той же сессии, и их дублирование считало бы один и тот
же факт дважды в метрике одобрения.

- **Где:** `apps/api/src/application/use-cases/actions/propose-action.use-case.ts`,
  `.../approve-action.use-case.ts`, `.../deny-action.use-case.ts`
- **Тест:** `test/application/use-cases/actions/approve-deny-action.use-case.spec.ts`
  (describe `the decision in the event log`)
- **Источник:** [ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md)

### RN-050 — Без открытого PR ни один gate не открывается {#rn-050}

Dev agent предлагает commit, push и PR и **читает исход каждого**. Он
открывает gate, только если все три выполнены. Если один остался `pending` —
автономия агента в `require_approval`, — он переходит в `awaiting_approval`,
**удерживая worktree**, и не открывает никакого gate.

Без этого gate открывался в любом случае, и ущерб был молчаливым: QA
прочёсывает **worktree**, а не PR; нашёл файлы — одобрил; SecOps одобрил;
задача закрылась как завершённая — **без единой закоммиченной строки и без
какого-либо PR**. Только потом, одобряя commit, пользователь увидел бы, как
действие падает (с пустым диагнозом, потому что `System.cmd` в удалённом
каталоге возвращает `{"", 2}`).

Агента освобождает `task.pr_settled`, выпускаемый api, когда `pr_open`
приходит к терминальному исходу: `opened: true` открывает gate;
`opened: false` (отклонено или сбой) возвращает задачу с диагнозом, вместо
того чтобы оставить агента вечно ждать gate, который никто не откроет.

Отклонённый PR **не засчитывается в circuit breaker** из [RN-047](#rn-047):
решение было за пользователем, а не за агентом, сжигающим потолок, — тот же
принцип, что у восстановления после перезапуска.

Это правило также устраняет D5 (worktree, переработанный при ожидающем
одобрении) как следствие: worktree освобождается только в `gate_resolved`,
gate открывается только после PR, а PR открывается только после commit и
push.

- **Где:** `apps/engine/lib/engine/dev/agent_io.ex` (`propose/3`),
  `apps/engine/lib/engine/dev/dev_agent_server.ex` (`abrir_gate/1`,
  `aguardar_aprovacao/2`),
  `apps/api/src/application/use-cases/actions/execute-git-action.use-case.ts`
  (`settlePrOpen`)
- **Тест:** `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  (describe `pending approval doesn't open a gate`)
- **Источник:** [ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md)

### RN-051 — Цена, набранная вручную, побеждает каталог провайдера {#rn-051}

Строка `models` с `manual_pricing = true` содержит число, которое кто-то
набрал, прочитав документацию провайдера. Синхронизация каталога **его не
трогает** — даже когда удалённый каталог приносит собственную цену. Это
всегда говорила схема («тот, кто синхронизирует цену, НЕ МОЖЕТ перезаписать
строку, помеченную здесь, без явного решения»), и этого не делал код:
удалённое всегда побеждало, когда приносило цену, и следующая синхронизация
отменяла исправление того, кто поправил неверное число.

Правило существует, потому что для нескольких провайдеров набранное число —
**единственное существующее**: NVIDIA NIM и Bitdeer не публикуют цену за
токен ни в какой документации
([справочник провайдеров](../reference/llm-providers.md)), а засеянное
значение — рыночное приближение. Позволить удалённому каталогу его
перезаписать значило бы заменить одно известное приближение другим, без
чьего-либо решения.

НОВАЯ модель рождается с флагом из каталога, а не с фиксированным значением
по умолчанию: обнаруженная **с** ценой — `manual_pricing = false` (источник —
синхронизация, и именно она поддерживает строку актуальной); обнаруженная
**без** цены — `true`: строка ждёт, что кто-то наберёт цену, и пометка уже
защищает это число от первого каталога, который решит сообщить цену.

- **Где:** `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts`
  (`resolverPreco`), `apps/api/src/db/schema/llm.ts:137`
- **Тест:** `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`
  (`manually typed price beats a catalog that REPORTS a price`)
- **Источник:** [ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)

### RN-052 — Курирование моделей действует только в workspace, который его решил {#rn-052}

Включение или выключение модели в селекторе — решение **этого workspace**, и
оно не доходит до соседа. Сам каталог остаётся глобальным — имя, цена, окно
и capabilities — факты провайдера, одинаковые для всех, и их дублирование по
workspace создало бы N истин об одной модели, а также разрезало бы
`token_usage.model_id` пополам.

До этого `models.is_active` был колонкой на всю установку: кто кликал
«активировать», решал за все workspaces, и экран никак этого не
показывал. Практическим эффектом был workspace, включающий дорогую модель в
селекторе другого, — и расход, появляющийся в бюджете того, кто ничего не
решал.

Три производных правила:

1. **Отсутствие строки — отключённое состояние.** Нет отдельного состояния
   «никогда не решалось»; модель, которую обнаружила синхронизация, не имеет
   строки и не появляется в селекторе ([RN-043](#rn-043)).
2. **Отключение — это `UPDATE`, а не `DELETE`.** Удаление строки удалило бы
   также, кто решил и когда. Чтения трактуют оба случая как неактивные;
   запись существует для того, кто проводит аудит.
3. **Области `agent` и `session` не проверяют курирование.** Ни у одной нет
   привязки к workspace — binding агента идёт по глобальному slug. Проверка
   получает `null` и проверяет только доступность, оставляя пробел явным,
   вместо того чтобы угадывать workspace.

- **Где:** `apps/api/src/db/schema/llm.ts` (`workspace_models`),
  `apps/api/src/application/use-cases/llm/set-models-active.use-case.ts`,
  `apps/api/src/application/use-cases/llm/set-model-binding.use-case.ts`
  (`workspaceDoEscopo`)
- **Тест:** `test/application/use-cases/llm/set-models-active.use-case.spec.ts`
  (`activating in one workspace does NOT turn on the model in its neighbor`)
- **Источник:** [ADR 0049](../adr/0049-curadoria-de-modelo-por-workspace.md)

### RN-061 — Сбой ИНСТРУМЕНТА тоже является событием и возвращается модели {#rn-061}

Результат вызова инструмента никогда не отбрасывается. Он становится
`tool.result` в event log (`ok` и, при сбое, `erro`), агент **говорит** в
ленте, что произошло, а причина **возвращается модели** в роли `tool` — чтобы
она исправила и повторно выдала на следующем ходе. Ошибка инструмента — это
ввод цикла, а не конец пути.

Агент Criativo был единственным, кто её отбрасывал
(`_ = EmitArtifact.run(args, state)`), — PO и Arquiteto уже возвращали её в
цикл. При реальном исполнении модель выдала `titulo`/`descricao` против
схемы, требующей `title`/`description`/`origin`: **все четыре бизнес-правила
разговора были отклонены**, ни одно событие не было записано, а он
продолжал говорить «я записал правила» при пустой панели.

Описание инструмента теперь НАЗЫВАЕТ обязательные поля каждого типа,
по-английски и с заполненным примером, — включая то, что
`business_rule.origin` — это **непустой список** `seq` сообщений, породивших
правило, а не свободный текст. Без этого модель угадывает, и угадывает на
языке разговора.

Это то же правило, что [RN-059](#rn-059), применённое к другому пути сбоя:
две политики для одной проблемы были бы двумя шансами проглотить ошибку.

- **Где:** `apps/engine/lib/engine/agents/criativo_server.ex` (`dispatch_tool`,
  `realimentar`), `apps/engine/lib/engine/harness/tools/emit_artifact.ex`
  (`descricao/0`), `apps/engine/lib/engine/harness/artifact_schemas.ex`
  (`required/1`)
- **Тест:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  (`a refused tool becomes a tool.result with an error, and the agent speaks`)
- **Источник:** реальное исполнение ФАЗЫ 13b

### RN-065 — Один module_map на СЕССИЮ; пересмотр — это другая сессия {#rn-065}

`create_module_map` отклоняет вторую эмиссию **внутри той же сессии** с
сообщением, называющим следующий шаг. Между сессиями карта продолжает
версионироваться (`version + 1`, `findCurrent` возвращает самую старшую) —
пересмотр архитектуры является желаемым поведением.

Различие и есть суть: между сессиями новая эмиссия — **пересмотр**; внутри
той же — модель **перерешает с нуля**. При реальном исполнении Arquiteto
выдал четыре карты подряд, с разными именами и разбиением
каждый раз — `greeting`, `hello_core`, `greeting`, `hello-api-core`, — и цикл
закончился только потому, что упала сеть (`%Req.TransportError{reason: :timeout}`).

Отказ возвращается модели через tool-result ([RN-061](#rn-061)): она читает,
что карта уже существует, и переходит к `assign_story_modules` — шагу 2 её
kickoff. Именно поэтому ход **не** завершается, когда карта выпущена: у
Arquiteto впереди ещё три шага (привязать истории, предложить ADR,
зарегистрировать напряжения), и завершение там убило бы все три.

- **Где:** `apps/api/src/application/use-cases/architecture/create-module-map.use-case.ts`
- **Тест:** `test/application/use-cases/architecture/create-module-map.use-case.spec.ts`
  (`refuses the SECOND map of the same session`; а версионирование между
  сессиями по-прежнему доказано рядом)
- **Источник:** реальное исполнение ФАЗЫ 13b

### RN-066 — Каждый ответ о модулях несёт канонические имена {#rn-066}

У Arquiteto **нет инструмента, чтобы прочитать** действующий module_map.
Поэтому три ответа о модулях, которые он получает, должны называть имена:

1. Успешный `create_module_map` возвращает модули **так, как их записала
   api**, — а не только версию.
2. Отклонённый `assign_story_modules` перечисляет **допустимые** модули,
   помимо несуществующих.
3. `create_module_map`, отклонённый по [RN-065](#rn-065), говорит, **какие**
   модули сессия уже определила, а не сколько.

Без какой-либо карты предложить нечего, а пустой список читается как
«угадывай снова»: этот путь называет настоящую проблему — не хватает шага 1
kickoff.

Причина конкретна. При реальном исполнении Arquiteto выпустил карту
(`saudacao`, `api_http`), не смог её перечитать и прибег к грубой силе: 18
догадок подряд — `api`, `core`, `http`, `greeting`, `domain`, `web`,
`hello-api`, `hello`, `greeting-api`, `saudacao`, `app`, `server`, `publico`,
`public-api`, `api-publica` — пока **одна не попала по случайности**. Его
словами в event log: *"vou descobrir os nomes válidos testando candidatos
plausíveis"*.

Ущерб был не в растрате, а в результате: **все четыре** истории оказались в
одном модуле (`saudacao`), включая историю endpoint, `api_http` осталась без
единой истории, а исход утверждал *"Todas as 4 histórias foram
vinculadas a módulos com sucesso"*. Поскольку исполнение поднимает **одного
dev agent на модуль**, нарисованная архитектура не была бы построенной.

Цикл из [RN-065](#rn-065) был симптомом этого: Arquiteto повторно выпускал
карту именно для того, чтобы попытаться закрепить имена, которые он не мог
прочитать.

- **Где:** `apps/api/src/application/use-cases/architecture/assign-story-modules.use-case.ts`,
  `apps/api/src/application/use-cases/architecture/create-module-map.use-case.ts`,
  `apps/engine/lib/engine/harness/tools/create_module_map.ex`
- **Тест:** `test/application/use-cases/architecture/assign-story-modules.use-case.spec.ts`
  (`the refusal lists the VALID modules`; `with no module_map, it directs
  creating the map`) и
  `create-module-map.use-case.spec.ts` (`the refusal says WHICH modules
  there are`)
- **Источник:** реальное исполнение ФАЗЫ 13b

### RN-067 — Каждая сессия рождается, выпуская `session.created` {#rn-067}

`CreateSessionUseCase` — **единственное** место, создающее сессию. Он
выпускает `session.created` в outbox **в той же транзакции**, что и insert, и
именно это событие заставляет engine поднять `SessionServer` сессии.

Тот, кто вызывал `sessions.create(...)` напрямую, производил сессию, о которой
engine никогда не знал. Эффект — молчаливый каскад:

- канал Phoenix вечно отвечает `REFUSED JOIN` — UI жалуется только в консоли
  и продолжает пытаться каждые 10 секунд;
- без канала нет живого обновления: лента застревает на индикаторе набора,
  даже когда агент уже `idle`;
- никто не отбивает heartbeat, а поскольку сессию закрывает именно heartbeat
  ([RN-064](#rn-064)), она остаётся `active` **навсегда**.

Так делали три пути: `provision-repository` (два вызова),
`adopt-repository` и `activate-execution` — последний создаёт сессию, в которой
работают **dev agents**.

Доказательство от противного, из реального исполнения: у сессии мастера не
было `session.created`, был пустой `engine.session_states` и `REFUSED JOIN`;
у сессии, открытой обычным маршрутом, были событие, строка состояния и
`JOINED`.

Тест намеренно касается ИСХОДНИКА: поведенческий тест доказывал бы по одному
пути за раз, а дефект здесь — путь, о котором никто не подумал.

- **Где:** `apps/api/src/application/use-cases/sessions/create-session.use-case.ts`
  (владелец), `git/provision-repository.use-case.ts`,
  `git/adopt-repository.use-case.ts`,
  `execution/activate-execution.use-case.ts` (вызывающие)
- **Тест:** `test/application/use-cases/sessions/toda-sessao-emite-created.spec.ts`
  (`only CreateSessionUseCase calls sessions.create`)
- **Источник:** реальное исполнение ФАЗЫ 13b

### RN-068 — Dev agent читает worktree, не спрашивая разрешения {#rn-068}

Активация исполнения засеивает два семейства команд в `allow` проекта:
**чтение собственного worktree** (`ls`, `pwd`, `find`, `cat`, `head`, `tail`,
`grep`, `wc`, `echo`, `git status`, `git diff`, `git log`) и **build и
тест**.

Второе уже существовало: `ReportDone` позволяет открыть PR только после
`terminal` с `exit 0`. Первое было добавлено, потому что агент **смотрит
перед тем, как строить**, а без этого не мог даже начать.

Причина конкретна. Ожидающий инструмент `:pipeline` возвращает
`proposed_action <id> status pending` как РЕЗУЛЬТАТ — а не вывод команды, — и
ToolLoop идёт дальше. В только что провизионированном репозитории каждый
`ls -la` агента попадал на одобрение, ничему его не учил и сжигал итерацию.
При реальном исполнении исходом был
`toolloop.limit_reached {iteration: 8, max_iterations: 8}`, задача,
заблокированная с "limite de iterações atingido", без единой написанной
строки — а одобрения, данные пользователем, пришли после исчерпания цикла.

Освобождение чтений не ослабляет конвейер, и именно это утверждает тест:
`deny` побеждает `allow`, `BUILTIN_DENY_PATTERNS` остаются активными,
сопоставление идёт по префиксу ТОКЕНА (разрешённый `ls` не разрешает `lsof`),
а составная команда требует совпадения КАЖДОГО сегмента — `ls && rm -rf /` не
проходит благодаря `ls`.

Allowlist — смягчение, а не решение: это список предусмотренных команд, а
модель выдумывает команды. Структурное исправление — чтобы агент ЖДАЛ
решения, а не сжигал итерации, — находится в
[ADR 0052](../adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md).

- **Где:** `apps/api/src/domain/actions/dev-terminal-patterns.ts`,
  засеивается `application/use-cases/execution/activate-execution.use-case.ts`
- **Тест:** `test/domain/actions/dev-terminal-patterns.spec.ts`
  (`allows ls -la`; `a composite command doesn't hitch a ride on the
  allowed segment`)
- **Источник:** реальное исполнение ФАЗЫ 13b

### RN-143 — Подкоманда git только для чтения разрешена, лишь будучи закреплённой флагом, делающим чтение однозначным, никогда по одному глаголу {#rn-143}

При запросе к базе реального исполнения выяснилось, что dev agents сожгли
десятки ручных одобрений на подкомандах исследования — `git branch -a`, `git
remote -v`, `git worktree list`, `git show origin/dev --stat`, `git log
--all --oneline --graph`, `git for-each-ref`, `git ls-tree -r origin/dev
--name-only`, `git config user.name`, — ни одна из которых не покрывалась
[RN-068](#rn-068), разрешавшей только `git status`/`diff`/`log` (без
дополнительных флагов). Поскольку сопоставление по префиксу токена требует,
чтобы КАЖДЫЙ сегмент составной команды был в `allow`, длинная цепочка
исследования целиком падала в `require_approval` в тот момент, когда
посередине появлялась ОДНА из этих подкоманд.

`DEV_TERMINAL_ALLOW_PATTERNS` получил
`git branch -a/-r/-v/--list/--show-current`, `git remote -v`/`git remote
show`, `git worktree list`, `git show`, `git for-each-ref`, `git
ls-tree`, `git rev-parse` и `git config --get`. `git log` не понадобился новый
шаблон: сопоставление уже идёт по ПРЕФИКСУ токена (лишние хвостовые токены
разрешены), так что `Terminal(git log)` уже покрывал `git log
--all --graph --oneline --decorate`.

**Осторожность здесь та же, что RN-068 уже показывает для `ls`/`lsof`,
применённая к глаголам с ИЗМЕНЯЮЩИМ братом, принимающим ту же усечённую
форму шаблона.** `Terminal(git branch)` совпал бы с `git branch -D nome`
(удаляет) так же, как с `git branch nome-nova` (создаёт) или одиноким
`git branch`, — шаблон не видит того, что идёт ПОСЛЕ проверенного префикса.
Именно поэтому ни один из четырёх глаголов с изменяющей формой (`branch`,
`remote`, `worktree`, `config`) не был допущен одиноким глаголом; каждый был
ЗАКРЕПЛЁН флагом, который делает чтение однозначным независимо от того, что
идёт следом:
- `git branch` — закреплён на `-a`/`-r`/`-v`/`--list`/`--show-current`,
  никогда на одном глаголе; `-D`/`-d`/`-m`/`-M` (удалить/переименовать) и
  одинокое имя ветки (создать) остаются за рамками.
- `git remote` — закреплён на `-v` и `show` (который после себя принимает
  только имя удалённого репозитория, всегда чтение); `add`/`remove`/`set-url`
  остаются за рамками.
- `git worktree` — закреплён на `list`; `add`/`remove`/`prune` остаются за
  рамками.
- `git config` — допущен только `--get`, потому что это единственный флаг,
  про который сам git гарантирует, что это чтение, независимо от того, что
  идёт дальше (ключ или ключ + шаблон значения). `git config user.name`/`git
  config user.email` БЕЗ `--get` намеренно оставлены за рамками: второй токен
  после ключа (`git config user.name "novo valor"`) — это ЗАПИСЬ, а
  сопоставление по префиксу не отличает «ни одного лишнего токена» от «одного
  лишнего токена» без выдумывания нового парсера подсчёта аргументов — то же
  ограничение, которое уже блокирует одинокий `git branch`.
  `--global`/`--system` никогда не закреплялись.

- **Где:** `apps/api/src/domain/actions/dev-terminal-patterns.ts`
- **Тест:** `test/domain/actions/dev-terminal-patterns.spec.ts` (describe
  `read-only git subcommands (found live)` — покрывает составную цепочку,
  замеченную вживую и автоодобряемую, и каждый изменяющий вариант с ТЕМ ЖЕ
  командным словом — `git branch -D`, `git remote add`, `git worktree add`,
  `git config --global user.name`, — остающийся в `require_approval`)
- **Источник:** запрос к базе реальной сессии, обнаруженный во время
  использования

### RN-069 — Повтор задачи пересоздаёт ветку, а не падает {#rn-069}

`WorktreeManager.add_worktree/3` использует `git worktree add -B` (создаёт
**или** сбрасывает), а не `-b`. Он уже удалял каталог предыдущего worktree, но
оставлял ветку — а поскольку её имя берётся из slug задачи, вторая попытка на
ТОЙ ЖЕ задаче всегда падала с `fatal: a branch named
'feature/<slug>' already exists`.

Эффект был постоянным: разблокировка задачи не помогала, повторная
активация исполнения не помогала, а circuit breaker срабатывал без выхода.
При реальном исполнении единственным выходом был ручной `git worktree prune`
в workspace проекта.

Сброс — правильный выбор: предыдущий worktree уже удалён, работа той попытки
ничего не стоит (задача вернулась в очередь), а ветка рождается заново от
текущей точки `work_dir`.

- **Где:** `apps/engine/lib/engine/dev/worktree_manager.ex`
- **Тест:** `apps/engine/test/engine/dev/worktree_manager_test.exs`
  (`retrying the SAME task recreates the worktree instead of failing`)
- **Источник:** реальное исполнение ФАЗЫ 13b

### RN-070 — Каждый объявленный gate указывает на доказательство, которое его подтверждает {#rn-070}

Ни одна запись `docs/gates.yml` не существует без `evidencia`, и реестр не
может утверждать больше, чем проверяет: gate `block` требует `verificacao:
script`, а gate `planned` не несёт доказательства того, что ещё не
произошло.

Доказательство — это **локатор**, а не проза: `event_log` несёт типы событий и
фильтр payload, отличающий их от соседей; `teste` и `ci` несут путь, и
исчезнувшая цель ПРОВАЛИВАЕТ. Это тот же режим отказа, который docmap
называет мёртвым glob, — правило, которое никогда не срабатывает и изображает
покрытие.

**Это последнее утверждение касается РЕПОЗИТОРИЯ и никогда не оценивается в
runtime.** Реестр проверяется на двух уровнях: `validarRegistro` (содержимое —
`block` нужен `script`, четыре человеческих gate остаются человеческими,
`active` нужно доказательство, никаких дублирующихся id, никакой осиротевшей
`entrada`) действует везде, где читается файл, и именно его вызывает
загрузчик api; `validarLocalizadores` (целевой файл есть на диске) имеет
смысл только внутри checkout, и его требуют тест реального файла и фаза 2
`validacao-gates.ts`.

Раньше они были одной функцией, и это стоило дефекта production, измеренного
в установленной v6.1.0: `GET /gates` возвращал `500` с
`RegistroDeGatesInvalido`, перечисляющим одиннадцать целей как
отсутствующие, — двенадцать 5xx примерно за 55 минут, в каждой установке.
Образ production несёт `/app/docs/gates.yml` и больше ничего из `docs/`;
`apps/api/test/`, `scripts/ci/` и `.github/` в него никогда не входят.
Правило не было ослаблено — оно было перенесено туда, где существует вопрос.
Не возвращайте его в загрузчик: `arquivoExiste` в процессе, у которого нет
репозитория, отвечает о другом дереве.

Экран это скрыл: [RN-084](#rn-084) заставляет `PrGateTimeline` падать на
полный конвейер, когда маршрут сбоит, так что 500 появлялся только в логах
api.

Три типа, потому что не каждый gate живёт в event log:
[`merge-protegida`](../business-rules.md#rn-014) — это потолок в чистом
правиле, не выпускающем собственного события (гарантирует его тест), а
`backmerge` — это CI с состоянием в `.release/gate.json`. Понизить их до `warn`
по этой причине значило бы солгать о самых жёстких замках продукта.

Фильтр важен не меньше типа: `qa-verificada` и `secops-segura` записывают
ОДИН И ТОТ ЖЕ `pr.gate_changed`, и тот же тип срабатывает при ОТКРЫТИИ gate,
без `veredito`, — без фильтра открытие считалось бы прохождением. То же верно
для двух gate PR инфраструктуры. Именно поэтому ни одна пара (`event_types` +
`filtro`) не может повторяться.

Фильтр намеренно дотягивается только до PAYLOAD: приём произвольной колонки
открыл бы весь запрос. Кто продвинул story (человек или PO), живёт в колонке
`actor_kind` и остаётся вне декларативного словаря.

- **Где:** `apps/api/src/domain/gates/gate-registry.ts`
  (`validarRegistro` и `validarLocalizadores`), зарегистрировано в
  `docs/gates.yml`, измеряется в `apps/api/scripts/validacao-gates.ts`;
  загрузчик, намеренно вызывающий только первую, —
  `apps/api/src/infrastructure/gates/gate-registry.loader.ts`
- **Тест:** `apps/api/test/domain/gates/gate-registry.spec.ts`
  (`é válido: nenhum problema acumulado`; `todo alvo de prova citado
  existe no repositório`; `validarRegistro ignora o disco: alvo ausente
  não é problema DELE`; `nenhum par (event_types + filtro) se repete
  entre gates`) и
  `apps/api/test/infrastructure/gates/gate-registry.loader.spec.ts`
  (`carrega o registro real sem exigir os alvos que a imagem não leva`,
  против корня, восстановленного как дерево образа production)
- **Источник:** ФАЗА 15a (ADR 0054); разделение на два уровня пришло из 500
  `GET /gates`, измеренного в установленной v6.1.0 (AT-086)
### RN-071 — Четыре gate полномочий пользователя не могут быть объявлены автоматическими {#rn-071}

`acao-aprovada`, `story-promovida`, `plano-de-adocao` и `merge-protegida`
имеют `aprovacao_humana: true` по построению. Список живёт в ДОМЕНЕ
(`GATES_HUMANOS_IMUTAVEIS`), а не в тесте: его изменение должно быть
сознательным актом, проверяемым как код.

`aprovacao_humana: true` означает, что решение за пользователем — напрямую
кликом или делегированное политикой, которую он сам написал в
`permissions.json`. Именно это позволяет `acao-aprovada` сосуществовать со
`status: auto_approved`: политика, решающая сама, — это пользователь,
решивший заранее. `merge-protegida` — случай, когда нет даже делегирования:
потолок понижает `auto_approve` до `require_approval` даже при включённой
автономии.

Обратное тоже проваливает: id в списке без соответствующего gate — мёртвое
правило, указывающее в никуда.

- **Где:** `apps/api/src/domain/gates/gate-registry.ts`
  (`GATES_HUMANOS_IMUTAVEIS`); потолок в
  `apps/api/src/domain/actions/decide.ts`
- **Тест:** `apps/api/test/domain/gates/gate-registry.spec.ts`
  (`%s cannot have aprovacao_humana false`); потолок в
  `apps/api/test/domain/actions/decide.spec.ts`
- **Источник:** ФАЗА 15a (ADR 0054)

### RN-072 — Без явного выбора модель — модель агента Criativo {#rn-072}

Когда каскад bindings приземляется на значение по умолчанию **workspace** —
то есть никто ничего не решил для этого проекта, — наследуемая модель — это
модель агента **Criativo**, а не глобальное значение по умолчанию.

Агент Criativo — всегда входная дверь проекта: с ним происходит первый
разговор, и его binding представляет «модель, которой этот проект думает».

Наследование заполняет **пробел**, никогда не перезаписывает: bindings
сессии, агента или проекта — чей-то явный выбор, и они продолжают
побеждать. Именно поэтому это шаг ПОСЛЕ каскада, а не новая область внутри
него — он не соревнуется за приоритет. И наследуемая модель проходит те же
фильтры: исчезнувшая из каталога или без tool calling означает, что она не
наследуется, по той же причине, по которой каскад их пропускает
([RN-043](#rn-043)).

Что это исправляет: значение по умолчанию workspace глобально и обычно
является маленькой локальной моделью. Новая сессия и dev agent — у которых
нет собственного binding — рождались на ней, а
[ADR 0020](../adr/0020-destravar-gates-qa-secops.md) запрещает маленькую
локальную модель на семантическом шаге. При реальном исполнении пришлось
вручную менять модель в каждой открытой сессии, и три dev agents поднялись
на `llama3.2:1b`, хотя никто об этом не просил.
- **Где:** `apps/api/src/domain/llm/binding-resolver.ts`
  (`herdarModeloDeStart`), применяется в
  `application/use-cases/llm/resolve-model-binding.use-case.ts`
- **Тест:** `apps/api/test/domain/llm/binding-resolver.spec.ts`
  (`fills the gap`; `does NOT override %s's explicit choice`)
- **Источник:** находки B и O реального исполнения (ФАЗА 13c, фаза A)

### RN-073 — Ожидающее одобрение ПРИОСТАНАВЛИВАЕТ цикл, а не сжигает его {#rn-073}

Когда инструмент конвейера возвращает `pending`, ToolLoop **останавливается**,
а dev agent переходит в `:awaiting_approval`, удерживая задачу, worktree и
историю цикла. Решение пользователя выпускает `task.action_settled`, которое
его будит: реальный результат занимает место, где было бы слово «pending», и
цикл возобновляется с того места, где остановился.

Свойства, которые фиксирует тест:

- **Во время ожидания ничего не записывается.** Место сообщения инструмента
  остаётся пустым. Записать туда «pending» означало бы сказать модели, что
  это ответила команда, — ровно в этом и был дефект.
- **Отказ — это ответ.** Причина занимает место результата, и агент узнаёт,
  что этот путь закрыт, вместо того чтобы вечно ждать того, что никто не
  одобрит. Это тот же принцип, что у `pr_settled` с `opened: false`
  ([RN-047](#rn-047)), уровнем ниже.
- **Wake должен ДОЙТИ.** `task.action_settled` рождается в агрегате `task`, а
  не в `proposed_action`, которую подсказывает имя таблицы: drain engine
  читает закрытый список агрегатов (`session` и `task`). Выпущенное вне этого
  списка, событие успешно записывается, остаётся с пустым `processed_at` и
  даже не читается — без job, без ошибки, без лога, и агент ждёт вечно.
  Контракт пересекает два языка, и поэтому он зафиксирован с обеих сторон.

Если engine **перезапустится** во время ожидания, правило перестаёт
действовать для этой задачи: приостановленный цикл существует только в
памяти, поэтому она возвращается в очередь заблокированной с источником
`infra`, а решению, принятому позже, негде примениться. Блокировка с
диагнозом намеренна — альтернативой было вечное и молчаливое ожидание, а
именно для того, чтобы его прекратить, это правило и существует.

Что это исправляет: `pending` раньше возвращался как РЕЗУЛЬТАТ инструмента, и
цикл шёл дальше. Модель читала это как ответ команды, ничему не училась,
пробовала что-то другое — и каждая попытка сжигала итерацию вплоть до
`toolloop.limit_reached {iteration: 8, max_iterations: 8}`, с задачей,
заблокированной с "limite de iterações atingido", без единой написанной
строки. Выданные одобрения приходили после исчерпания цикла и ни на что не
годились.

Allowlist терминала ([RN-068](#rn-068)) продолжает действовать, но перестаёт
быть единственной защитой: это список предусмотренных команд, а модель
выдумывает команды.

- **Где:** `apps/engine/lib/engine/harness/hooks/action_pipeline.ex`,
  `harness/tool_loop.ex`, `dev/dev_agent_server.ex`,
  `workers/dev_agent_wake_worker.ex`; выпуск в
  `apps/api/src/application/use-cases/actions/{approve,deny}-action.use-case.ts`
- **Тест:** `apps/engine/test/engine/dev/dev_agent_awaiting_approval_test.exs`
  (`pending action STOPS the agent`; `approved: resumes the loop with
  the REAL output`; `restart during the wait BLOCKS the task`) и
  `apps/engine/test/engine/dev/wake_do_outbox_ao_agente_test.exs`, который
  проходит всю цепочку — outbox, drain, очередь и процесс, — потому что тесты
  по звеньям все были зелёными при сломанной доставке; агрегат зафиксирован
  на стороне api в
  `apps/api/test/application/use-cases/actions/approve-deny-action.use-case.spec.ts`
- **Источник:** [ADR 0052](../adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md),
  фаза A сортировки

### RN-135 — Активация исполнения закрывает сессию ЧАТА, породившую запрос {#rn-135}

`ActivateExecutionUseCase` всегда разрешал сессию ИСПОЛНЕНИЯ
(`findActiveExecutionSession` или создавал новую `criativa`), но никогда не
переводил сессию ЧАТА, откуда пришёл клик «активировать исполнение», —
разговор с Dev Lead/PO в отдельной сессии. Она оставалась `active` навсегда,
даже при исполнении, уже идущем самостоятельно в другой сессии, и продолжала
показываться в списке как открытый разговор.

`execute()` получил `originSessionId`, необязательный и последний — старый
вызывающий (сейчас только активация через Visão Geral, без контекста сессии)
продолжает работать ИДЕНТИЧНО, ничего не закрывая. Когда он передан, в КОНЦЕ
метода (после того как произошло всё остальное: module_map, области,
автономия, `startExecution`, `execution.activated`):

- **никогда не закрывает собственную сессию исполнения** — если
  `originSessionId` равен сессии, только что получившей `execution.activated`,
  закрытие пропускается, потому что её закрытие уничтожило бы процесс,
  который только что получили dev agents;
- **закрывает только то, что `active`** — та же осторожность, что в
  `decide-bootstrap-plan.use-case.ts#fecharSessao`, нечего делать, если сессии
  больше нет или она уже не открыта;
- **переиспользует `GetSessionPendingWorkUseCase`** ([RN-073](#rn-073)) — ТУ
  ЖЕ защиту, что удерживает закрытие по heartbeat бездействия: предложенный
  handoff, ожидающий `proposed_action` или агент `working` без последующего
  `idle` препятствуют закрытию;
- проходит через `closing` перед `closed` — машина состояний
  (`active -> closing -> closed`) не позволяет прямого прыжка.

Сбой или ожидающее состояние здесь НИКОГДА не распространяются на того, кто
вызвал `execute()`: активация исполнения уже произошла и является основным
эффектом; закрытие исходного чата — побочный эффект *best-effort*.

- **Где:** `apps/api/src/application/use-cases/execution/activate-execution.use-case.ts`
  (`closeOriginSession`), `apps/api/src/interfaces/http/execution/dto/activate-execution.dto.ts`
  (`originSessionId`), `apps/api/src/interfaces/http/execution/execution.controller.ts`
- **Тест:** `apps/api/test/application/use-cases/execution/activate-execution.use-case.spec.ts`,
  describe `fecha a sessão de origem (RN-135)` — закрывает без ожидающих, НЕ
  закрывает с ожидающими, НЕ закрывает уже не-`active` сессию, старый
  вызывающий без параметра ничего не закрывает, и никогда не закрывает
  собственную сессию исполнения, даже если `originSessionId` с ней совпадает
- **Источник:** находка исследования кода — творческая сессия с
  активированным исполнением оставалась `active` в списке даже с 35
  событиями dev agents внутри

### RN-074 — У вывода терминала есть потолок в байтах {#rn-074}

Вывод команды обрезается до `TERMINAL_OUTPUT_MAX_BYTES` (по умолчанию 32 KiB),
прежде чем стать результатом инструмента, и обрезка оставляет **метку**,
называющую оба размера и что делать:

```
[saída truncada: 32768 de 1048576 bytes. Refine o comando (head, grep,
-maxdepth) para ver o que falta.]
```

Три свойства, которые фиксирует тест:

- **Потолок — `>`, а не `>=`.** Вывод, ровно умещающийся в предел, проходит
  нетронутым — его пометка заставила бы модель уточнять команду, которая уже
  выдала всё.
- **Обрезка не разрывает многобайтовый символ.** `binary_part/3` режет по
  байту; попадание в середину `é` даёт недопустимый бинарь, который ломает
  сериализацию JSON до того, как результат дойдёт до модели.
- **`raw_bytes` остаётся РЕАЛЬНЫМ произведённым размером**, а не усечённым.
  Это измерение, и ложь в нём скрыла бы именно то поведение, которое
  мотивировало потолок. Кто хочет обнаружить усечение, сравнивает
  `byte_size(stdout)` с `raw_bytes`.

Что это исправляет: вывод каждой команды остаётся в истории цикла и
путешествует в **каждом** последующем ходе. Без потолка хватает `find` по
большому дереву — исполнение `hello-limpo` умерло с
`{413, "request entity too large"}` на ходе 18, без единой написанной строки.
Переполнение — это **байты запроса**, а не окно контекста: самый крупный
успешный вызов имел 28.993 входных токена.

Метка адресована **модели**, а не человеку — без указания, что делать, она
склонна повторять ту же команду.

- **Где:** `apps/engine/lib/engine/actions/terminal_executor.ex`
  (`truncate/2`), потолок в `apps/engine/config/runtime.exs`
- **Тест:** `apps/engine/test/engine/actions/terminal_executor_test.exs`
  (describe `teto de bytes da saída`)
- **Источник:** находка S из
  [achados-execucao-real.md](../explanation/achados-execucao-real.md), Фаза F
  [backlog](../explanation/backlog.md)

### RN-075 — Команда терминала оценивается по тому, чего она касается, а не только по глаголу {#rn-075}

Папка проекта (`<PROJECT_WORKSPACES_ROOT>/<workspace_dir_name>` — голый UUID в
проекте до [RN-109](../business-rules/autenticacao.md#rn-109), `<slug>-<8
символов id>` в новом проекте) является **областью видимости**.
Команда `terminal`, касающаяся любого пути вне её, **никогда** не
автоодобряется, как бы ни был глагол в `allow`. Внутри неё `cd` перестаёт
требовать разрешения — это объявление области видимости, а не глагол.

Четыре свойства, которые фиксируют тесты:

- **Ужесточает:** разрешённый `Terminal(cat)` перестаёт автоматически
  выполнять `cat /workspace/apps/engine/.../git_executor.ex`. Это была
  находка U: сопоставление идёт по ГЛАГОЛУ, поэтому агент читал код
  платформы, которая его исполняла, и дотягивался до worktree других
  проектов.
- **Ослабляет:** `cd <dentro> && cat README.md` становится `auto_approve`.
  Это был самый дорогой дефект лестницы — dev agent всегда выдаёт
  `cd <caminho> && <verbo>`, `cd` не было ни в одном `allow`, а составная
  команда требует совпадения ВСЕХ сегментов.
- **Разрешает, не освобождая:** внутри области видимости глагол вне `allow`
  по-прежнему спрашивает. Нахождение в папке проекта не делает
  `curl … | sh` безопасным.
- **Вне области видимости — `require_approval`, никогда `deny`:** у агента
  может быть законная причина посмотреть снаружи, и решение остаётся за
  пользователем.

`deny` по-прежнему побеждает первым, а два потолка
([RN-006](../business-rules.md#rn-006), [RN-007](../business-rules.md#rn-007))
остаются нетронутыми. Без корня, переданного в `decide()`, вердикт такой же,
как до этого правила, — ни у одного вызывающего поведение не меняется по
умолчанию.

Нормализация **лексическая**, а не `realpath`: `<raiz>/../..` разрешается и
отклоняется, но символическая ссылка изнутри, указывающая наружу, не
обнаруживается. `decide()` по контракту чиста, а разрешение symlink
потребовало бы IO в домене. Область видимости — политика; изоляция — другая
проблема, объявленная открытой в ADR.

**Без regex над входом, намеренно.** Удаление завершающих косых черт корня
было `.replace(/\/+$/, '')`, и CodeQL указал полиномиальный ReDoS
(`js/polynomial-redos`, HIGH): шаблон заставляет движок пробовать каждую
начальную позицию и сканировать до конца, деградируя до O(n²). Сейчас это
проход за O(n), эквивалентный даже в вырожденном случае — корень `/`
становится пустой строкой в обоих, и именно это делает `startsWith('/')`
истинным для любого абсолютного пути. Тот, кто «упростит» обратно до regex,
снова откроет предупреждение.

- **Где:** `apps/api/src/domain/actions/path-scope.ts`,
  `domain/actions/decide.ts` (потолок области видимости и `cd` в области),
  корень, выводимый в
  `infrastructure/filesystem/project-workspaces-root.ts`
- **Тест:** `apps/api/test/domain/actions/path-scope.spec.ts` и
  `apps/api/test/domain/actions/decide.spec.ts`
  (describe `decide — escopo de caminho`)
- **Источник:** [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md),
  находка U, Фаза F [backlog](../explanation/backlog.md)

Область видимости действует, только пока она сама находится внутри корня, —
это гарантирует [RN-092](#rn-092).

### RN-092 — `projectId` — это сегмент пути, и область видимости никогда не выходит за корень {#rn-092}

`projectScopeRoot()` **отклоняет** `projectId`, не являющийся простым
сегментом пути (`^[A-Za-z0-9_-]{1,64}$`), выбрасывая исключение вместо сборки
пути.

Причина в том, что id приходит из `@Param('projectId')` без pipe проверки, а
Express **декодирует percent-encoding сегмента перед его передачей**:
`..%2F..%2Fetc` приходит как `../../etc`, и `join` разрешил бы его за
пределы корня без жалоб. Страдают оба потребителя функции, и второй —
серьёзно:

- `permissions.json` читался бы **и записывался** по произвольному пути;
- область видимости [RN-075](#rn-075) авторизует команду `terminal` под этой
  папкой. Область видимости, сбежавшая из корня, — это политика одобрения,
  указывающая не туда, — сбой БЕЗОПАСНОСТИ, а не «файл не найден».

Проверка намеренно **шире UUID** (принимает буквы, цифры, дефис и
подчёркивание), чтобы не привязывать формат id, и достаточно узкая, чтобы
результат никогда не сбежал. И она находится **там, где выводится корень**, а
не у каждого вызывающего, по той же причине, по которой функция появилась:
два вывода должны совпадать, а продублированная проверка — это проверка,
которая однажды разойдётся.

Счастливый путь не меняется — каждый реальный id является UUID из базы.

- **Где:** `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`projectScopeRoot`)
- **Тест:** `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
- **Источник:** [ADR 0058](../adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md),
  предупреждения `js/path-injection` от CodeQL

### RN-095 — Чтение репозитория ограничено проектом и лимитировано {#rn-095}

Поверхность чтения кода (`GET /projects/:projectId/code/{tree,file,search}` и
diff PR) имеет **две** гарантии, и обе одного вида: продукт отказывается
делать то, что попросил клиент.

**Ограничение.** Каждый путь файла от клиента проходит через
`caminhoDeRepositorioContido()`, которая привязывает запрос к папке проекта и
отклоняет то, что из неё выходит, — `../`, абсолютный путь или байт NUL. Это
одна функция, в том же файле, что `projectScopeRoot` из [RN-092](#rn-092),
переиспользующая примитивы области видимости терминала
(`normalizarCaminho`/`dentroDoEscopo`). **Ни один маршрут не проверяет путь
сам**, и именно это утверждает правило: четыре реализации одного
ограничения были бы четырьмя шансами разойтись, а CLAUDE.md уже записывает,
что было решено держать центральную проверку и платить цену в панели CodeQL
(барьер в другой функции он не видит).

Она возвращает **нормализованный** путь, и вызывающий использует вернувшийся.
Возврат исходного позволил бы проверить `b` и отправить провайдеру
`a/../b` — самый распространённый способ, каким ограничение существует, но не
действует.

Вектор — не «прочитать не тот файл». В `github`/`gitlab` путь становится
сегментом URL API провайдера, так что `../` **меняет endpoint**, с учётными
данными owner workspace на руках ([RN-058](#rn-058)/[RN-082](#rn-082)).
В `local` он становится правой частью `git show <ref>:<path>`. `ref`
проверяется в том же месте, по той же причине, а `..` в нём отклоняется,
потому что для git `dev..main` — диапазон коммитов, а не ревизия.

**Лимит.** Дерево и diff уже приходят обрезанными контрактом
(`GIT_TREE_ENTRY_LIMIT`, `GIT_DIFF_FILE_LIMIT`, ФАЗА 26a). **Поиск** — нет: он не
является операцией контракта — он составлен поверх `listTree` и
`getFileContent`, и это единственное чтение, стоимость которого растёт с
РАЗМЕРОМ репозитория, а не размером запроса. Его останавливают три бюджета
(пройденные каталоги, открытые файлы, возвращённые совпадения), кэш с
коротким TTL избегает повторения тех же вызовов, а `truncated` говорит, что
обрезка произошла. Без них `viewer` тратил бы учётные данные и rate limit
owner сколько угодно — то же семейство дефектов, что 3.824 req/min панели
([RN-090](../business-rules.md#rn-090)).

Обрезка всегда **видима**: каждый ответ, который мог быть обрезан, говорит об
этом в поле. `filesScanned` идёт вместе с поиском, потому что стоимость,
которую никто не видит, — та, которую никто не исправляет.

**Чтение не становится `proposed_action`.** Чтение — не внешний эффект, и его
превращение в действие одобрения заполнило бы очередь шумом, пока никто
больше не читал бы настоящие. Заморозка фазы — другая сторона этого: вкладка
только для чтения, а запись — когда появится — рождается `proposed_action`.

- **Где:**
  `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`caminhoDeRepositorioContido`),
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`,
  `apps/api/src/domain/git/git-read-limits.ts`,
  `apps/api/src/domain/git/git-read-cache.ts`,
  `apps/api/src/interfaces/http/git/code.controller.ts`
- **Тест:**
  `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (изолированное ограничение),
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (вредоносный путь отклоняется на трёх маршрутах **до** вызова провайдера, и
  каждый из трёх бюджетов останавливает поиск),
  `apps/api/test/domain/git/git-read-cache.spec.ts`
- **Источник:** ФАЗА 26b, пункт 34 программы 16–26; ограничение расширяет
  [RN-092](#rn-092) ([ADR 0058](../adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md))

### RN-127 — `ref`/`path` вкладки Code отклоняются при поступлении как МАССИВ, а не только как путь вне области видимости {#rn-127}

`@Query('ref') ref?: string` и `@Query('path') path?: string`
(`code.controller.ts`) извлекают сырое значение без DTO/`class-validator`
посередине, и глобальный `ValidationPipe` (`main.ts`) не помогает: он
пропускает нативный примитивный тип (`String`) по замыслу Nest, так что
ничто не перехватывает `ref`/`path` до того, как они придут аргументами
метода. Express отдаёт `?ref=a&ref=b` как **массив**, а не строку — аннотация
`string` в TypeScript существует только на этапе компиляции.

Массив ускользал от ОБЕИХ проверок, которые [RN-095](#rn-095) уже делала,
трактуя значение как строку: `ref.includes('..')` в массиве имеет семантику
ТОЧНОГО ЭЛЕМЕНТА (а не подстроки), а `REF_VALIDO.test(ref)` вызывает
`.toString()` у массива перед сопоставлением — значение вроде `['x/../y']`
содержало `..` и всё же прошло бы обе.

`garantirQueryEscalar(valor, criarErro)` отклоняет массив ДО любой другой
проверки, в одном месте, переиспользуемом ОБЕИМИ точками, трактовавшими query
как строку: `caminhoDeRepositorioContido` (тот же файл, что RN-092/095) и
`ReadProjectCodeUseCase.alvo` (`ref`). Конкретная ошибка
(`CaminhoForaDoEscopoError` или `BadRequestException`) решается вызывающим,
передаётся как фабрика — центральная функция не решает тип ошибки, только
форму проверки.

Счастливый путь не меняется: каждый легитимный `ref`/`path` уже был строкой.

- **Где:** `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`garantirQueryEscalar`, используемая в `caminhoDeRepositorioContido`),
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (`alvo`, `ref`)
- **Тест:**
  `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (изолированная `garantirQueryEscalar` и `caminhoDeRepositorioContido`,
  отклоняющая массив), `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (`ref`/`path` как массив дают 400 в `tree`, который все остальные маршруты
  переиспользуют через `alvo`)
- **Источник:** КРИТИЧЕСКОЕ предупреждение CodeQL (путаница типов в
  HTTP-параметре query), блокировавшее продвижение qa→main, обнаружено во
  время PR #256; расширяет [RN-095](#rn-095)

### RN-093 — В production api не стартует с примерным ключом `state` OAuth {#rn-093}

`resolveOauthStateSecret()` **роняет загрузку**, когда `NODE_ENV === 'production'`
и `GIT_OAUTH_STATE_SECRET` отсутствует, равен примерному литералу репозитория
или короче 16 символов. Вне production значение по умолчанию для разработки
продолжает действовать.

Этот ключ подписывает `state` OAuth для git, а `state` — единственное, что не
даёт подделать callback `GET /git/oauth/:provider/callback` — публичный
маршрут, по необходимости. С известным ключом любой подписывает `state` для
выбранных `{projectId, userId, provider}` и заставляет callback записать в
указанный этим payload проект git-токен, полученный от провайдера.

**Почему отклонять литерал, а не только пустое значение.** Значение по
умолчанию лежало в `.env.example` open source репозитория — это
опубликованный секрет, а не слабый секрет. А `docker-compose.prod.yml`
подставлял его как fallback, так что на реальном пути ошибки переменная была
**задана**: проверка «не пусто» прошла бы поверх всего дефекта.

Разрешение находится в одной функции, а не у каждого вызывающего, по той же
причине, что [RN-092](#rn-092): было две копии одного литерала, а копии
расходятся. При расхождении здесь callback отклонял бы каждый легитимный
`state`.

- **Где:** `apps/api/src/infrastructure/security/oauth-state-secret.ts`
  (`resolveOauthStateSecret`), вызывается при загрузке в `apps/api/src/main.ts`
- **Тест:** `apps/api/test/infrastructure/security/oauth-state-secret.spec.ts`
- **Источник:** [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md)
### RN-114 — Четыре родственных `GIT_OAUTH_STATE_SECRET` секрета тоже не стартуют в production с примерным значением {#rn-114}

[ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md) закрыл
шаблон для `GIT_OAUTH_STATE_SECRET` и явно оставил открытым, что тот же режим
отказа действовал для четырёх родственных секретов, у всех из которых было
значение по умолчанию для разработки в `docker-compose.prod.yml`:
`AUTH_JWT_SECRET`, `BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY` и
`SECRET_KEY_BASE`. Эта RN закрывает все четыре, точно повторяя то же правило, —
это не новое решение, а то же решение, применённое к родственникам.

В production (`NODE_ENV === 'production'`) каждый резолвер **роняет
загрузку**, когда переменная отсутствует/состоит только из пробелов, равна
примерному литералу репозитория (который публичен — он в `.env.example`) или
короче 16 символов. Вне production значение по умолчанию для разработки
продолжает действовать, потому что `docker compose up` без `.env` должен
работать.

- `AUTH_JWT_SECRET` — выводит пару Ed25519, которой подписывается access
  token. С публичным значением по умолчанию любой подделывает действительный
  access token.
- `BRABO_SERVICE_TOKEN` — аутентифицирует внутренний трафик api ↔ engine. С
  публичным значением по умолчанию любой вызывает маршруты `/internal/*`, не
  проходя `EngineServiceGuard`.
- `CREDENTIALS_MASTER_KEY` — оборачивает DEK, которыми шифруются учётные
  данные пользователя (ключи LLM, git-токены). С публичным значением по
  умолчанию любой расшифровывает весь архив. **Вне рамок здесь**: любой
  механизм ротации — он уже существует (`CREDENTIALS_MASTER_KEY_PREVIOUS` +
  `src/scripts/rewrap-deks.ts`) и не меняется; это только проверка при
  ЗАГРУЗКЕ.
- `SECRET_KEY_BASE` (engine) — уже ронял загрузку без переменной
  (`runtime.exs`, блок `:prod`, стандартный boilerplate Phoenix). Настоящим
  дефектом было не отсутствие проверки в Elixir, а то, что
  `docker-compose.prod.yml` подставлял публичный литерал как fallback, из-за
  чего переменная всегда приходила ЗАДАННОЙ и маскировала уже существовавший
  `raise`. Исправление здесь свелось к удалению fallback из compose — ни одна
  строка Elixir не изменилась.

Действует та же причина ADR 0059 отклонять литерал, а не только пустое
значение: `docker-compose.prod.yml` подставлял все четыре литерала как
fallback, так что на реальном пути ошибки переменные были **заданы** —
проверка «не пусто» прошла бы поверх всего дефекта.

- **Где:** `apps/api/src/infrastructure/security/auth-key-material.ts`
  (`passphraseAtual`), `apps/api/src/infrastructure/security/service-token.ts`
  (`tokenDeServicoAtual`) и
  `apps/api/src/infrastructure/security/envelope-encryption.service.ts`
  (`EnvelopeEncryptionService`, проверка в конструкторе) — первые два
  вызываются при загрузке в `apps/api/src/main.ts`, третий выполняется, когда
  `NestFactory.create` собирает граф провайдеров. `SECRET_KEY_BASE` в
  `apps/engine/config/runtime.exs` (неизменный) с fallback, удалённым из
  `docker/docker-compose.prod.yml`
- **Тест:** `apps/api/test/infrastructure/security/auth-key-material.spec.ts`,
  `apps/api/test/infrastructure/security/service-token.spec.ts` и describe
  `validação de produção` в
  `apps/api/test/infrastructure/security/envelope-encryption.service.spec.ts`
- **Источник:** [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md)

### RN-076 — Учётные данные git никогда не записываются в файл {#rn-076}

Engine работает с удалённым репозиторием, запрашивая у api **рабочий remote**
(`GET /internal/projects/:projectId/git-remote`), который возвращает **чистый**
origin и токен owner отдельно. Токен входит в вызов git через **окружение
дочернего процесса** и ни через что другое:

- **не в `origin`** — в `.git/config` записывается чистый URL;
- **не в argv** — `ps` показывает командную строку любого процесса;
- **не в файл** — ни сохранённый helper, ни `~/.git-credentials`.

Helper учётных данных передаётся через `-c`, действует только для этого
процесса и идёт после пустого `credential.helper=`: helpers накапливаются, и
побеждает первый ответивший, так что без предварительного обнуления вместо
него ответил бы helper хоста.

**Почему это правило, а не предпочтение.** Запись
`https://x-access-token:TOKEN@github.com/…` в `origin` — то, чему учит почти
каждый туториал, — сохраняет учётные данные открытым текстом **внутри папки
проекта**, ровно там, где [RN-075](#rn-075) даёт dev agent
**автоодобряемое** чтение. `cat .git/config` вернул бы токен без какого-либо
одобрения, и он ушёл бы провайдеру LLM в истории цикла. Область видимости
пути защищает от того, что агент читает ВНЕ проекта; она не может защитить от
секрета, который сам продукт положил ВНУТРЬ.

Учётные данные — это данные **owner workspace**, через тот же резолвер, что и
[RN-058](#rn-058), — два правила «чьи это учётные данные» разошлись бы.
Провайдер `local` не имеет токена и не обращается к api: он разрешается прямо
из базы, и это путь, который отрабатывают `pnpm dev` и весь набор тестов.

- **Где:** `apps/engine/lib/engine/actions/git_auth.ex`,
  `engine/projects/project_repository.ex` (`remoto_de_trabalho/1`),
  `apps/api/src/application/use-cases/git/get-project-git-remote.use-case.ts`
- **Тест:** `apps/engine/test/engine/actions/git_auth_test.exs` (токен не
  появляется ни в argv, ни в helper) и
  `apps/api/test/application/use-cases/git/get-project-git-remote.use-case.spec.ts`
  (возвращённый origin не содержит ни токена, ни `@`)
- **Источник:** [ADR 0056](../adr/0056-o-engine-trabalha-em-repositorio-remoto.md),
  находка N, Фаза B [backlog](../explanation/backlog.md)

### RN-077 — Источник сбоя всегда один из четырёх {#rn-077}

Каждый исход сбоя называет ИСТОЧНИК в **закрытом** словаре
[ADR 0020](../adr/0020-destravar-gates-qa-secops.md) —
`infra | modelo | codigo | politica`. Пятого значения нет: `null` и
`"indeterminada"` перестали быть возможными.

Две структурные гарантии, и ни одна не зависит от того, вспомнит ли кто-то:

- **У `AgentIo.block_task/4` нет значения по умолчанию для источника.** Он
  был «обязателен по духу», с `"indeterminada"` по умолчанию, — и самый
  дорогой исход реального исполнения вышел именно так, потому что место
  вызова ничего не передало. Без значения по умолчанию забывчивость
  становится ошибкой компиляции.
- **`FalhaDeTurno.origem/1` всегда возвращает одно из четырёх**, и есть
  табличный тест, который падает, если какая-либо запись — включая никогда
  не виданную форму — даст что-то другое.

**Почему `indeterminada` ушла.** У неё был разумный аргумент: не гадать
честнее, чем выбирать вслепую. Реальный эффект был обратным —
`indeterminada` **не указывает никакого действия**, и тот, кто разбирал
следующий раунд, начинал расследование с нуля. На деле она означала
*классификатор не распознал эту форму*, что является пробелом нашего кода:
`codigo` — источник, указывающий правильное действие (добавить недостающее
условие). Диагноз по-прежнему передаётся дословно, так что ничего не
теряется.

**Источники — не догадка.** Каждый исход ToolLoop говорит, кто решил
остановиться: `report_blocked` и потолок итераций принадлежат **модели** (она
решила или потратила, что было); бюджет и неодобренный PR — **политике** (это
было решение, ничего не сломалось); перезапуск и сбой сборки контекста —
**infra**; а когда есть `last_error`, источник берётся из ТОЙ ЖЕ ошибки, о
которой рассказывает диагноз, — именно эта пара противоречила себе, с
`diagnosis`, говорящим `{413, …}`, и `origem`, говорящим «indeterminada», в
одной строке.

- **Где:** `apps/engine/lib/engine/agents/falha_de_turno.ex`,
  `engine/dev/agent_io.ex` (`block_task/4`, без значения по умолчанию),
  `engine/dev/dev_agent_server.ex` (`origem_da_parada/1`)
- **Тест:** `apps/engine/test/engine/agents/falha_de_turno_test.exs`
  (`o vocabulário é fechado`) и
  `apps/engine/test/engine/dev/dev_agent_server_test.exs`, который утверждает
  источник в выпущенном событии
- **Источник:** находки P, Q и T из
  [achados-execucao-real.md](../explanation/achados-execucao-real.md), Фаза G
  [backlog](../explanation/backlog.md)

### RN-078 — Сбой защиты веток может быть признан, и только он {#rn-078}

`protect_branches` падает в приватном репозитории на бесплатном плане GitHub —
и мастер **предупреждает об этом до начала**. Пользователь может признать сбой
и продолжить; bootstrap закрывается, и проект становится достижимым.

**То, что это разблокирует, больше, чем кажется.** Единственной кнопкой,
предлагаемой после сбоя, была "Tentar novamente", которая падает всегда по
той же причине. А `provision_failed` заставляет панель **перенаправлять клик
по проекту обратно на страницу провизионирования** — проект оставался
недостижимым навсегда, застряв на шаге, у которого нет способа завершиться
успешно.

**Признать можно только защиту.** Это ПОСЛЕДНИЙ шаг и единственный, чей сбой
оставляет пригодный репозиторий: репозиторий существует, файлы закоммичены,
ветки созданы. Сбой создания репозитория или коммита — другое дело: там
«продолжить» дало бы проект, в котором негде работать, а кнопка была бы второй
ложью поверх первой. Отказ это говорит, а не просто отрицает.

**Гарантия продукта не меняется.** Блокировка merge
([RN-006](../business-rules.md#rn-006)) применяется в `decide.ts`, а не
защитой провайдера. Продолжение без неё убирает второй слой, слой GitHub, —
а не слой Brabo. Именно это делает этот выход честным, а не обходным путём.

Решение идёт в event log с **пользователем** как актором и исходной ошибкой в
payload: продолжение без защиты — его выбор, и тот, кто прочтёт потом, должен
знать, от чего именно отказались.

- **Где:** `apps/api/src/application/use-cases/git/acknowledge-protection-failure.use-case.ts`,
  маршрут в `interfaces/http/git/git.controller.ts`, кнопка в
  `apps/web/src/routes/ProvisioningPage.tsx`
- **Тест:** `apps/api/test/application/use-cases/git/acknowledge-protection-failure.use-case.spec.ts`
  (разблокирует; решение в логе с актором; и отказ для более раннего сбоя)
- **Источник:** находка D, Фаза D [backlog](../explanation/backlog.md)

### RN-079 — Psicólogo не анализирует сессию без анализируемых событий {#rn-079}

Прежде чем тратить ход модели, анализ спрашивает, есть ли что анализировать.
Если нет, он **не запускается**, и исходом становится
`psychologist.analysis_skipped`.

**Анализируемое исключает две вещи, по разным причинам:**

- **след самих аналитиков.** Psicólogo записывает свой ход в лог
  анализируемой сессии (`agent.response`, `tool.call`, `tool.result`,
  гипотеза). Его подсчёт заставил бы пустую сессию выглядеть заполненной **с
  первого анализа**, и каждая повторная попытка наполняла бы её больше —
  критерий больше никогда не проваливал бы. То же относится к Anamnese;
- **`bootstrap.*`**, то есть провизионирование репозитория, работающее
  самостоятельно: девять машинных шагов ничего не говорят о человеке.

Всё остальное считается, включая `proposed_action.*` — пользователь,
одобряющий и отклоняющий, не написав ни одного сообщения, **является**
поведением, урок, который Anamnese уже усвоила ([RN-063](#rn-063)).

**Это два подсчёта, и они не заменяют друг друга.** Сырой определяет объём
работы (сколько лога читать, а значит, какой уровень сортировки, лёгкий или
тяжёлый); анализируемый решает, есть ли работа. Их смешение и есть дефект:
сессия только с bootstrap проходила как «20 событий», не имея ни одного,
получала анализ, а модель — без чего-либо для цитирования — выдумывала
несуществующие `seq`, пока проверка доказательств не отклоняла и она не
сдавалась, с уже потраченным бюджетом.

**Пропуск действует и для ручной повторной обработки.** Повторная обработка
не фабрикует материал: тот, кто кликнул, получает причину в логе, а не
гипотезу, выдуманную о несуществующем логе.

Пропуск становится **событием**, в отличие от пропуска Anamnese, который лишь
лог: та запускается каждые 15 мин и стала бы шумом, этот запускается раз на
закрытие сессии, и отсутствующий анализ, о котором ничего не рассказано,
невозможно диагностировать.

- **Где:** `apps/engine/lib/engine/session_events/event.ex` (`count_analisaveis/1`),
  `apps/engine/lib/engine/psychologist/triage.ex` (`should_run?/1`),
  `apps/engine/lib/engine/workers/psychologist_worker.ex`
- **Тест:** `apps/engine/test/engine/session_events/event_analisaveis_test.exs`
  (включает воспроизведение сессии из находки: 14 событий, ни одного
  анализируемого),
  `apps/engine/test/engine/workers/psychologist_worker_test.exs`
- **Источник:** находка J, Фаза E [backlog](../explanation/backlog.md)

### RN-080 — Дублирующее бизнес-правило отклоняется на входе {#rn-080}

`business_rule`, заголовок которого уже существует **в проекте**, не
записывается. Отказ возвращается модели тем же путём, что и недопустимый
payload, и она переходит к следующему правилу вместо остановки.

**На входе, потому что другого места нет.** Таблицы правил не существует:
артефакт И ЕСТЬ событие `artifact.business_rule`, а доменное событие не
удаляется и не редактируется. Впустить — значит жить с дубликатом вечно.

**Область видимости — проект, а не сессия**: дубликат рождается между
сессиями. Повторный запуск Criativo открывает новую сессию, и проверка по
сессии не увидела бы предыдущий раунд — а это ровно случай из находки.

Сравнение нормализует регистр, диакритику и лишние пробелы; пунктуация
остаётся. **Семантический дубликат по-прежнему проходит, и это объявлено, а
не забыто:** "Saudação com nome" и "Quem chama pode se identificar"
остаются двумя правилами, потому что их разделение — суждение, и оно не
помещается в `if`.
Начиная с [RN-681](#rn-681) семантический дубликат ЗАГОЛОВКА
**предупреждается** через embedding после записи — по-прежнему проходит,
никогда не отклоняется здесь.

- **Где:** `apps/engine/lib/engine/harness/artifact_dedupe.ex`,
  `apps/engine/lib/engine/harness/tools/emit_artifact.ex`,
  `apps/engine/lib/engine/session_events/event.ex` (`titulos_de_regras/1`)
- **Тест:** `apps/engine/test/engine/harness/artifact_dedupe_test.exs`,
  `apps/engine/test/engine/harness/emit_artifact_dedupe_test.exs`
- **Источник:** находка K, Фаза E [backlog](../explanation/backlog.md)

### RN-081 — Повторная история: одинаковый заголовок отклоняется, одинаковое обоснование предупреждает {#rn-081}

Два разных ответа на две разные проблемы:

- **идентичный заголовок** в проекте — ошибка, а не выбор: история
  **отклоняется**, и ничего не создаётся;
- **то же обоснование** — все бизнес-правила, на которые ссылается история,
  уже покрыты другой, — подозрение, а не ошибка. История **создаётся**, и
  выпускается `backlog.story_overlap_warned`. Второй срез того же правила
  может быть легитимным, поэтому судит пользователь; продукт лишь
  отказывается дать этому пройти незамеченным.

**Включение, а не пересечение.** Совместное использование правила двумя
историями нормально, и предупреждение об этом стало бы шумом, который никто
не читает. Сигнал существует, только когда новая не добавляет никакого
покрытия. История, не ссылающаяся ни на одно правило, не порождает
предупреждения: трактовка пустого множества как подмножества всего обвинила
бы всех.

**Предел тот же, что у [RN-080](#rn-080), и пара из находки его
пересекает:** "Endpoint público de saudação determinística" и "Endpoint
público GET /hello que responde saudação imediata" покрывают один endpoint с
разными заголовками и обоснованиями — ничто механическое их не связывает, и
они по-прежнему проходят. Есть тест, утверждающий это, чтобы предел был
видимым, а не неявным.
Начиная с [RN-681](#rn-681) пара ПРЕДУПРЕЖДАЕТСЯ через embedding — по-прежнему
проходит, и тест, утверждающий предел ЭТОГО механизма, остаётся в силе.

- **Где:** `apps/api/src/domain/backlog/story-overlap.ts`,
  `apps/api/src/application/use-cases/backlog/create-story.use-case.ts`
- **Тест:** `apps/api/test/domain/backlog/story-overlap.spec.ts`,
  `apps/api/test/application/use-cases/backlog/create-story.use-case.spec.ts`
- **Источник:** находка R, Фаза E [backlog](../explanation/backlog.md)

### RN-082 — Учётные данные git для действия — это данные OWNER workspace {#rn-082}

Когда api выполняет действие git против удалённого провайдера (`pr_open`,
`git_merge`), токен берётся у **owner workspace** — тем же резолвером, что и
[RN-058](#rn-058), а не у того, кто решил действие.

**Разрешение по решившему работало только с человеческим кликом.** У
действия, автоодобренного политикой, нет решившего: `decided_by` остаётся
`NULL`, токен остаётся `undefined`, и GitHub отвечает `Requires
authentication`. На практике при включённой автономии — режиме, ради
которого существует ADR 0055, — **ни один dev agent не мог открыть PR у
удалённого провайдера**.

**Контраст, вскрывший дефект**, случился внутри одного исполнения: в одном и
том же прогоне `git_push` прошёл, а `pr_open` упал. Push выполняется ENGINE,
который уже внедрял учётные данные owner ([RN-076](#rn-076)); PR открывается
API, которая была вне симметрии.

Это не проявлялось раньше, потому что все предыдущие проверки использовали
`LocalGitProvider`, где токен даже не запрашивается.

Принцип тот же, что у RN-058, и его стоит повторить, потому что именно он не
даёт двум правилам разойтись со временем: **кто оплачивает счёт, оплачивает
агентов**, и это не меняется в зависимости от того, кто кликает. Поэтому
резолвер ПЕРЕИСПОЛЬЗУЕТСЯ, а не реализуется заново.

- **Где:** `apps/api/src/application/use-cases/actions/execute-git-action.use-case.ts`,
  переиспользуя `application/use-cases/llm/resolve-credential-owner.use-case.ts`
- **Тест:** `apps/api/test/application/use-cases/actions/execute-git-action.use-case.spec.ts`
  (автоодобренный `pr_open` с `decidedBy: null` запрашивает учётные данные
  owner)
- **Источник:** находка AA, [реальная проверка 13b](../explanation/validacao-real.md)

### RN-083 — Lead решает параллелизм; выше потолка разрешаете вы {#rn-083}

Сколько агентов поднимается, перестаёт быть числом в коде: оценивает **lead
области**. Но его решение не суверенно в отношении РАСХОДОВ — до
`agent_areas.max_parallel` (по умолчанию **2**) он поднимает и продолжает;
**выше этого становится `proposed_action` типа `parallelize`**, через тот же
конвейер, что и любое действие с внешним эффектом.

**Потолок — на СЕССИЮ, а не на модуль.** Это единственная неочевидная часть
правила и та, которую невнимательный рефакторинг отменяет: подсчёт по модулю
позволил бы N модулей × 2 агента без какого-либо разрешения — прежняя дыра
под другим именем. Есть тест, утверждающий ровно это.

**Нулевой или отрицательный потолок — недопустимая конфигурация, а не «без
ограничения».** Трактовка его как неограниченного превратила бы опечатку в
неограниченный расход — противоположность тому, для чего существует
конвейер.

**ПРОСИТ lead; РЕШАЕТЕ вы.** `proposed_action` рождается с lead как актором,
а решение остаётся в event log с вашим именем — именно это различие делает
историю восстановимой потом
([ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md)).

Причина путешествует в НЕИЗМЕНЯЕМОМ payload, с тремя числами (сколько есть,
сколько просит, каков потолок): тот, кто прочтёт через полгода, должен понять,
что было разрешено, не восстанавливая состояние сессии.

`AcceptParallelizationUseCase` не меняется: он по-прежнему ИСПОЛНЯЕТ — как на
прямом пути, так и когда действие одобрено. Поглощение его изнутри, а не
переписывание, — то, что сохраняет набор тестов Фазы 4 зелёным без изменений,
— это доказательство того, что замена не просочилась во внешний контракт.

**Потолок настраивается по области, и только вами.** `PATCH
/projects/:projectId/agent-areas/:key/max-parallel` требует `maintainer` — ту
же роль, что для активации исполнения, и по той же причине: изменение потолка —
это решение о том, сколько продукт может тратить без спроса. Автоматического
пути его поднять не существует. Anamnese может ПРЕДЛОЖИТЬ, когда заметит, что
разрешение стало рутиной, и предложение по-прежнему проходит через этот
маршрут после того, как вы его примете, — продукт, поднимающий собственный
потолок расходов, — ровно то, чему конвейер одобрения существует, чтобы
помешать.

Изменение потолка действует для СЛЕДУЮЩИХ запросов. То, что уже ждёт решения,
продолжает ждать: действие несёт в payload потолок, действовавший при его
создании, а его переинтерпретация под новым потолком изменила бы то, что вы
собираетесь решить, уже прочитав.

- **Где:** `apps/api/src/domain/execution/paralelismo.ts` (чистое правило),
  `application/use-cases/execution/request-parallelization.use-case.ts`,
  `application/use-cases/execution/set-area-max-parallel.use-case.ts`,
  раскрыто в `interfaces/http/execution/execution.controller.ts` и
  настраивается в `apps/web/src/routes/settings/ParallelismSection.tsx`
- **Тест:** `apps/api/test/domain/execution/paralelismo.spec.ts`,
  `test/application/use-cases/execution/request-parallelization.use-case.spec.ts`,
  `test/application/use-cases/execution/set-area-max-parallel.use-case.spec.ts`
  и `apps/web/src/routes/ProjectSettingsTab.test.tsx` (`ParallelismSection`)
- **Gate:** `docs/gates.yml` (`paralelismo-autorizado`) — `status: active`
  начиная с аудита fluxo.yml × код (находка A1/B5); сам механизм не менялся,
  только запись, которая по ошибке оставалась `planned` с ФАЗЫ 14d, см.
  [gates.md](../explanation/gates.md#a-registry-can-age-in-the-wrong-direction--stale-not-inactive)
- **Источник:** [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md), ФАЗА 14d

### RN-094 — Область агентов рождается вместе с проектом {#rn-094}

Создание проекта записывает три области (`dev`, `qa`, `infra`) в
`agent_areas`, с lead каждой и **перечислимыми** участниками в
`agent_area_members` — в ТОЙ ЖЕ транзакции, что и создание. Если засев
падает, проект не рождается: проект без области — это проект, где RN-083
читает пустую таблицу и падает на значение по умолчанию, хотя никто ничего не
решал.

**Это исправление дефекта, а не новая возможность.** `agent_areas` существует
с ФАЗЫ 14d и никогда не записывалась — у `AgentAreaRepository.upsert` был тест
и не было НИ ОДНОГО вызывающего. В production таблица была пустой,
`GET /projects/:projectId/agent-areas` возвращал `[]`, а четыре сценария
использования, которые её читают, работали над пустотой. Это тот же провал,
что и в самой ФАЗЕ 14d, записанный в CLAUDE.md: **тестировать деталь — не то
же, что тестировать путь к ней**. Поэтому тест этого правила входит через
сценарий использования, который вызывает маршрут, с реальным репозиторием:
fake здесь доказал бы ровно то, что уже было доказано и сломано.

**Засевается в ДВУХ местах, и каждое отвечает на свой вопрос.** Создание
проекта делает область СУЩЕСТВУЮЩЕЙ — экран Configurações читает в проекте,
который никогда не исполнялся. Активация исполнения говорит, кто УЧАСТНИКИ
области `dev`: один `dev-<modulo>` на модуль `module_map`, которого не было,
когда проект родился. Пока записанных участников нет, правило адресации
(RN-087) поддерживает предикат `ehDevDeModulo`, который не обращается к базе.

**Засев никогда не отправляет `max_parallel`.** Активация повторяема, и
отправка значения по умолчанию заставила бы потолок, который вы подняли до 5,
молча вернуться к 2 — продукт, отменяющий ваше решение. То же касается
миграции backfill: она делает область существующей и на этом
останавливается.

Проекты, созданные до этого, покрываются миграцией `0038`, с `ON
CONFLICT DO NOTHING` в обеих таблицах. Без неё дефект был бы исправлен только
для тех, кто начинает с нуля.

- **Где:**
  `apps/api/src/application/use-cases/agents/seed-agent-areas.use-case.ts`,
  вызывается `application/use-cases/iam/create-project.use-case.ts` и
  `application/use-cases/execution/activate-execution.use-case.ts`;
  канонический список в `apps/api/src/domain/agents/agent-areas.ts`;
  backfill в `apps/api/src/db/migrations/0038_wandering_lila_cheney.sql`
- **Тест:**
  `test/application/use-cases/iam/create-project-semeia-areas.spec.ts` (путь,
  против базы, включая сбой, роняющий создание),
  `test/db/agent-areas-backfill.spec.ts` (миграция, выполненная по-настоящему,
  дважды) и `test/application/use-cases/execution/activate-execution.use-case.spec.ts`
  (участники dev и никогда не отправляемый потолок)
- **Источник:** ФАЗА 18, дефект, найденный при исследовании программы 16–26;
  таблица — из [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md)

### RN-910 — Потолок по умолчанию для области — 5 в dev, 4 в qa и 2 в infra {#rn-910}

Каждая область агентов рождается с потолком параллелизма, который берётся из каталога:
`dev` 5, `qa` 4, `infra` 2 (AT-599, просьба владельца от 22/10). Миграция `0073`
применила те же значения ко **всем** существующим проектам, перезаписав то, что уже было
решено — решение владельца, принятое с пониманием того, что потолок, заданный намеренно, теряется.

- **Сейчас при выполнении применяется только потолок `dev`.** `RequestParallelizationUseCase`
  читает область `dev` при решении о параллелизме. У `qa` и `infra` значение записано, показано
  и редактируется, но ни один код его не читает: повышение их потолка не меняет выполнение вообще.
- **Потолок `dev` действует только при 3 модулях и более.** Максимум dev-агентов — один на модуль
  плюс один дополнительный (`dev-<modulo>-2`), то есть 2 × модули (RN-083). При 2 модулях
  максимум равен 4, что меньше 5.
- **Только INSERT использует значение из каталога.** Повторный посев не трогает строку
  (RN-094). Колонка остаётся `default(2)`: это значение появляется только в сыром INSERT,
  вне сценария использования.
- **Где:** `apps/api/src/domain/agents/agent-areas.ts:73` (`maxParallelPadrao`);
  `apps/api/src/application/use-cases/agents/seed-agent-areas.use-case.ts:53`
  (`maxParallelAoNascer`); `apps/api/src/infrastructure/persistence/drizzle/agent-area.repository.ts:62`
  (`nascer`); `apps/api/src/application/use-cases/execution/request-parallelization.use-case.ts:13`
  (`MAX_PARALLEL_PADRAO`); миграция `apps/api/src/db/migrations/0073_paralelismo_padrao_por_area.sql`.
- **Тест:** `test/application/use-cases/iam/create-project-semeia-areas.spec.ts`
  (новый проект рождается с 5/4/2), `test/infrastructure/persistence/drizzle/agent-area.repository.spec.ts`
  (повторный посев не отменяет изменённый потолок), `test/db/paralelismo-padrao-migration.spec.ts`
  (строки с 2, 3 и 7 заканчиваются на 5/4/2) и `test/application/use-cases/execution/request-parallelization.use-case.spec.ts`
  (значение по умолчанию 5 решает параллелизм dev).

### RN-084 — Отображаемый конвейер выводится из реестра gates {#rn-084}

Панель команды показывает этап, на котором находится PR, **выводя его из
`docs/gates.yml`**, а не из списка, написанного на экране. Gate, ушедший из
реестра, исчезает из конвейера; gate `planned` никогда не появляется.

**Правило существует из-за конкретной формы старения.** До ФАЗЫ 15b у экрана
этапы были зашиты в компонент, а реестр (ФАЗА 15a) описывал gates в другом
месте. Ничто их не связывало: добавление gate в YAML не меняло экран, а
удаление оставляло экран показывать этап, которого уже не существовало, — без
падения какого-либо теста, потому что оба источника были верны каждый сам по
себе. Это та же гниль, которую `docs/.docmap.yml` существует, чтобы
предотвращать, и ответ тот же: один источник, с проверяемым потреблением.

Три граничных решения, все для того, чтобы экран **деградировал**, а не
исчезал:

- gate PR, который экран ещё не умеет рисовать, **игнорируется**, не ломая
  рендер, — реестр может получить gate раньше, чем экран получит метку;
- **метки — экранные**, а не из реестра: YAML описывает инженерию, а экран
  говорит с тем, кто ждёт PR;
- **без реестра** (маршрут упал) показывает полный конвейер, а не пустой —
  общий конвейер информирует больше, чем ничего.

- **Где:** `apps/web/src/components/PrGateTimeline.tsx` (`etapasDaEsteira`),
  читающий `GET /gates` (`apps/api/src/interfaces/http/gates/gates.controller.ts`)
- **Тест:** `apps/web/src/components/PrGateTimeline.test.ts`
  (`gate que SAI do registro some da tela`, `gate de PR que a tela ainda não
  sabe desenhar é IGNORADO`, `sem registro, mostra a esteira completa`)
- **Источник:** [ADR 0054](../adr/0054-gates-como-registro-declarativo.md), ФАЗА 15b

### RN-085 — Потолок итераций зависит от ТИПА агента {#rn-085}

Сколько кругов агент может сделать в цикле инструментов, зависит от работы,
которую он выполняет: **8** для того, кто разговаривает, **60** для dev agent
и подагентов QA. Единого числа больше нет.

**Потолок 8 родился у разговорного агента и был унаследован теми, кто
работает.** При реальной проверке 13b это проявилось как блокировка: dev agent
потратил восемь кругов, исследуя только что провизионированный репозиторий, и
**так и не написал ни одного файла**; с 25 он написал три и запустил тесты.
Зарегистрированным исходом было `limite de iterações atingido` с источником
`modelo` — технически правда и практически бесполезно, потому что модель так
и не дошла до того, чтобы что-либо оценить.

**Поднять глобальное значение по умолчанию было бы неверным исправлением**, и
именно от этого защищает правило: Criativo не нужно 60 кругов, чтобы
разговаривать, а потолок — также замок против бесконечного цикла.

**Поднимать может не «тот, кто много работает», а тот, у кого внизу есть
замок расходов.** Потолок итераций защищает от бесконечного цикла; КОШЕЛЁК
защищает `token_budget_micros`. Dev agents и подагенты QA работают с
`task_budget_micros` задачи, так что ослабление кругов не ослабляет счёт.
`infra-workflows` использует тяжёлый инструмент и всё равно **остаётся на 8**:
он работает без бюджета, и для него потолок — единственный существующий
замок.

Два граничных случая с собственным тестом:

- **`dev-lead` — разговорный**, несмотря на префикс `dev-`, обозначающий dev
  agents (`dev-<modulo>`, `dev-<modulo>-2`). Lead решает и делегирует, и без
  явного условия он рождался бы с потолком тяжёлой работы по случайности
  именования.
- **Неизвестный агент попадает на самый низкий потолок.** Ошибаться в
  дешёвую сторону: тот, кому нужно больше кругов, проявляется как `limite de
  iterações atingido` и исправляется; тот, кто получает 60 по ошибке, тратит
  молча.

- **Где:** `apps/engine/lib/engine/harness/iteracoes.ex`, применяется в
  `apps/engine/lib/engine/harness/tool_loop.ex` (`init/1`)
- **Тест:** `apps/engine/test/engine/harness/iteracoes_test.exs` и
  `apps/engine/test/engine/harness/tool_loop_test.exs`
  (`o teto vem do TIPO do agente quando o chamador não passa um`,
  `teto explícito do chamador VENCE o do tipo`)
- **Источник:** находка X, [реальная проверка 13b](../explanation/validacao-real.md);
  [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md), ФАЗА 14d

### RN-086 — Расход на дополнительных агентов никогда не автоодобряется {#rn-086}

Два действия, затрагивающие **то, сколько продукт может тратить сам**, —
`parallelize` (превысить потолок сейчас) и `raise_max_parallel` (изменить
потолок), — никогда не автоодобряются. Ни через `agent_autonomy`, ни через
`permissions.json`. Это тот же класс гарантии, что блокировка merge и потолок
патча инструкции.

**Без этого потолок [RN-083](#rn-083) был бы декоративным.** `permissions.json`
с `Parallelize()` в `allow` заставил бы каждое превышение одобрять себя
само — правило, существующее, чтобы ТРЕБОВАТЬ решения пользователя, начало бы
от него освобождать. А `raise_max_parallel` — самый тяжёлый случай: это был бы
продукт, поднимающий собственный лимит расходов, ровно то, чему конвейер
одобрения существует, чтобы помешать.

**Anamnese может ПРЕДЛОЖИТЬ, и именно это она делает.** Когда разрешение ещё
одного агента становится рутиной, потолок неверен, и первым это замечает тот,
кто читает историю. Сигнал уже доходил до неё: решения пользователя в окне
приходят из `proposed_actions`, с `actionType` и `status`.

Порог — **три одобрения и ни одного отказа**, и обе половины важны:

- **два — это не рутина, это два.** Три — то, что отделяет «случилось» от
  «случается всегда»;
- **один отказ обрушивает весь сигнал**, сколько бы ни было одобрений. Если
  пользователь хоть раз отказал, потолок делает свою работу, и предложение его
  поднять было бы прочтением сигнала наоборот.

Предложение потолка, **равного или меньшего** действующего, отклоняется api:
Anamnese работает периодически и предлагала бы одно и то же каждый раунд,
наполняя шумом очередь, которую пользователю нужно читать.

Одобрение применяет значение из **payload**, а не пересчитанное в моменте, —
это число, которое вы прочитали, принимая решение.

- **Где:** `apps/api/src/domain/actions/decide.ts` (потолок),
  `application/use-cases/execution/propose-max-parallel.use-case.ts`,
  `execute-max-parallel-raise.use-case.ts`,
  `apps/engine/lib/engine/anamnese/tools/propose_max_parallel.ex` и порог в
  `apps/engine/lib/engine/workers/anamnese_worker.ex` (`nota_de_paralelismo/1`)
- **Тест:** `apps/api/test/domain/actions/decide.spec.ts`
  (`decide — teto do paralelismo`),
  `test/application/use-cases/execution/propose-max-parallel.use-case.spec.ts`,
  `execute-max-parallel-raise.use-case.spec.ts`,
  `apps/engine/test/engine/anamnese/tools_test.exs` и
  `test/engine/workers/anamnese_worker_test.exs` (`duas aprovacoes NAO sao
  rotina`, `uma NEGACAO derruba o sinal`)
- **Источник:** [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md), ФАЗА 14d

### RN-087 — Dev Lead — единственный внешний адрес исполнения {#rn-087}

Существует агент `dev-lead`, разговорный, который получает handoff от
Arquiteto (начиная с [RN-672](../business-rules.md#rn-672) — от Infra, с
контейнером проекта в `running`) и предлагает **план исполнения**: сколько
агентов на модуль и почему. Он не пишет код — он распределяет работу и
отвечает за неё.

**До него фраза «решает lead» из [RN-083](#rn-083) не имела владельца.**
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

**План — это `proposed_action` (пересмотрено [ADR 0086](../adr/0086-dev-lead-plano-suspende-para-aprovacao.md), [RN-284](../business-rules.md#rn-284)).**
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

### RN-064 — Heartbeat не закрывает сессию с незавершённой работой {#rn-064}

> **Расширено [RN-581](../business-rules.md#rn-581) (AT-072):** разговорный
> агент, ждущий пользователя, стал ПЯТЫМ сигналом, и единственным с потолком
> (8h, причина `conversation_idle_timeout`); ответ получил
> `aguardandoUsuarioDesde`. Остальная часть правила действует как есть.

Timeout heartbeat измеряет бездействие **вкладки**, а не **работы**. Прежде
чем закрыть, `SessionServer` спрашивает api, осталась ли работа
(`GET /internal/sessions/:id/pending-work`); если да, он перепланирует timeout
и записывает причину в лог, вместо того чтобы убить сессию.

По умолчанию — **30 секунд**. Уйти из сессии на вкладку Backlog уже было
достаточно, чтобы её убить, — и при реальном исполнении это заперло handoff
`offered` для Arquiteto внутри закрытой сессии: эпик и четыре истории готовы, а
цепочке некуда идти, потому что нет места, где принять handoff мёртвой сессии.

Закрытие сессии — о том, что работа закончилась, а не о том, кто смотрит.

**Недоступная api НЕ мешает закрытию**: `{:error, _}` всё равно закрывает, с
предупреждением в логе. Обменять осиротевшую сессию на бессмертную значило
бы обменять один дефект на другой.

«Незавершённая работа» — это **три** сигнала: второй вошёл по находке V,
третий — по реальному багу Criativo→PO→Arquiteto:

1. **handoff `offered`** — исходный случай выше;
2. **`proposed_action` со статусом `pending`** — кто-то ждёт ВАШЕГО решения, и
   агент может быть приостановлен в ожидании исхода ([RN-073](#rn-073));
3. **АКТИВИРОВАННЫЙ агент всё ещё в ходе** — последний `agent.status` каждого
   актора, уже говорившего в сессии, — `working` без последующего `idle`.

Второй — тот же дефект, что первый, уровнем ниже, и исполнение `hello-limpo`
показало цену: сессия родилась в 23:34:12, действие стало `pending` в
23:34:13, а heartbeat закрыл её в **23:34:42 — ровно через 30s timeout**. Dev
agent продолжал работать больше часа в сессии, которую база считала закрытой,
и это отравляет каждую метрику по сессии: длительность, стоимость и «сколько
закончились хорошо» начинают читать состояние, не описывающее того, что
произошло.

Третий — то же окно, на шаг раньше, чем появляется любой из первых двух:
`AcceptHandoffUseCase` помечает старый handoff как `accepted` и сразу
активирует следующего агента, но активация в engine — это `GenServer.cast`
fire-and-forget — отвечает 201 до того, как агент вообще начнёт. PO,
активированный handoff от Criativo, выполняет kickoff до 12 итераций LLM,
используя только инструменты `category: :direct`
(`create_epic`/`create_story`/`create_task`), которые никогда не порождают
`proposed_action`, и предлагает следующий handoff (сигнал 1) только в КОНЦЕ
всего хода. Между активацией и этим концом не существовало ни сигнала 1, ни
сигнала 2 — сессию удерживал только ping канала Phoenix каждые 10s, и любая
задержка больше 30s timeout закрывала сессию, пока PO ещё генерировал
backlog, ломая цепочку handoff под корень: следующий handoff в итоге
предлагался в уже `closed` сессии, которая больше ничего не принимает.

`agent.status` (`working`/`idle`) — то, что каждый разговорный агент
(Criativo/PO/Arquiteto/Dev Lead/Infra) уже описывает на границах хода, и он
СОХРАНЯЕТСЯ в event log, а не только транслируется в канал
(`Engine.Sessions.LiveBroadcast.agent_status/4`, [ADR 0021](../adr/0021-fechamento-4a-infra-e-painel.md))
— тот же сигнал, который панель команды уже читает, чтобы вывести roster
(`conversationalStatus` в `apps/web/src/lib/agent-status.ts`). Его
переиспользование здесь не потребовало никакого нового события: третий
сигнал — последний `agent.status` КАЖДОГО актора, уже говорившего в сессии, и
он общий по типу события — покрывает любого агента, активированного через
handoff, а не только PO.

Предыдущая версия этого правила письменно говорила, что включение работы
агента «без теста, доказывающего взаимодействие, было бы гаданием».
Исполнение дало доказательство, и тест теперь существует.

**Что остаётся вне:** задача `in_progress` без ожидающего действия, handoff
или открытого хода. У dev agent собственная машина состояний, и он удерживает
worktree сам; сигнал, которым владеет api и который подтвердило исполнение, —
ожидающее действие. Включение задачи потребовало бы, чтобы api читала
`dev_agent_states`, принадлежащую engine, — решение о границе, а не
исправление мимоходом. Dev agents также не выпускают `agent.status`
(работают с собственной машиной состояний, а не с разговорным циклом хода) —
третий сигнал их не покрывает, и не нужно: их путь уже покрывает ожидающее
действие.

- **Где:** `apps/api/src/application/use-cases/sessions/get-session-pending-work.use-case.ts`,
  `apps/api/src/application/ports/session-event-repository.port.ts`
  (`listByTypeInSession`), `apps/engine/lib/engine/sessions/session_server.ex`
  (`handle_info(:heartbeat_timeout, …)`)
- **Тест:** `apps/engine/test/engine/sessions/session_lifecycle_test.exs`
  (`heartbeat NÃO encerra sessão com trabalho pendente` и противоположный
  случай) и
  `apps/api/test/application/use-cases/sessions/get-session-pending-work.use-case.spec.ts`
  (три сигнала, уже решённое действие, которое НЕ удерживает, `idle`, который
  освобождает, изоляция по актору, общность по типу агента и область по
  сессии)
- **Источник:** реальное исполнение ФАЗЫ 13b; находка V, Фаза H
  [backlog](../explanation/backlog.md); реальный баг цепочки
  Criativo→PO→Arquiteto

### RN-063 — Завершение без производства — исход, а не сбой {#rn-063}

У Anamnese есть инструмент, чтобы сказать **«выпускать нечего, и вот
причина»** (`skip_proficiency`). Раунд завершается `anamnese.run_skipped` с
причиной в payload — никогда `anamnese.run_failed`.

Раньше у неё не было этого глагола. Единственным инструментом был
`emit_proficiency`, который отклоняет пустой список (и справедливо: пустой
профиль — не профиль). В окне без подходящего участника Anamnese обнаруживала
это на ПЕРВОЙ итерации, писала прозой «нет подходящих участников», вызывала
`emit_proficiency` с `profiles: []`, получала отказ — и повторяла до потолка
итераций. Каждый круг заново отправляет историю, которая растёт с каждым
кругом.

При реальном исполнении это стоило **145 тысяч входных токенов и 4× расход
Criativo и PO вместе взятых**, ничего не произведя. И возвращалось на каждом
тике планировщика, каждые 15 минут, навсегда.

Потолок итераций работал — это не был бесконечный цикл. Растрата была **на
раунд, повторяемая бесконечно**, что хуже: цикл заклинивает, и кто-то
замечает; это кровотечение шло медленно.

Описывать `run_failed` для раунда, сделавшего правильное, — тоже дефект: тот,
кто читает лог, учится игнорировать событие сбоя.

- **Где:** `apps/engine/lib/engine/anamnese/tools/skip_proficiency.ex`,
  `apps/engine/lib/engine/anamnese/hooks/termination.ex`,
  `apps/engine/lib/engine/workers/anamnese_worker.ex` (`handle_outcome`)
- **Тест:** `apps/engine/test/engine/workers/anamnese_worker_test.exs`
  (`encerrar sem perfis é DESFECHO: narra run_skipped com o motivo, não falha`)
- **Источник:** реальное исполнение ФАЗЫ 13b

### RN-062 — Сообщение разговорному агенту РЕГИДРАТИРУЕТ процесс {#rn-062}

Сообщение, адресованное Criativo, PO или Arquiteto, поднимает процесс, если
он не запущен, до доставки. `init` каждого сервера уже восстанавливает историю
из event log; не хватало того, кто бы его вызвал.

Раньше перезапуск engine молча убивал разговор: сессия выживала как `active`,
процесс агента — нет, и следующее сообщение умирало с
`GenServer.call ... exited` — без события, без ошибки на экране, без чего-либо.
Пользователь видел, как появляется его собственное сообщение, и никакой
ответ не приходил, навсегда.

Комментарий `revise/2` говорил, что мёртвый агент на этом маршруте — «это
баг». Так и есть — и достаточно перезапуска engine, чтобы это случилось. Это та
же гарантия, что Фаза 12b дала dev agents, применённая к разговорным.

- **Где:** `apps/engine/lib/engine_web/controllers/agent_command_controller.ex`
  (`message/2`)
- **Тест:** покрыто набором тестов агентов; доказательство исполнения — в
  docs/explanation/validacao-real.md
- **Источник:** реальное исполнение ФАЗЫ 13b

### RN-060 — Расход по ключам принадлежит owner, и видит его только он {#rn-060}

Отчёт о потреблении по учётным данным (`GET /workspaces/:id/credential-spend`)
требует **`owner`** в workspace. Не `maintainer`: начиная с
[RN-058](#rn-058) агенты всех проектов тратят учётные данные владельца, и его
счёт — не дело того, кто лишь управляет проектом.

Отчёт группирует по **провайдеру**, потому что это единица учётных данных —
один ключ на провайдера, на человека. Единый итог не сошёлся бы со счётом
ни с каким.

И он отделяет **агента** от **человека**: обе вещи расходуются с одного ключа
начиная с RN-058, и «мои агенты дорогие?» — вопрос, отличный от «я много
пользуюсь чатом?». Поэтому это единственный агрегат стоимости продукта **без**
фильтра `actor_kind = 'agent'` из [RN-038](#rn-038) — здесь вопрос в том,
сколько ушло с ключа, а чат самого owner расходует его.

Расход **уже удалённых** учётных данных остаётся в отчёте, помеченный:
потребление произошло, и его сокрытие дало бы итог, не сходящийся с выпиской
провайдера.

Ни один секрет не пересекает границу: ответ содержит провайдера, токены и
стоимость — никогда ключ, даже зашифрованный
([ADR 0050](../adr/0050-credencial-sempre-cifrada-verificacao-explicita.md)).

- **Где:**
  `apps/api/src/application/use-cases/llm/get-credential-spend.use-case.ts`,
  `apps/api/src/interfaces/http/llm/budgets.controller.ts`,
  `apps/web/src/components/CredentialSpendSection.tsx`
- **Тест:** `test/application/use-cases/llm/get-credential-spend.use-case.spec.ts`
  (группирует по провайдеру; отделяет агента от человека; удалённый ключ
  остаётся помеченным);
  `apps/web/src/components/CredentialSpendSection.test.tsx`
- **Источник:** решение пользователя вместе с RN-058

### RN-101 — Один расход, две аудитории: счёт принадлежит owner, потребление — тому, кто потратил {#rn-101}

Продукт отвечает на **два разных вопроса** о `token_usage`, и ни один не
является срезом другого.

**Вопрос owner — по УЧЁТНЫМ ДАННЫМ.** `GET /workspaces/:id/credential-spend`
остаётся таким, каким его оставила [RN-060](#rn-060), — по провайдеру, требуя
`owner`, отвечая на «сколько ушло с моего ключа». Рядом с ним
`GET /workspaces/:id/spend-report` (тоже `owner`) разбивает workspace по
**модели, провайдеру, проекту, актору и дню** — ось провайдера вошла по
[RN-186](#rn-186). Owner видит оба, потому что он единственный, кто может
видеть оба.

**Вопрос участника — по АКТОРУ.** `GET /projects/:id/spend/me` (роль `viewer`)
возвращает, в токенах и **оценочной** стоимости, то, что **вызвавший**
потребил в этом проекте, по сессии и по дню. Он **не разбивает ни по
провайдеру, ни по учётным данным** — работал ключ owner ([RN-058](#rn-058)), и
доля его счёта — не то, о чём спрашивает участник.

Актор **не является параметром**: он берётся из аутентифицированного
пользователя, и нет места, куда вписать id другого человека. «Участник не
видит строку другого актора» — свойство сигнатуры сценария использования, а не
проверка, которую кто-то может забыть вызвать.

**Агент не входит в счёт участника.** `token_usage` регистрирует, кто
ПОТРАТИЛ, а не кто велел потратить; приписывать агента тому, кто его
запустил, значило бы выдумывать данные, которых в таблице нет. Расход агента
появляется в отчёте owner, которому принадлежит ключ.

**Ось `provider` существует, и участник до неё не дотягивается.** До
[ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md) её просто
не было в агрегации, и именно отсутствие ограничивало представление
участника. Сегодня у `sumGroupedBy` шесть измерений (`model`, `provider`,
`project`, `actor`, `session`, `day`), и ограничение сменило форму, а не силу:
ограничивает ТИП — см. [RN-186](#rn-186) и [RN-187](#rn-187). Не изменилось то,
что два провайдера, обслуживающие одно имя модели, по-прежнему попадают в
одну строку измерения `model`.

- **Где:**
  `apps/api/src/application/use-cases/llm/get-my-spend.use-case.ts`,
  `apps/api/src/application/use-cases/llm/get-workspace-spend-report.use-case.ts`,
  `apps/api/src/application/ports/token-usage-repository.port.ts`,
  `apps/api/src/interfaces/http/llm/spend.controller.ts`,
  `apps/web/src/routes/ProjectSpendTab.tsx`
- **Тест:** `apps/api/test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  (участник не видит строку другого актора, ни агента, ни owner; фильтр — по
  паре `(kind, id)`; ответ не несёт провайдера);
  `apps/web/src/routes/ProjectSpendTab.test.tsx`
- **Источник:** [ADR 0063](../adr/0063-duas-audiencias-para-o-mesmo-gasto.md) (ФАЗА 22),
  пересмотрено [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-186 — `provider` — измерение отчёта owner, и только его {#rn-186}

`sumGroupedBy` принимает `provider` как измерение, а
`GET /workspaces/:id/spend-report` возвращает список `porProvider` рядом с
моделью, проектом, актором и днём.
[ADR 0063](../adr/0063-duas-audiencias-para-o-mesmo-gasto.md) оставил ось за
рамками; [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)
вернул её, **не отменяя аргумента**: разбивка расхода по провайдеру
по-прежнему является разбивкой по УЧЁТНЫМ ДАННЫМ, и поэтому ось живёт в
маршруте, который уже требует `owner` ([RN-060](#rn-060)), — то же правило, что
у `credential-spend`, который по-прежнему отвечает на вопрос о СЧЁТЕ (по
месяцам, со связью с ключом, существующим сегодня).

`GET /projects/:id/spend/me` **ничего не получил**. Асимметрия — это замысел:
два ответа по-прежнему не являются срезом друг друга ([RN-101](#rn-101)).

Измерение `model` **не изменилось**: два провайдера, обслуживающие одно имя
модели, по-прежнему в одной строке. У того, кому нужна разбивка по учётным
данным, есть собственный список, а скрещивание двух измерений умножило бы
строки рейтинга, не отвечая на вопрос, на который уже не отвечали бы два
отдельных списка.

- **Где:** `apps/api/src/application/ports/token-usage-repository.port.ts:137`
  (`SpendDimension`),
  `apps/api/src/infrastructure/persistence/drizzle/token-usage.repository.ts:255`
  (`GROUP BY`), `apps/api/src/application/use-cases/llm/get-workspace-spend-report.use-case.ts:112`,
  `apps/api/src/interfaces/http/llm/spend.controller.ts:56`
- **Тест:** `apps/api/test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  ("quebra por PROVIDER, e o mesmo nome de modelo em dois providers segue UMA
  linha")
- **Источник:** [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-187 — Представление участника не дотягивается до `provider`, и это гарантирует ТИП {#rn-187}

Пока оси не существовало, представление участника ограничивало
**отсутствие** аргумента для передачи. С возвращением оси ограничение перешло
к сигнатуре: у `sumGroupedBy` **две перегрузки**, и та, что принимает область
с `actor` — область аудитории участника, и единственная, которая у него есть,
— принимает только `SpendDimensionDoAtor`, то есть
`Exclude<SpendDimension, 'provider'>`.
`sumGroupedBy('provider', escopoComAtor)` **не компилируется**.

Ни в репозитории, ни в сценарии использования нет `if` об этой комбинации,
намеренно: проверка во время исполнения создала бы впечатление, что гарантия
динамическая, тогда как её держит компилятор, — а `if` — именно то, что
следующий рефакторинг удаляет, не оставив ни одного красного теста.

Барьер двойной, и обе половины независимы: у маршрута участника **тоже нет
параметра измерения** (только `projectId` и `dias`), так что выдуманный query
вроде `?dimensao=provider` отбрасывается Nest до того, как дойдёт до handler.

`Exclude` вместо второго списка, написанного вручную, — намеренно: новое
измерение рождается достижимым для обеих аудиторий, а его изъятие из
досягаемости участника становится явным актом **в этом месте** — никогда не
забывчивостью в другом файле.

- **Где:** `apps/api/src/application/ports/token-usage-repository.port.ts:121`
  (две перегрузки), `:147` (`SpendDimensionDoAtor`), `:163`/`:173` (две
  области), `apps/api/src/application/use-cases/llm/get-my-spend.use-case.ts:73`,
  `apps/api/src/interfaces/http/llm/spend.controller.ts:98`
- **Тест:** `apps/api/test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  ("não compila pedir `provider` com escopo de ator" — `@ts-expect-error`,
  который `tsc` проваливает как НЕИСПОЛЬЗОВАННУЮ директиву, если барьер падёт;
  и "só pede as dimensões `session` e `day`"),
  `apps/api/test/interfaces/spend.controller.spec.ts` (маршрут участника
  принимает `dias` и ничего больше)
- **Источник:** [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-188 — Человек и агент — разбиение списка по актору, без лишнего запроса {#rn-188}

Отчёт owner несёт `porOwner` (строки `actor_kind = 'user'`) и `porAgente`
(`actor_kind = 'agent'`) помимо `porAtor`, который остаётся целым. Оба блока
**выводятся** из `porAtor` в сценарии использования — `actorKind` уже приходит
в строке с ФАЗЫ 22, — а не являются двумя запросами с `where actor_kind`.
Причина измерена: [ADR 0063](../adr/0063-duas-audiencias-para-o-mesmo-gasto.md)
показал, что стоимость этих запросов растёт с размером `token_usage`, а не с
размером запроса, так что сканировать окно ещё два раза, чтобы разделить то,
что уже разделено в памяти, было бы дорого по неверной причине.

`actor_kind`, не являющийся ни человеком, ни агентом (сегодня — `system`),
**не входит ни в один из блоков** и остаётся видимым в `porAtor` и в итоге.
Открытие третьего блока для него сказало бы, что у продукта есть аудитория,
которой у него нет.

Метка "Por owner" взята из дизайн-handoff и действует согласно
[RN-058](#rn-058) — это ключ owner, который тратят все эти строки. Владелец
workspace по-прежнему определяется полем `ownerId`, а не `actorKind` каждой
строки.

- **Где:** `apps/api/src/application/use-cases/llm/get-workspace-spend-report.use-case.ts:120`
- **Тест:** `apps/api/test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  ("separa PESSOA de AGENTE em dois blocos, sem perder a lista por ator")
- **Источник:** [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-102 — Модель области — наследуемое значение по умолчанию; расхождение — решение агента, а возврат к наследованию стирает решение {#rn-102}

Каскад binding получил уровень: `сессия > агент > **область** > проект >
workspace`. `area` находится МЕЖДУ агентом и проектом — это ЗНАЧЕНИЕ ПО
УМОЛЧАНИЮ, которое делят lead и подагенты области
(`qa`/`qa-automacao`/`qa-performance-seguranca`, `infra`/`infra-workflows`,
`dev`/`dev-<módulo>`), а binding самого агента — это РАСХОЖДЕНИЕ, которое его
перекрывает. Если бы область стояла ВЫШЕ агента, она побеждала бы всегда, и
«наследуемое значение по умолчанию» на практике было бы «навязанным» — ни один
агент не смог бы выбрать другую модель.

Новый уровень входит в ТУ ЖЕ повторную проверку capability, что и
[RN-041](#rn-041)/[RN-043](#rn-043): модель области, исчезнувшая у провайдера
или не делающая tool calling, ПРОПУСКАЕТСЯ и записывается в `skipped`, ровно
как это уже было с `agent`. `assertModelFitsBindingScope` (RN-040) стала
требовать `supports_tool_calling` также в области `area` — её никогда не
читает человеческий чат, только агент, так что её пропуск отложил бы тот же
молчаливый сбой на один уровень.

**«Вернуться к наследованию» удаляет binding, никогда не копирует модель
нижнего уровня наверх.** Запись в агента модели, которую решила область,
выглядела бы на экране так же, но это не так: это стало бы КОПИЕЙ, и следующее
изменение области оставило бы этого агента позади, и никто бы не заметил.
Наследование — это ОТСУТСТВИЕ собственного решения, а отмена расхождения —
удаление строки: `DELETE
/projects/:id/agent-bindings/:slug` и `DELETE
/projects/:id/area-bindings/:key`, оба 204, оба 404, когда область уже
наследует (идемпотентность, которая СОЛГАЛА бы, будь она молчаливым 204:
удалить несуществующее и удалить по-настоящему — разные ответы для одного
экрана).

Изменение модели ОБЛАСТИ требует `maintainer`, а не `developer`, как у
отдельного агента, — по той же причине, что потолок параллелизма
([RN-083](#rn-083)): binding области достигает lead и ВСЕХ подагентов разом,
а выбор модели — это решение о том, сколько продукт тратит без спроса.

**ЭКРАН начал соблюдать ОБА минимума, и их два.** До сих пор `ModelsSection` —
таблица моделей по агенту — не проверяла никакой роли: `ModelPicker` колонки
МОДЕЛЬ ДЕЙСТВУЮЩАЯ и «вернуться к наследованию» колонки ИСТОЧНИК появлялись
кликабельными для всех, включая `viewer`, а api отклоняла с 403. Выходом НЕ
было копирование gate соседнего раздела (`owner || maintainer`): это
заменило бы дефект ОБРАТНЫМ, заперев `developer` от действия, которое
принимает `PUT`/`DELETE .../agent-bindings/:slug`, — а обратный хуже, потому
что предложение того, что будет отклонено, хотя бы заканчивается toast, тогда
как утрата возможности невидима для того, кто её утратил. Минимум
определяется ENDPOINT, а не разделом, и два раздела — соседи на ОДНОМ экране
с разными минимумами. Сравнение ушло из экранов и стало `roleAtLeast`
(`apps/web/src/lib/roles.ts`), над уже существовавшим `ROLE_ORDER` — то же
имя, что у функции backend, потому что это одно правило по обе стороны
провода; ручная запись иерархии (`role === 'owner' || role === 'maintainer'`)
попадает случайно, пока минимум высок, и молча ошибается, когда он низок.
ОТСУТСТВУЮЩАЯ роль (запрос в полёте или упавший) ничего не достигает: ошибка в
сторону отключения исправляется перезагрузкой.

**Исчезает ЭЛЕМЕНТ УПРАВЛЕНИЯ, никогда ИНФОРМАЦИЯ** (ADR 0064). Тот, кто не
может редактировать, по-прежнему видит действующую модель в триггере и всю
цепочку источника ([RN-470](#rn-470)), а «вернуться к наследованию» остаётся
в строке, инертным, — именно он ГОВОРИТ, что этот агент разошёлся, и его
сокрытие стёрло бы состояние, которое можно прочитать, не имея права
изменить. Причина того, что они погашены, говорится ОДИН раз, текстом, в
подписи раздела, а не через `title` в каждой строке: tooltip на элементе
`disabled` не открывается в Chromium (браузер не отправляет событие мыши
отключённому элементу), а объяснение, которое не появляется, — то же
отсутствие с большим количеством кода.

**Ничто из этого не является границей безопасности, и предел объявлен.**
Отклоняет по-прежнему `RolesGuard`. Роль, которую читает экран, — роль
WORKSPACE (`useCurrentWorkspaceWithRole`), а с другой стороны авторизует
ЭФФЕКТИВНАЯ роль ПРОЕКТА (`ResolveEffectiveRoleUseCase.forProject`), которую
строка `project_members` ПЕРЕКРЫВАЕТ в обоих направлениях, — так что тот, у
кого есть собственная роль в проекте, может видеть здесь отключённый элемент,
который api приняла бы. Закрытие этого потребовало бы запроса роли НА КАЖДЫЙ
ПРОЕКТ, которого у web ещё нет, и это тот же пробел, который уже нёс
`ModelsSection`; выдумать второй источник роли только в одном разделе
было бы хуже пробела.

> **Дополнительная заметка ([RN-471](../business-rules.md#rn-471)):** пробел из
> абзаца выше — ОДИН, а не по одному на раздел, и там, где экран УЖЕ делает
> запрос роли по проекту, он закрывается, а не объявляется. Раздел
> **Участники** запрашивает `listProjectMembers`, что является
> `findMemberRole` для всех сразу, и составляет
> `projectRole ?? workspaceRole` — ровно то, что делает `forProject`. Это не
> второй источник роли, который этот абзац отвергает: это ТА ЖЕ композиция,
> из данных, которые у раздела уже на руках. Два раздела моделей сохраняют
> приближение, потому что этих данных у них нет. Осторожно читайте
> «ПЕРЕКРЫВАЕТ в обоих направлениях» выше: это буквально, а три описания
> OpenAPI утверждают обратное — см. RN-471.

- **Где:** `apps/api/src/domain/llm/binding-resolver.ts` (приоритет),
  `apps/api/src/domain/llm/model-capabilities.ts` (capability `area`),
  `apps/api/src/application/use-cases/llm/resolve-model-binding.use-case.ts`
  (область агента берётся из каталога `agent-areas.ts`, без похода в базу),
  `apps/api/src/application/use-cases/llm/clear-model-binding.use-case.ts`,
  `apps/api/src/interfaces/http/llm/model-bindings.controller.ts`
  (`area-bindings`, `DELETE` в `agent-bindings` и `area-bindings`),
  `apps/web/src/routes/settings/ModelsSection.tsx` (колонка Origem с
  «вернуться к наследованию» и gate `maintainer`, переписанный на
  `roleAtLeast` без смены минимума),
  `apps/api/src/interfaces/http/llm/model-bindings.controller.ts:273` и `:301`
  (`developer` на двух endpoints агента — эти строки НЕ изменились),
  `apps/web/src/lib/roles.ts:49` (`roleAtLeast` — недостававшее сравнение),
  `apps/web/src/routes/settings/ModelsSection.tsx:89` (`podeEditar` и почему
  `developer`, а не `maintainer`), `:379` (отключённый picker), `:446`
  (отключённая кнопка и почему причина не идёт в `title`), `:546` (подпись,
  называющая причину)
- **Тест:** `test/domain/llm/binding-resolver.spec.ts`,
  `test/domain/llm/model-capabilities.spec.ts`,
  `test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`,
  `test/application/use-cases/llm/clear-model-binding.use-case.spec.ts`,
  `apps/web/src/routes/ProjectSettingsTab.test.tsx`,
  `apps/web/src/routes/settings/papel-na-tabela-de-agentes.test.tsx`
  (`viewer` не редактирует, и клик не доходит до api; `developer`
  редактирует, и PUT/DELETE доходит; отсутствующая роль инертна; информация
  строки переживает погашенный элемент; и случай, не дающий «унифицировать»
  два раздела, — один и тот же `developer` видит таблицу агентов включённой, а
  таблицу областей отключённой, одновременно)
- **Источник:** [ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md) (ФАЗА 23)

### RN-103 — Binding агента — ПО ПРОЕКТУ, а не глобальный {#rn-103}

До ФАЗЫ 23 `scope = 'agent'` хранил ГЛОБАЛЬНЫЙ slug (`scope_id = 'qa'`), а
`PUT /projects/:id/agent-bindings/:slug` получал `:projectId` в маршруте и
намеренно его ОТБРАСЫВАЛ — выбор модели Arquiteto на экране одного проекта
менял её во ВСЕХ проектах. Это перестало держаться, когда область стала
наследуемым значением по умолчанию (RN-102): область — по проекту, и
глобальный binding агента НАД значением по умолчанию по проекту заставил бы
одного и того же агента разрешать разные модели только там, где существует
область, — и заставил бы «вернуться к наследованию» стирать решение,
дотягивавшееся до проектов, на которые никто не смотрит.

Выходом стало сделать `agent` тоже по проекту, а не опускать область ниже
агента: `scope_id` у `agent` и `area` стал СОСТАВНЫМ —
`<projectId>:<slug агента|ключ области>` — вместо выдумывания новой таблицы
только ради хранения проекта для каждого binding. UUID проекта и slug агента
никогда не содержат `:`, что делает первое `:` однозначным разделителем;
чтение режет по нему, а не по всем, чтобы slug с `:` (сегодня таких нет, но
ничто не мешает) не превратился в три куска.

`scope_id` без проекта (старый формат) ОТКЛОНЯЕТСЯ при записи, а не
принимается и игнорируется: его запись создала бы binding, который каскад
больше никогда не нашёл бы, — невидимый, а не ошибку. Миграция 0040 разносит
каждый существующий глобальный binding агента по строке на проект (сохраняя
то, что каждый проект разрешал до изменения) и удаляет старый формат; это
РАЗНЕСЕНИЕ, а не удаление, потому что глобальная строка никогда не хранила
информации о том, кому она «принадлежала», — выдумывать проект-владельца
значило бы выдумывать несуществовавшие данные.

- **Где:** `apps/api/src/domain/llm/binding-scope-id.ts` (формат и
  проверка), `apps/api/src/application/use-cases/llm/set-model-binding.use-case.ts`
  (`workspaceDoEscopo` стал выводить workspace также для `agent`/`area` —
  курирование RN-043 раньше в них не проверялось), `apps/api/src/db/migrations/0040_tearful_night_nurse.sql`
- **Тест:** `test/domain/llm/binding-scope-id.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`,
  `test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`
  ("o binding de agente é POR PROJETO: o vizinho não o enxerga")
- **Источник:** [ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md) (ФАЗА 23)

### RN-470 — Источник модели отличает собственный binding от наследования от Criativo, и ни одна пустота каскада не использует тот же символ, что другая {#rn-470}

`origin: 'agent'` в ответе api означает **две разные вещи**, и api права, не
разделяя их: у агента есть строка области `agent` в `model_bindings`, **или**
каскад приземлился на `workspace`, и
[`herdarModeloDeStart`](#rn-102) заменил значение на модель Criativo — тот,
кто читает «откуда пришло», должен видеть, что пришло от АГЕНТА, а не из
области, которой нет в базе. Разделять их должен **экран**, и до сих пор он
их не разделял: колонка Origem печатала сырой enum, и в проекте с 3 строками
`agent` в базе все 12 агентов показывали одно и то же слово `agent`.

**Источник — это ЦЕПОЧКА, а не слово.** `workspace › проект › область ›
агент` с четырьмя состояниями узла, и все четыре существуют, потому что
говорят разное: **действующий** (отсюда берётся используемая модель —
единственный узел в `Badge`), **заданный** (у этого уровня есть собственное
значение, но победил более конкретный), **пустой** (здесь нет значения) и
**пропущенный** (значение было, и каскад его отбросил по
`unavailable`/`sem_tool_calling`, [RN-043](#rn-043)). Слияние `заданного` с
`пустым` вернуло бы проблему сырого enum на уровень ниже.

**При наследовании узел `агент` остаётся ПУСТЫМ, а дополнительный узел называет
Criativo.** Уровень, которого достиг каскад (`workspace`), показывается как
`заданный`, а **не** как действующий: модель workspace — не та, что действует,
и пометка её действующей утверждала бы неверную модель. Узел Criativo —
единственный, не являющийся областью базы, намеренно — он называет
послекаскадный шаг. Та же цепочка действует для раздела ОБЛАСТИ, где
`origin: 'agent'` **может** быть только этим шагом: запрос области не кладёт
область агента в каскад.

**Вывод делает КЛИЕНТ, и то, что он не может доказать, остаётся
действенным.** Ни одного нового endpoint: экран уже запрашивает четыре уровня.
`agent` — это наследование, когда ни у одного уровня выше workspace не было
ПРИГОДНОГО значения (пропущенное не удерживает спуск), и модель совпадает с
разрешённой моделью Criativo. Остаётся один неразличимый случай: агент с
собственной строкой, указывающей на ту же модель, что и Criativo, без
значения по умолчанию области или проекта. Поэтому «вернуться к
наследованию» продолжает появляться при любом источнике `agent` — действие
остаётся доступным именно в том случае, который цепочка не доказывает, и в
нём оно всё ещё меняет будущее (без строки агент начинает следовать за
Criativo).

**Другая половина этого выбора: у 404 собственный исход.** Сохранение кнопки
при любом источнике `agent` означает предлагать её ТАКЖЕ там, где нет строки
для удаления, — и там `ClearModelBindingUseCase` отвечает **404**, правильно
(«удалил несуществующее» и «удалил» — не один и тот же ответ; их слияние
скрыло бы неверный `agentSlug`). Для того, кто кликнул, однако, этот 404 — не
сбой: запрошенное состояние — агент наследует — **уже истинно**, и назвать это
ошибкой значило бы экрану противоречить тому, что он знает. Поэтому он не
проходит через `mensagemDaApi`, как остальные отказы, по двум причинам: фраза
api — pt-BR, зашитая в коде, а язык web по умолчанию — `en`, и у этого
endpoint **одна** причина 404 (недостаточная роль — 403 в `RolesGuard`,
некорректный `scope_id` — не 404) — клиент ЗНАЕТ, что значит этот 404, и может
сказать это на языке читающего. Любой другой статус по-прежнему настоящий
сбой, с фразой api и тоном `danger`. В **обоих** исходах строка
перечитывается: если api говорит, что binding не было, устарел экран.

**И собственный исход принадлежит ENDPOINT, а не экрану.** Другое действие той
же строки — смена модели через `ModelPicker` колонки МОДЕЛЬ ДЕЙСТВУЮЩАЯ —
отклоняет семью путями, и **ни один статус не идентифицирует один из них в
одиночку** (`SetModelBindingUseCase`): 400 для некорректного `scope_id` или
`modelId`, отвергнутого DTO, 403 для роли ниже `developer`, **404 для двух
неразличимых причин** ("Modelo não encontrado" и "Projeto não encontrado") и
422 для трёх ([RN-040](#rn-040) без tool calling; [RN-043](#rn-043) отключена
в workspace или исчезла у провайдера). Там клиент НЕ может назвать 404 —
выбрать одну из двух фраз значило бы экрану утверждать то, чего он не знает, —
так что каждый отказ следует обычной грамматике, с фразой api и тоном
`danger`. Две функции — соседи и обрабатывают один статус противоположно
намеренно: собственный исход разрешает ЕДИНСТВЕННАЯ причина, а не экран.

**При отказе колонка МОДЕЛЬ ДЕЙСТВУЮЩАЯ продолжает показывать подтверждённый
binding.** `ModelPicker` не хранит выбор в локальном состоянии (`selected`
берётся из prop `selectedModelId`, который приходит из query), так что отказ
не оставляет на экране модель, которую api отказалась записать, — а строка
перечитывается только при успехе, поскольку при отказе в базе ничего не
изменилось. Это та же дисциплина этой RN, применённая ко времени: экран не
утверждает несуществующее состояние — ни прочерком, ни enum, ни оптимизмом.

**У пустоты собственный текст, и у разных пустот разные тексты.** Три `—`
экрана говорили три вещи одним символом и теперь говорят каждый своё: `sem
modelo em nenhum nível` (ни у одного уровня нет binding для агента), `sem
gasto ainda` (агент не зарегистрировал потребления — в отличие от `US$ 0,00`,
что означает отработать бесплатно) и `sem padrão em nenhum nível` (область и
два уровня над ней пусты). Та же дисциплина, что
[RN-180](autenticacao.md#rn-180): экран не утверждает прочерком то, что не
может назвать.

- **Где:** `apps/web/src/routes/settings/cascata.tsx:119` (`montarCadeia` —
  четыре состояния и узел Criativo), `:178` (`herdouDoCriativo` — вывод и его
  предел), `:287` (`CadeiaDeCascata`),
  `apps/web/src/routes/settings/ModelsSection.tsx:149` (`cadeiaDoAgente`),
  `:329` (`handleModelChange` — почему здесь у 404 НЕТ собственного исхода и
  почему строка перечитывается только при успехе), `:385`
  (`handleClearAgentBinding` — три исхода и почему у 404 есть свой), `:359`
  (колонка Origem), `:429` (`não há nível abaixo`), `:448` (`sem gasto ainda`),
  `apps/web/src/components/ModelPicker.tsx:95` (`selected` берётся из prop —
  picker не хранит выбор, и поэтому отказ не оставляет на экране
  значение-призрак),
  `apps/api/src/application/use-cases/llm/set-model-binding.use-case.ts:38`
  (две причины 404 этого endpoint — этот файл НЕ изменился),
  `apps/api/src/interfaces/http/shared/llm-binding-error.filter.ts:39`
  (400/422 отказов курирования — этот файл НЕ изменился),
  `apps/web/src/routes/settings/ModelsSection.tsx` (цепочка области),
  `apps/api/src/application/use-cases/llm/clear-model-binding.use-case.ts:25`
  (404, который выбрасывает api, — этот файл НЕ изменился),
  `apps/api/src/domain/llm/binding-resolver.ts:140` (`origin: 'agent'`,
  который возвращает api, и комментарий, объясняющий, почему он верен, — этот
  файл НЕ изменился)
- **Тест:** `apps/web/src/routes/settings/cascata.test.tsx` (собственный
  binding заканчивается на узле `agente`; наследование оставляет `agente`
  пустым и называет Criativo; workspace никогда не показывается действующим
  при наследовании; раздел области — аналогично; различие переживает `en`;
  отброшенный уровень становится зачёркнутым узлом, а конкурирующий badge
  исчез; три пустоты с тремя текстами; `montarCadeia` и `herdouDoCriativo` как
  чистые функции, включая случай ОТБРОШЕННОГО значения по умолчанию области,
  который не удерживает спуск),
  `apps/web/src/routes/settings/voltar-a-herdar.test.tsx` (три исхода клика:
  удалил и перечитывает; 404 — не ошибка, не передаёт фразу api на pt-BR даже
  в `en` и перечитывает, потому что устарел экран; другой статус идёт через
  `mensagemDaApi` и не перечитывает),
  `apps/web/src/routes/settings/troca-de-modelo.test.tsx` (другое действие той
  же строки: записывает и перечитывает; 422 для модели `unavailable` —
  достижимый случай, поскольку picker показывает недоступную помеченной, —
  идёт через `mensagemDaApi` и не перечитывает; колонка МОДЕЛЬ ДЕЙСТВУЮЩАЯ
  остаётся на старой модели, никогда на отклонённой; и 404 НЕ получает
  собственного исхода, что и есть контраст с функцией-сестрой)
- **Источник:** дизайн-ревью владельца продукта (пункт №9 холста улучшений
  UI — «каскад модели как видимая цепочка»)

### RN-059 — Сбой хода — долговечное событие с источником, и агент говорит {#rn-059}

Когда ход LLM падает, агент записывает **`agent.error`** в event log с тремя
полями: `origem` (словарь ADR 0020), `mensagem` на португальском и сырой
`reason`. И сообщение появляется **в ленте разговора**, а не только в логе.

Было наоборот, и исход был худшим из возможных: четыре разговорных агента
записывали `agent.response` с **пустым** содержимым — неотличимым от успеха в
неизменяемом логе — и отправляли причину через `broadcast`, который
эфемерен. Тот, у кого вкладка не была открыта в ту секунду, никогда не узнал
бы, что была ошибка; тот, у кого была, видел пустой пузырь.

Был второй путь, ещё хуже: когда api описывала сбой в СОБСТВЕННОМ финальном
кадре (бюджет, отсутствующие учётные данные, недостающий binding), ход не
попадал в ветку ошибки и **не выпускал никакого события** — абсолютная
тишина.

Эта же ветка, однажды исправленная, стоила второго раунда: в PO, Arquiteto и
Dev Lead она возвращала `{state, ""}` — КОРТЕЖ там, где все остальные ветки
`run_turn` возвращают `state` (map). `Map.put/3` в
`TurnoAssincrono.tratar_resultado/2` выбрасывал `BadMapError` внутри
`handle_info`, а поскольку четыре разговорных — `restart: :temporary`, агент
УМИРАЛ и не возвращался. Сбой переставал быть молчаливым и становился
падением — с самыми обыденными триггерами. Правило действует целиком: агент
описывает сбой **и остаётся на ногах**. Поэтому у `tratar_resultado/2` есть
второй барьер, в точке, общей для всех четырёх: результат хода, не являющийся
map, становится `agent.error` с источником `codigo`, никогда мёртвым
процессом.

Источник НИКОГДА не угадывается: у каждого шаблона в `FalhaDeTurno.origem/1`
есть записанная причина, а то, что ни с чем не совпадает, выходит как
**`codigo`** — пробел в нашем классификаторе, и это источник, указывающий
правильное действие (ADR 0020).

Уже записанные события не стираются — экран НАЗЫВАЕТ их пустым ответом,
предшествующим этому правилу, вместо того чтобы показывать пустоту.

- **Где:** `apps/engine/lib/engine/agents/falha_de_turno.ex`,
  `criativo_server.ex`, `po_server.ex`, `arquiteto_server.ex`,
  `dev_lead_server.ex`, `infra_lead_server.ex` (`emit_falha/2`),
  `turno_assincrono.ex` (`tratar_resultado/2`, второй барьер),
  `apps/web/src/lib/session-falha.ts`
- **Тест:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  (долговечное событие с источником; никогда не записывает пустой ответ;
  ошибка, описанная в финальном кадре, тоже становится событием);
  `po_server_test.exs` (финальный кадр с ошибкой не роняет агента —
  НАСТОЯЩИЙ GenServer, с `Process.alive?/1`);
  `arquiteto_server_test.exs` и `dev_lead_server_test.exs` (тот же путь, полный
  цикл); `turno_assincrono_test.exs` (второй барьер описывает, а не роняет);
  `apps/web/src/lib/session-falha.test.ts`
- **Источник:** реальное исполнение ФАЗЫ 13b

### RN-116 — Сбой СОЗДАНИЯ handoff не роняет агента {#rn-116}

`confirm_readiness` (Criativo → PO) и `offer_infra_handoff` (Arquiteto → Infra;
`offer_dev_handoff`, Arquiteto → Dev Lead, ушёл в
[RN-672](../business-rules.md#rn-672), а handoff к Dev Lead, который предлагает
Infra, следует тому же правилу) вызывают api для создания handoff ПОСЛЕ того,
как ход уже прошёл, — в случае Criativo после того, как `product_brief` уже
записан в event log. Если этот вызов падает (api недоступна, 5xx и т.д.),
handoff не существует, но это НИКОГДА не роняет GenServer агента: сбой
становится долговечным `agent.error`, с `origem` (`FalhaDeTurno.origem/1`) и
сообщением, говорящим, что УЖЕ сохранено (product_brief, правила) и что нет
(handoff), — чтобы пользователь знал, что повторное подтверждение безопасно и
не повторяет работу.

Было наоборот: три вызова использовали
`{:ok, _handoff} = EngineApiClient.create_handoff(...)` — жёсткое
сопоставление. `{:error, _}` становилось `MatchError`, а поскольку три агента
поднимаются с `restart: :temporary` в `DynamicSupervisor` `:one_for_one`,
процесс просто ИСЧЕЗАЛ — без `agent.error`, без ответа в ленте, только
тишина. Со стороны наблюдателя: информация (правила, product brief), казалось,
«прошла» (была записана), но на стороне следующего агента ничего не
начиналось, потому что handoff так и не был создан. Повторное открытие
разговора само по себе не помогало — только НОВОЕ сообщение снова активирует
процесс (регидратируя из event log), и только новое подтверждение готовности
снова пытается создать handoff.

Сообщение НЕ переиспользует `FalhaDeTurno.mensagem/1` (из `RN-059`, "não
consegui completar este turno... nada foi gasto"): во всех трёх местах вызова
работа уже прошла (или даже не требовалась, в случае `offer_dev_handoff`) —
сказать «ничего не потрачено» было бы ложью, когда токены уже были потрачены
в ходе консолидации. Переиспользуется только `FalhaDeTurno.origem/1`, которая
классифицирует по ФОРМАТУ причины (HTTP-статус, исключение транспорта), а не
по тому, является ли это ходом LLM.

`Engine.Harness.Tools.OfferHandoff` (инструмент, который PO использует через
tool call, внутри ToolLoop) уже обрабатывал `{:error, reason}` без падения —
дефект был только в этих трёх handlers, управляемых сервером, которые
вызывают `EngineApiClient.create_handoff/5` НАПРЯМУЮ, а не через инструмент.

- **Где:** `apps/engine/lib/engine/agents/criativo_server.ex`
  (`handle_call(:confirm_readiness, ...)`, `emit_falha_handoff/3`),
  `apps/engine/lib/engine/agents/arquiteto_server.ex`
  (`handle_call(:offer_infra_handoff, ...)`, `emit_falha_handoff/3`);
  `apps/engine/lib/engine/infra/infra_lead_server.ex`
  (`emit_falha_do_handoff_ao_dev_lead/2`, RN-672)
- **Тест:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  ("prontidão: falha ao criar o handoff NÃO derruba o processo, e vira
  agent.error durável"); `apps/engine/test/engine/agents/arquiteto_server_test.exs`
  (`offer_infra_handoff`, успех и сбой);
  `apps/engine/test/engine/infra/infra_lead_server_test.exs` (handoff к Dev
  Lead, предлагаемый Infra, отклонённый с 500)
- **Источник:** сообщение о реальном использовании в проекте `exp-001`
  (Criativo → PO); тот же структурный сбой был найден чтением кода в двух
  handoffs Arquiteto, без отдельного воспроизведения для них

### RN-058 — Ключ, который тратит АГЕНТ, — это ключ owner workspace {#rn-058}

Учётные данные LLM принадлежат человеку (`user_credentials.user_id`), а агент
— не человек. Ход агента разрешает ключ через **owner workspace**
(`workspaces.created_by`), а не через того, кто открыл сессию, и не через
того, кто создал проект: кто оплачивает счёт, оплачивает агентов, и это не
меняется, когда сессию начинает другой член команды.

`created_by`, а не `workspace_members.role = 'owner'`: owners может быть
несколько, и «любой из них» заставил бы используемый ключ меняться без
чьего-либо решения.

До этого ход передавал **slug агента** (`agentId ?? sessionId`) в колонке
пользователя. Запрос шёл в базу с `user_id = 'criativo'`, Postgres отклонял
недопустимый UUID, и ошибка превращалась в **пустой ответ** в ленте — без
метрики, без события сбоя, без чего-либо на экране. Практический эффект,
который вскрыло только реальное исполнение: **ни один агент никогда не
использовал провайдера с учётными данными**. Работал только `ollama`, потому
что для него поиск пропускается, — и именно на локальной модели работали
Фаза 4, dogfooding Фазы 10 и все демо.

Человеческий чат этого дефекта никогда не имел: он использует `actor.id`,
то есть настоящего пользователя.

- **Где:**
  `apps/api/src/application/use-cases/llm/resolve-credential-owner.use-case.ts`,
  `apps/api/src/application/use-cases/llm/stream-llm-turn.use-case.ts`,
  `apps/api/src/application/use-cases/llm/run-llm-turn.use-case.ts`
- **Тест:** `test/application/use-cases/llm/resolve-credential-owner.use-case.spec.ts`
  (owner побеждает того, кто создал проект; найденный ключ — его;
  несуществующий проект — 404, а не ошибка базы)
- **Источник:** реальное исполнение ФАЗЫ 13b

### RN-056 — Фасет capability приходит от провайдера; молчание сохраняет прежнее {#rn-056}

`supports_vision`, `supports_reasoning` и `generates_image` — **факт
провайдера**, а не мнение: они берутся из удалённого каталога при sync, с тем
же fallback, что `supports_tool_calling`, — удалённое, затем локальное, затем
`false`.

В OpenRouter (единственном, кто это сегодня публикует) три берутся из:
`architecture.input_modalities` содержит `image`,
`supported_parameters` содержит `reasoning`, и
`architecture.output_modalities` содержит `image`. Принимать изображение и
**производить** изображение — разные оси: их слияние отправляло бы
пользователя к не той модели.

Раньше sync читал `supportsVision` из уже ЗАПИСАННОГО и никогда не обращался к
удалённому — колонка рождалась `false`, и пути стать истинной не было. 338
моделей первого реального sync остались все `false`, включая 181, которые
провайдер объявляет мультимодальными.

**Отсутствие объявления — не объявление отсутствия**
([ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)):
парсер ОПУСКАЕТ поле, когда провайдер молчит, и `undefined` сохраняет
локальное значение. Поэтому экран использует фасеты только как
ПОЛОЖИТЕЛЬНЫЙ фильтр и никогда не пишет «не читает изображения» — `false`
здесь значит «провайдер не объявил».

- **Где:** `apps/api/src/infrastructure/llm/openrouter-provider.ts`
  (`temModalidade`, `parseCatalogoOpenRouter`),
  `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts`,
  `apps/api/src/db/schema/llm.ts` (`models`)
- **Тест:**
  `test/infrastructure/llm/openrouter-provider.contract.spec.ts`
  (`modalidade não declarada OMITE o campo em vez de afirmar false`);
  `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`
  (`catálogo que se cala sobre modalidade preserva a faceta gravada`)
- **Источник:** [ADR 0051](../adr/0051-facetas-de-capability-e-curadoria-por-uso.md)

### RN-057 — «Для чего подходит» — курирование workspace, и пометка использования не включает модель {#rn-057}

Ни один каталог провайдера не публикует «хорош для кода». Это **мнение
оператора**, обнаруживаемое при использовании, — поэтому оно живёт в
`workspace_models.uses`, рядом с другим решением workspace
([RN-052](#rn-052)), а не в `models`.

ЗАКРЫТЫЙ словарь — `codigo`, `documentacao`, `analise`, `imagem`,
`conversa`, — с доказательством исчерпывающести на этапе компиляции с обеих
сторон. Свободный текст за неделю дал бы `code`, `coding` и `código` в одном
фильтре.

Два правила, сохраняющие оси раздельными:

1. **Пометка использования не включает модель.** У `workspace_models.is_active`
   DEFAULT `true`, поэтому строка, созданная пометкой использования,
   вставляется с явным `is_active = false`. Без этого мнение о модели
   разрешало бы ей тратить, вопреки [RN-043](#rn-043).
2. **Смена использования не выключает то, что было включено.** `is_active`
   остаётся вне `SET` в `ON CONFLICT`.

Список использований **заменяет** предыдущий, а не добавляется: пустой список —
способ снять все отметки, и это легитимное состояние — «никто не высказался»
не значит «не подходит».

- **Где:** `apps/api/src/domain/llm/model-uses.ts`,
  `apps/api/src/db/schema/llm.ts` (`workspace_models.uses`),
  `apps/api/src/infrastructure/persistence/drizzle/workspace-model.repository.ts`
  (`setUses`),
  `apps/api/src/application/use-cases/llm/set-model-uses.use-case.ts`
- **Тест:** `test/application/use-cases/llm/set-model-uses.use-case.spec.ts`
  (`marcar uso NÃO liga o modelo — a linha nova nasce inativa`,
  `trocar o uso não desliga o que já estava ligado`,
  `o uso vale só neste workspace`)
- **Источник:** [ADR 0051](../adr/0051-facetas-de-capability-e-curadoria-por-uso.md)

### RN-038 — Агент, учитываемый в сводке workspace, = потратил токены в этом месяце {#rn-038}

Сводка панели проектов («N активных проектов · M агентов · расход в этом
месяце») считает «агентом» того, у кого есть хотя бы одна строка в
`token_usage` с `actor_kind = 'agent'` в текущем месяце, суммируя все проекты
workspace. Без фильтра по `actor_kind` `user`, отправляющий чат, или
`system`, регистрирующий использование, раздули бы подсчёт — `token_usage`
записывает для любого типа актора, а не только агента. Отсечение по месяцу
использует `created_at >= date_trunc('month', now())`; агент, работавший
только в прошлом месяце, не учитывается, даже если он ещё появляется в
roster какой-либо сессии. Подсчёт естественно включает подспециальности
областей Фазы 8 (`qa-automacao`, `qa-performance-seguranca`,
`infra-workflows`): у каждой свой `actor_id`, когда она тратит токены.

- **Где:** `apps/api/src/infrastructure/persistence/drizzle/token-usage.repository.ts`
  (`summarizeForWorkspaceThisMonth`)
- **Тест:** `test/application/use-cases/iam/get-workspace-summary.use-case.spec.ts`

---

### RN-703 — Подагент без модели наследует разрешённую модель lead своей области {#rn-703}

«Применить ко всем агентам» (RN-476) записывает binding для каждого агента
каталога Configurações — 17 строк, — а подагент, которого engine запускает
вне этого списка, оставался без модели на любом уровне: `appsec` завершался
`agent.error` с источником `infra` ("Nenhum modelo vinculado para esta
sessão"), и то же касалось каждого `dev-<modulo>` помимо
`dev-backend`/`dev-frontend` и `qa-estrategia`. Когда каскад ПОДАГЕНТА не
находит значения (или находит только глобальное значение по умолчанию
workspace, которое никто не выбирал для проекта), он использует
РАЗРЕШЁННЫЙ binding lead своей области: lead области из каталога
(`agent-areas.ts`) или — для `appsec` → `secops` и `qa-estrategia` → `qa`,
которых engine запускает внутри lead, но которые не получают handoff, —
таблицу рядом, служащую только этому наследованию. Ответ несёт
`herdadoDoLead` с lead, а `origin` остаётся источником его binding (RN-470:
экран не утверждает собственную конфигурацию). Фильтр tool calling (RN-040)
действует при разрешении lead так же, как при разрешении подагента. Если
модели всё равно нет, сообщение о сбое говорит, где её настроить.

- **Где:** `apps/api/src/application/use-cases/llm/resolve-model-binding.use-case.ts:76`
  (`leadDoSubagente`); `apps/api/src/domain/agents/agent-areas.ts:123` (`leadDoSubagente`);
  `apps/api/src/domain/llm/binding-resolver.ts:66` (`MENSAGEM_SEM_MODELO`)
- **Тест:** `apps/api/test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`
  (`appsec` наследует от `secops`, а `dev-api` — от `dev-lead`; lead тоже без
  модели остаётся `null` — случай сбоя)
- **Источник:** AT-367

---

### RN-774 — Первая задача каждого модуля получает двойной потолок на задачу {#rn-774}

Первая задача модуля собирает весь скелет (манифест, приложение, база,
тесты) и стоит дороже последующих: в TP-01 от 08.10 она потратила US$ 0,53 на
Haiku 4.5 и была заблокирована фиксированным потолком US$ 0,50
(`taskBudgetMicros: 500000`). По решению владельца (09.10) она получает
**2× потолок на задачу** (US$ 1,00 по умолчанию); остальные следуют
настроенному потолку. Множитель — именованная константа в engine, а не
конфигурация.

«Первая» измеряется по логу, никогда по состоянию задачи: это задача, чей
`backlog.task_claimed` САМЫЙ СТАРЫЙ в проекте для этого модуля. Блокировка
обнуляет `assigned_to`, а перезапуск engine теряет память процесса; лог не
меняется, так что та же задача, снова взятая после освобождения, остаётся
первой, и исправление, запрошенное gate, тоже получает 2×. Api отвечает
`task.primeiraDoModulo` в контексте dev (`false` без `module` и `false` без
какого-либо claim модуля — обычный потолок консервативен), а ЭФФЕКТИВНЫЙ
потолок разрешается в одной точке engine. Блокировка по бюджету называет
потолок, действовавший для этой задачи ("teto da primeira tarefa do módulo:
1000000 micro-USD, US$ 1.00"). Gates QA остаются с базовым
`task_budget_micros` — вне рамок карточки.

- **Где:** `apps/engine/lib/engine/dev/teto_da_tarefa.ex:32` (`efetivo`);
  `apps/engine/lib/engine/dev/dev_agent_server.ex:669` (`diagnostico_de_orcamento`);
  `apps/api/src/application/use-cases/execution/get-dev-task-context.use-case.ts:182`
  (`ehPrimeiraTarefaDoModulo`)
- **Тест:** `apps/engine/test/engine/dev/dev_agent_server_test.exs` (describe
  "RN-774": первая с US$ 0,53 не блокируется, вторая того же модуля
  блокируется — случай сбоя, — первая другого модуля тоже получает 2×);
  `apps/engine/test/engine/dev/teto_da_tarefa_test.exs`;
  `apps/api/test/application/use-cases/execution/get-dev-task-context.use-case.spec.ts`
  (describe "RN-774")
- **Источник:** AT-433

### RN-802 — Оценка плана Dev Lead прибавляет двойную стоимость первой задачи каждого модуля {#rn-802}

Карточка одобрения `propose_execution_plan` (RN-709) говорила «до N ×
потолок», игнорируя, что первая задача каждого модуля имеет двойной потолок
(RN-774). Теперь api несёт в payload, рядом с `orcamentoPorTarefaMicros`,
`multiplicadorDaPrimeiraDoModulo`, а фраза суммирует ЭФФЕКТИВНЫЙ потолок:
(задачи − модули с задачами) × потолок + модули с задачами × множитель ×
потолок, говоря «первая каждого модуля стоит вдвое». При 8 задачах в одном
модуле и потолке US$ 0,50: до US$ 4,50. Это верхняя граница: первая задача
модуля, у которого уже была взята задача, не получает двойного, и фраза
по-прежнему говорит «до». Без множителя в payload (старое предложение) —
старый расчёт.

Множитель ПРИМЕНЯЕТСЯ только в engine (`Engine.Dev.TetoDaTarefa`); у api есть
объявленное зеркало, потому что экран не должен копировать константу, а engine
при предложении не опрашивается. Изменение одного требует изменения другого.

- **Где:** `apps/api/src/application/use-cases/execution/activate-execution.use-case.ts:83` (`MULTIPLICADOR_DA_PRIMEIRA_TAREFA_DO_MODULO`);
  `apps/api/src/application/use-cases/actions/propose-action.use-case.ts:237` (`multiplicadorDaPrimeiraDoModulo`);
  `apps/web/src/lib/aprovacoes.ts:346` (`multiplicador`)
- **Тест:** `apps/web/src/lib/aprovacoes.test.ts` (it "RN-802 (AT-473)": 8 задач, 1 модуль → US$ 4,50; 3 задачи, 2 модуля → US$ 2,50; без бюджета — без числа, случай сбоя);
  `apps/api/test/application/use-cases/actions/propose-action.use-case.spec.ts` ("plano válido nasce pending")
- **Источник:** AT-473

### RN-892 — Стабильный префикс вызова помечается для кэша промптов, а capability включена только в OpenRouter, доказанно {#rn-892}

Измерено в TP-01 (15.10): `anthropic/claude-haiku-5.5` через OpenRouter
получил 8,40 M входных токенов с **0** в кэше, и вход составил US$ 0,84 из
US$ 1,02. Модели Anthropic читают из кэша только префикс, помеченный
`cache_control: { type: "ephemeral" }` в текстовом блоке содержимого (до
четырёх точек, TTL 5 min — https://openrouter.ai/docs/features/prompt-caching).

1. **Capability провайдера, обязательная.** `LLMProviderCapabilities.promptCaching`
   равна `true` только в OpenRouter и `false` у остальных восьми. Её объявление
   без hook `marcarCacheDePrompt` падает при конструировании. Выключенная —
   тело байт в байт прежнее.
2. **Уровень модели в config.** В OpenRouter точку получает только
   `anthropic/*`; остальные кэшируют сами и возвращаются нетронутыми.
3. **Две точки, над тем, что не меняется.** Последний `system` префикса
   (инструкции, и инструменты перед ними) и последний `user`/`tool` перед
   хвостом `system` в конце. Хвост — язык (RN-622), окружение (RN-706), поток
   (RN-711), профиль (RN-680) — остаётся ПОСЛЕ последней точки, а порядок
   сообщений никогда не меняется.
4. **Доказательство (ADR 0041/0042).** 2026-10-15 smoke был запущен с
   реальными учётными данными (`OPENROUTER_TEST_KEY=… pnpm --filter api exec vitest run
   test/infrastructure/llm/openrouter-provider.cache.smoke.spec.ts`), и второй
   вызов `anthropic/claude-haiku-5.5` вернулся с
   `cached_input_tokens=8011`; только тогда capability OpenRouter стала
   `true`. Включение другого провайдера требует эквивалентного smoke. Выигрыш
   появляется в metering через [RN-666](#rn-666).

- **Код:** `apps/api/src/infrastructure/llm/openrouter-provider.ts:276` (`marcarCacheDePromptOpenRouter`);
  `apps/api/src/infrastructure/llm/openai-compatible-provider.ts:501` (`mensagens`)
- **Тест:** `apps/api/test/infrastructure/llm/openrouter-provider.contract.spec.ts` ("pontos de cache de prompt (RN-892)": включённая помечает две точки; выключенная — байт в байт; capability без hook падает — случай сбоя)
- **Источник:** AT-543
