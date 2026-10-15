# 0028 — Branch protection: divergence between providers and the approval matrix

## Context

[ADR 0001](0001-git-provider-contract-shape.md) normalized nine git
operations into a single contract. Eight of them diverge between GitHub
and GitLab only in the FORM of the API — field name, id format, error code
— and normalization handles it. `protectBranch` is the exception: there the
two diverge in the **model**, and translation isn't possible without losing
meaning.

The divergence had been recorded as a comment in both providers since
Phase 2. This ADR promotes it to an explicit decision because, from Phase 4
onward, the domain gained its **own approval matrix** — QA → SecOps → user,
with the merge lock's ceiling in `decide.ts` — and now there are two
sources of authority over the same merge. That overlap didn't exist when
the comment was written.

## What each provider does today

`ProtectBranchInput` (packages/shared) carries **only** `externalId`,
`branchName` and `accessToken` — no policy configuration. Each
implementation picks "the most restrictive that's reasonable", and that
lands in different places:

| provider | platform model | what we apply |
|---|---|---|
| **GitHub** | independent rules in a rich payload | `enforce_admins: true`, `required_approving_review_count: 1`, no status checks, no push restriction |
| **GitLab** | two access levels | `pushAccessLevel: MAINTAINER`, `mergeAccessLevel: MAINTAINER` |
| **local** | no platform exists | `capabilities.protectBranch: false`; the call is rejected with `GitNotSupportedError` |

The bootstrap's `protect_branches` step checks the capability before
acting, and the contract suite asserts by **capability**, not by provider —
that's why the divergence never broke a test: both paths are equally valid
for the contract.

## The asymmetry the approval matrix exposes

The two protections aren't "the same thing written differently". They
interact with the domain's matrix in opposite ways:

- **On GitHub, we create a second authority.** `required_approving_review_count: 1`
  requires an approval FROM THE PLATFORM that the domain doesn't know about
  and doesn't fill in — QA and SecOps's verdicts are our own events, not
  GitHub reviews. Combined with `enforce_admins: true`, which removes the
  administrator bypass, the user's manual merge — which CLAUDE.md makes
  mandatory — can end up **blocked by the platform** when there's no second
  human to approve the PR.
- **On GitLab, we create no authority at all.** There's no approval count:
  whoever holds the Maintainer role can push and merge directly. The
  domain's matrix is the ONLY gate, and a Maintainer token bypasses it
  entirely.
- **On local, only the domain's gate exists**, by construction.

In other words: the same system ends up stricter than intended on one
provider and looser on the other, through the same argument-less
`protectBranch()`.

## Decision

**1. The domain's approval matrix is the source of truth.** QA → SecOps →
user, with `decide.ts`'s ceiling (a merge targeting a protected branch is
never auto-approvable). The platform's protection is defense in depth
against access outside of Brabo — it isn't the gate, and no domain logic
should depend on it.

**2. The divergence stays.** Translating the two models into a common
denominator would mean either bringing GitHub down to GitLab's level
(losing `enforce_admins`) or inventing an approval concept on GitLab that
the platform doesn't have on the free tier. Each side applies the most
restrictive thing it can express, and the contract promises only what's
observable: `listBranches` returns `protected: true`.

**3. `ProtectBranchInput` does NOT gain configuration now.** Adding
`requiredApprovals`, `enforceAdmins` and the like would create a vocabulary
that only one of the providers knows how to honor, and the other would
have to silently ignore — which is worse than the current divergence,
because it would start lying. When there's a real need, the path is a
normalized `ProtectionPolicy`, with the provider declaring via
`capabilities` what it knows how to apply, and the bootstrap reporting
what was ignored.

## Consequences

**Accepted:**

- Different strictness per provider, documented here and in the comments
  of both files, which now point to this ADR.
- On GitHub, a single-owner repository can have its manual merge blocked
  by the very protection we apply. The workaround is the operator's
  (lowering `required_approving_review_count` to 0 on the repository), not
  the code's — changing it by default would loosen the protection for
  every repository to solve one particular case.

**Not verified:**

- **Neither of these two paths has been exercised against a real API in
  this repository.** The smokes (`github-provider.smoke.spec.ts`,
  `gitlab-provider.smoke.spec.ts`) are manual and skipped without
  `GITHUB_TEST_TOKEN` / `GITLAB_TEST_TOKEN`; CI uses `LocalGitProvider`,
  whose capability is `false`. The merge blocking described above is a
  deduction from the two platforms' documented behavior, not an
  observation. **When the first real repository is connected, verifying
  this is the first test to run.**

**Out of scope:**

- Reflecting QA/SecOps's verdicts as GitHub status checks, which would
  eliminate the overlap by turning the domain's matrix into the platform's
  merge condition. That's the right solution and depends on Brabo having a
  public endpoint for GitHub to call — see the pending registry/exposure
  item in [ADR 0027](0027-fase5-backup-hardening-release.md).
