---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0149 — Signature of published artifacts

## Status

**Proposed.** First ADR of
[PHASE 29](../explanation/fase-29-instalacao-de-uma-linha.md). Nothing here
changes what the images contain nor what the runner does — it changes what is
published **next to** them and what becomes verifiable.

## Context

The product **signs nothing it publishes**. Searching for `cosign`,
`sigstore`, `slsa` and `attestation` in `.github/`, `scripts/`, `docker/` and
`Makefile` returns a single real occurrence, and it covers neither image nor
binary: `npm publish --provenance` of the runner's npm package
(`.github/workflows/publish-runner.yml:188`, with the `id-token: write` it
requires at `:27`).

What is left without provenance:

- **The four GHCR images.** `release.yml` builds and publishes with
  `docker/bake-action` (`.github/workflows/release.yml:286-303`), records the
  digests in `.release/images.json` (`:308-319`, via
  `scripts/ci/images-manifest.ts`) and attaches that manifest to the Release
  (`:321-332`). The workflow declares three permissions — `contents: write`,
  `pull-requests: write`, `packages: write` (`:40-43`) — and **does not have
  `id-token: write`**, which is what a keyless signature requires.
- **The runner's five binaries.** `build-runner-binaries.yml` builds the matrix
  (`:58-74`), builds and uploads each file with `gh release upload` (`:227`) —
  **and nothing more**. There is no `checksums.txt`, `.sig`, `.asc` nor a
  `sha256` of our own artifact in any workflow. The `sha256sum -c` that exist
  (`ci.yml:201,453,458,462`, `docker/engine/Dockerfile.prod:95,100,104`) verify
  **third-party** binaries, and they are precisely the pattern the repository
  already knows how to apply and never applied to itself.
- **The download path the product offers.** `GET /runner-releases/binary` is
  `@Public()`
  (`apps/api/src/interfaces/http/runner/runner-releases.controller.ts:73-74`),
  validates the **input** (`platform` against a closed allowlist, `:97`) and
  streams GitHub's bytes straight to the client (`:111-133`). There is no
  checksum, signature or any integrity check.
  [ADR 0146](0146-base-consentida-no-bootstrap.md):208-212 already names this as
  BRB-005 — *"not a pattern to imitate"*.

This is **BRB-005**, and it is what blocked the one-line installer in PHASE 28:
*"a one-line installer without a signature is worse than the current download"*
(`../explanation/fase-28-pasta-do-usuario.md:171-173`). The order of PHASE 29
comes from there — without this ADR, [ADR 0150](0150-instalador-de-uma-linha.md)
would be exactly the thing the previous phase refused.

## Decision

### 1. Keyless `cosign`, with the workflow's identity

`release.yml` gains `id-token: write` and signs the **four images by digest** —
the digest it already computed and already recorded in `.release/images.json`,
never by tag, which is a moving pointer. The identity that signs is the workflow
itself (GitHub Actions OIDC), and it is that identity the verification demands:
the workflow's `--certificate-identity` and GitHub's
`--certificate-oidc-issuer`.

Keyless and not a hand-managed key pair for the reason the repository already
applies to the supply chain: a private key would require custody, rotation and
**one more CI secret** — and the repository's recent history includes a PAT
that expired and failed two `tag-release` runs without anyone noticing until the
automatic issue existed
([ADR 0139](0139-o-alarme-de-esteira-ganha-destinatario.md)). An ephemeral
credential derived from the execution does not expire in the closet.

### 2. One signed `checksums.txt`, not five signatures

`build-runner-binaries.yml` now publishes a `checksums.txt` with the SHA-256 of
the five binaries, and **signs that file**. Signing each binary would produce
five signature artifacts to verify and five ways for the verification to end up
half done; a signed manifest covers the set with a single verification, and it
is the format any consumer knows how to read.

`checksums.txt` is born in the same job that already waits for the Release to
exist (`build-runner-binaries.yml:213-221`, the loop with a 600s ceiling), and
the matrix remains `fail-fast: false`: a target that did not build does **not**
prevent the others from publishing, but the manifest declares which targets it
covers — a checksums that lists four binaries and is silent about the fifth would
be worse than none.

### 3. Who verifies, and what happens when it fails

| consumer | verifies | when it fails |
|---|---|---|
| `install.sh` (ADR 0150) | the image signature by digest; the signed `checksums.txt` before using the binary | **named refusal** — says which artifact, which check, and stops |
| `GET /runner-releases/binary` | **only** the binary's SHA-256 against the `checksums.txt` of the same Release — **not** its signature (see below) | 502 with `motivo`; never serves unverified bytes |
| local build (ADR 0150) | the git tag and a clean tree | refuses before building |

**A verification failure is a refusal, never a warning.** A warning that can be
accepted by clicking is a verification that does not exist — and the product
already applies that rule elsewhere, when `consentir-base.mjs:246-258` refuses
to write and exits with 1 if sharing was not proven. Absence of what would be
verified is also a refusal: a Release without `checksums.txt` makes the proxy
**refuse**, and not serve while declaring it could not check — otherwise
deleting 400 bytes from the Release would turn off verification for everyone.

#### The api proxy verifies INTEGRITY, not provenance — and that is a decision, not an omission

The second row of the table was born written as if the two halves were one. In
session 3 they were separated, after measuring the two ways the api could verify
a signature:

| path | measured | why not |
|---|---|---|
| `cosign` inside the api image | **155 MB** (`cosign-linux-amd64` v2.6.1) | it almost doubles a runtime image that is Alpine + Node, published by digest on GHCR ([ADR 0119](0119-imagens-publicadas-no-ghcr-por-digest.md)), to verify an optional download |
| `@sigstore/verify` + `@sigstore/tuf` | **2.5 MB, 12 packages**, no advisory | size is not the cost. `getTrustedRoot()` refreshes TUF metadata against `tuf-repo-cdn.sigstore.dev` (the package's `seeds.json` only seeds the `root.json`), so a `@Public()` route that today depends on ONE third-party host would come to depend on two — and it is the entry point of the onboarding of [ADR 0118](0118-configuracao-automatica-do-runner-pelo-navegador.md). Worse: by the rule of ADRs [0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)/[0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md) — a capability is only declared when **proven** — there is no way to prove the path today, because **no Release has a `checksums.txt.bundle`**: the `checksums` job only runs on a final tag, and the gap is already declared in RN-524 on the signing side. Shipping a verification that cannot be proven in front of onboarding would trade a known weakness for a 502 on every platform, in every installation, discovered only in production |

So the proxy checks the hash and **says it is only the hash** — in the docblock,
in the OpenAPI description, in the refusal message and in
[RN-525](../business-rules.md#rn-525). Whoever verifies the signature is
`install.sh`, which has real `cosign` through the path of decision 4. The
consequence is recorded and not hidden: **BRB-005 closes for producing the
signature and remains open for the provenance half of this route** — reopening
it is the decision of a later session, with a real signed Release to prove
against.

### 4. The `cosign` that verifies also needs provenance

Verifying requires the `cosign` binary on the installer's machine, and
downloading it without verification would recreate the problem one level up.
`install.sh` solves this through the path CI already uses for every third-party
binary: it downloads the **pinned** version and checks it with `sha256sum -c`
against a hash **written in the versioned script itself** (`ci.yml:201` is the
precedent). Whoever trusts `install.sh` enough to execute it trusts the hash it
carries; the chain does not get more fragile than the link that starts it.

## What this ADR explicitly rejects

- **A hand-managed key** (own pair, KMS, GPG): custody and rotation of a CI
  secret, for a gain of nothing keyless does not give here.
- **"Sign now, verify later."** A signature without a consumer is one more file
  in the Release. The three consumers in the table above enter in this phase,
  and the `install.sh` one is what gives it meaning.
- **Signing the image by tag.** A tag is a moving pointer; the digest is what
  `.release/images.json` already records and what the overlay already applies.
- **SBOM attestation and full SLSA provenance.** Declared out of scope: they are
  another axis, with another consumer, and none of them removes BRB-005.

## Consequences

- **BRB-005 closes** for images and binaries — and only for them. The register
  ([BRB register](../reference/brb.md)) receives the evidence when session 2
  merges.
- **And it does not close for the provenance half of the api proxy.** By
  decision 3, `GET /runner-releases/binary` checks integrity against the
  manifest and refuses what it cannot check, but does not verify the manifest's
  signature — both ways of doing it were measured and rejected (155 MB of
  `cosign` in the image; a second third-party host on a public route, verifying
  what does not yet exist to be proven). The BRB register says so instead of
  announcing the item closed.
- **The broker remains unsigned because it remains unpublished.**
  `docker-bake.hcl:81-83` has four targets and
  `scripts/ci/images-manifest.ts:54` accepts four; `brabo-broker:prod` only
  exists built locally. The consequence belongs to ADR 0150 and is declared
  there: in a GHCR installation, the `container-broker` profile is unreachable —
  and the `mounted` mode brings up a container **through the broker**
  ([ADR 0144](0144-a-segunda-raiz-do-broker.md)).
- **`release.yml` gains one more permission.** `id-token: write` is scoped to
  the workflow and does not widen what it could already do with
  `packages: write`.
- Whoever installs without network access to Sigstore cannot verify — and, by
  decision 3, does not install. It is the accepted cost of verification not
  being optional.
