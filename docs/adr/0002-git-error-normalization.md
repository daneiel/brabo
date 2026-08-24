# 0002 — GitProvider error normalization

## Context

The `GitProviderContract` contract suite (see 0001) needs normalized,
stable errors for the 8 operations — in particular the 3 scenarios cited
in the original request (repository already exists, branch not found,
permission denied) plus the missing-capability case, which can never be
a raw crash.

The rest of the codebase already has a domain-error convention: each
error is a standalone `class X extends Error`, with `this.name` set
explicitly and typed context fields (never a generic `code` enum) — see
`apps/api/src/domain/git/git-provider-errors.ts`
(`GitProviderAuthError`, `InvalidOauthStateError`, focused on OAuth) and
the session/action state-machine errors.

## Decision

**No common base class.** Introducing an abstract `GitError extends
Error` for the 6 new classes to converge on was considered, and
rejected: no new HTTP filter is registered in this session (no endpoint
exposes the 8 operations yet — that's items 4-6 of Phase 2, future
work), so a common base has no immediate use, and it would deviate from
the "no base" convention already established across the rest of the
domain for no concrete reason right now.

Six standalone classes in `apps/api/src/domain/git/git-errors.ts` (new
file, separate from the OAuth `git-provider-errors.ts`):

- `GitRepoAlreadyExistsError(repoId)`
- `GitRepoNotFoundError(repoId)`
- `GitBranchNotFoundError(repoId, ref)`
- `GitBranchAlreadyExistsError(repoId, branchName)` — falls out for free
  from the compare-and-swap semantics of `git update-ref` used in
  `createBranch`; it wasn't part of the original list of 3 scenarios,
  but it's the natural behavior of rejecting an overwrite of an
  existing branch.
- `GitPermissionDeniedError(path)`
- `GitNotSupportedError(provider, operation)`

**Permission-denied test and containers running as root.** The api's
dev containers run as root
(`docker/api/Dockerfile`, no `USER`). Root bypasses Unix permission
checks (DAC), so a test that does `chmod(dir, 0o000)` and expects
`EACCES` doesn't reproduce anything real when running as root — the
test would "pass" without exercising any error-handling code, which is
worse than not having the test at all. Considered (and deferred, out of
proportion for this session's scope): using Node's `child_process`
`uid`/`gid` options to deliberately drop privilege before attempting the
operation — this would require assuming a specific unprivileged uid
(`nobody` or similar) present in every environment where the suite
runs, and would add an identity-override path just for the test's
benefit. Decision: the suite detects `process.getuid?.() === 0` and
skips (`it.skipIf`) the permission-denied test when running as root,
with an explicit comment in the code — it never pretends to have
passed.

## Consequences

- No HTTP filter (`@Catch(...)`) is added in this session — it's left
  pending for when a future session exposes the 8 operations via
  endpoint (items 4-6 of Phase 2). Until then, these 6 classes only
  circulate inside the api process (direct calls to the provider,
  tests).
- In environments where tests run as a non-root user (e.g. CI
  configured without root, or a future dev image with a non-root
  `USER`), the permission-denied test starts being exercised for real —
  no code change is needed for that to happen, just the environment.
