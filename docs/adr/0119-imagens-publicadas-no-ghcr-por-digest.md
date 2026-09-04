# ADR 0119 — Images published to GHCR on every final tag, and the production overlay pinned by digest

- **Status:** accepted
- **Date:** 2026-08-29
- **References (without editing):** [ADR 0025](0025-fase5-deploy-kubernetes-kustomize.md) and
  [ADR 0027](0027-fase5-backup-hardening-release.md) (both recorded
  "publishing the image to a registry" as out of scope — this ADR is what
  closes it), [ADR 0030](0030-politica-de-branches-mecanizada.md) (the push
  exceptions this decision deliberately does not extend),
  [ADR 0036](0036-telas-de-auth-fieis-ao-design-e-fontes-auto-hospedadas.md) (the version baked into the
  artifact, which is why `VERSION` stays separate from `TAG`).

## Context

`release.yml` built the four production images on every final tag with
`load: true` and `push: false`, and said so in a comment: the build existed
to prove the tag was **buildable**, and publishing would "come in when the
registry is decided". Meanwhile the production overlay pointed at
`ghcr.io/OWNER/brabo-*` with `newTag: REPLACE_WITH_DIGEST` — an owner
placeholder and a marker no step ever substituted.

The consequence was not cosmetic. As long as it held, **"production deploy
executable end to end" was false**, and everything behind it stayed behind
it: a real rollout, a restore rehearsed against production images, and the
runner binary's code-signing story (which needs a published artifact to
sign). An external review of the repository ranked it the most expensive
declared debt, and this ADR is that item.

A second defect surfaced while doing it: the overlay's `images:` block
listed **three** images, not four. `brabo-backup` was never remapped, so the
backup CronJob inherited `brabo-backup:prod` from the base — a name that
resolves in no registry. The environment that most needs its backup would
have been the one whose backup pod never started. The CI never caught it
because the overlay check validates that the overlay **builds**, and a
locally-named image builds fine.

## Decision

**1. `release.yml` publishes the four images to GHCR on every final tag.**
Login uses the job's own `GITHUB_TOKEN` with `packages: write` — no new
secret to rotate, and the scope dies with the job. Packages are **public**:
the code is already public in the same repository, secrets are never baked
into an image (the four sibling keys refuse to boot with an example value,
RN-114), and public packages keep the production overlay pull-and-go, with
no `imagePullSecret` to create, reference and rotate in every namespace.

**2. The registry prefix is a bake variable, not a second bakefile.**
`REGISTRY` defaults to `""`, so `ci.yml` keeps building the short local
names (`brabo-api:prod`) it scans and smoke-tests; `release.yml` sets
`ghcr.io/<owner>/`. The trailing slash lives **in the value** — an empty
prefix has to produce exactly the old name, and any fixed separator in the
interpolation would have broken `ci.yml`. `OUTPUT` follows the same shape:
`type=docker` (load locally) by default, `type=registry` (push) for the
release. `type=registry` is not an optimization — it is the only mode in
which bake returns `containerimage.digest`, because **the digest is born
from the push**.

**3. What each tag published is recorded by DIGEST in
`.release/images.json`.** Tags (`3.2.0`, the commit sha) are still
published: they are for human conversation and manual `docker pull`. They
are never what a manifest references — a mutable tag pointing at different
content over time destroys deterministic rollback and lets two pods of the
same ReplicaSet run different binaries, which is what the overlay's own
comment had said since Phase 5.

**4. The file is an asset of the GitHub Release, and rides the CHANGELOG PR
into the repository.** It does **not** get a third push exception. The
branch policy has exactly two (tags by the release bot, `.release/gate.json`
by the gate bot), and a mechanism that needs a new exception every time it
grows is a mechanism that stops being a policy. The release asset is the
authoritative copy, available the instant the tag exists; the versioned copy
arrives through the PR `release.yml` already opens against `dev`.

**5. The overlay keeps the marker; `make imagens-do-release` applies the
digest.** The repository does not declare which release is in production —
whoever deploys decides that, when they deploy. What the repository holds is
the record of what each tag published and the tool that applies it. The tool
is `kustomize edit set image`, not `sed`: kustomize knows that
`name=repo@sha256:…` means `newName` + `digest` and that `newTag` must go
away, while a `sed` would get the text right and the schema wrong.

**6. `brabo-backup` joins the overlays' `images:` block**, in both prod and
staging.

## Consequences

- The production overlay names a real owner (`ghcr.io/daneiel/*`) instead of
  a placeholder, and its four images resolve to something that exists.
- **Applying digests rewrites the overlay file wholesale.** `kustomize edit`
  round-trips the YAML: it reorders keys and detaches comments. That is
  acceptable for a deploy-time operation and is why the result is explicitly
  **not** meant to be committed — recorded in the file's own comment and in
  the runbook, so the next person doesn't discover it in a diff.
- A release now fails if any of the four targets comes back without a
  digest. That is deliberate: three new images and one stale one in
  production is worse than no release, and nothing in a partial file would
  say an image was missing. Same discipline as batch `embed` (ADR 0075) —
  a partial answer is undetectable afterwards.
- **Still not done, and not claimed:** nothing deploys automatically. There
  is no environment to deploy to, `DEPLOY_ENABLED` still does not exist, and
  the `platform` gate stays `planned` (ADR 0091/0092). This ADR makes the
  production overlay *executable*; it does not execute it.
- **Not done either: signing or attesting the images.** No cosign signature,
  no SLSA provenance. It belongs with the runner binaries' code-signing item
  (ADR 0112), which is blocked on the same operator action — obtaining a
  signing identity.
- The first real execution of this path is the **next final tag**. Like
  `build-runner-binaries.yml` (ADR 0112), the workflow is tag-triggered, so
  it cannot be proven by a PR. The pure logic (`images-manifest.ts`,
  `aplicar-imagens.ts`) is covered by tests; the bake rendering was verified
  with `docker buildx bake --print` in both modes; the `kustomize edit` path
  was executed for real against the prod overlay with a synthetic manifest.
  What no test gives is GHCR accepting the push, and that waits for the tag.

## Alternatives considered

**The release bot rewriting `kustomization.yaml` and pushing.** Rejected
twice over: it would open a third push exception in a policy that has two,
and it would let a tag decide by itself what is in production.

**Private packages with an `imagePullSecret`.** Rejected: it adds a secret
to create, reference in every namespace and rotate, to hide an image built
from public code that carries no secret. The cost is real and continuous;
the benefit, here, is not.

**Pinning by the version tag instead of the digest.** Rejected for the
reason the overlay had already written down before this ADR existed, and
which the test now enforces: no argument emitted by `argumentosDeSetImage`
may carry a `:tag`.
