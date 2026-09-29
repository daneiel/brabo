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

`propriedades.yml` (the scheduled property proofs, BRB-009) follows the same
rule for the three binaries it needs to bring up a cluster — `k3d`, `helm`
and `kubectl`, each with its hash in the workflow's `env:`. It installs them
**before** running `deploy/k8s/bootstrap.sh`, and that order is the point:
the bootstrap's own `ensure_k3d` downloads k3d with **no** checksum, and
finding the binary already on `PATH` is what keeps it from downloading. A
step fails the job if the versions pinned there drift from the ones the
bootstrap would install. What that workflow still takes on trust, stated:
the Helm charts come from their repositories by **version**, not digest
(`deploy/k8s/helm/charts.env`), with whatever images those charts reference;
and `k3d` pulls the `rancher/k3s` node image and its load-balancer image by
the **tag baked into the k3d binary** — pinned, then, only as far as the k3d
checksum pins it.

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

## Container images: digest, with the tag inside the reference {#container-images-digest-with-the-tag-alongside}

Third-party images are pinned by **digest**, with the tag they came from
written **inside the reference**, before the digest — `image:tag@sha256:<index>`
([ADR 0178](../adr/0178-tag-inline-na-imagem-de-terceiro.md)):

```yaml
image: neo4j:5.26-community@sha256:22ec5cd05a8cbb372fc4bed5e384c30bc75fd92504c72be4462039761b105f61
```

```dockerfile
FROM node:24.11.1-alpine3.21@sha256:b8f7c9056af700568c1ce76173f1c93743fb64ca1343e18cdf3a6ded8985ad3d AS deps
```

With both present, Docker pulls by the digest: the tag is information for
whoever reads the line, and the digest decides the bytes.

**Until ADR 0178 the tag lived in a comment** (`neo4j@sha256:…  # 5.26-community`,
and in a Dockerfile on the line above), mirroring the actions. It moved because
of a measurement (AT-139, 2026-09-27): Dependabot does not read that comment in
any format, and a digest-only pin is "updated" to the digest of `latest` — which
would have taken pgvector, neo4j and node to another major with the comment still
claiming the old tag and the lint green. With the tag inline, Docker,
Dependabot and a human all read the same tag. The CloudNativePG `imageName`
already had this shape, for a different reason: its webhook refuses a
digest-only reference, because it reads the Postgres version from the tag.

A comment is still **allowed**, but only if it says the same thing: a comment
that states one tag (a single token with a digit) different from the inline
one fails the check — it is exactly the leftover a version bump would leave
lying. **In a Dockerfile a comment at the end of the `FROM` line still fails**:
Docker's parser only recognizes `#` at the *start* of a line, so
`FROM alpine:3.20@sha256:… # 3.20` is a `FROM` with three arguments, and the
build dies with *"FROM requires either one or three arguments"*. This was found
the right way under ADR 0159 — the `images` job's `bake` step failed on the first
push, in 27 seconds — and `hadolint` had passed the same file: a linter agreeing
is not the build agreeing.

This page used to say the opposite — tag pinning was "a deliberate stop,
not an oversight," buying day-to-day reproducibility "without the
maintenance cost of digests on images we don't publish." That reasoning
is **revoked**, and the measurement is why: the 37 third-party references
in the repository were on tags, and three of the places they run are
worse than a `docker compose pull` going stale.

- The `FROM` lines are the base of the images we **publish** to
  GHCR — five since [ADR 0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md). A moved tag becomes bytes inside an image we sign and hand to
  other people.
- `docker/docker-compose.install.yml` runs on the machine of whoever
  installed the product, beside their Postgres. In that same file our
  **own** images already arrive by digest, through a variable the
  installer fills — the third-party ones arrived by tag, next to them.
- `ci.yml`, `golden-set-rag.yml` and `golden-set-qa.yml` run third-party images as job
  `services:`. That is literally the runner the action rule exists to
  protect, reached by the other door.

To resolve a tag into the digest to write down — the **index** digest, so
the pin keeps working on `linux/arm64` as well as `linux/amd64`:

```bash
docker manifest inspect neo4j:5.26-community | head -3   # confirms it is an index
docker buildx imagetools inspect neo4j:5.26-community --format '{{.Manifest.Digest}}'
```

The tag is **required**, for the same reason the version comment is on
actions: `sha256:22ec5cd0…` does not tell anyone that it is Neo4j 5.26. And,
as with the actions, the rule has a mechanism rather than goodwill —
`scripts/ci/imagens-pinadas.ts`, run in the `lint` job, which fails on any
`image:`/`imageName:`/`FROM` that is not a digest, on any digest with no
inline tag (the old comment-only shape included), on a tag comment that
disagrees with the inline tag, on a comment at the end of a `FROM`, and on
the same inline tag carrying two different digests in two files. It is a **sibling** of `actions-pinadas.ts`, not an
extension of it: `uses:` lives in workflow YAML with one syntax, images
live in composes, kustomize manifests and Dockerfiles with three others,
and one function answering both questions would answer both badly.

What the check deliberately does **not** cover:

- **The images we build ourselves** (`brabo-api`, `brabo-engine`,
  `brabo-web`, `brabo-backup` and `brabo-broker` — the last one
  published since [ADR 0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)). There is no third party who could move anything, and
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
`github-actions` ecosystem for that reason. The maintainer decided on
2026-09-27 to enable the `docker` and `docker-compose` ecosystems too, and
the inline tag of ADR 0178 is the half of that decision that is in place;
the other half is **not enabled yet** and ADR 0178 says why: the decided
step that would align the workflows' `services:` on the bot's PR cannot push
with the `GITHUB_TOKEN`, which is never allowed to change `.github/workflows/`.
Until that is decided, bumping a digest is the
[runbook procedure](../runbook.md#subindo-imagem-de-terceiro).

**A digest guarantees immutability, not availability.** The pin protects
against the owner of a tag moving it; it does not protect against the
publisher deleting the repository. That happened with MinIO: the local
overlay's S3 server was pinned by index digest on `quay.io/minio/minio`,
MinIO stopped publishing its community image, and the same digest started
answering 401 (Docker Hub: 404). The bootstrap died at `rollout status` and
no property proof ran until the server was replaced by SeaweedFS
([ADR 0169](../adr/0169-seaweedfs-no-lugar-do-minio-no-overlay-local.md)).
The symptom, if it happens again to any pinned image, is `ImagePullBackOff`
on a digest that has not changed — the fix is a new image from a publisher
that still serves one, never unpinning.

## The build cache cannot hide a stale package

The final stage (`runtime`) of every `Dockerfile.prod` runs `apk upgrade`.
BuildKit keys a layer by instruction plus parent layer, never by time, so with
`cache-from` on, a PR build reused an `apk upgrade` layer frozen at that PR's
first build (measured: `CACHED` on 5 of 5 images), and Trivy scanned an old
openssl that the tag, built cold, would not carry. `docker-bake.hcl` therefore
sets `no-cache-filter = ["runtime"]` on the shared base target: the final stage
and what follows it are rebuilt every time, the build stages keep their cache
(that is where the time is), and the scan looks at what the tag would publish.
It is not a Trivy allowlist. The cost is about 7–9 s per image, in parallel.

That fixed what the **PR** scans. It could not fix what the **tag** publishes:
a tag builds cold, from a different run, and until
[ADR 0172](../adr/0172-trivy-no-release-antes-de-assinar.md) nothing scanned it.

## The release scans what it publishes, before signing it

`release.yml` runs Trivy on each image **by digest**, straight from the
registry (`--image-src remote`), after the bake pushes and records
`.release/images.json` and **before** `cosign sign`. The order is the
mechanism: an image that fails is never signed, and `install.sh` does not
install an unsigned image. The push has already happened by then (it is what
creates the digest), so a failed tag leaves its tags in the GHCR unsigned and
without a Release — the correct state, since nothing installs them.

The gate is the **same** rule as the `ci.yml` job, flag for flag:
`--scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1` and
the same `.trivyignore.yaml`, whose every entry carries an `expired_at`. A HIGH
or CRITICAL **with a fix available** fails the release. What has **no** fix is
reported, not blocking: a second scan without `--ignore-unfixed` and with
`--exit-code 0` feeds `scripts/ci/trivy-do-release.ts`, which writes the job
summary and the `trivy-sem-correcao.md` Release asset. That script never
decides the verdict — Trivy's exit code does —, because a second rule for
"has a fix" would drift from Trivy's own the first time it added a status.
There is **no new allowlist**: the step accepts no ignore file but the one the
PR already uses.

The binary is the same `v0.70.0` with the same `sha256` as `ci.yml`, declared
twice because a workflow's `env:` cannot be imported. The duplication is
guarded: `scripts/ci/trivy-do-release.spec.ts` fails when version, hash or the
gate's flags diverge between the two workflows, when the gate moves after the
signing, or when a second ignore file appears. Like `install-e2e.yml`, the
release only runs on a final tag, so that spec is the proof a PR can give.

Measured on 2026-09-27 against the digests of the last release (`v6.1.0`,
four images, published 2026-09-14), with the same flags: `api` and `web` would
**fail** — `CVE-2026-45447` (HIGH, `libcrypto3`/`libssl3` `3.3.7-r0`, fixed in
`3.3.7-r1`), a CVE published after that tag —, `engine` and `backup` pass, and
nothing HIGH/CRITICAL without a fix appears once `.trivyignore.yaml` is
applied. Without it, `engine` would carry 56 fixable findings in the
third-party scanner binaries that file documents. The four scans plus the
database download took about 30 s.

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

  Every Dependabot PR enters through `dev` (`target-branch: dev` on the
  three entries). Security updates ignore that key and open against the
  default branch, so `dependabot-para-dev.yml` closes the ones `dev`
  already fixes and retargets the rest — see *Dependabot enters through
  dev* in `branching-policy.md`.
- **npm/pnpm dependencies aren't attested.** The lockfile pins versions
  and integrity hashes, which is real, but there's no provenance check
  (`npm audit signatures` or equivalent) in any job.
- ~~**No signing or attestation of our own artifacts.**~~ **Closed by
  [ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md)**
  (BRB-005). `release.yml` signs the images it publishes **by digest** with
  `cosign` keyless — the OIDC identity of the workflow, no key in
  custody anywhere — and `build-runner-binaries.yml` gained a
  consolidating job that publishes **one signed `checksums.txt`**
  covering the runner binaries (four targets since
  [ADR 0174](../adr/0174-runner-sem-binario-darwin-x64.md), which dropped
  `darwin-x64`), rather than one signature per binary.
  Both workflows **verify what they just signed**, in the same run:
  a signature nobody tries to verify is one more file in the release,
  and the failure would otherwise surface on the machine of whoever
  installs — the worst place to find it.

  Since [ADR 0160](../adr/0160-o-compose-do-instalador-viaja-assinado.md)
  that manifest covers more than binaries: `install.sh` and the four files it
  needs to bring an installation up — the install compose and the three files
  it uses by relative path, published as `brabo-install-*` assets from the
  tag's checkout — are lines in the **same** `checksums.txt`, and the job runs
  `sha256sum -c --strict` on it before attaching anything. The installer
  checks each of the four against that manifest before it asks or writes
  anything ([RN-570](../business-rules.md#rn-570)). Until then the compose
  was the one thing the installer used that nothing verified — nor even
  downloaded. The list lives in `scripts/ci/assets-do-instalador.ts`, and its
  spec fails when the installer's own copy of it diverges or when the compose
  gains a relative bind-mount that is not on it.

  **The broker image is the fifth, and it is the one that matters most**
  ([ADR 0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)).
  It was built by nobody until then: the `Dockerfile.prod` existed and passed
  `hadolint`, but no bake target built it, so it was never scanned and never
  published, and the installation had no way to offer the service. It now
  goes through every gate the other four do — the `ci.yml` builds it on every
  PR, refuses it running as root, runs Trivy on it and brings it up healthy
  with a read-only rootfs and no network; `release.yml` publishes, records,
  signs and verifies it by digest with no extra line, because both loops read
  `.release/images.json`. The reason it needs them more than any other: in an
  installation that consents, it is the one service that receives the host's
  Docker socket, so a vulnerability in it is a path to the whole machine.
  Publishing it makes it a studiable public target; that price is declared
  in the ADR, not hidden. The Kubernetes overlay does not know it
  (`argumentosDeSetImage` emits only the four images the kustomize base
  declares) — there is no broker Deployment, by decision.

  What this does **not** cover, and is a different item: **code-signing
  the runner binaries** for the OS (macOS notarization, Windows
  Authenticode), which needs a paid signing identity and stays in
  [the backlog](backlog.md).
- ~~**Third-party images are tag-pinned, not digest-pinned.**~~ **Closed**
  (above): all 39 third-party references — composes, kustomize manifests,
  Dockerfile `FROM` lines and the workflow `services:` — are pinned by
  digest with the tag inside the reference (ADR 0178), and
  `scripts/ci/imagens-pinadas.ts` fails the `lint` job on the next
  regression. What is **not** closed, and is the price of the pin rather
  than a leftover: a digest receives no security update until someone bumps
  it by hand. Dependabot's `docker`/`docker-compose` ecosystems are decided
  but not enabled — see ADR 0178 for what blocks them.
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
