---
traducao_de: 7b4435d8e9a6289bb11b8029fe64df5e4264ebf8
---

# 0169 — The local overlay's S3 destination stops being MinIO and becomes SeaweedFS

## Status

**Accepted.** Decided on 2026-09-27 (AT-200, issue #633), by measurement, under
the maintainer's delegation ("you measure and choose"). It references
[ADR 0027](0027-fase5-backup-hardening-release.md) (the S3 backup and the swap of
`mc` for `aws-cli`) and [ADR 0159](0159-imagem-de-terceiro-por-digest.md)
(third-party image by index digest). It edits neither.

## Context

The Kubernetes local overlay brings up an S3 server inside the `brabo` namespace
so that the backup exercised locally is the SAME as production's: the script
always talks S3 and only the endpoint changes. That server was MinIO, pinned
since ADR 0159 at
`quay.io/minio/minio@sha256:a1ea29fa…  # RELEASE.2025-04-22T22-12-26Z`.

MinIO stopped publishing the community image. Measured on 2026-09-27, without
authentication:

| reference | response |
|---|---|
| `quay.io/v2/minio/minio/manifests/sha256:a1ea29fa…` | **401** |
| `quay.io/v2/minio/minio/tags/list` | **401** |
| `registry-1.docker.io/v2/minio/minio/manifests/RELEASE.2025-04-22T22-12-26Z` | **401** `UNAUTHORIZED` (repository nonexistent for anonymous) |
| `hub.docker.com/v2/repositories/minio/minio/tags` | **404** `object not found` |

The consequence was total, not partial: `deploy/k8s/bootstrap.sh` waits for
`rollout status deployment/minio` BEFORE seeding and creating the bucket, so
`propriedades.yml` died in the bootstrap and **none** of the property proofs ran
— not even those that do not touch backup (`rollout-test`, `hpa-test`,
`test-reprojecao-k8s`).

The digest fulfilled what ADR 0159 promised — nobody swapped the bytes
underneath — and that was not enough: **a digest guarantees immutability, not
availability.** A pin survives the tag's owner moving the tag; it does not
survive the registry's owner deleting the repository.

### What depends on that S3 (mapped)

- **Server:** `deploy/k8s/overlays/local/minio/{minio,netpol}.yaml`, listed in
  the local overlay's `kustomization.yaml`. Only the local overlay; staging and
  prod point to an external bucket.
- **Client:** it is NOT a MinIO image. `mc` left in Phase 5 (ADR 0027, decision
  1b); backup, restore and bucket creation use the apk `aws-cli` inside
  `brabo-backup` (`docker/backup/Dockerfile.prod`), through the adapter
  `docker/backup/lib.sh`. The S3 operations it does are seven: `s3 ls`,
  `s3 cp -` (stdin, multipart), `s3 cp` (download), `s3api head-object`,
  `s3 cp` bucket→bucket (server-side copy), `s3api list-objects-v2` and
  `s3 rm` — plus the bootstrap's `s3 mb`.
- **Credentials:** `BACKUP_S3_ACCESS_KEY`/`BACKUP_S3_SECRET_KEY` of the `brabo`
  Secret, materialized by ESO into `brabo-secrets`. The server reads the SAME
  pair.
- **Bootstrap:** the `BACKUP_S3_ENDPOINT`, the `rollout status`, the wait for the
  `Endpoints` and the ephemeral pod that creates the bucket.
- **Network:** two NetworkPolicies in the overlay (ingress into the server,
  egress of backup/restore), matching the POD's port.
- `make test-restore` (`deploy/k8s/test-restore.sh`) and the backup CronJob only
  see the endpoint. The compose (`docker/backup/test-restore-compose.sh`) uses
  disk, not S3, and is not affected.

## Decision

**The server becomes SeaweedFS, `docker.io/chrislusf/seaweedfs` 4.47, pinned by
the INDEX digest
(`sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882`),
running `server -s3 -s3.port=9000`.** The resources are now called `s3-local`
(Deployment, Service, PVC `s3-local-data`, label `app.kubernetes.io/name`) and the
folder, `overlays/local/s3/`.

### The candidates, by the criteria in the order the maintainer gave

| candidate | 1. official, anonymous, amd64+arm64 index | 2. real backup flow | 3. smallest change | 4. license | outcome |
|---|---|---|---|---|---|
| **SeaweedFS 4.47** (`chrislusf/seaweedfs`) | **yes** — the author's Docker Hub (the README of `seaweedfs/seaweedfs` points to it; OCI labels with `source`/`revision`), anonymous 200, OCI index with `amd64`, `arm64`, `arm/v7`, `386`; the tags have a published cosign signature (`.sig`) | **yes**, measured (below) | the server changes; client, script, Secret and port stay | Apache-2.0 | **chosen** |
| Garage v2.1.0 (`dxflrs/garage`) | yes — anonymous 200, index with `amd64`, `arm64`, `arm`, `386` | not measured | requires a configuration file (ConfigMap with `rpc_secret`) and, AFTER boot, `garage layout assign` + `layout apply` and `garage key import <key-id> <secret>` — a new administration step in the bootstrap. Garage documents its own key-id format (`GK…`), which would force changing `BACKUP_S3_ACCESS_KEY=brabo-backup` (not measured here) | AGPL-3.0 (no problem for unmodified use in a test overlay, but heavier than the first) | discarded at criterion 3 |
| MinIO from another source: `bitnami/minio` | **no** — anonymous 404 (Bitnami also ended its free catalog) | — | — | — | discarded at criterion 1 |
| MinIO from another source: `bitnamilegacy/minio` | **no** as a live publication — FROZEN repository, last update 2025-08-19; it is a mirror without patches and without an active publisher | — | — | — | discarded at criterion 1 |
| MinIO from another source: `cgr.dev/chainguard/minio` | partial — amd64+arm64 index, anonymous, but only `:latest` is free: there is no stable tag for the pin's comment, and the publisher is whoever recompiles the source, not MinIO | — | — | AGPL-3.0 | discarded at criterion 1 (no fixed tag; unofficial publisher) |
| original MinIO (`quay.io`/`docker.io`) | **no** — 401/404 (Context) | — | — | — | it is the problem |

"Keep the first one that meets everything": SeaweedFS met all four, so Garage was
not taken to the real flow — the measurement stopped where the rule says to stop,
and the column says so instead of filling it.

### The measurement of criterion 2

The `brabo-backup` built from this checkout (`aws-cli/2.15.57`, Alpine 3.20) ran
the **real** adapter (`docker/backup/lib.sh`, `destino_preparar` and the
`destino_*` functions) against `weed server -s3` in a container as uid 1000, with
the credential pair in the environment and `/data` limited to 4 GiB (the PVC's
size):

- wrong secret → `aws s3 ls` **refused** (authentication holds);
- the bootstrap's `s3 mb` → created the bucket;
- `destino_enviar` of 30 MiB through stdin (multipart) → `head-object` returned
  31457280, the download matched the sha256;
- `destino_tamanho` of a nonexistent object → `0`;
- `destino_copiar` (server-side copy), `destino_listar` (3 keys, empty prefix
  without output) and `destino_remover` → correct;
- `/healthz` on the S3 port → 200 in ~1 s, without authentication (it is what
  the probes use); memory ~470 MiB after the upload, within the 1 GiB limit.

And in the cluster, twice:

- **CI**, `propriedades.yml` by `workflow_dispatch` on the branch, run
  `36362479629`: bootstrap, `smoke-k8s`, `hpa-test`, `rollout-test`,
  `test-restore`, `test-restore-mutacao` and `test-reprojecao-k8s` — all
  `success`, with no proof altered.
- **Local**, k3d on this machine: `deploy/k8s/bootstrap.sh` exited with 0 (the
  `rollout status deployment/s3-local` and the bucket creation passed), and
  `make test-restore` uploaded the 183 KB dump to
  `s3-local…/brabo-backups/daily/…`, downloaded it and restored 55 identical
  tables (exit 0); `make test-restore-mutacao` failed the break naming
  `zz_mutacao_restore` (exit 0). A detail UNRELATED to S3, recorded so it is not
  confused with it: in the first local run the seed lost the session's
  activation in a race with the engine (`ECONNREFUSED …:4000`), the dump came out
  without any `session_event` and the proof failed because of it, as it should;
  with three events written through the internal route the proof's own message
  indicates, it passed. In CI the seed activated the session on the first try.

### Why `server -s3` and not `mini`

The image is born with `mini`, which adds WebDAV, an Admin UI and an Iceberg
catalog. `server -s3` brings up master, volume, filer and S3 gateway — the
minimum that answers S3. The rest would be surface and memory without a consumer.

### Why port 9000

The NetworkPolicy matches the POD's port, not the Service's. With
`-s3.port=9000` the gateway listens where MinIO listened, and the two policies
and the `BACKUP_S3_ENDPOINT` only change NAME. Master (9333), volume (8080) and
filer (8888) listen inside the pod and remain denied by the baseline.

### Why the name is neutral

Calling a Service that runs SeaweedFS `minio` would save three bootstrap lines
and would teach wrongly whoever opened the cluster. What the backup consumes is
the PROTOCOL; naming it after the product behind it is what would make the next
swap repeat this one.

## Consequences

- The bootstrap gets past S3 again, and the property proofs run again (run
  `36362479629`, all six green).
- **The client did not change.** No line of `docker/backup/` was touched, and
  what the proofs measure (`test-restore`, `test-restore-mutacao`) is the same.
- **Declared price: `readOnlyRootFilesystem` remains false**, as it was with
  MinIO — `weed` writes the filer's socket to `/tmp`. A local test component,
  with no equivalent in production.
- **Declared price: SeaweedFS is not MinIO.** S3 compatibility is a per-operation
  contract, not a seal. The eight the product uses were measured; a NEW operation
  in `lib.sh` (lifecycle, versioning, object lock) needs to be measured against it
  before it enters, because it is here that it would be exercised first.
  Production keeps talking to the real bucket, which does not change.
- **The pin by digest does not protect against the publisher disappearing** — not
  even this one. The signal, if it happens again, is the same: the bootstrap dies
  at the S3 `rollout status` with `ImagePullBackOff`. The lesson went to
  [`cadeia-de-suprimentos-do-ci.md`](../explanation/cadeia-de-suprimentos-do-ci.md).
- The count of third-party images pinned by digest does not change (one leaves,
  one enters): 39.
- No RN is born: it is local validation infrastructure, with no business rule.
