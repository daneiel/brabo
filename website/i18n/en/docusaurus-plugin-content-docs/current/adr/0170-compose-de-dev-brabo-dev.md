---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0170 — The dev compose becomes `brabo-dev`, and dev refuses to come up next to an installation

## Status

**Accepted.** The maintainer's decision on 2026-09-27 (AT-173): "both" — its own
name for dev AND a guard. It references [ADR 0150](0150-instalador-de-uma-linha.md)
(the installation compose, which was born saying it had a `name` different from
dev's) and [ADR 0152](0152-backup-de-volumes-contra-compose.md) (the volumes that
matter). It edits neither.

## Context

Measured on 2026-09-19: `docker/docker-compose.yml` (dev) and
`docker/docker-compose.install.yml` both declared `name: brabo`. The
installation compose's comment asserted the opposite — *"`name` diferente do
compose de dev de propósito: os dois podem coexistir na mesma máquina"* — and it
was not true. For Docker, a machine with an installation AND a checkout had ONE
project: the containers (`brabo-api-1`, `brabo-postgres-1`…), the network
(`brabo_default`) and the same-name volumes (`brabo_pgdata`,
`brabo_neo4j_data`, `brabo_git_local_repos`, `brabo_project_workspaces`…) were
the same.

Three consequences, the first measured:

- bringing up one compose over the other RECREATES the other's containers and
  connects them to its database — an installation's database received a
  migration from dev;
- `scripts/dev/reset-total.sh` does `DROP SCHEMA … CASCADE` on the Postgres of
  the `brabo` project — that is, it would delete the installation's database;
- `docker compose down` of one brings down the other.

The PRODUCTION compose (`docker-compose.prod.yml`) was already `brabo-prod`, and
is not part of this.

## Decision

**1. The dev compose is now called `brabo-dev`.** Containers
`brabo-dev-<serviço>-1`, network `brabo-dev_default`, volumes
`brabo-dev_<chave>`. The observability overlay
(`docker-compose.observability.yml`) repeats the name, because the `name:` of
the LAST `-f` wins and a different value there would move the whole stack to
another project; its Alloy filters by `com.docker.compose.project=brabo-dev`.

**The installation one STAYS `brabo`.** It is the name already-made
installations have, and changing it would disconnect each of them from their own
volumes on the next update — the cost would fall on whoever never read this
repository. Whoever changes is the developer side, which reads the CHANGELOG and
has the runbook.

**2. A guard, in `preflight.mjs` and in `reset-total.sh`.** Both REFUSE, naming
the containers found and the `down` (without `-v`) of each file, when there is on
the machine a container — in any state, `docker ps -a` — whose
`com.docker.compose.project.config_files` label points to the INSTALLATION
compose (`docker-compose.install.yml`, or the asset name
`brabo-install-compose.yml`). And they refuse when the dev compose, as the script
calls it, would resolve to the `brabo` project (a `COMPOSE_PROJECT_NAME=brabo` in
the `.env` or in the environment). In the reset, the guard is the FIRST step,
even before the preflight, and the refusal comes out as `RESET NÃO COMEÇOU`.

The criterion is the label's FILE, not the project name: an installation is
recognized under any `-p`, and that is what makes the guard useful against what
the name does not solve — the dev compose brought up with `-p brabo` by hand, the
`COMPOSE_PROJECT_NAME`, and an old checkout with `name: brabo` (which does not
have this guard, but whose accident the NEW checkout refuses to continue).

The rule exists in TWO places, JS (`scripts/dev/instalacao-na-maquina.mjs`) and
bash (`recusar_se_ha_instalacao` in `scripts/dev/reset-total-lib.sh`), because the
reset's spec runs with a fake `node` in the PATH and needs to prove that the
script itself refuses. Both are exercised by the specs next to them.

Docker that does not answer does NOT refuse: the preflight says the guard did not
run and continues (the `up` brings up nothing without Docker), and in the reset
the `build`, still before the first effect, would fail the same way.

**3. Migration for whoever already develops: a warning, never a refusal, never
deleting.** The next `pnpm dev` creates EMPTY `brabo-dev_*` volumes; the data
stays in the `brabo_*` ones. The preflight WARNS when it finds a `brabo_*` volume
with a key that ONLY the dev compose declares (`*_node_modules`,
`engine_build`/`deps`/`mix`/`hex`) — the list is DERIVED from the two compose
files, never copied — and separates, without asserting whose they are, those with
a key common to both (`pgdata`, `neo4j_data`, `git_local_repos`,
`project_workspaces`…), which may belong to an installation. The procedure to
copy (volume by volume, `cp -a`, with Postgres stopped) or start over is in the
runbook, "Moving a dev environment to brabo-dev". No script removes a volume.

## Consequences

- **Whoever develops acts once** (that is why the branch is `breaking/`): brings
  down the old stack WITHOUT `-v` (`docker compose -p brabo -f
  docker/docker-compose.yml down`) and chooses to copy the data or start over.
  Until they do, the old compose holds the ports, and the preflight says exactly
  that instead of `port is already allocated`.
- **Developing on a machine that has an installation now requires bringing the
  installation down first** (`down` without `-v`: volumes and data stay, `up -d`
  brings it back). It is the declared price of the guard by PRESENCE, and it was
  chosen by the maintainer: the separate names already make coexistence safe in
  the common case, but the guard exists precisely for the uncommon case — and a
  guard that only looked at name collision would let through the old checkout and
  the manual `-p` with the installation stopped. Running both AT THE SAME TIME
  remains impossible either way: they publish the same ports.
- An orphan `brabo_*` volume with a common key is not distinguishable, on its
  own, between old dev and installation — the warning says so instead of
  asserting. The runbook teaches how to ask (`config_files` of the containers,
  exclusive keys, whether there was an installation on the machine).
- Documentation and commands that cited `brabo-api-1`, `brabo-postgres-1`,
  `brabo-ollama-1`, `brabo_pgdata`… in the DEV context now cite `brabo-dev-*`.
  Those that talk about the INSTALLATION (the `brabo_project_workspaces` volume
  `install.sh` measures, the broker root in the installation) stay as they are,
  because they remain true. Historical narrative (old CHANGELOG, accepted RNs and
  ADRs) is not rewritten.
- The local Prometheus `pod` labels become `brabo-dev-api-1`/
  `brabo-dev-engine-1`, the container's real name; no dashboard filters by `pod`
  value, it only groups.
