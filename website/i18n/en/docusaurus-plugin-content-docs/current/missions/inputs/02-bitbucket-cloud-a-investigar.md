# Input 2 — Bitbucket Cloud: what to investigate before coding

Input material for the PO and the Architect in Phase 10.

**This file is a list of questions, not answers.** Nothing here claims how
Bitbucket Cloud works. Each item points at a semantic that needs to be
**verified against the official documentation** before becoming code —
and the result of that verification is what the Architect records in the
semantics ADR, via a real PR.

The rule comes from recorded pain: Phase 9b stalled precisely because it
couldn't verify `baseUrl`, auth, and the `usage` format against the
official docs, and the decision was to not guess
(`docs/adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md:147-156`).
A provider coded against a guessed contract passes the mock and fails
against the real thing — which is the worst place to find out.

The contract to satisfy is in `inputs/01-contrato-gitprovider.md`.

---

## 1. Authentication

What gets decided here changes the schema, not just the provider.

- What authentication mechanisms does Bitbucket Cloud offer today, and
  which are **deprecated**? (App passwords, API tokens, OAuth 2.0,
  repository/workspace access tokens — which exist, which have an
  announced end date?)
- Which of them fits the current shape: a single `accessToken?: string`
  per call (`packages/shared/src/index.ts`, all the `*Input` types)? If
  the mechanism requires a **username+password pair** instead of a single
  token, that **doesn't fit** the contract — and the decision belongs to
  the Architect: adapt it inside the provider, or change the contract.
- What's the minimum scope that covers the ten operations? Are reading,
  writing, administering PRs, and administering branch restrictions
  separate scopes?
- How should the connection test be done? The existing pattern is a
  "who am I" call
  (`apps/api/src/infrastructure/git/git-credential-connection-tester.ts`),
  synchronous and required before encrypting
  (`docs/adr/0004-git-credential-registration.md`).

**Schema impact:** `credentialProviderEnum`
(`apps/api/src/db/schema.ts:198-203`) currently has `ollama`, `anthropic`,
`openai`, `github`, `gitlab`. Adding `bitbucket` requires a migration. If
the auth mechanism needs two fields, the `user_credentials` table stores
**one** encrypted secret per row — which is also an architecture decision,
not a detail.

---

## 2. Repository identity (`externalId`)

The contract treats `externalId` as an opaque string, and the two current
providers interpret it differently (GitHub uses `owner/repo`; see
`splitFullName` in `apps/api/src/infrastructure/git/github-provider.ts`).

- What is the canonical identity of a repository on Bitbucket Cloud —
  `workspace/repo_slug`, a UUID, or both?
- Is the slug stable when the repository is renamed? If not, the
  `externalId` persisted in `provisioned_repositories` rots — and that
  needs to be in the ADR.
- What fills `namespace` in `CreateRepoInput`: workspace, project
  (Bitbucket has a "project" level that GitHub and GitLab don't), or both?
  If there's an extra level in the hierarchy, does it fit into `namespace`
  alone?

---

## 3. Branch restrictions — the equivalent of `protectBranch`

The most delicate point, because it's where the three current providers
already diverge
(`docs/adr/0028-protecao-de-branch-divergencia-entre-providers.md`).

- How does Bitbucket Cloud model branch restriction? Is it **one**
  entity with several fields, like GitHub, or **several** independent
  rules that need to be created one by one?
- If it's several, applying "protection" becomes N calls. `protectBranch`
  returns `void` and isn't transactional — what happens if the third call
  fails? What's the observable state afterward?
- Is there anything equivalent to `enforce_admins`? If so, **don't repeat
  GitHub's mistake**: `github-provider.ts:170-175` applies
  `enforce_admins: true` + 1 reviewer without reading the current state,
  which can lock the owner out of their own manual merge (ADR 0028:83-84).
  It's recorded as a P1 finding of the phase.
- Does applying a restriction on a branch that already has one
  **overwrite** it or **accumulate**? The answer changes whether the step
  is idempotent or destructive — and RN-029 requires idempotency.
- `GitBranch` carries `protected: boolean`
  (`packages/shared/src/index.ts:195-199`). How does `listBranches`
  discover that boolean on Bitbucket? Is it a field on the branch, or does
  it require a second call listing restrictions and cross-referencing? If
  it requires N+1 calls, that's a cost to declare.

**Underlying question:** are the two flags of `GitProviderCapabilities`
enough to honestly describe Bitbucket? If the answer is no, the decision
belongs to the Architect and goes into an ADR — it isn't resolved by
declaring `true` and hoping for the best.

---

## 4. Merge strategies

- Which merge strategies does Bitbucket Cloud accept for a PR, and
  **what's the default** when none is specified?
- `MergePullRequestInput` (`packages/shared/src/index.ts:267-271`) only
  carries `externalId` and `pullRequestId` — there's no strategy field. Is
  Bitbucket's default acceptable for Brabo's flow, or does the provider
  need to fix one explicitly?
- The merge can fail due to a conflict, an unmet branch restriction, or a
  missing approval. Which of the seven normalized error classes does each
  of these become? If none fits, that's a new error — and adding a class
  to the contract is a decision, not a detail.
- The return needs to fill `GitPullRequest.state` with `"merged"`. Does
  Bitbucket provide that in the merge response, or does it require a
  re-read?

---

## 5. Pull requests, comments, and the rest

- `openPullRequest` — how does Bitbucket identify the source and target?
  Does it accept a branch name directly, or does it require an object with
  the repository attached (relevant for PRs between forks)?
- `GitPullRequest` needs both `id` **and** `number`
  (`packages/shared/src/index.ts:211-218`). Does Bitbucket have the two
  concepts separately, or just one? If just one, what goes in each field?
- `commentOnPullRequest` — which endpoint, and does the comment need to be
  at the PR level (not a diff-line comment)? The QA/SecOps gates post
  their verdict on the whole PR.
- `getFileContent` — which endpoint returns the raw content of a file on a
  branch? Does it return 404 equally for a missing file and a missing
  branch? The contract requires `null` in **both** cases, never a throw.
- `commitFiles` — the contract commits **several files in a single
  message** (`CommitFilesInput.files`). Does Bitbucket support that in one
  call, or does it require one per file? If it does, the result isn't
  atomic, and that needs to be in the ADR.

---

## 6. Errors: the status → class map

Repeating the pattern the current providers follow: **decide by HTTP
status + a marker in the body**, never by matching the full message
string.

Gather this, with evidence from the official docs:

| situation | status Bitbucket returns | normalized class |
|---|---|---|
| repository with a name already in use | ? | `GitRepoAlreadyExistsError` |
| nonexistent repository | ? | `GitRepoNotFoundError` |
| nonexistent branch/ref | ? | `GitBranchNotFoundError` |
| branch already exists | ? | `GitBranchAlreadyExistsError` |
| token without permission | ? | `GitPermissionDeniedError` |
| rate limit | ? | **not** `GitPermissionDeniedError` — see the care GitHub takes in `github-provider.ts:75-77` |

Special attention to the ambiguous-404 pair: if "repository doesn't exist"
and "token can't see the repository" return the **same** 404, the provider
can't tell `GitRepoNotFoundError` apart from `GitPermissionDeniedError`.
That's a legitimate limitation — and the decision of which of the two to
throw needs to be written down, not implicit.

---

## 7. Retry

`apps/api/src/infrastructure/git/retry.ts` does Full Jitter, 4 attempts,
**reads only** (`docs/adr/0003`).

- Does Bitbucket signal rate limiting in a distinguishable way (header,
  dedicated status)? Is it worth respecting `Retry-After` if it exists?
- Is any Bitbucket write idempotent enough to be worth retrying? The
  default answer is no — retrying a write is how duplicates get created.

---

## 8. How to validate without a real credential

The model already exists and should be copied: mock in CI, smoke behind an
env var.

- The fake backend goes in `apps/api/test/support/msw/` (see
  `github-fake-backend.ts` and `fake-repo-store.ts` as reference).
- The smoke runs the **same** suite with `describe.skipIf(!token)`, in the
  pattern of
  `apps/api/test/infrastructure/git/github-provider.smoke.spec.ts:37`.

> The smoke's env var would follow the `BITBUCKET_TEST_TOKEN` pattern. If
> the auth mechanism chosen in item 1 requires more than one value, the
> name and shape change — and that's also a decision to record.

---

## What NOT to do

- Don't infer behavior from GitHub or GitLab by analogy. The two already
  diverge from each other on branch protection; assuming a third provider
  follows the pattern of the other two is how silent debt accumulates.
- Don't declare a capability `true` without a suite scenario passing
  against it.
- Don't leave a question unanswered and code anyway. If the official docs
  don't answer it, **that is the answer** — and it becomes a declared
  limitation in the ADR, the same way Phase 9b declared `listModels: false`
  instead of guessing the parsing.
