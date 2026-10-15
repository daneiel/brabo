# 0003 — Retry policy for remote providers

## Context

`GithubProvider` and `GitlabProvider` make real network calls (Octokit
and Gitbeaker) that fail transiently — rate-limiting (429), 5xx errors,
timeouts. The 8 operations of `GitProviderContract` (see 0001) split
into two very different natures regarding safe re-execution:

- Reads (`getRepo`, `listBranches`) are idempotent by nature —
  re-running them has no side effect.
- Mutations (`createRepo`, `createBranch`, `protectBranch`,
  `commitFiles`, `openPullRequest`, `mergePullRequest`) are not
  generically idempotent (e.g. resending `createRepo` after a timeout
  can collide with the very repository the first attempt created, or
  trigger a second commit) — deciding whether/how to re-run depends on
  context the retry wrapper doesn't have.

## Decision

**Automatic retry only on reads, never on mutations.**
`apps/api/src/infrastructure/git/retry.ts` exposes `withRetry(fn,
options)` with "Full Jitter" (AWS's algorithm: `sleep = random(0,
min(maxDelay, base·2^attempt))`), `maxAttempts` default 4,
`baseDelayMs` 250, `maxDelayMs` 4000. Only `getRepo`/`listBranches` on
the two remote providers go through `withRetry`; every mutation calls
the API directly and lets the error bubble up raw on the first
failure — the caller decides whether to try again.

**Retry criteria are per-provider, not generic**, via a
`shouldRetry: (error) => boolean` passed to each call:

- GitHub (`isRetryableReadError` in `github-provider.ts`): 429, or any
  5xx, or 403 **only when** the `x-ratelimit-remaining: 0` header
  confirms rate-limiting (`isRateLimited`) — GitHub overloads 403 for
  both permission-denied AND rate-limit, and only the header
  distinguishes the two; it never retries a 403 by status alone
  (retrying a permission denial is infinite and useless).
- GitLab (`isRetryableReadError` in `gitlab-provider.ts`): only
  `GitbeakerTimeoutError` and 500/503/504. Gitbeaker **already** retries
  429/502 internally (exponential backoff without jitter, up to 10
  attempts) — adding a retry here for those codes would double the
  total delay for no gain; the wrapper only covers what Gitbeaker
  doesn't handle.

**Known caveat, out of our control: Gitbeaker's built-in retry is
per-TRANSPORT, not per-operation.**
`@gitbeaker/rest`'s `defaultRequestHandler` (`retryCodes = [429, 502]`,
`maxRetries = 10`, delay `2^attempt · 0.25s`, no jitter) runs for ANY
HTTP request the client makes — GET, POST, PUT, without distinguishing
reads from mutations — and both values (`retryCodes`, `maxRetries`) are
internal module constants, with no public option on the `Gitlab(...)`
constructor to disable or reconfigure them (confirmed by reading
`@gitbeaker/rest@43.8.0` — no customizable `requesterFn` exposed by the
aggregated class used here). In practice this means a `GitlabProvider`
mutation that responds with 429 or 502 **is retried anyway**, just by
the lib rather than by our `withRetry` — the guarantee "a mutation never
retries automatically" is only 100% true for GitHub (Octokit embeds no
retry at all: neither `@octokit/plugin-retry` nor `plugin-throttling`
are among the dependencies) and, for GitLab, is only true for the codes
Gitbeaker does NOT handle (400, 403, 404, 422, 500, 503, 504) — 429/502
escape outside our control. See the test
`GitlabProvider — cenários de HTTP mockados > 429 numa mutação
(createRepo): o Gitbeaker retenta por conta própria`
(`gitlab-provider.contract.spec.ts`), which documents this real
behavior instead of pretending it doesn't exist, and the test with
**500** (outside Gitbeaker's list) that proves "no retry" at both
layers at once.

## Consequences

- A GitHub mutation that fails due to rate-limiting or 5xx always
  rejects on the first attempt — there is no automatic write retry at
  this stage. If this proves to be a real UX problem (e.g. Gitflow
  bootstrap failing due to transient rate-limiting), the future
  decision is about idempotent retry per specific operation (e.g.
  `createBranch` could check whether the branch already exists before
  re-running), not a generic wrapper.
- A GitLab mutation that fails with 429/502 is retried by Gitbeaker (up
  to 10x, ~29s of accumulated wait in the worst case: sum of
  `0.25·(2^10-1)` seconds) BEFORE our code even sees the error —
  accepted as a documented, non-hidden library limitation. Swapping
  libraries just because of this is disproportionate at this stage; if
  it becomes a real problem (e.g. a `createRepo` duplicated by improper
  re-execution on top of rate-limiting), the future decision is about
  replacing `@gitbeaker/rest` with a thin HTTP client that gives full
  control over retry, not about working around the behavior from the
  outside.
- `withRetry` has no coupling to Octokit/Gitbeaker — it's tested in
  isolation (`retry.spec.ts`) with a generic `fn`, and each provider
  only supplies its own `shouldRetry`.
- The total wait time on a read with all attempts exhausted is bounded
  by `maxDelayMs` (4s) per attempt, not by a total-time ceiling — in the
  worst case (4 attempts, each at the cap), the wait sums to up to ~12s
  before the final error bubbles up.
