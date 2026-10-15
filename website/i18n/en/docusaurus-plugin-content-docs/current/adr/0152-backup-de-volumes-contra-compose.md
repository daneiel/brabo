---
traducao_de: 213fbcc7470e8f4bae01648d030a1e3437751cf6
---

# ADR 0152 — Volume backup and restore, against compose

## Status

**Proposed.** It exists because
[PHASE 29](../explanation/fase-29-instalacao-de-uma-linha.md) needs to migrate a
previous installation, and the path the documentation pointed to for that does
not work.

## Context

The current backup covers **one** database and runs in **one** place:

- `docker/backup/backup.sh` does `pg_dump --format=custom | aws s3 cp -`
  (`:124-140`), straight to S3 without touching disk, with retention by count
  (`:160-182`) and a row in `backup_runs` on every execution, success or failure
  (`trap registrar EXIT`, `:44-80`).
- `docker/backup/restore.sh` restores into a **test** database
  (`brabo_restore_test`, `:18`), validates three things — the table list, the
  count of the critical ones within the backup window, and the dense continuity
  of the `seq` of `session_events` (`:139-224`) — and **never touches the
  origin** (`:8-9`).
- `make test-restore` → `deploy/k8s/test-restore.sh`, which requires `kubectl`,
  a cluster and the `brabo-backup` CronJob in the namespace (`:56-58`).

Three consequences, all measured:

1. **Migrating a compose installation has no path.** `test-restore` is
   Kubernetes; there is no equivalent target against compose, and
   `docker-compose.prod.yml` **has no `backup` service** (the image is built by
   the bake and used only in k8s).
2. **The backup covers only Postgres.** Nothing in `docker/backup/` touches
   `neo4j_data`, `git_local_repos`, `project_workspaces`, `ollama_data` or
   `brabo_projects_base` (`docker-compose.prod.yml:474-486`).
3. It also requires **S3** — five mandatory variables (`backup.sh:11-15`). In a
   single-machine installation, requiring a bucket in order to migrate is
   requiring infrastructure the installer just said it does not need.

## Decision

### 1. Classify the volumes before copying them

The easy mistake is "back up all the volumes". The seven are not the same thing,
and treating them the same costs space and hides what matters:

| volume | nature | decision |
|---|---|---|
| `pgdata` | **source of truth** — event log, actions, everything | already covered by `pg_dump`; it remains the logical dump, not a file copy |
| `git_local_repos` | **source of truth** — the bare repos of the `LocalGitProvider` | **enters**, and it is this ADR's finding |
| `neo4j_data` | **derived** — the graph is memory projected from the event log ([ADR 0099](0099-neo4j-grafo-de-conhecimento-e-templates.md)), never a source of truth | **does not enter**: what is missing is **reprojection**, not backup |
| `project_workspaces` | **derived** — worktrees the `WorktreeManager` recreates from the bare | does not enter |
| `ollama_data` | **re-obtainable** — models that can be downloaded again | does not enter |
| `brabo_projects_base` | **the user's**, not the product's | does not enter, and the installer never deletes it ([ADR 0150](0150-instalador-de-uma-linha.md)) |

**`git_local_repos` is the real hole.** A project with the `local` provider has
its *bare* repository in there; losing that volume is losing the code the agents
produced, and today **no backup covers it**. It is not rebuildable from Postgres
— the event log keeps the narrative, not the git objects.

### 2. Local destination, S3 optional

The backup now accepts a **disk destination** besides S3. In a single-machine
installation, a directory is the honest destination; requiring a bucket to
migrate would be requiring infrastructure the installer does not ask for.

The five S3 variables stop being mandatory and become what they already were in
practice: the configuration of **one** of the destinations.

### 3. A restore path that runs against compose

The equivalent of `test-restore` **without a cluster** is born: it brings up the
backup image with `docker compose run`, restores into a test database and runs
**the same three validations** of `restore.sh:139-224`. No new validation logic
— what changes is the wrapper, not the judgment.

`deploy/k8s/test-restore.sh` stays **intact**: they are two environments with
two wrappers, and unifying them would make the compose one depend on `kubectl`.

### 4. Graph reprojection is the answer for Neo4j

Restoring `neo4j_data` from a backup would restore a possibly old projection
next to a Postgres restored at another point — two derived states from different
instants, with nothing reconciling them. The right answer for derived memory is
to reproject from the source.

This phase **does not build** the reprojection: it declares that it is the path
and that, until it exists, a migrated installation is born with the graph
**empty** — which is known degradation (RAG remains in pgvector, which lives in
Postgres and comes in the dump), not data loss.

### 5. The installer uses this, and does not guess

The migration path of ADR 0150 is: **backup → confirm → deletion → installation
→ restore**, with the restore proven by decision 3. Without a good backup, the
installer does **not** proceed to deletion.

## What this ADR explicitly rejects

- **Copying all the volumes.** By decision 1: three of the seven are derived or
  re-obtainable, and copying them gives the impression of coverage without
  adding recovery.
- **A file copy of `pgdata`.** Copying the data directory of a running Postgres
  produces a backup that may not restore; the logical dump remains.
- **Restoring `neo4j_data`.** By decision 4.
- **Running the restore against the origin database.** `restore.sh` never
  touches the origin (`:8-9`), and that property is not negotiated for the
  convenience of migration.
- **Unifying with `deploy/k8s/test-restore.sh`.**

## Consequences

- Migrating an existing installation gets a **proven** path, and the installer
  earns the right to delete volumes — because it proved it can bring them back.
- **`git_local_repos` enters the backup**, and that is the difference this ADR
  makes outside the installation scope: today any loss of that volume is a loss
  of code, in any environment, and nobody had recorded it.
- A migrated installation is born with an **empty graph** until reprojection
  exists. Declared, with the effect named: the reads that depend on the graph
  degrade; RAG is not affected.
- The backup gains a second destination, and with it a second failure path —
  a full disk. The row in `backup_runs` is still written in both cases, by the
  `trap` that already exists.
