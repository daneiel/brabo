---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0089 — `analytics` и `delivery-metricas` становятся скриптом отчёта

- **Статус:** Принят
- **Дата:** 2026-08-16
- **Контекст:** решение владельца продукта заранее ввести две роли
  целевой модели (`docs/fluxo.yml`), не дожидаясь органического триггера
- **Родственная часть:** [ADR 0085](0085-fluxo-como-registro-declarativo.md)
  (`docs/fluxo.yml`); прямой прецедент ФОРМЫ:
  `apps/api/scripts/medir-execucao.ts` (Фаза 13b)

## Контекст {#contexto}

`docs/fluxo.yml` уже описывал две роли целевой модели как
`status: proposto`, у каждой из которых уже был записан недостающий
критерий разделения для перехода в `active`:

- `analytics` (Analytics Engineer, метрика ПРОДУКТА) — «поглощена
  `medicao` (которая покрывает только метрику ВЫПОЛНЕНИЯ)», с критерием «день,
  когда `metricas-de-produto` станет обязательным входом PO»;
- `delivery-metricas` (Delivery Manager, поток — DORA) — «поглощена
  `medicao` (частично)», с критерием «никогда не становится агентом; становится
  ОТЧЁТОМ `medicao` (lead time, deployment frequency, MTTR, change
  failure rate, извлечённые из event log + `gates.yml`)».

Ни один из двух триггеров не сработал органически. Владелец продукта решил
всё равно заранее построить: воронка сессия → commit → PR → merge и
реальный срез DORA (lead time, deployment frequency) уже
извлекаемы из данных, которые продукт уже записывает, — `proposed_actions.execution_result`
для трёх git-действий, которые производит dev agent
(`apps/api/src/domain/git/git-action-execution-result.ts`), и
`docs/gates.yml` для gate `backmerge`. Ожидание органического триггера
отложило бы отчёт, который уже возможен.

## Решение {#decisão}

Обе роли становятся `status: active` в `docs/fluxo.yml`, а материализует
их ОДИН скрипт — `apps/api/scripts/analise-funil.ts`
(`pnpm --filter api analise:funil -- --projeto <uuid> [--json]`) — в
ТОМ ЖЕ формате, что `apps/api/scripts/medir-execucao.ts`:
`NestFactory.createApplicationContext(AppModule)`, обязательный аргумент
`--projeto <uuid>`, чистое чтение через Drizzle, ноль записи в
базу, вывод Markdown по умолчанию и `--json` для программного потребления.

Это не новая функция продукта: это форма, которую сам
`docs/fluxo.yml` уже предписывал для обеих ролей, только построенная
до предусмотренного триггера. Ни GenServer, ни агента LLM, ни нового
HTTP-маршрута.

### Что скрипт измеряет ПО-НАСТОЯЩЕМУ {#o-que-o-script-mede-de-verdade}

- **Настоящая воронка** (`calcularFunil`): сколько сессий произвели хотя бы
  один `executed` `git_commit`, `pr_open` и `git_merge`, и коэффициент
  конверсии между последовательными этапами. Считает СЕССИИ, а не действия.
- **Настоящий lead time** (`calcularLeadTimes`): от первого `executed` `git_commit`
  до первого `executed` `git_merge` той же сессии, используя
  `updated_at` — момент, когда `ExecuteGitActionUseCase` по-настоящему записал
  `execution_result`, а не когда действие было предложено.
- **Настоящая deployment frequency** (`deploymentFrequencyPorDia`): `executed`
  `git_merge`, чей `targetBranch` находится в `PROTECTED_BRANCHES`, сгруппированные по
  дням. Сопоставляется по ССЫЛКЕ с gate `backmerge` (`docs/gates.yml`) — его
  доказательство — CI (`.release/gate.json`), вне досягаемости скрипта,
  который лишь читает базу, поэтому никакого соединения данных нет, лишь тот же
  срез ветки.

### Что скрипт ОБЪЯВЛЯЕТ отсутствующим и почему это не «недостающие данные» {#o-que-o-script-declara-ausente-e-por-quê-isso-não-é-dado-que-falta}

Три метрики остаются в разделе вывода «Не измерено, намеренно», и
решение оставить их так постоянно, пока не изменятся предусловия ниже,
— это не пробел, который нужно закрыть в следующем раунде:

1. **Полная продуктовая воронка (идея → commit).** У `sessions` нет
   `storyId` — [RN-230](../business-rules/autenticacao.md#rn-230) уже объявляет этот
   пробел во вкладке Criativo (`apps/web/src/routes/ProjectSessionsTab.tsx`).
   Его закрытие потребовало бы новой схемы (новый столбец, возможно migration в
   `sessions` или связующая таблица), вне охвата этого направления по
   принципу: **никаких migrations в этом раунде**.
2. **Доказательство принятия по функции.** В отличие от первого, это не
   данные, которые не хватает СОБРАТЬ: это возможность, у продукта для которой сегодня нет
   никакого ПУТИ. Brabo не инструментирует проекты, которые он
   СТРОИТ, — не существует конвейера телеметрии использования, выходящего из
   сгенерированного кода, ни продуктового решения о том, как бы он существовал. Объявить
   «отсутствует» здесь следовало тому же принципу, что ADR 0042 для оценки
   модели и ADR 0077 (RN-210) для «идеального» рейтинга: никогда не приближать
   числом, которое казалось бы настоящим.
3. **MTTR и change failure rate.** Оба требуют сигнала ИНЦИДЕНТА
   реального production, та же зависимость, которую `docs/fluxo.yml` уже фиксирует
   для ролей `secops-runtime`/`platform` (`status: proposto`/
   `planned`, включение синхронизировано с `DEPLOY_ENABLED`). Это работа
   другого направления, не этого.

## Последствия {#consequências}

- `docs/fluxo.yml`: `analytics` и `delivery-metricas` переходят из
  `status: proposto` в `status: active`, с `saidas_alvo`, переписанным
  в `saidas` (то, что реально сегодня), плюс явное поле `lacunas`
  (то, что остаётся `status: lacuna`, без удаления объявления).
- `apps/api/package.json`: новая запись `"analise:funil"`.
- Ни migration, ни нового HTTP-маршрута, ни нового экрана.
- RN-320..322 в `docs/business-rules.md` покрывают форму скрипта (RN-320),
  семантику воронки и lead time (RN-321) и deployment frequency
  плюс три объявленных отсутствия (RN-322).

## Рассмотренные альтернативы {#alternativas-consideradas}

**Ждать органического триггера каждой роли.** Это был стандартный план
`docs/fluxo.yml`, и он остаётся поведением модели команды по умолчанию
для остальных ролей `proposto`. Отвергнуто здесь лишь потому, что владелец
продукта явно решил ввести заранее, — это не прецедент для заблаговременного ввода
остальных ролей `proposto` без эквивалентного решения.

**Агент LLM `analytics`, читающий базу и пересказывающий воронку.**
Отвергнуто по самому критерию разделения, который `docs/fluxo.yml` уже
объявлял для `delivery-metricas` («никогда не становится агентом») и который это
решение распространяет на `analytics`: отчёт детерминирован — суммирует,
группирует, фильтрует по статусу — и не нуждается в модели для интерпретации.
Агент здесь был бы расходом на LLM без прироста информации.

**Приблизить три отсутствующие метрики через прокси** (напр.: считать
`chat.message` прокси «использования» или время до следующего commit —
прокси MTTR). Отвергнуто: прокси, который выглядит как настоящая метрика и
не является ею, — это ошибка, которую ADR 0042 уже назвал для оценки модели, — лучше
«—» с записанной причиной, чем число, которое учит неправильному.

## Ссылки {#referências}

- `docs/fluxo.yml` (блоки `id: analytics`, `id: delivery-metricas`)
- `apps/api/scripts/analise-funil.ts` / `apps/api/scripts/medir-execucao.ts`
  (прецедент формы, Фаза 13b)
- `apps/api/src/domain/git/git-action-execution-result.ts`
- `docs/gates.yml` (gate `backmerge`)
- [RN-230](../business-rules/autenticacao.md#rn-230) — пробел идея → commit, уже
  объявленный во вкладке Criativo
- [ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md) —
  принцип никогда не притворяться, что существуют несуществующие данные
- [ADR 0077](0077-ranking-de-modelos-por-capacidade-sem-nota-inventada.md) —
  тот же отказ, применённый к «идеальной модели»
