---
traducao_de: 209fd3641c5685b064dbe9c5625201180387c5f7
---

# 0172 — The release scans with Trivy what it publishes, by digest, before signing

## Status

**Accepted.** Decided by the maintainer on 2026-09-27 (AT-179): **scan and
fail**. It references [ADR 0119](0119-imagens-publicadas-no-ghcr-por-digest.md)
(the images published by digest),
[ADR 0149](0149-assinatura-dos-artefatos-publicados.md) (the keyless `cosign`
signature by digest) and
[ADR 0162](0162-broker-publicado-e-oferecido-pelo-instalador.md) (the fifth
image). It edits none of them.

## Context

Trivy only existed in the `images` job of `ci.yml`, which scans a LOCAL build of
the PR (`brabo-api:prod` in the runner's daemon). `release.yml` builds again,
pushes to GHCR, records the digests in `.release/images.json` and signs —
without any scan. The investigation of AT-110 measured why that is not the same
artifact: the `type=gha` cache a PR writes is not readable from a tag (of the
repository's 663 `buildkit` caches, all were in `refs/pull/N/merge`), so the tag
builds COLD, and the final stage's `apk upgrade` runs again and can bring another
set of packages. AT-110 closed the PR side (`no-cache-filter = ["runtime"]` in
the bake), but the image the installer downloads remained the only one nobody
scanned.

## Decision

1. **Where.** In the `release` job of `release.yml`, after
   `Registrar as imagens publicadas` and **before**
   `Instalar o cosign`/`Assinar as imagens publicadas`. The order is the
   mechanism: a failed image receives no signature, and without a signature
   `install.sh` does not install it.
2. **On what.** On the DIGEST of each image recorded in `.release/images.json`
   (`repositorio@sha256:…`), read from the registry (`--image-src remote`) —
   never by tag, for the same reason as the signature: the tag is a moving
   pointer and the digest is what was published. The list comes from
   `scripts/ci/trivy-do-release.ts referencias`, which fails an empty manifest or
   a malformed digest.
3. **The rule fails.** HIGH or CRITICAL **with a fix available** fails the job.
   The flags are those of `ci.yml`, byte for byte: `--scanners vuln --severity
   HIGH,CRITICAL --ignore-unfixed --ignorefile .trivyignore.yaml
   --skip-db-update --exit-code 1`. Whoever decides is Trivy's exit code, never a
   second rule in TypeScript — it would diverge from Trivy's at the first new
   `Status`. All images are scanned before failing, so the log names WHICH ones
   failed.
4. **What has no fix is reported.** A second scan per image, without
   `--ignore-unfixed` and with `--exit-code 0`, generates JSON;
   `scripts/ci/trivy-do-release.ts resumo` builds the markdown (the two numbers
   per image and the list of what has no fix), which goes to the job summary and
   is attached to the Release as `trivy-sem-correcao.md`. That step runs BEFORE
   the gate, so the summary also exists when the gate fails.
5. **No new allowlist.** The only exceptions file is the `.trivyignore.yaml`
   `ci.yml` already uses — curated, with the three conditions at the top and
   `expired_at` on every entry. Not using it would make the release apply a
   HARSHER rule than the PR's, over the same exceptions the maintainer already
   accepted: measured, the `engine` of `v6.1.0` would have 56 fixable findings,
   all in the third-party scanner binaries that file documents. The spec fails a
   second `--ignorefile`, `--skip-files`, `--skip-dirs`, `--vex`,
   `--ignore-policy` or `--ignore-status`.
6. **Same version, declared twice, guarded.** `TRIVY_VERSION` and
   `TRIVY_SHA256` enter the `env:` of `release.yml` with `ci.yml`'s value. A
   single place did not fit: a workflow's `env:` cannot be imported from another
   file, and a composite action for two variables would be a third place to
   maintain. The binary is downloaded with `curl` and goes through
   `sha256sum -c` before extracting, as in `ci.yml`. No new action (no `uses:`
   entered).
7. **The proof.** `release.yml` only runs on a final tag, so no PR executes it —
   the situation of `install-e2e.yml`. `scripts/ci/trivy-do-release.spec.ts`
   guards, on every PR: the gate after the registration and before cosign; no
   `continue-on-error`/`always()` on the path; the rule's flags equal to
   `ci.yml`'s; the report without `--ignore-unfixed` and with `--exit-code 0`;
   version and hash equal; `curl` → `sha256sum -c` → `tar`; the asset in the
   `gh release create`. Proven by mutation: removing `--ignore-unfixed` from the
   gate or moving `cosign-installer` before it turns the spec red.

## Consequences

- **Failing leaves a published image without a signature.** The push happens
  before the scan (it is what creates the digest), so a failed tag leaves
  `:X.Y.Z` and `:<sha>` on GHCR, without a signature, without a Release and
  without an attached `images.json`. It is the right state — the installer
  refuses an image without a signature —, but it is a public residue. Redoing it
  means fixing the base and cutting a new tag; republishing the same tag through
  `workflow_dispatch` rebuilds and rescans.
- **The next tag can be born red because of a CVE published after the PR.** The
  tag's scan uses the vulnerability database of the tag's day, not the PR's. That
  is the point: what reaches the installer is judged with what is known on the
  day it arrives. Measured on 2026-09-27 against the `v6.1.0` digests: `api` and
  `web` would fail today because of `CVE-2026-45447` (HIGH,
  `libcrypto3`/`libssl3` `3.3.7-r0` → `3.3.7-r1`), a CVE later than that tag;
  `engine` and `backup` pass; nothing HIGH/CRITICAL without a fix. A new tag
  builds cold and runs `apk upgrade`, so it should bring `3.3.7-r1` — which was
  not proven here, because it would require cutting a tag.
- **Time cost.** Measured locally over the four `v6.1.0` digests: 13 s to
  download the database and ~17 s for the eight scans (gate and report), over the
  network. On the runner the real number only exists at the first tag; the job
  keeps `timeout-minutes: 30`, against 4–11 min of the last three releases.
- **`.trivyignore.yaml` now also applies to what is published.** An entry that
  expires (`expired_at: 2026-10-31` in the current ones) fails the PR AND the next
  tag. The discipline of reviewing the list does not change; what changes is that
  forgetting it now blocks publication, not only the merge.
- **Declared duplication.** Version, hash and flags exist in two workflows. The
  spec fails the divergence; whoever upgrades Trivy upgrades it in both in the
  same PR.
