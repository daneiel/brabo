# 0027 — Backup/restore, api hardening, exposed surface and release

## Context

Phase 5 sessions 1–3 (ADRs [0024](0024-fase5-imagens-producao-ci.md),
[0025](0025-fase5-deploy-kubernetes-kustomize.md) and
[0026](0026-fase5-observabilidade-e-graceful-shutdown.md)) delivered
production images, CI, Kubernetes deploy and observability. What remained
were scope items **6** (backup and restore with a tested runbook) and **7**
(api hardening).

This session closes both and adds what was still missing to call the system
"production ready": operational runbooks, a review of the exposed surface,
and versioning.

## Decisions

### 1. Backup retention by COUNT, not by age

Deleting by age (`--older-than 7d`, or a lifecycle rule on the bucket)
deletes a good backup when the CronJob goes days without running — exactly
the situation where it matters most. Keeping the N most recent degrades
gracefully: with no new run, nothing gets deleted. `BACKUP_KEEP_DAILY=7`
and `BACKUP_KEEP_WEEKLY=4`.

### 1b. Backup image: Alpine + apk's `aws-cli`, not `postgres:16-alpine` + `mc`

The first version used `postgres:16-alpine` with `mc` (the MinIO client),
justified as a single static binary with no Python runtime to drag along.
CI's trivy rejected it with **48 fixable HIGH/CRITICAL findings**, none of
them fixable by us:

- 33 from the `mc` binary: static Go, with CVEs from the embedded stdlib.
  The last mc release is from September/2025 — the project stalled, and
  with no new release there's no patch;
- 15 from `gosu`, which the `postgres` image carries to switch users in the
  entrypoint — a feature this image doesn't even use, since it runs
  directly as non-root.

Both cases fit `.trivyignore.yaml`, but that file's convention requires
`expired_at` precisely so the debt resurfaces and gets paid. Here it
**could never be paid**: the result would be a permanently red gate on an
image that carries the credential to read the entire database.

We swapped in `alpine` + `postgresql16-client` + `aws-cli` + `jq`, all from
apk and therefore updated by `apk upgrade` on every rebuild.
**Measured: 48 → 0.** The Python runtime that was the argument against
aws-cli costs a few MB; the scan showed the real cost was on the other
side.

The base tag stays pinned to Postgres's MAJOR version
(`postgresql16-client` exists on Alpine 3.20): bumping one without the
other reintroduces the "server version mismatch" from decision 4.

### 2. Backup metric comes from a TABLE, not a Pushgateway

The CronJob writes its result to `backup_runs`, and the
`DomainGaugesCollector` in the api — which already runs on a timer and is
already scraped — publishes
`brabo_backup_{last_success_timestamp_seconds,age_seconds,last_status,size_bytes}`.

A Pushgateway would be one more component, a second source of truth, and a
place where the metric **outlives the fact it describes** (the series keeps
being published after the job is gone). The table also gives a queryable
history, which is what the restore runbook uses to answer "when was the
last good backup".

Consequence: `-1` is used for "there has never been a backup", to
distinguish it from "backup from 1970" — without this the age alert would
fire on day one of any new environment.

### 3. Retry INSIDE the process, not by recreating the pod

k3s programs NetworkPolicy rules **after** the pod gets an IP. A Job that
speaks on its first instruction gets `connection refused` (REJECT, not a
timeout) from a rule that will exist a second later. Recreating the pod
recreates the window — six consecutive attempts failed identically before
that became clear.

Backup, restore and bucket creation in the bootstrap retry from inside the
same container. This also serves production: object storage has transient
unavailability, and a daily backup that gives up on the first network error
becomes a day with no backup.

### 4. PostgreSQL 16 pinned on CloudNativePG

The local cluster was coming up on the operator's default major (17.4)
while CLAUDE.md decides on PostgreSQL 16 and compose uses
`pgvector/pgvector:pg16`. The divergence was invisible until backup:
`pg_dump` 16 refuses a version 17 server with "server version mismatch",
and a dump generated in one environment doesn't restore in the other.

`imageName: ghcr.io/cloudnative-pg/postgresql:16.10`, with the minor
pinned too — letting it float would reintroduce the problem the day the
operator changes its default.

### 5. Rate limit with a sliding window in Postgres

CLAUDE.md forbids Redis (queues live in Postgres via Oban). The window
lives in `rate_limit_hits`, with the INSERT and the count in the same
statement via a CTE.

**Accepted cost: one INSERT per counted request.** Redis would do better;
`RATE_LIMIT_ENABLED=false` turns it off. Pruning runs on the timer the
collector already has, instead of its own CronJob.

A detail that only shows up at the edge: in Postgres, the row inserted by a
write CTE **isn't visible** to the rest of the same statement. Counting
only the table would return the hits before this one, and the limit would
be worth one more than configured. Hence the explicit sum
`(select count(*) from novo)`.

Exempt: `@Public()` routes (throttling `/health` makes the kubelet restart
the pod, turning a spike into an outage) and the `engine-service` client
(the engine calls the api on every agent event; limiting it would be the
system throttling itself).

A database failure **releases** the request: this guard protects against
abuse, not against unauthorized access — that's what the `JwtAuthGuard`,
which already ran, is for.

### 6. CORS fails closed in production

`WEB_ORIGIN` now accepts a comma-separated list. Without it, or with `*`,
with `NODE_ENV=production` the **boot fails**. Before, the silent default
was `http://localhost:5173`: forgetting the variable on a deploy broke
nothing visible, it just left the api permissive. A noisy start-up error
is reversible; a permissive api is silent and isn't.

### 7. helmet on the api, CSP only on the web

The api wasn't emitting any security header at all. `helmet` comes in with
`contentSecurityPolicy: false`: it serves JSON, and CSP belongs to the web,
where it already existed since session 1 and is more specific
(`connect-src` built per environment). `crossOriginResourcePolicy: false`
because the web is a different origin — the `same-origin` default would
block the whole app, with a symptom easily mistaken for CORS.

### 8. `mix_audit` in addition to `mix hex.audit`

`mix hex.audit` reports **retired** packages, not vulnerabilities. Alone,
the engine's gate would be decorative: no CVE would ever fail the build.
`mix_audit` reads the Elixir advisory database and is what actually
detects CVEs. Both run; they answer different questions. The gate is set
at **critical**, as the scope asks — failing at `moderate` in a monorepo
this size would become a permanent block, and the reaction would be to
disable the gate entirely.

### 9. The surface document is the test's SOURCE

`docs/security-surface.md` lists the 110 routes with their classification.
`route-surface.spec.ts` boots `AppModule`, enumerates the routes
**registered at runtime** (via `DiscoveryService`, not grep) and compares
against the parsed table from the markdown: a route with no line fails, a
diverging classification fails, an orphan line fails.

On the engine the test is **behavioral**: every registered route receives
a request with no token, and what's asserted is what the client would see
(401 for everything outside the four-item exception list). The first
version read `pipe_through` and was discarded for two reasons — this
version of Phoenix's `__routes__/0` doesn't expose the pipeline, and even
if it did it would be asserting about the ANNOTATION: an `:internal`
pipeline emptied out by mistake would still be "correct".

### 10. Rotating the master key required changing the service

`EnvelopeEncryptionService` derived ONE key and no record tracks which key
wrapped what. Rotating the variable made every existing credential
unreadable, with no boot-time error — the failure would only show up on
first use. A runbook about this would be fiction.

Decision: `CREDENTIALS_MASTER_KEY_PREVIOUS`, tried when the current one
fails, plus `src/scripts/rewrap-deks.ts` re-wrapping the whole collection.
The script lives in `src/` (and not in `apps/api/scripts/`, which is in
`.dockerignore`) because it needs to be inside the production image. Only
the envelope changes; the secret's ciphertext stays byte-for-byte the
same, so interrupting midway leaves the collection consistent.

### 11. Release by tag, changelog by our own script

`.github/workflows/release.yml` triggers on `v*` and validates that the
four manifests declare the tag's version — tagging `v0.2.0` with the
`package.json` files still at `0.1.0` would produce images labeled with a
version the code doesn't declare.

`scripts/changelog.mjs` (~140 lines) instead of
`standard-version`/`changesets`: those bring opinions about bump, commit
and tag — three things that here are the user's decision. The script only
generates text.

## Consequences

**Accepted:**

- One INSERT per request on the authenticated path (decision 5).
- A fourth image to maintain (`brabo-backup`), under the same gates as the
  others: non-root, trivy and hadolint.
- MinIO in the local overlay — one more component in the development
  cluster, in exchange for the S3 path being exercised in every
  environment instead of only in production.
- Accepting two master keys during the rotation window doubles the
  exposure of a leaked key. The api warns in the log on every boot while
  that lasts.
- `ALTER ROLE brabo CREATEDB` on the **local** cluster for the restore
  test. This isn't done in production: restore uses its own administrative
  credential via `RESTORE_ADMIN_URL`.

**Out of scope, recorded:**

- **Publishing the image to a registry.** The production overlay still
  points at `ghcr.io/OWNER/*`. The release workflow builds and tags it,
  but doesn't publish it.
- **Creating the `v0.1.0` tag** — that's an act of the user, consistent
  with CLAUDE.md's rule about protected branches.
- **PITR.** The granularity is the last dump. WAL archiving on CloudNativePG
  would solve this and wasn't done.
- **Backing up Keycloak and the PVCs.** The scope asks for Postgres.
- **`GET /`**, the NestJS scaffold's "Hello World!", remains registered and
  authenticated. Documented as a candidate for removal; removing it is a
  product decision.
- **Alerts remain Grafana rules**, not Prometheus rules — a deviation
  already recorded in ADR 0026 and kept here because of the two new backup
  alerts.
