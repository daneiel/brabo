---
traducao_de: 23e727d97992c1974a3df731360a293b67fd669c
---

# ADR 0001 — Формат нормализованного контракта GitProvider

## Контекст {#contexto}

Фаза 2 (CLAUDE.md) требует нормализованного интерфейса `GitProvider` в
`packages/shared`, покрывающего 8 операций (`createRepo`, `getRepo`,
`createBranch`, `protectBranch`, `commitFiles`, `listBranches`,
`openPullRequest`, `mergePullRequest`), с типами, которые никогда не раскрывают
форму Octokit (GitHub) или REST-клиента GitLab (`@gitbeaker`),
и объектом `capabilities`, через который домен деградирует, когда операция
не поддерживается provider.

До этой сессии в `apps/api` уже был `GitProvider` — но как
`abstract class`, используемый как токен внедрения зависимостей NestJS,
с единственной операцией (`createRepository`), потребляемый уже работающим в продакшене
конвейером подготовки репозитория
(`ProvisionRepositoryUseCase`, `GitProviderRegistry`,
`GitInfrastructureModule`). Эта сессия ограничена лишь "фундаментом"
(типы + контрактная suite + полный `LocalGitProvider`) — доведение
`GithubProvider`/`GitlabProvider` до 8 операций остаётся на будущую
сессию.

## Решение {#decisão}

**Два контракта намеренно сосуществуют пока**:

1. `GitProvider` (без изменений, `apps/api/src/application/ports/git-provider.port.ts`)
   — продолжает быть DI-токеном Nest, с `createRepository`. Ничто
   в нём не меняется в этой сессии; `GithubProvider`/`GitlabProvider`/registry/
   use case подготовки не затрагиваются.
2. `GitProviderContract` (новый, `packages/shared/src/index.ts`) —
   нормализованный интерфейс 8 операций + `capabilities`, типы `GitRepo`/
   `GitBranch`/`GitPullRequest`/`GitCommitResult`. Пока не привязан ни к
   одному DI-токену. Пока его реализует только `LocalGitProvider`
   (наряду с продолжением реализации старого, неизменного `GitProvider`).

Назван `GitProviderContract` вместо повторного использования идентификатора
`GitProvider` — избегает конфликта имён в файле, реализующем оба
(`LocalGitProvider`), и совпадает со словарём "контрактной suite", который
сам CLAUDE.md уже использует для описания тестов.

Каждое поле идентификации репозитория использует `externalId` (не `id`
и не `repoId`) — то же имя, что уже используют `CreateRepositoryResult`/
`ProvisionedRepository`, чтобы быть согласованным с уже
сохраняемым.

**`capabilities`**: `{ protectBranch: boolean; pullRequests: boolean }`
— два булевых флага, интроспектируемых во время выполнения
(`provider.capabilities.protectBranch`), без какой-либо гранулярности по операциям
помимо этого (напр.: нет "частичного protectBranch"). `LocalGitProvider`
объявляет оба как `false` — у локального bare repo нет платформы
для размещения защиты веток или pull requests. Когда вызывается операция,
охраняемая отсутствующей capability, provider бросает
`GitNotSupportedError` (никогда не сырой crash) — см. 0002.

**Merge/PR в local**: `openPullRequest` и `mergePullRequest` в
`LocalGitProvider` бросают `GitNotSupportedError` безусловно —
никакой имитации PR через ветку+прямой merge в этой сессии нет. Будущей
сессии bootstrap Gitflow, вероятно, понадобится операция прямого
merge (не "фальшивая PR") для providers без
`pullRequests` — эта операция здесь ещё не смоделирована, намеренно,
чтобы не выдумывать поверхность API, которую пока никто не потребляет.

## Последствия {#consequências}

- Нулевой риск регрессии в уже работающем в продакшене конвейере
  подготовки — `GitProvider`/`GithubProvider`/`GitlabProvider` остаются
  ровно такими, какими были.
- Явный долг: два контракта (`GitProvider` и
  `GitProviderContract`) должны сойтись в будущей сессии, когда
  `GithubProvider`/`GitlabProvider` тоже реализуют
  `GitProviderContract`, — в этот момент имеет смысл, чтобы `GitProvider` (старый)
  был выведен в пользу нового или чтобы один из них начал
  расширять другой.
- Контрактная suite (`apps/api/test/contract/git-provider.contract.ts`)
  уже написана переиспользуемо — ветвится по
  `provider.capabilities.*`, чтобы решить правильную проверку, — поэтому её не
  нужно менять, когда войдут Github/Gitlab, меняется лишь harness, который её
  вызывает.

## Обновление (Фаза 2, сессия 3 — bootstrap Gitflow) {#atualização-fase-2-sessão-3--bootstrap-de-gitflow}

"Явный долг" из предыдущего раздела оплачен: `GithubProvider` и
`GitlabProvider` уже полностью реализовывали `GitProviderContract`
со времён сессии учётных данных git (с проходящей подменённой контрактной suite
у 3 providers). В этой сессии `GitProviderRegistry.get()`
начал возвращать `GitProviderContract` вместо унаследованного `GitProvider`
— `createRepository`/`CreateRepositoryInput`/`CreateRepositoryResult`
были удалены (подтверждено grep: `ProvisionRepositoryUseCase` был
единственным потребителем). Контракт также получил 9-ю операцию,
`getFileContent`, нужную bootstrap для проверки "файл уже
закоммичен с тем же содержимым" перед повторным коммитом, — см.
docs/adr/0005-repo-bootstrap-idempotent-steps.md.
