---
sidebar_position: 13
traducao_de: 929963d24eb727bd64875486f2f1889172f3084a
---

# Аудит: fluxo.yml × код (v3, ADR 0085) {#audit-fluxoyml--code-v3-adr-0085}

Изолированная сессия аудита — **только чтение**. Сопоставляет `docs/fluxo.yml`
(целевую модель, объявленную ADR 0085) с реальным кодом, чтобы ответить на два
вопроса: чего не хватает, чтобы код соблюдал всё, что поток объявляет как
`active`, и что действительно выстроено лестницей за каждым триггером
[таблицы активации](modelo-de-time.md#activation-trigger-table) в
`modelo-de-time.md`. Ни одна строка production-кода не изменена в этой
сессии; ни один из трёх документов-моделей (`fluxo.yml`, `gates.yml`,
`agent-areas.ts`) не редактировался — каждое найденное между ними расхождение
трактуется как **находка**, а не как разрешение исправить попутно.

> Доктрина ADR 0085: роль `proposto` объявляет, кто её поглощает сегодня, и
> объективный критерий разделения — целевая оргструктура — это последовательность
> активации, а не стремление. Этот аудит не предвосхищает ни одной роли
> `proposto`/`planned`; там, где найдено что-то сверх того, что должно существовать,
> это явно помечено как находка.

## Как читать этот документ {#how-to-read-this-document}

- **Раздел A — Расхождения.** Поток объявляет X, код (или соседний `gates.yml`)
  делает Y. Это конфликт между источниками, требующий решения владельца продукта, —
  ни одно здесь не исправлено.
- **Раздел B — Пробелы активных ролей.** Объявленная работа (никогда не
  «proposto») над ролями, которые уже действуют сегодня, — реализуема уже сейчас, без
  ожидания какого-либо триггера.
- **Раздел C — Выстроено за триггером.** Что разблокировал бы каждый триггер таблицы
  активации, с оценкой объёма и с указанием, сработал ли он уже.
- **Раздел D — План волн.** Предложение последовательности, упорядоченное от
  gate, дешевле всего проверяемого скриптом, к самому дорогому (требующему
  ADR и продуктового решения).

---

## A. Расхождения {#a-divergences}

| # | Серьёзность | Пункт | Доказательство |
|---|---|---|---|
| A1 | **Критическая** | `gate_saida: paralelismo-autorizado` у `dev-lead` — `docs/fluxo.yml` (роль `dev-lead`) объявляет `status: ativo`; `docs/gates.yml:239-248` объявляет `status: planned` с комментарием «FASE 14d — entra active quando ela fechar». FASE 14d закрылась 2026-08-07 (в тот же день, что и FASE 15, создавшая `gates.yml`), и механизм с тех пор активен, протестирован и в production — `gates.yml` после этого ни разу не обновлялся. | Реальный механизм: `apps/api/src/application/use-cases/execution/request-parallelization.use-case.ts:35-78` (выше потолка создаёт `proposed_action` типа `parallelize`); запрет автоодобрения в `apps/api/src/domain/actions/decide.ts:266-276` (`parallelize`/`raise_max_parallel` никогда не выходят из `require_approval`); тесты: `apps/api/test/application/use-cases/execution/request-parallelization.use-case.spec.ts:97`, `apps/api/test/domain/actions/decide.spec.ts:273-303`. Сам `docs/fluxo.yml` уже регистрирует этот gate как `ativo` — расхождение `gates.yml` × (fluxo.yml + код), а не fluxo.yml × код. |
| A2 | Высокая | Выход `plano-de-paralelismo` у `dev-lead`, объявленный `via: proposed_action` (RN-083/154). Код производит простое событие `execution.plan_proposed` (`apps/engine/lib/engine/agents/dev_lead_tools.ex:14-18,60-77`), **без** конвейера одобрения — намеренное решение, задокументированное в самом комментарии кода («transformar a proposta em ação a decidir faria o usuário decidir duas vezes»). `proposed_action` типа `parallelize`, который действительно существует (та же деталь, что в A1), запускается **действием пользователя в UI**, запрашивающим подкрепление выше потолка (`apps/web/src/routes/ProjectOverviewTab.tsx:361` → `POST /sessions/:sessionId/execution/parallelize`), а не исходным выходом плана dev-lead. `fluxo.yml` сливает два разных механизма в один выход. | `apps/engine/lib/engine/agents/dev_lead_tools.ex:14-18,60-77`; `apps/web/src/routes/ProjectOverviewTab.tsx:361`; `apps/engine/lib/engine_web/router.ex:57`. |
| A3 | Средняя | Машина состояний `dev` — `fluxo.yml:134` объявляет 4 состояния (`working\|awaiting_gate\|idle\|idle_tripped`); в реальном коде их **5**: добавлено `:awaiting_approval` (Фаза 12e, ADR 0052) — сохраняемое состояние с собственными переходами, не переходное. | `apps/engine/lib/engine/dev/dev_agent_server.ex:17-18,300-333,622-654`. |
| A4 | Низкая | Ссылка на RN-160, прикреплённая ко входу `backlog-promovido` (источник `po`) Arquiteto. Настоящая RN-160 касается gate «Confirmar arquitetura pronta» на стороне **выхода** (Arquiteto → Dev Lead), а не входа PO → Arquiteto. | `docs/business-rules.md:5606-5622` vs. `docs/fluxo.yml` (роль `arquiteto`, входы). |
| A5 | Низкая | Ссылка на RN-161, прикреплённая к выходу `handoff-duplo` Arquiteto. Настоящая RN-161 (ADR 0069) касается **следующего** шага — принятие handoff к Dev Lead цепочкой запускает активацию выполнения, — а не самого двойного handoff. | `docs/business-rules.md:5624-5644` vs. `docs/fluxo.yml` (роль `arquiteto`, выходы). |
| A6 | Низкая | Gate «Confirmar arquitetura pronta» (RN-160, ≥1 продвинутая история) гарантируется только на **клиенте** (`SessionPage.tsx`, `hasPromotedStory`); backend (`OfferInfraHandoffUseCase`) не перепроверяет. Прямой вызов внутреннего маршрута, минуя UI, обошёл бы правило. Это не расхождение, объявленное в `fluxo.yml`, — это дополнительная находка аудита. | `apps/api/src/application/use-cases/agents/offer-infra-handoff.use-case.ts:19-38`. |
| A7 | Информационная | Выходной артефакт Criativo в коде — `artifact.product_brief`, а не буквально `necessidade-de-negocio` — это то же понятие с другим именем события; терминологическая неточность, а не структурная. | `apps/engine/lib/engine/agents/criativo_server.ex:396-420`. |
| A8 | Низкая | Вход `worktree-por-agente` у `dev` помечен «origem: harness»; `WorktreeManager` живёт в `Engine.Dev` и не является одним из 4 компонентов, перечисленных для роли `harness` (`PromptAssembler`, `ToolLoop`, `ContextManager`, `Hooks`, `fluxo.yml:244`). | `apps/engine/lib/engine/dev/worktree_manager.ex:19-49` vs. `docs/fluxo.yml` (роль `harness`, компоненты). |
| A9 | Нюанс (не расхождение) | Выход `pr-remota` у `dev` объявляет одновременное назначение `[area-qa, secops]`; реальный механизм последователен и упорядочен машиной состояний — QA всегда до SecOps, никогда параллельно. Это не противоречит fluxo.yml (оба действительно конечные назначения), но может навести на прочтение как одновременный fan-out. | `apps/api/src/domain/execution/pr-gate-state-machine.ts:21-30`. |

**Находка субагента, отброшенная проверкой.** Первоначальное исследование
указало на метку `achado_aberto: AE` (`fluxo.yml:158`, роль `area-qa`) как на
«осиротевшую ссылку». Проверка: **это реальная и задокументированная ссылка** —
`docs/explanation/achados-execucao-real.md:618` (`### AE. O agente de QA
tenta consertar o código que julga (P2)`) и `docs/explanation/backlog.md:40`.
Расхождения здесь нет; зафиксировано, чтобы не повторять поиск.

---

## B. Пробелы активных ролей (работа, реализуемая уже сейчас) {#b-gaps-in-active-roles-already-implementable-work}

Все пункты ниже касаются ролей со `status: active` — ни один
не зависит от того, чтобы сначала появилась роль `proposto`/`planned`.

| # | Пробел | Где в модели | Чего конкретно не хватает |
|---|---|---|---|
| B1 | **Делегирование Dev Lead → dev** (ADR 0053, пункт 5) | `fluxo.yml`, выход `delegacao` у `dev-lead`, `status: lacuna` | Подтверждено отсутствие: `dev_lead_server.ex` регистрирует только `DevLeadTools.spec()` (`apps/engine/lib/engine/agents/dev_lead_server.ex:75`); таблица `delegations` уже принимает обобщённый `area: text` (`apps/api/src/db/schema.ts:1051-1091`), но единственные вызывающие `RecordDelegationUseCase` — `qa_lead_server.ex` и `infra_lead_server.ex`, ни один с `area = 'dev'`. Шаблон для копирования уже существует дважды (QA и Infra); не хватает его воспроизведения в Dev Lead. |
| B2 | **Gate `necessidade-validada`** (Criativo → PO) | `modelo-de-time.md`, «Estado da malha» — «gate novo = ADR» | Не существует ни в `gates.yml`, ни в коде. `modelo-de-time.md` уже перечисляет открытое предложение («Anti-padrão do Criativo como validação real do gate») — не хватает решения об объективном критерии, ADR и регистрации в `gates.yml` (может появиться как `warn`, как `implementavel`/`operavel`). |
| B3 | **Gate `implementavel`** (gate_futuro у dev-lead) | `docs/gates.yml:250-259`, `status: planned`, владелец `dev-lead` | Dev-lead уже активная роль; gate не зависит от существования `qa-estrategia`/`appsec` — наоборот: именно СОЗДАНИЕ этого gate их активирует (см. C1). Не хватает критерия «реализуемости» (напр.: история с минимальным критерием приёмки, без блокирующей зависимости) и регистрации в `gates.yml`. |
| B4 | **Продуктовые метрики → PO** | `fluxo.yml`, вход `metricas-de-produto` у `po`, `status: lacuna`; saída_alvo у `analytics` (proposto) | У `po_server.ex` нет ни одного инструмента продуктовых метрик (`apps/engine/lib/engine/agents/po_server.ex:86-99`). `modelo-de-time.md:21-25` уже фиксирует принцип: «analytics nasce como saída nova do `medicao` antes de ser papel» — то есть это НЕ нужно ждать, пока роль `analytics` отделится; это расширение `medicao` (уже активного, с `sumGroupedBy` в production), которое, появившись, само и есть пересечение триггера «продуктовые метрики становятся входом PO» (см. C2). |
| B5 | **`docs/gates.yml` устарел** (та же находка A1) | — | Исправить `status: planned` → `active` для `paralelismo-autorizado`, с доказательством `event_log`/`proposed_action.created`, отфильтрованным по `actionType: parallelize`, `onde: request-parallelization.use-case.ts`. Это исправление метаданных, мгновенно проверяемое `pnpm --filter api validacao:gates` — скрипт уже имел бы реальное доказательство для цитирования. |
| B6 | **RN-160 без перепроверки в backend** (находка A6) | — | Необязательное укрепление: `OfferInfraHandoffUseCase` начинает требовать ≥1 продвинутую историю перед выдачей двойного handoff; сегодня кнопку блокирует только UI. |
| B7 | **Отчёт DORA через `medicao`** | `fluxo.yml`, роль `delivery-metricas` (proposto, `status: — (nunca)` в таблице триггеров — «vira RELATÓRIO do medicao, nunca agente») | Поскольку роль никогда не становится агентом, этот пункт не стоит ни за каким триггером — это работа, доступная уже сегодня над уже активным `medicao`: lead time, deployment frequency, MTTR и change failure rate, извлечённые из event log + `gates.yml`, по тому же шаблону, что `medir:execucao`/`sumGroupedBy`. |

---

## C. Выстроено за триггером {#c-staged-behind-a-trigger}

Таблица активации (`modelo-de-time.md:52-62`), каждая строка с реальным состоянием,
проверенным в этом аудите.

| Триггер | Какие роли активирует | Сработал? | Оценка объёма, если пересечён |
|---|---|---|---|
| Создан gate `implementavel` | `qa-estrategia` + `appsec` — «второй момент» **существующих** агентов (`qa-lead`/`secops` получают режим «design», без нового агента) | **Нет.** `implementavel` остаётся `planned`, ни один маршрут/use case его не потребляет (исчерпывающий поиск: ноль вхождений вне `gates.yml`) | **M.** Зависит от того, закроется ли сначала B3. Затем: `dev-lead` вызывает `qa-lead`/`secops` в режиме «design» (план тестирования, threat-model) перед предложением параллелизма — переиспользует агентов, без новой таблицы и нового worker. |
| Продуктовые метрики становятся обязательным входом PO | `analytics` отделяется от `medicao` | **Нет** — но работа по его пересечению — это B4, уже доступная сегодня | **S/M** для производства метрики (B4); отделение самой роли `analytics` стоит за другим субъективным критерием («когда станет обязательным входом», ещё открытое предложение в `modelo-de-time.md`) — продуктовое решение, а не дополнительный технический объём. |
| `DEPLOY_ENABLED` переключается | `platform` активируется → затем `secops-runtime` | **Нет.** Ни одного реального чтения `DEPLOY_ENABLED` в коде приложения — только упоминания в комментариях/документации; `tag-release.yml` явно документирует, что скрытого job деплоя нет | **L.** Собственная программа: реальное окружение деплоя, GitHub Environments, зелёный конвейер, потребляемый `platform`, SLO/дашборд/runbook — и только потом `secops-runtime` (обнаружение с реальным трафиком). Крупнейший пункт backlog потока. |
| Anamnese выходит из доработки | Триггер `staff` снова получает владельца | **Нет — и движение пошло в обратную сторону.** `ANAMNESE_ENABLED=false` с 2026-08-10, явное решение пользователя («hoje ele não está trazendo dados de muito valor», RN-115, `docs/business-rules.md:4597-4655`) | Незакрытый вопрос «autor-da-proposta-de-teto (RN-086)», упомянутый в `fluxo.yml:263`, **реализован и протестирован в коде** (`ProposeMaxParallelUseCase`, жёстко заданный актор `anamnese`; `apps/engine/lib/engine/workers/anamnese_worker.ex:270-286`; тесты в `anamnese_worker_test.exs:387-411`) — лишь **спит под флагом**. Это не инженерный пробел; это приостановленное продуктовое решение, ожидающее «будущей доработки того, что выводит Anamnese» (`docs/explanation/backlog.md:349`). |
| Управляемый проект с собственным UI | `ux-designer` отделяется от Criativo | **Нет.** Поиск артефакта прототипа/дизайна, переданного клиентскому проекту (вне `design_handoff_brabo/`, который принадлежит самому Brabo): ноль вхождений | **L.** Зависит от того, получит ли вкладка Code возможность РЕДАКТИРОВАНИЯ/дизайна UI — сегодня она объявлена только для чтения (FASE 26). |
| Реальный объём данных | `dbre` отделяется от Dev Lead/Platform | **Нет.** Ни одна метрика нагрузки/объёма реального production в коде не упоминается | **L.** Зависит от реальной эксплуатации в production с масштабом, сегодня вне контроля команды. |
| — (никогда) | `delivery-metricas` становится отчётом, а не агентом | N/A по замыслу | См. B7 — сам отчёт не ждёт триггера. |

---

## D. Предлагаемый план волн {#d-proposed-wave-plan}

Упорядочено от gate, дешевле всего проверяемого скриптом (чистые метаданные, без
новой логики), к самому дорогому (требует ADR и продуктового решения). Каждая волна —
будущая сессия с единственным результатом — **ни одна не начата в этой
сессии**.

| Волна | Единственный результат | Пункты | Стоимость | Проверка |
|---|---|---|---|---|
| **1** | `fluxo.yml`/`gates.yml` актуальны | A1/B5 (статус gate `paralelismo-autorizado`), A3–A5, A8 (исправлены ссылки на RN и машина состояний `dev`) | S | `pnpm docs:check` зелёный; `pnpm --filter api validacao:gates`, цитирующий реальное доказательство для `paralelismo-autorizado` |
| **2** | Dev Lead делегирует dev; готовность архитектуры доказывается в backend | B1 (приватный инструмент делегирования в dev-lead, по тому же шаблону, что `qa_lead_server.ex`/`infra_lead_server.ex`), B6 (RN-160 перепроверяется в `OfferInfraHandoffUseCase`) | M | Тест, доказывающий запись `delegations` с `area='dev'`; тест, что внутренний маршрут отклоняет двойной handoff без продвинутой истории |
| **3** | `medicao` говорит о продукте | B7 (отчёт DORA), B4 (продуктовые метрики как вход PO — пересекает триггер C2) | M | Скрипт извлекает 4 метрики DORA из известной фикстуры; тест, что PO читает `metricas-de-produto`, когда они есть |
| **4** | Рождается gate `implementavel` | B3 (критерий «реализуемости» в dev-lead, регистрация в `gates.yml` — может появиться как `warn`) | M, с ADR | ADR принят; `validacao:gates` покрывает новое доказательство |
| **5** | QA и SecOps получают второй момент | C1 (`qa-lead`/`secops` в режиме «design»: план тестирования, threat-model) — зависит от закрытой Волны 4 | M | Тест, что dev-lead получает план тестирования и threat-model до предложения параллелизма |
| **6** | Gate `necessidade-validada` | B2 (объективный критерий проверки потребности, ADR, регистрация в `gates.yml`) | M, с ADR и предварительным решением | ADR принят; `validacao:gates` покрывает новое доказательство |

**Вне волн** (зафиксированный backlog, без оценки сессии — зависят от
решения о масштабе/реальной инфраструктуре или от того, что владелец продукта снова что-то включит, а не от
планируемой инженерной работы): `DEPLOY_ENABLED`/`platform`/`secops-runtime` (C3, L,
собственная программа), повторная активация Anamnese/триггера `staff` (C4, решение
пользователя), `ux-designer` (C5, зависит от того, получит ли вкладка Code редактирование — заморожена
как только для чтения в FASE 26), `dbre` (C6, зависит от реального объёма данных
в production).

---

## Заметка об инфраструктуре документации (вне объёма этого аудита) {#documentation-infrastructure-note-out-of-scope-for-this-audit}

`docs/explanation/modelo-de-time.md` существует и полон, но **не
перечислен в `website/sidebars.ts`** — доступен только по прямой ссылке, а не
через меню сайта. Это не находка `fluxo.yml` × код; это ранее существовавший пробел
публикации, отмеченный здесь, чтобы не потеряться, без исправления
в этой сессии (вне объявленного объёма: «никаких изменений кода»).

---

## Итог {#summary}

- **9 расхождений** (A1–A9): 1 критическое (gate ошибочно помечен `planned` в
  документе, который уже работает как `active`), 1 высокое (механизм одобрения плана
  параллелизма не совпадает с объявленным), 2 средних, 4 низких, 1
  информационное, 1 нюанс без реального противоречия.
- **7 пробелов активных ролей** (B1–B7), все реализуемы без ожидания
  триггера.
- **7 триггеров таблицы активации**, ни один не сработал — один из них
  (Anamnese) пошёл в обратную сторону с момента последнего чтения fluxo.yml.
- **Ноль находок кода, предвосхищающего роль `proposto`/`planned`** —
  объявленные пробелы действительно пусты во всех проверенных
  ролях.
