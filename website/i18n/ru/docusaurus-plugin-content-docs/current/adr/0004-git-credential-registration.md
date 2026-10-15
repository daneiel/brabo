---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0004 — Регистрация git-учётных данных пользователя

## Контекст {#contexto}

Пункт 3 Фазы 2 (см. CLAUDE.md): git-учётные данные пользователя
(токены GitHub/GitLab, используемые `GithubProvider`/`GitlabProvider`
для работы от его имени) должны жить в той же таблице
`user_credentials`, что и API-ключи LLM (Фаза 1), с тем же envelope
encryption и с обязательной проверкой подключения при регистрации.

Два вопроса формы:

1. `user_credentials.provider` уже был enum `llm_provider`
   (`ollama`/`anthropic`/...). Токен git — не LLM-provider:
   расширение `llm_provider` смешало бы два домена в одном enum, используемом
   также `models`/`token_usage` (действительно только LLM).
   Повторное использование `git_provider` (используемого `project_git_connections`)
   тоже не годится: он включает `'local'`, что не имеет смысла как
   provider *учётных данных* (токена для локального git не существует).
2. Невалидный/отозванный токен обнаруживается лишь при попытке использовать его —
   без проверки подключения регистрация "успешна", а сбой появляется лишь при первом
   bootstrap Gitflow, гораздо позже и с гораздо более дорогой
   диагностикой.

## Решение {#decisão}

**Выделенный enum** `credential_provider` (миграция `0007`), с
`CredentialProviderName = LLMProviderName | GitCredentialProviderName`
в `packages/shared` — объединение двух доменов лишь в типе, который
использует `UserCredentialRepository`, без смешения enum базы.
`GitCredentialProviderName` — это `Extract<GitProviderName, 'github' |
'gitlab'>` — выводится из enum git-provider, не дублирует список,
но структурно исключает `'local'`.

**СИНХРОННАЯ и ОБЯЗАТЕЛЬНАЯ проверка подключения перед шифрованием/сохранением.**
`RegisterGitCredentialUseCase.execute` (новый) сначала вызывает
`GitCredentialConnectionTester.test(provider, token)`; только если это
разрешается, токен шифруется
(`EncryptionService.encrypt`) и записывается
(`UserCredentialRepository.upsert`). При сбое ничего не пишется — см.
`GitCredentialConnectionTestFailedError` в
`domain/git/git-errors.ts`. Реальная реализация
(`GitCredentialConnectionTesterImpl`) делает самый дешёвый возможный вызов
в каждом API, чтобы подтвердить, что токен аутентифицируется:
`GET /user` (Octokit `users.getAuthenticated`) в GitHub,
`GET /user` (Gitbeaker `Users.showCurrentUser`) в GitLab — ни один
не пытается перечислять репозитории или что-либо, зависящее от области сверх
базовой аутентификации.

**PAT всегда через `token:` в Gitbeaker, никогда `oauthToken:`.**
GitLab проверяет их по-разному (заголовок `PRIVATE-TOKEN` vs.
`Authorization: Bearer`) — они не взаимозаменяемы. `oauthToken` остаётся
зарезервирован для потока OAuth проекта
(`project_git_connections`, Фаза 2 пункт 4+), который эта сессия не
меняет.

**Собственный endpoint только для регистрации; GET/DELETE переиспользованы.**
`POST /users/me/git-credentials` (новый,
`GitCredentialsController`) — единственный путь в этой сессии, потому что лишь
регистрации нужна синхронная проверка подключения. Листинг и удаление
уже существовали в `CredentialsController` (Фаза 1, LLM) над той же
таблицей/репозиторием — `UserCredentialRepository` был расширен с
`LLMProviderName` до `CredentialProviderName` (это был оставшийся отдельный
`LLMProviderName`, ломавший сборку, см. `delete()` в
`user-credential.repository.ts`) вместо дублирования
list/delete для git. Никакого `@RequireRole` в новом controller: речь
об учётных данных самого аутентифицированного пользователя, тот же шаблон, что у
эквивалентного endpoint LLM.

**Сбой подключения отображается в 422, а не 400 и не 409**
(`git-provider-error.filter.ts`): это не некорректный payload (400) и не
конфликт с существующим состоянием (409) — это семантически
невалидная сущность (токен, который никогда не аутентифицировался), классический случай 422.

## Последствия {#consequências}

- Регистрация git-учётных данных теперь делает синхронный сетевой
  вызов к API provider перед ответом — endpoint медленнее "слепой"
  регистрации, намеренно (см. Решение).
- `UserCredentialRepository` (и его миграция `0007`) теперь обслуживает два
  домена (LLM и git) через одну таблицу/enum типа — любой
  будущий provider учётных данных (git или нет) входит через
  `CredentialProviderName`, а не через новый enum.
- Проверка подключения не повторяется (`GitCredentialConnectionTester`
  не использует `withRetry`, см. 0003) — временный сетевой сбой при
  регистрации требует, чтобы пользователь вручную попробовал снова; приемлемо,
  потому что это разовое интерактивное действие, а не фоновая операция.
