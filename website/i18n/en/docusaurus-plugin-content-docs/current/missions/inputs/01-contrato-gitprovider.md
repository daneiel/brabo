# Input 1 — the GitProvider contract that already exists

Input material for the PO in Phase 10. Describes **what's already
ready**, so the epic doesn't reinvent or contradict it. Everything here
was read from the code; every statement has a `file:line`.

Adding a new provider means three things, in this order: implementing the
ten operations, declaring the capabilities **honestly**, and passing the
single contract suite without writing your own scenario.

---

## The ten operations

Defined in `packages/shared/src/index.ts:287-303`. A provider is an object
that satisfies this interface — nothing more, nothing less.

| # | operation | input → output |
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

The ninth (`getFileContent`) was born with the Gitflow bootstrap
(`docs/adr/0005-repo-bootstrap-idempotent-steps.md`) and returns `null` —
never throws — when the file or the branch doesn't exist
(`packages/shared/src/index.ts:298`). The tenth (`commentOnPullRequest`)
was born with the Phase 4a PR gates and respects
`capabilities.pullRequests` like the other PR operations
(`packages/shared/src/index.ts:300-302`).

### Output formats

Defined in `packages/shared/src/index.ts:187-218`:

- `GitRepo` — `externalId`, `name`, `url`, `defaultBranch`, `visibility`
- `GitBranch` — `name`, `commitSha`, `protected`
- `GitCommitResult` — `sha`, `branch`
- `GitFileChange` — `path`, `content`
- `GitPullRequest` — `id`, `number`, `url`, `sourceBranch`, `targetBranch`,
  `state` (`"open" | "merged" | "closed"`)

### Input formats

`packages/shared/src/index.ts:220-285`. All of them carry an optional
`accessToken?: string` — the token comes decrypted from the caller, and
the provider never persists it.

| type | fields besides `accessToken` |
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

Note that `ProtectBranchInput` **carries no protection configuration** —
just which branch. Each provider decides what "protected" means, and that
divergence is handled in
`docs/adr/0028-protecao-de-branch-divergencia-entre-providers.md`.

---

## Capabilities: two flags, and they're the gate

```ts
interface GitProviderCapabilities {
  readonly protectBranch: boolean;
  readonly pullRequests: boolean;
}
```

`packages/shared/src/index.ts:182-185`. **Just two.** A new provider that
needs to express a third dimension is asking for a contract change — which
is an architecture decision, not an implementation detail.

What each provider declares today:

| provider | `protectBranch` | `pullRequests` | where |
|---|---|---|---|
| `LocalGitProvider` | `false` | `true` | `apps/api/src/infrastructure/git/local-git-provider.ts:55-58` |
| `GithubProvider` | `true` | `true` | `apps/api/src/infrastructure/git/github-provider.ts:39-42` |
| `GitlabProvider` | `true` | `true` | `apps/api/src/infrastructure/git/gitlab-provider.ts:41-44` |

The Local provider's `pullRequests: true` isn't a simulation: it's a
lightweight PR store in a sidecar of the bare repo, built for the Phase 4a
dev agents (`apps/api/src/infrastructure/git/local-git-provider.ts:51-54`).
The `protectBranch: false` stays because there's no platform to apply
protection to.

**RN-028 — capability decides, not the provider's name.** An unsupported
operation is declared in `capabilities` and rejected with
`GitNotSupportedError`, never fails silently. `LocalGitProvider` does
exactly this in `protectBranch`
(`apps/api/src/infrastructure/git/local-git-provider.ts:137`). No consumer
has `if (provider.name === 'local')`.

---

## Normalized errors

Seven classes, in `apps/api/src/domain/git/git-errors.ts`. Deliberately
**with no common base class** — decision recorded in
`docs/adr/0002-git-error-normalization.md`.

| class | constructor | line |
|---|---|---|
| `GitRepoAlreadyExistsError` | `(repoId)` | `:10` |
| `GitRepoNotFoundError` | `(repoId)` | `:17` |
| `GitBranchNotFoundError` | `(repoId, ref)` | `:24` |
| `GitBranchAlreadyExistsError` | `(repoId, branchName)` | `:34` |
| `GitPermissionDeniedError` | `(path)` | `:44` |
| `GitNotSupportedError` | `(provider, operation)` | `:51` |
| `GitCredentialConnectionTestFailedError` | `(provider, reason?)` | `:64` |

Don't confuse it with `apps/api/src/domain/git/git-provider-errors.ts`,
which has two **OAuth** classes (`GitProviderAuthError`,
`InvalidOauthStateError`) and isn't part of the normalized contract. The
distinction matters: `GitPermissionDeniedError` means "the token can't do
this"; `GitProviderAuthError` means "the OAuth flow failed".

The HTTP filter that translates these classes into a status code lives in
`apps/api/src/interfaces/http/shared/git-provider-error.filter.ts`.

### How each provider maps the raw vendor error

This is the real work of a new provider: the vendor speaks its own
dialect, and the contract only knows the seven classes above.

- **GitHub** (Octokit) — status `422` + `/already exists/i` →
  `GitRepoAlreadyExistsError` (`github-provider.ts:69-74`); `403` without
  a rate-limit signal → `GitPermissionDeniedError` (`:75-77`).
- **GitLab** (Gitbeaker) — status `400` + `/already (exists|been taken)/i`
  → `GitRepoAlreadyExistsError` (`gitlab-provider.ts:73-75`); `401`/`403` →
  `GitPermissionDeniedError` (`:76-78`).
- **Local** (git CLI via `execFile`) — code `EEXIST` →
  `GitRepoAlreadyExistsError` (`local-git-provider.ts:71`); `EACCES`/`EPERM`
  → `GitPermissionDeniedError` (`:72-74`).

The pattern to copy: **decide by status + a marker in the body**, never by
matching a substring of the full message, which changes without notice.

---

## Retry

`apps/api/src/infrastructure/git/retry.ts` — Full Jitter, 4 attempts,
**reads only** (`docs/adr/0003`). `LocalGitProvider` doesn't use it; GitHub
and GitLab do. A new provider that speaks HTTP should use the same helper,
for the same reason: retrying a non-idempotent write is how duplicates get
created.

---

## The single contract suite

`apps/api/test/contract/git-provider.contract.ts`. Exports the
`GitProviderContractHarness` interface (`:20`) and the function
`runGitProviderContract(label, makeHarness)` (`:35`). There are **19
scenarios**, and the new provider doesn't write any of them — it only
supplies the harness.

The scenarios, by operation:

| operation | scenarios |
|---|---|
| `createRepo` | creates one; rejects a name already in use (`GitRepoAlreadyExistsError`); rejects permission denied (`GitPermissionDeniedError`, skipped when running as root) |
| `getRepo` | returns the created one; rejects a nonexistent id (`GitRepoNotFoundError`) |
| `commitFiles` | first commit on a new branch; second commit produces a new sha; rejects a nonexistent branch (`GitBranchNotFoundError`) |
| `getFileContent` | returns content; `null` for a nonexistent file; `null` for a nonexistent branch |
| `createBranch` | creates from an existing ref; rejects a nonexistent `fromRef`; rejects an already-existing name |
| `listBranches` | lists the existing ones |
| `protectBranch` | **respects `capabilities.protectBranch`** |
| `openPullRequest` / `mergePullRequest` / `commentOnPullRequest` | **respect `capabilities.pullRequests`** |

The last four matter most for a new provider: the suite doesn't require
the operation to work — it requires it to **either work or throw
`GitNotSupportedError`, matching the declared flag**. Declaring `true` and
not implementing it fails; declaring `false` and implementing it also
fails.

Who runs the suite today:

| harness | file |
|---|---|
| `local` — real provider + temp directory | `apps/api/test/infrastructure/git/local-git-provider.contract.spec.ts:12` |
| `github (mocked)` — real provider + HTTP backend via `msw` | `apps/api/test/infrastructure/git/github-provider.contract.spec.ts:23` |
| `gitlab (mocked)` — same idea | `apps/api/test/infrastructure/git/gitlab-provider.contract.spec.ts:23` |
| `github (real API)` — only with `GITHUB_TEST_TOKEN` | `apps/api/test/infrastructure/git/github-provider.smoke.spec.ts:40` |
| `gitlab (real API)` — only with `GITLAB_TEST_TOKEN` | `apps/api/test/infrastructure/git/gitlab-provider.smoke.spec.ts:31` |

The mock + smoke pair is the model to follow: the suite runs in CI against
a fake backend, and the **same** suite runs against the real API behind an
env var, skipped by default.

> ⚠️ The comment at the top of
> `apps/api/test/contract/git-provider.contract.ts:12-18` still says only
> Local exercises the suite. It's been out of date since Phase 2 —
> recorded as a P3 finding in the mission, to be fixed in this phase.

---

## Registry

`apps/api/src/infrastructure/git/git-provider-registry.ts` — a `switch`
over `GitProviderName` that returns the injected instance. A new provider
goes in here, in the module
`apps/api/src/infrastructure/git/git-infrastructure.module.ts`, and in the
`GitProviderName` type in `packages/shared/src/index.ts`.

Watch out for something that's already bitten before: `packages/shared` is
**100% types**. A runtime list can't live there — the package is resolved
from the raw `.ts`, and the api's production image wouldn't build. There's
a test guarding this (`apps/api/test/packages-shared-so-tipos.spec.ts`).

---

## Where the provider shows up outside the backend

The epic needs to cover these points, or else the provider exists and
nobody can pick it:

- `apps/web/src/routes/NewProjectWizard.tsx:28-37` — the wizard's
  `PROVIDERS` array
- `apps/web/src/lib/wizard.ts` — `providerNeedsCredential`, which decides
  whether the credential step appears
- `apps/web/src/components/wizard/CredentialStep.tsx:19-21` — labels
- `apps/web/src/components/ProjectCard.tsx:11-19` and
  `apps/web/src/routes/ProjectPage.tsx:16` — icon and label per provider
- `apps/web/src/components/ui/icons.tsx` — the icons
- `credentialProviderEnum` in `apps/api/src/db/schema.ts:198-203` — needs
  a migration if the provider accepts a credential

---

## Two business rules the epic must not contradict

- **RN-028** — capability decides, not the provider's name. Verified by
  the contract suite run against every provider.
- **RN-029** — the Gitflow bootstrap is idempotent and resumable; it's six
  steps, each one checks before acting, and `skip` **is success**. A
  provider without `protectBranch` makes that step come out `degraded`,
  which is also success — `bootstrap.step_degraded` exists exactly for
  that.
