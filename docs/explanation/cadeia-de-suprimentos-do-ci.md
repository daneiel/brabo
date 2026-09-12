---
id: cadeia-de-suprimentos-do-ci
title: The CI supply chain
sidebar_label: CI supply chain
description: What runs inside our CI runners that we didn't write, how it's pinned, and what's still trusted on faith.
---

# The CI supply chain

Every job in this repository runs third-party code on a machine that has
a checkout of the source and, in the release workflows, credentials for
the GHCR registry, the npm registry and the repository's own git refs.
That code arrives two ways: **GitHub Actions** (`uses:`) and **binaries
downloaded with `curl`** (the scanners). Neither is written here, and
neither is reviewed by a PR.

This page is about the part of that we control. It exists because the
mechanism lived only in workflow comments — a place where a rule can be
read but not audited, and where the two halves drifted for exactly that
reason.

## The threat, stated plainly

A tag is a pointer. `actions/checkout@v4` is not a version, it's a name
that the action's owner can delete and recreate pointing at a different
commit, at any moment, with no signal in this repository. Whoever moves
that tag runs their code in our runner, on our checkout, with whatever
secrets that workflow was granted.

The same holds for a `curl` of a GitHub Release asset: a compromised
release, or a MITM between the runner and the CDN, hands us a different
binary and nothing notices — until the scanner fails to start, or worse,
until it "works."

Neither is a hypothesis about our repository specifically. They're the
two documented ways CI gets compromised in the wild, and the defense for
both is the same idea: **refer to content, not to a name**.

## The two mechanisms

### Binaries: checksum after every download

Every `curl` of a release asset in `ci.yml` and in both engine
Dockerfiles is followed by `sha256sum -c` against a hash written in the
workflow itself:

```yaml
GITLEAKS_SHA256: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'
```

The hashes come from the `checksums.txt` published with each release, on
an independent download. A mismatch fails the job before the binary is
ever executed.

The scanner versions have a second constraint: they must match
`docker/engine/Dockerfile.prod`, because testing against a different
scanner from the one that runs in production is a false green. The
comment promising that was there since Phase 5; the step that *enforces*
it (`Versões dos scanners batem com o Dockerfile.prod do engine`, in the
`lint` job) arrived only with [#408](https://github.com/daneiel/brabo/pull/408).

### Actions: commit SHA, with the version alongside

Every `uses:` is pinned to a 40-character commit SHA, with the tag it
came from preserved in a trailing comment:

```yaml
- uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262  # v4
```

The comment is **required**, and not as decoration. It's the only thing
that tells a human — and Dependabot, which reads exactly that comment —
which version a hash is. A SHA with no version beside it is a pin nobody
can audit and nobody can update.

To resolve a tag into the SHA to write down:

```bash
gh api repos/actions/checkout/commits/v4 --jq .sha
```

## Why there's a check and not just a rule

#408 pinned the actions in `ci.yml` and only there. The other fifteen
workflows stayed on mutable tags for months — including `release.yml`
(pushes images to GHCR), `publish-runner.yml` (publishes to npm),
`tag-release.yml` (creates tags) and `docs-deploy.yml` (pushes to
`gh-pages`). The half that was left unpinned was, precisely, the half
that holds credentials.

That isn't carelessness, it's the predictable shape of a rule with no
mechanism: a new workflow is written by copying a neighbour, and the
neighbour had a tag. So the rule now has a mechanism —
`scripts/ci/actions-pinadas.ts`, run in the `lint` job, which fails on
any `uses:` that isn't a commit SHA, and on any SHA without its version
comment. It's the same reasoning as
[the RN and ADR counts](documentation-workflow.md): a number kept correct
by hand goes stale the moment someone forgets, so the artifact is read
instead of trusted.

A reference to an action **inside this repository** (`./.github/...`)
passes: it's our own code, reviewed by the PR that changes it, with no
third party able to move anything.

## The Playwright browser

The browser E2E ([ADR 0120](../adr/0120-e2e-de-navegador-contra-o-compose-de-producao.md))
downloads chromium at CI time from Playwright's CDN — a third download
that isn't an action and isn't a GitHub Release asset, so neither of the
two mechanisms above covers it.

What pins it is the **exact** `@playwright/test` version in `e2e/pnpm-lock.yaml`:
each release of the package is bound to one browser build, and
`playwright install` fetches that one. So the pin is the lockfile, and
`--frozen-lockfile` in the job is what makes it a pin rather than a
suggestion.

There is no `sha256sum -c` here, and that's the honest description: the
tool downloads and verifies on its own, and reproducing its checksum
table by hand would be a copy that ages. Weaker than the scanner
binaries, stated rather than implied.

## Container images: digest, with the tag alongside

Third-party images are pinned by **digest**, in exactly the shape the
actions use:

```yaml
image: neo4j@sha256:22ec5cd05a8cbb372fc4bed5e384c30bc75fd92504c72be4462039761b105f61  # 5.26-community
```

```dockerfile
FROM node@sha256:b8f7c9056af700568c1ce76173f1c93743fb64ca1343e18cdf3a6ded8985ad3d AS deps  # 24.11.1-alpine3.21
```

This page used to say the opposite — tag pinning was "a deliberate stop,
not an oversight," buying day-to-day reproducibility "without the
maintenance cost of digests on images we don't publish." That reasoning
is **revoked**, and the measurement is why: the 37 third-party references
in the repository were on tags, and three of the places they run are
worse than a `docker compose pull` going stale.

- The `FROM` lines are the base of the four images we **publish** to
  GHCR. A moved tag becomes bytes inside an image we sign and hand to
  other people.
- `docker/docker-compose.install.yml` runs on the machine of whoever
  installed the product, beside their Postgres. In that same file the
  four **own** images already arrive by digest, through a variable the
  installer fills — the third-party ones arrived by tag, next to them.
- `ci.yml` and `golden-set-rag.yml` run third-party images as job
  `services:`. That is literally the runner the action rule exists to
  protect, reached by the other door.

To resolve a tag into the digest to write down — the **index** digest, so
the pin keeps working on `linux/arm64` as well as `linux/amd64`:

```bash
docker manifest inspect neo4j:5.26-community | head -3   # confirms it is an index
docker buildx imagetools inspect neo4j:5.26-community --format '{{.Manifest.Digest}}'
```

The trailing `# <tag>` comment is **required**, for the same reason it is
on actions: `sha256:22ec5cd0…` does not tell anyone that it is Neo4j
5.26. And, as with the actions, the rule has a mechanism rather than
goodwill — `scripts/ci/imagens-pinadas.ts`, run in the `lint` job, which
fails on any `image:`/`imageName:`/`FROM` that is not a digest, on any
digest with no tag comment, and on the same tag carrying two different
digests in two files. It is a **sibling** of `actions-pinadas.ts`, not an
extension of it: `uses:` lives in workflow YAML with one syntax, images
live in composes, kustomize manifests and Dockerfiles with three others,
and one function answering both questions would answer both badly.

What the check deliberately does **not** cover:

- **The images we build ourselves** (`brabo-api`, `brabo-engine`,
  `brabo-web`, `brabo-backup`, and `brabo-broker`, which is not
  published). There is no third party who could move anything, and
  `brabo-api:prod` is a *local* tag whose digest does not exist before
  the build. Where they do cross a registry they are **already** by
  digest, through the mechanism that owns them: `.release/images.json`
  written by `release.yml` and applied by `make imagens-do-release`
  ([ADR 0119](../adr/0119-imagens-publicadas-no-ghcr-por-digest.md)). The
  repository's overlay holds the *marker*, not a frozen release —
  demanding a literal digest there would fight that mechanism instead of
  reinforcing it.
- **Interpolated references** (`${BRABO_API_IMAGE:?…}`), which is the
  same case seen from the other side.
- **Multi-stage build stages** (`FROM deps AS build`, `FROM scratch`),
  which are not registry images.

The exception list is by *name* and fails closed: a new third-party image
never matches `brabo-`, so it is born under the rule.

**The price is real and is not paid here.** An image pinned by digest
receives no security update until someone changes the digest by hand —
the same debt the action SHAs carry. `.github/dependabot.yml` enables the
`github-actions` ecosystem for that reason; the `docker` ecosystem is
**not** enabled, and turning it on is a separate decision.

## What is still trusted on faith

Declared, not fixed:

- ~~**No Dependabot.**~~ **Half closed, and the other half is not ours
  to close.** The claim had also stopped being true: *security* updates
  are switched on in the repository's **interface**, in no file, and were
  running daily against `npm_and_yarn in /., /website` — and **failing**,
  every day, with `Dependabot::DependabotError`. Measured cause: the
  packages it chases (`multer`, `esbuild`, and the list beside them) are
  the ones this repository fixes through **overrides** in
  `pnpm-workspace.yaml`, a mechanism Dependabot cannot manipulate. The
  alert it pursues is already closed; what is left is the error.

  `.github/dependabot.yml` now exists and does the two things a file can
  do: it **enables `github-actions`** — the debt named right here, since
  the SHAs are moved by hand and *a pin nobody updates is a pin that ages
  into a known-vulnerable version* — and declares both npm trees with
  `open-pull-requests-limit: 0`, which turns off routine version updates
  without touching security ones. **Turning security updates off is an
  interface switch**, reachable only by the repository owner; until
  someone decides, that job keeps failing on alerts that the overrides
  already closed.
- **npm/pnpm dependencies aren't attested.** The lockfile pins versions
  and integrity hashes, which is real, but there's no provenance check
  (`npm audit signatures` or equivalent) in any job.
- ~~**No signing or attestation of our own artifacts.**~~ **Closed by
  [ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md)**
  (BRB-005). `release.yml` signs the four images **by digest** with
  `cosign` keyless — the OIDC identity of the workflow, no key in
  custody anywhere — and `build-runner-binaries.yml` gained a
  consolidating job that publishes **one signed `checksums.txt`**
  covering the five binaries, rather than five separate signatures.
  Both workflows **verify what they just signed**, in the same run:
  a signature nobody tries to verify is one more file in the release,
  and the failure would otherwise surface on the machine of whoever
  installs — the worst place to find it.

  What this does **not** cover, and is a different item: **code-signing
  the runner binaries** for the OS (macOS notarization, Windows
  Authenticode), which needs a paid signing identity and stays in
  [the backlog](backlog.md).
- ~~**Third-party images are tag-pinned, not digest-pinned.**~~ **Closed**
  (above): all 37 third-party references — composes, kustomize manifests,
  Dockerfile `FROM` lines and the workflow `services:` — are pinned by
  digest with the tag in a comment, and `scripts/ci/imagens-pinadas.ts`
  fails the `lint` job on the next regression. What is **not** closed, and
  is the price of the pin rather than a leftover: a digest receives no
  security update until someone bumps it by hand, and Dependabot's
  `docker` ecosystem is not enabled — a separate decision.
- **The workflows' own permissions** aren't covered here; that's the
  `permissions:` block per workflow, and it's a separate audit.
- **A repeated `pnpm audit` timeout is an ACCEPTED RISK, by decision.**
  When the npm advisories endpoint fails to answer three times in a row,
  the job goes green with a loud warning instead of red — see
  [ADR 0140](../adr/0140-timeout-do-audit-como-risco-assumido.md). What
  this costs is stated plainly: on those runs the dependency tree is
  **not** audited, and the run says so rather than implying a clean
  result. What it does not touch: a vulnerability that is actually
  reported still fails on the first attempt, with no retry, and an
  unrecognized failure fails too (fail closed). The alternative —
  staying red on third-party downtime — was measured on the day it
  happened (four PRs blocked by the same 503) and refused, because a
  gate that cries wolf teaches people to re-run until green, and that
  habit does not distinguish a real red from a fake one.
