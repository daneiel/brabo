---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0010 — Агент Arquiteto: ADR через настоящую PR, module_map и перекрёстная валидация

- Статус: принят
- Дата: 2026-07-24
- Фаза: 3b (финальная сессия — закрывает Фазу 3)

## Контекст {#contexto}

Замыкает цикл Criativo → PO → **Arquiteto**. Активированный принятым handoff от PO,
Arquiteto производит: (a) **ADR**, закоммиченные в `docs/adr/` репозитория ПРОЕКТА через
git-конвейер Фазы 2, в ветке `feature/adr-*`, с **настоящей PR**, которую пользователь одобряет/мержит;
(b) **module_map**, проверенный на циклы зависимостей. Вводит **перекрёстную валидацию**
(story переходит в `ready`, только если все модули, на которые она ссылается, существуют в действующем
module_map) и выдаёт **insights** о напряжении правило↔архитектура.

## Решения {#decisões}

### 1. ADR = новый ActionType `open_adr_pr` с git-исполнителем {#1-adr--novo-actiontype-open_adr_pr-com-executor-git}
У git-действий не было исполнителя после одобрения (`ApproveActionUseCase` маршрутизировал лишь
`terminal`). Мы добавили `open_adr_pr` (git-эффект, `require_approval`, минимальная роль
maintainer). Инструмент `propose_adr` Arquiteto создаёт proposed_action (существующий конвейер);
при одобрении `ApproveActionUseCase` направляет в `ExecuteAdrPrUseCase`, который через
`GitProviderContract` (Фаза 2) делает `createBranch(feature/adr-<slug>)` +
`commitFiles(docs/adr/<slug>.md)` + `openPullRequest` и записывает `executionResult`
{pullRequestUrl, …}. **Два шага пользователя**: одобрить действие (открывает PR) и смержить
настоящую PR в provider. Merge остаётся за пользователем (приложение лишь открывает PR — как требует приёмка).

### 2. module_map в собственной таблице, проверяемый на циклы в домене {#2-module_map-em-tabela-própria-validado-contra-ciclos-no-domínio}
Выделенный инструмент `create_module_map` (не `emit_artifact`): его нужно ХРАНИТЬ для
перекрёстной валидации. Таблица `module_maps` (неизменяемая история; **действующий = наибольший version**).
`domain/architecture/module-graph.ts` обнаруживает циклы (DFS) и **отклоняет** карту (ошибка →
tool-result). Также выдаёт `artifact.module_map` в event log (повествование).

### 3. Перекрёстная валидация story↔module_map (блокировка + повторная проверка) {#3-validação-cruzada-storymodule_map-bloqueio--revalidação}
Stories получают `module_ids[]` (jsonb). `TransitionStoryUseCase` (draft→ready): помимо
готовности (DoD/DoR/RF/правило) требует, чтобы ВСЕ `module_ids` существовали в действующем module_map
(`assertModulesResolved`) — пустой moduleIds проходит (это открытый пункт, а не блокировка, с уважением к
stories предыдущей сессии). Новый module_map **перепроверяет** stories `ready` и
**понижает до draft** осиротевшие (удалённый модуль), с событием `backlog.story_demoted`, — которое и
является уведомлением (появляется в ленте/колокольчике через опрос). Arquiteto связывает модули со stories через
`assign_story_modules` (проверяет существование) — так story начинает ссылаться на
валидные модули.

### 4. Arquiteto как GenServer с инструментом `:pipeline` {#4-arquiteto-como-genserver-com-tool-pipeline}
`ArquitetoServer` повторяет `PoServer` (streaming + ограниченный цикл tool use + регидратация
+ kickoff). Инструменты: `create_module_map`/`assign_story_modules`/`emit_insight` (`:direct`) и
`propose_adr` (`:pipeline` → `propose_action`). **PO** получил `offer_handoff` и начинает
предлагать handoff Arquiteto в конце kickoff; пользователь принимает (поток
`AcceptHandoffUseCase`), активируя Arquiteto по тому же правилу активации сессии 1.

### 5. Insights как типизированный артефакт {#5-insights-como-artefato-tipado}
`emit_insight` записывает `artifact.insight`, когда модель видит напряжение правило↔архитектура (напр.:
RNF без модуля, который его обслуживает). Без логики домена — это суждение агента, повествуемое в
ленте.

## Последствия {#consequências}

- Обзор проекта получает раздел **Arquitetura**: module_map (модули с
  `depends_on` в чипах), ADR (ссылка на PR + метка статуса) и открытые пункты перекрёстной
  валидации красным. Кнопка принятия handoff в сессии стала общей (любой
  агент), а composer направляет самому продвинутому активному агенту.
- Тесты: домен (`module-graph` — цикл отклонён, `module-resolution`), use case
  (`CreateModuleMap` отклоняет цикл + перепроверяет/понижает сироту; `TransitionStory` блокирует ready
  с отсутствующим модулем; `ExecuteAdrPr` с фейковым GitProvider открывает PR) и `arquiteto_server`
  (kickoff выстраивает цепочку module_map→assign→ADR→insight; цикл становится tool-result с ошибкой;
  broadcast; регидратация).

## Область {#escopo}

Последняя сессия Фазы 3. Не реализует агентов выполнения (Фаза 4). Учётные данные, используемые
для открытия PR, — учётные данные одобрившего (`decidedBy`), согласованно с подготовкой (Фаза 2).
Без Bitbucket/GenericGitProvider; очереди в Postgres (Oban).
