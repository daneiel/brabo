---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0011 — Инфраструктура dev agents: worktrees, git-исполнители и замок merge

- Статус: принят
- Дата: 2026-07-24
- Фаза: 4a (сессия 1 — инфраструктура выполнения)

## Контекст {#contexto}

Начало Фазы 4 (агенты выполнения). До настоящих dev эта сессия строит
ИНФРАСТРУКТУРУ и проверяет её с помощью **NoopDevAgent** (без LLM): динамическое создание dev
на модуль module_map, изолированные git worktrees, идентичность коммита `dev-<modulo>[bot]`,
замок merge в защищённую ветку, предложение распараллеливания с принятием одним кликом и
очистка осиротевших worktrees. Решение пользователя: git-поток **100% локальный и самодостаточный**.

## Решения {#decisões}

### 1. Замок merge как ПРЕДЕЛ в домене (decide.ts) {#1-trava-de-merge-como-teto-no-domínio-decidets}
Новый `ActionType git_merge` (payload `{sourceBranch, targetBranch}`). `decide()` оценивает IAM →
agent_autonomy → permissions (каждая стадия лишь ПОВЫШАЕТ разрешительность); в конце —
**предел**: если `git_merge` с `targetBranch ∈ {dev,qa,rc,main}` (защищённые ветки), policy НИКОГДА не
`auto_approve` — понижается до `require_approval`, независимо от agent_autonomy и
permissions.json. Deny по-прежнему побеждает. Тест доказывает, что ни autonomy, ни permissions
это не перезаписывают. Merge в защищённую ветку ВСЕГДА ручной (CLAUDE.md).

### 2. Git-исполнители через конвейер; локальный коммит в worktree {#2-executores-git-via-pipeline-commit-local-no-worktree}
`git_commit`/`git_push`/`pr_open`/`git_merge` получают исполнителей (раньше только `terminal`/
`open_adr_pr`). `git_commit`/`git_push` выполняются В ENGINE (`GitExecutor`, `System.cmd git` в
worktree — коммит с `--author=dev-<modulo>[bot]` + `Co-authored-by`) через внутренний
endpoint, отражающий terminal. `pr_open`/`git_merge` выполняются в api через `GitProvider`.
`ExecuteGitActionUseCase` маршрутизирует; `ApproveAction`/`ProposeAction` (auto_approved) его вызывают.
Каждая git-операция рождается как proposed_action (пункт 3), соблюдая autonomy/permissions.

### 3. LocalGitProvider получает локальные PR (самодостаточность) {#3-localgitprovider-ganha-pr-local-self-contained}
`openPullRequest`/`mergePullRequest` реализованы с лёгким хранилищем (sidecar JSON в bare
repo) + merge через git; `capabilities.pullRequests` становится `true`. Отменяет (аддитивно)
решение Фазы 2 не поддерживать PR в local — нужно, чтобы демо работало без GitHub.
Единая контрактная suite начинает покрывать PR в local.

### 4. Worktrees от локального рабочего дерева; 1 на агента; очистка сирот {#4-worktrees-off-o-working-tree-local-1-por-agente-limpeza-de-órfãos}
`WorktreeManager` создаёт worktrees в `<workspace>/.worktrees/<agent_id>` (ветка
`feature/<task>`) от рабочего дерева, которое `Engine.Actions.Workspace` уже собирает из bare
repo. 1 worktree на агента (это гарантирует каталог по agent_id); `WorktreeCleanupWorker` (Oban,
самоперепланирующийся) удаляет сирот (worktree без живого агента в `Engine.Dev.Registry`).

### 5. Динамические dev agents: надзор + регидратация {#5-dev-agents-dinâmicos-supervisão--rehydration}
`DevAgentSupervisor` (DynamicSupervisor) + `Engine.Dev.Registry` (ключ `{project_id,
agent_id}`), один `DevAgentServer` на модуль. Долговечное состояние в `dev_agent_states` (схема
`engine`); `DevRehydrator` пересоздаёт агентов при загрузке (та же идиома, что `SessionServer`/
`Rehydrator`) — регидратация НЕ перезапускает цикл `:work`. NoopDevAgent (`:work`): берёт
task (атомарный claim `FOR UPDATE SKIP LOCKED`) → worktree → тривиальный файл → предлагает
commit/push/pr_open. `ActivateExecutionUseCase` засевает инструкции + автономию
`auto_approve` (git-операции) на модуль и велит engine поднять агентов.

### 6. Предлагаемое распараллеливание; принятие одним кликом {#6-paralelização-sugerida-aceite-de-um-clique}
При активации модули с ≥2 доступными tasks (доступные независимые ветви — граф зависимостей
tasks пока упрощён) выдают `execution.parallelization_suggested`. Принятие (кнопка
в UI → engine) поднимает `dev-<modulo>-2` с собственным worktree.

## Последствия {#consequências}

- Обзор проекта получает раздел **Execução**: кнопка "Ativar execução" (когда есть
  module_map), dev agents с веткой/task, предложение распараллеливания с "Aceitar" и
  открытые PR. Лента повествует `dev.*`/`execution.*`.
- Тесты: `decide` (замок merge — ни autonomy, ни permissions не автоодобряют merge в
  защищённую); `ClaimNextTaskUseCase` (атомарный claim, свой для каждого агента); PR LocalGitProvider
  (контракт); `worktree_manager` (2 параллельных worktree без конфликтов + очистка
  сирот); `dev_agent_server` (цикл Noop + сохранение/регидратация).

## Область и допущения {#escopo--assunções}

Только **NoopDevAgent** (без LLM) — настоящие dev (harness + LLM) — следующая сессия.
Полная живая панель команды (каналы Phoenix) и QA/SecOps/Infra — позже. `git_merge`
выполняется (GitProvider) лишь при ручном одобрении — демо задействует ОТКАЗ от
автоматического merge. **Допущение dev-окружения:** api и engine разделяют файловую систему bare repos
(`GIT_LOCAL_REPOS_ROOT`) и workspaces (`PROJECT_WORKSPACES_ROOT`) — тома в Compose.
