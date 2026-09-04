# 0001 — Shape of the normalized GitProvider contract

## Context

Phase 2 (CLAUDE.md) calls for a normalized `GitProvider` interface in
`packages/shared` covering 8 operations (`createRepo`, `getRepo`,
`createBranch`, `protectBranch`, `commitFiles`, `listBranches`,
`openPullRequest`, `mergePullRequest`), with types that never leak the
shape of Octokit (GitHub) or the GitLab REST client (`@gitbeaker`),
plus a `capabilities` object through which the domain degrades when an
operation isn't supported by a provider.

Before this session, `apps/api` already had a `GitProvider` — but as an
`abstract class` used as a NestJS dependency-injection token, with a
single operation (`createRepository`), consumed by the repository
provisioning pipeline already in production
(`ProvisionRepositoryUseCase`, `GitProviderRegistry`,
`GitInfrastructureModule`). This session is scoped only to the
"foundation" (types + contract suite + complete `LocalGitProvider`) —
finishing `GithubProvider`/`GitlabProvider` for the 8 operations is
left for a future session.

## Decision

**Two contracts deliberately coexist for now**:

1. `GitProvider` (unchanged, `apps/api/src/application/ports/git-provider.port.ts`)
   — remains the Nest DI token, with `createRepository`. Nothing in it
   changes this session; `GithubProvider`/`GitlabProvider`/the registry/
   the provisioning use case are not touched.
2. `GitProviderContract` (new, `packages/shared/src/index.ts`) — the
   normalized interface with 8 operations + `capabilities`, types
   `GitRepo`/`GitBranch`/`GitPullRequest`/`GitCommitResult`. Not wired to
   any DI token yet. Only `LocalGitProvider` implements it for now
   (in addition to continuing to implement the old, unchanged
   `GitProvider`).

Named `GitProviderContract` instead of reusing the `GitProvider`
identifier — this avoids a name collision in the file that implements
both (`LocalGitProvider`) and matches the "contract suite" vocabulary
that CLAUDE.md itself already uses to describe the tests.

Every repository identification field uses `externalId` (not `id` or
`repoId`) — the same name already used by `CreateRepositoryResult`/
`ProvisionedRepository`, to stay consistent with what's already
persisted.

**`capabilities`**: `{ protectBranch: boolean; pullRequests: boolean }`
— two boolean flags, introspectable at runtime
(`provider.capabilities.protectBranch`), with no per-operation
granularity beyond that (e.g. there's no "partial protectBranch").
`LocalGitProvider` declares both as `false` — a local bare repo has no
platform behind it to host branch protection or pull requests. When an
operation gated by a missing capability is called, the provider throws
`GitNotSupportedError` (never a raw crash) — see 0002.

**Merge/PR on local**: `openPullRequest` and `mergePullRequest` on
`LocalGitProvider` throw `GitNotSupportedError` unconditionally — there
is no simulated PR via branch+direct merge in this session. A future
Gitflow bootstrap session will likely need a direct-merge operation
(not a "fake PR") for providers without `pullRequests` — that operation
is deliberately not modeled here yet, so as not to invent an API
surface nobody consumes yet.

## Consequences

- Zero regression risk in the provisioning pipeline already in
  production — `GitProvider`/`GithubProvider`/`GitlabProvider` remain
  exactly as they were.
- Explicit debt: the two contracts (`GitProvider` and
  `GitProviderContract`) need to converge in a future session, once
  `GithubProvider`/`GitlabProvider` also implement `GitProviderContract`
  — at that point it makes sense to retire `GitProvider` (the old one)
  in favor of the new one, or have one of them extend the other.
- The contract suite (`apps/api/test/contract/git-provider.contract.ts`)
  is already written in a reusable way — it branches on
  `provider.capabilities.*` to decide the right assertion — so it won't
  need to change when Github/Gitlab come in, only the harness that
  invokes it changes.

## Update (Phase 2, session 3 — Gitflow bootstrap)

The "explicit debt" from the previous section has been paid: `GithubProvider`
and `GitlabProvider` already fully implemented `GitProviderContract` since
the git credentials session (with the mocked contract suite passing on
all 3 providers). In this session, `GitProviderRegistry.get()` started
returning `GitProviderContract` instead of the legacy `GitProvider` —
`createRepository`/`CreateRepositoryInput`/`CreateRepositoryResult`
were removed (confirmed by grep: `ProvisionRepositoryUseCase` was the
only consumer). The contract also gained a 9th operation,
`getFileContent`, needed for the bootstrap to verify "file already
committed with the same content" before recommitting — see
docs/adr/0005-repo-bootstrap-idempotent-steps.md.
