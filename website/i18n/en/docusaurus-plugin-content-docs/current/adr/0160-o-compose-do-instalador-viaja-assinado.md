---
traducao_de: 62bc5cf068bc411bf48b7818f098e61346ce72fb
---

# 0160 — The installer's compose travels with it, as a signed asset

## Status

**Accepted.** Decided by the maintainer on 2026-09-13 (AT-026). It extends
[ADR 0149](0149-assinatura-dos-artefatos-publicados.md) — the signed
`checksums.txt` now covers more than binaries — and closes a gap of
[ADR 0150](0150-instalador-de-uma-linha.md), which designed the one-line
installer without saying how the installation compose would reach the
installer's machine. Neither is edited; this document references them.

## Context

The installer's E2E on a clean machine ran for the first time in session 8 of
PHASE 30 ([RN-549](../business-rules.md#rn-549)) and answered **no** to the
question it existed to answer. `install.sh` brought up the stack with
`docker compose -f docker/docker-compose.install.yml` — a path **relative to the
directory it ran from** — used in seven places, including the `up -d --wait`.
That file:

- **was not a Release asset**;
- **was not in the signed `checksums.txt`**;
- **was downloaded nowhere** — the script's only downloads were `cosign`, the
  manifest and its signature, `images.json` and the runner binary.

And the compose bind-mounts two files relative to it: `./postgres/init.sql` (the
`postgres` one, which creates the pgvector extension) and
`./ollama/pull-models.sh` (the `ollama-model-loader` one, under the `llm`
profile). The workaround step of `install-e2e.yml` brought exactly those
**three** from the tag, through `raw.githubusercontent.com`.

**The symptom was late, and that is what made it expensive.** Whoever followed
the runbook's one-liner in an empty folder died with *"no such file or
directory"* **after** the script had verified its own signature, detected the
machine, asked for the base and **written the `.env` with the five secrets**.
Half an installation, and a message that did not say what to do.

**Measured while implementing: there are four, not three.** The MIGRATION path
(`migrar_instalacao_anterior`, [RN-530](../business-rules.md#rn-530)) runs
`bash docker/backup/test-restore-compose.sh` — another relative path, and a
script **executed** on the host. The E2E never reached it because on a clean
machine there is nothing to migrate, and so the workaround did not bring it. In
a folder without a checkout the migration would die there — before deleting
anything, by construction of RN-530, but it would die.

No layer below the E2E could see this: each piece worked and had its own suite.
The defect was **between the published artifact and the installer's machine**,
which is the boundary only the E2E crosses — and it only runs on a tag.

## Decision

**1. The files become Release assets and enter the SAME signed
`checksums.txt`.** Four, with names that do not collide:

| asset in the Release | path in the repository and under the installation folder | why |
|---|---|---|
| `brabo-install-compose.yml` | `docker/docker-compose.install.yml` | the compose that brings up the installation |
| `brabo-install-postgres-init.sql` | `docker/postgres/init.sql` | bind-mounted by `postgres` |
| `brabo-install-ollama-pull-models.sh` | `docker/ollama/pull-models.sh` | bind-mounted by `ollama-model-loader` |
| `brabo-install-backup-test-restore.sh` | `docker/backup/test-restore-compose.sh` | the migration's restore proof |

The Release is **flat** — an asset is a name, with no folder — and the manifest
is indexed by name. `init.sql` and `pull-models.sh` are generic enough to collide
with the next asset someone attaches, and two files with the same name would be
a single line, with one's verification passing against the other's hash. Hence
the `brabo-install-` prefix, which also does not match the
`--pattern 'brabo-runner-*'` with which the `checksums` job downloads the
binaries.

The table lives in `scripts/ci/assets-do-instalador.ts` (who PUBLISHES) and in
the `case` of `destino_do_asset_do_instalador` in `install.sh` (who DOWNLOADS).
There are two because the installer runs with bash 3.2 on macOS and without
Node; divergence is failed by `assets-do-instalador.spec.ts`, which reads the
shell's `case`. The same spec DERIVES from the compose every `./…` bind-mount
and fails what is not in the table — which is exactly how the defect was born:
someone added a mount and nobody asked how it would travel.

**2. Whoever publishes is the `checksums` job of `build-runner-binaries.yml`**,
the same one that already publishes `install.sh`: the files come from the
**tag's checkout** (the same commit that produced everything else signed there),
are copied under the asset's name by the script, enter the `sha256sum` that
generates the manifest and are attached together. Nothing changes in the wait
for assets of [RN-565](../business-rules.md#rn-565): these do not come from the
matrix, so there is nothing to wait for. The job now also checks **each line of
the manifest against the file** (`sha256sum -c --strict`) after verifying the
signature and before attaching — the signature proves who wrote the manifest;
the check proves that what is going to be attached is what it says.

**3. `install.sh` downloads and verifies the four BEFORE asking or writing
anything.** Right after `verificar_a_si_mesmo`, and against the SAME
`checksums.txt` that function already verified (never a second download, for the
reason it writes). The comparison is by exact field equality (`awk`), not by
pattern: the name has dots. Three **named and distinct** refusals, because they
call for different actions — the Release does not publish the asset (it predates
this ADR, or came out half done), the manifest does not cover it, the hash does
not match (incident). All say *"Nada foi gravado"*, and it is true: up to there
only a temporary directory was written to.

**4. It never falls back to the relative path.** `COMPOSE_DE_INSTALACAO` stops
being the constant `'docker/docker-compose.install.yml'` and is born **empty**;
it only gets a value — an **absolute** path — when
`materializar_os_arquivos_da_instalacao` copies the verified copies to
`<pasta de onde o script roda>/docker/`, the same folder as the `.env`. That
happens at the first instant a file is needed (the migration, or the startup
right after the `.env`), never before: the no-TTY path still writes nothing.
Whatever is already at the destination is **replaced, never read** — in an
update it is the previous version's compose —, with an `rm` before copying so a
symlink does not take the write elsewhere. The layout under the folder is the
same as before on purpose: the compose's relative bind-mounts keep resolving,
the marker keeps recording the compose and the command the runbook gives the
operator does not change.

**5. The E2E inverts what it demands.** The workaround step goes away; in its
place comes the assertion that the job's folder starts **without** `docker/`
(it has no checkout), that without a TTY the installer verified the files and
wrote none, and — in its own step, after the installation, so the token is not in
the installer's environment — that the written files are byte for byte the ones
the Release's manifest covers. `install-e2e.spec.ts` stops demanding "both
halves" of the workaround and starts demanding that it **not** come back.

## What this ADR explicitly rejects

- **Cloning the repository at the tag.** It would be a single file to maintain,
  always coherent with the tag — and it would trade the signature chain for
  **trust in the `git` transport**, adding a dependency the clean machine may
  not have. What brings up the installation would become the only thing, among
  what the installer uses, that is not verified the way the binary is.
- **A tarball with the four.** One more file to extract on other people's
  machines, and a manifest line that covers four files without naming them — the
  same reason ADR 0149 preferred a manifest to five signatures, applied in
  reverse.
- **Embedding the files in `install.sh`** (heredoc). The compose has hundreds of
  lines and changes with the topology; the installer would change along with
  every service, and `composes-em-conformidade.spec.ts` would have to read
  shell.
- **A variable or flag to point to another Release URL**, for testing. It is the
  shortest form of a skip-verification door (ADR 0150). The shell tests pass the
  URL as the function's ARGUMENT, which is what `main` also does.
- **Running `install-e2e.yml` on `pull_request`.** It stays out, for the reason
  of ADR 0150.

## Consequences

- **Closed in code, proven only at the next final tag.** The pipeline only
  publishes on a tag and the E2E only runs after it; on a PR the static part runs
  (`assets-do-instalador.spec.ts`, `install-e2e.spec.ts`) and the functional
  shell part against a fake Release (`install-arquivos-da-instalacao.spec.ts`).
  Until the first tag after this merge, no published Release has the assets.
- **No operator action, and no installation that worked stops working.** The new
  `install.sh` only reaches someone inside a Release, and it is the SAME step of
  the SAME job that attaches it and attaches the four assets — so a Release with
  the new installer and without the files only exists if that step fails midway,
  and then the installer refuses early, with *"a Release não publica …"*, instead
  of dying after the `.env`. Running the new `install.sh` from a checkout against
  an old Release was already refused before, by the origin verification
  ([RN-526](../business-rules.md#rn-526)): its hash is not in the old manifest.
  Already published Releases keep the old installer and the workaround of
  running it from inside a checkout at the tag.
- **The Release grows** by four assets (~29 KB) and the manifest by four lines,
  and the four files become **versioned together** with the installer: changing
  one of them changes what the next tag signs. Changing the TABLE requires
  changing both sides, and the spec fails if only one changes.
- **A checkout whose folder is the installation's has its `docker/`
  overwritten** by the Release's copies. At the tag being installed they are
  identical; outside it, `git status` gets dirty, and the script SAYS which ones
  it replaced. It is the price of the layout not changing, and it only exists for
  whoever installs from inside a checkout.
- **The `GET /runner-releases/binary` proxy does not change**: it reads the
  manifest as a name → hash map ([RN-525](../business-rules.md#rn-525)), and
  extra lines do not affect it.
- **Adjacency measured and NOT fixed.** The migration's restore proof
  (`test-restore-compose.sh`) calls `docker compose -f <compose>` without
  `--env-file`, and Compose looks for the `.env` in the COMPOSE's folder, not the
  one it runs from (measured: `docker compose -f docker/c.yml config` with a
  `.env` only in the current directory fails interpolation). Since the compose
  lives in `docker/` and the `.env` in the folder above, the `BRABO_BACKUP_IMAGE`
  variable does not arrive, and the proof tends to fail — a SAFE outcome by
  RN-530 (nothing is deleted), but migration by compose does not close. It is a
  pre-existing defect of the migration path, which no E2E exercises; it is
  declared here for the front that exercises it.
