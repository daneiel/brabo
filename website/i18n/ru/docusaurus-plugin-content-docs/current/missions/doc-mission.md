---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
---

# Миссия: полная и самоподдерживающаяся документация этого репозитория

Вы — Staff Engineer + Technical Writer, отвечающий за создание всей
документации этого репозитория, её публикацию в виде сайта Docusaurus и — что
важнее всего — установку механизмов, которые поддерживают её синхронизацию с кодом
при каждом будущем изменении.

Аудитория тройная:
(a) новый разработчик, которому нужно открыть PR в первую неделю;
(b) человек со стороны, оценивающий, решает ли проект его задачу;
(c) мейнтейнер в 3 часа ночи, пытающийся понять, почему что-то сломалось.

---

## КОНТЕКСТ ПРОЕКТА {#contexto-do-projeto}
Заполните то, что известно; остальное выясняется чтением репозитория.

- **Название:** <<< >>>
- **Репозиторий:** <<< https://github.com/owner/repo >>>
- **Платформа:** <<< GitHub | GitLab >>>
- **Ветка по умолчанию:** <<< main >>>
- **Бизнес-домен одной фразой:** <<< >>>
- **Язык документации:** <<< pt-BR | en | оба (i18n Docusaurus) >>>
- **Модель:** **совместный open source** проект. Любой может открыть
  issue и PR, но **каждый merge проходит через моё одобрение** (модель BDFL).
- **Лицензия:** **MIT** — правообладатель <<<Nome/Org>>>, год <<<2026>>>
- **Мой handle:** <<< @usuario >>>
- **Контактный e-mail (безопасность / кодекс поведения):** <<< >>>
- **Финансовая поддержка:** Buy Me a Coffee — <<< https://buymeacoffee.com/usuario >>>
- **Канал общения:** <<< GitHub Discussions | Discord | пока нет >>>
- **URL сайта документации:** <<< https://usuario.github.io/repo >>>

---

## НЕПРЕЛОЖНЫЕ ПРИНЦИПЫ {#princípios-inegociáveis}

1. **Ничего не выдумывать.** Каждое утверждение должно прослеживаться до кода, конфигурации, коммита,
   PR, issue или существующей документации. Если что-то определить не удаётся, пишется
   дословно `> **TODO(humano):** <pergunta específica>`. Короткая и
   правдивая документация лучше длинной и выдуманной.
2. **Никогда не раскрывать секреты.** Документируются только ИМЕНА переменных и места, где они
   читаются. Если в истории найдены учётные данные, нужно остановиться и сообщить мне как об инциденте.
3. **Единый источник истины.** Markdown живёт в `docs/` в корне. Docusaurus
   **читает** оттуда и никогда не дублирует. Если создан `website/docs/`, это ошибка.
4. **README — витрина, а не руководство.** Раздел длиннее ~20 строк переезжает в `docs/`,
   а в README остаётся только ссылка.
5. **Стабильная документация.** Писать так, чтобы обычные изменения кода не
   делали документ недействительным (особенно ARCHITECTURE.md).
6. **Спрашивать разрешения перед записью.** У фаз есть точки остановки.

---

# ФАЗА 1 — РАЗВЕДКА
Только чтение. На этой фазе никакие файлы не создаются и не редактируются.

## 1.1 Структура и стек {#11-estrutura-e-stack}
- `git ls-files | head -300` и дерево каталогов до 3 уровней
- Манифесты: `package.json`, `pom.xml`, `build.gradle`, `requirements.txt`,
  `pyproject.toml`, `go.mod`, `Gemfile`, `*.csproj`, `Cargo.toml`, `composer.json`
- Инфраструктура: `Dockerfile`, `docker-compose.yml`, `k8s/`, `helm/`, `terraform/`,
  `.github/workflows/`, `.gitlab-ci.yml`, `Makefile`, `Procfile`
- Конфигурация: `.env.example`, `application.yml`, `appsettings.json`, `config/`.
  Перечислить КАЖДУЮ переменную окружения и место, где она читается в коде.
- Точки входа (`main`, `index`, `app`, `cmd/`, `server`) и горячий путь типичного
  запроса от начала до конца.
- Скрипты (npm scripts, цели Makefile, `bin/`, `scripts/`): имя, что делает,
  когда использовать, предварительные условия.
- Автогенерируемые справочные источники: OpenAPI/Swagger, GraphQL schema, JSON Schema,
  Protobuf, экспортируемые типы TS, docstrings. **Отметить каждый** — они идут в
  автоматическую генерацию на Фазе 5, а не в ручное написание.
- Тесты: фреймворк, как запускать, текущее покрытие, если есть.

## 1.2 История Git {#12-história-do-git}
```bash
git log --oneline -n 500
git log --pretty=format:'%h|%ad|%an|%s' --date=short -n 800
git shortlog -sne --all                                          # donos do código
git log --format='%ad' --date=format:'%Y-%m' | sort | uniq -c    # ritmo do projeto
git tag --sort=-creatordate | head -30                           # releases
git log --diff-filter=A --name-only --pretty=format:'%ad' --date=short | head -100
git log --numstat --pretty=format:'' | awk '{print $3}' \
  | sort | uniq -c | sort -rn | head -40                         # hotspots
git log --format='%s' | grep -iE 'BREAKING|revert|migrat|refactor|rename'
```
Извлечь: архитектурные повороты, нестабильные модули (hotspot = документировать лучше и
отслеживать в `.docmap.yml`), реально используемое соглашение о коммитах, владельцев по областям.

## 1.3 PR, issues и обсуждения {#13-prs-issues-e-discussões}
GitHub (если `gh` аутентифицирован):
```bash
gh repo view --json name,description,topics,homepageUrl,licenseInfo,defaultBranchRef
gh pr list --state merged --limit 150 --json number,title,body,labels,mergedAt,author,files
gh issue list --state all --limit 100 --json number,title,body,labels,state
gh release list --limit 30
gh api repos/{owner}/{repo}/labels
```
GitLab: `glab mr list --merged`, `glab issue list`, `glab release list`.
Если ни один CLI недоступен, об этом нужно сказать явно, продолжить с чистым Git и
попросить у меня экспорт.

Искать: описания, объясняющие **почему** принято решение (сырьё для
ADR), обсуждавшиеся компромиссы, исправления багов, раскрывающие неявное бизнес-правило,
breaking-изменения, закономерности отклонённых PR.

## 1.4 Бизнес-правила {#14-regras-de-negócio}
Просмотреть код в поисках **доменной** логики, а не обвязки:
- валидации, guard clauses, `if` с бизнес-константами, машины состояний,
  enum статусов, расчёты (проценты, налоги, скидки, SLA, лимиты)
- имена сущностей и единый язык команды
- **тесты — лучший источник уже записанных правил** — читать `*_test`, `*.spec`,
  `features/` и извлекать правила из названий кейсов
- миграции и схема: constraints, unique, not null, defaults — это правила
  Составить глоссарий доменных терминов с выведенным определением.

## 1.5 Аудит лицензий {#15-auditoria-de-licenças}
- Node: `npx license-checker --summary` · Python: `pip-licenses`
- Go: `go-licenses report ./...` · Java/.NET: читать POM/csproj
  Отметить сильный copyleft (GPL-2.0/3.0, AGPL-3.0) или неоднозначную лицензию, так как это конфликтует
  с разрешительным обещанием MIT. **Никаких юридических выводов** — записать
  `> **ATENÇÃO(humano):** dependência X sob AGPL-3.0, verificar`. Если всё
  разрешительное (MIT/BSD/Apache/ISC), утверждать это. Искать также сторонний
  vendored-код, ассеты, шрифты и иконки, требующие указания авторства.

## ⛔ РЕЗУЛЬТАТ ФАЗЫ 1 — ОСТАНОВИТЬСЯ ЗДЕСЬ {#-entrega-da-fase-1--pare-aqui}
Представить и дождаться моего OK:
1. Резюме на ~15 строк о том, что представляет собой проект и что он делает
2. Текстовая диаграмма основного потока
3. Находки из истории (повороты, hotspots, соглашения, риски)
4. Результат аудита лицензий
5. Список найденных автогенерируемых справочных источников
6. Открытые вопросы, на которые могу ответить только я
7. План файлов, которые будут созданы

---

# ФАЗА 2 — БАЗОВАЯ ДОКУМЕНТАЦИЯ
После моего OK. По одному файлу за раз, с показом diff. Без коммита, пока я не попрошу.

Каждый файл в `docs/` создаётся с YAML frontmatter, совместимым с Docusaurus:
```yaml
---
id: architecture
title: Arquitetura
sidebar_label: Arquitetura
sidebar_position: 1
description: <uma frase, usada em SEO e nos cards de índice>
keywords: [arquitetura, code map]
---
```
Расширение `.md` — для чистого содержимого, `.mdx` — **только** когда нужен
React-компонент: строгий синтаксис MDX ломает свободный HTML и литеральную `{`.

### `README.md` — витрина {#readmemd--a-vitrine}
1. **Баннер** вверху. Если его нет, сгенерировать `docs/assets/banner.svg` (1200×300,
   выразительная типографика, 2 цвета в духе продукта) и `logo.svg` (512×512).
   Центрировать с помощью `<p align="center">`.
2. **Бейджи** настоящие и проверяемые: build, деплой сайта документации, `License: MIT`,
   версия (последний тег), язык, PRs welcome, last commit, contributors.
   Никаких фальшивых декоративных бейджей.
3. Слоган в одну строку + абзац «проблема, которую это решает».
4. **Выделенная ссылка на сайт документации** сразу под бейджами.
5. Оглавление с якорями.
6. **✨ Features** — короткие пункты, каждый о пользе, а не о реализации.
7. **🏗️ Архитектура за 30 секунд** — один Mermaid + ссылка на полную документацию.
8. **🚀 Quickstart** — САМЫЙ КОРОТКИЙ путь до «работает на моей машине».
   Copy-paste, предварительные условия с точной версией и **ожидаемый вывод** каждой
   команды, чтобы человек знал, что всё получилось.
9. **⚙️ Конфигурация** — сводная таблица + ссылка на полный справочник.
10. **📜 Скрипты** — таблица `Comando | O que faz | Quando usar`.
11. **🗺️ Roadmap** — выводится из открытых issues и labels.
12. **🤝 Участие** — прямое приглашение + ссылки на
    `/labels/good%20first%20issue` и `/labels/help%20wanted`.
13. **👥 Участники** — виджет contrib.rocks или all-contributors.
14. **☕ Поддержать проект** — ближе к концу. Честная фраза о том, что проект бесплатный и
    поддерживается в свободное время, бейдж Buy Me a Coffee и то, что поддержка делает возможным.
    Без чувства вины, без обещания вознаграждения, без намёка на приоритет для платящих.
15. **📄 Лицензия** — «Распространяется под лицензией MIT. См. [LICENSE](LICENSE).»

### `docs/architecture.md` — в стиле matklad {#docsarchitecturemd--no-estilo-matklad}
- **Bird's eye view**: один абзац, система как чёрный ящик, входы и выходы
- **Диаграмма контейнеров** в Mermaid (стиль C4, уровень 2)
- **Code map**: каждый каталог верхнего уровня — что это, с какого файла начинать чтение
  и для чего он **не** предназначен. Указать точки входа, которые можно найти поиском (entrypoints,
  символы, которые можно грепнуть)
- **Поток запроса/job** от начала до конца в `sequenceDiagram`
- **Границы слоёв и инварианты** — то, что нельзя нарушать никогда
  (напр.: «domain ничего не импортирует из infra»). Это самая ценная часть документа
- **Cross-cutting**: auth, логирование, ошибки, транзакции, кэш, feature flags
- **Данные**: модель, `erDiagram`, стратегия миграций
- **Известный технический долг** — из hotspots и issues с меткой долга

### `docs/business-rules.md` {#docsbusiness-rulesmd}
- Назначение и бизнес-контекст, акторы/персоны
- Глоссарий единого языка
- Пронумерованные правила `RN-001`, каждое с: формулировкой, местом, где оно живёт (`arquivo:linha`),
  тестом, который его покрывает, источником (PR/issue), если найден
- Машины состояний в `stateDiagram`
- Граничные случаи и что происходит, когда что-то идёт не так

### `docs/adr/` {#docsadr}
Один ADR на каждое структурное решение, восстановленное из истории. Формат Nygard:
**Заголовок / Статус / Контекст / Решение / Последствия**, с датой и ссылкой на
исходный PR или коммит. Только весомые решения (база данных, монолит vs сервис, состояние
сессии, модель согласованности) — не «сменили библиотеку дат».
Первым создаётся `0001-registrar-decisoes-com-adr.md`.

### Организация Diátaxis внутри `docs/` {#organização-diátaxis-dentro-de-docs}
```
docs/
  intro.md                 # landing page do site
  getting-started.md       # TUTORIAL: do zero ao primeiro resultado
  how-to/                  # HOW-TO: uma tarefa real por arquivo
  reference/               # REFERÊNCIA: API, env vars, CLI, schema
  explanation/             # EXPLICAÇÃO: trade-offs, contexto histórico
  architecture.md · business-rules.md · runbook.md
  adr/ · assets/
```
Никогда не смешивать четыре типа в одном файле. Учебник, который слишком много объясняет, становится
плохим и как учебник, и как объяснение.

### Прочее {#demais}
- `docs/runbook.md` — если есть деплой: healthcheck, логи, откат, алерты
- `CHANGELOG.md` — восстановленный из тегов и PR, формат Keep a Changelog
- `SECURITY.md` — поддерживаемые версии и приватный канал для сообщений

---

# ФАЗА 3 — СЛОЙ СООБЩЕСТВА

### `.github/FUNDING.yml` {#githubfundingyml}
```yaml
buy_me_a_coffee: <<<handle>>>
```
Не выдумывать другие платформы, которые я не называл.

### `CONTRIBUTING.md` {#contributingmd}
- **Прежде чем писать код**: открыть issue и дождаться согласования. Прямым текстом —
  большой PR без предварительного issue, скорее всего, будет отклонён.
- **Настройка среды разработки за 5 минут.** Если реальная настройка занимает больше, пометить
  `TODO(humano)` — это главный убийца внешнего участия.
- **Как запустить сайт документации локально** (`npm run docs:start`) и правило, что
  **PR, меняющий поведение, должен обновлять соответствующую документацию**, с
  указателем на `.docmap.yml`.
- **Процесс**: fork → ветка (`feat/`, `fix/`, `docs/`) → коммит в формате, который использует
  история → PR в `<<<branch>>>` → мой review → squash merge.
- **Что я принимаю с удовольствием** vs **что я, скорее всего, не приму** (смена
  стека, широкий рефакторинг без обсуждения, новая тяжёлая зависимость, изменение
  объёма). Конкретно — этот раздел экономит время обеим сторонам.
- **Definition of Done**: тесты проходят, lint чистый, **документация обновлена**,
  CHANGELOG затронут, сборка сайта документации без битых ссылок, никаких секретов.
- **Честный SLA**: «обычно ревьюю в течение X дней; это проект в свободное время, если я
  пропаду на неделю, вежливо пингните в PR». Никаких обещаний 24 часов.
- **Признание**: как упоминается участник.
- **Лицензирование inbound = outbound**: отправляя PR, участник соглашается
  лицензировать его под той же MIT. Без CLA. DCO (`git commit -s`) подаётся как
  **необязательный**, с объяснением трения для случайного участника.

### `GOVERNANCE.md` {#governancemd}
Модель BDFL, без высокомерия: у кого есть право merge, как принимается решение, как
выражать несогласие (открыть Discussion, а не спорить в review), как решение становится ADR, и
критерий, по которому кто-то становится мейнтейнером с правом merge.

### `CODE_OF_CONDUCT.md` {#code_of_conductmd}
Contributor Covenant 2.1, официальный текст полностью, с заполненным моим e-mail.
Текст CoC не переписывать.

### `SUPPORT.md` {#supportmd}
Маршрутизирует: вопрос об использовании → Discussions/Discord; воспроизводимый баг → issue о баге;
идея → issue о фиче; уязвимость → SECURITY.md, **никогда** не публичный issue.

### `.github/ISSUE_TEMPLATE/` (формат `.yml`, обязательные поля) {#githubissue_template-formato-yml-campos-obrigatórios}
- `bug_report.yml` — версия, окружение, шаги, ожидаемое vs полученное, логи, чекбокс
  «я искал дубликаты issues»
- `feature_request.yml` — решаемая проблема, рассмотренные альтернативы и
  **готовность реализовать (да/нет)**: отделяет идею от вклада
- `doc_issue.yml` — страница, что неверно или отсутствует, ссылка на сайт
- `config.yml` — `blank_issues_enabled: false` + contact_links на Discussions,
  сайт документации и Buy Me a Coffee

### `.github/pull_request_template.md` {#githubpull_request_templatemd}
Описание, `Closes #`, тип изменения, как тестировать, скриншоты для UI, чеклист
DoD, **включающий «я обновил затронутую документацию (см. `.docmap.yml`)»**, и
чекбокс «я согласен лицензировать этот вклад под MIT проекта».

### `CODEOWNERS` {#codeowners}
`* @<<<handle>>>` — делает меня обязательным ревьюером для всего.

### Метки {#labels}
Компактный набор с готовой командой `gh label create`: `good first issue`,
`help wanted`, `bug`, `enhancement`, `docs`, `docs-needed`, `question`, `wontfix`,
`needs-triage`, `blocked`, `breaking`.

---

# ФАЗА 4 — САЙТ DOCUSAURUS

## 4.1 Scaffold {#41-scaffold}
Установить в `website/`, **без** дублирования содержимого:
```bash
npx create-docusaurus@latest website classic --typescript
```
Зафиксировать зависимости на `3.x` — v4 в разработке с breaking-изменениями.

Добавить в `package.json` корня (или создать его, если нет):
```json
"scripts": {
  "docs:start": "npm --prefix website start",
  "docs:build": "npm --prefix website build",
  "docs:serve": "npm --prefix website serve"
}
```

## 4.2 `website/docusaurus.config.ts` {#42-websitedocusaurusconfigts}
Обязательно настроить:
- `title`, `tagline`, `favicon`, `url`, `baseUrl` (`/<repo>/` для GitHub Pages),
  `organizationName`, `projectName`, `trailingSlash: false`
- **`path: '../docs'`** в preset `docs` — читает единый источник истины
- **`routeBasePath: '/'`** — документация в корне сайта, без отдельной landing page
- **`onBrokenLinks: 'throw'` и `onBrokenMarkdownLinks: 'throw'`** — это превращает
  битую ссылку в падение CI, самый дешёвый механизм против гниения документации
- **`editUrl`** с указанием на `blob/<branch>/docs/` — кнопка «редактировать эту страницу»
  на каждой странице, минимальное трение для вклада в документацию
- **`showLastUpdateTime: true` и `showLastUpdateAuthor: true`** — публично показывает,
  когда страницу трогали в последний раз. Устаревшая страница становится видна.
- **Mermaid**: `markdown: { mermaid: true }` + `themes: ['@docusaurus/theme-mermaid']`
- **Docusaurus Faster** (сборка в 3–4× быстрее, уже стабильно):
```ts
  future: { experimental_faster: true }
```
- **Поиск**: если у меня нет Algolia DocSearch, использовать
  `@easyops-cn/docusaurus-search-local` с `hashed: true`. Не оставлять сайт без поиска.
- **Блог**: включить как канал release notes; иначе `blog: false`
- **i18n**: только если я просил документацию на двух языках (`defaultLocale`, `locales`)
- **Тёмная тема** с `respectPrefersColorScheme: true`
- Navbar с: Docs, Справочник API, Блог, ссылка на GitHub и пункт
  **☕ Поддержать**, указывающий на Buy Me a Coffee
- Footer с лицензией MIT, ссылками сообщества и copyright

## 4.3 `website/sidebars.ts` {#43-websitesidebarsts}
Написан вручную и организован по **Diátaxis**, а не беспорядочно автогенерирован:
```
🚀 Comece aqui   → intro, getting-started
📘 Guias         → how-to/*
🏗️ Arquitetura   → architecture, adr/*
📐 Regras        → business-rules
📖 Referência    → reference/*  (parcialmente autogerada — Fase 5)
💡 Explicação    → explanation/*
🛠️ Operação      → runbook
🤝 Contribuir    → contributing
```

## 4.4 Версионирование {#44-versionamento}
Если у проекта есть опубликованные релизы, настроить `versions` и задокументировать команду
`npm run docusaurus docs:version X.Y` в CONTRIBUTING вместе с правилом, **когда**
версионировать (только на major/minor, никогда на patch — избыточное версионирование умножает
стоимость поддержки документации в N раз).

## 4.5 Деплой — `.github/workflows/docs-deploy.yml` {#45-deploy--githubworkflowsdocs-deployyml}
- Trigger: push в `<<<branch>>>` с `paths: ['docs/**', 'website/**']`
- Job **сборки в каждом PR** (без деплоя), чтобы поймать битую ссылку и ошибку MDX
  до merge
- Деплой на GitHub Pages через `actions/deploy-pages`, с контролируемой конкурентностью
- Кэш `node_modules` и постоянного кэша Rspack

## 4.6 Доработка содержимого {#46-ajustes-de-conteúdo}
- `docs/intro.md` как landing: что это, для кого, и три пути («хочу использовать»,
  «хочу понять», «хочу участвовать»)
- Перенести таблицы env vars и скриптов в `reference/`
- Заменить абсолютные ссылки GitHub относительными ссылками между документами
- `<Tabs>` в командах, которые различаются по ОС или менеджеру пакетов
- Проверить, что Mermaid рендерится в светлой **и** тёмной теме

---

# ФАЗА 5 — НЕПРЕРЫВНАЯ СИНХРОНИЗАЦИЯ
Это самая важная фаза. Документация умирает не от недостатка первоначального
написания, а от дрейфа. Устанавливать механизмы, а не благие намерения.
Порядок предпочтения: **генерировать > проверять > напоминать**.

## 5.1 `.docmap.yml` — карта ответственности {#51-docmapyml--o-mapa-de-responsabilidade}
Создать в корне на основе того, что выяснено на Фазах 1 и 2:
```yaml
# Mapa: mudança de código → documentação que precisa ser revisada.
# Usado pelo Claude Code (/sync-docs) e pelo CI (docs-drift).
version: 1

rules:
  - id: api-surface
    watch: ["src/routes/**", "src/controllers/**", "openapi.yaml"]
    docs:  ["docs/reference/api.md"]
    generated: true          # gerado do OpenAPI, não editar à mão
    severity: block          # bloqueia o PR

  - id: domain-rules
    watch: ["src/domain/**", "src/**/*.rules.*", "migrations/**"]
    docs:  ["docs/business-rules.md"]
    severity: block
    note: "Toda RN alterada precisa da referência arquivo:linha atualizada."

  - id: config
    watch: [".env.example", "src/config/**"]
    docs:  ["docs/reference/configuration.md"]
    generated: true
    severity: block

  - id: architecture
    watch: ["src/**/index.*", "docker-compose.yml", "package.json"]
    docs:  ["docs/architecture.md"]
    severity: warn           # apenas comenta no PR
    note: "Só atualize se mudou fronteira de camada ou dependência estrutural."

  - id: scripts
    watch: ["package.json", "Makefile", "scripts/**"]
    docs:  ["docs/reference/scripts.md", "README.md"]
    severity: warn

  - id: adr-trigger
    watch: ["src/infra/**", "docker-compose.yml", "terraform/**"]
    requires_adr: true
    severity: warn
    note: "Mudança estrutural? Provavelmente merece um ADR."
```
Подогнать пути под реальный репозиторий. Не копировать пример вслепую.

## 5.2 `CLAUDE.md` в корне — постоянные инструкции {#52-claudemd-na-raiz--instruções-permanentes}
Благодаря этому каждая будущая сессия Claude Code по умолчанию обновляет документацию без моих
напоминаний. Писать кратко и в повелительном наклонении:
```markdown
# Instruções do projeto

## Documentação é parte da definição de pronto
Ao alterar código, consulte `.docmap.yml` e atualize os documentos mapeados
**na mesma mudança**. Não deixe para depois e não me pergunte se deve fazer —
faça, e mostre o diff da doc junto com o diff do código.

## Regras
- Fonte de verdade do Markdown: `docs/`. Nunca crie `website/docs/`.
- Arquivos marcados `generated: true` no `.docmap.yml` são gerados: rode o script
  de geração, não edite à mão. Se você editar, o próximo build sobrescreve.
- Mudou comportamento observável? Adicione entrada em `CHANGELOG.md` (Unreleased).
- Mudou fronteira arquitetural, banco, modelo de consistência ou dependência
  estrutural? Crie um ADR em `docs/adr/` com o número seguinte.
- Nova regra de negócio? Adicione `RN-XXX` em `docs/business-rules.md` com
  `arquivo:linha` e o teste que a cobre.
- Antes de finalizar, rode `npm run docs:build` — link quebrado falha o build.
- Nunca invente conteúdo de doc. Sem informação suficiente, use
  `> **TODO(humano):** <pergunta>`.

## Convenções
- Commits: <<<Conventional Commits>>>. Doc-only usa `docs:`.
- Diagramas em Mermaid, no próprio Markdown. Nunca imagem de diagrama.
```

## 5.3 Генерируемый справочник — устранить дрейф у источника {#53-referência-gerada--elimine-o-drift-na-origem}
То, что можно сгенерировать, никогда не пишется вручную. Создать скрипты, которые
применимы к реальному стеку, и подключить их к `npm run docs:generate`:
- **API**: OpenAPI → `docusaurus-plugin-openapi-docs` или GraphQL schema →
  `docusaurus-graphql-plugin`
- **Env vars**: скрипт, который просматривает код в поисках чтения env и перегенерирует
  `docs/reference/configuration.md` с маркерами
  `<!-- BEGIN:GENERATED --> ... <!-- END:GENERATED -->`
- **CLI**: захватить `--help` каждой команды
- **Типы/SDK**: TypeDoc, pdoc, godoc, javadoc → встроено в `reference/`
- **Скрипты**: извлечь из `package.json` / `Makefile`
- **Индекс ADR**: генерировать `docs/adr/index.md` из файлов и их статусов
- **Участники**: all-contributors или action, обновляющий раздел
  Каждый генерируемый файл начинается с:
  `> ⚠️ Arquivo gerado por \`npm run docs:generate\`. Não edite à mão.`
  И входит в CI как проверка: если сгенерированное отличается от закоммиченного, PR падает.

## 5.4 `.github/workflows/docs-check.yml` — страж {#54-githubworkflowsdocs-checkyml--o-guardião}
Запускать в каждом PR:
1. **Сборка сайта** с `onBrokenLinks: throw` → ловит битые ссылки и невалидный MDX
2. **Drift check**: скрипт, который читает `.docmap.yml`, сопоставляет с
   `git diff --name-only origin/<branch>...HEAD` и для каждого сработавшего правила без
   изменённой соответствующей документации:
    - `severity: block` → проверка падает
    - `severity: warn` → комментарий в PR со списком файлов для пересмотра
    - Обязательный escape hatch: метка `docs-not-needed` или строка
      `docs-not-needed: <motivo>` в теле PR снимает проверку. Без escape hatch
      команда учится обходить правило вместо того, чтобы его выполнять.
3. **Сгенерированное актуально**: запускает `docs:generate` и падает при наличии diff
4. **Lint прозы**: Vale или textlint (необязательно, предложить и спросить)
5. **Внешние ссылки**: `lychee`, только по еженедельному расписанию — не в PR, чтобы не
   ломать сборку из-за недоступного стороннего сайта

## 5.5 `.claude/commands/sync-docs.md` — ручная команда {#55-claudecommandssync-docsmd--comando-manual}
Slash command на случай, когда я захочу запустить синхронизацию по требованию:
```markdown
Compare o código atual com a documentação e corrija o drift.

1. `git diff --name-only <<<branch>>>...HEAD` (ou o range que eu passar como $ARGUMENTS)
2. Leia `.docmap.yml` e determine quais docs foram afetados
3. Para cada doc afetado: leia, compare com a realidade do código, e corrija
   **apenas o que está factualmente errado ou faltando**. Não reescreva estilo.
4. Rode `npm run docs:generate` e inclua o resultado
5. Atualize `CHANGELOG.md` se houver mudança observável
6. Verifique se algum ADR é necessário; se sim, proponha o texto
7. Rode `npm run docs:build` e conserte o que quebrar
8. Relatório final: o que mudou, o que ficou como TODO(humano), e o que você
   deliberadamente NÃO mudou e por quê
```

## 5.6 `.github/workflows/docs-audit.yml` — периодический аудит {#56-githubworkflowsdocs-audityml--auditoria-periódica}
Ежемесячно (`schedule: cron`), открывает или обновляет единственный issue с меткой `docs`:
- Страницы с `last_update` старше N месяцев, соответствующий код которых
  менялся позже
- Документы с незакрытыми `TODO(humano)`
- Ссылки `arquivo:linha`, которые больше не разрешаются (файл перемещён или удалён)
- ADR в статусе `proposed` дольше 60 дней
- Мёртвые внешние ссылки (из еженедельной проверки)
  Не открывать новый issue на каждом прогоне — обновлять существующий.

## 5.7 Локальные хуки (необязательно — предложить и спросить) {#57-hooks-locais-opcional--proponha-e-pergunte}
`pre-push` через husky/lefthook, который запускает drift check локально, чтобы
участник узнал о проблеме до открытия PR, а не после. Устанавливать только с моего одобрения:
медленный хук — самый быстрый способ заставить кого-то навсегда использовать `--no-verify`.

## 5.8 Задокументировать сам механизм {#58-documente-o-próprio-mecanismo}
Создать `docs/explanation/documentation-workflow.md` с объяснением, как работает эта
система, зачем она существует и что делать, когда drift check жалуется
несправедливо. Механизм, который никто не понимает, — это механизм, который кто-то отключит.

---

# ФАЗА 6 — ЛИЦЕНЗИРОВАНИЕ MIT

### `LICENSE` {#license}
**Официальный** текст MIT, **без каких-либо изменений**, в корне, без расширения, с заполненными годом и
правообладателем. Если существует LICENSE с другой лицензией или заглушкой
(`[year]`, `[fullname]`), исправить и сообщить мне. Никогда не добавлять пункты — изменённая MIT
перестаёт распознаваться инструментами и юристами компаний.

### Согласованность деклараций {#coerência-declarada}
Проверить, что `package.json` (корень **и** `website/`), `pyproject.toml`,
`Cargo.toml`, `pom.xml` объявляют `"license": "MIT"`, и исправить расхождения.
Лицензия, объявленная в трёх местах с разными значениями, — реальная и частая проблема.

### `THIRD_PARTY_NOTICES.md` {#third_party_noticesmd}
Если на Фазе 1.5 найден vendored-код, ассеты, шрифты или иконки, требующие
указания авторства, создать файл с атрибуцией для каждого. Включить footer
Docusaurus с указанием лицензии.

### SPDX (необязательно — предложить и спросить заранее) {#spdx-opcional--proponha-e-pergunte-antes}
Заголовок `// SPDX-License-Identifier: MIT` в основных исходниках.

---

# ПРАВИЛА НАПИСАНИЯ
- Действительный залог, настоящее время, второе лицо в шагах. Короткие фразы.
- Каждая команда в блоке с правильным языком и **ожидаемым выводом**.
- Диаграммы всегда в **Mermaid** в самом Markdown — рендерится в GitHub и в
  Docusaurus, хорошо версионируется и переживает diff. Никогда не картинка диаграммы.
  Максимум ~12 узлов; если больше, разбить на две.
- Эмодзи только в заголовках разделов README и метках sidebar, умеренно.
- **Относительные** ссылки между документами, чтобы работали в fork, зеркале и на сайте.
- Тон приглашающий и конкретный, никогда не бюрократический. «Сначала откройте issue» >
  «Участнику запрещается вносить изменения без предварительного согласия».
- Говорить «нет» рано и с причиной. Отклонить PR после 300 написанных строк — вот что
  выжигает и мейнтейнера, и участника.
- Никаких формулировок, превращающих финансовую поддержку в договор о поддержке.
- Ноль lorem ipsum. Ноль общих TODO — только `TODO(humano)` с конкретным вопросом.

---

# ЗАВЕРШЕНИЕ
В конце предоставить:
1. Дерево созданных и изменённых файлов
2. Сводный список `TODO(humano)` и `ATENÇÃO(humano)`, упорядоченный по влиянию
3. Подтверждение, что `npm run docs:build` проходит без битых ссылок
4. Симуляцию drift check: прогнать по последним 5 коммитам и показать, что он
   обнаружил бы, — это доказательство, что механизм работает
5. Чеклист GitHub Community Standards с тем, что осталось нерешённым
6. Сообщения коммитов в Conventional Commits, логически сгруппированные
7. Три вещи, которые вы заметили о проекте, читая историю, и о которых я,
   вероятно, не знал
