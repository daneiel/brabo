---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
---

# Входные данные 1 — уже существующий контракт GitProvider

Входной материал PO для Фазы 10. Описывает **то, что уже готово**, чтобы эпик
не изобретал заново и не противоречил. Всё здесь прочитано из кода; у каждого
утверждения есть `arquivo:linha`.

Добавление нового provider означает три вещи, в таком порядке: реализовать
десять операций, **честно** объявить capabilities и пройти единую контрактную
suite, не написав ни одного собственного сценария.

---

## Десять операций {#as-dez-operações}

Определены в `packages/shared/src/index.ts:287-303`. Provider — это объект,
удовлетворяющий этому интерфейсу, — ни больше, ни меньше.

| # | операция | вход → выход |
|---|---|---|
| 1 | `createRepo` | `CreateRepoInput` → `GitRepo` |
| 2 | `getRepo` | `GetRepoInput` → `GitRepo` |
| 3 | `createBranch` | `CreateBranchInput` → `GitBranch` |
| 4 | `protectBranch` | `ProtectBranchInput` → `void` |
| 5 | `commitFiles` | `CommitFilesInput` → `GitCommitResult` |
| 6 | `listBranches` | `ListBranchesInput` → `GitBranch[]` |
| 7 | `openPullRequest` | `OpenPullRequestInput` → `GitPullRequest` |
| 8 | `mergePullRequest` | `MergePullRequestInput` → `GitPullRequest` |
| 9 | `getFileContent` | `GetFileContentInput` → `string \| null` |
| 10 | `commentOnPullRequest` | `CommentOnPullRequestInput` → `void` |

Ещё два обязательных поля: `name: GitProviderName`
(`packages/shared/src/index.ts:288`) и `capabilities: GitProviderCapabilities`
(`:289`).

Девятая (`getFileContent`) появилась вместе с bootstrap Gitflow
(`docs/adr/0005-repo-bootstrap-idempotent-steps.md`) и возвращает `null` — не
бросает исключение, — когда файла или ветки не существует
(`packages/shared/src/index.ts:298`). Десятая (`commentOnPullRequest`)
появилась вместе с gates PR Фазы 4a и учитывает `capabilities.pullRequests`,
как и остальные операции PR (`packages/shared/src/index.ts:300-302`).

### Форматы вывода {#formatos-de-saída}

Определены в `packages/shared/src/index.ts:187-218`:

- `GitRepo` — `externalId`, `name`, `url`, `defaultBranch`, `visibility`
- `GitBranch` — `name`, `commitSha`, `protected`
- `GitCommitResult` — `sha`, `branch`
- `GitFileChange` — `path`, `content`
- `GitPullRequest` — `id`, `number`, `url`, `sourceBranch`, `targetBranch`,
  `state` (`"open" | "merged" | "closed"`)

### Форматы ввода {#formatos-de-entrada}

`packages/shared/src/index.ts:220-285`. Все несут необязательный
`accessToken?: string` — токен приходит расшифрованным от вызывающего, и
provider его никогда не сохраняет.

| тип | поля помимо `accessToken` |
|---|---|
| `CreateRepoInput` | `name`, `visibility`, `namespace?` |
| `GetRepoInput` | `externalId` |
| `CreateBranchInput` | `externalId`, `branchName`, `fromRef` |
| `ProtectBranchInput` | `externalId`, `branchName` |
| `CommitFilesInput` | `externalId`, `branch`, `message`, `files: GitFileChange[]` |
| `ListBranchesInput` | `externalId` |
| `OpenPullRequestInput` | `externalId`, `sourceBranch`, `targetBranch`, `title`, `body?` |
| `MergePullRequestInput` | `externalId`, `pullRequestId` |
| `CommentOnPullRequestInput` | `externalId`, `pullRequestId`, `body` |
| `GetFileContentInput` | `externalId`, `branch`, `path` |

Обратите внимание, что `ProtectBranchInput` **не несёт конфигурации защиты** —
только какую ветку. Каждый provider решает, что значит «защищённая», и это
расхождение рассмотрено в
`docs/adr/0028-protecao-de-branch-divergencia-entre-providers.md`.

---

## Capabilities: два флага, и они — затвор {#capabilities-duas-flags-e-elas-são-o-portão}

```ts
interface GitProviderCapabilities {
  readonly protectBranch: boolean;
  readonly pullRequests: boolean;
}
```

`packages/shared/src/index.ts:182-185`. **Их всего два.** Новый provider,
которому нужно выразить третье измерение, просит изменения контракта — а это
архитектурное решение, а не деталь реализации.

Что каждый provider объявляет сегодня:

| provider | `protectBranch` | `pullRequests` | где |
|---|---|---|---|
| `LocalGitProvider` | `false` | `true` | `apps/api/src/infrastructure/git/local-git-provider.ts:55-58` |
| `GithubProvider` | `true` | `true` | `apps/api/src/infrastructure/git/github-provider.ts:39-42` |
| `GitlabProvider` | `true` | `true` | `apps/api/src/infrastructure/git/gitlab-provider.ts:41-44` |

`pullRequests: true` у Local — не имитация: это лёгкое хранилище PR в sidecar
bare-репозитория, сделанное для dev agents Фазы 4a
(`apps/api/src/infrastructure/git/local-git-provider.ts:51-54`).
`protectBranch: false` остаётся, потому что нет платформы, чтобы применить
защиту.

**RN-028 — решает capability, а не имя provider.** Неподдерживаемая операция
объявляется в `capabilities` и отклоняется с `GitNotSupportedError`, никогда не
падает молча. `LocalGitProvider` делает ровно это в `protectBranch`
(`apps/api/src/infrastructure/git/local-git-provider.ts:137`). Ни у одного
потребителя нет `if (provider.name === 'local')`.

---

## Нормализованные ошибки {#erros-normalizados}

Семь классов, в `apps/api/src/domain/git/git-errors.ts`. Намеренно **без
общего базового класса** — решение зафиксировано в
`docs/adr/0002-git-error-normalization.md`.

| класс | конструктор | строка |
|---|---|---|
| `GitRepoAlreadyExistsError` | `(repoId)` | `:10` |
| `GitRepoNotFoundError` | `(repoId)` | `:17` |
| `GitBranchNotFoundError` | `(repoId, ref)` | `:24` |
| `GitBranchAlreadyExistsError` | `(repoId, branchName)` | `:34` |
| `GitPermissionDeniedError` | `(path)` | `:44` |
| `GitNotSupportedError` | `(provider, operation)` | `:51` |
| `GitCredentialConnectionTestFailedError` | `(provider, reason?)` | `:64` |

Не путать с `apps/api/src/domain/git/git-provider-errors.ts`, где два класса
**OAuth** (`GitProviderAuthError`, `InvalidOauthStateError`), не входящие в
нормализованный контракт. Различие важно: `GitPermissionDeniedError` — это
«токен не может этого сделать»; `GitProviderAuthError` — «поток OAuth не
удался».

HTTP-фильтр, переводящий эти классы в статусы, живёт в
`apps/api/src/interfaces/http/shared/git-provider-error.filter.ts`.

### Как каждый provider отображает сырую ошибку вендора {#como-cada-provider-mapeia-o-erro-cru-do-vendor}

Это настоящая работа нового provider: вендор говорит на своём диалекте, а
контракт знает только семь классов выше.

- **GitHub** (Octokit) — статус `422` + `/already exists/i` →
  `GitRepoAlreadyExistsError` (`github-provider.ts:69-74`); `403` без rate-limit
  → `GitPermissionDeniedError` (`:75-77`).
- **GitLab** (Gitbeaker) — статус `400` + `/already (exists|been taken)/i` →
  `GitRepoAlreadyExistsError` (`gitlab-provider.ts:73-75`); `401`/`403` →
  `GitPermissionDeniedError` (`:76-78`).
- **Local** (git CLI через `execFile`) — код `EEXIST` →
  `GitRepoAlreadyExistsError` (`local-git-provider.ts:71`); `EACCES`/`EPERM` →
  `GitPermissionDeniedError` (`:72-74`).

Образец для копирования: **решать по статусу + маркеру тела**, никогда по
подстроке всего сообщения, которое меняется без предупреждения.

---

## Retry {#retry}

`apps/api/src/infrastructure/git/retry.ts` — Full Jitter, 4 попытки, **только
для чтений** (`docs/adr/0003`). `LocalGitProvider` его не использует; GitHub и
GitLab используют. Новый provider, работающий по HTTP, должен использовать тот
же помощник и по тому же правилу: повтор неидемпотентной записи — это то, как
создаются дубликаты.

---

## Единая контрактная suite {#a-suite-de-contrato-única}

`apps/api/test/contract/git-provider.contract.ts`. Экспортирует интерфейс
`GitProviderContractHarness` (`:20`) и функцию `runGitProviderContract(label,
makeHarness)` (`:35`). Это **19 сценариев**, и новый provider не пишет ни одного
из них — только предоставляет harness.

Сценарии по операциям:

| операция | сценарии |
|---|---|
| `createRepo` | создаёт; отклоняет занятое имя (`GitRepoAlreadyExistsError`); отклоняет отказ в доступе (`GitPermissionDeniedError`, пропускается при запуске от root) |
| `getRepo` | возвращает созданный; отклоняет несуществующий id (`GitRepoNotFoundError`) |
| `commitFiles` | первый коммит в новую ветку; второй коммит даёт новый sha; отклоняет несуществующую ветку (`GitBranchNotFoundError`) |
| `getFileContent` | возвращает содержимое; `null` для несуществующего файла; `null` для несуществующей ветки |
| `createBranch` | создаёт из существующего ref; отклоняет несуществующий `fromRef`; отклоняет уже существующее имя |
| `listBranches` | перечисляет существующие |
| `protectBranch` | **учитывает `capabilities.protectBranch`** |
| `openPullRequest` / `mergePullRequest` / `commentOnPullRequest` | **учитывают `capabilities.pullRequests`** |

Последние четыре важнее всего для нового provider: suite не требует, чтобы
операция работала, — она требует, чтобы она **работала или бросала
`GitNotSupportedError` в соответствии с объявленным флагом**. Объявить `true` и
не реализовать — провал; объявить `false` и реализовать — тоже.

Кто запускает suite сегодня:

| harness | файл |
|---|---|
| `local` — реальный provider + временный каталог | `apps/api/test/infrastructure/git/local-git-provider.contract.spec.ts:12` |
| `github (mockado)` — реальный provider + HTTP-бэкенд через `msw` | `apps/api/test/infrastructure/git/github-provider.contract.spec.ts:23` |
| `gitlab (mockado)` — то же | `apps/api/test/infrastructure/git/gitlab-provider.contract.spec.ts:23` |
| `github (API real)` — только с `GITHUB_TEST_TOKEN` | `apps/api/test/infrastructure/git/github-provider.smoke.spec.ts:40` |
| `gitlab (API real)` — только с `GITLAB_TEST_TOKEN` | `apps/api/test/infrastructure/git/gitlab-provider.smoke.spec.ts:31` |

Пара mock + smoke — образец для подражания: suite выполняется в CI против
поддельного бэкенда, а **та же** suite выполняется против реального API за
переменной окружения, по умолчанию пропускаемая.

> ⚠️ Комментарий в начале `apps/api/test/contract/git-provider.contract.ts:12-18`
> всё ещё говорит, что suite проверяет только Local. Он устарел со времён Фазы 2 —
> зафиксировано как находка P3 в миссии, должно быть исправлено в этой фазе.

---

## Registry {#registry}

`apps/api/src/infrastructure/git/git-provider-registry.ts` — `switch` по
`GitProviderName`, возвращающий внедрённый экземпляр. Новый provider входит
сюда, в модуль `apps/api/src/infrastructure/git/git-infrastructure.module.ts` и
в тип `GitProviderName` в `packages/shared/src/index.ts`.

Внимание к детали, которая уже кусалась раньше: `packages/shared` — это **100%
типы**. Список времени выполнения не может жить там — пакет разрешается по
сырому `.ts`, и продакшен-образ api не поднимается. Это охраняет тест
(`apps/api/test/packages-shared-so-tipos.spec.ts`).

---

## Где provider появляется вне бэкенда {#onde-o-provider-aparece-fora-do-backend}

Эпик должен покрыть эти точки, иначе provider существует, а выбрать его никто
не может:

- `apps/web/src/routes/NewProjectWizard.tsx:28-37` — массив `PROVIDERS`
  мастера
- `apps/web/src/lib/wizard.ts` — `providerNeedsCredential`, решающий, появляется
  ли шаг учётных данных
- `apps/web/src/components/wizard/CredentialStep.tsx:19-21` — метки
- `apps/web/src/components/ProjectCard.tsx:11-19` и
  `apps/web/src/routes/ProjectPage.tsx:16` — значок и метка для каждого provider
- `apps/web/src/components/ui/icons.tsx` — значки
- `credentialProviderEnum` в `apps/api/src/db/schema.ts:198-203` — нужна
  миграция, если provider принимает учётные данные

---

## Два бизнес-правила, которым эпик не может противоречить {#duas-regras-de-negócio-que-o-épico-não-pode-contrariar}

- **RN-028** — решает capability, а не имя provider. Проверяется контрактной
  suite, запущенной против всех providers.
- **RN-029** — bootstrap Gitflow идемпотентен и возобновляем; шагов шесть,
  каждый проверяет перед действием, и `skip` **является успехом**. Provider без
  `protectBranch` заставляет шаг завершиться `degraded`, что тоже успех —
  `bootstrap.step_degraded` существует именно для этого.
