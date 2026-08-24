# Input 3 — GenericGitProvider: minimal capabilities and degradation

Input material for the PO in Phase 10.

`GenericGitProvider` is the provider for "some plain git server, no
platform API": a self-hosted Gitea, a bare repo behind SSH, a Forgejo, a
server that only speaks the plain git protocol. It's the opposite kind of
problem from Bitbucket — there the challenge is translating a rich API;
here it's **honestly declaring what can't be done**, and making sure the
rest of the system degrades instead of breaking.

The contract to satisfy is in `inputs/01-contrato-gitprovider.md`.

---

## The precedent already exists: `LocalGitProvider`

It isn't a new provider in spirit — it's `LocalGitProvider` with the
remote somewhere else. Everything the epic needs to decide already has an
answer there, and the cheapest path is reading that file before designing
anything
(`apps/api/src/infrastructure/git/local-git-provider.ts`, 467 lines).

What it establishes:

- **Declares `protectBranch: false`** and `pullRequests: true`
  (`apps/api/src/infrastructure/git/local-git-provider.ts:55-58`).
- **Rejects an unsupported operation with `GitNotSupportedError`**, never
  silently (`:137`, and also `:290` and `:323` for merge paths without a
  real PR).
- **Implements real PRs without a platform**: a lightweight PR store in a
  sidecar of the bare repo, built for the Phase 4a dev agents (`:51-54`).
  In other words, `pullRequests: true` without a PR server **is
  possible** — the question is where the state lives.
- **Speaks real git**, via `execFile` on the binary, not a
  reimplementation.

---

## The central question: where does the state the server doesn't keep live

A plain git server knows about refs, objects, and nothing else. It has no
PR, no comment, no branch protection. The contract's ten operations each
need an answer for that absence.

| operation | does the plain git server know it? | expected answer |
|---|---|---|
| `createRepo` | depends — creating a remote repo requires an API or disk access | investigate; may be the missing capability |
| `getRepo` | partially — `defaultBranch` can be discovered via `ls-remote` | probably yes |
| `createBranch` | **yes** — it's a ref push | yes |
| `protectBranch` | **no** | `false` + `GitNotSupportedError` |
| `commitFiles` | **yes** | yes |
| `listBranches` | **yes** — `ls-remote --heads` | yes, always with `protected: false` |
| `openPullRequest` | **no**, natively | decision: own store (like Local) or `false` |
| `mergePullRequest` | **no**, natively | same |
| `commentOnPullRequest` | **no** | same — and this is what the gates use |
| `getFileContent` | **yes** — `git show ref:path` | yes, with `null` for both absence cases |

**The single architecture decision:** does Generic reuse `LocalGitProvider`'s
PR mechanism (and then declare `pullRequests: true`), or does it declare
`false` and accept the cascading degradation? Both are defensible. What's
not defensible is declaring `true` and then throwing
`GitNotSupportedError` — the contract suite fails that, on purpose.

---

## What declaring `false` costs, in cascade

Before choosing, it's necessary to know what gets lost. Declaring
`pullRequests: false` isn't a provider detail — it turns off part of the
product.

- The **QA and SecOps gates** post their verdict on the PR
  (`commentOnPullRequest`, the tenth operation, was born for this in
  Phase 4a). Without a PR, the verdict exists as an event-log artifact but
  doesn't show up in the repository.
- The **dev agents' flow** opens a PR when a task is done.
- The **protected-merge lock** (`decide.ts:149-160`) still holds — it's a
  domain concern, not a platform one. This matters: **not having
  protection on the server doesn't loosen anything**, because what
  prevents an improper merge is the cap in the domain.

The epic needs to say explicitly what happens to each of these on
Generic. "Degrades" isn't an answer — degrades **into what** is.

---

## Degradation in the bootstrap: the mechanism is already there

**RN-029** — the Gitflow bootstrap is idempotent and resumable; it's six
steps, each one checks before acting, and `skip` **is success**
(`apps/api/src/application/use-cases/git/bootstrap-steps.ts`).

For a provider without `protectBranch`, the `protect_branches` step
doesn't fail: it comes out **`degraded`**, which is also success. The
`bootstrap.step_degraded` event exists exactly for "completed without one
of the provider's capabilities" — see `docs/reference/events.md`, the
"Git and bootstrap" section. With the Local provider this already happens
today, on every run.

In other words: **degradation doesn't need to be built, it needs to be
declared.** The system already knows how to handle a missing capability;
what it won't forgive is a capability that lied.

---

## What "minimal" means, concretely

A provider is accepted when:

1. The ten operations exist — even if some only throw
   `GitNotSupportedError` (`apps/api/src/domain/git/git-errors.ts:51`).
2. The two capabilities reflect reality
   (`packages/shared/src/index.ts:182-185`).
3. The **19 scenarios** of the single suite pass, with no scenario of its
   own written (`apps/api/test/contract/git-provider.contract.ts`). The
   `protectBranch`, `openPullRequest`, `mergePullRequest`, and
   `commentOnPullRequest` scenarios specifically check the coherence
   between the declared flag and the behavior — working when `true`,
   rejecting when `false`.

**RN-028** closes the rule: capability decides, not the provider's name.
No consumer gets an `if (provider.name === 'generic')`. If one needs it,
the problem is the capability modeling, not the consumer — and that goes
to an ADR.

---

## Open questions for the Architect

- **Configuration.** Generic needs the remote's URL, and probably a
  credential. How does that get in? `CreateRepoInput` has `name`,
  `visibility`, `namespace`, and `accessToken` — none of them is "server
  URL". Where does the URL live: in `externalId`, in a new column on
  `provisioned_repositories`, or in project configuration?
- **Authentication.** Token over HTTPS, an SSH key, or both? An SSH key
  doesn't fit `accessToken?: string` the way a token does, and
  `credentialProviderEnum` (`apps/api/src/db/schema.ts:198-203`) would
  need a new entry either way.
- **`visibility`.** `GitRepo` requires `"public" | "private"`
  (`packages/shared/src/index.ts:187-193`). A plain git server may not
  have that concept. What gets returned — a declared default, or does it
  become an optional field in the contract?
- **`createRepo`.** If Generic can't create a remote repository, it's
  useless for the current wizard, which always calls `createRepo`
  (`provision-repository.use-case.ts:144`). This connects to the
  mission's P1 finding: the product doesn't know how to adopt an existing
  repository. **Generic may be exactly the provider that makes that
  finding urgent** — worth having the Architect assess whether the two
  should be solved together.
- **Security.** A server URL supplied by the user is an SSRF surface.
  Worth checking how `docs/security-surface.md` handles outbound network
  access before deciding.

---

## What NOT to do

- Don't implement the ten operations "somehow" just to be able to declare
  everything `true`. Honesty in the capability is the requirement;
  completeness isn't.
- Don't copy `LocalGitProvider` by literal copy-paste. What gets reused is
  the **decision** (where the PR state lives), not necessarily the code.
- Don't create an `if` by provider name in any consumer.
