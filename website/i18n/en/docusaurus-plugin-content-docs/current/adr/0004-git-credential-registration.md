# 0004 — Registration of the user's git credentials

## Context

Item 3 of Phase 2 (see CLAUDE.md): the user's git credentials (GitHub/GitLab
tokens used by `GithubProvider`/`GitlabProvider` to operate on their
behalf) need to live in the same `user_credentials` table as the LLM API
keys (Phase 1), with the same envelope encryption, and with a mandatory
connection test at registration time.

Two shape questions:

1. `user_credentials.provider` was already an `llm_provider` enum
   (`ollama`/`anthropic`/...). A git token isn't an LLM provider —
   widening `llm_provider` would mix two domains into a single enum
   also used by `models`/`token_usage` (genuinely LLM-only). Reusing
   `git_provider` (used by `project_git_connections`) doesn't work
   either: it includes `'local'`, which makes no sense as a
   *credential* provider (there's no token for local git).
2. An invalid/revoked token is only discovered when it's actually used —
   without a connection test, registration "succeeds" and the failure
   only surfaces at the first Gitflow bootstrap, much later and more
   costly to diagnose.

## Decision

**Dedicated enum** `credential_provider` (migration `0007`), with
`CredentialProviderName = LLMProviderName | GitCredentialProviderName`
in `packages/shared` — a union of the two domains only in the type used
by `UserCredentialRepository`, without mixing the database enums.
`GitCredentialProviderName` is `Extract<GitProviderName, 'github' |
'gitlab'>` — it derives from the git provider enum instead of
duplicating the list, but structurally excludes `'local'`.

**SYNCHRONOUS and MANDATORY connection test before encrypting/persisting.**
`RegisterGitCredentialUseCase.execute` (new) calls
`GitCredentialConnectionTester.test(provider, token)` first; only if
that resolves is the token encrypted
(`EncryptionService.encrypt`) and written
(`UserCredentialRepository.upsert`). On a failure, nothing is written —
see `GitCredentialConnectionTestFailedError` in
`domain/git/git-errors.ts`. The real implementation
(`GitCredentialConnectionTesterImpl`) makes the cheapest possible call
on each API to confirm the token authenticates:
`GET /user` (Octokit `users.getAuthenticated`) on GitHub,
`GET /user` (Gitbeaker `Users.showCurrentUser`) on GitLab — neither
attempts to list repos or anything that depends on scope beyond basic
authentication.

**PAT always via `token:` in Gitbeaker, never `oauthToken:`.** GitLab
validates the two differently (`PRIVATE-TOKEN` header vs.
`Authorization: Bearer`) — they aren't interchangeable. `oauthToken` is
reserved for the project-level OAuth flow
(`project_git_connections`, Phase 2 item 4+), which this session doesn't
change.

**Dedicated endpoint only for registration; GET/DELETE reused.**
`POST /users/me/git-credentials` (new,
`GitCredentialsController`) is the only path in this session, because
only registration needs the synchronous connection test. Listing and
deletion already existed in `CredentialsController` (Phase 1, LLM) over
the same table/repository — `UserCredentialRepository` was widened from
`LLMProviderName` to `CredentialProviderName` (it was the loose
`LLMProviderName` left over that broke the build, see `delete()` in
`user-credential.repository.ts`) instead of duplicating
list/delete for git. No `@RequireRole` on the new controller: it's
about the authenticated user's own credential, the same pattern as the
equivalent LLM endpoint.

**Connection failure maps to 422, not 400 or 409**
(`git-provider-error.filter.ts`): it's neither malformed payload (400)
nor a conflict with existing state (409) — it's a semantically invalid
entity (a token that never authenticated), the textbook 422 case.

## Consequences

- Registering a git credential now makes a synchronous network call to
  the provider's API before responding — the endpoint is slower than a
  "blind" registration, deliberately (see Decision).
- `UserCredentialRepository` (and its migration `0007`) now serves two
  domains (LLM and git) through the same table/type enum — any future
  credential provider (git or otherwise) enters through
  `CredentialProviderName`, not a new enum.
- The connection test isn't retried (`GitCredentialConnectionTester`
  doesn't use `withRetry`, see 0003) — a transient network failure
  during registration requires the user to try again manually;
  acceptable because it's a one-off interactive action, not a
  background operation.
